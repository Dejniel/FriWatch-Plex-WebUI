import { DeleteOutlineRounded, DownloadRounded } from "@mui/icons-material";
import { Alert, Box, Button, Stack } from "@mui/material";
import { MediaFiles } from "entities/media/public";
import { mediaFileVersions, type MediaMetadata } from "entities/media/model";
import { useCanDeleteMedia, useServerSession } from "features/session/model";
import { getOriginalDownloads } from "../model/downloads";
import { canDeleteMediaFiles } from "../model/mediaDeletion";
import { openMediaDeleteDialog } from "../model/mediaActionDialog";

/** The inventory is shared across media types; actions retain their feature owner. */
export function MediaFilesPanel({
  data,
  returnToFiles = false,
}: {
  data: MediaMetadata;
  returnToFiles?: boolean;
}) {
  const canDelete = useCanDeleteMedia();
  const allowDownloads = useServerSession(
    (state) => state.server?.allowSync === true,
  );
  const downloads = getOriginalDownloads(data, allowDownloads);
  const multiple = mediaFileVersions(data).length > 1;
  const canDeleteAll = canDeleteMediaFiles(data);
  return (
    <>
      <MediaFiles
        data={data}
        renderActions={(version) => (
          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            sx={{ flexWrap: "wrap" }}
          >
            {downloads
              .filter((download) => download.media === version.media)
              .map((download, index) => (
                <Button
                  key={download.part.id ?? index}
                  component="a"
                  href={download.href}
                  download={download.filename}
                  size="small"
                  startIcon={<DownloadRounded />}
                >
                  {version.parts.length > 1
                    ? `Download part ${index + 1}`
                    : "Download"}
                </Button>
              ))}
            {canDelete && multiple && (
              <Button
                color="error"
                size="small"
                startIcon={<DeleteOutlineRounded />}
                disabled={
                  !canDeleteMediaFiles(data, version.media.id) ||
                  version.media.id === undefined
                }
                onClick={() =>
                  openMediaDeleteDialog(data, version.media.id, returnToFiles)
                }
              >
                Delete this version…
              </Button>
            )}
          </Stack>
        )}
      />
      {canDelete && !canDeleteAll && (
        <Alert severity="info" sx={{ mt: 2 }}>
          Deleting all files is unavailable because Plex did not provide a
          complete file inventory.
        </Alert>
      )}
      {canDelete && (
        <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 3 }}>
          <Button
            color="error"
            variant="outlined"
            startIcon={<DeleteOutlineRounded />}
            disabled={!canDeleteAll}
            onClick={() =>
              openMediaDeleteDialog(data, undefined, returnToFiles)
            }
          >
            Delete all files…
          </Button>
        </Box>
      )}
    </>
  );
}
