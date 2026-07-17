---
phase: 05-guarded-json-path-trending-signals
verified: 2026-07-10T00:00:00Z
status: passed
score: 19/19 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 5: Guarded JSON Path & Trending Signals Verification Report

**Phase Goal:** Every user-supplied-host JSON request is SSRF-guarded, and agents can pull trending and pain-point signals from HN, Stack Exchange, and Dev.to.
**Verified:** 2026-07-10
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### ROADMAP Success Criteria (the contract)

| # | Success Criterion | Status | Evidence |
| - | ----------------- | ------ | -------- |
| 1 | User-supplied-host JSON request resolving to private/loopback/metadata is rejected; guard covers JSON (untrustedHost path) not just getText; Lemmy rides it | ✓ VERIFIED | `getJson` untrustedHost branch routes through `fetchTextManual`→`assertSafeUrl` (http_client.js:303-305); 169.254.0.0/16 + 127.0.0.0/8 in DENY BlockList (:81,:80); 8 behavioral tests pass (blocked-before-fetch, no-retry, no-stale, redirect re-validation); Lemmy 4 call sites carry `untrustedHost: true` |
| 2 | Dev.to top for N days AND rising, combinable with a tag, in the contract (mode/days/tag) | ✓ VERIFIED | `devto_top` extended in place with `mode` enum + `days` + `tag` (devto/server.js:180-200); `devtoTopUrl` builds `top=<days>` vs `state=rising`, tag in both modes; tests green |
| 3 | Mine high-view no-answers SE per tag ranked by view_count; repeated calls honor backoff (sleep-within) | ✓ VERIFIED | `so_unanswered` fetches `/questions/no-answers`, client re-ranks by view_count desc (stackexchange/server.js:308-330); `seThrottle` sleeps `backoff*1000` and throws set-STACKEXCHANGE_KEY on quota_remaining=0; sleepSpy tests confirm the wait |
| 4 | Rising HN stories with tunable hours/min-points, velocity re-sort, in the contract | ✓ VERIFIED | `hn_rising` tool (hn/server.js:204-243); `rankByVelocity` re-sorts BEFORE `.map(mapHnHit)`; tunable hours(24)/minPoints(10); ordering test proves fresh climber outranks older high-points hit |

### Observable Truths (from PLAN must_haves)

| # | Truth | Status | Evidence |
| - | ----- | ------ | -------- |
| 1 | getJson untrustedHost host resolving to 127.0.0.1/169.254.169.254 rejected with redacted "blocked address" before any body read | ✓ VERIFIED | http_client.js:303-305 + assertSafeUrl:203-216; tests at http_client.test.js:461,478,495 assert `/blocked address/` |
| 2 | HTML-content-type 200 → terminal non-JSON error, no crash, not retried, not stale | ✓ VERIFIED | Content-type gate :313-321; test:513 seeds stale cache, asserts reject + `sleep.waited==[]` + no stale served |
| 3 | user:pass@host rejected on guarded path | ✓ VERIFIED | assertSafeUrl:185-187; test:571 asserts `/credentials in URL/i` + fetch.calls==0 |
| 4 | Lemmy's getJson calls pass untrustedHost:true | ✓ VERIFIED | lemmy/server.js:159,196,227,231 (4 call sites, ≥3 required) |
| 5 | Fixed-host callers (HN/SE/Dev.to) unchanged, zero DNS cost | ✓ VERIFIED | Non-flag branch calls `fetchWithTimeout` unchanged :305; test:589 proves guard is opt-in; all prior tests green |
| 6 | No port/scheme restriction beyond assertSafeUrl; only resolved IP rejects | ✓ VERIFIED | assertSafeUrl has scheme allowlist only, no port check; inherited verbatim |
| 7 | SEC-03 DNS-rebinding TOCTOU RE-ACCEPTED, not implemented (no IP-pinning dispatcher) | ✓ VERIFIED | Documented residual at http_client.js:155-166; SEC-03 in REQUIREMENTS.md v2+ (accepted-risk); no undici custom-lookup dispatcher added |
| 8 | hn_rising ordered by points/hour velocity, never raw date order | ✓ VERIFIED | rankByVelocity before map (hn/server.js:235); ordering test green |
| 9 | hours/minPoints tunable, defaults 24/10 | ✓ VERIFIED | inputSchema :214-219, handler defaults :222 |
| 10 | Optional query scopes rising; absent = site-wide | ✓ VERIFIED | `if (query) url += ...` :231; query optional in schema |
| 11 | Velocity ordering-only; item shape unchanged, type stays 'story' | ✓ VERIFIED | mapHnHit reused unchanged; velocity never enters item |
| 12 | so_unanswered mines no-answers for REQUIRED tag, ranks by view_count desc, score=view_count | ✓ VERIFIED | `tag: z.string()` required :302; sort/slice/map :324-327; mapSeUnanswered overrides score :103-105 |
| 13 | quota_remaining=0 throws set-STACKEXCHANGE_KEY via seThrottle | ✓ VERIFIED | seThrottle:127-131; test asserts `/STACKEXCHANGE_KEY/` |
| 14 | backoff field honored by sleeping backoff seconds before follow-up | ✓ VERIFIED | seThrottle:132-134; sleepSpy test asserts single 3000ms wait |
| 15 | Envelope frozen — no backoff/quota_remaining field added (OQ-1) | ✓ VERIFIED | contract.js has 0 occurrences of backoff/quota_remaining; throttle rides error/behavioral path; envelope-conformance test passes |
| 16 | devto_top top/rising both, combinable with tag | ✓ VERIFIED | devtoTopUrl:144-157; both modes + tag; tests green |
| 17 | devtoTopUrl throws on rising+days before fetch | ✓ VERIFIED | :145-150 throws; handler builds URL before getJson :191; test asserts `/days/` throw |
| 18 | days validated as integer, rejects "week" | ✓ VERIFIED | `z.number().int()` :183; schema test rejects `"week"` |
| 19 | item shape unchanged; reuse mapDevtoArticle; type stays 'article' | ✓ VERIFIED | mapDevtoArticle unchanged; type "article" :82 |

**Score:** 19/19 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `shared/http_client.js` | getJson untrustedHost + content-type gate; assertSafeUrl creds reject | ✓ VERIFIED | Substantive + wired; imported by all servers |
| `servers/lemmy/server.js` | 3 getJson sites on guarded path | ✓ VERIFIED | 4 call sites carry untrustedHost:true |
| `servers/hn/server.js` | hn_rising + risingNumericFilters + rankByVelocity | ✓ VERIFIED | All exported, wired into registered tool |
| `servers/stackexchange/server.js` | so_unanswered + mapSeUnanswered + seThrottle | ✓ VERIFIED | All exported and wired |
| `servers/devto/server.js` | devto_top extended + devtoTopUrl | ✓ VERIFIED | Extended in place (still 4 tools) |
| `test/*` (5 fixtures + test files) | SSRF + trending + throttle coverage | ✓ VERIFIED | 3 SE fixtures present; tests drive handlers/helpers |

### Key Link Verification

| From | To | Via | Status |
| ---- | -- | --- | ------ |
| getJson untrustedHost | fetchTextManual → assertSafeUrl | reused verbatim, no forked guard | ✓ WIRED |
| lemmy handlers | getJson | untrustedHost:true opt | ✓ WIRED |
| hn_rising handler | rankByVelocity | re-sort before mapHnHit | ✓ WIRED |
| so_unanswered handler | seThrottle + view_count sort | error/behavioral path | ✓ WIRED |
| devto_top handler | devtoTopUrl | pre-fetch URL build + throw | ✓ WIRED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Phase test files | `node --test test/{http_client,lemmy,hn,stackexchange,devto}.test.js` | 137 pass, 0 fail | ✓ PASS |
| Full suite | `npm test` (`node --test`) | 291 pass, 0 fail | ✓ PASS |
| SSRF blocked-address cases present | grep test/http_client.test.js | 8 guarded-getJson cases | ✓ PASS |
| Contract frozen (no throttle fields) | grep contract.js | 0 backoff/quota_remaining | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
| ----------- | ----------- | ------ | -------- |
| SEC-01 | 05-01 | ✓ SATISFIED | Guarded JSON path + Lemmy on it; REQUIREMENTS.md marks Complete |
| TREND-01 | 05-04 | ✓ SATISFIED | devto_top mode/days/tag |
| TREND-02 | 05-03 | ✓ SATISFIED | so_unanswered view_count + backoff |
| TREND-03 | 05-02 | ✓ SATISFIED | hn_rising velocity re-sort |
| SEC-03 | (deferred) | ✓ N/A | Correctly NOT implemented; re-accepted + documented (v2+); no plan claimed it |

All four phase requirement IDs accounted for. SEC-03 was correctly deferred to v2+ (accepted-risk, documented in http_client.js:155-166) rather than implemented.

### Anti-Patterns Found

None. No TODO/FIXME/XXX/TBD/HACK/PLACEHOLDER markers in any of the five modified source files.

### Output Contract Preservation (NON-NEGOTIABLE)

- ✓ TYPE enum unchanged (12 values; no new values added — rising items are "story", unanswered are "question", devto stays "article")
- ✓ No new envelope fields (listEnvelopeShape still `{source, query, count, results}`)
- ✓ No new item fields (itemShape unchanged; velocity never enters item)
- ✓ score/num_comments never renamed/dropped (mapSeUnanswered overrides score *value* to view_count — a value change per D-08, not a schema change)
- ✓ OQ-1 honored: SE throttle added NO backoff/quota_remaining to any envelope — rides sleep-within + error path only (0 occurrences in contract.js)

### Human Verification Required

None. Every behavior-dependent truth (SSRF reject-before-body, no-retry, no-stale, per-hop redirect re-validation, backoff sleep-within, velocity ordering) is exercised by a passing behavioral test with injected fetch/lookup/sleep — not presence-only.

### Gaps Summary

No gaps. All 19 must-have truths, all 4 ROADMAP success criteria, all 5 artifacts, all key links verified against the actual source. The full test suite is green (291/291). The frozen output contract is intact and SEC-03 is correctly deferred and documented.

---

_Verified: 2026-07-10_
_Verifier: Claude (gsd-verifier)_
