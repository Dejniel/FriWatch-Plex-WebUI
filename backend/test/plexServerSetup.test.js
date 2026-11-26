import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import https from "node:https";
import express from "express";
import axios from "axios";
import { createPlexServerSetupRouter } from "../dist/plexServerSetup.js";
import { readPlexServerSetup } from "@friwatch/contracts";

async function listen(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function setup(t, claimHandler) {
  const state = {
    serverId: "test-server",
    claimed: false,
    username: "owner@example.test",
    user: {
      id: 7,
      username: "Owner",
      email: "owner@example.test",
      restricted: false,
    },
    claims: 0,
    cloudReads: [],
    codes: [],
    afterClaimToken: undefined,
    afterAccountRead: undefined,
  };
  const upstream = await listen(t, async (req, res) => {
    const url = new URL(req.url, "http://plex");
    res.setHeader("Content-Type", "application/json");
    if (url.pathname === "/identity")
      return res.end(
        JSON.stringify({
          MediaContainer: {
            machineIdentifier: state.serverId,
            claimed: state.claimed,
          },
        }),
      );
    if (url.pathname === "/myplex/account") {
      assert.equal(req.headers["x-plex-token"], "account-fixture");
      const body = JSON.stringify({
        MyPlex: { username: state.username, signInState: "ok" },
      });
      state.afterAccountRead?.();
      return res.end(body);
    }
    if (url.pathname === "/myplex/claim") {
      state.claims++;
      assert.equal(req.method, "POST");
      assert.equal(url.searchParams.get("token"), "claim-fixture");
      assert.equal(req.headers["x-plex-token"], undefined);
      assert.equal(req.headers.cookie, undefined);
      if (claimHandler) return claimHandler(req, res, state);
      state.claimed = true;
      return res.end("{}");
    }
    res.writeHead(404).end("{}");
  });
  const get = axios.get;
  axios.get = async (url, config) => {
    if (!url.startsWith("https://plex.tv/")) return get(url, config);
    state.cloudReads.push(url);
    assert.equal(config.headers["X-Plex-Token"], "account-fixture");
    assert.equal(config.maxRedirects, 0);
    assert.equal(
      config.httpsAgent,
      undefined,
      "cloud TLS must not inherit PMS trust settings",
    );
    if (url.endsWith("/api/v2/user")) return { data: state.user };
    assert.equal(url, "https://plex.tv/api/claim/token.json");
    state.afterClaimToken?.();
    return { data: { token: "claim-fixture" } };
  };
  t.after(() => {
    axios.get = get;
  });
  const httpAgent = new http.Agent(),
    httpsAgent = new https.Agent();
  t.after(() => {
    httpAgent.destroy();
    httpsAgent.destroy();
  });
  const app = express();
  app.use(express.json());
  app.use(
    "/server-setup",
    createPlexServerSetupRouter({
      plexServer: upstream,
      httpAgent,
      httpsAgent,
      webUrl: "http://localhost:32401/web",
      onSetupCode: (serverId, code) => state.codes.push({ serverId, code }),
    }),
  );
  const url = (await listen(t, app)) + "/server-setup";
  const infoResponse = await fetch(url);
  const info = await infoResponse.json();
  const claim = (body = {}, headers = {}) =>
    fetch(url + "/claim", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Plex-Token": "account-fixture",
        ...headers,
      },
      body: JSON.stringify({
        serverId: "test-server",
        accountId: "7",
        setupCode: state.codes.at(-1)?.code,
        ...body,
      }),
    });
  const verify = () =>
    fetch(url + "/verification?serverId=test-server&accountId=7", {
      headers: { "X-Plex-Token": "account-fixture" },
    });
  return { state, info, infoResponse, claim, verify, url };
}

test("setup exposes identity and instructions but keeps installer proof out of HTTP", async (t) => {
  const { state, info, infoResponse, url } = await setup(t);
  assert.equal(info.state, "unclaimed");
  assert.equal(info.webUrl, "http://localhost:32401/web");
  assert.equal(infoResponse.headers.get("cache-control"), "no-store");
  assert.equal(state.codes.length, 1);
  assert.equal(JSON.stringify(info).includes(state.codes[0].code), false);
  await fetch(url);
  assert.equal(state.codes.length, 1);
  assert.equal(state.cloudReads.length, 0);
});

test("rejects wrong proof before contacting Plex account or claiming", async (t) => {
  const { state, claim } = await setup(t);
  const response = await claim({ setupCode: "incorrect" });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "setup_code_required");
  assert.equal(state.claims, 0);
  assert.equal(state.cloudReads.length, 0);
});

test("requires the expected unrestricted full account", async (t) => {
  const { state, claim } = await setup(t);
  assert.equal((await claim({}, { "X-Plex-Token": "" })).status, 401);
  assert.equal((await claim({ accountId: "8" })).status, 403);
  for (const field of ["restricted", "guest", "anonymous"]) {
    state.user[field] = true;
    assert.equal((await claim()).status, 403);
    delete state.user[field];
  }
  assert.equal(state.claims, 0);
  assert(!state.cloudReads.some((url) => url.includes("/claim/")));
});

test("links with a short-lived token and independently verifies the account", async (t) => {
  const { state, claim, verify } = await setup(t);
  const response = await claim();
  assert.equal(response.status, 200);
  assert.equal(readPlexServerSetup(await response.json()).state, "verified");
  const verified = await (await verify()).json();
  assert.equal(verified.accountId, "7");
  assert.equal(state.claims, 1);
  assert.equal(
    (await claim()).status,
    403,
    "a consumed code cannot repeat the claim",
  );
  assert.equal(state.claims, 1);
});

test("a definitive PMS rejection is retryable without leaking upstream errors", async (t) => {
  let reject = true;
  const { state, claim } = await setup(t, (_req, res, current) => {
    if (reject)
      return res.writeHead(403).end("secret claim-fixture account-fixture");
    current.claimed = true;
    res.end("{}");
  });
  const response = await claim();
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.code, "claim_rejected");
  assert.equal(body.mayHaveSubmitted, undefined);
  assert(!JSON.stringify(body).includes("fixture"));
  reject = false;
  assert.equal((await claim()).status, 200);
  assert.equal(state.claims, 2);
});

test("lost acknowledgement is verified instead of blindly repeated", async (t) => {
  const { state, claim } = await setup(t, (req, _res, current) => {
    current.claimed = true;
    req.socket.destroy();
  });
  assert.equal((await claim()).status, 200);
  assert.equal(state.claims, 1);
});

test("uncertain writes remain pending across reads; verification never repeats the write", async (t) => {
  const { state, claim, verify, url } = await setup(t, (req) =>
    req.socket.destroy(),
  );
  assert.equal((await claim()).status, 202);
  assert.equal((await (await fetch(url)).json()).state, "pending");
  assert.equal((await verify()).status, 202);
  const repeat = await claim();
  assert.equal((await repeat.json()).mayHaveSubmitted, true);
  assert.equal(state.claims, 1);
  state.claimed = true;
  assert.equal((await (await verify()).json()).state, "verified");
  assert.equal(state.claims, 1);
});

test("does not call claim when the target changes while getting authorization", async (t) => {
  const { state, claim } = await setup(t);
  state.afterClaimToken = () => {
    state.serverId = "replacement";
  };
  const response = await claim();
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "server_changed");
  assert.equal(state.claims, 0);
});

test("serializes submissions and keeps read-only verification available", async (t) => {
  let acknowledge;
  const waiting = new Promise((resolve) => {
    acknowledge = resolve;
  });
  const { state, claim, verify } = await setup(
    t,
    async (_req, res, current) => {
      await waiting;
      current.claimed = true;
      res.end("{}");
    },
  );
  const first = claim();
  for (let i = 0; i < 100 && state.claims === 0; i++)
    await new Promise((resolve) => setTimeout(resolve, 2));
  try {
    assert.equal(state.claims, 1);
    assert.equal((await claim()).status, 409);
    assert.equal((await verify()).status, 202);
  } finally {
    acknowledge();
  }
  assert.equal((await first).status, 200);
  assert.equal(state.claims, 1);
});

test("claimed flag alone is insufficient and a different owner is never reported as success", async (t) => {
  const { state, verify } = await setup(t);
  state.claimed = true;
  state.username = "";
  assert.equal((await verify()).status, 202);
  state.username = "someone-else";
  const response = await verify();
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "different_owner");
  assert.equal(state.claims, 0);
});

test("rejects malformed verified contracts and unsafe fallback URLs", () => {
  const value = {
    serverId: "server",
    serverUrl: "http://plex:32400",
    state: "verified",
    accountId: "7",
  };
  assert.equal(readPlexServerSetup(value).state, "verified");
  for (const change of [
    { accountId: undefined },
    { accountId: 7 },
    { state: "unknown" },
    { webUrl: "javascript:alert(1)" },
  ])
    assert.throws(() => readPlexServerSetup({ ...value, ...change }));
  assert.throws(() =>
    createPlexServerSetupRouter({
      plexServer: "http://plex:32400",
      webUrl: "http://user:secret@plex/web",
    }),
  );
});

for (const completion of ["claim response", "later verification"]) {
  test(`finishes the attempt after ${completion} and can link an explicitly unclaimed server again`, async (t) => {
    const { state, claim, verify, url } = await setup(
      t,
      completion === "later verification"
        ? (req) => req.socket.destroy()
        : undefined,
    );
    const oldCode = state.codes[0].code;
    const first = await claim();
    if (completion === "later verification") {
      assert.equal(first.status, 202);
      state.claimed = true;
      assert.equal((await (await verify()).json()).state, "verified");
    } else assert.equal((await first.json()).state, "verified");
    state.claimed = false;
    const info = await (await fetch(url)).json();
    assert.equal(info.state, "unclaimed");
    assert.equal(state.codes.length, 2);
    assert.notEqual(state.codes[1].code, oldCode);
    assert.equal((await claim({ setupCode: oldCode })).status, 403);
    assert.equal(state.claims, 1);
    // A new explicit submission uses the fresh installer code, never the consumed one.
    const second = await claim();
    assert.equal(
      second.status,
      completion === "later verification" ? 202 : 200,
    );
    assert.equal(state.claims, 2);
  });
}

test("rejects a replacement server after claim submission without verifying its owner", async (t) => {
  const { state, claim } = await setup(t, (_req, res, current) => {
    current.serverId = "replacement";
    current.claimed = true;
    res.end("{}");
  });
  const response = await claim();
  assert.equal(response.status, 409);
  const result = await response.json();
  assert.equal(result.code, "server_changed");
  assert.equal(result.mayHaveSubmitted, true);
  assert.equal(result.accountId, undefined);
  assert.equal(state.claims, 1);
});

test("rejects a server change during the ownership read", async (t) => {
  const { state, verify } = await setup(t);
  state.claimed = true;
  state.afterAccountRead = () => {
    state.serverId = "replacement";
  };
  const response = await verify();
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "server_changed");
  assert.equal(state.claims, 0);
});
