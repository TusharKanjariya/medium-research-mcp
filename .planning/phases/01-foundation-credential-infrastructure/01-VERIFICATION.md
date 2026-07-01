---
phase: 01-foundation-credential-infrastructure
verified: 2026-07-01T13:12:52Z
status: passed
score: 5/5 success criteria verified
requirements_verified: 11/11
tests: 64/64 passing (node --test)
re_verification: No — initial verification
overrides_applied: 0
---

# Phase 1: Foundation & Credential Infrastructure — Verification Report

**Phase Goal:** Establish the shared plumbing and prove the normalized output
contract end-to-end with a Hacker News reference server, plus the credential/auth
infrastructure every later source copies.
**Verified:** 2026-07-01T13:12:52Z
**Status:** passed
**Re-verification:** No — initial verification

Verification was goal-backward: each ROADMAP Phase 1 Success Criterion was checked
against the actual source (`shared/*.js`, `servers/hn/*`, `.env.example`,
`test/*`), not against SUMMARY claims. `node --test` was run (64/64 pass) and the
`process.env` / `fetch(` greps were executed directly.

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth (Success Criterion) | Status | Evidence |
|---|---------------------------|--------|----------|
| 1 | `hn_front_page`/`hn_search`/`hn_get_item` return the exact contract shape (list envelope, detail `{source,item}`) with BOTH `structuredContent` and JSON-text `content` | ✓ VERIFIED | `servers/hn/server.js` registers exactly the 3 tools, each with `outputSchema: listEnvelopeShape`/`detailEnvelopeShape`; every handler ends in `toolResult(env)`. `shared/contract.js:139` `toolResult` returns `{ content:[{type:"text",text:JSON.stringify(env)}], structuredContent:env }`. Tests: "hn server registers exactly hn_front_page, hn_search, hn_get_item", "each hn tool declares an outputSchema", "toolResult returns both a JSON-text content block and structuredContent". |
| 2 | Transient/5xx retried with 0.5/1/2s backoff; repeat-in-TTL served from cache; total failure → stale fallback; 4xx NEVER retried (incl. 429/408) | ✓ VERIFIED | `shared/http_client.js`: `BACKOFF_MS=[500,1000,2000]`, `RETRYABLE_5XX={500,502,503,504}`, comment + code apply strict no-4xx-retry with no Retry-After exception; fresh-cache short-circuit (l.65), stale fallback (l.112). Tests: backoff schedule `[500,1000,2000]`, in-TTL served from cache (fetch once), 500→200 retry, network TypeError retry, 404/400/429/408 NOT retried, stale value returned on total failure, non-JSON body retried (no crash). |
| 3 | `credentials.js` is the ONLY `process.env` reader; missing required cred → clear "set X" error; optional degrades | ✓ VERIFIED | Grep `process.env` across `shared/` + `servers/` (excluding tests/docs/.planning) matches ONLY `shared/credentials.js:35` (`const get = ...`). `requireCred` throws `Missing credential: set <ENV_VAR>`; `librariesIoParams`/`productHuntHeaders` require, `stackExchangeParams`/`githubHeaders` return `{}` when unset. Tests confirm degrade + required paths. |
| 4 | `auth.js` exchanges user/pass for a cached token (Reddit grant + Lemmy) with passwords never logged/persisted/sent-per-request; `.env.example` + `.mcpb` `user_config` (`sensitive:true`) documented | ✓ VERIFIED | `shared/auth.js`: one `cachedToken()` path; `tokenCache` stores `{token,expires}` only; password confined to exchange closure/request body; errors name only HTTP status. Tests assert password absent from cache entry + error messages, and failed exchange leaves no entry. `.env.example` documents all vars (names+comments only, no values). `servers/hn/manifest.json` `user_config` fields marked `"sensitive": true` mapped via `${user_config.*}` into `mcp_config.env`. |
| 5 | Tool output trimmed/LLM-readable — HTML stripped from `text`, only contract fields present | ✓ VERIFIED | `shared/contract.js` `stripHtml` (removes tags/scripts/styles, decodes entities, collapses blanks, empty→null); `normalizeItem` emits exactly the contract fields, `text` HTML-stripped; HN `mapHnHit`/`mapHnItem` do pure field-mapping with no derived text. Tests cover stripHtml decoding + tag-only→null, and HN text stripped through the shared path. |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `shared/cache.js` | TTL cache w/ stale retention | ✓ VERIFIED | `getFresh`/`getStale`/`set`; entries never deleted on expiry (enables stale fallback). |
| `shared/http_client.js` | `getJson()` cache+retry+stale | ✓ VERIFIED | Sole HTTP path; imported by HN server; injectable fetch/sleep for tests. |
| `shared/contract.js` | Contract schemas + factories + `toolResult` | ✓ VERIFIED | `itemShape` (score/num_comments `.nullable()`), list/detail shapes, `normalizeItem`, `buildListEnvelope`, `buildDetailEnvelope`, `stripHtml`, `toolResult`. |
| `shared/credentials.js` | Single env reader + helpers | ✓ VERIFIED | `ENV_VAR` map, private `get()`, required/optional helpers, `redditCreds`/`lemmyCreds`. |
| `shared/auth.js` | Cached-token exchange (Reddit+Lemmy) | ✓ VERIFIED | `cachedToken`, `redditToken`, `lemmyJwt`; token-only cache. |
| `servers/hn/server.js` | HN reference server, 3 tools | ✓ VERIFIED | Uses `getJson` (no direct `fetch`), imports shared contract, dual-content return, stdio only when run directly. |
| `servers/hn/manifest.json` | `.mcpb` user_config keychain pattern | ✓ VERIFIED | manifest_version 0.3, `sensitive:true`, `${user_config.*}` injection, Claude Code gotcha noted. |
| `.env.example` | All vars documented, no values | ✓ VERIFIED | Required vs optional sections; Reddit script-app honesty caveat; `.env` gitignored, only `.env.example` tracked. |
| `package.json` | `type:module`, sdk+zod, `node --test` | ✓ VERIFIED | Single root package (D-07); test script present. |

### Key Link Verification

| From | To | Via | Status |
|------|----|----|--------|
| `servers/hn/server.js` | `shared/http_client.js` | `getJson()` — no direct `fetch` | ✓ WIRED (grep `fetch(` in `servers/` → no matches) |
| `servers/hn/server.js` | `shared/contract.js` | `buildListEnvelope`/`buildDetailEnvelope`/`toolResult`/shapes | ✓ WIRED |
| `http_client.js` | `cache.js` | `getFresh`/`getStale`/`set` | ✓ WIRED |
| `auth.js` | `credentials.js` | `redditCreds`/`lemmyCreds`/`userAgent` | ✓ WIRED |
| servers/auth | `process.env` | ONLY via `credentials.js` `get()` | ✓ WIRED (single-reader rule holds) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full suite | `node --test` | tests 64 / pass 64 / fail 0 | ✓ PASS |
| Single-env-reader rule | grep `process.env` in shared+servers source | only `shared/credentials.js:35` | ✓ PASS |
| No direct fetch in servers | grep `fetch(` in `servers/` | no matches | ✓ PASS |
| `.env` not tracked | `git check-ignore .env` | `.env` | ✓ PASS |

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| FOUND-01 | ~15-min TTL cache w/ stale retention | ✓ SATISFIED | `cache.js`; `DEFAULT_TTL_MS=15*60*1000`. |
| FOUND-02 | `getJson()` cache+retry(0.5/1/2, never 4xx)+stale; no direct fetch | ✓ SATISFIED | `http_client.js` + tests; servers use `getJson`. |
| FOUND-03 | Contract enforced; score/num_comments never renamed | ✓ SATISFIED | `contract.js` shapes/factories; tests assert keys always present incl. null and 0. |
| FOUND-04 | HN server exposes 3 tools, proves pattern | ✓ SATISFIED | `servers/hn/server.js` + `hn.test.js`. |
| FOUND-05 | Every tool returns object → structuredContent + content | ✓ SATISFIED | `toolResult` seam; unit-tested. |
| CRED-01 | `credentials.js` single env-name source + per-service helpers | ✓ SATISFIED | `ENV_VAR` map + helpers; grep single-reader. |
| CRED-02 | `auth.js` cached token; passwords never logged/persisted/per-request | ✓ SATISFIED | `auth.js` + password-absence tests. |
| CRED-03 | `.env.example` documents vars; `.mcpb` user_config `sensitive:true` | ✓ SATISFIED | `.env.example` + `manifest.json`. |
| CRED-04 | Required sources fail "set X"; optional degrade | ✓ SATISFIED | `requireCred` vs degrading helpers + tests. |
| OUT-01 | Server conforms to contract exactly (§4) | ✓ SATISFIED | HN envelopes schema-validate against contract. |
| OUT-03 | Output trimmed/LLM-readable, HTML stripped | ✓ SATISFIED | `stripHtml` + `normalizeItem` + tests. |

11/11 Phase 1 requirements satisfied. No orphaned requirements (all mapped IDs claimed by a plan).

### Anti-Patterns Found

None blocking. No `TBD`/`FIXME`/`XXX` debt markers in modified source files. The
per-service helpers documented as "Known Stubs" in 01-03-SUMMARY
(`stackExchangeParams`, `githubHeaders`, `librariesIoParams`, `productHuntHeaders`,
`redditToken`, `lemmyJwt`) are fully-implemented, unit-tested functions intended for
consumption by Phase 2/3 servers — not unwired placeholders. This matches the
CRED-01 "defined now, consumed later" intent and is not a gap.

### Notes / Observations (non-blocking)

- `servers/hn/manifest.json` illustrates the keychain pattern with two example
  `user_config` fields rather than every secret, and actual `.mcpb` packing is
  explicitly deferred to v2 (PKG-01). CRED-03 requires the pattern be *documented*,
  which it is (`sensitive:true` + `${user_config.*}` injection). Later credentialed
  servers add their own manifests.
- SC1's literal "in the MCP Inspector" live smoke test against the Algolia HN API is
  an optional runtime confirmation. It is not required for goal achievement: the
  contract shape and dual-content guarantee are deterministic in code and unit-tested,
  and the getJson resilience layer already handles upstream failure gracefully. A live
  `npm run inspect:hn` is recommended as a courtesy check before shipping but does not
  gate this phase.

### Gaps Summary

None. All five success criteria are achieved in the codebase, all eleven Phase 1
requirements are satisfied, the output contract is enforced through a single shared
module (score/num_comments never renamed/dropped, null preserved), servers reach the
network only through `getJson()` (no direct `fetch`), `process.env` is read only in
`credentials.js`, passwords never enter the token cache or error messages, and the
full test suite passes 64/64.

---

_Verified: 2026-07-01T13:12:52Z_
_Verifier: Claude (gsd-verifier)_
