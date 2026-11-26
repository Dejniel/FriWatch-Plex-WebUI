import { create } from "zustand";
import { getServerSessionContext } from "../api/server";
import { AuthStorage } from "./authStorage";
import { hasPlexFeature } from "./serverCapabilities";
import { authErrorMessage, UnclaimedPlexServerError } from "./authError";
import { PlexRequestError } from "shared/api/PlexClient";

interface ServerSessionProblem {
  message: string;
  recovery: "session" | "server";
}

interface ServerSessionState {
  sessionID: string;
  plexSessionID: string;
  server: Plex.ServerPreferences | null;
  canManageServer: boolean;
  status: "idle" | "loading" | "ready" | "error";
  error: ServerSessionProblem | null;
  generateSessionID: () => void;
  refresh: () => Promise<void>;
  reset: () => void;
}

function randomID(length = 24) {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const values = new Uint8Array(length);
  if (globalThis.crypto?.getRandomValues)
    globalThis.crypto.getRandomValues(values);
  else
    values.forEach(
      (_, index) => (values[index] = Math.floor(Math.random() * 256)),
    );
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join(
    "",
  );
}

let refreshGeneration = 0;
let refreshRequest: AbortController | null = null;

export const useServerSession = create<ServerSessionState>((set, get) => ({
  sessionID: randomID(),
  plexSessionID: randomID(),
  server: null,
  canManageServer: false,
  status: "idle",
  error: null,

  generateSessionID: () =>
    set({ sessionID: randomID(), plexSessionID: randomID() }),

  refresh: async () => {
    const generation = ++refreshGeneration;
    refreshRequest?.abort();
    const token = AuthStorage.getServerToken();
    if (!token) {
      refreshRequest = null;
      set({
        server: null,
        canManageServer: false,
        status: "error",
        error: {
          message: "Sign in to Plex again to connect to this server.",
          recovery: "session",
        },
      });
      return;
    }
    const request = new AbortController();
    refreshRequest = request;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      request.abort();
    }, 20_000);
    set({ status: get().server ? "ready" : "loading", error: null });
    try {
      const context = await getServerSessionContext(token, request.signal);
      if (
        generation !== refreshGeneration ||
        AuthStorage.getServerToken() !== token
      )
        return;
      request.signal.throwIfAborted();
      set({
        server: context.server,
        canManageServer: hasPlexFeature(context.providers, "manage"),
        status: "ready",
        error: null,
      });
    } catch (error) {
      if (
        generation !== refreshGeneration ||
        (request.signal.aborted && !timedOut) ||
        AuthStorage.getServerToken() !== token
      )
        return;
      set({
        status: get().server ? "ready" : "error",
        error: {
          message: timedOut
            ? "Plex took too long to respond. Try again."
            : authErrorMessage(error, "server"),
          recovery:
            error instanceof UnclaimedPlexServerError ||
            (error instanceof PlexRequestError &&
              [401, 403].includes(error.status))
              ? "session"
              : "server",
        },
      });
    } finally {
      clearTimeout(timeout);
      request.abort();
      if (refreshRequest === request) refreshRequest = null;
    }
  },

  reset: () => {
    refreshGeneration += 1;
    refreshRequest?.abort();
    refreshRequest = null;
    set({ server: null, canManageServer: false, status: "idle", error: null });
  },
}));
