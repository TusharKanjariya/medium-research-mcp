// Tests for shared/http_client.js getJson() — cache + retry/backoff + timeout + stale
// fallback (FOUND-02). STRICT no-4xx-retry (ARCHITECTURE §8 / ROADMAP SC2).
// fetch and sleep are injected so no real network and no real waiting occur.
import { test } from "node:test";
import assert from "node:assert/strict";
import { getJson, postJson, getText, assertSafeUrl } from "../shared/http_client.js";
import { set as cacheSet } from "../shared/cache.js";

// --- helpers -------------------------------------------------------------
function res(status, data, { throwJson = false } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      if (throwJson) throw new SyntaxError("Unexpected token < in JSON");
      return data;
    },
  };
}

// A Response-like object for the guarded (untrustedHost) getJson path: unlike
// res() it exposes headers.get() so the content-type gate can read content-type,
// and a Location header for 3xx redirect re-validation cases. Mirrors textRes's
// headers.get shim (below) plus a content-type key and an async json().
function jsonRes(status, data, { ct = "application/json", location } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (k) => {
        const key = String(k).toLowerCase();
        if (key === "content-type") return ct;
        if (key === "location") return location ?? null;
        return null;
      },
    },
    async json() {
      return data;
    },
  };
}

// Returns a fetch stub that yields queued responses in order; the last entry
// repeats for any further calls. Each entry may be a Response-like object or a
// function to invoke (e.g. to throw a network error).
function fetchStub(queue) {
  let i = 0;
  const stub = async () => {
    stub.calls++;
    const entry = queue[Math.min(i, queue.length - 1)];
    i++;
    if (typeof entry === "function") return entry();
    return entry;
  };
  stub.calls = 0;
  return stub;
}

function sleepSpy() {
  const waited = [];
  const sleep = async (ms) => {
    waited.push(ms);
  };
  sleep.waited = waited;
  return sleep;
}

// --- caching -------------------------------------------------------------
test("an in-TTL repeated getJson() is served from cache — fetch runs exactly once", async () => {
  const fetchImpl = fetchStub([res(200, { hit: "value" })]);
  const opts = { fetchImpl, cacheKey: "http:cache-hit", sleep: sleepSpy() };
  const first = await getJson("https://example.test/a", opts);
  const second = await getJson("https://example.test/a", opts);
  assert.deepEqual(first, { hit: "value" });
  assert.deepEqual(second, { hit: "value" });
  assert.equal(fetchImpl.calls, 1, "second call must be cache-served");
});

// --- retry / backoff -----------------------------------------------------
test("a 500 then 200 sequence retries once and resolves; first backoff step is 500ms", async () => {
  const fetchImpl = fetchStub([res(500, null), res(200, { ok: true })]);
  const sleep = sleepSpy();
  const out = await getJson("https://example.test/retry-500", {
    fetchImpl,
    sleep,
    cacheKey: "http:retry-500",
  });
  assert.deepEqual(out, { ok: true });
  assert.equal(fetchImpl.calls, 2);
  assert.deepEqual(sleep.waited, [500]);
});

test("exhausting retries on repeated 5xx uses the full backoff schedule [500,1000,2000]", async () => {
  const fetchImpl = fetchStub([res(503, null)]); // always 503
  const sleep = sleepSpy();
  await assert.rejects(
    () =>
      getJson("https://example.test/always-503", {
        fetchImpl,
        sleep,
        cacheKey: "http:always-503",
      }),
    /503/,
  );
  assert.equal(fetchImpl.calls, 4, "1 initial + 3 retries");
  assert.deepEqual(sleep.waited, [500, 1000, 2000]);
});

test("a network TypeError is retried, then a 200 resolves", async () => {
  const fetchImpl = fetchStub([
    () => {
      throw new TypeError("fetch failed");
    },
    res(200, { recovered: true }),
  ]);
  const sleep = sleepSpy();
  const out = await getJson("https://example.test/net", {
    fetchImpl,
    sleep,
    cacheKey: "http:net",
  });
  assert.deepEqual(out, { recovered: true });
  assert.equal(fetchImpl.calls, 2);
  assert.deepEqual(sleep.waited, [500]);
});

// --- strict no-4xx-retry -------------------------------------------------
test("a 404 is NOT retried and surfaces an error (fetch called once)", async () => {
  const fetchImpl = fetchStub([res(404, null)]);
  const sleep = sleepSpy();
  await assert.rejects(
    () =>
      getJson("https://example.test/404", {
        fetchImpl,
        sleep,
        cacheKey: "http:404",
      }),
    /404/,
  );
  assert.equal(fetchImpl.calls, 1);
  assert.deepEqual(sleep.waited, []);
});

test("a 400 is NOT retried and surfaces an error (fetch called once)", async () => {
  const fetchImpl = fetchStub([res(400, null)]);
  const sleep = sleepSpy();
  await assert.rejects(
    () =>
      getJson("https://example.test/400", { fetchImpl, sleep, cacheKey: "http:400" }),
    /400/,
  );
  assert.equal(fetchImpl.calls, 1);
});

test("a 429 is NOT retried — strict no-4xx-retry (fetch called once)", async () => {
  const fetchImpl = fetchStub([res(429, null)]);
  const sleep = sleepSpy();
  await assert.rejects(
    () =>
      getJson("https://example.test/429", { fetchImpl, sleep, cacheKey: "http:429" }),
    /429/,
  );
  assert.equal(fetchImpl.calls, 1, "429 must never be retried");
  assert.deepEqual(sleep.waited, []);
});

test("a 408 is NOT retried — strict no-4xx-retry (fetch called once)", async () => {
  const fetchImpl = fetchStub([res(408, null)]);
  const sleep = sleepSpy();
  await assert.rejects(
    () =>
      getJson("https://example.test/408", { fetchImpl, sleep, cacheKey: "http:408" }),
    /408/,
  );
  assert.equal(fetchImpl.calls, 1, "408 must never be retried");
});

// --- WR-01: credential/query-string redaction in error messages ----------
test("getJson error message strips the URL query string so a key= secret cannot leak (WR-01)", async () => {
  const fetchImpl = fetchStub([res(404, null)]);
  await assert.rejects(
    () =>
      getJson("https://example.test/questions/42?site=so&key=SUPER_SECRET_KEY", {
        fetchImpl,
        sleep: sleepSpy(),
        cacheKey: "http:redact-get",
      }),
    (err) => {
      assert.ok(!/SUPER_SECRET_KEY/.test(err.message), "secret must NOT appear in error");
      assert.ok(!/\?/.test(err.message), "query string dropped entirely");
      assert.ok(/example\.test\/questions\/42/.test(err.message), "path preserved");
      return true;
    },
  );
});

test("postJson error message strips the URL query string too (WR-01 parity)", async () => {
  const fetchImpl = fetchStub([res(400, null)]);
  await assert.rejects(
    () =>
      postJson("https://gql.test/graphql?token=SUPER_SECRET_TOKEN", {
        fetchImpl,
        sleep: sleepSpy(),
        body: { q: 1 },
        cacheKey: "http:redact-post",
      }),
    (err) => {
      assert.ok(!/SUPER_SECRET_TOKEN/.test(err.message), "secret must NOT appear in error");
      return true;
    },
  );
});

// --- stale fallback ------------------------------------------------------
test("on total failure a previously cached (now stale) value is returned instead of throwing", async () => {
  cacheSet("http:stale", { cached: "old" }, -1000); // seed an expired entry
  const fetchImpl = fetchStub([res(500, null)]); // always fails
  const sleep = sleepSpy();
  const out = await getJson("https://example.test/stale", {
    fetchImpl,
    sleep,
    cacheKey: "http:stale",
  });
  assert.deepEqual(out, { cached: "old" }, "stale value served on total failure");
  assert.equal(fetchImpl.calls, 4, "retries were attempted before falling back to stale");
});

// --- WR-04: a hard 4xx must NOT be served from stale cache ----------------
test("a 404 is NOT served from stale cache even when a stale entry exists — it throws (WR-04)", async () => {
  cacheSet("http:stale-404", { cached: "deleted-resource" }, -1000); // expired seed
  const fetchImpl = fetchStub([res(404, null)]); // resource now gone
  const sleep = sleepSpy();
  await assert.rejects(
    () =>
      getJson("https://example.test/gone", {
        fetchImpl,
        sleep,
        cacheKey: "http:stale-404",
      }),
    /404/,
    "a definitive 404 must surface, not serve a stale (deleted) body forever",
  );
  assert.equal(fetchImpl.calls, 1, "404 not retried");
});

test("a 400 is NOT served from stale cache either (WR-04)", async () => {
  cacheSet("http:stale-400", { cached: "old" }, -1000);
  const fetchImpl = fetchStub([res(400, null)]);
  const sleep = sleepSpy();
  await assert.rejects(
    () =>
      getJson("https://example.test/bad", {
        fetchImpl,
        sleep,
        cacheKey: "http:stale-400",
      }),
    /400/,
  );
});

test("a still-transient 5xx STILL serves stale (WR-04 preserves the resilience contract)", async () => {
  cacheSet("http:stale-5xx", { cached: "good" }, -1000);
  const fetchImpl = fetchStub([res(503, null)]);
  const sleep = sleepSpy();
  const out = await getJson("https://example.test/blip", {
    fetchImpl,
    sleep,
    cacheKey: "http:stale-5xx",
  });
  assert.deepEqual(out, { cached: "good" }, "transient 5xx still falls back to stale");
});

test("postJson does NOT serve stale on a hard 400 (WR-04 parity)", async () => {
  cacheSet("post:stale-400", { data: { cached: "old" } }, -1000);
  const fetchImpl = fetchStub([res(400, null)]);
  const sleep = sleepSpy();
  await assert.rejects(
    () =>
      postJson("https://gql.test/gone", {
        fetchImpl,
        sleep,
        body: { q: 1 },
        cacheKey: "post:stale-400",
      }),
    /400/,
  );
  assert.equal(fetchImpl.calls, 1);
});

// --- non-JSON body -------------------------------------------------------
test("a non-JSON body (res.json throws) is a failed attempt — retried, never an uncaught crash", async () => {
  const fetchImpl = fetchStub([res(200, null, { throwJson: true })]); // always bad body
  const sleep = sleepSpy();
  await assert.rejects(
    () =>
      getJson("https://example.test/badjson", {
        fetchImpl,
        sleep,
        cacheKey: "http:badjson",
      }),
    /badjson/,
  );
  assert.equal(fetchImpl.calls, 4, "non-JSON body is treated as a retryable failed attempt");
  assert.deepEqual(sleep.waited, [500, 1000, 2000]);
});

// ========================================================================
// postJson() — POST + JSON body reusing the SAME cache/retry/stale machinery,
// with a body-aware cache key so distinct GraphQL queries never collide.
// ========================================================================

// A fetch stub that ALSO records the (url, init) of every call so we can assert
// the POST request shape (method/headers/body).
function capturingStub(queue) {
  const stub = async (url, init) => {
    stub.calls++;
    stub.inits.push(init);
    stub.urls.push(url);
    const entry = queue[Math.min(stub.calls - 1, queue.length - 1)];
    if (typeof entry === "function") return entry();
    return entry;
  };
  stub.calls = 0;
  stub.inits = [];
  stub.urls = [];
  return stub;
}

// --- caching -------------------------------------------------------------
test("an in-TTL repeated postJson() with the same body is served from cache — fetch runs once", async () => {
  const fetchImpl = fetchStub([res(200, { data: { ok: true } })]);
  const opts = {
    fetchImpl,
    sleep: sleepSpy(),
    body: { query: "{ feed }", variables: { first: 5 } },
  };
  const first = await postJson("https://gql.test/graphql", opts);
  const second = await postJson("https://gql.test/graphql", opts);
  assert.deepEqual(first, { data: { ok: true } });
  assert.deepEqual(second, { data: { ok: true } });
  assert.equal(fetchImpl.calls, 1, "identical body must be cache-served");
});

test("two postJson() calls to the same URL with DIFFERENT bodies do not collide (both fetch)", async () => {
  // Distinct payloads => distinct url+sha1(body) keys => two network calls.
  const fetchImpl = fetchStub([
    res(200, { data: { which: "A" } }),
    res(200, { data: { which: "B" } }),
  ]);
  const sleep = sleepSpy();
  const url = "https://gql.test/graphql";
  const a = await postJson(url, { fetchImpl, sleep, body: { query: "A" } });
  const b = await postJson(url, { fetchImpl, sleep, body: { query: "B" } });
  assert.deepEqual(a, { data: { which: "A" } });
  assert.deepEqual(b, { data: { which: "B" } });
  assert.equal(fetchImpl.calls, 2, "different bodies must not share a cache key");
});

// --- POST request shape --------------------------------------------------
test("postJson() issues a POST with a JSON string body and Content-Type application/json", async () => {
  const fetchImpl = capturingStub([res(200, { data: {} })]);
  const body = { query: "{ post(id: 1) }", variables: { id: "1" } };
  await postJson("https://gql.test/graphql", {
    fetchImpl,
    sleep: sleepSpy(),
    body,
    cacheKey: "post:shape", // explicit key keeps this test isolated
  });
  const init = fetchImpl.inits[0];
  assert.equal(init.method, "POST");
  assert.equal(init.headers["Content-Type"], "application/json");
  assert.equal(typeof init.body, "string", "body is a JSON string");
  assert.deepEqual(JSON.parse(init.body), body);
});

test("postJson() merges caller headers alongside the JSON Content-Type", async () => {
  const fetchImpl = capturingStub([res(200, { data: {} })]);
  await postJson("https://gql.test/graphql", {
    fetchImpl,
    sleep: sleepSpy(),
    body: { query: "{}" },
    headers: { Authorization: "Bearer x" },
    cacheKey: "post:headers",
  });
  const init = fetchImpl.inits[0];
  assert.equal(init.headers["Content-Type"], "application/json");
  assert.equal(init.headers.Authorization, "Bearer x");
});

// --- retry / no-4xx-retry parity with getJson ----------------------------
test("postJson() retries a 500 then resolves on 200 (backoff parity with getJson)", async () => {
  const fetchImpl = fetchStub([res(500, null), res(200, { data: { ok: true } })]);
  const sleep = sleepSpy();
  const out = await postJson("https://gql.test/retry", {
    fetchImpl,
    sleep,
    body: { q: 1 },
    cacheKey: "post:retry-500",
  });
  assert.deepEqual(out, { data: { ok: true } });
  assert.equal(fetchImpl.calls, 2);
  assert.deepEqual(sleep.waited, [500]);
});

test("postJson() does NOT retry a 400 (strict no-4xx-retry parity)", async () => {
  const fetchImpl = fetchStub([res(400, null)]);
  const sleep = sleepSpy();
  await assert.rejects(
    () =>
      postJson("https://gql.test/400", {
        fetchImpl,
        sleep,
        body: { q: 1 },
        cacheKey: "post:400",
      }),
    /400/,
  );
  assert.equal(fetchImpl.calls, 1);
  assert.deepEqual(sleep.waited, []);
});

test("postJson() serves a stale entry on total failure instead of throwing", async () => {
  cacheSet("post:stale", { data: { cached: "old" } }, -1000); // expired seed
  const fetchImpl = fetchStub([res(503, null)]); // always fails
  const sleep = sleepSpy();
  const out = await postJson("https://gql.test/stale", {
    fetchImpl,
    sleep,
    body: { q: 1 },
    cacheKey: "post:stale",
  });
  assert.deepEqual(out, { data: { cached: "old" } });
  assert.equal(fetchImpl.calls, 4, "retries attempted before stale fallback");
});

// ========================================================================
// assertSafeUrl() — SSRF guard: scheme allowlist (D-01), private-range
// denylist (D-02), optional RSS_ALLOWED_HOSTS allowlist (D-03). `lookup` is
// injected so every case runs offline (no real DNS).
// ========================================================================

// Injected resolvers.
const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];
const privateLookup = async () => [{ address: "10.0.0.5", family: 4 }];
const mappedMetadataLookup = async () => [
  { address: "::ffff:169.254.169.254", family: 6 },
];
// Proves the IP-literal path never touches DNS.
const noLookup = async () => {
  throw new Error("DNS lookup must not be called for an IP-literal host");
};

// ========================================================================
// Guarded getJson() — the opt-in untrustedHost SSRF path (SEC-01). Reuses the
// SAME assertSafeUrl denylist + per-hop redirect re-validation as getText, plus
// a content-type gate (D-03). All offline: fetchImpl/sleep/lookup injected,
// resolvers reused from above, each case uses a distinct cacheKey.
// ========================================================================

// 1. IP-literal metadata host is blocked before any fetch (no DNS).
test("getJson untrustedHost rejects the 169.254.169.254 metadata IP before fetching (D-02)", async () => {
  const fetchImpl = fetchStub([jsonRes(200, { should: "never-read" })]);
  await assert.rejects(
    () =>
      getJson("http://169.254.169.254/x", {
        fetchImpl,
        sleep: sleepSpy(),
        lookup: noLookup,
        untrustedHost: true,
        cacheKey: "gj:meta-literal",
      }),
    /blocked address/,
  );
  assert.equal(fetchImpl.calls, 0, "no fetch for a blocked IP-literal host");
});

// 2. IP-literal loopback is blocked (no DNS).
test("getJson untrustedHost rejects http://127.0.0.1 loopback (D-02)", async () => {
  const fetchImpl = fetchStub([jsonRes(200, { should: "never-read" })]);
  await assert.rejects(
    () =>
      getJson("http://127.0.0.1/x", {
        fetchImpl,
        sleep: sleepSpy(),
        lookup: noLookup,
        untrustedHost: true,
        cacheKey: "gj:loopback-literal",
      }),
    /blocked address/,
  );
  assert.equal(fetchImpl.calls, 0);
});

// 3. Public hostname whose DNS resolves to a private IP is blocked before fetch.
test("getJson untrustedHost rejects a public host resolving to a private IP (D-02)", async () => {
  const fetchImpl = fetchStub([jsonRes(200, { should: "never-read" })]);
  await assert.rejects(
    () =>
      getJson("http://intranet.example.test/x", {
        fetchImpl,
        sleep: sleepSpy(),
        lookup: privateLookup,
        untrustedHost: true,
        cacheKey: "gj:private-resolve",
      }),
    /blocked address/,
  );
  assert.equal(fetchImpl.calls, 0, "no fetch when the resolved address is private");
});

// 4. Content-type gate: an HTML 200 is a terminal login-required error — NOT
// retried and NOT served from stale.
test("getJson untrustedHost gates an HTML 200 to a terminal non-JSON error, no retry, no stale (D-03)", async () => {
  cacheSet("gj:html-gate", { cached: "stale-should-not-serve" }, -1000); // expired seed
  const fetchImpl = fetchStub([jsonRes(200, { irrelevant: true }, { ct: "text/html" })]);
  const sleep = sleepSpy();
  await assert.rejects(
    () =>
      getJson("http://forum.example.test/api", {
        fetchImpl,
        sleep,
        lookup: publicLookup,
        untrustedHost: true,
        cacheKey: "gj:html-gate",
      }),
    (err) => {
      assert.match(err.message, /login required|non-JSON/i);
      return true;
    },
  );
  assert.deepEqual(sleep.waited, [], "an HTML-gate rejection is not retried");
  assert.equal(fetchImpl.calls, 1, "gate fires on the first response");
});

// 5. Pass-through: a JSON 200 resolves normally (the gate does not over-reject).
test("getJson untrustedHost passes through a valid application/json 200 (gate does not over-reject)", async () => {
  const fetchImpl = fetchStub([jsonRes(200, { ok: true }, { ct: "application/json" })]);
  const out = await getJson("http://forum.example.test/api", {
    fetchImpl,
    sleep: sleepSpy(),
    lookup: publicLookup,
    untrustedHost: true,
    cacheKey: "gj:json-pass",
  });
  assert.deepEqual(out, { ok: true });
  assert.equal(fetchImpl.calls, 1);
});

// 6. Redirect re-validation: a 302 → internal IP is rejected, target never fetched.
test("getJson untrustedHost rejects a 302 whose Location points at an internal IP (per-hop re-validation)", async () => {
  const fetchImpl = fetchStub([
    jsonRes(302, null, { location: "http://169.254.169.254/meta" }),
  ]);
  const sleep = sleepSpy();
  await assert.rejects(
    () =>
      getJson("http://forum.example.test/api", {
        fetchImpl,
        sleep,
        lookup: publicLookup, // initial host passes; the literal redirect target is blocked
        untrustedHost: true,
        cacheKey: "gj:redir-internal",
      }),
    /blocked address/,
  );
  assert.equal(fetchImpl.calls, 1, "the internal redirect target is never fetched");
  assert.deepEqual(sleep.waited, [], "an SSRF rejection is not retried");
});

// WR-03: a malformed redirect Location (`http://` — no host) throws a raw TypeError
// from `new URL(loc, url)`. It must be classified as a TERMINAL, non-retryable
// error (fail closed on the SSRF path), NOT a retryable network error — so no wasted
// retries and NO stale served, even when a stale entry exists.
test("getJson untrustedHost treats a malformed redirect Location as terminal — no retry, no stale (WR-03)", async () => {
  cacheSet("gj:redir-malformed", { cached: "stale-should-not-serve" }, -1000); // expired seed
  const fetchImpl = fetchStub([jsonRes(302, null, { location: "http://" })]);
  const sleep = sleepSpy();
  await assert.rejects(
    () =>
      getJson("http://forum.example.test/api", {
        fetchImpl,
        sleep,
        lookup: publicLookup,
        untrustedHost: true,
        cacheKey: "gj:redir-malformed",
      }),
    (err) => {
      assert.match(err.message, /invalid redirect Location/i, "terminal malformed-redirect error");
      assert.ok(!(err instanceof TypeError), "not misclassified as a network TypeError");
      return true;
    },
  );
  assert.equal(fetchImpl.calls, 1, "the malformed redirect is not retried");
  assert.deepEqual(sleep.waited, [], "a malformed-redirect rejection is not retried");
});

// WR-03 parity: getText (the RSS path) fails the same way on a malformed Location.
test("getText treats a malformed redirect Location as terminal — no retry, no stale (WR-03)", async () => {
  cacheSet("text:redir-malformed", "<rss>old</rss>", -1000);
  const fetchImpl = fetchStub([textRes(302, "", { location: "http://" })]);
  const sleep = sleepSpy();
  await assert.rejects(
    () =>
      getText("https://feeds.example.test/redirect", {
        fetchImpl,
        sleep,
        lookup: publicLookup,
        cacheKey: "text:redir-malformed",
      }),
    /invalid redirect Location/i,
  );
  assert.equal(fetchImpl.calls, 1, "malformed redirect not retried");
  assert.deepEqual(sleep.waited, [], "malformed-redirect rejection not retried");
});

// 7. Credentials-in-URL are rejected before any fetch (D-04).
test("getJson untrustedHost rejects a user:pass@host URL before fetching (D-04)", async () => {
  const fetchImpl = fetchStub([jsonRes(200, { should: "never-read" })]);
  await assert.rejects(
    () =>
      getJson("http://user:pass@example.test/x", {
        fetchImpl,
        sleep: sleepSpy(),
        lookup: publicLookup,
        untrustedHost: true,
        cacheKey: "gj:creds-in-url",
      }),
    /credentials in URL/i,
  );
  assert.equal(fetchImpl.calls, 0, "no fetch for a credentials-carrying URL");
});

// 8. Opt-in regression: WITHOUT the flag, the guard never runs — a private-
// resolving host fetches normally (proves the guard is strictly opt-in, D-01).
test("getJson WITHOUT untrustedHost does NOT run the SSRF guard (opt-in, D-01)", async () => {
  const fetchImpl = fetchStub([res(200, { ok: true })]);
  const out = await getJson("http://intranet.example.test/x", {
    fetchImpl,
    sleep: sleepSpy(),
    lookup: privateLookup, // would block IF the guard ran — it must not
    cacheKey: "gj:no-flag",
  });
  assert.deepEqual(out, { ok: true }, "no-flag path resolves without any SSRF check");
  assert.equal(fetchImpl.calls, 1);
});

// Set/clear RSS_ALLOWED_HOSTS around a test body (restores prior value).
async function withAllowedHosts(value, fn) {
  const prev = process.env.RSS_ALLOWED_HOSTS;
  if (value === undefined) delete process.env.RSS_ALLOWED_HOSTS;
  else process.env.RSS_ALLOWED_HOSTS = value;
  try {
    await fn();
  } finally {
    if (prev === undefined) delete process.env.RSS_ALLOWED_HOSTS;
    else process.env.RSS_ALLOWED_HOSTS = prev;
  }
}

// --- D-01 scheme allowlist ----------------------------------------------
test("assertSafeUrl rejects a file:// scheme (D-01)", async () => {
  await assert.rejects(
    () => assertSafeUrl("file:///etc/passwd", { lookup: noLookup }),
    /scheme .*not allowed/,
  );
});

test("assertSafeUrl rejects an ftp:// scheme (D-01)", async () => {
  await assert.rejects(
    () => assertSafeUrl("ftp://example.test/x", { lookup: noLookup }),
    /scheme .*not allowed/,
  );
});

test("assertSafeUrl rejects a data: URL (D-01)", async () => {
  await assert.rejects(
    () => assertSafeUrl("data:text/plain,hi", { lookup: noLookup }),
    /scheme .*not allowed/,
  );
});

test("assertSafeUrl rejects a malformed URL", async () => {
  await assert.rejects(() => assertSafeUrl("not a url", { lookup: noLookup }), /invalid URL/);
});

// --- D-02 private-range denylist (IP-literal hosts, no DNS) --------------
test("assertSafeUrl rejects http://127.0.0.1 loopback without calling DNS (D-02)", async () => {
  await assert.rejects(
    () => assertSafeUrl("http://127.0.0.1/feed", { lookup: noLookup }),
    /blocked address/,
  );
});

test("assertSafeUrl rejects http://169.254.169.254 cloud metadata (D-02)", async () => {
  await assert.rejects(
    () => assertSafeUrl("http://169.254.169.254/latest/meta-data", { lookup: noLookup }),
    /blocked address/,
  );
});

test("assertSafeUrl rejects http://[::1] IPv6 loopback (D-02)", async () => {
  await assert.rejects(
    () => assertSafeUrl("http://[::1]/feed", { lookup: noLookup }),
    /blocked address/,
  );
});

// CR-01: the IPv6 unspecified address `::` (in6addr_any) routes to loopback on
// connect() — the direct analog of the explicitly-blocked 0.0.0.0/8 — so it MUST
// be rejected (was ALLOWED before the denylist gained DENY.addAddress("::")).
test("assertSafeUrl rejects http://[::] IPv6 unspecified (CR-01)", async () => {
  await assert.rejects(
    () => assertSafeUrl("http://[::]/", { lookup: noLookup }),
    /blocked address/,
  );
});

// --- D-02 private-range denylist (DNS-resolved) -------------------------
test("assertSafeUrl rejects a public hostname whose DNS resolves to a private IP (D-02)", async () => {
  await assert.rejects(
    () => assertSafeUrl("http://intranet.example.test/feed", { lookup: privateLookup }),
    /blocked address/,
  );
});

test("assertSafeUrl accepts a public host that resolves to a public IP", async () => {
  const u = await assertSafeUrl("https://feeds.example.test/rss", { lookup: publicLookup });
  assert.equal(u.hostname, "feeds.example.test");
});

// --- T-04-05 IPv4-mapped IPv6 canonicalization --------------------------
test("assertSafeUrl blocks a host resolving to ::ffff:169.254.169.254 (mapped-IPv6 bypass, T-04-05)", async () => {
  await assert.rejects(
    () => assertSafeUrl("http://sneaky.example.test/x", { lookup: mappedMetadataLookup }),
    /blocked address/,
  );
});

// --- WR-03: NAT64 well-known prefix + SIIT IPv4-translatable forms -------
// A NAT64 gateway translates 64:ff9b::<v4> to the embedded IPv4, so an embedded
// private/metadata target must be blocked by the denylist directly.
test("assertSafeUrl rejects the NAT64 well-known prefix embedding metadata IP (WR-03)", async () => {
  await assert.rejects(
    () => assertSafeUrl("http://[64:ff9b::a9fe:a9fe]/", { lookup: noLookup }),
    /blocked address/,
  );
});

test("assertSafeUrl rejects the NAT64 well-known prefix embedding loopback (WR-03)", async () => {
  await assert.rejects(
    () => assertSafeUrl("http://[64:ff9b::7f00:1]/", { lookup: noLookup }),
    /blocked address/,
  );
});

// The SIIT ::ffff:0:HHHH:HHHH form canonicalizes to the embedded v4 (169.254.169.254).
test("assertSafeUrl rejects the SIIT ::ffff:0:HHHH:HHHH mapped form of the metadata IP (WR-03)", async () => {
  await assert.rejects(
    () => assertSafeUrl("http://[::ffff:0:a9fe:a9fe]/", { lookup: noLookup }),
    /blocked address/,
  );
});

// --- D-03 RSS_ALLOWED_HOSTS lock-down -----------------------------------
test("assertSafeUrl with RSS_ALLOWED_HOSTS accepts only a listed host (D-03)", async () => {
  await withAllowedHosts("feeds.example.test", async () => {
    const u = await assertSafeUrl("https://feeds.example.test/rss", { lookup: publicLookup });
    assert.equal(u.hostname, "feeds.example.test");
  });
});

test("assertSafeUrl with RSS_ALLOWED_HOSTS rejects an unlisted host (D-03)", async () => {
  await withAllowedHosts("feeds.example.test", async () => {
    await assert.rejects(
      () => assertSafeUrl("https://other.example.test/rss", { lookup: publicLookup }),
      /not in RSS_ALLOWED_HOSTS/,
    );
  });
});

// --- V7 redaction: no query string in error text ------------------------
test("assertSafeUrl error for a blocked host does not leak a query-string secret (V7)", async () => {
  await assert.rejects(
    () =>
      assertSafeUrl("http://169.254.169.254/x?token=SUPER_SECRET", { lookup: noLookup }),
    (err) => {
      assert.ok(!/SUPER_SECRET/.test(err.message), "secret must NOT appear in error");
      return true;
    },
  );
});

// ========================================================================
// getText() — raw-text GET sharing getJson's cache/retry/stale core, with
// SSRF validation (redirect:"manual" + per-hop re-validation) on the fetch
// path (D-07). Responses expose text()/headers/status; lookup is injected so
// every case runs offline.
// ========================================================================

// A Response-like object for the text path. `location` sets a Location header
// (for 3xx redirect cases); text() returns the raw body.
function textRes(status, body = "", { location } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (k) => (String(k).toLowerCase() === "location" ? location ?? null : null),
    },
    async text() {
      return body;
    },
  };
}

// --- caching -------------------------------------------------------------
test("an in-TTL repeated getText() is served from cache — fetch runs exactly once", async () => {
  const fetchImpl = fetchStub([textRes(200, "<rss>ok</rss>")]);
  const opts = {
    fetchImpl,
    sleep: sleepSpy(),
    lookup: publicLookup,
    cacheKey: "text:cache-hit",
  };
  const first = await getText("https://feeds.example.test/a", opts);
  const second = await getText("https://feeds.example.test/a", opts);
  assert.equal(first, "<rss>ok</rss>");
  assert.equal(second, "<rss>ok</rss>");
  assert.equal(fetchImpl.calls, 1, "second call must be cache-served");
});

// --- default User-Agent + manual redirect mode ---------------------------
test("getText sends a default User-Agent header and requests redirect:manual (D-07)", async () => {
  let seenInit;
  const fetchImpl = async (_url, init) => {
    seenInit = init;
    return textRes(200, "ok");
  };
  await getText("https://ua.example.test/feed", {
    fetchImpl,
    sleep: sleepSpy(),
    lookup: publicLookup,
    cacheKey: "text:ua",
  });
  assert.ok(seenInit.headers["User-Agent"], "a default User-Agent header is present");
  assert.equal(seenInit.redirect, "manual", "redirects are followed manually");
});

// --- retry / backoff parity with getJson ---------------------------------
test("getText() retries a 500 then resolves on 200; first backoff step is 500ms", async () => {
  const fetchImpl = fetchStub([textRes(500), textRes(200, "recovered")]);
  const sleep = sleepSpy();
  const out = await getText("https://feeds.example.test/retry", {
    fetchImpl,
    sleep,
    lookup: publicLookup,
    cacheKey: "text:retry-500",
  });
  assert.equal(out, "recovered");
  assert.equal(fetchImpl.calls, 2);
  assert.deepEqual(sleep.waited, [500]);
});

// --- stale fallback on total transient failure ---------------------------
test("getText() serves a stale entry on total (5xx) failure instead of throwing", async () => {
  cacheSet("text:stale", "<rss>old</rss>", -1000); // expired seed
  const fetchImpl = fetchStub([textRes(503)]); // always fails
  const sleep = sleepSpy();
  const out = await getText("https://feeds.example.test/stale", {
    fetchImpl,
    sleep,
    lookup: publicLookup,
    cacheKey: "text:stale",
  });
  assert.equal(out, "<rss>old</rss>", "stale text served on total failure");
  assert.equal(fetchImpl.calls, 4, "retries attempted before stale fallback");
});

// --- strict no-4xx-retry + no stale on 4xx -------------------------------
test("getText() does NOT retry a 404 and does NOT serve stale for it (WR-04 parity)", async () => {
  cacheSet("text:stale-404", "<rss>deleted</rss>", -1000);
  const fetchImpl = fetchStub([textRes(404)]);
  const sleep = sleepSpy();
  await assert.rejects(
    () =>
      getText("https://feeds.example.test/gone", {
        fetchImpl,
        sleep,
        lookup: publicLookup,
        cacheKey: "text:stale-404",
      }),
    /404/,
  );
  assert.equal(fetchImpl.calls, 1, "404 not retried");
  assert.deepEqual(sleep.waited, []);
});

// --- SSRF: a 302 → internal IP is REJECTED, not followed (T-04-04) --------
test("getText() rejects a 302 whose Location points at an internal IP (redirect re-validation)", async () => {
  // First hop: a 302 to the cloud-metadata IP. assertSafeUrl must reject the
  // Location before it is followed, so only ONE fetch happens.
  const fetchImpl = fetchStub([
    textRes(302, "", { location: "http://169.254.169.254/latest/meta-data" }),
  ]);
  const sleep = sleepSpy();
  await assert.rejects(
    () =>
      getText("https://feeds.example.test/redirect", {
        fetchImpl,
        sleep,
        lookup: publicLookup, // initial public host passes; the literal redirect target is blocked
        cacheKey: "text:redir-internal",
      }),
    /blocked address/,
  );
  assert.equal(fetchImpl.calls, 1, "the internal redirect target is never fetched");
  assert.deepEqual(sleep.waited, [], "an SSRF rejection is not retried");
});

// --- SSRF: an initial blocked host is rejected before any fetch ----------
test("getText() rejects an initial private-resolving host before fetching (D-02)", async () => {
  const fetchImpl = fetchStub([textRes(200, "should-never-be-read")]);
  await assert.rejects(
    () =>
      getText("http://intranet.example.test/feed", {
        fetchImpl,
        sleep: sleepSpy(),
        lookup: privateLookup,
        cacheKey: "text:initial-blocked",
      }),
    /blocked address/,
  );
  assert.equal(fetchImpl.calls, 0, "no fetch when the initial host is blocked");
});

// --- D-14 / Pitfall 1: Medium 403 -> clear terminal error ----------------
test("getText() maps a Medium 403 to a clear 'Medium is blocking' error (D-14)", async () => {
  const fetchImpl = fetchStub([textRes(403)]);
  const sleep = sleepSpy();
  await assert.rejects(
    () =>
      getText("https://medium.com/feed/@someone", {
        fetchImpl,
        sleep,
        lookup: publicLookup,
        cacheKey: "text:medium-403",
      }),
    /Medium is blocking/i,
  );
  assert.equal(fetchImpl.calls, 1, "a 403 is terminal — fetched exactly once (no retry)");
  assert.deepEqual(sleep.waited, [], "no backoff on a 4xx");
});

test("getText() Medium-403 error carries no query string (redactUrl — T-06-01)", async () => {
  const fetchImpl = fetchStub([textRes(403)]);
  await assert.rejects(
    () =>
      getText("https://medium.com/feed/@someone?token=SECRET&x=1", {
        fetchImpl,
        sleep: sleepSpy(),
        lookup: publicLookup,
        cacheKey: "text:medium-403-redact",
      }),
    (err) => {
      assert.match(err.message, /Medium is blocking/i);
      assert.ok(!err.message.includes("?"), "no query segment leaks");
      assert.ok(!err.message.includes("SECRET"), "no query-carried secret leaks");
      return true;
    },
  );
});

test("getText() sub-domain medium 403 also maps to the clear error (.medium.com)", async () => {
  const fetchImpl = fetchStub([textRes(403)]);
  await assert.rejects(
    () =>
      getText("https://www.medium.com/feed/@someone", {
        fetchImpl,
        sleep: sleepSpy(),
        lookup: publicLookup,
        cacheKey: "text:medium-403-sub",
      }),
    /Medium is blocking/i,
  );
  assert.equal(fetchImpl.calls, 1);
});

// --- host-gating: a non-Medium 403 keeps the verbatim generic message ----
test("getText() 403 from a non-Medium host keeps the generic 'getText: HTTP 403' message", async () => {
  const fetchImpl = fetchStub([textRes(403)]);
  const sleep = sleepSpy();
  await assert.rejects(
    () =>
      getText("https://example.com/feed", {
        fetchImpl,
        sleep,
        lookup: publicLookup,
        cacheKey: "text:nonmedium-403",
      }),
    (err) => {
      assert.match(err.message, /getText: HTTP 403/);
      assert.ok(!/Medium is blocking/i.test(err.message), "non-Medium host is not special-cased");
      return true;
    },
  );
  assert.equal(fetchImpl.calls, 1, "still terminal — one fetch, no retry");
  assert.deepEqual(sleep.waited, []);
});

test("getText() a look-alike host (notmedium.com) is NOT treated as Medium (boundary-safe)", async () => {
  const fetchImpl = fetchStub([textRes(403)]);
  await assert.rejects(
    () =>
      getText("https://notmedium.com/feed", {
        fetchImpl,
        sleep: sleepSpy(),
        lookup: publicLookup,
        cacheKey: "text:notmedium-403",
      }),
    /getText: HTTP 403/,
  );
});

// --- no stale served on a Medium 403 (terminal 4xx — WR-04 parity) --------
test("getText() does NOT serve a stale entry on a Medium 403 — it throws (WR-04 parity)", async () => {
  cacheSet("text:medium-403-stale", "<rss>old-medium</rss>", -1000); // expired seed
  const fetchImpl = fetchStub([textRes(403)]);
  await assert.rejects(
    () =>
      getText("https://medium.com/feed/@someone", {
        fetchImpl,
        sleep: sleepSpy(),
        lookup: publicLookup,
        cacheKey: "text:medium-403-stale",
      }),
    /Medium is blocking/i,
  );
  assert.equal(fetchImpl.calls, 1, "403 not retried");
});
