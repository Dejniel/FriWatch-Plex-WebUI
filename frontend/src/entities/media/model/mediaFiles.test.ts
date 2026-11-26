import {
  formatMediaFileSize,
  mediaFileFacts,
  mediaFileVersions,
  mediaFilename,
} from "./mediaFiles";

it("keeps multipart inventory grouped without requiring playback keys", () => {
  const versions = mediaFileVersions({
    Media: [
      {
        id: 1,
        Part: [
          { id: 2, file: "/one" },
          { id: 3, file: "/two" },
        ],
      },
    ],
  });
  expect(versions).toHaveLength(1);
  expect(versions[0].parts.map((part) => part.file)).toEqual(["/one", "/two"]);
});
it("handles Windows and Unix file paths", () => {
  expect(mediaFilename("C:\\Movies\\Film.mkv")).toBe("Film.mkv");
  expect(mediaFilename("/media/Film.mkv")).toBe("Film.mkv");
});
it("distinguishes unknown size from an empty file", () => {
  expect(formatMediaFileSize(undefined)).toBeNull();
  expect(formatMediaFileSize(0)).toBe("0 B");
  expect(formatMediaFileSize(1024 ** 3)).toBe("1.0 GB");
});
it("does not invent video dimensions for music or photos with missing data", () => {
  const video = mediaFileFacts({ videoProfile: "main 10" });
  expect(video).toContainEqual(["Video profile", "main 10"]);
  expect(video.map(([label]) => label)).not.toContain("Dynamic range");
  const audio = mediaFileFacts({ audioCodec: "flac", audioChannels: 2 });
  expect(audio).toContainEqual(["Audio", "FLAC · 2 channels"]);
  expect(audio.map(([label]) => label)).not.toContain("Resolution");
  const photo = mediaFileFacts({
    make: "Camera",
    model: "Model",
    width: 4000,
    height: 3000,
  });
  expect(photo).toContainEqual(["Camera", "Camera Model"]);
  expect(photo).toContainEqual(["Resolution", "4000 × 3000"]);
});
