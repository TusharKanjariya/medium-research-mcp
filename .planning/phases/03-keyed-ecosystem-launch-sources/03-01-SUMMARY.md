---
phase: 03-keyed-ecosystem-launch-sources
plan: 01
subsystem: source-servers
tags: [github, source-server, contract, type-enum, optional-pat, pain-point-mining]
requires:
  - shared/contract.js (buildListEnvelope, buildDetailEnvelope, toolResult, TYPE)
  - shared/http_client.js (getJson)
  - shared/credentials.js (githubHeaders)
provides:
  - "TYPE enum values: issue, package, launch (unblocks 03-02 package/launch)"
  - "servers/github/server.js: mapGhRepo, mapGhIssue, mapGhIssues, mapGhIssueDetail, requireGhResource, server"
  - "tools: gh_trending_repos, gh_search_issues, gh_get_item"
affects:
  - 03-02 (Libraries.io package + Product Hunt launch depend on the TYPE extension)
tech-stack:
  added: []
  patterns:
    - "Additive append-only TYPE enum extension (no removal/reorder — validation gate)"
    - "Optional-credential-in-header degrade to anonymous (githubHeaders() -> {})"
    - "GitHub Search qualifiers composed into q + URL-encoded (Pitfall 6)"
    - "PR-skip filter on /search/issues (Pitfall 5)"
    - "Null-safe reaction score (never a fabricated 0) — OQ1 contingency"
key-files:
  created:
    - servers/github/server.js
    - servers/github/manifest.json
    - test/github.test.js
    - test/fixtures/github-repos.json
    - test/fixtures/github-issues.json
    - test/fixtures/github-issue-detail.json
    - test/fixtures/github-issue-comments.json
  modified:
    - shared/contract.js
    - docs/ARCHITECTURE.md
    - test/contract.test.js
decisions:
  - "OQ1 live smoke RESOLVED to the PRIMARY branch: reactions.total_count is present in 5/5 /search/issues list items on X-GitHub-Api-Version 2022-11-28, so list score is populated directly from the search response with NO per-issue N+1 fetch"
  - "TYPE extended append-only (issue/package/launch after the original nine) so structuredContent validation never breaks existing servers"
  - "repo url prefers a non-blank homepage else html_url (|| not ??, since GitHub returns homepage as \"\")"
  - "issue id uses `number` (what detail/comment URLs need), not the internal id"
metrics:
  duration_min: 6
  tasks: 2
  files: 10
  tests_added: 9
  tests_total: 165
completed: 2026-07-02
status: complete
requirements: [SRC-06]
---

# Phase 03 Plan 01: GitHub Source Server + TYPE Enum Extension Summary

GitHub source server (SRC-06) delivering two entity types on the uniform contract —
trending repos (stars->score) and open issues for pain-point mining
(reactions.total_count->score, comments->num_comments) — with an optional PAT that
degrades to anonymous access, preceded by the append-only `TYPE` enum extension
(`issue`/`package`/`launch`) that unblocks every Phase 3 source.

## What Was Built

### Task 1 — Shared `TYPE` enum extension (phase prerequisite)
Appended `issue`, `package`, `launch` to `shared/contract.js` `TYPE` after the
original nine values (additive; no removal/reorder). Because `toolResult()`
validates `structuredContent` against `z.enum(TYPE)` on every return, this was a
hard BLOCKER (Pitfall 1) for any server emitting `type:"issue"` / `"package"` /
`"launch"`. Synced the `docs/ARCHITECTURE.md` §4 type comment to match, and added
contract tests asserting the three new types parse, the nine prior values remain as
the leading prefix, and a bogus type is still rejected (enum stays closed).

### Task 2 — GitHub server (`gh_trending_repos`, `gh_search_issues`, `gh_get_item`)
Copied the Stack Exchange template. Field maps:
- `mapGhRepo`: stars->score, num_comments null, type `repo`, tags = language +
  topics, url prefers a non-blank homepage else html_url.
- `mapGhIssue`: `reactions.total_count`->score (null-safe — null, never 0, when the
  reactions object is absent), comments->num_comments, type `issue`, labels->tags
  (handles both `{name}` objects and bare strings), body->text.
- `mapGhIssues`: drops any item carrying a `pull_request` key so PRs never pollute
  pain-point results (Pitfall 5).
- `gh_get_item`: `{ owner, repo, number }` -> issue detail whose top-level comments
  become `comments[]`; `{ owner, repo }` -> repo detail with `comments: []`.

Search qualifiers (`language:`, `label:"..."`, `repo:`, `is:issue`, `is:open`,
`pushed:>cutoff`) are composed into `q` and URL-encoded; only `sort`/`order`/
`per_page` are real params (Pitfall 6). All HTTP goes through `getJson()`; the PAT
rides only in the `Authorization` header via `githubHeaders()` (never URL, cache
key, or logs); the outbound host is a module constant (SSRF-safe). `manifest.json`
carries a single sensitive optional `github_token`; no `build-mcpb.sh` (PKG-01/v2).

## OQ1 Live Smoke Outcome (GATING)

**Branch: PRIMARY (reactions present).** One live `GET /search/issues?q=flaky tests
is:issue is:open&sort=reactions&order=desc&per_page=5` call against
`X-GitHub-Api-Version: 2022-11-28` returned HTTP 200 with `reactions.total_count`
present in **5/5** list items (top item total_count = 2312). List `score` is
therefore populated directly from the search response — the primary D-09 path — with
**no per-issue N+1 fetch** in the list path. The offline fixture test still covers
BOTH branches (an issue with reactions -> score set; an issue with no reactions
object -> score null), so the suite passes regardless of the live environment.

## Verification

- `node --test test/contract.test.js` — 17/17 (issue/package/launch parse; nine
  prior types intact; bogus rejected).
- `node --test test/github.test.js` — 20/20 (map helpers, PR skip, both OQ1
  branches, envelope round-trips, registration, no-fetch/no-env invariant).
- `npm test` (full suite) — **165/165 green**, no regression across shared + six
  servers.
- grep: no `fetch(` and no `process.env` in `servers/github/server.js` (0 matches).

## Deviations from Plan

None — plan executed exactly as written. The OQ1 contingency resolved to the
primary branch via the gating live smoke; the null-safe fallback path is
implemented and test-covered but is not the live path.

## Known Stubs

None. Both entity types return live-mappable data; the null-safe issue `score`
fallback is contract-legal behavior (score may be null), not a stub.

## Threat Flags

None. No new trust boundary beyond the plan's `<threat_model>` (fixed
`api.github.com` host; PAT only in the Authorization header; encoded q + path
segments). No package installs this phase (T-03-SC).

## For Downstream Plans

- 03-02 (Libraries.io + Product Hunt) can now emit `type:"package"` / `type:"launch"`
  — the `TYPE` extension is live and contract-tested.
- The `searchUrl`/qualifier-in-`q` + secret-in-header pattern is reusable; note
  Libraries.io's `api_key` is a QUERY param, so it needs the `seUrl`-style
  secret-free cacheKey split (unlike GitHub's header PAT).

## Self-Check: PASSED

All 11 created/modified files present on disk; all 4 task commits
(6fffb72, 3cf3af5, 149f80c, c520493) present in git history.
