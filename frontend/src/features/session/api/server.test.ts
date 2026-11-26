import type { MockedFunction } from "vitest";
import { ProxiedRequest } from "shared/api/backend";
import { getServerSessionContext } from "./server";

vi.mock("shared/api/backend", () => ({ ProxiedRequest: vi.fn() }));

const request = ProxiedRequest as MockedFunction<typeof ProxiedRequest>;

beforeEach(() => {
  request.mockReset();
});

it("loads the server and its capabilities with the active token", async () => {
  request
    .mockResolvedValueOnce({ status: 200, data: { MediaContainer: { friendlyName: "Media", machineIdentifier: "server" } } } as never)
    .mockResolvedValueOnce({ status: 200, data: { Feature: [{ type: "manage" }] } } as never);

  await expect(getServerSessionContext("token")).resolves.toEqual({
    server: { friendlyName: "Media", machineIdentifier: "server" },
    providers: { Feature: [{ type: "manage" }] },
  });
  expect(request).toHaveBeenCalledWith("/", "GET", {
    accept: "application/json",
    "X-Plex-Token": "token",
  }, undefined, undefined);
});

it("keeps server details when the optional capability request fails", async () => {
  request
    .mockResolvedValueOnce({ status: 200, data: { MediaContainer: { friendlyName: "Media", machineIdentifier: "server" } } } as never)
    .mockResolvedValueOnce({ status: 503, data: "Unavailable" } as never);

  await expect(getServerSessionContext("token")).resolves.toEqual({
    server: { friendlyName: "Media", machineIdentifier: "server" },
    providers: null,
  });
});

it("rejects a successful but incomplete server response instead of creating an unusable scope", async () => {
  request.mockResolvedValue({ status: 200, data: { MediaContainer: {} } });
  await expect(getServerSessionContext("token")).rejects.toThrow("machineIdentifier");
});

it("does not turn cancellation of the optional capability request into a successful bootstrap", async () => {
  const abort = new AbortController();
  request.mockImplementation(async (path) => {
    if (path === "/") return { status: 200, data: { MediaContainer: { machineIdentifier: "server" } } };
    abort.abort();
    throw new Error("Aborted");
  });
  await expect(getServerSessionContext("token", abort.signal)).rejects.toThrow();
});
