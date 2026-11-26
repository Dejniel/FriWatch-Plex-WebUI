import type { MediaMetadata } from "entities/media/model";
import { Box, Typography } from "@mui/material";
import { MediaFilesPanel } from "features/media-actions/public";

export default function TitleMedia({ data }: { data: MediaMetadata }) {
  if (!data.Media?.length)
    return (
      <Typography color="text.secondary">
        Technical details are available on individual episodes.
      </Typography>
    );
  return (
    <Box sx={{ width: "100%" }}>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 3 }}>
        Media files
      </Typography>
      <MediaFilesPanel data={data} />
    </Box>
  );
}
