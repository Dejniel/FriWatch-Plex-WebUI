import { DeleteOutlineRounded, DescriptionOutlined } from "@mui/icons-material";
import { ListItemIcon, ListItemText, MenuItem } from "@mui/material";
import type { MediaItemData, MediaMetadata } from "entities/media/model";
import type { MediaActionCapabilities } from "../model/mediaActionCapabilities";
import {
  openMediaDeleteDialog,
  openMediaFilesDialog,
} from "../model/mediaActionDialog";
import { canDeleteMediaFiles } from "../model/mediaDeletion";

/** Return direct children: MUI Menu does not accept fragment children. */
export function renderMediaFileMenuItems({
  item,
  data,
  capabilities,
  onClose,
}: {
  item: MediaItemData;
  data?: MediaMetadata | null;
  capabilities: MediaActionCapabilities;
  onClose: () => void;
}) {
  if (!capabilities.canViewFiles) return [];
  return [
    <MenuItem
      key="files"
      onClick={() => {
        onClose();
        openMediaFilesDialog(item);
      }}
    >
      <ListItemIcon>
        <DescriptionOutlined fontSize="small" />
      </ListItemIcon>
      <ListItemText>File information…</ListItemText>
    </MenuItem>,
    capabilities.canDeleteFiles && (
      <MenuItem
        key="delete-files"
        sx={{ color: "error.main" }}
        disabled={!data || !canDeleteMediaFiles(data)}
        onClick={() => {
          onClose();
          if (data) openMediaDeleteDialog(data);
        }}
      >
        <ListItemIcon sx={{ color: "inherit" }}>
          <DeleteOutlineRounded fontSize="small" />
        </ListItemIcon>
        <ListItemText>Delete all files…</ListItemText>
      </MenuItem>
    ),
  ];
}
