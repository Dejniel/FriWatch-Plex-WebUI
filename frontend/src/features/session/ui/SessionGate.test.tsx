import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useUserSettings } from "features/settings/model";
import { useAuthSession } from "../model/authSession";
import SessionGate from "./SessionGate";
import { AuthStorage } from "../model/authStorage";
import { useServerSession } from "../model/serverSession";
import { getServerSessionContext } from "../api/server";
import { PlexRequestError } from "shared/api/PlexClient";

const { loadUserSettings } = vi.hoisted(() => ({
  loadUserSettings: vi.fn<() => Promise<Record<string, string>>>(),
}));
vi.mock("features/settings/api/userSettings", () => ({
  loadUserSettings,
  saveUserSetting: vi.fn(),
}));
vi.mock("./LoginScreen", () => ({ default: () => <div>Sign in</div> }));
vi.mock("../api/server", () => ({ getServerSessionContext: vi.fn() }));
vi.mock("./ProfilePickerScreen", () => ({
  default: () => <div>Choose profile</div>,
}));
vi.mock("./ServerSetupScreen", () => ({ default: () => <div>Link your Plex server</div> }));

function deferredSettings<T = Record<string, string>>() {
  let resolve!: (settings: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const initialAuth = useAuthSession.getState();
let host: HTMLDivElement;
let root: Root;

function ready(profileId = 1, revision = 1) {
  AuthStorage.saveActiveSession({ profile: null, accountToken: "account", serverToken: `server-${profileId}` });
  useAuthSession.setState({
    status: "ready",
    revision,
    ownerUser: { id: 1 } as Plex.UserData,
    activeProfile: {
      id: profileId,
      title: `Profile ${profileId}`,
      isOwner: profileId === 1,
      protected: false,
      restricted: false,
    },
  });
}

function Content() {
  const size = useUserSettings((state) => state.settings.LIBRARY_CARD_SIZE);
  return <main>Card size: {size}</main>;
}

const render = () => act(async () => root.render(
  <SessionGate><Content /></SessionGate>,
));
const spinner = () => host.querySelector('[role="progressbar"]');

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  vi.resetAllMocks();
  useAuthSession.setState({ ...initialAuth, initialize: vi.fn() });
  useUserSettings.getState().reset();
  useServerSession.getState().reset();
  vi.mocked(getServerSessionContext).mockResolvedValue({ server: { machineIdentifier: "server" } as Plex.ServerPreferences, providers: null });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useAuthSession.setState(initialAuth, true);
  useUserSettings.getState().reset();
  useServerSession.getState().reset();
  vi.unstubAllGlobals();
});

it("keeps the same connected spinner from authentication through profile settings", async () => {
  const settings = deferredSettings();
  vi.mocked(loadUserSettings).mockReturnValue(settings.promise);
  await render();
  const initialSpinner = spinner();
  expect(initialSpinner?.isConnected).toBe(true);
  expect(loadUserSettings).not.toHaveBeenCalled();

  await act(async () => ready());
  expect(loadUserSettings).toHaveBeenCalledTimes(1);
  expect(spinner()).toBe(initialSpinner);
  expect(initialSpinner?.isConnected).toBe(true);
  expect(host.querySelector("main")).toBeNull();

  await act(async () => settings.resolve({ LIBRARY_CARD_SIZE: "80" }));
  expect(spinner()).toBeNull();
  expect(host.querySelector("main")?.textContent).toBe("Card size: 80");
});

it("discards an unfinished settings load when authentication restarts for another profile", async () => {
  const previous = deferredSettings();
  const current = deferredSettings();
  vi.mocked(loadUserSettings)
    .mockReturnValueOnce(previous.promise)
    .mockReturnValueOnce(current.promise);
  ready();
  await render();
  const initialSpinner = spinner();

  await act(async () => useAuthSession.setState({ status: "initializing" }));
  await act(async () => previous.resolve({ LIBRARY_CARD_SIZE: "180" }));
  expect(useUserSettings.getState().profileKey).toBeNull();
  expect(host.querySelector("main")).toBeNull();
  expect(spinner()).toBe(initialSpinner);

  await act(async () => ready(2, 2));
  expect(spinner()).toBe(initialSpinner);
  expect(loadUserSettings).toHaveBeenCalledTimes(2);
  await act(async () => current.resolve({ LIBRARY_CARD_SIZE: "60" }));
  expect(useUserSettings.getState().profileKey).toBe("1:2");
  expect(host.querySelector("main")?.textContent).toBe("Card size: 60");
});

it("reloads settings for a new session revision even when the profile is unchanged", async () => {
  const refreshed = deferredSettings();
  vi.mocked(loadUserSettings)
    .mockResolvedValueOnce({ LIBRARY_CARD_SIZE: "80" })
    .mockReturnValueOnce(refreshed.promise);
  ready();
  await render();
  expect(host.querySelector("main")?.textContent).toBe("Card size: 80");

  await act(async () => ready(1, 2));
  expect(host.querySelector("main")).toBeNull();
  expect(spinner()).not.toBeNull();
  expect(loadUserSettings).toHaveBeenCalledTimes(2);
  await act(async () => refreshed.resolve({ LIBRARY_CARD_SIZE: "100" }));
  expect(host.querySelector("main")?.textContent).toBe("Card size: 100");
});

it("allows cached settings after a failure and retries the failed load", async () => {
  const retried = deferredSettings();
  vi.mocked(loadUserSettings)
    .mockResolvedValueOnce({ LIBRARY_CARD_SIZE: "90" })
    .mockRejectedValueOnce(new Error("Unavailable"))
    .mockReturnValueOnce(retried.promise);
  ready();
  await render();
  await act(async () => ready(1, 2));
  expect(host.querySelector("main")?.textContent).toBe("Card size: 90");
  expect(host.querySelector('[role="alert"]')?.textContent)
    .toContain("Cached settings are being used.");

  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(spinner()).not.toBeNull();
  expect(loadUserSettings).toHaveBeenCalledTimes(3);
  await act(async () => retried.resolve({ LIBRARY_CARD_SIZE: "120" }));
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.querySelector("main")?.textContent).toBe("Card size: 120");
});

it.each([
  ["signedOut", "Sign in"],
  ["selectingProfile", "Choose profile"],
  ["serverSetup", "Link your Plex server"],
  ["error", "Authentication failed."],
] as const)("does not load profile settings while %s", async (status, text) => {
  ready();
  useAuthSession.setState({ status });
  await render();
  expect(host.textContent).toContain(text);
  expect(loadUserSettings).not.toHaveBeenCalled();
  expect(host.querySelector("main")).toBeNull();
});

it("keeps the same spinner until both settings and server context are ready", async () => {
  const settings = deferredSettings();
  const server = deferredSettings<Awaited<ReturnType<typeof getServerSessionContext>>>();
  vi.mocked(loadUserSettings).mockReturnValue(settings.promise);
  vi.mocked(getServerSessionContext).mockReturnValue(server.promise);
  ready(); await render();
  const initialSpinner = spinner();
  await act(async () => settings.resolve({ LIBRARY_CARD_SIZE: "80" }));
  expect(spinner()).toBe(initialSpinner);
  expect(host.querySelector("main")).toBeNull();
  await act(async () => server.resolve({ server: { machineIdentifier: "server" } as Plex.ServerPreferences, providers: null }));
  expect(spinner()).toBeNull();
  expect(host.querySelector("main")?.textContent).toBe("Card size: 80");
});

it("shows failed server initialization and retries it without mounting library content", async () => {
  vi.mocked(loadUserSettings).mockResolvedValue({});
  vi.mocked(getServerSessionContext).mockRejectedValueOnce(new PlexRequestError(503, {}));
  ready(); await render();
  expect(host.querySelector("main")).toBeNull();
  expect(spinner()).toBeNull();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("cannot reach");
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(host.querySelector("main")).not.toBeNull();
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(getServerSessionContext).toHaveBeenCalledTimes(2);
});

it("does not keep spinning for pending preferences once the server failure is known", async () => {
  const settings = deferredSettings();
  vi.mocked(loadUserSettings).mockReturnValue(settings.promise);
  vi.mocked(getServerSessionContext).mockRejectedValue(new PlexRequestError(401, {}));
  ready(); await render();
  expect(spinner()).toBeNull();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("does not have access");
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(useAuthSession.getState().initialize).toHaveBeenCalledTimes(2);
  expect(getServerSessionContext).toHaveBeenCalledTimes(1);
  await act(async () => settings.resolve({}));
  expect(host.querySelector("main")).toBeNull();
});

it("keeps the current screen mounted when a background server refresh fails", async () => {
  vi.mocked(loadUserSettings).mockResolvedValue({});
  ready(); await render();
  const content = host.querySelector("main");
  expect(content).not.toBeNull();
  vi.mocked(getServerSessionContext).mockRejectedValueOnce(new PlexRequestError(503, {}));
  await act(async () => useServerSession.getState().refresh());
  expect(host.querySelector("main")).toBe(content);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("cannot reach");
});

it("aborts the old profile's server bootstrap and waits for the current profile", async () => {
  const first = deferredSettings<Awaited<ReturnType<typeof getServerSessionContext>>>();
  const second = deferredSettings<Awaited<ReturnType<typeof getServerSessionContext>>>();
  vi.mocked(loadUserSettings).mockResolvedValue({});
  vi.mocked(getServerSessionContext).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  ready(); await render();
  const signal = vi.mocked(getServerSessionContext).mock.calls[0][1];
  await act(async () => ready(2, 2));
  expect(signal?.aborted).toBe(true);
  await act(async () => first.resolve({ server: { machineIdentifier: "old-server" } as Plex.ServerPreferences, providers: null }));
  expect(host.querySelector("main")).toBeNull();
  await act(async () => second.resolve({ server: { machineIdentifier: "current-server" } as Plex.ServerPreferences, providers: null }));
  expect(host.querySelector("main")).not.toBeNull();
  expect(useServerSession.getState().server?.machineIdentifier).toBe("current-server");
});
