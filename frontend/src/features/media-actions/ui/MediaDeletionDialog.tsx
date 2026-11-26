import { useLocation, useNavigate } from "react-router-dom";
import { mediaMetadataQueryKey } from "entities/media/model";
import { serverQueryClient } from "shared/api/queryClient";
import {
  openMediaFilesDialog,
  useMediaActionDialog,
  type MediaActionSelection,
} from "../model/mediaActionDialog";
import type { MediaDeletionResult } from "../api/deletion";
import ConfirmedMediaActionDialog from "./ConfirmedMediaActionDialog";

export function MediaDeletionDialog({
  selection,
  onClose,
}: {
  selection: Extract<MediaActionSelection, { kind: "delete" }>;
  onClose: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const current = () =>
    selection.isCurrent() &&
    useMediaActionDialog.getState().selection === selection;
  const deleted = async ({ metadata }: MediaDeletionResult) => {
    if (!current()) return;
    if (metadata) {
      const queryKey = mediaMetadataQueryKey(
        selection.scope,
        metadata.ratingKey,
      );
      await serverQueryClient.cancelQueries({ queryKey, exact: true });
      if (!current()) return;
      serverQueryClient.setQueryData(queryKey, metadata);
      if (selection.returnToFiles) {
        openMediaFilesDialog(metadata);
        return;
      }
    } else {
      const params = new URLSearchParams(location.search);
      if (params.get("mid") === selection.data.ratingKey) {
        for (const key of ["mid", "pguid", "detailsTab"]) params.delete(key);
      }
      if (params.get("photo") === selection.data.ratingKey) {
        params.delete("photo");
        params.delete("photoIndex");
      }
      const exactPage = location.pathname.endsWith(
        `/item/${selection.data.ratingKey}`,
      );
      const pathname = exactPage
        ? location.pathname.replace(/\/item\/\d+$/, "")
        : location.pathname;
      if (
        pathname !== location.pathname ||
        params.toString() !== location.search.replace(/^\?/, "")
      )
        navigate(
          { ...location, pathname, search: params.size ? `?${params}` : "" },
          { replace: true },
        );
    }
    onClose();
  };
  return (
    <ConfirmedMediaActionDialog
      selection={selection}
      onDeleted={deleted}
      onClose={() => {
        if (selection.returnToFiles && current())
          openMediaFilesDialog(selection.data);
        else onClose();
      }}
    />
  );
}
