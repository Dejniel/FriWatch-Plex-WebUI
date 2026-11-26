import { SearchRounded } from "@mui/icons-material";
import {
  alpha,
  Backdrop,
  Box,
  Button,
  CircularProgress,
  IconButton,
  InputAdornment,
  Popper,
  TextField,
  Typography,
} from "@mui/material";
import { getTranscodeImageURL } from "entities/media/model";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { searchHitContext } from "../model/searchResults";
import {
  SEARCH_INPUT_ID,
  searchPageTo,
  searchSuggestionTo,
} from "../model/searchNavigation";
import { usePlexSearch } from "../model/usePlexSearch";

interface SearchBarProps {
  enableShortcut?: boolean;
  inDrawer?: boolean;
  onResultSelected?: () => void;
}

export default function SearchBar(props: SearchBarProps) {
  const location = useLocation();
  if (
    location.pathname === "/search" ||
    location.pathname.startsWith("/search/")
  ) {
    return (
      <IconButton
        aria-label="Focus search"
        onClick={() => {
          props.onResultSelected?.();
          requestAnimationFrame(() =>
            document.getElementById(SEARCH_INPUT_ID)?.focus(),
          );
        }}
      >
        <SearchRounded />
      </IconButton>
    );
  }
  return <QuickSearch {...props} />;
}

function QuickSearch({
  enableShortcut = true,
  inDrawer = false,
  onResultSelected,
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const search = usePlexSearch(anchor ? query : "");
  const results = search.results;
  const open = Boolean(anchor);
  const close = () => {
    inputRef.current?.blur();
    setAnchor(null);
  };
  const complete = () => {
    close();
    onResultSelected?.();
  };
  useEffect(() => setSelectedIndex(null), [query, results]);
  useEffect(() => {
    if (!enableShortcut) return;
    const listener = (event: KeyboardEvent) => {
      if (event.key !== "f" || !event.ctrlKey) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [enableShortcut]);
  const allResults = searchPageTo(query);
  return (
    <>
      <Backdrop open={open} sx={{ zIndex: 10000 }} onClick={close} />
      <TextField
        inputRef={inputRef}
        placeholder="Search"
        size="small"
        value={query}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchRounded />
              </InputAdornment>
            ),
          },
          htmlInput: {
            "aria-label": "Search",
            role: "combobox",
            "aria-expanded": open && Boolean(query.trim()),
            "aria-controls": "quick-search-results",
            "aria-autocomplete": "list",
            "aria-activedescendant":
              selectedIndex === null
                ? undefined
                : `quick-search-${selectedIndex}`,
          },
        }}
        onKeyDown={(event) => {
          if (event.key === "Tab") {
            setAnchor(null);
            return;
          }
          if (event.key === "Escape") {
            close();
            return;
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!results.length) return;
            setSelectedIndex((current) =>
              event.key === "ArrowDown"
                ? current === null
                  ? 0
                  : Math.min(current + 1, results.length - 1)
                : current === null
                  ? results.length - 1
                  : current === 0
                    ? null
                    : current - 1,
            );
          }
          if (event.key === "Enter" && query.trim()) {
            event.preventDefault();
            const selected =
              selectedIndex === null ? null : results[selectedIndex];
            navigate(
              selected
                ? (searchSuggestionTo(location, query, selected) ?? allResults)
                : allResults,
            );
            complete();
          }
        }}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={(event) => setAnchor(event.currentTarget)}
        sx={{
          bgcolor: "#121212AA",
          zIndex: 11000,
          width: inDrawer ? "100%" : "clamp(160px, 20vw, 320px)",
        }}
      />
      <Popper
        anchorEl={anchor}
        open={open && Boolean(query.trim())}
        placement="bottom-end"
        sx={{
          bgcolor: "background.paper",
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 1,
          p: 1,
          width: inDrawer ? 280 : "clamp(280px, 30vw, 440px)",
          maxWidth: "calc(100vw - 24px)",
          zIndex: 11000,
        }}
      >
        <Box
          id="quick-search-results"
          role="listbox"
          aria-label="Quick search results"
        >
          {search.loading && (
            <Box sx={{ p: 2, textAlign: "center" }}>
              <CircularProgress size={24} />
            </Box>
          )}
          {search.error && (
            <Typography sx={{ p: 1 }} color="error">
              {search.error}
            </Typography>
          )}
          {!search.loading && !search.error && !results.length && (
            <Typography sx={{ p: 1 }}>No results</Typography>
          )}
          {results.map((hit, index) => {
            const target = searchSuggestionTo(location, query, hit);
            if (!target) return null;
            const item = hit.kind === "media" ? hit.item : null;
            return (
              <Box
                component={Link}
                to={target}
                key={hit.key}
                id={`quick-search-${index}`}
                role="option"
                aria-selected={selectedIndex === index}
                tabIndex={-1}
                onClick={complete}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1.5,
                  p: 1,
                  borderRadius: 1,
                  color: "inherit",
                  textDecoration: "none",
                  bgcolor:
                    selectedIndex === index
                      ? (theme) => alpha(theme.palette.primary.main, 0.14)
                      : undefined,
                  "&:hover": { bgcolor: "action.hover" },
                }}
              >
                {item?.thumb && (
                  <Box
                    component="img"
                    src={getTranscodeImageURL(item.thumb, 80, 80)}
                    alt=""
                    sx={{
                      width: 40,
                      height: 40,
                      objectFit: "cover",
                      borderRadius: 0.5,
                    }}
                  />
                )}
                <Box sx={{ minWidth: 0 }}>
                  <Typography noWrap>
                    {item?.title ?? (hit.kind === "directory" ? hit.title : "")}
                  </Typography>
                  <Typography noWrap variant="caption" color="text.secondary">
                    {searchHitContext(hit)}
                  </Typography>
                </Box>
              </Box>
            );
          })}
        </Box>
        <Button
          component={Link}
          to={allResults}
          onClick={complete}
          fullWidth
          sx={{ mt: 1 }}
        >
          View all results
        </Button>
      </Popper>
    </>
  );
}
