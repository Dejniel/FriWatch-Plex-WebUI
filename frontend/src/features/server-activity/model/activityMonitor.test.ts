import { focusManager, notifyManager } from "@tanstack/react-query";
import type {
  CapturedPlexSession,
  PlexServerEvent,
} from "features/session/model";
import { serverQueryClient } from "shared/api/queryClient";
import { createServerActivityApi } from "../api/serverActivity";
import {
  activityKeys,
  rememberActivity,
  useActivityState,
} from "./activityState";
import { startServerActivityMonitor } from "./activityMonitor";

vi.mock("../api/serverActivity", async (original) => ({
  ...(await original<typeof import("../api/serverActivity")>()),
  createServerActivityApi: vi.fn(),
}));
const task = {
  kind: "activity" as const,
  id: "task",
  title: "Scanning",
  progress: 20,
  cancellable: true,
};
const api = {
  activities: vi.fn(),
  conversions: vi.fn(),
  sessions: vi.fn(),
  cancel: vi.fn(),
};
let valid: boolean, session: CapturedPlexSession;
let monitor: ReturnType<typeof startServerActivityMonitor>;
const empty = () => Promise.resolve([]);
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
};
const frame = (event: "updated" | "ended", progress = 40): PlexServerEvent => ({
  type: "notification",
  name: "activity",
  data: JSON.stringify({
    ActivityNotification: {
      event,
      uuid: task.id,
      Activity: {
        uuid: task.id,
        title: "Scanning",
        progress,
        cancellable: true,
      },
    },
  }),
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  focusManager.setFocused(true);
  notifyManager.setScheduler(queueMicrotask);
  serverQueryClient.clear();
  useActivityState.setState({ context: null, connection: "connecting", history: [] });
  valid = true;
  session = {
    scope: { serverId: "server", profileKey: "profile" },
    token: "token",
    revision: 1,
    isCurrent: () => valid,
    assertCurrent: vi.fn(),
  };
  api.activities.mockResolvedValue([task]);
  api.sessions.mockImplementation(empty);
  api.conversions.mockImplementation(empty);
  vi.mocked(createServerActivityApi).mockReturnValue(api);
});
afterEach(() => {
  monitor?.dispose();
  serverQueryClient.clear();
  focusManager.setFocused(undefined);
  notifyManager.setScheduler((callback) => setTimeout(callback, 0));
  vi.useRealTimers();
});

it("updates full activity records in Query without rereading on progress and preserves completion history", async () => {
  monitor = startServerActivityMonitor(session);
  await settle();
  const context = useActivityState.getState().context!,
    keys = activityKeys(context);
  monitor.receive(frame("updated", 60));
  expect(serverQueryClient.getQueryData(keys.activities)).toEqual([
    { ...task, progress: 60 },
  ]);
  expect(api.activities).toHaveBeenCalledTimes(1);
  monitor.receive(frame("ended", 100));
  monitor.receive(frame("ended", 100));
  expect(serverQueryClient.getQueryData(keys.activities)).toEqual([]);
  expect(useActivityState.getState().history).toHaveLength(1);
  expect(useActivityState.getState().history[0]).toMatchObject({
    outcome: "ended",
    title: "Scanning",
  });
});

it("replays updates and removal over an older in-flight snapshot", async () => {
  let resolve!: (value: (typeof task)[]) => void;
  api.activities.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  monitor = startServerActivityMonitor(session);
  monitor.receive(frame("updated", 80));
  resolve([task]);
  await settle();
  const keys = activityKeys(useActivityState.getState().context!);
  expect(serverQueryClient.getQueryData(keys.activities)).toEqual([
    { ...task, progress: 80 },
  ]);
  let finish!: (value: (typeof task)[]) => void;
  api.activities.mockImplementationOnce(
    () =>
      new Promise((done) => {
        finish = done;
      }),
  );
  const read = serverQueryClient.refetchQueries({ queryKey: keys.activities });
  monitor.receive(frame("ended", 100));
  finish([task]);
  await read;
  await settle();
  expect(serverQueryClient.getQueryData(keys.activities)).toEqual([]);
});

it("coalesces playback notifications without touching tasks and reconciles every resource after reconnect", async () => {
  monitor = startServerActivityMonitor(session);
  await settle();
  for (let i = 0; i < 20; i++)
    monitor.receive({ type: "notification", name: "playing", data: "{}" });
  await vi.advanceTimersByTimeAsync(750);
  expect(api.sessions).toHaveBeenCalledTimes(2);
  expect(api.activities).toHaveBeenCalledTimes(1);
  expect(api.conversions).toHaveBeenCalledTimes(1);
  api.activities.mockResolvedValue([]);
  monitor.receive({ type: "connection", state: "disconnected" });
  monitor.receive({
    type: "connection",
    state: "connected",
    reconnected: true,
  });
  await vi.advanceTimersByTimeAsync(750);
  expect(api.activities).toHaveBeenCalledTimes(2);
  expect(api.sessions).toHaveBeenCalledTimes(3);
  expect(api.conversions).toHaveBeenCalledTimes(2);
  expect(useActivityState.getState().history[0].outcome).toBe("ended");
});

it("falls back to periodic snapshots without streaming and suspends reads while hidden", async () => {
  monitor = startServerActivityMonitor(session);
  await settle();
  monitor.receive({ type: "connection", state: "unavailable" });
  await vi.advanceTimersByTimeAsync(5000);
  expect(api.activities).toHaveBeenCalledTimes(2);
  focusManager.setFocused(false);
  monitor.receive({ type: "notification", name: "playing", data: "{}" });
  await vi.advanceTimersByTimeAsync(10000);
  expect(api.activities).toHaveBeenCalledTimes(2);
  expect(api.sessions).toHaveBeenCalledTimes(2);
});

it("ignores stale callbacks, aborts pending reads and clears history on disposal", async () => {
  let signal!: AbortSignal;
  api.sessions.mockImplementation((value) => {
    signal = value;
    return new Promise(() => undefined);
  });
  monitor = startServerActivityMonitor(session);
  await settle();
  monitor.receive(frame("ended"));
  const context = useActivityState.getState().context!;
  valid = false;
  monitor.dispose();
  expect(signal.aborted).toBe(true);
  monitor.receive(frame("updated"));
  rememberActivity(context, {
    id: "late",
    title: "Old profile",
    outcome: "ended",
  });
  expect(useActivityState.getState()).toMatchObject({
    context: null,
    history: [],
  });
});

it("keeps only the most recent 100 history entries and does not persist them", async () => {
  monitor = startServerActivityMonitor(session);
  await settle();
  for (let i = 0; i < 120; i++)
    monitor.receive({
      type: "notification",
      name: "status",
      data: JSON.stringify({ StatusNotification: { title: `Notice ${i}` } }),
    });
  expect(useActivityState.getState().history).toHaveLength(100);
  expect(useActivityState.getState().history[0].title).toBe("Notice 119");
});

it("retains a fast task's title when its end only supplies an ID during initial loading", async () => {
  let finish!: (value: (typeof task)[]) => void;
  api.activities.mockImplementationOnce(
    () =>
      new Promise((done) => {
        finish = done;
      }),
  );
  monitor = startServerActivityMonitor(session);
  monitor.receive(frame("updated", 90));
  monitor.receive({
    type: "notification",
    name: "activity",
    data: JSON.stringify({
      ActivityNotification: { event: "ended", uuid: task.id },
    }),
  });
  finish([task]);
  await settle();
  expect(useActivityState.getState().history[0]).toMatchObject({
    title: "Scanning",
    outcome: "ended",
  });
  expect(
    serverQueryClient.getQueryData(
      activityKeys(useActivityState.getState().context!).activities,
    ),
  ).toEqual([]);
});

it("keeps cached tasks on failed recovery instead of recording them as ended", async () => {
  monitor = startServerActivityMonitor(session);
  await settle();
  api.activities.mockRejectedValueOnce(new Error("Offline"));
  monitor.receive({
    type: "connection",
    state: "connected",
    reconnected: true,
  });
  await vi.advanceTimersByTimeAsync(750);
  expect(
    serverQueryClient.getQueryData(
      activityKeys(useActivityState.getState().context!).activities,
    ),
  ).toEqual([task]);
  expect(useActivityState.getState().history).toHaveLength(1);
  expect(useActivityState.getState().history[0].outcome).toBe("error");
});

it("retains session history across a temporary application remount during bootstrap retry", async () => {
  monitor = startServerActivityMonitor(session); await settle();
  monitor.receive(frame("ended", 100));
  monitor.dispose();
  monitor = startServerActivityMonitor(session); await settle();
  expect(useActivityState.getState().history).toHaveLength(1);
  expect(useActivityState.getState().history[0]).toMatchObject({ title: "Scanning", outcome: "ended" });
});
