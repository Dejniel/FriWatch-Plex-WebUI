import { useQuery } from "@tanstack/react-query";
import { Alert, Button, CircularProgress } from "@mui/material";
import { mediaMetadataQueryOptions } from "entities/media/model";
import { serverQueryClient } from "shared/api/queryClient";
import { AppDialog } from "shared/ui";
import type { MediaActionSelection } from "../model/mediaActionDialog";
import { MediaFilesPanel } from "./MediaFilesPanel";

export function MediaFilesDialog({
  selection,
  onClose,
}: {
  selection: Extract<MediaActionSelection, { kind: "files" }>;
  onClose: () => void;
}) {
  const query = useQuery(
    mediaMetadataQueryOptions(selection.scope, selection.data.ratingKey),
    serverQueryClient,
  );
  return (
    <AppDialog
      open
      title={`File information — ${selection.data.title}`}
      onClose={onClose}
      maxWidth="70rem"
    >
      {query.isPending && (
        <CircularProgress aria-label="Loading file information" />
      )}
      {query.isError && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={<Button onClick={() => void query.refetch()}>Retry</Button>}
        >
          Plex could not load the current media files.
        </Alert>
      )}
      {query.data && <MediaFilesPanel data={query.data} returnToFiles />}
    </AppDialog>
  );
}
