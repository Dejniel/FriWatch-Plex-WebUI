import axios from "axios";
import { AuthStorage } from "../model/authStorage";
import { useAuthSession } from "../model/authSession";
import { createServerSetupClient } from "./serverSetup";

vi.mock("axios", () => ({ default: { request: vi.fn() } }));
const initial = useAuthSession.getState();
const response = {
  serverId: "server",
  serverUrl: "http://plex:32400",
  state: "unclaimed",
};

beforeEach(() => {
  localStorage.clear();
  AuthStorage.setOwnerToken("main-account");
  AuthStorage.saveActiveSession({
    profile: null,
    accountToken: "managed-profile",
    serverToken: "server-token",
  });
  useAuthSession.setState({
    status: "serverSetup",
    revision: 4,
    ownerUser: { id: 7 } as Plex.UserData,
  });
  vi.mocked(axios.request).mockResolvedValue({ status: 200, data: response });
});
afterEach(() => useAuthSession.setState(initial, true));

it("claims with the captured main account, not the managed profile or PMS token", async () => {
  const client = createServerSetupClient();
  await client.claim("server", "installer-proof", new AbortController().signal);
  expect(axios.request).toHaveBeenCalledWith(
    expect.objectContaining({
      url: "/server-setup/claim",
      method: "POST",
      timeout: 50_000,
      headers: expect.objectContaining({ "X-Plex-Token": "main-account" }),
      data: {
        serverId: "server",
        accountId: "7",
        setupCode: "installer-proof",
      },
    }),
  );
});

it("keeps reads separate from writes and treats lost write responses as uncertain", async () => {
  const client = createServerSetupClient();
  vi.mocked(axios.request).mockRejectedValueOnce(new Error("Connection reset"));
  await expect(
    client.claim("server", "proof", new AbortController().signal),
  ).rejects.toMatchObject({ mayHaveSubmitted: true });
  await client.verify("server", new AbortController().signal);
  expect(axios.request).toHaveBeenLastCalledWith(
    expect.objectContaining({
      method: "GET",
      url: "/server-setup/verification?serverId=server&accountId=7",
      data: undefined,
    }),
  );
});

it("rejects a stale account before a write and after an unfinished response", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(axios.request).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const client = createServerSetupClient();
  const pending = client.info(new AbortController().signal);
  useAuthSession.setState({ revision: 5 });
  finish({ status: 200, data: response });
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await expect(
    client.claim("server", "proof", new AbortController().signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(axios.request).toHaveBeenCalledTimes(1);
});

it("requires verification for the captured account and preserves backend retry guidance", async () => {
  const client = createServerSetupClient();
  vi.mocked(axios.request).mockResolvedValueOnce({
    status: 200,
    data: { ...response, state: "verified", accountId: "8" },
  });
  await expect(
    client.verify("server", new AbortController().signal),
  ).rejects.toThrow("incomplete");
  vi.mocked(axios.request).mockResolvedValueOnce({
    status: 409,
    data: { error: "Check status", mayHaveSubmitted: true },
  });
  await expect(
    client.claim("server", "proof", new AbortController().signal),
  ).rejects.toMatchObject({ message: "Check status", mayHaveSubmitted: true });
});

it("continues through ordinary account initialization rather than bypassing Home PINs", async () => {
  const login = vi.fn();
  useAuthSession.setState({ completeAccountLogin: login });
  await createServerSetupClient().continue();
  expect(login).toHaveBeenCalledWith("main-account");
});
