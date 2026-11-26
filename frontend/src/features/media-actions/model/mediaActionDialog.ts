import { isVideoLibraryItemType } from "@friwatch/contracts";
import { create } from "zustand";
import {
  supportsMediaFiles,
  type MediaMetadata,
  type MediaScope,
  type MediaItemData,
} from "entities/media/model";
import {
  canManageServer,
  canDeleteMedia,
  capturePlexSession,
  type CapturedPlexSession,
  useAuthSession,
  useServerSession,
} from "features/session/model";
import { metadataMatchType } from "./matching";
import type { MetadataEditingItem } from "./metadataEditing";
import { mediaDeletionTarget, type MediaDeletionTarget } from "./mediaDeletion";

export type WatchedTarget = Pick<MediaItemData, "ratingKey" | "type" | "title">;
type DialogIntent =
  | { kind: "files"; data: MediaItemData }
  | {
      kind: "delete";
      data: MediaMetadata;
      target: MediaDeletionTarget;
      returnToFiles: boolean;
    }
  | { kind: "edit"; data: MetadataEditingItem; onSaved?: () => void }
  | { kind: "match"; data: MediaItemData; onSaved?: () => void }
  | { kind: "unmatch"; data: WatchedTarget }
  | {
      kind: "watched";
      items: WatchedTarget[];
      watched: boolean;
      onProgress?: (remainingIds: string[]) => void;
    };
export type MediaActionSelection = DialogIntent &
  CapturedPlexSession & {
    scope: MediaScope;
    key: number;
  };
export type ConfirmedMediaAction = Extract<
  MediaActionSelection,
  { kind: "watched" | "unmatch" | "delete" }
>;
export const useMediaActionDialog = create<{
  selection: MediaActionSelection | null;
}>(() => ({ selection: null }));
let nextKey = 0;

function openDialog(intent: DialogIntent): MediaActionSelection | null {
  const session = capturePlexSession();
  const { activeUser } = useAuthSession.getState();
  if (!session.scope || !session.isCurrent()) return null;
  if (
    intent.kind !== "watched" &&
    intent.kind !== "files" &&
    !canManageServer(
      Boolean(activeUser && !activeUser.restricted),
      useServerSession.getState().canManageServer,
    )
  )
    return null;
  if (intent.kind === "delete" && !canDeleteMedia()) return null;
  const selection = {
    ...intent,
    ...session,
    scope: session.scope,
    key: ++nextKey,
  };
  useMediaActionDialog.setState({ selection });
  return selection;
}

/** Only the workflow that opened a dialog may close it. */
export function closeMediaActionDialog(selection: MediaActionSelection | null) {
  if (selection && useMediaActionDialog.getState().selection === selection)
    useMediaActionDialog.setState({ selection: null });
}
export function openMediaFilesDialog(data: MediaItemData) {
  if (supportsMediaFiles(data)) return openDialog({ kind: "files", data });
  return null;
}
export function openMediaDeleteDialog(
  data: MediaMetadata,
  mediaId?: number,
  returnToFiles = false,
) {
  const target = mediaDeletionTarget(data, mediaId);
  return openDialog({ kind: "delete", data, target, returnToFiles });
}
export function openMetadataDialog(
  data: MetadataEditingItem,
  onSaved?: () => void,
) {
  openDialog({ kind: "edit", data, onSaved });
}
export function openMetadataMatchDialog(
  data: MediaItemData,
  onSaved?: () => void,
) {
  if (
    /^\d+$/.test(data.ratingKey) &&
    metadataMatchType(data.type) !== undefined
  )
    openDialog({ kind: "match", data, onSaved });
}
export function openMetadataUnmatchDialog(data: MediaItemData) {
  if (
    /^\d+$/.test(data.ratingKey) &&
    metadataMatchType(data.type) !== undefined
  )
    openDialog({ kind: "unmatch", data: target(data) });
}
function target({ ratingKey, type, title }: WatchedTarget): WatchedTarget {
  return { ratingKey, type, title };
}
export function openMediaWatchedDialog(
  items: readonly WatchedTarget[],
  watched: boolean,
  onProgress?: (remainingIds: string[]) => void,
): MediaActionSelection | null {
  if (
    !items.length ||
    items.some(
      (item) =>
        !/^\d+$/.test(item.ratingKey) || !isVideoLibraryItemType(item.type),
    )
  )
    return null;
  return openDialog({
    kind: "watched",
    items: [
      ...new Map(items.map((item) => [item.ratingKey, target(item)])).values(),
    ],
    watched,
    onProgress,
  });
}
