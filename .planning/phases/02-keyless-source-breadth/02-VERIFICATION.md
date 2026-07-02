---
phase: 02-keyless-source-breadth
verified: 2026-07-02T00:00:00Z
status: human_needed
score: 4/5 must-haves verified
behavior_unverified: 1
overrides_applied: 0
behavior_unverified_items:
  - truth: "Hashnode tools return trending-by-tag, search, and article via public GraphQL with reactionCount->score and responseCount->num_comments (SC4 / SRC-04)."
    test: "With gql.hashnode.com/public reachable, call hashnode_trending (limit 5) and hashnode_get on a returned id; confirm the endpoint responds with real data and that reactionCount / responseCount / tags[].slug are the live field names feeding score / num_comments / tags."
    expected: "Live response parses into the contract envelope with non-empty results; score/num_comments populated from reactionCount/responseCount; the /public endpoint (not the Vercel root) serves GraphQL."
    why_human: "The live Hashnode origin returned a persistent Cloudflare 522 during execution, so the fixtures were built from the RESEARCH-cited schema rather than a fresh live capture. Field-name correctness against the live API cannot be confirmed offline. Explicitly flagged human_judgment in 02-03-SUMMARY.md (coverage D2)."
human_verification:
  - test: "With gql.hashnode.com/public reachable, call hashnode_trending (limit 5) then hashnode_get on a returned article id."
    expected: "Non-empty contract-shaped results; score from reactionCount, num_comments from responseCount, tags from tags[].slug; /public endpoint serves GraphQL."
    why_human: "Live Hashnode origin was down (Cloudflare 522) during execution; fixtures are schema-derived. Live field-name confirmation needs the external service (A2)."
  - test: "Set LEMMY_INSTANCE=https://programming.dev + LEMMY_USERNAME + LEMMY_PASSWORD for a real account, then call lemmy_hot."
    expected: "The read carries Authorization: Bearer <jwt> (auth.js lemmyJwt -> POST /api/v3/user/login exchange), returns contract-shaped posts, and degrades to anonymous with no error when creds are absent."
    why_human: "The auth-wire decision is proven offline (Bearer-when-token / empty-when-null), but a live authenticated read exercising the username/password exchange against a real instance requires real credentials + network."
---

# Phase 2: Keyless Source Breadth Verification Report

**Phase Goal:** Fan out across the keyless (and optional-auth) sources, proving that adding a source is a mechanical copy of the Phase 1 pattern and that the contract holds across very different payloads.
**Verified:** 2026-07-02
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Stack Exchange (`so_hot_questions`, `so_search`, `so_get_question`) work network-wide via `site`; use `STACKEXCHANGE_KEY` when present, keyless otherwise. | ✓ VERIFIED | `servers/stackexchange/server.js`: 3 tools register w/ outputSchema; `site` defaults to `stackoverflow` and is a free URLSearchParams passthrough; `seUrl()` spreads `stackExchangeParams()` (emits `key` only when set) and keeps a secret-free `cacheKey`; `filter=withbody` on every call. Tests: `seUrl emits no key param when unset (keyless degrade)`, `sends key in URL but NEVER in cache key`. |
| 2 | Lobsters (`lobsters_hottest`/`_tag`/`_get`) and Dev.to servers return contract-shaped results with no auth. | ✓ VERIFIED | `servers/lobsters/server.js` (4 tools, no creds import) + `servers/devto/server.js` (4 tools, Forem Accept header, no creds). Both feed `map*()` into `buildListEnvelope`/`buildDetailEnvelope`; both envelopes parse `ListEnvelopeSchema`/`DetailEnvelopeSchema` in tests. |
| 3 | Lemmy (`lemmy_hot`/`_search`/`_post`) work on public reads and auto-authenticate when `LEMMY_*` set, exercising the auth.js username/password path end-to-end. | ✓ VERIFIED | `servers/lemmy/server.js`: anonymous programming.dev reads (`lemmyInstance()` default); auth wire `lemmyAuthHeaders()`→`bearerHeaders()`→`lemmyJwt()`→`lemmyCreds()` (all 3 env vars required). Behavioral spot-check: `bearerHeaders(token)`→`{Authorization: Bearer …}`, `bearerHeaders(null)`→`{}`. `lemmyJwt` POSTs `/api/v3/user/login`. Live authenticated read is an optional human confirmation (see human_verification). |
| 4 | Hashnode returns trending-by-tag, search, article via public GraphQL with reactions→score, responses→num_comments. | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `servers/hashnode/server.js` present + wired via `postJson`; `mapHashnodeNode` maps `reactionCount`→score, `responseCount`→num_comments, `tags[].slug`→tags; offline tests pass against fixtures. BUT fixtures are schema-derived (live origin returned Cloudflare 522), so live field names are unconfirmed. Routed to human verification. |
| 5 | All five servers pass the Universal Server Bar. | ✓ VERIFIED | All 5 register tools with outputSchema (smoke passed); zero `fetch(`/`process.env` in non-comment source (grep = 0 each); all HTTP via `getJson`/`postJson`; envelopes via shared contract factories; keyless/anonymous degradation proven. |

**Score:** 4/5 truths verified (1 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `servers/stackexchange/server.js` | SE server, 3 tools | ✓ VERIFIED | Wired, keyless-degrading, filter=withbody. |
| `servers/lobsters/server.js` | Lobsters, 4 tools | ✓ VERIFIED | Plain-string `submitter_user` author (Pitfall 6). |
| `servers/lemmy/server.js` | Lemmy, 3 tools + auth wire | ✓ VERIFIED | Conditional Bearer via getJson headers. |
| `servers/hashnode/server.js` | Hashnode, 3 tools via postJson | ✓ WIRED | Live field-name confirmation pending (see SC4). |
| `servers/devto/server.js` | Dev.to, 4 tools via getJson | ✓ VERIFIED | `toTags()` normalizes array/string tag_list. |
| `shared/http_client.js` `postJson()` | POST + body-aware cache | ✓ VERIFIED | Reuses BACKOFF/RETRYABLE/stale; `url+sha1(body)` key. |
| `shared/credentials.js` `lemmyInstance()` | LEMMY_INSTANCE \|\| default | ✓ VERIFIED | Reads only via `get()`; defaults programming.dev. |
| 5 manifests | .mcpb scaffolds | ⚠️ minor | See Anti-Patterns (lemmy_username sensitive flag). |
| test fixtures + suites | offline units | ✓ VERIFIED | 156/156 pass; lemmy fixtures untracked in git (info). |

### Key Link Verification

| From | To | Via | Status |
|------|----|----|--------|
| lemmy/server.js | shared/auth.js `lemmyJwt` | `lemmyAuthHeaders`→`bearerHeaders`→`Bearer` header on getJson | ✓ WIRED |
| lemmy/server.js | credentials.js `lemmyInstance` | `${base}/api/v3/...` | ✓ WIRED |
| hashnode/server.js | http_client.js `postJson` | GraphQL POST, user input via `variables` only | ✓ WIRED |
| all 5 map*() | contract.js factories | `buildListEnvelope`/`buildDetailEnvelope` | ✓ WIRED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full offline suite | `node --test` | 156 pass / 0 fail | ✓ PASS |
| 5-server registration + outputSchema | dynamic import smoke | all 5 OK | ✓ PASS |
| Lemmy auth-wire decision | `bearerHeaders`/`lemmyAuthHeaders` | Bearer-when-token, {} when null | ✓ PASS |
| No fetch/process.env | grep non-comment source | 0/0 each server | ✓ PASS |
| Lemmy fixtures load/parse | JSON.parse untracked fixtures | posts=5, post_view+comments present | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
|-------------|-------------|--------|----------|
| SRC-01 (Stack Exchange) | 02-01 | ✓ SATISFIED | 3 tools, site param, optional key, tests pass. |
| SRC-02 (Lobsters) | 02-02 | ✓ SATISFIED | 4 tools, no auth, tests pass. |
| SRC-03 (Lemmy) | 02-02 | ✓ SATISFIED | 3 tools, anon reads + auth wire, tests pass. |
| SRC-04 (Hashnode) | 02-03 | ✓ SATISFIED (offline) | 3 tools via GraphQL; live field-name confirm pending. |
| SRC-05 (Dev.to) | 02-03 | ✓ SATISFIED | 4 tools, Forem REST, live fixtures, tests pass. |

All 5 declared requirement IDs accounted for. No orphaned IDs (REQUIREMENTS.md maps exactly SRC-01..05 to Phase 2). **Note:** REQUIREMENTS.md traceability still marks SRC-02 and SRC-03 as Pending/unchecked despite complete, tested servers — documentation lag, not a code gap.

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `servers/lemmy/manifest.json` | `lemmy_username` field `sensitive: false` | ⚠️ Warning | Plan 02-02 Task 3 specified `sensitive: true` for both LEMMY_USERNAME/PASSWORD; only PASSWORD (the real secret) is marked sensitive. Username is arguably not a secret, but deviates from the plan and CLAUDE.md ("sensitive: true for any credential"). |
| `servers/lemmy/server.js` | `lemmy_search` omits `limit` param | ℹ️ Info | IN-02 from 02-REVIEW.md not applied; minor API inconsistency, not a correctness bug. |
| `test/fixtures/lemmy-{list,detail}.json` | untracked in git | ℹ️ Info | Fixtures load and tests pass; orchestrator handles commit. |

No debt markers (TBD/FIXME/XXX) found. All 02-REVIEW.md findings (CR-01 + WR-01..05) confirmed fixed in code: `requireSeQuestion`, secret-free `cacheKey`+`redactUrl`, `SEARCH_SORT` passthrough, `requireHashnodePost`, `transientFailure`-scoped stale fallback, `requireLobstersStory`/`requireDevtoArticle`.

### Human Verification Required

1. **Hashnode live-origin confirmation (SC4 / SRC-04)** — call `hashnode_trending`/`hashnode_get` against `https://gql.hashnode.com/public` once reachable; confirm the endpoint responds and `reactionCount`/`responseCount`/`tags[].slug` are the live field names. Fixtures were schema-derived because the origin returned Cloudflare 522 during execution.
2. **Lemmy live authenticated read (SC3 / SRC-03, optional)** — with real `LEMMY_INSTANCE`+`LEMMY_USERNAME`+`LEMMY_PASSWORD`, confirm `lemmy_hot` attaches `Authorization: Bearer <jwt>` and returns posts; absent creds degrade to anonymous with no error. Offline wiring is proven; live exchange needs real credentials.

### Gaps Summary

No blocking gaps. All five servers exist, register the exact ROADMAP tool names each with an outputSchema, route all HTTP through the shared `getJson`/`postJson` (zero direct `fetch`, zero `process.env` outside credentials.js), assemble output via the shared contract factories, and degrade to keyless/anonymous. The full offline suite passes 156/156. The phase goal — mechanical copy-a-folder breadth with the contract holding across SE query params, Lobsters/Dev.to REST, Lemmy federated + auth, and Hashnode GraphQL — is achieved in code.

Two items require human confirmation because they depend on live external services that could not be exercised offline: the Hashnode live-origin field-name check (origin was down during execution) and the optional Lemmy live authenticated read (needs real credentials). Neither is a code defect; both are external-service confirmations. Status is `human_needed` accordingly.

---

_Verified: 2026-07-02_
_Verifier: Claude (gsd-verifier)_
