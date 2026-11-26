import { Box, Stack, Typography } from "@mui/material";
import { StarRounded } from "@mui/icons-material";
import { Link, useLocation } from "react-router-dom";
import { useImageLoading, imageFadeSx } from "shared/ui/useImageLoading";
import { mediaItemTo } from "shared/lib/navigation";
import {
  formatMediaRating,
  getPrimaryMediaRating,
} from "../model/mediaRatings";
import { MEDIA_ROW_HEIGHT, mediaArtworkPath } from "../model/mediaArtwork";
import { mediaCardText } from "../model/mediaCardText";
import { getTranscodeImageURL } from "../model/mediaImages";
import { MediaTypePlaceholder } from "./MediaTypePlaceholder";
import type { MediaCardProps } from "./MediaCard";

/** A detail row shares the same action owner as the corresponding media card. */
export function MediaRow({
  item,
  PlexTvSource,
  overlayActions,
  onContextMenu,
  to,
  context,
}: MediaCardProps) {
  const location = useLocation();
  const artwork = mediaArtworkPath(item, "poster");
  const square = ["artist", "album", "track", "photo", "photoalbum"].includes(
    item.type,
  );
  const src = artwork
    ? getTranscodeImageURL(artwork, 120, square ? 120 : 180)
    : null;
  const { status, imageProps } = useImageLoading(src);
  const text = mediaCardText(item, "landscape");
  const rating = getPrimaryMediaRating(item);
  const target =
    to === undefined ? mediaItemTo(location, item, PlexTvSource) : to;
  return (
    <Stack
      direction="row"
      role="listitem"
      onContextMenu={onContextMenu}
      sx={{
        height: MEDIA_ROW_HEIGHT,
        alignItems: "center",
        gap: { xs: 1, sm: 2 },
        px: 1,
        borderRadius: 1,
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      <Box
        {...(target ? { component: Link, to: target } : {})}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          flex: 1,
          minWidth: 0,
          textDecoration: "none",
          color: "inherit",
        }}
      >
        <Box
          sx={{
            width: 40,
            height: square ? 40 : 60,
            flexShrink: 0,
            borderRadius: 0.5,
            overflow: "hidden",
            bgcolor: "action.hover",
            color: "text.disabled",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {src && status !== "missing" ? (
            <Box
              component="img"
              key={src}
              src={src}
              alt=""
              loading="eager"
              decoding="async"
              {...imageProps}
              sx={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                ...imageFadeSx(status === "loaded"),
              }}
            />
          ) : (
            <MediaTypePlaceholder type={item.type} size="1.5rem" />
          )}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography noWrap sx={{ fontWeight: 600 }}>
            {text.title}
          </Typography>
          <Typography noWrap variant="body2" color="text.secondary">
            {[context, text.subtitle].filter(Boolean).join(" · ")}
          </Typography>
        </Box>
      </Box>
      {rating && (
        <Stack
          direction="row"
          sx={{
            alignItems: "center",
            gap: 0.5,
            display: { xs: "none", md: "flex" },
          }}
        >
          <StarRounded fontSize="small" color="warning" />
          <Typography variant="body2">
            {formatMediaRating(rating.value)}
          </Typography>
        </Stack>
      )}
      <Stack
        direction="row"
        sx={{ gap: 0.5, alignItems: "center", flexShrink: 0 }}
      >
        {overlayActions}
      </Stack>
    </Stack>
  );
}
