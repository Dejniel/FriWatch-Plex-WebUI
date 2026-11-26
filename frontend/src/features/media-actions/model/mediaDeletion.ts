import {
  mediaFileVersions,
  supportsMediaFiles,
  type MediaMetadata,
} from "entities/media/model";

const validId = (id?: number): id is number =>
  Number.isSafeInteger(id) && (id ?? 0) > 0;

/** A confirmation snapshots the exact version/part identities and physical paths. */
export function mediaDeletionTarget(data: MediaMetadata, mediaId?: number) {
  if (!supportsMediaFiles(data) || (mediaId !== undefined && !validId(mediaId)))
    throw new Error("Select a local Plex media file.");
  const all = mediaFileVersions(data);
  const versions =
    mediaId === undefined
      ? all
      : all.filter((version) => version.media.id === mediaId);
  if (!versions.length || (mediaId !== undefined && versions.length !== 1))
    throw new Error("The selected media version is no longer available.");
  const ids = new Set<number>();
  const parts = new Set<number>();
  const inventory = versions
    .map((version) => {
      const id = version.media.id;
      if (!validId(id) || ids.has(id) || !version.parts.length)
        throw new Error(
          "Plex did not provide a complete file inventory. Deletion is unavailable.",
        );
      ids.add(id);
      return {
        id,
        parts: version.parts
          .map((part) => {
            if (!validId(part.id) || parts.has(part.id) || !part.file?.trim())
              throw new Error(
                "Plex did not provide a complete file inventory. Deletion is unavailable.",
              );
            parts.add(part.id);
            return { id: part.id, file: part.file, size: part.size };
          })
          .sort((a, b) => a.id - b.id),
      };
    })
    .sort((a, b) => a.id - b.id);
  return {
    ratingKey: data.ratingKey,
    title: data.title,
    type: data.type,
    sectionId: data.librarySectionID?.toString(),
    mediaId,
    versions: inventory,
  };
}
export type MediaDeletionTarget = ReturnType<typeof mediaDeletionTarget>;

export function canDeleteMediaFiles(data: MediaMetadata, mediaId?: number) {
  try {
    mediaDeletionTarget(data, mediaId);
    return true;
  } catch {
    return false;
  }
}

export function deletionTargetExists(
  target: MediaDeletionTarget,
  data: MediaMetadata | null,
) {
  return Boolean(
    data &&
    (target.mediaId === undefined
      ? data.Media?.some((media) => media.Part?.length)
      : data.Media?.some((media) => media.id === target.mediaId)),
  );
}
