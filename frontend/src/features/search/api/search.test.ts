import { capturePlexSession } from "features/session/model";
import { PlexClient } from "shared/api/PlexClient";
import { readSearchHits, searchPlex, searchSuggestions } from "./search";

vi.mock("features/session/model", () => ({ capturePlexSession: vi.fn() }));
const metadata = (id: number, type = "movie") => ({
  Metadata: {
    ratingKey: String(id),
    type,
    title: `Title ${id}`,
    year: 2021,
    librarySectionID: 9,
  },
});
const scope = { serverId: "server", profileKey: "owner" };
let current: boolean;
let read: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  current = true;
  vi.mocked(capturePlexSession).mockReturnValue({
    token: "test-token",
    scope,
    assertCurrent: (signal?: AbortSignal) => {
      signal?.throwIfAborted();
      if (!current) throw new Error("Session changed");
    },
  } as ReturnType<typeof capturePlexSession>);
  read = vi
    .spyOn(PlexClient.prototype, "get")
    .mockImplementation(async (url) => {
      const params = new URL(url, "http://plex").searchParams;
      const limit = Number(params.get("limit"));
      const offset = Number(params.get("X-Plex-Container-Start"));
      const size = Number(params.get("X-Plex-Container-Size"));
      const totalSize = Math.min(limit, 140);
      const rows = Array.from(
        { length: Math.min(size, Math.max(0, totalSize - offset)) },
        (_, index) => metadata(offset + index),
      );
      return {
        MediaContainer: {
          size: rows.length,
          offset,
          totalSize,
          SearchResult: rows,
        },
      };
    });
});
afterEach(() => vi.restoreAllMocks());
const signal = () => new AbortController().signal;

it("discovers all candidates using count-only probes, freezes ranking parameters, and pages beyond 100", async () => {
  const first = await searchPlex("Alien & Aliens", null, signal(), scope);
  expect(first.hits).toHaveLength(64);
  expect(first.next).toEqual({ offset: 64, total: 140, limit: 256 });
  const second = await searchPlex(
    "Alien & Aliens",
    first.next,
    signal(),
    scope,
  );
  const third = await searchPlex(
    "Alien & Aliens",
    second.next,
    signal(),
    scope,
  );
  expect(third.hits).toHaveLength(12);
  expect(third.next).toBeNull();
  const requests: URLSearchParams[] = read.mock.calls.map(
    ([url]: [string]) => new URL(url, "http://plex").searchParams,
  );
  expect(
    requests.map((params) => [
      params.get("limit"),
      params.get("X-Plex-Container-Size"),
    ]),
  ).toEqual([
    ["64", "0"],
    ["128", "0"],
    ["256", "0"],
    ["256", "64"],
    ["256", "64"],
    ["256", "64"],
  ]);
  expect(
    requests.every(
      (params) =>
        params.get("query") === "Alien & Aliens" && !params.has("searchTypes"),
    ),
  ).toBe(true);
});

it("returns empty results without an unnecessary content request", async () => {
  read.mockResolvedValue({
    MediaContainer: { size: 0, offset: 0, totalSize: 0 },
  });
  await expect(searchPlex("absent", null, signal(), scope)).resolves.toEqual({
    hits: [],
    next: null,
  });
  expect(read).toHaveBeenCalledTimes(1);
});

it("rejects changed totals rather than mixing different rankings", async () => {
  await expect(
    searchPlex("term", { offset: 64, limit: 256, total: 139 }, signal(), scope),
  ).rejects.toThrow("results changed");
});

it("rejects malformed or stalled pages", async () => {
  read.mockResolvedValue({
    MediaContainer: { size: 0, offset: 64, totalSize: 140 },
  });
  await expect(
    searchPlex("term", { offset: 64, limit: 256, total: 140 }, signal(), scope),
  ).rejects.toThrow("invalid search");
});

it("does not publish results after a profile change or cancellation", async () => {
  read.mockImplementation(async () => {
    current = false;
    return { MediaContainer: { size: 0, offset: 0, totalSize: 0 } };
  });
  await expect(searchPlex("term", null, signal(), scope)).rejects.toThrow(
    "Session changed",
  );
  const controller = new AbortController();
  controller.abort();
  await expect(
    searchPlex("term", null, controller.signal, scope),
  ).rejects.toThrow();
});

it("keeps quick suggestions bounded and supports all media contracts", async () => {
  read.mockResolvedValue({
    MediaContainer: {
      SearchResult: [
        metadata(1, "artist"),
        metadata(2, "album"),
        metadata(3, "track"),
        metadata(4, "photo"),
        metadata(5, "episode"),
      ],
    },
  });
  expect(await searchSuggestions("term", signal(), scope)).toHaveLength(5);
  expect(read.mock.calls[0][0]).toBe("/library/search?query=term&limit=8");
});

it("decodes safe native category paths, skips unsupported kinds, and rejects broken known media", () => {
  expect(
    readSearchHits([
      { Directory: { key: "/library/sections/3/actor/7", tag: "Actor" } },
      metadata(2, "playlist"),
    ]),
  ).toEqual([
    {
      kind: "directory",
      key: "directory:/library/sections/3/actor/7",
      path: "/library/sections/3/actor/7",
      title: "Actor",
      sectionId: 3,
    },
  ]);
  expect(
    readSearchHits([
      { Directory: { key: "https://elsewhere/", title: "Unsafe" } },
    ]),
  ).toEqual([]);
  expect(() =>
    readSearchHits([{ Metadata: { type: "movie", ratingKey: "1" } }]),
  ).toThrow();
});

it("advances source offsets across unsupported rows rather than stalling a filtered page", async () => {
  read.mockResolvedValue({
    MediaContainer: {
      size: 1,
      offset: 64,
      totalSize: 140,
      SearchResult: [metadata(64, "playlist")],
    },
  });
  await expect(
    searchPlex("term", { offset: 64, limit: 256, total: 140 }, signal(), scope),
  ).resolves.toEqual({
    hits: [],
    next: { offset: 65, limit: 256, total: 140 },
  });
});

it("resolves missing library IDs in one batch and keeps the search ranking", async () => {
  read.mockImplementation(async (url: string) =>
    url.startsWith("/library/metadata/")
      ? {
          MediaContainer: {
            size: 2,
            Metadata: [metadata(2).Metadata, metadata(1).Metadata],
          },
        }
      : {
          MediaContainer: {
            SearchResult: [1, 2].map((id) => ({
              Metadata: {
                ratingKey: String(id),
                type: "movie",
                title: `Title ${id}`,
              },
            })),
          },
        },
  );
  const results = await searchSuggestions("term", signal(), scope);
  expect(
    results.map((hit) =>
      hit.kind === "media"
        ? [hit.item.ratingKey, hit.item.librarySectionID]
        : null,
    ),
  ).toEqual([
    ["1", 9],
    ["2", 9],
  ]);
  expect(read).toHaveBeenCalledTimes(2);
  expect(read.mock.calls[1][0]).toBe("/library/metadata/1,2");
});

it("rejects an obsolete query scope before starting a read with a new profile token", async () => {
  await expect(
    searchSuggestions("term", signal(), {
      ...scope,
      profileKey: "old-profile",
    }),
  ).rejects.toThrow("session changed");
  expect(read).not.toHaveBeenCalled();
});
