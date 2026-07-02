---
phase: 03-keyed-ecosystem-launch-sources
verified: 2026-07-02T00:00:00Z
status: human_needed
score: 4/4 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "With LIBRARIESIO_KEY set, call librariesio_search with NO query (broad most-depended list) against the live API."
    expected: "The live Libraries.io /search accepts an empty q and returns a most-depended package list (OQ2/A2 primary branch). If it rejects an empty q, apply the documented one-line fallback (make query required)."
    why_human: "Required-credential live call; no LIBRARIESIO_KEY in this environment. Offline fixtures cover the map + envelope but cannot exercise the live empty-q contract."
  - test: "With PRODUCTHUNT_TOKEN set, call producthunt_launches (period today) against the live PH v2 GraphQL endpoint."
    expected: "The query args order: VOTES, postedAfter, and topic resolve against the live schema and return launches (OQ4/A1/IN-02). A wrong arg/enum name surfaces loudly via requirePhOk (clean GraphQL error, not a silent empty list); adjust only the query string per the documented fallback if so."
    why_human: "Required-credential live call; no PRODUCTHUNT_TOKEN in this environment. GraphQL argument/enum names are cited-but-unconfirmed against the live schema (mapper is unaffected either way)."
---

# Phase 3: Keyed Ecosystem & Launch Sources Verification Report

**Phase Goal:** Add the ecosystem-signal and launch sources that exercise optional-PAT and required-credential handling, surfacing pain-point and momentum signal for blog topics. (GitHub optional-PAT; Libraries.io + Product Hunt required-credential.)
**Verified:** 2026-07-02
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Phase 3 Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | GitHub server returns trending repos (Search API, stars→score) AND issues for pain-point mining (reactions→score, comments→num_comments), PAT-when-present / anonymous-otherwise | ✓ VERIFIED | `mapGhRepo` score=`stargazers_count`, type `repo`, num_comments null (server.js:78-92); `mapGhIssue` score=`reactions?.total_count ?? null`, num_comments=`comments`, type `issue` (server.js:103-117); `gh_trending_repos` uses `/search/repositories?sort=stars`, `gh_search_issues` uses `/search/issues?sort=reactions`; `ghHeaders()` spreads `githubHeaders()`→`{}` when unset. credentials.test.js:106,112 prove both PAT and anonymous branches. OQ1 live smoke ran → reactions present in 5/5 list items (primary branch). |
| 2 | Libraries.io server returns rising/most-depended packages AND fails with a clear "set LIBRARIESIO_KEY" error when the required key is missing | ✓ VERIFIED | `librariesio_search` sort default `dependents_count`, `mapLibProject` score=`dependents_count`, type `package` (server.js:65-79); `libUrl` folds `librariesIoParams()` which throws `Missing credential: set LIBRARIESIO_KEY` before any request (credentials.js:66, server.js:105-112). libraries.test.js:176 asserts the throw; :152 asserts api_key in URL but never in cacheKey. |
| 3 | Product Hunt server returns today/this-week launches by topic AND fails with a clear "set PRODUCTHUNT_TOKEN" error when the token is missing | ✓ VERIFIED | `producthunt_launches` period today/week, optional topic slug, `mapPhPost` score=`votesCount`, num_comments=`commentsCount`, type `launch` (server.js:73-89, 169-209); `productHuntHeaders()` throws `Missing credential: set PRODUCTHUNT_TOKEN` before the call (credentials.js:69). producthunt.test.js:202 asserts the throw; `requirePhOk` throws on GraphQL 200-with-errors (:174) so no silent empty list. |
| 4 | All three servers pass the Universal Server Bar, with required-credential error behavior explicitly verified | ✓ VERIFIED | Tools register + declare outputSchema (github.test.js:239-255, libraries/producthunt equivalents); normalize helpers unit-tested against fixtures; envelope round-trips parse against `ListEnvelopeSchema`/`DetailEnvelopeSchema`; all HTTP via `getJson`/`postJson` (grep: 0 `fetch(`); no `process.env` outside credentials.js (grep: 0 in servers/); required-cred throws unit-tested for both keyed sources. |

**Score:** 4/4 truths verified (0 present, behavior-unverified)

All PLAN frontmatter must_have truths (03-01: 5 truths; 03-02: 4 truths) map onto and are subsumed by these four roadmap criteria, and each is individually satisfied by the evidence above.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `shared/contract.js` TYPE enum | Additively extended with `issue`, `package`, `launch` | ✓ VERIFIED | Appended after the original nine (contract.js:38-40); contract.test.js:72,97,108 parse; :122 rejects bogus type (enum stays closed) |
| `servers/github/server.js` | 3 tools + map helpers, optional PAT | ✓ VERIFIED | `gh_trending_repos`, `gh_search_issues`, `gh_get_item` register; exports `mapGhRepo`/`mapGhIssue`/`mapGhIssues`/`mapGhIssueDetail`/`requireGhResource`/`requireGhIssueNotPr` |
| `servers/github/manifest.json` | Sensitive optional `github_token` | ✓ VERIFIED | `sensitive: true`, `required: false`, maps `GITHUB_TOKEN` |
| `servers/librariesio/server.js` | 2 tools + secret-free `libUrl` | ✓ VERIFIED | `librariesio_search`, `librariesio_get`; `libUrl` splits authed URL from secret-free cacheKey |
| `servers/librariesio/manifest.json` | Required sensitive `librariesio_key` | ✓ VERIFIED | `sensitive: true`, `required: true`, maps `LIBRARIESIO_KEY` |
| `servers/producthunt/server.js` | 2 tools over GraphQL `postJson` | ✓ VERIFIED | `producthunt_launches`, `producthunt_get`; `requirePhOk` guard after every postJson |
| `servers/producthunt/manifest.json` | Required sensitive `producthunt_token` | ✓ VERIFIED | `sensitive: true`, `required: true`, maps `PRODUCTHUNT_TOKEN` |
| Test files + fixtures | github/libraries/producthunt/contract tests | ✓ VERIFIED | All present; full suite 203/203 green |
| `build-mcpb.sh` (new servers) | Absent (deferred to v2/PKG-01) | ✓ VERIFIED | None present in the three server dirs (matches every existing server) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| GitHub handlers | `api.github.com` | `getJson(url, { headers: ghHeaders() })` → map → envelope → `toolResult` | ✓ WIRED | PAT only in Authorization header; host is a module constant |
| `mapGhIssue` | list score | `reactions.total_count` read from LIST response (no N+1) | ✓ WIRED | Null-safe `?.`+`??`; OQ1 primary branch confirmed live |
| `libUrl` | `getJson(url,{cacheKey})` | authed URL + secret-free cacheKey (seUrl pattern) | ✓ WIRED | api_key in url, never in cacheKey (libraries.test.js:152) |
| PH handler | `postJson(PH_GRAPHQL,{body,headers})` | checks `raw.errors` before `raw.data.posts.edges` | ✓ WIRED | `requirePhOk` at server.js:200,234 |
| `librariesIoParams`/`productHuntHeaders` | request | throw before any request when env var unset | ✓ WIRED | credentials.js:44-48,66,69; unit-tested throws |
| item types `package`/`launch` | `z.enum(TYPE)` | contract extension from 03-01 Task 1 | ✓ WIRED | contract.test.js round-trips pass |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full offline suite | `npm test` | tests 203, pass 203, fail 0 | ✓ PASS |
| No direct fetch in new servers | `grep "fetch(" servers/{github,librariesio,producthunt}/server.js` | 0 matches | ✓ PASS |
| No process.env outside credentials.js | `grep "process.env" servers/` | 0 matches | ✓ PASS |
| githubHeaders anonymous + PAT branches | credentials.test.js:106,112 | both assert | ✓ PASS |
| Required-cred throws (both keyed sources) | libraries.test.js:176 / producthunt.test.js:202 | both throw named env var | ✓ PASS |
| Live Libraries.io / Product Hunt smokes | (requires keys) | not runnable offline | ? SKIP → human |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SRC-06 | 03-01 | GitHub server — trending repos + issues pain-point mining; optional PAT | ✓ SATISFIED | GitHub server + tests; REQUIREMENTS.md marks Phase 3 Complete |
| SRC-07 | 03-02 | Libraries.io server (rising/most-depended); required key | ✓ SATISFIED | Libraries.io server + required-cred throw test |
| SRC-08 | 03-02 | Product Hunt server (today/this-week launches); required token | ✓ SATISFIED | Product Hunt server + required-cred throw test |

All three phase requirement IDs declared in PLAN frontmatter (`requirements:` fields) are accounted for and map 1:1 to REQUIREMENTS.md (lines 32-34), all marked Complete for Phase 3. No orphaned Phase 3 requirements: REQUIREMENTS.md maps only SRC-06/07/08 to Phase 3, all claimed by plans.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No TODO/FIXME/XXX/HACK/PLACEHOLDER in any modified file | — | None |

Code-review warnings WR-01 (PH null-safe edge filtering), WR-02 (`||` on URL/permalink fallback), WR-03 (`requireGhIssueNotPr` on detail path) were all verified fixed in the current source: `edges.filter((e) => e?.node)` (producthunt/server.js:205), `mapPhDetail` edge filter (:100), `url: p.package_manager_url || ...` (librariesio/server.js:74-75), `url: node.website || null` (producthunt/server.js:82), `requireGhIssueNotPr` present and called (github/server.js:168,316). Three info items (IN-01 comment truncation, IN-02 PH live schema, IN-03 best-effort comments fetch) are documented and deferred; IN-02 overlaps human-verification item #2 below.

### Human Verification Required

Both items are residual **live-API** confirmations that cannot run in this offline environment (no `LIBRARIESIO_KEY` / `PRODUCTHUNT_TOKEN` set). The offline unit tests cover both credential-present and credential-missing code paths, both mappers, envelope conformance, and the required-credential throws — so the phase goal is met on offline evidence. These items confirm the CITED primary branch matches the live API; both have documented, contract-preserving fallbacks.

1. **Libraries.io empty-`q` live behavior (OQ2/A2)**
   - **Test:** With `LIBRARIESIO_KEY` set, call `librariesio_search` with no `query`.
   - **Expected:** Live `/search` accepts empty `q` and returns a most-depended list. If rejected, apply the one-line fallback (make `query` required — keyword-scoped most-depended still satisfies SRC-07).
   - **Why human:** Required-credential live call; not runnable without the key.

2. **Product Hunt GraphQL arg/enum names (OQ4/A1, IN-02)**
   - **Test:** With `PRODUCTHUNT_TOKEN` set, call `producthunt_launches` (period today).
   - **Expected:** `order: VOTES`, `postedAfter`, `topic` resolve against the live schema and return launches. A wrong name surfaces via `requirePhOk` as a clean GraphQL error (not a silent empty list); adjust only the query string per the documented fallback.
   - **Why human:** Required-credential live call; GraphQL names cited-but-unconfirmed against live schema.

### Gaps Summary

No gaps. All four ROADMAP Phase 3 success criteria and all nine PLAN must_have truths are satisfied by the codebase on offline evidence; all three requirement IDs (SRC-06/07/08) trace and are covered; the Universal Server Bar holds for all three servers (register + outputSchema, unit-tested mappers, exact ARCHITECTURE §4 envelopes, all HTTP via getJson/postJson, no process.env outside credentials.js); required-credential error behavior is explicitly unit-tested for both keyed sources; and all three code-review warnings are fixed. The two open items are live-API confirmations of already-coded primary branches with documented fallbacks — residual verification, not phase failures. Status is `human_needed` solely because those two live smokes require credentials unavailable in this environment.

---

_Verified: 2026-07-02_
_Verifier: Claude (gsd-verifier)_
