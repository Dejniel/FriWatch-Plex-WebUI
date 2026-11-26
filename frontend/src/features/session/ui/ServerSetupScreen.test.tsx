import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useAuthSession } from "../model/authSession";
import { useServerSetup } from "../model/useServerSetup";
import ServerSetupScreen from "./ServerSetupScreen";

vi.mock("../model/useServerSetup", () => ({ useServerSetup: vi.fn() }));
const initial = useAuthSession.getState();
const model = {
  setup: {
    serverId: "native-server",
    serverUrl: "http://plex:32400",
    webUrl: "http://localhost:32401/web",
    state: "unclaimed" as "unclaimed" | "verified",
  },
  loading: false,
  error: null,
  pending: false,
  code: "",
  setCode: vi.fn(),
  checkOnly: false,
  claim: vi.fn(),
  check: vi.fn(),
  reload: vi.fn(),
  continue: vi.fn(),
};
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useAuthSession.setState({
    ownerUser: {
      id: 7,
      username: "Main account",
      email: "owner@example.test",
    } as Plex.UserData,
    activeUser: { id: 8, username: "Managed child" } as Plex.UserData,
  });
  model.setup.state = "unclaimed";
  model.checkOnly = false;
  vi.mocked(useServerSetup).mockReturnValue(model);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useAuthSession.setState(initial, true);
  vi.unstubAllGlobals();
});

it("shows the main account, target server and installer instructions without auto-claiming", async () => {
  await act(async () => root.render(<ServerSetupScreen />));
  expect(host.textContent).toContain("Main account");
  expect(host.textContent).not.toContain("Managed child");
  expect(host.textContent).toContain("http://plex:32400");
  expect(host.textContent).toContain("native-server");
  expect(host.textContent).toContain("FriWatch container logs");
  expect(host.querySelector('input[type="password"]')).not.toBeNull();
  expect(model.claim).not.toHaveBeenCalled();
});

it("offers status checks until ownership is verified, then ordinary sign-in continuation", async () => {
  model.checkOnly = true;
  await act(async () => root.render(<ServerSetupScreen />));
  expect(host.querySelector("form")).toBeNull();
  expect(host.textContent).toContain("Check status");
  expect(host.textContent).not.toContain("Continue to FriWatch");
  model.setup.state = "verified";
  await act(async () => root.render(<ServerSetupScreen />));
  const button = [...host.querySelectorAll("button")].find(
    (value) => value.textContent === "Continue to FriWatch",
  )!;
  await act(async () => button.click());
  expect(model.continue).toHaveBeenCalledTimes(1);
});
