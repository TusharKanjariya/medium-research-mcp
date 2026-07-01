// Tests for shared/http_client.js getJson() — cache + retry/backoff + timeout + stale
// fallback (FOUND-02). STRICT no-4xx-retry (ARCHITECTURE §8 / ROADMAP SC2).
// fetch and sleep are injected so no real network and no real waiting occur.
import { test } from "node:test";
import assert from "node:assert/strict";
import { getJson } from "../shared/http_client.js";
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
