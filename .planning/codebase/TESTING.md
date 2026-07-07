# Testing Patterns

**Analysis Date:** 2026-07-07

## Test Framework

**Runner:**
- Node's built-in test runner (`node:test`). No external test framework — zero test dependencies by design.
- Config: none needed; `package.json` script `"test": "node --test"` discovers `test/*.test.js`.

**Assertion Library:**
- `node:assert/strict` (`assert.equal`, `assert.deepEqual`, `assert.ok`, `assert.throws`, `assert.rejects`, `assert.doesNotThrow`).

**Run Commands:**
```bash
npm test                     # or: node --test  (runs all test/*.test.js)
node --test test/hn.test.js  # single file
```
No watch mode or coverage script is configured (Node supports `node --test --watch` and `node --test --experimental-test-coverage` natively if needed).

**Prerequisite:** `npm install` must have been run — any test importing a `servers/*/server.js` pulls in `@modelcontextprotocol/sdk` and fails with `ERR_MODULE_NOT_FOUND` without `node_modules`. The pure shared-module tests (`cache`, `credentials`, `auth`, `http_client`) pass without it.

## Test File Organization

**Location:**
- Separate top-level `test/` directory — not co-located with sources.

**Naming:**
- `test/<source-or-module>.test.js`, one file per server or shared module: `test/hn.test.js`, `test/http_client.test.js`, `test/contract.test.js`, plus the cross-source proof `test/uniform-run.test.js`.

**Structure:**
```
test/
├── <shared>.test.js        # cache, contract, credentials, auth, http_client
├── <source>.test.js        # hn, devto, github, lemmy, libraries, lobsters,
│                           # producthunt, rss, stackexchange
├── uniform-run.test.js     # cross-source contract/merge proof (OUT-02)
└── fixtures/               # REAL captured API payloads
    ├── <source>-<kind>.json   (e.g. hn-story.json, github-repos.json)
    └── rss-*.xml              (atom, rss2, reddit, youtube feed samples)
```

## Test Structure

**Suite Organization:**
- Flat `test(...)` calls — no `describe` blocks. Sections are delimited by `// --- section ---` comment rules. Test names are full sentences stating the expected behavior and often the requirement ID:

```js
// test/hn.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mapHnHit, mapHnItem, server } from "../servers/hn/server.js";

test("mapHnHit yields null score and null num_comments for a job story", () => {
  const m = mapHnHit(job);
  assert.equal(m.type, "job");
  assert.equal(m.score, null); // verified Algolia behavior
  assert.equal(m.num_comments, null);
});
```

**Patterns:**
- No `beforeEach`/`afterEach` hooks observed; per-test setup is done inline or via small helper functions (e.g. `withEnv`, `fetchStub`) with try/finally restoration.
- File-top banner comment states the file's two-or-three concerns and that everything is offline.
- Each server test file covers the same three concerns:
  1. **Field-mapping units** — `map*()` output asserted field-by-field against fixtures, including null-score edge cases.
  2. **Contract conformance** — envelopes built via `buildListEnvelope`/`buildDetailEnvelope` must `parse()` against `ListEnvelopeSchema`/`DetailEnvelopeSchema` (`assert.doesNotThrow(() => ListEnvelopeSchema.parse(env))`).
  3. **Registration smoke** — importing the server registers the exact tool names without connecting a transport: `Object.keys(server._registeredTools ?? {}).sort()` deep-equals the expected list, and each tool has an `outputSchema`.

## Mocking

**Framework:** None — no `mock` from `node:test`, no sinon. All test doubles are hand-rolled injectable stubs passed through the production functions' option parameters (`fetchImpl`, `sleep`, `lookup`).

**Patterns:**
```js
// test/http_client.test.js — queued fetch stub + sleep spy
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

function fetchStub(queue) {          // yields queued responses; last repeats
  let i = 0;
  const stub = async () => { stub.calls++; /* ... */ };
  stub.calls = 0;
  return stub;
}

function sleepSpy() {                // records backoff waits, never sleeps
  const waited = [];
  const sleep = async (ms) => { waited.push(ms); };
  sleep.waited = waited;
  return sleep;
}

const out = await getJson("https://example.test/retry-500", {
  fetchImpl, sleep, cacheKey: "http:retry-500",
});
assert.deepEqual(sleep.waited, [500]);
```

```js
// test/credentials.test.js — env manipulation with guaranteed restore
function withEnv(vars, fn) {
  const saved = {};
  for (const k of ALL_VARS) { saved[k] = process.env[k]; delete process.env[k]; }
  for (const [k, v] of Object.entries(vars)) process.env[k] = v;
  try { return fn(); }
  finally { /* restore saved values */ }
}

test("requireCred throws an error naming the ENV_VAR when the credential is unset", () => {
  withEnv({}, () => {
    assert.throws(() => requireCred("librariesIoKey"), /LIBRARIESIO_KEY/);
  });
});
```

**What to Mock:**
- `fetch` (via `fetchImpl` option), delays (via `sleep`), DNS resolution (via `lookup` for SSRF tests), and `process.env` (via `withEnv`, clearing ALL known vars first so ambient env can't skew results). Give each test a unique `cacheKey` (e.g. `"http:retry-500"`) so the module-level cache in `shared/cache.js` never bleeds between tests.

**What NOT to Mock:**
- The `map*()` helpers, `shared/contract.js` normalization, and Zod schemas — tests exercise the real production code paths end-to-end (fixture → mapper → envelope → schema parse).
- Never mock the network with hand-written response shapes when a real captured fixture exists.

## Fixtures and Factories

**Test Data:**
- Fixtures are **real API payloads captured once** — never hand-written mocks — "so the map is validated against ground truth" (`test/hn.test.js` banner). JSON for REST/GraphQL sources, raw XML for RSS.

```js
// standard loader, repeated per test file
const fixture = (name) =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url)),
      "utf8",
    ),
  );
const story = fixture("hn-story");
```

**Location:**
- `test/fixtures/` — named `<source>-<kind>.json` / `rss-<flavor>.xml`. When adding a server, capture one list payload, one detail payload, and any edge case (e.g. `hn-job.json` for the null-score path).

## Coverage

**Requirements:** None enforced. No coverage tooling configured.

**View Coverage:**
```bash
node --test --experimental-test-coverage   # native option; not wired into npm scripts
```

## Test Types

**Unit Tests:**
- The dominant type. Pure-function tests for mappers, `stripHtml`/`normalizeItem`, cache TTL/stale behavior, credential resolution, and the full retry/backoff/stale/SSRF matrix of `shared/http_client.js` (717 lines of tests — the largest file).

**Integration Tests:**
- `test/uniform-run.test.js` — the cross-source proof (OUT-02): builds envelopes from 6 sources' real mappers over fixtures, merges with `mergeRank()` (`shared/rank.js`), asserts every merged item parses against `ItemSchema`, score-descending order with null-score items last, and a **structural** guard that `mergeRank`'s body contains no source-keyed conditional.
- Registration smoke tests double as light integration (server module + SDK `registerTool`).

**E2E Tests:**
- Not used. Live-network verification is manual: `examples/uniform-run.mjs` (runnable demo) and `npm run inspect:hn` via MCP Inspector.

**Offline invariant:** every test runs with **no network and no real waits** — fixtures + injected `fetchImpl`/`sleep`/`lookup`. Importing a server never opens a transport (the direct-run guard in each `server.js`). Preserve this for all new tests.

## Common Patterns

**Async Testing:**
```js
test("a network TypeError is retried, then a 200 resolves", async () => {
  const fetchImpl = fetchStub([
    () => { throw new TypeError("fetch failed"); },
    res(200, { recovered: true }),
  ]);
  const out = await getJson("https://example.test/net", { fetchImpl, sleep, cacheKey: "http:net" });
  assert.deepEqual(out, { recovered: true });
});
```

**Error Testing:**
```js
// async rejection with message regex + call-count assertions
await assert.rejects(
  () => getJson("https://example.test/404", { fetchImpl, sleep, cacheKey: "http:404" }),
  /404/,
);
assert.equal(fetchImpl.calls, 1);       // strict no-4xx-retry proven
assert.deepEqual(sleep.waited, []);

// sync throw with env-var-name regex (never the secret value)
assert.throws(() => requireCred("librariesIoKey"), /LIBRARIESIO_KEY/);
```

**Contract conformance (required for every new server):**
```js
const env = buildListEnvelope({ source: "hackernews", query: "q", results: [mapHnHit(story)] });
assert.doesNotThrow(() => ListEnvelopeSchema.parse(env));
```

**Checklist when adding a server's tests (mirror `test/hn.test.js`):**
1. Capture real fixtures into `test/fixtures/<source>-*.json`.
2. Unit-test each exported `map*()` field-by-field, including null `score`/`num_comments` edge cases and tag/type derivation.
3. Prove HTML stripping flows through `buildListEnvelope`/`buildDetailEnvelope`.
4. Parse envelopes against `ListEnvelopeSchema`/`DetailEnvelopeSchema`.
5. Assert exact registered tool names via `server._registeredTools` and that each declares an `outputSchema`.
6. Add the source to `test/uniform-run.test.js` if it introduces a new score semantics.

---

*Testing analysis: 2026-07-07*
