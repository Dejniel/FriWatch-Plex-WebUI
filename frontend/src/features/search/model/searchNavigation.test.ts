import { searchPageTo, searchResultTo } from "./searchNavigation";
import type { SearchHit } from "./searchResults";
const location = { pathname: "/search/term", search: "?type=movie&year=2021" };
const media = (type: string): SearchHit =>
  ({
    kind: "media",
    key: "42",
    item: {
      ratingKey: "42",
      title: "Title",
      type,
      librarySectionID: 3,
      grandparentRatingKey: "6",
      parentRatingKey: "7",
    },
  }) as SearchHit;
it("opens video details and preserves the search context", () => {
  expect(searchResultTo(location, media("movie"))).toMatchObject({
    pathname: location.pathname,
    search: "?type=movie&year=2021&mid=42",
  });
});
it("uses native category paths instead of assuming every match is a genre", () => {
  expect(
    searchResultTo(location, {
      kind: "directory",
      key: "actor",
      path: "/library/sections/3/actor/7",
      title: "Actor",
      sectionId: 3,
    }),
  ).toMatchObject({
    search: "?type=movie&year=2021&bkey=%2Flibrary%2Fsections%2F3%2Factor%2F7",
  });
});
it("opens music containers, track albums, video clips and photos correctly", () => {
  expect(searchResultTo(location, media("artist"))).toEqual({
    pathname: "/browse/3/item/42",
  });
  expect(searchResultTo(location, media("track"))).toEqual({
    pathname: "/browse/3/item/7",
  });
  expect(searchResultTo(location, media("clip"))).toBe("/watch/42");
  expect(searchResultTo(location, media("photo"), 8)).toMatchObject({
    search: "?type=movie&year=2021&photo=42&photoIndex=8",
  });
});
it("encodes queries and carries only result filters to a new search", () => {
  expect(
    searchPageTo(
      "Alien & Aliens",
      new URLSearchParams("type=movie&mid=42&year=2021"),
    ),
  ).toEqual({
    pathname: "/search/Alien%20%26%20Aliens",
    search: "?type=movie&year=2021",
  });
});
