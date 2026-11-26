import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { notifyManager } from "@tanstack/react-query";
import {
  AuthStorage,
  useAuthSession,
  useServerSession,
} from "features/session/model";
import {
  type MediaMetadata,
  applyMediaMetadataChanges,
  mediaMetadataQueryKey,
} from "entities/media/model";
import { ProxiedRequest } from "shared/api/backend";
import { serverQueryClient } from "shared/api/queryClient";
import { MediaActionDialogHost } from "./MediaActionDialogHost";
import ActionableMediaCard from "./ActionableMediaCard";
import {
  closeMediaActionDialog,
  openMediaWatchedDialog,
  openMetadataDialog,
  openMetadataUnmatchDialog,
  openMetadataMatchDialog,
  openMediaFilesDialog,
  openMediaDeleteDialog,
  useMediaActionDialog,
} from "../model/mediaActionDialog";

vi.mock("shared/api/backend", () => ({
  ProxiedRequest: vi.fn(),
  getBackendURL: () => "",
}));
vi.mock("features/watchlist/public", () => ({
  WatchlistButton: () => null,
  WatchlistMenuItem: () => null,
}));
vi.mock("entities/media/model/useMediaPreview", () => ({
  useMediaPreview: () => ({
    extra: null,
    visible: false,
    onPlaying: vi.fn(),
    stop: vi.fn(),
  }),
}));
const transport = vi.mocked(ProxiedRequest);
const movie = {
  ratingKey: "12",
  title: "Movie",
  type: "movie",
  viewCount: 0,
} as MediaMetadata;
const scope = { serverId: "server", profileKey: "1:2" };
let root: Root;
let container: HTMLDivElement;
const button = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === text,
  )!;
const dialog = () => document.querySelector('[role="dialog"]');
const click = async (text: string) => {
  expect(button(text)).toBeTruthy();
  await act(async () => button(text).click());
};
function deferred() {
  let resolve!: (response: { status: number; data: unknown }) => void;
  const promise = new Promise<{ status: number; data: unknown }>(
    (finish) => (resolve = finish),
  );
  return { promise, resolve };
}
const render = async (card = false) =>
  act(async () =>
    root.render(
      <StrictMode>
        <MemoryRouter>
          {card && <ActionableMediaCard item={movie} />}
          <MediaActionDialogHost />
        </MemoryRouter>
      </StrictMode>,
    ),
  );
beforeAll(() => notifyManager.setScheduler(queueMicrotask));
afterAll(() =>
  notifyManager.setScheduler((callback) => setTimeout(callback, 0)),
);
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  serverQueryClient.clear();
  useMediaActionDialog.setState({ selection: null });
  AuthStorage.saveActiveSession({
    profile: null,
    accountToken: "account",
    serverToken: "token",
  });
  useAuthSession.setState({
    status: "ready",
    revision: 1,
    ownerUser: { id: 1 } as Plex.UserData,
    activeUser: { id: 2, restricted: true } as Plex.UserData,
    activeProfile: {
      id: 2,
      title: "Managed",
      isOwner: false,
      restricted: true,
      protected: false,
    },
  });
  useServerSession.setState({
    server: { machineIdentifier: "server" } as Plex.ServerPreferences,
    canManageServer: false,
  });
  transport.mockResolvedValue({ status: 200, data: {} });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  useMediaActionDialog.setState({ selection: null });
  serverQueryClient.clear();
  vi.unstubAllGlobals();
});

it("keeps a card's confirmation and pending write alive after the virtualized card unmounts", async () => {
  await render(true);
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        '[aria-label="More actions for Movie"]',
      )!
      .click(),
  );
  const watched = [
    ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((item) => item.textContent?.includes("Mark as Watched"))!;
  await act(async () => watched.click());
  expect(dialog()?.textContent).toContain('"Movie" as watched');
  expect(transport).not.toHaveBeenCalled();
  const selection = useMediaActionDialog.getState().selection;
  expect(selection).toMatchObject({
    kind: "watched",
    items: [{ ratingKey: "12", type: "movie", title: "Movie" }],
  });
  expect(selection?.kind === "watched" ? selection.items[0] : null).toEqual({
    ratingKey: "12",
    type: "movie",
    title: "Movie",
  });
  const request = deferred();
  transport.mockReturnValue(request.promise);
  await act(async () => {
    button("Confirm").click();
    button("Confirm").click();
  });
  expect(transport).toHaveBeenCalledTimes(1);
  expect(button("Updating…").disabled).toBe(true);
  expect(button("Cancel").disabled).toBe(true);
  await render();
  expect(dialog()).not.toBeNull();
  expect(transport.mock.calls[0][4]?.aborted).toBe(false);
  await act(async () => request.resolve({ status: 200, data: {} }));
  expect(useMediaActionDialog.getState().selection).toBeNull();
});

it("keeps a failed write in the dialog, retries it and renders canonical metadata without a watched mirror", async () => {
  const key = mediaMetadataQueryKey(scope, "12");
  serverQueryClient.setQueryData(key, movie);
  await render(true);
  await act(async () => openMediaWatchedDialog([movie], true));
  transport.mockResolvedValueOnce({ status: 403, data: {} });
  await click("Confirm");
  expect(dialog()?.textContent).toContain("HTTP 403");
  expect(button("Cancel").disabled).toBe(false);
  expect(serverQueryClient.getQueryData(key)).toEqual(movie);
  await click("Retry");
  expect(transport).toHaveBeenCalledTimes(2);
  expect(useMediaActionDialog.getState().selection).toBeNull();
  expect(serverQueryClient.getQueryData(key)).toEqual(movie);
  await act(async () =>
    applyMediaMetadataChanges(serverQueryClient, [
      {
        change: { ...scope, kind: "item", effect: "unknown", id: "12" },
        update: {
          item: {
            ratingKey: "12",
            guid: "local://12",
            type: "movie",
            title: "Canonical title",
            viewCount: 1,
          },
          metadata: { ...movie, title: "Canonical title", viewCount: 1 },
        },
      },
    ]),
  );
  expect(container.textContent).toContain("Canonical title");
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        '[aria-label="More actions for Canonical title"]',
      )!
      .click(),
  );
  const menu = document.querySelector('[role="menu"]')!;
  expect(menu.textContent).toContain("Mark as Unwatched");
});

it("retries only failed batch IDs and reports progress to the selection owner", async () => {
  await render();
  const progress = vi.fn();
  await act(async () =>
    openMediaWatchedDialog(
      [movie, { ...movie, ratingKey: "13", title: "Second" }],
      false,
      progress,
    ),
  );
  transport.mockImplementation(async (path) => ({
    status: path.includes("key=13&") ? 503 : 200,
    data: {},
  }));
  await click("Confirm");
  expect(progress).toHaveBeenCalledWith(["13"]);
  expect(dialog()?.textContent).toContain("1 item as unwatched");
  transport.mockResolvedValue({ status: 200, data: {} });
  await click("Retry");
  expect(
    transport.mock.calls.map(([path]) =>
      new URL(path, "https://plex.test").searchParams.get("key"),
    ),
  ).toEqual(["12", "13", "13"]);
  expect(progress).toHaveBeenLastCalledWith([]);
  expect(useMediaActionDialog.getState().selection).toBeNull();
});

it("allows watched actions without administrator access, while metadata editing remains protected", async () => {
  await render();
  await act(async () => openMetadataDialog(movie));
  expect(useMediaActionDialog.getState().selection).toBeNull();
  await act(async () => openMediaWatchedDialog([movie], true));
  await click("Confirm");
  expect(transport).toHaveBeenCalledTimes(1);
});

it("rejects a delayed confirmation after a token change before the host rerenders", async () => {
  await render();
  await act(async () => openMediaWatchedDialog([movie], true));
  AuthStorage.saveActiveSession({
    profile: null,
    accountToken: "other",
    serverToken: "other",
  });
  await click("Confirm");
  expect(transport).not.toHaveBeenCalled();
  // Token/status/revision changes close the host on its next session notification.
  await act(async () => useAuthSession.setState({ revision: 2 }));
  expect(useMediaActionDialog.getState().selection).toBeNull();
});

it("cancels a pending write on session change and ignores its late completion", async () => {
  await render();
  const progress = vi.fn();
  await act(async () => openMediaWatchedDialog([movie], true, progress));
  const request = deferred();
  transport.mockReturnValue(request.promise);
  await click("Confirm");
  const signal = transport.mock.calls[0][4];
  await act(async () =>
    useAuthSession.setState({ status: "selectingProfile" }),
  );
  expect(signal?.aborted).toBe(true);
  expect(useMediaActionDialog.getState().selection).toBeNull();
  await act(async () => request.resolve({ status: 200, data: {} }));
  expect(progress).not.toHaveBeenCalled();
});

it("cancels a replaced workflow without closing the new dialog", async () => {
  await render();
  const oldProgress = vi.fn();
  await act(async () => openMediaWatchedDialog([movie], true, oldProgress));
  const old = useMediaActionDialog.getState().selection;
  const request = deferred();
  transport.mockReturnValueOnce(request.promise);
  await click("Confirm");
  await act(async () =>
    openMediaWatchedDialog(
      [{ ...movie, ratingKey: "13", title: "Next" }],
      false,
    ),
  );
  const replacement = useMediaActionDialog.getState().selection;
  await act(async () => closeMediaActionDialog(old));
  expect(useMediaActionDialog.getState().selection).toBe(replacement);
  expect(transport.mock.calls[0][4]?.aborted).toBe(true);
  await act(async () => request.resolve({ status: 200, data: {} }));
  expect(oldProgress).not.toHaveBeenCalled();
  expect(dialog()?.textContent).toContain('"Next" as unwatched');
  await click("Confirm");
  expect(useMediaActionDialog.getState().selection).toBeNull();
});

it("waits for Unmatch to finish and keeps failures available for retry", async () => {
  useAuthSession.setState({
    activeUser: { id: 2, restricted: false } as Plex.UserData,
  });
  useServerSession.setState({ canManageServer: true });
  await render();
  await act(async () => openMetadataUnmatchDialog(movie));
  const request = deferred();
  transport.mockReturnValueOnce(request.promise);
  await click("Confirm");
  expect(button("Unmatching…").disabled).toBe(true);
  expect(dialog()).not.toBeNull();
  await act(async () => request.resolve({ status: 503, data: {} }));
  expect(dialog()?.textContent).toContain("503");
  await click("Retry");
  expect(transport.mock.calls.map(([path, method]) => [path, method])).toEqual([
    ["/library/metadata/12/unmatch", "PUT"],
    ["/library/metadata/12/unmatch", "PUT"],
  ]);
  expect(useMediaActionDialog.getState().selection).toBeNull();
});

it("cancels a confirmation before any write", async () => {
  await render();
  await act(async () => openMediaWatchedDialog([movie], true));
  await click("Cancel");
  expect(transport).not.toHaveBeenCalled();
  expect(useMediaActionDialog.getState().selection).toBeNull();
});

const fileMovie: MediaMetadata = {
  ...movie,
  Media: [
    { id: 100, videoCodec: "hevc", Part: [{ id: 110, file: "/Movies/Example/4k.mkv", size: 100 }] },
    { id: 200, videoCodec: "h264", Part: [{ id: 210, file: "/Movies/Example/1080p.mp4", size: 50 }] },
  ],
};
function deletionOwner() {
  useAuthSession.setState({ activeUser: { id: 1, restricted: false } as Plex.UserData,
    activeProfile: { id: 1, title: "Owner", isOwner: true, restricted: false, protected: false },
  });
  useServerSession.setState({ canManageServer: true,
    server: { machineIdentifier: "server", allowMediaDeletion: true } as Plex.ServerPreferences,
  });
}

it("shows every source version above Fix Match and copies the selected path", async () => {
  deletionOwner();
  transport.mockImplementation(async (path) => {
    const pathname = new URL(path, "https://plex.test").pathname;
    const data =
      pathname === "/system/agents"
        ? { Agent: [] }
        : pathname.endsWith("/matches")
          ? {
              SearchResult: [
                { guid: "plex://movie/correct", name: "Correct film" },
              ],
            }
          : { Metadata: [fileMovie] };
    return { status: 200, data: { MediaContainer: data } };
  });
  const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  try {
    await render();
    await act(async () =>
      openMetadataMatchDialog({ ...movie, guid: "plex://movie/current" }),
    );
    const sources = dialog()!.querySelector('[aria-label="Source files"]')!;
    expect(sources.textContent).toContain("/Movies/Example/4k.mkv");
    expect(sources.textContent).toContain("/Movies/Example/1080p.mp4");
    expect(
      sources.compareDocumentPosition(dialog()!.querySelector("form")!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(button("Fix Match").disabled).toBe(false);
    await act(async () =>
      sources
        .querySelector<HTMLButtonElement>(
          '[aria-label="Copy path for 1080p.mp4"]',
        )!
        .click(),
    );
    expect(writeText).toHaveBeenCalledWith("/Movies/Example/1080p.mp4");
    expect(sources.textContent).toContain("Path copied.");
  } finally {
    if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
    else Reflect.deleteProperty(navigator, "clipboard");
  }
});

it.each([
  { ...movie, type: "show" as const },
  { ...movie, type: "artist" as const },
  { ...movie, type: "album" as const },
])("shows Plex-provided source folders when matching a $type", async (item) => {
  deletionOwner();
  transport.mockImplementation(async (path) => {
    const pathname = new URL(path, "https://plex.test").pathname;
    const data =
      pathname === "/system/agents"
        ? { Agent: [] }
        : pathname.endsWith("/matches")
          ? { SearchResult: [] }
          : {
              Metadata: [
                { ...item, Location: [{ path: "/media/Source folder/" }] },
              ],
            };
    return { status: 200, data: { MediaContainer: data } };
  });
  await render();
  await act(async () => openMetadataMatchDialog(item));
  const sources = dialog()!.querySelector('[aria-label="Source folders"]')!;
  expect(sources.textContent).toContain("/media/Source folder/");
  expect(
    sources.querySelector('[aria-label="Copy path for Source folder"]'),
  ).not.toBeNull();
});

it("opens file information for a restricted profile without exposing deletion", async () => {
  transport.mockResolvedValue({ status: 200, data: { MediaContainer: { Metadata: [fileMovie] } } });
  await render();
  await act(async () => openMediaFilesDialog(movie));
  expect(dialog()?.textContent).toContain("/Movies/Example/4k.mkv");
  expect(dialog()?.textContent).toContain("/Movies/Example/1080p.mp4");
  expect(button("Delete all files…")).toBeUndefined();
});

it("shows the exact files, waits for deletion, and reopens the surviving version", async () => {
  deletionOwner();
  let current: MediaMetadata | null = fileMovie;
  const pending = deferred();
  transport.mockImplementation(async (path, method) => {
    if (path === "/") return { status: 200, data: { MediaContainer: { machineIdentifier: "server", allowMediaDeletion: true } } };
    if (method === "DELETE") return pending.promise;
    return { status: 200, data: { MediaContainer: { Metadata: [current] } } };
  });
  await render();
  await act(async () => openMediaFilesDialog(movie));
  await click("Delete this version…");
  expect(dialog()?.textContent).toContain("/Movies/Example/4k.mkv");
  expect(dialog()?.textContent).not.toContain("/Movies/Example/1080p.mp4");
  expect(dialog()?.textContent).toContain("deleted from disk");
  await click("Delete");
  expect(dialog()?.textContent).toContain("Deleting…");
  expect(button("Cancel").disabled).toBe(true);
  await act(async () => {
    current = { ...fileMovie, Media: [fileMovie.Media![1]] };
    pending.resolve({ status: 200, data: {} });
  });
  expect(dialog()?.textContent).toContain("File information");
  expect(dialog()?.textContent).toContain("/Movies/Example/1080p.mp4");
  expect(dialog()?.textContent).not.toContain("/Movies/Example/4k.mkv");
  expect(transport.mock.calls.filter(([, method]) => method === "DELETE").map(([path]) => path))
    .toEqual(["/library/metadata/12/media/100"]);
});

it("keeps a failed deletion open for an explicit retry", async () => {
  deletionOwner();
  transport.mockImplementation(async (path, method) => {
    if (path === "/") return { status: 200, data: { MediaContainer: { machineIdentifier: "server", allowMediaDeletion: true } } };
    if (method === "DELETE") return { status: 403, data: {} };
    return { status: 200, data: { MediaContainer: { Metadata: [fileMovie] } } };
  });
  await render();
  await act(async () => openMediaDeleteDialog(fileMovie));
  await click("Delete");
  expect(dialog()?.textContent).toContain("403");
  expect(button("Retry")).toBeTruthy();
  expect(transport.mock.calls.filter(([, method]) => method === "DELETE")).toHaveLength(1);
});

it("closes a deletion immediately when the owner profile changes", async () => {
  deletionOwner();
  const pending = deferred();
  transport.mockImplementation(async (path, method) => {
    if (path === "/") return { status: 200, data: { MediaContainer: { machineIdentifier: "server", allowMediaDeletion: true } } };
    if (method === "DELETE") return pending.promise;
    return { status: 200, data: { MediaContainer: { Metadata: [fileMovie] } } };
  });
  await render();
  await act(async () => openMediaDeleteDialog(fileMovie));
  await click("Delete");
  await act(async () => useAuthSession.setState({ revision: 2 }));
  expect(dialog()).toBeNull();
  await act(async () => pending.resolve({ status: 200, data: {} }));
  expect(useMediaActionDialog.getState().selection).toBeNull();
});

it("closes the deleted item's details while preserving unrelated library filters", async () => {
  deletionOwner();
  let removed = false;
  transport.mockImplementation(async (path, method) => {
    if (path === "/") return { status: 200, data: { MediaContainer: { machineIdentifier: "server", allowMediaDeletion: true } } };
    if (method === "DELETE") { removed = true; return { status: 200, data: {} }; }
    return removed ? { status: 404, data: {} } : { status: 200, data: { MediaContainer: { Metadata: [fileMovie] } } };
  });
  function Location() {
    const location = useLocation();
    return <output>{location.pathname}{location.search}</output>;
  }
  await act(async () => root.render(<MemoryRouter initialEntries={["/browse/1?view=browse&mid=12&detailsTab=media"]}>
    <MediaActionDialogHost /><Location />
  </MemoryRouter>));
  await act(async () => openMediaDeleteDialog(fileMovie));
  expect(dialog()?.textContent).toContain("4k.mkv");
  expect(dialog()?.textContent).toContain("1080p.mp4");
  await click("Delete");
  expect(dialog()).toBeNull();
  expect(container.querySelector("output")?.textContent).toBe("/browse/1?view=browse");
});
