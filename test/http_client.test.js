// Tests for shared/http_client.js getJson() — cache + retry/backoff + timeout + stale
// fallback (FOUND-02). STRICT no-4xx-retry (ARCHITECTURE §8 / ROADMAP SC2).
// fetch and sleep are injected so no real network and no real waiting occur.
import { test } from "node:test";
import assert from "node:assert/strict";
import { getJson, postJson } from "../shared/http_client.js";
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
