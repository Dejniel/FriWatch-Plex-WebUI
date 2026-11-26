import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { notifyManager } from "@tanstack/react-query";
import {
  AuthStorage,
  capturePlexSession,
  useAuthSession,
  useServerSession,
} from "features/session/model";
import { ProxiedRequest } from "shared/api/backend";
import { serverQueryClient } from "shared/api/queryClient";
import { startServerActivityMonitor } from "../model/activityMonitor";
import { useActivityState } from "../model/activityState";
import { ServerActivityButton } from "./ServerActivityButton";
import { ServerActivityScreen } from "./ServerActivityScreen";

vi.mock("shared/api/backend", () => ({
  ProxiedRequest: vi.fn(),
  getBackendURL: () => "",
}));
const transport = vi.mocked(ProxiedRequest);
const task = {
  uuid: "task",
  title: "Scanning films",
  subtitle: "Arrival",
  progress: 30,
  cancellable: true,
};
const playback = {
  title: "Film",
  Session: { id: "playing" },
  Player: { state: "playing" },
  Media: [{ Part: [{ decision: "directplay" }] }],
};
const response = (field: string, items: unknown[]) => ({
  status: 200,
  data: { MediaContainer: { size: items.length, [field]: items } },
});
let root: Root,
  container: HTMLDivElement,
  monitor: ReturnType<typeof startServerActivityMonitor>;
const findButton = (parent: ParentNode, label: string) =>
  [...parent.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === label,
  )!;
const dialog = () => document.querySelector('[role="dialog"]')!;
const preview = () =>
  document.querySelector('[aria-label="Current activity"]')!;
const click = async (parent: ParentNode, label: string) =>
  act(async () => findButton(parent, label).click());
const flush = async () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
function deferred() {
  let resolve!: (value: { status: number; data: unknown }) => void;
  const promise = new Promise<{ status: number; data: unknown }>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeAll(() => notifyManager.setScheduler(queueMicrotask));
afterAll(() =>
  notifyManager.setScheduler((callback) => setTimeout(callback, 0)),
);
beforeEach(async () => {
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  serverQueryClient.clear();
  AuthStorage.saveActiveSession({
    profile: null,
    accountToken: "account",
    serverToken: "token",
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
      restricted: false,
      protected: false,
    },
  });
  useServerSession.setState({
    server: { machineIdentifier: "server" } as Plex.ServerPreferences,
  });
  transport.mockImplementation(async (path) =>
    path === "/activities"
      ? response("Activity", [task])
      : path === "/status/sessions"
        ? response("Metadata", [playback])
        : response("TranscodeJob", []),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  monitor = startServerActivityMonitor(capturePlexSession());
  await act(async () =>
    root.render(
      <StrictMode>
        <MemoryRouter initialEntries={["/activity"]}>
          <ServerActivityButton />
          <Routes>
            <Route path="/activity" element={<ServerActivityScreen />} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    ),
  );
  await flush();
});
afterEach(async () => {
  await act(async () => root.unmount());
  monitor.dispose();
  container.remove();
  serverQueryClient.clear();
  vi.unstubAllGlobals();
});

it("shares one read per resource and keeps history and actions out of the bar preview", async () => {
  expect(transport).toHaveBeenCalledTimes(3);
  const open = document.querySelector<HTMLButtonElement>(
    '[aria-label="Open activity"]',
  )!;
  await act(async () => open.click());
  expect(preview().textContent).toContain("Scanning films");
  expect(preview().textContent).toContain("Tasks: 1 · Playing: 1");
  expect(preview().textContent).not.toContain("Cancel task");
  const ring = document.querySelector('[data-testid="activity-busy"]');
  await act(async () =>
    monitor.receive({
      type: "notification",
      name: "activity",
      data: JSON.stringify({
        ActivityNotification: {
          event: "updated",
          uuid: task.uuid,
          Activity: { ...task, progress: 50 },
        },
      }),
    }),
  );
  expect(document.querySelector('[data-testid="activity-busy"]')).toBe(ring);
  expect(transport).toHaveBeenCalledTimes(3);
  await act(async () =>
    monitor.receive({
      type: "notification",
      name: "activity",
      data: JSON.stringify({
        ActivityNotification: {
          event: "ended",
          uuid: task.uuid,
          Activity: { ...task, progress: 100 },
        },
      }),
    }),
  );
  expect(preview().textContent).not.toContain("Scanning films");
  expect(preview().textContent).not.toContain("Ended");
  expect(document.querySelector('[data-testid="activity-busy"]')).toBeNull();
  expect(
    document.querySelector('[aria-label="Recent activity"]')?.textContent,
  ).toContain("Scanning films");
  expect(
    document.querySelector('[aria-label="Recent activity"]')?.textContent,
  ).toContain("Ended");
  expect(preview().querySelector('a[href="/activity"]')).not.toBeNull();
});

it("waits for a cancellation acknowledgement and does not retry a write when the refresh fails", async () => {
  const pending = deferred();
  let written = false;
  transport.mockImplementation(async (_path, method) => {
    if (method === "DELETE") {
      written = true;
      return pending.promise;
    }
    return written ? { status: 503, data: {} } : response("Activity", [task]);
  });
  await click(
    document.querySelector('[aria-label="Background tasks"]')!,
    "Cancel task",
  );
  expect(transport.mock.calls.some((call) => call[1] === "DELETE")).toBe(false);
  await act(async () => {
    findButton(dialog(), "Cancel task").click();
    findButton(dialog(), "Cancel task").click();
  });
  await flush();
  expect(dialog().textContent).toContain("Cancelling…");
  expect(findButton(dialog(), "Cancel").disabled).toBe(true);
  await act(async () => pending.resolve({ status: 200, data: "" }));
  await flush();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(
    document.querySelector('[aria-label="Recent activity"]')?.textContent,
  ).toContain("Cancellation requested");
  expect(
    findButton(
      document.querySelector('[aria-label="Background tasks"]')!,
      "Cancellation requested",
    ).disabled,
  ).toBe(true);
  const retry = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find((button) => button.textContent === "Retry")!;
  await act(async () => retry.click());
  expect(
    transport.mock.calls.filter((call) => call[1] === "DELETE"),
  ).toHaveLength(1);
});

it("keeps rejected cancellation in the confirmation for an explicit retry", async () => {
  transport.mockImplementation(async (_path, method) =>
    method === "DELETE"
      ? { status: 400, data: "not cancellable" }
      : response("Activity", [task]),
  );
  await click(
    document.querySelector('[aria-label="Background tasks"]')!,
    "Cancel task",
  );
  await click(dialog(), "Cancel task");
  await flush();
  expect(dialog().textContent).toContain("HTTP 400");
  expect(findButton(dialog(), "Retry cancellation").disabled).toBe(false);
  expect(
    transport.mock.calls.filter((call) => call[1] === "DELETE"),
  ).toHaveLength(1);
  expect(
    useActivityState
      .getState()
      .history.some((entry) => entry.outcome === "cancel-requested"),
  ).toBe(false);
});

it("closes and aborts a pending confirmation when the profile session changes", async () => {
  const pending = deferred();
  let submittedSignal: AbortSignal | undefined;
  transport.mockImplementation(
    async (_path, method, _headers, _data, signal) => {
      if (method !== "DELETE") return response("Activity", [task]);
      submittedSignal = signal;
      return pending.promise;
    },
  );
  await click(
    document.querySelector('[aria-label="Background tasks"]')!,
    "Cancel task",
  );
  await click(dialog(), "Cancel task");
  await flush();
  await act(async () => {
    useAuthSession.setState({ revision: 2 });
    monitor.dispose();
    monitor = startServerActivityMonitor(capturePlexSession());
  });
  expect(submittedSignal?.aborted).toBe(true);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => pending.resolve({ status: 200, data: "" }));
  expect(
    useActivityState
      .getState()
      .history.some((entry) => entry.outcome === "cancel-requested"),
  ).toBe(false);
});
