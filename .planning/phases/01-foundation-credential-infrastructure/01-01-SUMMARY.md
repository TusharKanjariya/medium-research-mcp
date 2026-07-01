---
phase: 01-foundation-credential-infrastructure
plan: 01
subsystem: infra
tags: [mcp, zod, node-esm, http-client, ttl-cache, output-contract, node-test]

# Dependency graph
requires: []
provides:
  - "Root package.json (type:module, node>=18) with pinned @modelcontextprotocol/sdk ^1.29.0 + zod ^4.4"
  - "shared/cache.js — TTL cache with stale retention (getFresh/getStale/set, never delete on expiry)"
  - "shared/http_client.js getJson() — cache + retry/backoff + timeout + stale fallback, STRICT no-4xx-retry"
  - "shared/contract.js — item/list/detail Zod schemas AND raw shapes, normalizeItem/buildListEnvelope/buildDetailEnvelope/toolResult/stripHtml"
  - "node:test unit suites for cache, http_client, and contract"
affects: [hn-server, credentials, auth, every-future-source-server]

# Tech tracking
tech-stack:
  added: ["@modelcontextprotocol/sdk@^1.29.0", "zod@^4.4"]
  patterns:
    - "Contract as a shared module: registerTool consumes exported RAW Zod shapes; runtime uses compiled z.object schemas — the two cannot drift"
    - "toolResult() is the single seam assembling content[] + structuredContent (FOUND-05)"
    - "getJson() is the ONLY HTTP path: cache→fetch(timeout)→retry(5xx/net)→stale fallback; 4xx never retried"
    - "Injectable fetch + sleep so unit tests run offline and without real waits"

key-files:
  created:
    - package.json
    - .gitignore
    - shared/cache.js
    - shared/http_client.js
    - shared/contract.js
    - test/cache.test.js
    - test/http_client.test.js
    - test/contract.test.js
  modified: []

key-decisions:
  - "Pinned sdk 1.29.0 + zod 4.4.3 verified live via npm view; zod ^4.4 installed clean — no zod-to-json-schema quirk, so the ^3.25 fallback was not needed"
  - "STRICT no-4xx-retry: 429 and 408 are never retried (ARCHITECTURE §8 / FOUND-02 / ROADMAP SC2), documented in http_client.js header"
  - "normalizeItem preserves a legitimate 0 score/num_comments via ?? (only undefined/null become null)"

patterns-established:
  - "Raw-shape + compiled-schema dual export from contract.js (Pitfall 1 — 1.29.0 wants a raw shape as outputSchema)"
  - "Cache never deletes on expiry; only a successful refresh overwrites — the basis of the stale-fallback guarantee"

requirements-completed: [FOUND-01, FOUND-02, FOUND-03, FOUND-05, OUT-01, OUT-03]

coverage:
  - id: D1
    description: "Root package.json (type:module, node>=18, test:node --test) with pinned sdk+zod; node_modules installs clean; .env and node_modules gitignored"
    requirement: "FOUND-01"
    verification:
      - kind: manual_procedural
        ref: "node -e package.json assertion + npm install (0 vulnerabilities) + git check-ignore .env"
        status: pass
    human_judgment: false
  - id: D2
    description: "shared/cache.js TTL cache with stale retention — getFresh/getStale/set, never deleted on expiry, overwrite-only-on-refresh"
    requirement: "FOUND-01"
    verification:
      - kind: unit
        ref: "test/cache.test.js (6 tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "shared/http_client.js getJson() — in-TTL cache hit, AbortController timeout, retry network/timeout/non-JSON/5xx with [500,1000,2000] backoff, STRICT no-4xx-retry (429/408 included), stale fallback on exhaustion"
    requirement: "FOUND-02"
    verification:
      - kind: unit
        ref: "test/http_client.test.js (10 tests incl. 429-not-retried, 408-not-retried, full backoff schedule, stale fallback)"
        status: pass
    human_judgment: false
  - id: D4
    description: "shared/contract.js — item/list/detail Zod schemas + raw shapes, normalizeItem defaults+HTML-strip (never drops score/num_comments), build*Envelope, toolResult dual-return seam"
    requirement: "FOUND-03"
    verification:
      - kind: unit
        ref: "test/contract.test.js (12 tests incl. envelope parse against Zod, raw-shape-not-ZodObject, toolResult)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Every tool return assembled via toolResult(envelope) → { content:[{type:text}], structuredContent }"
    requirement: "FOUND-05"
    verification:
      - kind: unit
        ref: "test/contract.test.js#toolResult returns both a JSON-text content block and structuredContent"
        status: pass
    human_judgment: false
  - id: D6
    description: "Output trimmed + HTML stripped via shared stripHtml applied inside normalizeItem (tags removed, named + numeric entities decoded, blank→null)"
    requirement: "OUT-03"
    verification:
      - kind: unit
        ref: "test/contract.test.js#stripHtml removes tags and decodes named + numeric entities"
        status: pass
    human_judgment: false

# Metrics
duration: 7min
completed: 2026-07-01
status: complete
---

# Phase 1 Plan 01: Foundation Spine (cache + getJson + output contract) Summary

**Dependency-free Node ESM foundation: TTL stale-retaining cache, a resilient getJson() with strict no-4xx-retry, and a shared Zod output-contract module (raw shapes + factories + single toolResult seam) — all covered by 28 node:test units.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-07-01T12:22:35Z
- **Completed:** 2026-07-01T12:29:16Z
- **Tasks:** 3
- **Files modified:** 8 (source/test) + package-lock.json

## Accomplishments
- Root `package.json` (`type: module`, `engines.node >=18`, `test: node --test`) with `@modelcontextprotocol/sdk@^1.29.0` and `zod@^4.4`; `npm install` reports 0 vulnerabilities. Live `npm view` confirmed sdk 1.29.0 / zod 4.4.3 / peerDep `zod: ^3.25 || ^4.0` — no drift, no fallback needed.
- `shared/cache.js`: `Map`-backed TTL cache; `getFresh` honors TTL, `getStale` returns expired-but-present values, `set` overwrites only on refresh and never deletes on expiry — the basis of the stale-fallback guarantee.
- `shared/http_client.js` `getJson()`: serves in-TTL cache first, then fetches with an `AbortController` timeout; retries only network/`TypeError`, `AbortError`, non-JSON bodies, and 5xx `{500,502,503,504}` with `[500,1000,2000]` ms backoff; **never retries any 4xx including 429 and 408**; falls back to a stale entry on total failure, else throws naming the URL. `fetch` and `sleep` are injectable.
- `shared/contract.js`: item + list/detail **raw Zod shapes** (for `registerTool` outputSchema) AND compiled `z.object` schemas (for `.parse()`); `normalizeItem()` defaults absent fields to null (tags `[]`), stringifies id, preserves a legitimate `0`, and HTML-strips text without ever dropping/renaming `score`/`num_comments`; `stripHtml()` centralizes tag removal + named/numeric entity decode (blank→null); `toolResult()` is the single seam assembling `content[]` + `structuredContent`.
- 28 `node:test` assertions pass (`node --test`, exit 0), all offline (fetch injected — no real network).

## Task Commits

Each task committed atomically (TDD tasks: test → feat):

1. **Task 1: Project scaffold — package.json, .gitignore, pinned deps** - `b482a34` (chore)
2. **Task 2: cache.js + http_client.js getJson()** - `3b35443` (test, RED) → `13ee261` (feat, GREEN)
3. **Task 3: contract.js — schemas + shapes + factories + toolResult** - `b76d682` (test, RED) → `02c353a` (feat, GREEN)

_No REFACTOR commits were needed — GREEN implementations were already clean._

## Files Created/Modified
- `package.json` - Root ESM package, pinned sdk+zod, `node --test` script, `engines.node >=18`
- `.gitignore` - Excludes `node_modules/`, `.env`, `*.mcpb`, OS/editor noise
- `shared/cache.js` - TTL cache with stale retention (`getFresh`/`getStale`/`set`)
- `shared/http_client.js` - `getJson()` cache + retry/backoff + timeout + strict no-4xx-retry + stale fallback
- `shared/contract.js` - Output-contract schemas, raw shapes, `normalizeItem`/`buildListEnvelope`/`buildDetailEnvelope`/`toolResult`/`stripHtml`
- `test/cache.test.js` - 6 cache units
- `test/http_client.test.js` - 10 getJson units (retry, strict 4xx, stale, non-JSON)
- `test/contract.test.js` - 12 contract units (defaults, HTML strip, envelope parse, raw-shape, toolResult)

## Decisions Made
- **zod ^4.4 kept (no fallback):** RESEARCH allowed a `zod@^3.25` fallback if a zod-to-json-schema quirk appeared. Install was clean and all schema/parse tests pass, so ^4.4 (4.4.3) was retained.
- **Strict no-4xx-retry encoded and documented:** 429/408 are explicitly excluded from retry in both code and a header comment, matching ARCHITECTURE §8 / FOUND-02 / ROADMAP SC2 (RESEARCH Open Questions RESOLVED).
- **`??` for numeric defaults:** `normalizeItem` uses `?? null` so a real `0` score/num_comments is preserved (only undefined/null normalize to null) — verified by a dedicated test.

## Deviations from Plan

None - plan executed exactly as written. All three tasks, their acceptance criteria, and the plan's `<verification>` block passed as specified; no auto-fix rules were triggered.

## Issues Encountered
- `node -e "require('@modelcontextprotocol/sdk/package.json').version"` printed `undefined` (the package's exports map does not expose `version` via that subpath require). Re-read the version directly from `node_modules/@modelcontextprotocol/sdk/package.json` → `1.29.0` confirmed. No impact on the build.
- Git reported LF→CRLF normalization warnings on Windows (expected on this platform); no functional impact.

## Known Stubs
None — every export is fully implemented and unit-tested. `credentials.js` / `auth.js` / the HN server are intentionally out of this plan's scope (plans 01-02/01-03).

## User Setup Required
None - no external service configuration required for this plan. `.env.example` and credential wiring land in plan 01-03.

## Next Phase Readiness
- The reusable spine is ready: later plans/servers import `getJson` and the contract factories; adding a source reduces to field-mapping into `normalizeItem()`.
- HN reference server (FOUND-04) and credentials/auth (CRED-01..04) are the remaining Phase 1 work (plans 01-02, 01-03).
- No blockers.

## Self-Check: PASSED
- Files verified present: package.json, .gitignore, shared/cache.js, shared/http_client.js, shared/contract.js, test/cache.test.js, test/http_client.test.js, test/contract.test.js
- Commits verified in git log: b482a34, 3b35443, 13ee261, b76d682, 02c353a
- Full suite: `node --test` → 28 pass / 0 fail (exit 0)

---
*Phase: 01-foundation-credential-infrastructure*
*Completed: 2026-07-01*
