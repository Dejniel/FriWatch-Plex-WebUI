import { useEffect, useMemo } from "react";
import {
  type MediaItemData,
  mediaCardAspectRatio,
  mediaCardWidth,
  MEDIA_CARD_FOOTER_HEIGHT,
  MEDIA_ROW_HEIGHT,
} from "entities/media/model";
import type { MediaArtworkLayout } from "entities/media/model";
import { useVirtualGrid } from "shared/lib/useVirtualGrid";
import type { CollectionRange } from "shared/ui/CollectionViewport";
import { photoGalleryGeometry } from "features/photos/model";
import {
  selectSearchHits,
  type SearchFilters,
  type SearchHit,
} from "./searchResults";
import { useSearchResults } from "./usePlexSearch";
import { SEARCH_PAGE_SIZE, SearchResultsChangedError } from "../api/search";

export function useSearchViewport(
  query: string,
  filters: SearchFilters,
  cardLayout: MediaArtworkLayout,
  size: number,
  previewId: string | null,
  information: boolean,
) {
  const search = useSearchResults(query);
  const { type, library, year } = filters;
  const { data, hasNextPage, isFetching, isError, fetchNextPage } = search;
  const hits = useMemo(
    () => selectSearchHits(data?.pages ?? [], { type, library, year }),
    [data, type, library, year],
  );
  const list = ["all", "track", "directory"].includes(filters.type);
  const photos = filters.type === "photo";
  const layout = ["artist", "album", "photoalbum"].includes(filters.type)
    ? "square"
    : photos
      ? "landscape"
      : cardLayout;
  const grid = useVirtualGrid({
    count: hits.length + (search.hasNextPage || search.isPending ? 1 : 0),
    resetKey: JSON.stringify([
      query,
      filters.type,
      filters.library,
      filters.year,
    ]),
    ...(list
      ? { layout: "list", itemHeight: MEDIA_ROW_HEIGHT }
      : photos
        ? photoGalleryGeometry(size, information)
        : {
            itemWidth: mediaCardWidth(layout, size),
            imageAspectRatio: mediaCardAspectRatio(layout),
            footerHeight: MEDIA_CARD_FOOTER_HEIGHT,
          }),
  });
  const photoHits = useMemo(
    () =>
      hits.flatMap((hit) =>
        hit.kind === "media" && hit.item.type === "photo" ? [hit] : [],
      ),
    [hits],
  );
  const previewIndex = previewId
    ? photoHits.findIndex((hit) => hit.item.ratingKey === previewId)
    : -1;
  const needsMore =
    grid.range.end >= hits.length ||
    Boolean(
      previewId &&
      (previewIndex === -1 || previewIndex >= photoHits.length - 1),
    );
  useEffect(() => {
    if (needsMore && hasNextPage && !isFetching && !isError)
      void fetchNextPage();
  }, [needsMore, data, hasNextPage, isFetching, isError, fetchNextPage]);
  const items = useMemo(
    () => new Map(hits.map((hit, index) => [index, hit])),
    [hits],
  );
  const photoItems = useMemo(
    () =>
      new Map<number, MediaItemData>(
        photoHits.map((hit, index) => [index, hit.item]),
      ),
    [photoHits],
  );
  const errors = new Map<number, { message: string; retryable: boolean }>();
  if (search.error) {
    errors.set(0, { message: search.error.message, retryable: true });
    errors.set(Math.floor(hits.length / SEARCH_PAGE_SIZE) * SEARCH_PAGE_SIZE, {
      message: search.error.message,
      retryable: true,
    });
  }
  const retry = () =>
    search.isFetchNextPageError &&
    !(search.error instanceof SearchResultsChangedError)
      ? search.fetchNextPage()
      : search.refetch();
  const range: CollectionRange<SearchHit> = {
    items,
    errors,
    pageSize: SEARCH_PAGE_SIZE,
    totalSize: search.data && !search.hasNextPage ? hits.length : null,
    retry,
  };
  return {
    search,
    hits,
    list,
    photos,
    layout,
    grid,
    range,
    previewIndex,
    photoPositions: new Map(photoHits.map((hit, index) => [hit.key, index])),
    photoRange: { ...range, items: photoItems },
  };
}
