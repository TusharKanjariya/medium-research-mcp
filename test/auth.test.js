// Tests for shared/auth.js — one shared cached-token path for the Reddit password
// grant and the Lemmy login (CRED-02). fetch is injected so exchanges run entirely
// offline: NO real auth endpoint is ever contacted. node:test + node:assert (D-06).
//
// The load-bearing security assertion here is that the token cache holds the token
// ONLY — the password value must never appear in the cache entry, a log, or an error.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cachedToken, redditToken, lemmyJwt, tokenCache } from "../shared/auth.js";

const REDDIT_VARS = [
  "REDDIT_CLIENT_ID",
  "REDDIT_CLIENT_SECRET",
  "REDDIT_USERNAME",
  "REDDIT_PASSWORD",
];
const LEMMY_VARS = ["LEMMY_INSTANCE", "LEMMY_USERNAME", "LEMMY_PASSWORD"];
const ALL_VARS = [...REDDIT_VARS, ...LEMMY_VARS, "MCP_USER_AGENT"];

// Apply env vars over a cleared baseline, run the async fn, then restore.
async function withEnv(vars, fn) {
  const saved = {};
  for (const k of ALL_VARS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  for (const [k, v] of Object.entries(vars)) process.env[k] = v;
  try {
    return await fn();
  } finally {
    for (const k of ALL_VARS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

// A fake fetch returning a fixed ok/json response and recording each call.
function fetchOk(jsonBody) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, async json() { return jsonBody; } };
  };
  impl.calls = calls;
  return impl;
}

function fetchStatus(status) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return { ok: false, status, async json() { return {}; } };
  };
  impl.calls = calls;
  return impl;
}

// --- cachedToken shared path -------------------------------------------------
test("cachedToken returns the cached token on a second call within TTL and exchanges once", async () => {
  let exchanges = 0;
  const exchange = async () => {
    exchanges++;
    return { token: "tok-1" };
  };
  const key = "test:cached-once";
  const first = await cachedToken(key, 60_000, exchange);
  const second = await cachedToken(key, 60_000, exchange);
  assert.equal(first, "tok-1");
  assert.equal(second, "tok-1");
  assert.equal(exchanges, 1, "exchange must run exactly once within TTL");
});

test("cachedToken stores only { token, expires } — never any password-like extra field", async () => {
  const key = "test:token-only";
  await cachedToken(key, 60_000, async () => ({ token: "tok-only" }));
  const entry = tokenCache.get(key);
  assert.deepEqual(Object.keys(entry).sort(), ["expires", "token"]);
  assert.equal(entry.token, "tok-only");
  assert.equal(typeof entry.expires, "number");
});

// --- degrade to null when creds absent ---------------------------------------
test("redditToken() returns null when Reddit creds are absent (keyless degrade, D-04)", async () => {
  await withEnv({}, async () => {
    assert.equal(await redditToken(), null);
  });
});

test("lemmyJwt() returns null when Lemmy creds are absent (D-05)", async () => {
  await withEnv({}, async () => {
    assert.equal(await lemmyJwt(), null);
  });
});

// --- successful exchanges, password never cached -----------------------------
test("redditToken() returns the access_token and never caches the password", async () => {
  const SECRET_PW = "sup3r-secret-pw-REDDIT";
  await withEnv(
    {
      REDDIT_CLIENT_ID: "cid",
      REDDIT_CLIENT_SECRET: "csecret",
      REDDIT_USERNAME: "botuser",
      REDDIT_PASSWORD: SECRET_PW,
    },
    async () => {
      const fetchImpl = fetchOk({ access_token: "reddit-access-1", expires_in: 3600 });
      const token = await redditToken({ fetchImpl });
      assert.equal(token, "reddit-access-1");
      assert.equal(fetchImpl.calls.length, 1);

      // The cache entry must hold the token only — the password must be absent.
      const entry = tokenCache.get("reddit:botuser");
      assert.ok(entry, "a reddit cache entry should exist");
      assert.deepEqual(Object.keys(entry).sort(), ["expires", "token"]);
      assert.ok(
        !JSON.stringify(entry).includes(SECRET_PW),
        "password must never appear in the cache entry",
      );

      // Sanity: the password IS sent once in the outgoing request body (and nowhere else).
      const body = fetchImpl.calls[0].init.body.toString();
      assert.ok(body.includes(encodeURIComponent(SECRET_PW)) || body.includes(SECRET_PW));
    },
  );
});

test("lemmyJwt() returns the jwt and never caches the password", async () => {
  const SECRET_PW = "sup3r-secret-pw-LEMMY";
  await withEnv(
    {
      LEMMY_INSTANCE: "https://lemmy.test",
      LEMMY_USERNAME: "lemmyuser",
      LEMMY_PASSWORD: SECRET_PW,
    },
    async () => {
      const fetchImpl = fetchOk({ jwt: "lemmy-jwt-1" });
      const jwt = await lemmyJwt({ fetchImpl });
      assert.equal(jwt, "lemmy-jwt-1");

      const entry = tokenCache.get("lemmy:https://lemmy.test:lemmyuser");
      assert.ok(entry, "a lemmy cache entry should exist");
      assert.deepEqual(Object.keys(entry).sort(), ["expires", "token"]);
      assert.ok(
        !JSON.stringify(entry).includes(SECRET_PW),
        "password must never appear in the cache entry",
      );
    },
  );
});

// --- error path names status, not the password -------------------------------
test("a non-ok Reddit auth response throws an error that names the status, not the password", async () => {
  const SECRET_PW = "pw-should-not-leak-401";
  await withEnv(
    {
      REDDIT_CLIENT_ID: "cid",
      REDDIT_CLIENT_SECRET: "csecret",
      REDDIT_USERNAME: "botuser401",
      REDDIT_PASSWORD: SECRET_PW,
    },
    async () => {
      const fetchImpl = fetchStatus(401);
      await assert.rejects(
        () => redditToken({ fetchImpl }),
        (err) => {
          assert.ok(/401/.test(err.message), "error should name the status");
          assert.ok(
            !err.message.includes(SECRET_PW),
            "error message must not include the password",
          );
          return true;
        },
      );
      // A failed exchange must not leave a cache entry behind.
      assert.equal(tokenCache.get("reddit:botuser401"), undefined);
    },
  );
});

test("a non-ok Lemmy login response throws an error that names the status, not the password", async () => {
  const SECRET_PW = "pw-should-not-leak-403";
  await withEnv(
    {
      LEMMY_INSTANCE: "https://lemmy.test",
      LEMMY_USERNAME: "lemmyuser403",
      LEMMY_PASSWORD: SECRET_PW,
    },
    async () => {
      const fetchImpl = fetchStatus(403);
      await assert.rejects(
        () => lemmyJwt({ fetchImpl }),
        (err) => {
          assert.ok(/403/.test(err.message));
          assert.ok(!err.message.includes(SECRET_PW));
          return true;
        },
      );
    },
  );
});
