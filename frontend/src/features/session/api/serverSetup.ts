import { readPlexServerSetup } from "@friwatch/contracts";
import axios from "axios";
import { AuthStorage } from "../model/authStorage";
import { useAuthSession } from "../model/authSession";

export class ServerSetupError extends Error {
  constructor(
    message: string,
    readonly mayHaveSubmitted = false,
  ) {
    super(message);
  }
}

/** Setup precedes a server session; capture the main login account, never a managed Home profile. */
export function createServerSetupClient(
  revision = useAuthSession.getState().revision,
  ownerId = useAuthSession.getState().ownerUser?.id,
) {
  const completeAccountLogin = useAuthSession.getState().completeAccountLogin;
  const token = AuthStorage.getOwnerToken();
  const accountId = String(ownerId ?? "");
  const isCurrent = () => {
    const state = useAuthSession.getState();
    return Boolean(
      token &&
      state.status === "serverSetup" &&
      state.revision === revision &&
      String(state.ownerUser?.id) === accountId &&
      AuthStorage.getOwnerToken() === token,
    );
  };
  const assertCurrent = () => {
    if (!isCurrent())
      throw new DOMException("The Plex account changed.", "AbortError");
  };

  async function request(path: string, signal: AbortSignal, body?: object) {
    assertCurrent();
    let response;
    try {
      response = await axios.request({
        url: `/server-setup${path}`,
        method: body ? "POST" : "GET",
        headers: {
          "X-Plex-Token": token!,
          ...(body && { "Content-Type": "application/json" }),
        },
        data: body,
        signal,
        timeout: 50_000,
        validateStatus: () => true,
      });
    } catch {
      assertCurrent();
      throw new ServerSetupError(
        "The setup response could not be read. Check the server status before trying again.",
        Boolean(body),
      );
    }
    assertCurrent();
    if (response.status < 200 || response.status >= 300) {
      const error = response.data as {
        error?: unknown;
        mayHaveSubmitted?: unknown;
      };
      throw new ServerSetupError(
        typeof error?.error === "string"
          ? error.error
          : "Server setup failed. Try again.",
        error?.mayHaveSubmitted === true,
      );
    }
    try {
      const result = readPlexServerSetup(response.data);
      if (result.state === "verified" && result.accountId !== accountId)
        throw new Error("Account mismatch");
      return result;
    } catch {
      throw new ServerSetupError(
        "Plex returned incomplete setup information. Check the server status.",
        Boolean(body),
      );
    }
  }

  return {
    accountId,
    isCurrent,
    info: (signal: AbortSignal) => request("", signal),
    claim: (serverId: string, setupCode: string, signal: AbortSignal) =>
      request("/claim", signal, { serverId, accountId, setupCode }),
    verify: (serverId: string, signal: AbortSignal) =>
      request(
        `/verification?${new URLSearchParams({ serverId, accountId })}`,
        signal,
      ),
    continue: async () => {
      assertCurrent();
      // Re-enter normal Home selection/PIN checks and resolve a fresh server token.
      await completeAccountLogin(token!);
    },
  };
}
