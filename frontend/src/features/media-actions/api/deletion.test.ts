import {
  AuthStorage,
  capturePlexSession,
  useAuthSession,
  useServerSession,
} from "features/session/model";
import { publishMediaChange, type MediaMetadata } from "entities/media/model";
import { ProxiedRequest } from "shared/api/backend";
import { mediaDeletionTarget } from "../model/mediaDeletion";
import { createMediaDeletion } from "./deletion";

vi.mock("shared/api/backend", () => ({
  ProxiedRequest: vi.fn(),
  getBackendURL: () => "",
}));
vi.mock("entities/media/model/mediaChanges", async (original) => ({
  ...(await original<typeof import("entities/media/model/mediaChanges")>()),
  publishMediaChange: vi.fn(),
}));
const movie: MediaMetadata = {
  ratingKey: "12",
  type: "movie",
  title: "Multipart",
  librarySectionID: 1,
  Media: [
    {
      id: 100,
      videoCodec: "hevc",
      Part: [
        { id: 110, file: "/Movies/Multipart/part1.mkv", size: 100 },
        { id: 111, file: "/Movies/Multipart/part2.mkv", size: 200 },
      ],
    },
    {
      id: 200,
      videoCodec: "h264",
      Part: [{ id: 210, file: "/Movies/Multipart/1080p.mp4", size: 50 }],
    },
  ],
};
const transport = vi.mocked(ProxiedRequest);
let current: MediaMetadata | null;
let allowed: boolean;
const deletes = () =>
  transport.mock.calls.filter(([, method]) => method === "DELETE");
const reply = () =>
  current
    ? { status: 200, data: { MediaContainer: { Metadata: [current] } } }
    : { status: 404, data: {} };
const create = (mediaId?: number) =>
  createMediaDeletion(
    capturePlexSession(),
    mediaDeletionTarget(movie, mediaId),
  );
const signal = () => new AbortController().signal;

beforeEach(() => {
  vi.resetAllMocks();
  current = structuredClone(movie);
  allowed = true;
  AuthStorage.saveActiveSession({
    profile: null,
    accountToken: "account",
    serverToken: "original-token",
  });
  useAuthSession.setState({
    status: "ready",
    revision: 1,
    ownerUser: { id: 1 } as Plex.UserData,
    activeUser: { id: 1, restricted: false } as Plex.UserData,
    activeProfile: {
      id: 1,
      title: "Owner",
      isOwner: true,
      protected: false,
      restricted: false,
    },
  });
  useServerSession.setState({
    canManageServer: true,
    server: {
      machineIdentifier: "server",
      allowMediaDeletion: true,
    } as Plex.ServerPreferences,
  });
  transport.mockImplementation(async (path, method) => {
    if (path === "/")
      return {
        status: 200,
        data: {
          MediaContainer: {
            machineIdentifier: "server",
            allowMediaDeletion: allowed,
          },
        },
      };
    if (method === "DELETE") {
      const version = path.match(/\/media\/(\d+)$/)?.[1];
      if (version && current)
        current = {
          ...current,
          Media: current.Media?.filter((media) => String(media.id) !== version),
        };
      else current = null;
      return { status: 200, data: {} };
    }
    return reply();
  });
});

it("deletes one rendition including all its parts and retains the other version", async () => {
  const result = await create(100)(signal());
  expect(deletes().map(([path]) => path)).toEqual([
    "/library/metadata/12/media/100",
  ]);
  expect(result.metadata?.Media).toEqual([movie.Media![1]]);
  expect(publishMediaChange).toHaveBeenCalledWith({
    serverId: "server",
    profileKey: "1:1",
    sectionId: "1",
    kind: "item",
    effect: "metadata",
    fields: expect.arrayContaining(["Media"]),
    parentIds: [],
    id: "12",
  });
  expect(
    transport.mock.calls.every(
      ([, , headers]) => headers?.["X-Plex-Token"] === "original-token",
    ),
  ).toBe(true);
});

it.each(["movie", "episode", "track", "photo", "clip"] as const)(
  "deletes all files of a %s and verifies the missing item",
  async (type) => {
    current = { ...movie, type };
    const remove = createMediaDeletion(
      capturePlexSession(),
      mediaDeletionTarget(current!),
    );
    await expect(remove(signal())).resolves.toEqual({ metadata: null });
    expect(deletes().map(([path]) => path)).toEqual(["/library/metadata/12"]);
  },
);

it.each(["path", "size", "part", "version"])(
  "requires new confirmation after a changed %s",
  async (change) => {
    const remove = create();
    if (change === "path")
      current!.Media![0].Part![0].file = "/Movies/replacement.mkv";
    if (change === "size") current!.Media![0].Part![0].size = 999;
    if (change === "part")
      current!.Media![0].Part!.push({ id: 112, file: "/Movies/new-part.mkv" });
    if (change === "version")
      current!.Media!.push({
        id: 300,
        Part: [{ id: 310, file: "/Movies/new-version.mkv" }],
      });
    await expect(remove(signal())).rejects.toThrow("files changed");
    expect(deletes()).toHaveLength(0);
    expect(publishMediaChange).toHaveBeenCalledWith(expect.objectContaining({ effect: "unknown", id: "12" }));
  },
);

it("compares identities rather than the ordering of versions and parts", async () => {
  const remove = create();
  current!.Media!.reverse();
  current!.Media![1].Part!.reverse();
  await expect(remove(signal())).resolves.toEqual({ metadata: null });
});

it("checks the current server setting immediately before deletion", async () => {
  const remove = create();
  allowed = false;
  await expect(remove(signal())).rejects.toThrow("does not allow");
  expect(deletes()).toHaveLength(0);
});

it.each(["profile", "token", "revision", "restricted", "permission"])(
  "rejects changed %s before the request",
  async (change) => {
    const remove = create();
    if (change === "profile")
      useAuthSession.setState({
        activeProfile: {
          id: 2,
          title: "Other",
          isOwner: false,
          protected: false,
          restricted: false,
        },
      });
    if (change === "token")
      AuthStorage.saveActiveSession({
        profile: null,
        accountToken: "account",
        serverToken: "other",
      });
    if (change === "revision") useAuthSession.setState({ revision: 2 });
    if (change === "restricted")
      useAuthSession.setState({
        activeUser: { id: 1, restricted: true } as Plex.UserData,
      });
    if (change === "permission")
      useServerSession.setState({ canManageServer: false });
    await expect(remove(signal())).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  },
);

it("does not retry a rejected DELETE automatically", async () => {
  transport.mockImplementation(async (path, method) => {
    if (method === "DELETE") return { status: 403, data: {} };
    if (path === "/")
      return {
        status: 200,
        data: {
          MediaContainer: {
            machineIdentifier: "server",
            allowMediaDeletion: true,
          },
        },
      };
    return reply();
  });
  await expect(create()(signal())).rejects.toMatchObject({ status: 403 });
  expect(deletes()).toHaveLength(1);
  expect(publishMediaChange).toHaveBeenCalledTimes(1);
});

it("recognizes completed deletion after a lost response without sending another DELETE", async () => {
  const original = transport.getMockImplementation()!;
  transport.mockImplementation(async (...args) => {
    if (args[1] === "DELETE") {
      current = null;
      throw new Error("Connection lost");
    }
    return original(...args);
  });
  await expect(create()(signal())).resolves.toEqual({ metadata: null });
  expect(deletes()).toHaveLength(1);
});

it("only verifies an acknowledged deletion on Retry after its verification failed", async () => {
  const original = transport.getMockImplementation()!;
  let failed = false;
  transport.mockImplementation(async (...args) => {
    if (args[1] === "GET" && !current && !failed) {
      failed = true;
      return { status: 503, data: {} };
    }
    return original(...args);
  });
  const remove = create();
  await expect(remove(signal())).rejects.toMatchObject({ status: 503 });
  await expect(remove(signal())).resolves.toEqual({ metadata: null });
  expect(deletes()).toHaveLength(1);
  expect(publishMediaChange).toHaveBeenCalledTimes(2);
});

it("does not repeat a deletion Plex accepted while its inventory still shows the version", async () => {
  const original = transport.getMockImplementation()!;
  transport.mockImplementation(async (...args) =>
    args[1] === "DELETE" ? { status: 200, data: {} } : original(...args),
  );
  const remove = create(100);
  await expect(remove(signal())).rejects.toThrow("Retry to check");
  current!.Media = [movie.Media![1]];
  await expect(remove(signal())).resolves.toEqual({ metadata: current });
  expect(deletes()).toHaveLength(1);
});

it("rejects late replies after a profile change and reconciles only the captured scope", async () => {
  const original = transport.getMockImplementation()!;
  transport.mockImplementation(async (...args) => {
    const response = await original(...args);
    if (args[1] === "DELETE") useAuthSession.setState({ revision: 2 });
    return response;
  });
  await expect(create()(signal())).rejects.toThrow("session changed");
  expect(publishMediaChange).toHaveBeenCalledWith(
    expect.objectContaining({ profileKey: "1:1" }),
  );
});

it("reconciles an aborted request without declaring success or retrying it", async () => {
  const abort = new AbortController();
  const original = transport.getMockImplementation()!;
  transport.mockImplementation(async (...args) => {
    const response = await original(...args);
    if (args[1] === "DELETE") abort.abort();
    return response;
  });
  await expect(create()(abort.signal)).rejects.toThrow();
  expect(deletes()).toHaveLength(1);
  expect(publishMediaChange).toHaveBeenCalledTimes(1);
});

it("publishes verified metadata differences before the UI can replace canonical data", async () => {
  current!.duration = 3000;
  const original = transport.getMockImplementation()!;
  transport.mockImplementation(async (...args) => {
    const response = await original(...args);
    if (args[1] === "DELETE" && current) current.duration = 5000;
    return response;
  });
  await create(100)(signal());
  expect(publishMediaChange).toHaveBeenCalledWith(expect.objectContaining({
    effect: "metadata", fields: expect.arrayContaining(["Media", "duration"]),
  }));
});
