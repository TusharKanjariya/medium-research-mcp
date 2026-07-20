---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: Writer-Aware, Universal Research
status: Awaiting next milestone
stopped_at: "Phase 08 complete (UAT 2/2 passed, SECURITY.md threats_open: 0) — v1.1 milestone 100% complete"
last_updated: "2026-07-20T12:48:00.000Z"
last_activity: 2026-07-20
last_activity_desc: Quick task 260720-p45 — SE error opacity + gh_trending newOnly window
progress:
  total_phases: 4
  completed_phases: 4
  total_plans: 15
  completed_plans: 15
  percent: 100
current_phase: 08
current_phase_name: universal-distribution
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-17)

**Core value:** Uniform normalized output across every source, so `medium-blog-pro` consumes any source with zero per-source logic.
**Current focus:** Planning next milestone (v1.1 shipped + archived) — start via `/gsd-new-milestone`

## Current Position

Phase: Milestone v1.1 complete
Plan: —
Status: Awaiting next milestone
Last activity: 2026-07-17 — Milestone v1.1 completed and archived

## Performance Metrics

**Velocity:**

- Total plans completed: 27 (v1.0)
- Average duration: — min
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1 | 3 | - | - |
| 02 | 3 | - | - |
| 3 | 2 | - | - |
| 4 | 4 | - | - |
| 05 | 4 | - | - |
| 6 | 3 | - | - |
| 7 | 4 | - | - |
| 08 | 4 | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*
| Phase 02 P01 | 1min | 2 tasks | 6 files |
| Phase 02 P02 | 15min | 3 tasks | 12 files |
| Phase 02 P03 | 25min | 3 tasks | 13 files |
| Phase 03 P01 | 6 | 2 tasks | 10 files |
| Phase 03 P02 | 4 | 2 tasks | 10 files |
| Phase 04 P01 | 6min | 3 tasks | 5 files |
| Phase 04 P02 | 2min | 2 tasks | 2 files |
| Phase 04 P03 | 8min | 3 tasks | 7 files |
| Phase 04 P04 | 12min | 3 tasks | 3 files |
| Phase 05 P01 | 15m | 3 tasks | 4 files |
| Phase 05 P02 | 12min | 2 tasks | 2 files |
| Phase 05 P03 | 259 | 3 tasks | 5 files |
| Phase 05 P04 | 12min | 2 tasks | 2 files |
| Phase 06 P01 | 15m | 2 tasks | 4 files |
| Phase 6 P02 | 7min | 3 tasks | 6 files |
| Phase 06 P03 | 16min | 3 tasks | 6 files |
| Phase 07 P01 | 1h | 3 tasks | 4 files |
| Phase 07 P02 | 5m | 3 tasks | 6 files |
| Phase 07 P03 | 14min | 3 tasks | 6 files |
| Phase 07 P04 | 18min | 1 task | 1 file |
**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 08 P01 | 12min | 2 tasks | 13 files |
| Phase 08 P02 | 9min | 2 tasks | 12 files |
| Phase 08 P04 | 15min | 2 tasks | 3 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Init: Node for research servers, Python only for the YouTube wrapper.
- Init: Normalized output contract is the linchpin — every server conforms exactly.
- Init: Coarse granularity, parallel execution (Phases 2 and 3 can run in parallel after Phase 1).
- [v1.1 roadmap]: SEC-01 (guarded JSON path) lands first in Phase 5 — it is the single gating dependency for every tool-param-host server (Discourse, Mastodon, Lemmy's parameterization move in Phase 7).
- [v1.1 roadmap]: Distribution (PKG-01..03) is strictly last (Phase 8) — packaging ships the final tool surface once; nothing feeds back into code.
- [v1.1 roadmap]: Author-blog tools live IN `servers/rss` (not a sibling server) — avoids duplicating the parser or breaking the `servers/* -> shared/*` dependency direction (per research SUMMARY.md).
- [v1.1 roadmap]: Zero new runtime dependencies for v1.1 — `@anthropic-ai/mcpb` is devDependency-only; all new endpoints are keyless JSON/RSS through existing shared modules.
- [Phase ?]: SE text mapped from body_markdown ?? body: built-in withbody filter returns HTML body not body_markdown (A1 corrected); stripHtml cleans downstream
- [Phase 02 P02]: Lemmy authenticated reads require LEMMY_INSTANCE set explicitly (even to the default programming.dev) alongside LEMMY_USERNAME/LEMMY_PASSWORD — lemmyCreds() needs all three; username/password alone degrade to anonymous with no error. Documented in manifest + tool descriptions and asserted by tests.
- [Phase 02 P02]: Lobsters author = plain-string submitter_user (Pitfall 6); Lemmy permalink = post.ap_id (federation URL); Lemmy posts have no tags (tags: []).
- [Phase ?]: [Phase 02 P03]: Hashnode public GraphQL endpoint is gql.hashnode.com/public (root now serves a Vercel app); live origin was down (522) so fixtures built from cited schema, flagged for one live-call A2 verification. — SUPERSEDED 2026-07-02: SRC-04 (Hashnode) dropped and server removed; upstream retired free/keyless GraphQL access (Pro plan required as of 2026-05-13).
- [Phase ?]: [Phase 02 P03]: postJson() cache key = url+sha1(body) via node:crypto so distinct GraphQL queries to one URL never collide; key stays a non-secret logical key.
- [Phase ?]: [Phase 02 P03]: Dev.to tag_list is array on list, comma-string on detail; toTags() normalizes both so contract tags:string[] always holds.
- [Phase ?]: [Phase 03 P01]: TYPE enum extended append-only with issue/package/launch (after the original nine); toolResult validates structuredContent against z.enum(TYPE) so no removal/reorder; unblocks 03-02 package/launch.
- [Phase ?]: [Phase 03 P01]: OQ1 RESOLVED to PRIMARY — reactions.total_count present in 5/5 /search/issues list items on API version 2022-11-28; gh_search_issues score comes from the search response, no per-issue N+1 fetch; mapGhIssue null-safe (score null not 0 when reactions absent).
- [Phase ?]: [Phase 03 P01]: GitHub PAT rides only in the Authorization header via githubHeaders (anonymous degrade); host is a module constant, tool input fills only q + encoded path (SSRF-safe); repo url prefers non-blank homepage else html_url; issue id uses number.
- [Phase ?]: 03-02: Libraries.io score maps dependents_count uniformly (D-04), independent of request sort
- [Phase ?]: 03-02: Product Hunt is the one GraphQL server; requirePhOk guards 200-with-errors before reading data (Pitfall 4)
- [Phase 04]: SSRF controls live on the shared getText chokepoint (assertSafeUrl), not in servers, so every future text source inherits them (D-01/D-02/D-03)
- [Phase 04]: Canonicalize both dotted and WHATWG-hex IPv4-mapped IPv6 before BlockList to close the mapped-encoding SSRF bypass (T-04-05)
- [Phase ?]: Pinned fast-xml-parser to ^4.5.7 (legacy, NOT ^5) with strnum@1.x as sole transitive dep (D-08)
- [Phase ?]: Did not remediate advisory GHSA-gh4j-gqv2-49f6 — affects XMLBuilder (output) which the project never uses; fix requires ^5, violating D-08
- [Phase ?]: RSS server ships a single rss_fetch tool (D-04) — the feed URL is the query and items carry their own content, so no *_get/*_search
- [Phase ?]: YouTube support is branch-free: mapAtomEntry prefers media:group>media:description, so YT-01 (D-15) needs zero host-specific code
- [Phase ?]: Tuned fast-xml-parser processEntities to avoid false-positive entity-limit failures on legitimate code-heavy feeds while keeping billion-laughs output/depth bounds
- [Phase 05]: getJson gains opt-in untrustedHost SSRF guard reusing assertSafeUrl + content-type gate (SEC-01)
- [Phase 05]: hn_rising: velocity is an ordering-only signal; frozen contract preserved (type stays story), tunable hours/minPoints via Algolia numericFilters
- [Phase ?]: devto_top forbidden rising+days combo enforced in exported pure devtoTopUrl (throws pre-fetch), not the raw-shape Zod schema (D-15, Pitfall 4)
- [Phase 06]: Medium 403 is host-gated + terminal (no retry/stale) to avoid IP-ban behavior (T-06-02)
- [Phase ?]: [Phase 06 P02]: rss author/tag tools live in servers/rss reusing getText->parseFeed->normalizeFeed; resolveAuthorFeed infers platform by author shape and THROWS on an ambiguous bare token (never guesses a host, T-06-03)
- [Phase ?]: [Phase 06 P02]: preview/paywall state rides tags[] as the literal 'preview-only' (markPreviewOnly, D-06/D-07) — never a new field, text left clean; contract frozen
- [Phase ?]: [Phase 06 P03]: rss_substack_archive enriches score/num_comments from the unofficial <pub>.substack.com/api/v1/archive JSON on getJson(untrustedHost:true); ANY failure degrades to the RSS feed window and never hard-errors (D-08/09/10)
- [Phase ?]: [Phase 06 P03]: archive-with-fallback logic factored into exported fetchSubstackArchive (injectable getJson/getText) so success + HTML-200 fallback + SSRF-reject drive offline; SSRF re-thrown on both paths, never swallowed into a fake envelope
- [Phase ?]: D-15: Lemmy sends anonymous (drops env Bearer) when tool-param instance host differs from lemmyCreds().instance host — env token never replayed to a caller-chosen host
- [Phase ?]: D-05/D-09: appended append-only TYPE values topic and status; Mastodon trending links reuse the existing article type
- [Phase ?]: 07-02 Discourse category is the combined slug/id token
- [Phase ?]: 07-02 exported mapDiscourseError for offline D-11 unit testing (no handler inject seam)
- [Phase ?]: 07-03 Mastodon: keyless 4-tool server over guarded untrustedHost path; instance a per-call param with no host literal (SEC-02); boosts map from status.reblog; trending score = sum(history[].uses via Number)
- [Phase ?]: 07-03 D-11 Mastodon lockdown: exported mapMastodonError maps /HTTP (401|422)/ to a clear disallows-anonymous-reads message per tool call; D-10 trends /HTTP 404/ -> empty count:0, never throws
- [Phase ?]: 07-04 SEC-02 audit (D-16): committed test/parameterization-audit.test.js scans servers/*/server.js (rss resolve* covered), allowlists fixed platform bases + .substack.com/.medium.com suffixes + programming.dev; string-preserving comment stripper (naive // strip would decapitate https:// literals); URL-embedded @handle guard catches account-in-feed-URL; non-vacuous negative controls; your.lemmy.instance admitted as a documented non-routable placeholder
- [Phase ?]: isEntry() realpaths process.argv[1] so bins work under copy + symlinked installs (Pitfall B); @anthropic-ai/mcpb pinned 2.1.2 devDependency only; files whitelist ships servers/ + shared/
- [Phase ?]: [Phase 08 P02]: manifest_version stays 0.3 (current MCPB spec); D-05 consistency test reads ENV names from credentials.js source and asserts manifest env ⇒ ENV_VAR AND read-by-server (direction-safe, REDDIT_* maps to no server); hn env over-declaration removed
- [Phase ?]: 08-04: cross-source pain-point sweep merges via shared mergeRank with per-source graceful degradation; INSTALL.md is Windows-first per-client with a manual (non-automated) release checklist

### Pending Todos

None yet.

### Blockers/Concerns

None yet.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260708-h5g | Fix CONCERNS.md bugs: astral entity decoding in shared/contract.js, content:encoded bypassing textOf in servers/rss/server.js, and CLAUDE.md drift (nonexistent build-mcpb.sh and inspect:hn) | 2026-07-08 | 80c05ff | [260708-h5g-fix-concerns-md-bugs-astral-entity-decod](./quick/260708-h5g-fix-concerns-md-bugs-astral-entity-decod/) |
| 260720-p45 | Fix SE error opacity (getJson terminal-4xx errors carry a bounded, key=-scrubbed body snippet so throttle_violation is distinguishable from a bad request) and add opt-in gh_trending_repos newOnly created:> window via exported ghTrendingQualifiers | 2026-07-20 | f867996 | [260720-p45-fix-se-error-opacity-and-gh-trending-win](./quick/260720-p45-fix-se-error-opacity-and-gh-trending-win/) |

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Sources | Discourse (SRC-10), Mastodon (SRC-11) | Promoted into v1.1 — Phase 7 | 2026-07-08 |
| Sources | Bluesky (SRC-12) | v2+ — deferred | 2026-07-01 |
| Distribution | `.mcpb` bundles (PKG-01) | Promoted into v1.1 — Phase 8 | 2026-07-08 |
| UAT (live smoke) | Phase 2 Lemmy authenticated read — needs `LEMMY_*` creds; `02-UAT.md` deferred, 0 pending scenarios | Acknowledged at v1.0 close | 2026-07-03 |
| Security (accepted risk) | DNS-rebinding TOCTOU on `getText` (T-04-06) — acceptable for a local single-user tool; IP-pinning tracked as SEC-03 (v2+); reconsider during SEC-01's threat model | Accepted | 2026-07-03 |

## Session Continuity

Last session: 2026-07-20
Stopped at: Quick task 260720-p45 complete (4 commits, 439/439 tests) — SE 4xx errors now carry error_name/error_message; gh_trending_repos newOnly ships
Resume file: None

## Operator Next Steps

- Start the next milestone with /gsd-new-milestone
