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
    .mockResolvedValueOnce({
      status: 200,
      data: {
        MediaContainer: { friendlyName: "Media", machineIdentifier: "server" },
      },
    } as never)
    .mockResolvedValueOnce({
      status: 200,
      data: { Feature: [{ type: "manage" }] },
    } as never);

  await expect(getServerSessionContext("token")).resolves.toEqual({
    server: { friendlyName: "Media", machineIdentifier: "server" },
    providers: { Feature: [{ type: "manage" }] },
  });
  expect(request).toHaveBeenCalledWith(
    "/",
    "GET",
    {
      accept: "application/json",
      "X-Plex-Token": "token",
    },
    undefined,
    undefined,
  );
});

it("keeps server details when the optional capability request fails", async () => {
  request
    .mockResolvedValueOnce({
      status: 200,
      data: {
        MediaContainer: { friendlyName: "Media", machineIdentifier: "server" },
      },
    } as never)
    .mockResolvedValueOnce({ status: 503, data: "Unavailable" } as never);

  await expect(getServerSessionContext("token")).resolves.toEqual({
    server: { friendlyName: "Media", machineIdentifier: "server" },
    providers: null,
    capabilitiesUnavailable: true,
  });
});

it.each([401, 403, 404])(
  "does not warn about capabilities Plex denies or does not support (HTTP %s)",
  async (status) => {
    request.mockImplementation(async (path) =>
      path === "/"
        ? {
            status: 200,
            data: { MediaContainer: { machineIdentifier: "server" } },
          }
        : { status, data: {} },
    );
    await expect(getServerSessionContext("token")).resolves.toEqual({
      server: { machineIdentifier: "server" },
      providers: null,
    });
  },
);

it("rejects a successful but incomplete server response instead of creating an unusable scope", async () => {
  request.mockResolvedValue({ status: 200, data: { MediaContainer: {} } });
  await expect(getServerSessionContext("token")).rejects.toThrow(
    "machineIdentifier",
  );
});

it("does not turn cancellation of the optional capability request into a successful bootstrap", async () => {
  const abort = new AbortController();
  request.mockImplementation(async (path) => {
    if (path === "/")
      return {
        status: 200,
        data: { MediaContainer: { machineIdentifier: "server" } },
      };
    abort.abort();
    throw new Error("Aborted");
  });
  await expect(
    getServerSessionContext("token", abort.signal),
  ).rejects.toThrow();
});

it("finishes with server access when only the capability read reaches its deadline", async () => {
  vi.useFakeTimers();
  const session = new AbortController();
  let capabilitySignal!: AbortSignal;
  request.mockImplementation(async (path, _method, _headers, _body, signal) => {
    if (path === "/")
      return {
        status: 200,
        data: { MediaContainer: { machineIdentifier: "server" } },
      };
    capabilitySignal = signal!;
    return new Promise((_resolve, reject) =>
      signal!.addEventListener("abort", () => reject(signal!.reason), {
        once: true,
      }),
    );
  });
  try {
    const context = getServerSessionContext("token", session.signal);
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(context).resolves.toEqual({
      server: { machineIdentifier: "server" },
      providers: null,
      capabilitiesUnavailable: true,
    });
    expect(capabilitySignal.aborted).toBe(true);
    expect(session.signal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it("cancels unfinished capabilities immediately when server access fails", async () => {
  let capabilitySignal!: AbortSignal;
  request.mockImplementation(async (path, _method, _headers, _body, signal) => {
    if (path === "/") return { status: 401, data: {} };
    capabilitySignal = signal!;
    return new Promise((_resolve, reject) =>
      signal!.addEventListener("abort", () => reject(signal!.reason), {
        once: true,
      }),
    );
  });
  await expect(getServerSessionContext("token")).rejects.toMatchObject({
    status: 401,
  });
  expect(capabilitySignal.aborted).toBe(true);
});

it("propagates session cancellation to both reads while keeping it distinct from the optional deadline", async () => {
  const session = new AbortController();
  const signals: AbortSignal[] = [];
  request.mockImplementation(
    async (_path, _method, _headers, _body, signal) => {
      signals.push(signal!);
      return new Promise((_resolve, reject) =>
        signal!.addEventListener("abort", () => reject(signal!.reason), {
          once: true,
        }),
      );
    },
  );
  const context = getServerSessionContext("token", session.signal);
  session.abort();
  await expect(context).rejects.toMatchObject({ name: "AbortError" });
  expect(signals).toHaveLength(2);
  expect(signals.every((signal) => signal.aborted)).toBe(true);
});
