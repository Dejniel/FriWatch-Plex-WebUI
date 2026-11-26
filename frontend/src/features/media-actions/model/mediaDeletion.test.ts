import type { MediaMetadata } from "entities/media/model";
import { canDeleteMediaFiles, mediaDeletionTarget } from "./mediaDeletion";

const item: MediaMetadata = {
  ratingKey: "1",
  title: "Example",
  type: "movie",
  Media: [
    {
      id: 10,
      Part: [
        { id: 11, file: "/Movies/one.mkv" },
        { id: 12, file: "/Movies/two.mkv" },
      ],
    },
  ],
};
it("snapshots every part without retaining mutable metadata", () => {
  const source = structuredClone(item);
  const target = mediaDeletionTarget(source, 10);
  source.Media![0].Part![0].file = "/Movies/replacement.mkv";
  expect(target.versions[0].parts.map((part) => part.file)).toEqual([
    "/Movies/one.mkv",
    "/Movies/two.mkv",
  ]);
});
it.each(["show", "season", "album", "artist", "photoalbum"])(
  "does not offer recursive deletion for a %s",
  (type) => {
    expect(canDeleteMediaFiles({ ...item, type } as MediaMetadata)).toBe(false);
  },
);
it.each(["path", "part-id", "media-id", "duplicate", "empty", "remote-id"])(
  "rejects an incomplete or ambiguous inventory: %s",
  (missing) => {
    const source = structuredClone(item);
    if (missing === "path") delete source.Media![0].Part![0].file;
    if (missing === "part-id") delete source.Media![0].Part![0].id;
    if (missing === "media-id") delete source.Media![0].id;
    if (missing === "duplicate") source.Media![0].Part![1].id = 11;
    if (missing === "empty") source.Media = [];
    if (missing === "remote-id") source.ratingKey = "plex://movie/1";
    expect(canDeleteMediaFiles(source)).toBe(false);
  },
);
it("selects a version by Plex ID and refuses a missing or duplicated ID", () => {
  expect(mediaDeletionTarget(item, 10).versions).toHaveLength(1);
  expect(canDeleteMediaFiles(item, 99)).toBe(false);
  expect(
    canDeleteMediaFiles(
      { ...item, Media: [item.Media![0], item.Media![0]] },
      10,
    ),
  ).toBe(false);
});
