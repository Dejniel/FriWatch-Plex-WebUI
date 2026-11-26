import { InfiniteData } from "@tanstack/react-query";
import { createQueryClient } from "shared/api/queryClient";
import { applySearchChanges } from "./searchSynchronization";
import type { SearchPage } from "./searchResults";
const scope = { serverId: "server", profileKey: "owner" };
const item = {
  ratingKey: "1",
  title: "Title",
  type: "movie" as const,
  year: 2021,
  viewCount: 0,
};
const page: SearchPage = {
  hits: [{ kind: "media", key: "media:1", item }],
  next: null,
};
it("patches canonical display changes in both search surfaces without changing rank", async () => {
  const client = createQueryClient();
  const key = ["search", scope.serverId, scope.profileKey, "results", "term"];
  const quick = [
    "search",
    scope.serverId,
    scope.profileKey,
    "suggestions",
    "term",
  ];
  client.setQueryData(key, { pages: [page], pageParams: [null] });
  client.setQueryData(quick, page.hits);
  await applySearchChanges(client, [
    {
      change: {
        ...scope,
        kind: "item",
        effect: "metadata",
        id: "1",
        fields: ["viewCount"],
      },
      update: { item: null, metadata: { ...item, viewCount: 1 } },
    },
  ]);
  const data = client.getQueryData<InfiniteData<SearchPage>>(key)!;
  expect(data.pages[0].hits[0]).toMatchObject({ item: { viewCount: 1 } });
  expect(client.getQueryData(quick)).toEqual(data.pages[0].hits);
  expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  client.clear();
});
it("invalidates membership-affecting changes only for the active scope, ignoring list edits", async () => {
  const client = createQueryClient();
  const key = ["search", scope.serverId, scope.profileKey, "results", "term"];
  const other = ["search", scope.serverId, "guest", "results", "term"];
  for (const query of [key, other])
    client.setQueryData(query, { pages: [page], pageParams: [null] });
  await applySearchChanges(client, [
    { change: { ...scope, kind: "list", listKind: "playlist", id: "1" } },
  ]);
  expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  await applySearchChanges(client, [
    {
      change: {
        ...scope,
        kind: "item",
        effect: "metadata",
        id: "2",
        fields: ["title"],
      },
    },
  ]);
  expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  expect(client.getQueryState(other)?.isInvalidated).toBe(false);
  client.clear();
});
