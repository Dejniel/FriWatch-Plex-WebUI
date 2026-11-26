import type { MediaMetadata, MediaRendition } from "plex/media";

export function supportsMediaFiles(item: { ratingKey: string; type: string }) {
  return (
    /^\d+$/.test(item.ratingKey) &&
    ["movie", "episode", "track", "photo", "clip"].includes(item.type)
  );
}

/** File inventory groups all parts of a rendition, including multipart movies. */
export function mediaFileVersions(data: Pick<MediaMetadata, "Media">) {
  return (data.Media ?? []).map((media, index) => ({
    media,
    label: `Version ${index + 1}`,
    parts: media.Part ?? [],
  }));
}
export type MediaFileVersion = ReturnType<typeof mediaFileVersions>[number];

export function mediaFilename(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

export function formatMediaFileSize(bytes?: number) {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return null;
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = bytes
    ? Math.max(
        0,
        Math.min(
          Math.floor(Math.log(bytes) / Math.log(1024)),
          units.length - 1,
        ),
      )
    : 0;
  return `${(bytes / 1024 ** index).toFixed(index > 2 ? 1 : 0)} ${units[index]}`;
}

export function mediaFileFacts(media: MediaRendition): [string, string][] {
  const streams = (media.Part ?? []).flatMap((part) => part.Stream ?? []);
  const streamTitles = (type: 2 | 3) =>
    [
      ...new Set(
        streams
          .filter((stream) => stream.streamType === type)
          .map(
            (stream) =>
              stream.extendedDisplayTitle ||
              stream.displayTitle ||
              [stream.language, stream.codec?.toUpperCase()]
                .filter(Boolean)
                .join(" · "),
          )
          .filter(Boolean),
      ),
    ].join(", ");
  return [
    [
      "Resolution",
      media.width && media.height ? `${media.width} × ${media.height}` : "",
    ],
    ["Video", media.videoCodec?.toUpperCase()],
    ["Dynamic range", media.videoDynamicRange],
    ["Video profile", media.videoProfile],
    ["Container", media.container?.toUpperCase()],
    [
      "Bitrate",
      media.bitrate ? `${(media.bitrate / 1000).toFixed(1)} Mb/s` : "",
    ],
    ["Frame rate", media.videoFrameRate],
    [
      "Audio",
      streamTitles(2) ||
        [
          media.audioCodec?.toUpperCase(),
          media.audioChannels ? `${media.audioChannels} channels` : "",
        ]
          .filter(Boolean)
          .join(" · "),
    ],
    ["Subtitles", streamTitles(3) || (media.videoCodec ? "None" : "")],
    [
      "Total size",
      media.Part?.length && media.Part.every((part) => part.size !== undefined)
        ? formatMediaFileSize(
            media.Part.reduce((size, part) => size + part.size!, 0),
          )
        : "",
    ],
    ["Camera", [media.make, media.model].filter(Boolean).join(" ")],
    ["Lens", media.lens],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));
}
