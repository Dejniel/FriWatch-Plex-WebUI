import { Alert, Box, Grid, Paper, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { MediaMetadata } from "plex/media";
import {
  formatMediaFileSize,
  mediaFileFacts,
  mediaFileVersions,
  type MediaFileVersion,
} from "../model/mediaFiles";
import { MediaSourcePath } from "./MediaSourcePath";

/** Read-only inventory; feature-owned callbacks supply permitted operations. */
export function MediaFiles({
  data,
  renderActions,
}: {
  data: MediaMetadata;
  renderActions?: (version: MediaFileVersion) => ReactNode;
}) {
  const versions = mediaFileVersions(data);
  if (!versions.length)
    return (
      <Alert severity="info">
        Plex did not provide any media files for this item.
      </Alert>
    );
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 3,
        width: "100%",
        minWidth: 0,
      }}
    >
      {versions.map((version, index) => (
        <Paper
          key={version.media.id ?? index}
          variant="outlined"
          sx={{ p: { xs: 2, sm: 3 }, minWidth: 0 }}
        >
          <Box
            sx={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 1,
              mb: 2,
            }}
          >
            <Typography variant="h6">{version.label}</Typography>
            {renderActions?.(version)}
          </Box>
          <Grid container spacing={2.5} sx={{ mb: 3 }}>
            {mediaFileFacts(version.media).map(([label, value]) => (
              <Grid key={label} size={{ xs: 6, sm: 6, md: 3 }}>
                <Typography variant="caption" color="text.secondary">
                  {label}
                </Typography>
                <Typography sx={{ overflowWrap: "anywhere" }}>
                  {value}
                </Typography>
              </Grid>
            ))}
          </Grid>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {version.parts.map((part, partIndex) => (
              <Box key={part.id ?? partIndex}>
                {version.parts.length > 1 && (
                  <Typography variant="caption" color="text.secondary">
                    Part {partIndex + 1}
                  </Typography>
                )}
                {part.file ? (
                  <MediaSourcePath path={part.file} />
                ) : (
                  <Typography color="text.secondary">
                    File path unavailable.
                  </Typography>
                )}
                <Typography variant="body2" color="text.secondary">
                  {formatMediaFileSize(part.size) ?? "Unknown size"}
                </Typography>
              </Box>
            ))}
          </Box>
        </Paper>
      ))}
    </Box>
  );
}
