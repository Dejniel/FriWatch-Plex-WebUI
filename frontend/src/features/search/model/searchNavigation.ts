import type { To } from "react-router-dom";
import {
  type AppLocation,
  libraryBrowseTo,
  mediaItemTo,
} from "shared/lib/navigation";
import type { SearchHit } from "./searchResults";

export const SEARCH_INPUT_ID = "search-results-query";

export function searchPageTo(query: string, params?: URLSearchParams) {
  const filters = new URLSearchParams();
  for (const key of ["type", "library", "year"]) {
    const value = params?.get(key);
    if (value) filters.set(key, value);
  }
  return {
    pathname: `/search/${encodeURIComponent(query.trim())}`,
    search: filters.size ? `?${filters}` : "",
  };
}

export function searchResultTo(
  location: AppLocation,
  hit: SearchHit,
  index?: number,
): To | null {
  if (hit.kind === "directory") return libraryBrowseTo(location, hit.path);
  if (hit.item.type !== "photo") return mediaItemTo(location, hit.item);
  // Photo preview retains its position in the current filtered result.
  const params = new URLSearchParams(location.search);
  params.set("photo", hit.item.ratingKey);
  params.set("photoIndex", String(index ?? 0));
  return { pathname: location.pathname, search: `?${params}` };
}

export function searchSuggestionTo(
  location: AppLocation,
  query: string,
  hit: SearchHit,
): To | null {
  if (hit.kind !== "media" || hit.item.type !== "photo")
    return searchResultTo(location, hit);
  return {
    ...searchPageTo(query),
    search: `?photo=${encodeURIComponent(hit.item.ratingKey)}`,
  };
}
