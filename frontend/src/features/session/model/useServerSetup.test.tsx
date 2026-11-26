import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider, notifyManager } from "@tanstack/react-query";
import { serverQueryClient } from "shared/api/queryClient";
import { createServerSetupClient, ServerSetupError } from "../api/serverSetup";
import { useAuthSession } from "./authSession";
import { useServerSetup } from "./useServerSetup";

vi.mock("../api/serverSetup", async (original) => ({
  ...(await original<typeof import("../api/serverSetup")>()),
  createServerSetupClient: vi.fn(),
}));
const setup = {
  serverId: "server",
  serverUrl: "http://plex:32400",
  state: "unclaimed" as const,
};
const source = {
  accountId: "7",
  isCurrent: vi.fn(),
  info: vi.fn(),
  claim: vi.fn(),
  verify: vi.fn(),
  continue: vi.fn(),
};
let model: ReturnType<typeof useServerSetup>;
let root: Root, host: HTMLDivElement;
const initial = useAuthSession.getState();
function Harness() {
  model = useServerSetup();
  return null;
}
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
beforeAll(() => notifyManager.setScheduler(queueMicrotask));
afterAll(() =>
  notifyManager.setScheduler((callback) => setTimeout(callback, 0)),
);
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  serverQueryClient.clear();
  useAuthSession.setState({
    status: "serverSetup",
    revision: 4,
    ownerUser: { id: 7 } as Plex.UserData,
  });
  source.isCurrent.mockReturnValue(true);
  source.info.mockResolvedValue(setup);
  source.claim.mockResolvedValue({
    ...setup,
    state: "verified",
    accountId: "7",
  });
  source.verify.mockResolvedValue({
    ...setup,
    state: "verified",
    accountId: "7",
  });
  vi.mocked(createServerSetupClient).mockReturnValue(source);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  serverQueryClient.clear();
  useAuthSession.setState(initial, true);
  vi.unstubAllGlobals();
});
async function open() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={serverQueryClient}>
        <Harness />
      </QueryClientProvider>,
    ),
  );
  await settle();
  await act(async () => model.setCode("proof"));
}

it("only reads on mount, then claims once and clears the draft without storing it in Query", async () => {
  await open();
  expect(source.claim).not.toHaveBeenCalled();
  await act(async () => {
    await Promise.all([model.claim(), model.claim()]);
  });
  expect(source.claim).toHaveBeenCalledTimes(1);
  expect(model.setup?.state).toBe("verified");
  expect(model.code).toBe("");
  expect(
    JSON.stringify(
      serverQueryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.state.data),
    ),
  ).not.toContain("proof");
  expect(serverQueryClient.getMutationCache().getAll()).toEqual([]);
});

it("retains a rejected draft for correction and retry", async () => {
  await open();
  source.claim.mockRejectedValueOnce(new ServerSetupError("Wrong setup code"));
  await act(async () => model.claim());
  expect(model.error).toBe("Wrong setup code");
  expect(model.code).toBe("proof");
  expect(model.checkOnly).toBe(false);
  await act(async () => model.claim());
  expect(model.setup?.state).toBe("verified");
});

it("only verifies after a lost response and never resubmits the uncertain claim", async () => {
  await open();
  source.claim.mockRejectedValueOnce(
    new ServerSetupError("Response lost", true),
  );
  await act(async () => model.claim());
  expect(model.checkOnly).toBe(true);
  expect(model.code).toBe("");
  await act(async () => model.claim());
  expect(source.claim).toHaveBeenCalledTimes(1);
  await act(async () => model.check());
  expect(source.verify).toHaveBeenCalledTimes(1);
  expect(model.setup?.state).toBe("verified");
});

it("aborts on closing and discards a late completion from an obsolete account", async () => {
  let finish!: (value: unknown) => void;
  source.claim.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await open();
  let request!: Promise<void>;
  await act(async () => {
    request = model.claim();
  });
  const signal = source.claim.mock.calls[0][2] as AbortSignal;
  source.isCurrent.mockReturnValue(false);
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
  finish({ ...setup, state: "verified", accountId: "7" });
  await act(async () => request);
  expect(
    serverQueryClient.getQueryData(["plex-server-setup", 4, "7"]),
  ).not.toMatchObject({ state: "verified" });
});
