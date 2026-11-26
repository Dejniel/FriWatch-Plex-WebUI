import {
  MovieOutlined,
  MusicNoteRounded,
  PhotoOutlined,
  TvRounded,
  VideoLibraryOutlined,
} from "@mui/icons-material";

export function MediaTypePlaceholder({
  type,
  size = "clamp(38px, 6vw, 72px)",
}: {
  type: string;
  size?: string | number;
}) {
  const Icon = ["show", "season", "episode"].includes(type)
    ? TvRounded
    : ["artist", "album", "track"].includes(type)
      ? MusicNoteRounded
      : ["photo", "photoalbum"].includes(type)
        ? PhotoOutlined
        : ["movie", "video"].includes(type)
          ? MovieOutlined
          : VideoLibraryOutlined;
  return <Icon sx={{ fontSize: size }} />;
}
