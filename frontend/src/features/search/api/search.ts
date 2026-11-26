import { capturePlexSession } from "features/session/model";
import {
  readMediaMetadata,
  getMediaMetadataBatch,
  type MediaScope,
} from "entities/media/model";
import { PlexClient } from "shared/api/PlexClient";
import {
  plexArray,
  plexContainer,
  plexInteger,
  plexObject,
  plexString,
  PlexResponseError,
} from "shared/api/plexResponse";
import { runPageRequest } from "shared/lib/requestLimiter";
import {
  SEARCH_TYPES,
  type SearchCursor,
  type SearchHit,
  type SearchPage,
} from "../model/searchResults";

export const SEARCH_PAGE_SIZE = 64;
const resource = "search results";
function searchSession(scope: MediaScope) {
  const session = capturePlexSession();
  if (
    session.scope?.serverId !== scope.serverId ||
    session.scope?.profileKey !== scope.profileKey
  )
    throw new Error("The active Plex session changed. Search again.");
  return session;
}
export class SearchResultsChangedError extends Error {
  constructor() {
    super("The search results changed. Retry to refresh the list.");
  }
}

export function readSearchHits(value: unknown): SearchHit[] {
  return plexArray(value, resource).flatMap<SearchHit>((value) => {
    const row = plexObject(value, resource);
    if (row.Metadata !== undefined) {
      const metadata = plexObject(row.Metadata, resource);
      // Other native search kinds (e.g. playlists) have their own response contract.
      if (
        typeof metadata.type !== "string" ||
        !Object.hasOwn(SEARCH_TYPES, metadata.type) ||
        metadata.type === "directory" ||
        metadata.type === "all"
      )
        return [];
      const item = readMediaMetadata(metadata);
      return [{ kind: "media", key: `media:${item.ratingKey}`, item }];
    }
    if (row.Directory !== undefined) {
      const directory = plexObject(row.Directory, resource);
      const path = plexString(directory.key, resource);
      const match = path.match(/^\/library\/sections\/(\d+)\//);
      if (!match) return [];
      return [
        {
          kind: "directory",
          key: `directory:${path}`,
          path,
          title: plexString(directory.tag ?? directory.title, resource),
          sectionId: Number(match[1]),
          ...(typeof directory.librarySectionTitle === "string" && {
            sectionTitle: directory.librarySectionTitle,
          }),
        },
      ];
    }
    return [];
  });
}

async function completeSearchHits(
  client: PlexClient,
  hits: SearchHit[],
  signal: AbortSignal,
) {
  const ids = hits.flatMap((hit) =>
    hit.kind === "media" && !hit.item.librarySectionID
      ? [hit.item.ratingKey]
      : [],
  );
  const metadata = await getMediaMetadataBatch(ids, signal, client);
  const byId = new Map(metadata.map((item) => [item.ratingKey, item]));
  return hits.map((hit) => {
    if (hit.kind !== "media" || hit.item.librarySectionID) return hit;
    const item = byId.get(hit.item.ratingKey);
    if (!item?.librarySectionID) throw new SearchResultsChangedError();
    return { ...hit, item };
  });
}

/** Plex caps candidates before ranking. Count without fetching metadata, then freeze the cap
 * across pages: increasing it mid-search changes the relevance order. */
export async function searchPlex(
  query: string,
  cursor: SearchCursor | null,
  signal: AbortSignal,
  scope: MediaScope,
): Promise<SearchPage> {
  const session = searchSession(scope);
  return runPageRequest(signal, 0, async (signal) => {
    session.assertCurrent(signal);
    const client = new PlexClient(() => session.token);
    const read = async (limit: number, offset: number, size: number) => {
      session.assertCurrent(signal);
      const params = new URLSearchParams({
        query,
        limit: String(limit),
        "X-Plex-Container-Start": String(offset),
        "X-Plex-Container-Size": String(size),
      });
      const container = plexContainer(
        await client.get(`/library/search?${params}`, signal),
        resource,
      );
      session.assertCurrent(signal);
      const total = plexInteger(container.totalSize, resource);
      const count = plexInteger(container.size, resource);
      if (plexInteger(container.offset, resource) !== offset || count > size)
        throw new PlexResponseError(resource);
      return { container, total, count };
    };
    let limit = cursor?.limit ?? SEARCH_PAGE_SIZE;
    let total = cursor?.total ?? 0;
    const offset = cursor?.offset ?? 0;
    if (!cursor) {
      for (;;) {
        total = (await read(limit, 0, 0)).total;
        if (total < limit) break;
        if (limit > 2 ** 29)
          throw new Error(
            "This search is too broad. Use a more specific search term.",
          );
        limit *= 2;
      }
    }
    if (!total) return { hits: [], next: null };
    const page = await read(limit, offset, SEARCH_PAGE_SIZE);
    if (page.total !== total) throw new SearchResultsChangedError();
    const rows = plexArray(page.container.SearchResult, resource);
    if (
      rows.length !== page.count ||
      (!page.count && offset < total) ||
      offset + page.count > total
    )
      throw new PlexResponseError(resource);
    const hits = await completeSearchHits(client, readSearchHits(rows), signal);
    session.assertCurrent(signal);
    return {
      hits,
      next:
        offset + page.count < total
          ? { offset: offset + page.count, limit, total }
          : null,
    };
  });
}

export async function searchSuggestions(
  query: string,
  signal: AbortSignal,
  scope: MediaScope,
) {
  const session = searchSession(scope);
  return runPageRequest(signal, 0, async (signal) => {
    session.assertCurrent(signal);
    const params = new URLSearchParams({ query, limit: "8" });
    const client = new PlexClient(() => session.token);
    const response = await client.get(`/library/search?${params}`, signal);
    session.assertCurrent(signal);
    const hits = await completeSearchHits(
      client,
      readSearchHits(plexContainer(response, resource).SearchResult),
      signal,
    );
    session.assertCurrent(signal);
    return hits;
  });
}
