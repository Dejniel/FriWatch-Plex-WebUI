import {
  getIncludeProps,
  publishMediaChange,
  readMediaMetadata,
  type MediaMetadata,
} from "entities/media/model";
import { changedMediaFields } from "@friwatch/contracts";
import {
  canDeleteMedia,
  type CapturedPlexSession,
} from "features/session/model";
import { PlexClient, PlexRequestError } from "shared/api/PlexClient";
import { queryBuilder } from "shared/lib/query";
import {
  plexArray,
  plexBoolean,
  plexContainer,
  PlexResponseError,
} from "shared/api/plexResponse";
import {
  deletionTargetExists,
  mediaDeletionTarget,
  type MediaDeletionTarget,
} from "../model/mediaDeletion";

export interface MediaDeletionResult {
  metadata: MediaMetadata | null;
}

/** Recheck the confirmed inventory before every manual attempt. An acknowledged
 * DELETE is never repeated when only its verification failed. */
export function createMediaDeletion(
  session: CapturedPlexSession,
  target: MediaDeletionTarget,
) {
  if (!/^\d+$/.test(target.ratingKey))
    throw new Error("Select a local Plex media file.");
  const client = new PlexClient(() => session.token);
  const path = `/library/metadata/${target.ratingKey}`;
  let submitted = false;
  let acknowledged = false;
  // Preserve evidence even if the UI updates canonical data before reconciliation.
  let baseline: MediaMetadata | undefined;
  let verified: MediaMetadata | undefined;
  const assertCurrent = (signal: AbortSignal) => {
    session.assertCurrent(signal);
    if (!canDeleteMedia())
      throw new Error(
        "Deleting media requires the server owner and Allow media deletion enabled in Plex.",
      );
  };
  const read = async (signal: AbortSignal) => {
    try {
      const response = await client.get(
        `${path}?${queryBuilder(getIncludeProps())}`,
        signal,
      );
      session.assertCurrent(signal);
      const rows = plexArray(
        plexContainer(response, "media files").Metadata,
        "media files",
      );
      if (rows.length !== 1) throw new PlexResponseError("media files");
      const data = readMediaMetadata(rows[0], target.ratingKey);
      if (data.ratingKey !== target.ratingKey || data.type !== target.type)
        throw new PlexResponseError("media files");
      return data;
    } catch (error) {
      session.assertCurrent(signal);
      if (error instanceof PlexRequestError && error.status === 404)
        return null;
      throw error;
    }
  };
  const verify = (data: MediaMetadata | null): MediaDeletionResult => {
    if (deletionTargetExists(target, data))
      throw new Error(
        "Plex accepted the deletion, but the files are still listed. Retry to check its status; the deletion will not be sent again.",
      );
    const metadata = data?.Media?.some((media) => media.Part?.length)
      ? data
      : null;
    verified = metadata ?? undefined;
    return { metadata };
  };
  const publishResult = (after?: MediaMetadata) => {
    if (session.scope)
      publishMediaChange({
        ...session.scope,
        sectionId: target.sectionId,
        kind: "item",
        id: target.ratingKey,
        ...(after && baseline
          ? {
              effect: "metadata" as const,
              fields: changedMediaFields(baseline, after),
              parentIds: [
                ...new Set(
                  [
                    baseline.parentRatingKey,
                    baseline.grandparentRatingKey,
                    after.parentRatingKey,
                    after.grandparentRatingKey,
                  ].filter((id): id is string => Boolean(id)),
                ),
              ],
            }
          : { effect: "unknown" as const }),
      });
  };
  return async (signal: AbortSignal): Promise<MediaDeletionResult> => {
    assertCurrent(signal);
    verified = undefined;
    try {
      const before = await read(signal);
      if (acknowledged) return verify(before);
      if (!before || !deletionTargetExists(target, before)) {
        if (submitted) return verify(before);
        publishResult();
        throw new Error(
          "The selected media files are no longer available. Open file information again.",
        );
      }
      const current = mediaDeletionTarget(before, target.mediaId);
      if (JSON.stringify(current.versions) !== JSON.stringify(target.versions)) {
        publishResult();
        throw new Error(
          "The media files changed. Open file information again and review the current files before deleting.",
        );
      }
      const root = plexContainer(
        await client.get("/", signal),
        "server permissions",
      );
      assertCurrent(signal);
      if (
        !plexBoolean(root.allowMediaDeletion, "server permissions") ||
        root.machineIdentifier !== session.scope?.serverId
      )
        throw new Error("Plex does not allow deleting media on this server.");
      submitted = true;
      baseline = before;
      try {
        await client.delete(
          target.mediaId === undefined
            ? path
            : `${path}/media/${target.mediaId}`,
          signal,
        );
        acknowledged = true;
      } catch (error) {
        session.assertCurrent(signal);
        // A lost response may still have deleted the files. Observe, never retry here.
        const after = await read(signal).catch(() => undefined);
        session.assertCurrent(signal);
        if (after !== undefined && !deletionTargetExists(target, after))
          return verify(after);
        throw error;
      }
      session.assertCurrent(signal);
      return verify(await read(signal));
    } finally {
      if (submitted) publishResult(verified);
    }
  };
}
