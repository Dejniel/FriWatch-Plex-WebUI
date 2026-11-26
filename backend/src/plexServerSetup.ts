import axios from "axios";
import express from "express";
import type http from "node:http";
import type https from "node:https";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { PlexServerSetup } from "@friwatch/contracts";
import { CheckPlexUser, isUnrestrictedPlexAccount } from "./common/plex.js";
import { createRequestScope } from "./common/requestScope.js";
import type { PerPlexed } from "./types.js";

interface Options {
  plexServer: string;
  httpAgent: http.Agent;
  httpsAgent: https.Agent;
  webUrl?: string;
  onSetupCode: (serverId: string, code: string) => void;
}

class SetupError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function accountNames(user: { username?: unknown; email?: unknown }) {
  return [user.username, user.email].flatMap((name) =>
    typeof name === "string" && name.trim() ? [name.trim().toLowerCase()] : [],
  );
}

function browserWebUrl(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    )
      return url.href;
  } catch {
    /* Report only the configuration name, without echoing a malformed URL. */
  }
  throw new Error(
    "PLEX_WEB_URL must be an HTTP(S) URL without credentials, query or fragment",
  );
}

/** Owns first-time linking only. Ordinary library/settings administration stays in its existing routers. */
export function createPlexServerSetupRouter(options: Options) {
  const router = express.Router();
  const serverUrl = new URL(options.plexServer).origin;
  const webUrl = browserWebUrl(options.webUrl);
  let challenge: { serverId: string; code: string } | undefined;
  // No credentials are retained. An uncertain write can only be verified, never automatically repeated.
  let submittedServerId: string | undefined;
  let busy = false;

  const nativeConfig = (signal: AbortSignal, token?: string) => ({
    signal,
    timeout: 10_000,
    maxRedirects: 0,
    httpAgent: options.httpAgent,
    httpsAgent: options.httpsAgent,
    headers: {
      Accept: "application/json",
      "X-Plex-Product": "FriWatch",
      "X-Plex-Client-Identifier": "friwatch-server-setup",
      ...(token && { "X-Plex-Token": token }),
    },
  });

  async function identity(signal: AbortSignal) {
    const response = await axios.get(
      `${serverUrl}/identity`,
      nativeConfig(signal),
    );
    const container = object(object(response.data).MediaContainer);
    const claimed = container.claimed;
    const knownClaimed = claimed === true || claimed === 1 || claimed === "1";
    const knownUnclaimed =
      claimed === false || claimed === 0 || claimed === "0";
    if (
      typeof container.machineIdentifier !== "string" ||
      !container.machineIdentifier.trim() ||
      (!knownClaimed && !knownUnclaimed)
    )
      throw new SetupError(
        502,
        "invalid_identity",
        "Plex returned incomplete server information.",
      );
    const result = {
      serverId: container.machineIdentifier,
      claimed: knownClaimed,
    };
    if (challenge && (result.claimed || challenge.serverId !== result.serverId))
      challenge = undefined;
    if (submittedServerId && submittedServerId !== result.serverId)
      submittedServerId = undefined;
    if (!result.claimed && !submittedServerId && !challenge) {
      challenge = {
        serverId: result.serverId,
        code: randomBytes(18).toString("base64url"),
      };
      options.onSetupCode(challenge.serverId, challenge.code);
    }
    return result;
  }

  function info(
    serverId: string,
    state: PlexServerSetup["state"],
    accountId?: string,
  ): PlexServerSetup {
    return {
      serverId,
      serverUrl,
      ...(webUrl && { webUrl }),
      state,
      ...(accountId && { accountId }),
    };
  }

  async function account(
    req: express.Request,
    accountId: unknown,
    signal: AbortSignal,
  ) {
    const token = req.get("X-Plex-Token");
    if (!token)
      throw new SetupError(
        401,
        "account_required",
        "Sign in to a full Plex account to link this server.",
      );
    const user = await CheckPlexUser(token, signal);
    signal.throwIfAborted();
    if (!user)
      throw new SetupError(
        401,
        "account_required",
        "The Plex account could not be verified. Sign in again.",
      );
    if (
      !isUnrestrictedPlexAccount(user) ||
      user.guest ||
      user.anonymous ||
      !Number.isSafeInteger(user.id) ||
      user.id <= 0 ||
      String(user.id) !== accountId ||
      !accountNames(user).length
    )
      throw new SetupError(
        403,
        "account_mismatch",
        "Use the full Plex account shown on this page to link the server.",
      );
    return { user, token, accountId: String(user.id) };
  }

  async function verify(
    current: { serverId: string; claimed: boolean },
    owner: { user: PerPlexed.PlexTV.User; token: string; accountId: string },
    signal: AbortSignal,
  ): Promise<PlexServerSetup> {
    if (!current.claimed)
      return info(
        current.serverId,
        submittedServerId ? "pending" : "unclaimed",
      );
    // Claim acknowledgement alone does not prove which account owns the server.
    try {
      const response = await axios.get(
        `${serverUrl}/myplex/account`,
        nativeConfig(signal, owner.token),
      );
      const plexAccount = object(object(response.data).MyPlex);
      const username =
        typeof plexAccount.username === "string"
          ? plexAccount.username.trim().toLowerCase()
          : "";
      if (username && plexAccount.signInState === "ok") {
        if (!accountNames(owner.user).includes(username))
          throw new SetupError(
            409,
            "different_owner",
            "This server is linked to another Plex account. Sign in with its owner.",
          );
        return info(current.serverId, "verified", owner.accountId);
      }
    } catch (error) {
      if (error instanceof SetupError) throw error;
      // PMS may report claimed before its account/token information becomes available.
    }
    return info(current.serverId, "pending");
  }

  function route(
    action: (
      req: express.Request,
      res: express.Response,
      signal: AbortSignal,
    ) => Promise<void>,
  ) {
    return async (req: express.Request, res: express.Response) => {
      res.setHeader("Cache-Control", "no-store");
      const scope = createRequestScope(req, res, 45_000);
      try {
        await action(req, res, scope.signal);
      } catch (error) {
        if (res.destroyed || res.headersSent) return;
        const known = error instanceof SetupError;
        res.status(known ? error.status : 502).json({
          code: known ? error.code : "setup_unavailable",
          error: known
            ? error.message
            : "FriWatch could not complete server setup. Check the connection and try again.",
          ...(submittedServerId && { mayHaveSubmitted: true }),
        });
      } finally {
        scope.dispose();
      }
    };
  }

  router.get(
    "/",
    route(async (_req, res, signal) => {
      const current = await identity(signal);
      res.json(
        info(
          current.serverId,
          current.claimed
            ? "claimed"
            : submittedServerId
              ? "pending"
              : "unclaimed",
        ),
      );
    }),
  );

  router.post(
    "/claim",
    route(async (req, res, signal) => {
      const { setupCode, serverId, accountId } = object(req.body);
      const proof =
        typeof setupCode === "string"
          ? Buffer.from(setupCode)
          : Buffer.alloc(0);
      const expected = Buffer.from(challenge?.code ?? "");
      if (
        !challenge ||
        challenge.serverId !== serverId ||
        !expected.length ||
        proof.length !== expected.length ||
        !timingSafeEqual(proof, expected)
      )
        throw new SetupError(
          403,
          "setup_code_required",
          "Enter the setup code from the FriWatch logs.",
        );
      if (busy || submittedServerId)
        throw new SetupError(
          409,
          "setup_pending",
          "A linking request is already in progress. Check its status.",
        );
      busy = true;
      try {
        let current = await identity(signal);
        if (current.serverId !== serverId || current.claimed)
          throw new SetupError(
            409,
            "server_changed",
            "The server changed or is already linked. Check its status.",
          );
        const owner = await account(req, accountId, signal);
        const response = await axios.get(
          "https://plex.tv/api/claim/token.json",
          {
            headers: {
              "X-Plex-Token": owner.token,
              Accept: "application/json",
            },
            timeout: 10_000,
            maxRedirects: 0,
            signal,
          },
        );
        const claimToken = object(response.data).token;
        if (
          typeof claimToken !== "string" ||
          !/^claim-[\w-]+$/.test(claimToken)
        )
          throw new SetupError(
            502,
            "claim_token_failed",
            "Plex did not authorize server linking. Try again.",
          );
        current = await identity(signal);
        if (current.serverId !== serverId || current.claimed)
          throw new SetupError(
            409,
            "server_changed",
            "The server changed or is already linked. Check its status.",
          );
        signal.throwIfAborted();
        submittedServerId = current.serverId;
        try {
          await axios.post(`${serverUrl}/myplex/claim`, undefined, {
            ...nativeConfig(signal),
            params: { token: claimToken },
          });
        } catch (error) {
          // A definite rejection is safe to retry. A dropped response might have completed the write.
          if (
            axios.isAxiosError(error) &&
            error.response &&
            error.response.status >= 400 &&
            error.response.status < 500
          ) {
            submittedServerId = undefined;
            throw new SetupError(
              409,
              "claim_rejected",
              "Plex refused to link this server. Check the local network instructions below.",
            );
          }
        }
        challenge = undefined;
        let result = info(current.serverId, "pending");
        if (!signal.aborted) {
          try {
            result = await verify(await identity(signal), owner, signal);
          } catch (error) {
            if (error instanceof SetupError) throw error;
          }
        }
        res.status(result.state === "verified" ? 200 : 202).json(result);
      } finally {
        busy = false;
      }
    }),
  );

  router.get(
    "/verification",
    route(async (req, res, signal) => {
      const owner = await account(req, req.query.accountId, signal);
      const current = await identity(signal);
      if (current.serverId !== req.query.serverId)
        throw new SetupError(
          409,
          "server_changed",
          "The configured server changed. Reload this page.",
        );
      const result = await verify(current, owner, signal);
      res.status(result.state === "pending" ? 202 : 200).json(result);
    }),
  );

  return router;
}
