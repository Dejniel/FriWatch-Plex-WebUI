import { useEffect, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useActiveServerScope } from "features/session/model";
import { serverQueryClient } from "shared/api/queryClient";
import { searchPlex, searchSuggestions } from "../api/search";
import type { SearchCursor } from "./searchResults";

export function useSearchResults(query: string) {
  const scope = useActiveServerScope();
  return useInfiniteQuery(
    {
      queryKey: [
        "search",
        scope.serverId,
        scope.profileKey,
        "results",
        query.trim(),
      ],
      queryFn: ({ pageParam, signal }) =>
        searchPlex(query.trim(), pageParam, signal, scope),
      initialPageParam: null as SearchCursor | null,
      getNextPageParam: (page) => page.next,
      enabled: Boolean(query.trim() && scope.serverId && scope.profileKey),
      refetchOnWindowFocus: false,
    },
    serverQueryClient,
  );
}

export function usePlexSearch(query: string, delay = 500) {
  const normalized = query.trim();
  const [debounced, setDebounced] = useState("");
  const scope = useActiveServerScope();
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(normalized), delay);
    return () => window.clearTimeout(timer);
  }, [normalized, delay]);
  const active = normalized === debounced && Boolean(normalized);
  const result = useQuery(
    {
      queryKey: [
        "search",
        scope.serverId,
        scope.profileKey,
        "suggestions",
        normalized,
      ],
      queryFn: ({ signal }) => searchSuggestions(normalized, signal, scope),
      enabled: active && Boolean(scope.serverId && scope.profileKey),
    },
    serverQueryClient,
  );
  return {
    results: active ? (result.data ?? []) : [],
    loading: Boolean(normalized) && (!active || result.isPending),
    error:
      active && result.isError
        ? "Plex search is temporarily unavailable."
        : null,
  };
}
