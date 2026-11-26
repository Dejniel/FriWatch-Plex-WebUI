import type { Mock } from "vitest";
import { getServerSessionContext } from "../api/server";
import { AuthStorage } from "./authStorage";
import { useServerSession } from "./serverSession";
import { PlexRequestError } from "shared/api/PlexClient";

vi.mock("../api/server", () => ({ getServerSessionContext: vi.fn() }));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.resetAllMocks();
  useServerSession.getState().reset();
});

it("loads server details and management capability for the active session", async () => {
  AuthStorage.saveActiveSession({
    profile: null,
    accountToken: "account",
    serverToken: "server",
  });
  (getServerSessionContext as Mock).mockResolvedValue({
    server: { friendlyName: "Media" },
    providers: { Feature: [{ type: "manage" }] },
  });

  await useServerSession.getState().refresh();

  expect(useServerSession.getState()).toMatchObject({
    server: { friendlyName: "Media" },
    canManageServer: true,
  });
});

it("does not restore a stale response after the session is reset", async () => {
  AuthStorage.saveActiveSession({
    profile: null,
    accountToken: "account",
    serverToken: "server",
  });
  let resolveRequest!: (value: unknown) => void;
  (getServerSessionContext as Mock).mockReturnValue(
    new Promise((resolve) => {
      resolveRequest = resolve;
    }),
  );

  const refresh = useServerSession.getState().refresh();
  const signal = vi.mocked(getServerSessionContext).mock.calls[0][1];
  useServerSession.getState().reset();
  expect(signal?.aborted).toBe(true);
  resolveRequest({
    server: { friendlyName: "Old server" },
    providers: { Feature: [{ type: "manage" }] },
  });
  await refresh;

  expect(useServerSession.getState()).toMatchObject({
    server: null,
    canManageServer: false,
    status: "idle", error: null,
  });
});

it.each([401, 403, 503, 504])("finishes failed initialization with a retryable problem (HTTP %s)", async (status) => {
  AuthStorage.saveActiveSession({ profile: null, accountToken: "account", serverToken: "server" });
  vi.mocked(getServerSessionContext).mockRejectedValue(new PlexRequestError(status, {}));
  await useServerSession.getState().refresh();
  expect(useServerSession.getState()).toMatchObject({ status: "error", server: null,
    error: { recovery: status === 401 || status === 403 ? "session" : "server" } });
  vi.mocked(getServerSessionContext).mockResolvedValue({ server: { machineIdentifier: "server" } as Plex.ServerPreferences, providers: null });
  const retry = useServerSession.getState().refresh();
  expect(useServerSession.getState()).toMatchObject({ status: "loading", error: null });
  await retry;
  expect(useServerSession.getState()).toMatchObject({ status: "ready", error: null });
});

it("retains an initialized context when a later refresh fails", async () => {
  AuthStorage.saveActiveSession({ profile: null, accountToken: "account", serverToken: "server" });
  const server = { machineIdentifier: "server" } as Plex.ServerPreferences;
  vi.mocked(getServerSessionContext).mockResolvedValueOnce({ server, providers: { Feature: [{ type: "manage" }] } });
  await useServerSession.getState().refresh();
  vi.mocked(getServerSessionContext).mockRejectedValueOnce(new PlexRequestError(503, {}));
  const refresh = useServerSession.getState().refresh();
  expect(useServerSession.getState()).toMatchObject({ status: "ready", server });
  await refresh;
  expect(useServerSession.getState()).toMatchObject({ status: "ready", server, canManageServer: true, error: { recovery: "server" } });
});

it("allows browsing with a retryable warning when only capabilities are unavailable", async () => {
  AuthStorage.saveActiveSession({ profile: null, accountToken: "account", serverToken: "server" });
  const server = { machineIdentifier: "server" } as Plex.ServerPreferences;
  vi.mocked(getServerSessionContext).mockResolvedValueOnce({ server, providers: null, capabilitiesUnavailable: true });
  await useServerSession.getState().refresh();
  expect(useServerSession.getState()).toMatchObject({ status: "ready", server, canManageServer: false,
    error: { message: expect.stringContaining("permissions could not be checked"), recovery: "server" } });
  vi.mocked(getServerSessionContext).mockResolvedValueOnce({ server, providers: { Feature: [{ type: "manage" }] } });
  const retry = useServerSession.getState().refresh();
  expect(useServerSession.getState()).toMatchObject({ status: "ready", server });
  await retry;
  expect(useServerSession.getState()).toMatchObject({ status: "ready", canManageServer: true, error: null });
});

it("turns a stalled bootstrap into an error and aborts its requests after the deadline", async () => {
  vi.useFakeTimers();
  try {
    AuthStorage.saveActiveSession({ profile: null, accountToken: "account", serverToken: "server" });
    vi.mocked(getServerSessionContext).mockImplementation((_token, signal) => new Promise((_resolve, reject) => {
      signal!.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
    }));
    const refresh = useServerSession.getState().refresh();
    expect(useServerSession.getState().status).toBe("loading");
    await vi.advanceTimersByTimeAsync(20000);
    await refresh;
    expect(useServerSession.getState()).toMatchObject({ status: "error", error: { message: expect.stringContaining("too long") } });
    expect(vi.mocked(getServerSessionContext).mock.calls[0][1]?.aborted).toBe(true);
  } finally { useServerSession.getState().reset(); vi.useRealTimers(); }
});
