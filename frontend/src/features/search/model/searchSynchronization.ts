import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import type { ReconciledMediaChange } from "entities/media/model";
import type { SearchHit, SearchPage } from "./searchResults";

type SearchData = SearchHit[] | InfiniteData<SearchPage>;
const stableFields = new Set([
  "viewCount",
  "viewOffset",
  "viewedLeafCount",
  "lastViewedAt",
  "userRating",
  "audienceRating",
  "rating",
  "thumb",
  "art",
]);

/** Search owns membership/ranking. Canonical display-only changes can patch an existing hit. */
export async function applySearchChanges(
  client: QueryClient,
  changes: readonly ReconciledMediaChange[],
) {
  const relevant = changes.filter(({ change }) => change.kind !== "list");
  if (!relevant.length) return;
  const scope = relevant[0].change;
  const membershipChanged = relevant.some(
    ({ change }) =>
      change.kind !== "item" ||
      change.effect !== "metadata" ||
      change.fields.some((field) => !stableFields.has(field)),
  );
  const replacements = new Map(
    relevant.flatMap(({ change, update }) =>
      change.kind === "item" && update?.metadata
        ? [[change.id, update.metadata] as const]
        : [],
    ),
  );
  const patch = (hit: SearchHit): SearchHit =>
    hit.kind === "media" && replacements.has(hit.item.ratingKey)
      ? { ...hit, item: replacements.get(hit.item.ratingKey)! }
      : hit;
  await Promise.all(
    client
      .getQueryCache()
      .findAll({ queryKey: ["search", scope.serverId, scope.profileKey] })
      .map(async (query) => {
        const data = query.state.data as SearchData | undefined;
        const hits = !data
          ? []
          : Array.isArray(data)
            ? data
            : data.pages.flatMap((page) => page.hits);
        const missingCanonical = relevant.some(
          ({ change, update }) =>
            change.kind === "item" &&
            !update?.metadata &&
            hits.some(
              (hit) => hit.kind === "media" && hit.item.ratingKey === change.id,
            ),
        );
        const filter = { queryKey: query.queryKey, exact: true };
        if (membershipChanged || missingCanonical) {
          await client.cancelQueries(filter);
          await client.invalidateQueries(filter, { throwOnError: true });
          return;
        }
        if (
          !hits.some(
            (hit) =>
              hit.kind === "media" && replacements.has(hit.item.ratingKey),
          )
        )
          return;
        await client.cancelQueries(filter);
        client.setQueryData<SearchData>(query.queryKey, (current) =>
          !current
            ? current
            : Array.isArray(current)
              ? current.map(patch)
              : {
                  ...current,
                  pages: current.pages.map((page) => ({
                    ...page,
                    hits: page.hits.map(patch),
                  })),
                },
        );
      }),
  );
}
