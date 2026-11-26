import { ConfirmDialog } from "shared/ui";
import { Box, Typography } from "@mui/material";
import type { MediaDeletionResult } from "../api/deletion";
import type { ConfirmedMediaAction } from "../model/mediaActionDialog";
import { useConfirmedMediaAction } from "../model/useConfirmedMediaAction";

export default function ConfirmedMediaActionDialog({
  selection,
  onClose,
  onDeleted,
}: {
  selection: ConfirmedMediaAction;
  onClose: () => void;
  onDeleted?: (result: MediaDeletionResult) => void | Promise<void>;
}) {
  const action = useConfirmedMediaAction(selection, onClose, onDeleted);
  if (selection.kind === "delete")
    return (
      <ConfirmDialog
        open
        title={
          selection.target.mediaId === undefined
            ? "Delete all files"
            : "Delete this version"
        }
        message={
          <>
            <Typography>
              Delete{" "}
              {selection.target.mediaId === undefined
                ? "all media files"
                : "this media version"}{" "}
              for “{selection.data.title}” from the Plex server?
            </Typography>
            <Box component="ul" sx={{ pl: 2.5, my: 2 }}>
              {selection.target.versions
                .flatMap((version) => version.parts)
                .map((part) => (
                  <Box
                    component="li"
                    key={part.id}
                    sx={{
                      overflowWrap: "anywhere",
                      fontFamily: "monospace",
                      fontSize: "0.85rem",
                      mb: 1,
                    }}
                  >
                    {part.file}
                  </Box>
                ))}
            </Box>
            <Typography color="error.main">
              These source files will be deleted from disk. This cannot be
              undone in FriWatch.
            </Typography>
          </>
        }
        onClose={onClose}
        onConfirm={() => void action.confirm()}
        busy={action.busy}
        error={action.error}
        confirmColor="error"
        confirmLabel={action.error ? "Retry" : "Delete"}
        busyLabel="Deleting…"
      />
    );
  const label =
    selection.kind === "watched" && selection.watched ? "watched" : "unwatched";
  const items =
    selection.kind === "watched"
      ? selection.items.filter((item) => action.ids.includes(item.ratingKey))
      : [];
  const noun = items.every((item) => item.type === "episode")
    ? "episode"
    : "item";
  const subject =
    selection.kind === "watched" && selection.items.length === 1
      ? `"${items[0].title}"`
      : `${items.length} ${noun}${items.length === 1 ? "" : "s"}`;
  return (
    <ConfirmDialog
      open
      title={
        selection.kind === "unmatch" ? "Unmatch metadata" : `Mark as ${label}`
      }
      message={
        selection.kind === "unmatch"
          ? `Remove the current metadata match from "${selection.data.title}"?`
          : `Are you sure you want to mark ${subject} as ${label}?`
      }
      onClose={onClose}
      onConfirm={() => void action.confirm()}
      busy={action.busy}
      error={action.error}
      confirmLabel={action.error ? "Retry" : "Confirm"}
      busyLabel={selection.kind === "unmatch" ? "Unmatching…" : "Updating…"}
    />
  );
}
