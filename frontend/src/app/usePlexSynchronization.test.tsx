import { startServerActivityMonitor } from "features/server-activity/model";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  connectPlexServerEvents,
  mediaChangeFromServer,
  type PlexServerEvent,
} from "features/session/model";
import { publishMediaChange } from "entities/media/model";
import { startBrowseSynchronization } from "./browseSynchronization";
import { usePlexSynchronization } from "./usePlexSynchronization";

let profile: string | null;
let serverId: string;
let revision: number;
vi.mock("features/settings/model", () => ({
  useUserSettings: Object.assign(
    (select: (state: { profileKey: string | null }) => unknown) =>
      select({ profileKey: profile }),
    { getState: () => ({ profileKey: profile }) },
  ),
}));
vi.mock("features/session/model", () => ({
  AuthStorage: { getServerToken: () => "test-token" },
  connectPlexServerEvents: vi.fn(),
  capturePlexSession: () => {
    const captured = { profile, serverId, revision };
    return {
      scope: { profileKey: profile, serverId },
      token: "test-token",
      revision,
      isCurrent: () =>
        profile === captured.profile &&
        serverId === captured.serverId &&
        revision === captured.revision,
    };
  },
  parsePlexServerChanges: vi.fn((name) =>
    name === "timeline" ? [{ kind: "library", sectionId: "2" }] : [],
  ),
  useServerSession: Object.assign(
    (select: (state: unknown) => unknown) =>
      select({ server: { machineIdentifier: serverId } }),
    { getState: () => ({ server: { machineIdentifier: serverId } }) },
  ),
  mediaChangeFromServer: vi.fn((_change, scope) => ({
    ...scope,
    kind: "recovery",
  })),
}));
vi.mock("features/server-activity/model", () => ({
  startServerActivityMonitor: vi.fn(),
}));
vi.mock("./browseSynchronization", () => ({
  startBrowseSynchronization: vi.fn(),
}));
const connect = vi.mocked(connectPlexServerEvents);
const start = vi.mocked(startBrowseSynchronization);
const disconnect = vi.fn();
let root: Root;
function Harness() {
  usePlexSynchronization(revision);
  return null;
}
const render = async () => {
  await act(async () => root.render(<Harness />));
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  profile = "owner:1";
  serverId = "server";
  revision = 0;
  connect.mockReturnValue(disconnect);
  vi.mocked(startServerActivityMonitor).mockReturnValue({
    receive: vi.fn(),
    dispose: vi.fn(),
  });
  start.mockImplementation(() => ({ enqueue: vi.fn(), dispose: vi.fn() }));
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it("sends translated SSE and confirmed local changes through the same synchronization batch", async () => {
  await render();
  const scope = { serverId, profileKey: profile };
  const batch = start.mock.results[0].value;
  const received = connect.mock.calls[0][1];
  received({ type: "notification", name: "timeline", data: "{}" });
  expect(mediaChangeFromServer).toHaveBeenCalledWith(
    { kind: "library", sectionId: "2" },
    scope,
  );
  expect(batch.enqueue).toHaveBeenCalledWith({ ...scope, kind: "recovery" });
  publishMediaChange({
    ...scope,
    profileKey: "owner:1",
    kind: "list",
    listKind: "playlist",
    id: "8",
  });
  expect(batch.enqueue).toHaveBeenLastCalledWith({
    ...scope,
    kind: "list",
    listKind: "playlist",
    id: "8",
  });
});

it("disposes the old scope and rejects its late stream callbacks and local changes", async () => {
  await render();
  const old = connect.mock.calls[0][1] as (event: PlexServerEvent) => void;
  const batch = start.mock.results[0].value;
  const isCurrent = start.mock.calls[0][1];
  expect(isCurrent()).toBe(true);
  profile = "owner:2";
  await render();
  expect(disconnect).toHaveBeenCalledTimes(1);
  expect(batch.dispose).toHaveBeenCalledTimes(1);
  expect(isCurrent()).toBe(false);
  vi.mocked(batch.enqueue).mockClear();
  old({ type: "connection", state: "connected", reconnected: true });
  publishMediaChange({ serverId, profileKey: profile, kind: "recovery" });
  expect(batch.enqueue).not.toHaveBeenCalled();
  expect(start.mock.results[1].value.enqueue).toHaveBeenCalledWith({
    serverId,
    profileKey: profile,
    kind: "recovery",
  });
});

it("reconnects when the server or session revision changes", async () => {
  await render();
  serverId = "other-server";
  await render();
  revision++;
  await render();
  expect(start).toHaveBeenCalledTimes(3);
  expect(start.mock.calls[1][0]).toEqual({ serverId, profileKey: profile });
  expect(disconnect).toHaveBeenCalledTimes(2);
});

it("does not connect without an active profile", async () => {
  profile = null;
  await render();
  expect(connect).not.toHaveBeenCalled();
  expect(start).not.toHaveBeenCalled();
});

it("routes progress only to activity and shares a reconnect with both consumers", async () => {
  await render();
  const received = connect.mock.calls[0][1];
  const activity = vi.mocked(startServerActivityMonitor).mock.results[0].value;
  const batch = start.mock.results[0].value;
  const event = { type: "notification", name: "activity", data: "{}" } as const;
  received(event);
  expect(activity.receive).toHaveBeenCalledWith(event);
  expect(batch.enqueue).not.toHaveBeenCalled();
  received({ type: "connection", state: "connected", reconnected: true });
  expect(batch.enqueue).toHaveBeenCalledWith({
    serverId,
    profileKey: profile,
    kind: "recovery",
  });
  profile = "owner:2";
  await render();
  expect(activity.dispose).toHaveBeenCalledOnce();
  vi.mocked(activity.receive).mockClear();
  received(event);
  expect(activity.receive).not.toHaveBeenCalled();
});
