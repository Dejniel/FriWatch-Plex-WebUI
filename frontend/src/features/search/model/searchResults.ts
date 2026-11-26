import type { MediaMetadata } from "entities/media/model";

export const SEARCH_TYPES = {
  all: "All results",
  movie: "Movies",
  show: "TV shows",
  season: "Seasons",
  episode: "Episodes",
  artist: "Artists",
  album: "Albums",
  track: "Tracks",
  photo: "Photos",
  photoalbum: "Photo albums",
  clip: "Videos",
  directory: "Categories",
} as const;
export type SearchType = keyof typeof SEARCH_TYPES;
export type SearchHit =
  | { kind: "media"; key: string; item: MediaMetadata }
  | {
      kind: "directory";
      key: string;
      path: string;
      title: string;
      sectionId: number;
      sectionTitle?: string;
    };
export interface SearchCursor {
  offset: number;
  limit: number;
  total: number;
}
export interface SearchPage {
  hits: SearchHit[];
  next: SearchCursor | null;
}
export interface SearchFilters {
  type: SearchType;
  library: string;
  year: string;
}

export function readSearchFilters(params: URLSearchParams): SearchFilters {
  const type = params.get("type") ?? "all";
  return {
    type: Object.hasOwn(SEARCH_TYPES, type) ? (type as SearchType) : "all",
    library: params.get("library") ?? "",
    year: params.get("year") ?? "",
  };
}

/** Invalid ranges must never silently broaden results. */
export function searchYears(value: string): readonly [number, number] | null {
  const match = value.trim().match(/^(\d{4})(?:\s*[-–]\s*(\d{4}))?$/);
  if (!match) return null;
  const from = Number(match[1]);
  const to = Number(match[2] ?? match[1]);
  return from >= 1000 && to >= from ? [from, to] : null;
}

export function selectSearchHits(
  pages: readonly SearchPage[],
  filters: SearchFilters,
) {
  const years = filters.year ? searchYears(filters.year) : null;
  const seen = new Set<string>();
  return pages
    .flatMap((page) => page.hits)
    .filter((hit) => {
      if (seen.has(hit.key)) return false;
      seen.add(hit.key);
      const type = hit.kind === "media" ? hit.item.type : "directory";
      const library =
        hit.kind === "media" ? hit.item.librarySectionID : hit.sectionId;
      if (filters.type !== "all" && type !== filters.type) return false;
      if (filters.library && String(library) !== filters.library) return false;
      if (!filters.year) return true;
      const year =
        hit.kind === "media"
          ? hit.item.type === "photo"
            ? Number(hit.item.originallyAvailableAt?.slice(0, 4)) ||
              hit.item.year ||
              0
            : hit.item.year || hit.item.parentYear || 0
          : 0;
      return Boolean(years && year >= years[0] && year <= years[1]);
    });
}

export function searchHitContext(hit: SearchHit) {
  if (hit.kind === "directory")
    return ["Category", hit.sectionTitle].filter(Boolean).join(" · ");
  return [SEARCH_TYPES[hit.item.type], hit.item.librarySectionTitle]
    .filter(Boolean)
    .join(" · ");
}
