import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  searchPlex,
  searchSuggestions,
  SearchResultsChangedError,
} from "../api/search";
import { serverQueryClient } from "shared/api/queryClient";
import { useSearchViewport } from "./useSearchViewport";
import { usePlexSearch } from "./usePlexSearch";
import type { SearchHit, SearchPage } from "./searchResults";

vi.mock("features/session/model", () => ({
  useActiveServerScope: () => scope,
}));
vi.mock("../api/search", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/search")>()),
  searchPlex: vi.fn(),
  searchSuggestions: vi.fn(),
}));
vi.mock("shared/lib/useVirtualGrid", () => ({
  useVirtualGrid: () => ({ range: { end: 16 } }),
}));
let scope = { serverId: "server", profileKey: "owner" };
let root: Root;
let state: ReturnType<typeof useSearchViewport>;
let quick: ReturnType<typeof usePlexSearch>;
const hit = (id: string, year = 1984): SearchHit => ({
  kind: "media",
  key: id,
  item: { ratingKey: id, title: id, type: "movie", year },
});
function View({
  year = "2021",
  preview = null,
}: {
  year?: string;
  preview?: string | null;
}) {
  state = useSearchViewport(
    "term",
    { type: "all", library: "", year },
    "poster",
    40,
    preview,
    false,
  );
  return null;
}
function Quick({ query }: { query: string }) {
  quick = usePlexSearch(query, 0);
  return null;
}
const flush = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 15));
  });
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  serverQueryClient.clear();
  scope = { serverId: "server", profileKey: "owner" };
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  serverQueryClient.clear();
  vi.unstubAllGlobals();
});

it("keeps searching past empty filtered pages and reports empty only when Plex is exhausted", async () => {
  let finish!: (page: SearchPage) => void;
  vi.mocked(searchPlex).mockImplementation(async (_, cursor) => {
    const offset = cursor?.offset ?? 0;
    if (offset < 128)
      return {
        hits: Array.from({ length: 64 }, (_, index) =>
          hit(String(offset + index)),
        ),
        next: { offset: offset + 64, limit: 256, total: 129 },
      };
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  await act(async () => root.render(<View />));
  await flush();
  await flush();
  await flush();
  expect(state.hits).toEqual([]);
  expect(state.range.totalSize).toBeNull();
  expect(searchPlex).toHaveBeenCalledTimes(3);
  await act(async () => finish({ hits: [hit("wanted", 2021)], next: null }));
  await flush();
  expect(state.hits.map((hit) => hit.key)).toEqual(["wanted"]);
  expect(state.range.totalSize).toBe(1);
  await act(async () => root.render(<View year="1984" />));
  await flush();
  expect(state.hits).toHaveLength(128);
  expect(searchPlex).toHaveBeenCalledTimes(3);
});

it("stops automatic paging after an error and retries from a fresh plan on a consistency failure", async () => {
  vi.mocked(searchPlex)
    .mockResolvedValueOnce({
      hits: [],
      next: { offset: 64, limit: 256, total: 140 },
    })
    .mockRejectedValueOnce(new SearchResultsChangedError());
  await act(async () => root.render(<View />));
  await flush();
  await flush();
  expect(searchPlex).toHaveBeenCalledTimes(2);
  expect(state.range.errors.get(0)?.retryable).toBe(true);
  await flush();
  expect(searchPlex).toHaveBeenCalledTimes(2);
  vi.mocked(searchPlex).mockResolvedValueOnce({
    hits: [hit("fresh", 2021)],
    next: null,
  });
  await act(async () => {
    await state.range.retry(0);
  });
  await flush();
  expect(vi.mocked(searchPlex).mock.calls.at(-1)?.[1]).toBeNull();
  expect(state.hits.map((hit) => hit.key)).toEqual(["fresh"]);
});

it("cancels an obsolete quick search and isolates results by profile", async () => {
  let oldSignal: AbortSignal | undefined;
  vi.mocked(searchSuggestions).mockImplementation(async (query, signal) => {
    if (query === "old") {
      oldSignal = signal;
      return new Promise(() => {});
    }
    return [hit(scope.profileKey)];
  });
  await act(async () => root.render(<Quick query="old" />));
  await flush();
  await act(async () => root.render(<Quick query="new" />));
  await flush();
  await flush();
  expect(oldSignal?.aborted).toBe(true);
  expect(quick.results.map((hit) => hit.key)).toEqual(["owner"]);
  scope = { ...scope, profileKey: "guest" };
  await act(async () => root.render(<Quick query="new" />));
  await flush();
  expect(quick.results.map((hit) => hit.key)).toEqual(["guest"]);
});

it("uses a contiguous photo projection across mixed results and loads the next photo", async () => {
  const photo = (id: string): SearchHit => ({
    kind: "media",
    key: id,
    item: { ratingKey: id, title: id, type: "photo", year: 2021 },
  });
  vi.mocked(searchPlex)
    .mockResolvedValueOnce({
      hits: [
        photo("one"),
        {
          kind: "directory",
          key: "category",
          title: "Category",
          path: "/library/sections/1/genre/3",
          sectionId: 1,
        },
        ...Array.from({ length: 62 }, (_, index) => hit(String(index), 2021)),
      ],
      next: { offset: 64, limit: 128, total: 65 },
    })
    .mockResolvedValueOnce({ hits: [photo("two")], next: null });
  await act(async () => root.render(<View year="" preview="one" />));
  await flush();
  await flush();
  expect(searchPlex).toHaveBeenCalledTimes(2);
  expect(
    [...state.photoRange.items].map(([index, item]) => [index, item.ratingKey]),
  ).toEqual([
    [0, "one"],
    [1, "two"],
  ]);
  expect(state.previewIndex).toBe(0);
  expect(state.photoPositions.get("two")).toBe(1);
});
