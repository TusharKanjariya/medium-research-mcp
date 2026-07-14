# Requirements: medium-research-mcp — Milestone v1.1 Writer-Aware, Universal Research

**Defined:** 2026-07-08
**Core Value:** Uniform normalized output across every source, so the consuming
skill ranks, filters, and cites across sources with zero per-source logic.

Scope note: v1.0 requirements are shipped and archived
(`.planning/milestones/v1.0-REQUIREMENTS.md`). This file covers only the v1.1
milestone. Hard cross-cutting rule for everything below: **no hardcoded
accounts/instances/feeds — targets are tool parameters chosen by the calling
agent at call time; env is for credentials and optional defaults only.**

## v1.1 Requirements

### Author-Blog Awareness (ABLOG)

- [x] **ABLOG-01**: User can fetch an author's recent posts by platform + author
      parameter (Medium `@user`, Substack publication, or raw feed URL) in the
      normalized contract, with HTML-stripped full text and tags

- [x] **ABLOG-02**: User (agent) can tell the coverage window is partial —
      `count` + per-item `created_utc` plus tool descriptions explicitly stating
      the feed caps (~10 posts Medium, ~20 Substack) and paywall truncation

- [x] **ABLOG-03**: User can list a Substack publication's full archive via the
      unofficial JSON API (fills `score`/`num_comments` from reactions/comments;
      degrades to the RSS window on failure, never hard-errors)

- [x] **ABLOG-04**: User can fetch posts by tag/keyword on platforms with tag
      feeds (e.g. Medium `feed/tag/<tag>`), tag as a tool parameter

- [x] **ABLOG-05**: User can follow documented recipes for posting-cadence
      tracking and series/follow-up detection from normal tool output (docs only)

### Trending & Pain-Point Mining (TREND)

- [x] **TREND-01**: User can get Dev.to's top articles for the last N days and
      rising articles, combinable with a tag parameter

- [x] **TREND-02**: User can mine high-view unanswered Stack Exchange questions
      per tag (server fetches a no-answer window, ranks by `view_count`;
      honors the API `backoff` field)

- [x] **TREND-03**: User can get rising Hacker News stories (Algolia
      `search_by_date` velocity ranking with tunable hours / min-points params)

### New Sources (SRC)

- [x] **SRC-10**: User can research any public Discourse forum by instance URL
      parameter — latest topics, top by period, topic detail — in the contract

- [ ] **SRC-11**: User can research any Mastodon instance's public and hashtag
      timelines by instance + hashtag parameters, keyless

- [ ] **SRC-13**: User can get trending tags/links from a Mastodon instance
      (returns empty results gracefully where the instance disables trends)

### Security & Parameterization (SEC)

- [x] **SEC-01**: All user-supplied-host JSON requests route through the shared
      SSRF guard (extends the v1.0 `getText`-only guard to a guarded JSON path;
      Lemmy's instance-parameterized calls move onto the same path)

- [x] **SEC-02**: No hardcoded accounts/instances/feeds exist anywhere in the
      suite — verified by an explicit parameterization audit

### Universal Distribution (PKG)

- [ ] **PKG-01**: User can install any server as a one-click `.mcpb` custom
      connector in Claude Desktop (staged build that bundles `shared/` +
      production deps so `../../shared` imports survive; credentials marked
      `sensitive` in `user_config`)

- [ ] **PKG-02**: User can run any server from npm via `npx` on any MCP client
      (one scoped package, bin entry per server, Windows-safe shebangs)

- [ ] **PKG-03**: User can follow per-client setup docs — Claude Desktop,
      OpenCode, Codex, Cursor — including Windows `cmd /c npx` spawn and
      env-passing quirks

### Documentation (DOC)

- [ ] **DOC-01**: User can follow the cross-source pain-point sweep recipe (one
      tag through SE + Discourse + Mastodon + Dev.to, merged via `mergeRank`)

## v2+ Requirements

Deferred. Tracked but not in the current roadmap.

### Sources

- **SRC-12**: Bluesky (AT Protocol) public feeds — revisit if fediverse
  coverage proves valuable

### Security

- **SEC-03**: IP-pinning custom-lookup dispatcher closing the DNS-rebinding
  TOCTOU residual (T-04-06) — reconsidered during SEC-01's threat model; still
  accepted-risk for a local single-user tool

## Out of Scope

| Feature | Reason |
|---------|--------|
| Medium/Substack stats scraping (claps, views, subscribers) | Not in any feed or public API; requires session scraping — brittle, ToS-hostile. `score: null` is contract-legal |
| Post drafting/publishing | Research tools by charter; drafting is the consuming skill's job |
| Persistent embedding/vector index for dedup | Adds state + heavy deps to a stateless stdio suite; the calling LLM does semantic dedup over titles/tags/text |
| Scraping Medium archive/profile HTML | Anti-bot hostile, violates the no-scraping rule; accept the feed window |
| Hardcoded default author/instance/feed | Violates the milestone's parameterization rule |
| Scheduled monitoring / streaming / webhooks | Repo excludes real-time; stdio MCP has no daemon lifecycle |
| Baked-in ML "topic score" ranking | Servers are dumb normalizers; keep `score` = raw source engagement |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| ABLOG-01 | Phase 6 | Complete |
| ABLOG-02 | Phase 6 | Complete |
| ABLOG-03 | Phase 6 | Complete |
| ABLOG-04 | Phase 6 | Complete |
| ABLOG-05 | Phase 6 | Complete |
| TREND-01 | Phase 5 | Complete |
| TREND-02 | Phase 5 | Complete |
| TREND-03 | Phase 5 | Complete |
| SRC-10 | Phase 7 | Complete |
| SRC-11 | Phase 7 | Pending |
| SRC-13 | Phase 7 | Pending |
| SEC-01 | Phase 5 | Complete |
| SEC-02 | Phase 7 | Complete |
| PKG-01 | Phase 8 | Pending |
| PKG-02 | Phase 8 | Pending |
| PKG-03 | Phase 8 | Pending |
| DOC-01 | Phase 8 | Pending |

**Coverage:**

- v1.1 requirements: 17 total
- Mapped to phases: 17 ✓ (Phase 5: 4 · Phase 6: 5 · Phase 7: 4 · Phase 8: 4)
- Unmapped: 0

---
*Requirements defined: 2026-07-08*
*Last updated: 2026-07-08 after v1.1 roadmap creation (traceability mapped)*
