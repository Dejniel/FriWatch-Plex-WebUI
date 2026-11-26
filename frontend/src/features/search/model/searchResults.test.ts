import {
  readSearchFilters,
  searchYears,
  selectSearchHits,
  type SearchHit,
  type SearchPage,
} from "./searchResults";
const media = (
  id: string,
  year: number,
  type = "movie",
  library = 1,
): SearchHit =>
  ({
    kind: "media",
    key: id,
    item: { ratingKey: id, type, title: id, year, librarySectionID: library },
  }) as SearchHit;
const filters = { type: "all" as const, year: "", library: "" };
it("preserves Plex relevance, deduplicating repeated media in place", () => {
  const movie = media("m", 2021),
    episode = media("e", 2021, "episode");
  expect(
    selectSearchHits([{ hits: [movie, episode, movie], next: null }], filters),
  ).toEqual([movie, episode]);
});
it("finds a year match beyond the first 100 results", () => {
  const first = Array.from({ length: 128 }, (_, i) => media(String(i), 1984));
  const wanted = media("last", 2021);
  const pages: SearchPage[] = [
    { hits: first, next: { offset: 128, limit: 256, total: 129 } },
    { hits: [wanted], next: null },
  ];
  expect(selectSearchHits(pages, { ...filters, year: "2021" })).toEqual([
    wanted,
  ]);
});
it("combines type, library and a year range", () => {
  const wanted = media("album", 1987, "album", 3);
  expect(
    selectSearchHits(
      [
        {
          hits: [
            media("other", 1987),
            media("wrong-year", 2021, "album", 3),
            wanted,
          ],
          next: null,
        },
      ],
      { type: "album", library: "3", year: "1980–1989" },
    ),
  ).toEqual([wanted]);
});
it("uses photo capture dates and never interprets invalid ranges as all years", () => {
  const photo: SearchHit = {
    kind: "media",
    key: "photo",
    item: {
      ratingKey: "photo",
      type: "photo",
      title: "Photo",
      originallyAvailableAt: "2021-08-10",
    },
  };
  expect(
    selectSearchHits([{ hits: [photo], next: null }], {
      ...filters,
      year: "2021",
    }),
  ).toEqual([photo]);
  expect(
    selectSearchHits([{ hits: [photo], next: null }], {
      ...filters,
      year: "2022-2020",
    }),
  ).toEqual([]);
});
it("validates years and URL types", () => {
  expect(searchYears("1980-1989")).toEqual([1980, 1989]);
  expect(searchYears("2021")).toEqual([2021, 2021]);
  expect(searchYears("0")).toBeNull();
  expect(
    readSearchFilters(new URLSearchParams("type=toString&year=2021")),
  ).toEqual({ ...filters, year: "2021" });
});

it("filters tracks by their album year and photos by capture year", () => {
  const track: SearchHit = {
    kind: "media",
    key: "track",
    item: { ratingKey: "t", type: "track", title: "Track", parentYear: 2021 },
  };
  const photo: SearchHit = {
    kind: "media",
    key: "photo",
    item: {
      ratingKey: "p",
      type: "photo",
      title: "Photo",
      year: 2026,
      originallyAvailableAt: "2021-08-10",
    },
  };
  expect(
    selectSearchHits([{ hits: [track, photo], next: null }], {
      ...filters,
      year: "2021",
    }),
  ).toEqual([track, photo]);
});
