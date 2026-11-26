import { ContentCopyRounded } from "@mui/icons-material";
import { Box, IconButton, Tooltip, Typography } from "@mui/material";
import { useState } from "react";
import { copyText } from "shared/lib/clipboard";
import { mediaFilename } from "../model/mediaFiles";

export function MediaSourcePath({
  path,
  kind = "file",
}: {
  path: string;
  kind?: "file" | "folder";
}) {
  const name =
    mediaFilename(kind === "folder" ? path.replace(/[\\/]+$/, "") : path) ||
    path;
  const [message, setMessage] = useState<string | null>(null);
  return (
    <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>
          {name}
        </Typography>
        <Typography
          component="code"
          variant="body2"
          sx={{
            display: "block",
            color: "text.secondary",
            overflowWrap: "anywhere",
            userSelect: "text",
          }}
        >
          {path}
        </Typography>
        {message && (
          <Typography role="status" variant="caption">
            {message}
          </Typography>
        )}
      </Box>
      <Tooltip
        title={kind === "folder" ? "Copy folder path" : "Copy file path"}
      >
        <IconButton
          aria-label={`Copy path for ${name}`}
          size="small"
          onClick={() =>
            void copyText(path).then(
              () => setMessage("Path copied."),
              () =>
                setMessage(
                  "Could not copy. Select the path to copy it manually.",
                ),
            )
          }
        >
          <ContentCopyRounded fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
