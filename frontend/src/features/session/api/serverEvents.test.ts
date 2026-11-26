import { connectPlexServerEvents } from "./serverEvents";

vi.mock("shared/api/backend", () => ({
  getBackendURL: () => "https://friwatch.test",
}));
const streams: FakeStream[] = [];
class FakeStream extends EventTarget {
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  close = vi.fn();
  constructor(public url: string) {
    super();
    streams.push(this);
  }
}
const original = globalThis.EventSource;
beforeEach(() => {
  streams.length = 0;
  globalThis.EventSource = FakeStream as unknown as typeof EventSource;
});
afterEach(() => {
  globalThis.EventSource = original;
});

it("shares library, activity and playback events through the existing proxy", () => {
  const change = vi.fn();
  const close = connectPlexServerEvents("test-token", change);
  const current = streams[0];
  const url = new URL(current.url);
  expect(url.origin).toBe("https://friwatch.test");
  expect(url.pathname).toBe("/dynproxy/:/eventsource/notifications");
  expect(url.searchParams.get("X-Plex-Token")).toBe("test-token");
  expect(url.searchParams.get("filters")?.split(",")).toEqual(
    expect.arrayContaining([
      "timeline",
      "activity",
      "playing",
      "status",
      "transcodeSession.update",
    ]),
  );
  current.dispatchEvent(
    new MessageEvent("timeline", {
      data: JSON.stringify({ TimelineEntry: { type: 1, sectionID: "2" } }),
    }),
  );
  expect(change).toHaveBeenCalledWith({
    type: "notification",
    name: "timeline",
    data: JSON.stringify({ TimelineEntry: { type: 1, sectionID: "2" } }),
  });
  current.dispatchEvent(new MessageEvent("activity", { data: "task-data" }));
  expect(change).toHaveBeenLastCalledWith({
    type: "notification",
    name: "activity",
    data: "task-data",
  });
  close();
  current.dispatchEvent(new MessageEvent("timeline", { data: "{}" }));
  expect(current.close).toHaveBeenCalledTimes(1);
  expect(change).toHaveBeenCalledTimes(2);
});

it("invalidates on reconnection and removes every callback when a profile is closed", () => {
  const change = vi.fn();
  const close = connectPlexServerEvents("test-token", change);
  const current = streams[0];
  current.onopen?.();
  expect(change).toHaveBeenLastCalledWith({
    type: "connection",
    state: "connected",
    reconnected: false,
  });
  current.onerror?.();
  expect(change).toHaveBeenLastCalledWith({
    type: "connection",
    state: "disconnected",
  });
  current.onopen?.();
  expect(change).toHaveBeenLastCalledWith({
    type: "connection",
    state: "connected",
    reconnected: true,
  });
  close();
  expect(current.onopen).toBeNull();
  expect(current.onerror).toBeNull();
});

it("reports unsupported streaming so consumers can use recovery reads", () => {
  globalThis.EventSource = undefined as unknown as typeof EventSource;
  const receive = vi.fn();
  const close = connectPlexServerEvents("token", receive);
  expect(receive).toHaveBeenCalledWith({
    type: "connection",
    state: "unavailable",
  });
  close();
});
