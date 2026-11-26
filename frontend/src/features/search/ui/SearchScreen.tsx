import { SearchRounded } from "@mui/icons-material";
import {
  Box,
  Button,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { MEDIA_ROW_HEIGHT } from "entities/media/model";
import { MediaCard } from "entities/media/public";
import {
  ActionableMediaCard,
  MediaItemMenu,
} from "features/media-actions/public";
import { MusicMediaCard } from "features/music/public";
import { PhotoGalleryView, PhotoViewer } from "features/photos/public";
import {
  LibraryCardViewControls,
  useLibraryCardView,
} from "features/library/public";
import { CollectionViewport } from "shared/ui/CollectionViewport";
import { CONTENT_COLUMN_WIDTH, PAGE_GUTTER } from "shared/ui/layout";
import {
  readSearchFilters,
  searchHitContext,
  type SearchHit,
} from "../model/searchResults";
import {
  SEARCH_INPUT_ID,
  searchPageTo,
  searchResultTo,
} from "../model/searchNavigation";
import { useSearchViewport } from "../model/useSearchViewport";
import { SearchFilters } from "./SearchFilters";

export default function SearchScreen() {
  const { query = "" } = useParams();
  const [draft, setDraft] = useState(query);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  useEffect(() => setDraft(query), [query]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === "f") {
        event.preventDefault();
        document.getElementById(SEARCH_INPUT_ID)?.focus();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  const filters = readSearchFilters(params);
  return (
    <Box sx={{ mt: "64px", px: PAGE_GUTTER, pt: { xs: 3, md: 4 }, pb: 6 }}>
      <Typography variant="h4" component="h1" sx={{ mb: 3 }}>
        Search
      </Typography>
      <Box
        component="form"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          navigate(searchPageTo(draft, params));
        }}
        sx={{ mb: 3, maxWidth: "48rem" }}
      >
        <Stack direction="row" spacing={1}>
          <TextField
            id={SEARCH_INPUT_ID}
            label="Search"
            placeholder="Titles, people, artists…"
            value={draft}
            fullWidth
            onChange={(event) => setDraft(event.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchRounded />
                  </InputAdornment>
                ),
              },
            }}
          />
          <Button type="submit" variant="contained" disabled={!draft.trim()}>
            Search
          </Button>
        </Stack>
      </Box>
      <SearchFilters
        filters={filters}
        onChange={(key, value) => {
          const next = new URLSearchParams(params);
          if (value && !(key === "type" && value === "all"))
            next.set(key, value);
          else next.delete(key);
          for (const field of [
            "photo",
            "photoIndex",
            "mid",
            "pguid",
            "detailsTab",
          ])
            next.delete(field);
          setParams(next);
        }}
      />
      {query.trim() ? (
        <SearchResults query={query} />
      ) : (
        <Typography color="text.secondary" sx={{ mt: 5 }}>
          Find films, shows, music and photos across your Plex libraries.
        </Typography>
      )}
    </Box>
  );
}

function SearchResults({ query }: { query: string }) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const filters = readSearchFilters(params);
  const cards = useLibraryCardView();
  const [information, setInformation] = useState(false);
  const view = useSearchViewport(
    query,
    filters,
    cards.layout,
    cards.size,
    params.get("photo"),
    information,
  );
  const { search, hits, grid, range } = view;
  useEffect(() => {
    if (
      view.previewIndex < 0 ||
      params.get("photoIndex") === String(view.previewIndex)
    )
      return;
    const next = new URLSearchParams(params);
    next.set("photoIndex", String(view.previewIndex));
    setParams(next, {
      replace: true,
      state: location.state,
      preventScrollReset: true,
    });
  }, [params, setParams, view.previewIndex, location.state]);
  return (
    <Box sx={{ mt: 3, maxWidth: view.list ? CONTENT_COLUMN_WIDTH : undefined }}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        sx={{
          alignItems: { sm: "center" },
          justifyContent: "space-between",
          gap: 2,
          mb: 2,
        }}
      >
        <Typography color="text.secondary" role="status" sx={{ flexShrink: 0 }}>
          {search.isPending
            ? "Searching…"
            : `${hits.length.toLocaleString()} ${hits.length === 1 ? "result" : "results"}${search.hasNextPage ? " so far" : ""}`}
          {search.isFetchingNextPage ? " · Searching more results…" : ""}
        </Typography>
        {!view.list && (
          <Box sx={{ width: { xs: "100%", sm: 360 } }}>
            <LibraryCardViewControls
              layout={view.layout}
              size={cards.size}
              onSizeChange={cards.setSize}
              onSizeCommit={cards.saveSize}
              onLayoutChange={cards.setLayout}
              showOrientation={[
                "movie",
                "show",
                "season",
                "episode",
                "clip",
              ].includes(filters.type)}
            />
          </Box>
        )}
      </Stack>
      {view.photos ? (
        <PhotoGalleryView
          grid={grid}
          range={range}
          hasData={Boolean(search.data)}
          information={information}
          onInformationChange={setInformation}
          itemKey={(hit) => hit.key}
          getItem={(hit) => (hit.kind === "media" ? hit.item : undefined)}
        />
      ) : (
        <CollectionViewport
          grid={grid}
          range={range}
          hasData={Boolean(search.data)}
          itemKey={(hit) => hit.key}
          emptyMessage="No results match your search and filters."
          renderItem={(hit, index, imageSizes) => (
            <SearchResult
              hit={hit}
                index={view.photoPositions.get(hit.key) ?? index}
              list={view.list}
              layout={view.layout}
              imageSizes={imageSizes}
            />
          )}
        />
      )}
      {params.get("photo") && <PhotoViewer range={view.photoRange} />}
    </Box>
  );
}

function SearchResult({
  hit,
  index,
  list,
  layout,
  imageSizes,
}: {
  hit: SearchHit;
  index: number;
  list: boolean;
  layout: "landscape" | "poster" | "square";
  imageSizes: string;
}) {
  const location = useLocation();
  const to = searchResultTo(location, hit, index);
  if (hit.kind === "directory")
    return (
      <Box
        component={Link}
        to={to!}
        sx={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          height: MEDIA_ROW_HEIGHT,
          px: 1,
          borderRadius: 1,
          textDecoration: "none",
          color: "inherit",
          "&:hover": { bgcolor: "action.hover" },
        }}
      >
        <Typography sx={{ fontWeight: 600 }}>{hit.title}</Typography>
        <Typography variant="body2" color="text.secondary">
          {searchHitContext(hit)}
        </Typography>
      </Box>
    );
  const props = {
    item: hit.item,
    to,
    context: list ? searchHitContext(hit) : undefined,
    presentation: list ? ("list" as const) : ("grid" as const),
    layout,
    imageSizes,
    imageLoading: "eager" as const,
  };
  if (["artist", "album", "track"].includes(hit.item.type))
    return <MusicMediaCard {...props} />;
  if (["photo", "photoalbum"].includes(hit.item.type))
    return (
      <MediaCard
        {...props}
        overlayActions={<MediaItemMenu item={hit.item} />}
      />
    );
  return <ActionableMediaCard {...props} />;
}
