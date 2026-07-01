// Tests for shared/credentials.js — the single process.env reader (CRED-01, CRED-04).
//
// credentials.js reads process.env lazily (per call), so each test sets/clears the
// relevant env vars, exercises the helper, and restores the prior environment after.
// No network, no external deps (node:test + node:assert, D-06).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  requireCred,
  stackExchangeParams,
  githubHeaders,
  librariesIoParams,
  productHuntHeaders,
  userAgent,
  redditCreds,
  lemmyCreds,
} from "../shared/credentials.js";

// Every ENV_VAR credentials.js knows about — cleared before each case so a stray
// value in the ambient environment can't make a test pass or fail spuriously.
const ALL_VARS = [
  "STACKEXCHANGE_KEY",
  "GITHUB_TOKEN",
  "LIBRARIESIO_KEY",
  "PRODUCTHUNT_TOKEN",
  "REDDIT_CLIENT_ID",
  "REDDIT_CLIENT_SECRET",
  "REDDIT_USERNAME",
  "REDDIT_PASSWORD",
  "LEMMY_INSTANCE",
  "LEMMY_USERNAME",
  "LEMMY_PASSWORD",
  "MCP_USER_AGENT",
];

// Run `fn` with the given env vars applied on top of a cleared baseline, then
// restore whatever was there before. Returns fn's return value.
function withEnv(vars, fn) {
  const saved = {};
  for (const k of ALL_VARS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  for (const [k, v] of Object.entries(vars)) process.env[k] = v;
  try {
    return fn();
  } finally {
    for (const k of ALL_VARS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

// --- requireCred / required sources (CRED-04) ---------------------------------
test("requireCred throws an error naming the ENV_VAR when the credential is unset", () => {
  withEnv({}, () => {
    assert.throws(() => requireCred("librariesIoKey"), /LIBRARIESIO_KEY/);
  });
});

test("requireCred returns the value when the credential is set", () => {
  withEnv({ LIBRARIESIO_KEY: "lib-123" }, () => {
    assert.equal(requireCred("librariesIoKey"), "lib-123");
  });
});

test("librariesIoParams throws naming LIBRARIESIO_KEY when unset (required)", () => {
  withEnv({}, () => {
    assert.throws(() => librariesIoParams(), /LIBRARIESIO_KEY/);
  });
});

test("librariesIoParams returns { api_key } when the key is set", () => {
  withEnv({ LIBRARIESIO_KEY: "lib-123" }, () => {
    assert.deepEqual(librariesIoParams(), { api_key: "lib-123" });
  });
});

test("productHuntHeaders throws naming PRODUCTHUNT_TOKEN when unset (required)", () => {
  withEnv({}, () => {
    assert.throws(() => productHuntHeaders(), /PRODUCTHUNT_TOKEN/);
  });
});

test("productHuntHeaders returns a Bearer Authorization header when the token is set", () => {
  withEnv({ PRODUCTHUNT_TOKEN: "ph-abc" }, () => {
    assert.deepEqual(productHuntHeaders(), { Authorization: "Bearer ph-abc" });
  });
});

// --- optional sources degrade to {} (CRED-01) --------------------------------
test("stackExchangeParams returns {} when STACKEXCHANGE_KEY is unset (degrade)", () => {
  withEnv({}, () => {
    assert.deepEqual(stackExchangeParams(), {});
  });
});

test("stackExchangeParams returns { key } when STACKEXCHANGE_KEY is set", () => {
  withEnv({ STACKEXCHANGE_KEY: "se-key" }, () => {
    assert.deepEqual(stackExchangeParams(), { key: "se-key" });
  });
});

test("githubHeaders returns {} when GITHUB_TOKEN is unset (degrade)", () => {
  withEnv({}, () => {
    assert.deepEqual(githubHeaders(), {});
  });
});

test("githubHeaders returns a Bearer Authorization header when GITHUB_TOKEN is set", () => {
  withEnv({ GITHUB_TOKEN: "gh-tok" }, () => {
    assert.deepEqual(githubHeaders(), { Authorization: "Bearer gh-tok" });
  });
});

// --- Reddit creds resolve only when ALL four present (D-03/D-04) --------------
test("redditCreds returns undefined unless all four Reddit vars are present", () => {
  withEnv(
    {
      REDDIT_CLIENT_ID: "id",
      REDDIT_CLIENT_SECRET: "secret",
      REDDIT_USERNAME: "user",
      // REDDIT_PASSWORD intentionally missing
    },
    () => {
      assert.equal(redditCreds(), undefined);
    },
  );
});

test("redditCreds returns an object when all four Reddit vars are present", () => {
  withEnv(
    {
      REDDIT_CLIENT_ID: "id",
      REDDIT_CLIENT_SECRET: "secret",
      REDDIT_USERNAME: "user",
      REDDIT_PASSWORD: "pass",
    },
    () => {
      assert.deepEqual(redditCreds(), {
        id: "id",
        secret: "secret",
        user: "user",
        pass: "pass",
      });
    },
  );
});

// --- Lemmy creds require instance + username + password (D-05) ----------------
test("lemmyCreds returns undefined unless instance + username + password all present", () => {
  withEnv(
    { LEMMY_INSTANCE: "https://lemmy.test", LEMMY_USERNAME: "user" },
    () => {
      assert.equal(lemmyCreds(), undefined);
    },
  );
});

test("lemmyCreds returns an object when instance + username + password are present", () => {
  withEnv(
    {
      LEMMY_INSTANCE: "https://lemmy.test",
      LEMMY_USERNAME: "user",
      LEMMY_PASSWORD: "pass",
    },
    () => {
      assert.deepEqual(lemmyCreds(), {
        instance: "https://lemmy.test",
        user: "user",
        pass: "pass",
      });
    },
  );
});

// --- userAgent has a non-blank default (Reddit requires a real UA) ------------
test("userAgent returns a non-blank default when MCP_USER_AGENT is unset", () => {
  withEnv({}, () => {
    const ua = userAgent();
    assert.equal(typeof ua, "string");
    assert.ok(ua.trim().length > 0, "default User-Agent must be non-blank");
  });
});

test("userAgent returns the configured value when MCP_USER_AGENT is set", () => {
  withEnv({ MCP_USER_AGENT: "my-agent/2.0" }, () => {
    assert.equal(userAgent(), "my-agent/2.0");
  });
});
