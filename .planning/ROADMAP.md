# Roadmap: medium-research-mcp

## Milestones

- ✅ **v1.0 MVP** — Phases 1–4 (shipped 2026-07-03) — full detail: [`milestones/v1.0-ROADMAP.md`](milestones/v1.0-ROADMAP.md)
- 🚧 **v1.1 Writer-Aware, Universal Research** — Phases 5–8 (in progress)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1–4) — SHIPPED 2026-07-03</summary>

Nine MCP servers under one normalized output contract + a live multi-source uniform-run proof. See [`milestones/v1.0-ROADMAP.md`](milestones/v1.0-ROADMAP.md) for full phase details, success criteria, and plan breakdown.

- [x] **Phase 1: Foundation & Credential Infrastructure** (3/3 plans) — completed 2026-07-01 — shared TTL cache + `getJson`/`postJson` client (retry/stale) + normalized output contract + HN reference server + env-only credentials/`auth.js`
- [x] **Phase 2: Keyless Source Breadth** (3/3 plans) — completed 2026-07-02 — Stack Exchange, Lobsters, Lemmy, Dev.to (Hashnode built then dropped — upstream paywalled)
- [x] **Phase 3: Keyed Ecosystem & Launch Sources** (2/2 plans) — completed 2026-07-02 — GitHub (optional PAT), Libraries.io + Product Hunt (required-credential pair)
- [x] **Phase 4: RSS Multiplier & Output Proof** (4/4 plans) — completed 2026-07-03 — SSRF-hardened RSS/Atom fetcher (subreddit `.rss` + YouTube recipes) + branch-free 5+-source uniform-run proof (Python YouTube OCR wrapper dropped — user runs own script)

</details>

### v1.1 Writer-Aware, Universal Research (Phases 5–8)

- [x] **Phase 5: Guarded JSON Path & Trending Signals** - Extend the SSRF guard to a guarded JSON path (the milestone's single gating dependency) and add HN rising, Stack Exchange high-view-unanswered, and Dev.to top-window trending tools (completed 2026-07-10)
- [x] **Phase 6: Author-Blog Awareness** - Medium/Substack/raw-feed author tools in the normalized contract with honest coverage windows, Substack archive enrichment, tag feeds, and documented dedup/cadence recipes (completed 2026-07-14)
- [x] **Phase 7: Universal Sources & Parameterization Audit** - Discourse and Mastodon servers with instance-as-tool-parameter (incl. Mastodon trends), Lemmy parameterized, and the no-hardcoded-targets audit across the suite (completed 2026-07-14)
- [ ] **Phase 8: Universal Distribution** - `.mcpb` one-click bundles, npm/`npx` packages, per-client setup docs (Claude Desktop, OpenCode, Codex, Cursor), and the cross-source pain-point sweep recipe

## Phase Details (v1.1)

### Phase 5: Guarded JSON Path & Trending Signals

**Goal**: Every user-supplied-host JSON request is SSRF-guarded, and agents can pull trending and pain-point signals from HN, Stack Exchange, and Dev.to
**Depends on**: Nothing (first phase of v1.1; v1.0 foundation shipped)
**Requirements**: SEC-01, TREND-01, TREND-02, TREND-03
**Success Criteria** (what must be TRUE):

  1. A JSON tool call whose user-supplied host resolves to a private/loopback/metadata address (e.g. `127.0.0.1`, `169.254.169.254`) is rejected with a clear error — the shared guard now covers JSON requests, not just `getText`, and Lemmy's instance-parameterized calls ride the same guarded path
  2. User can get Dev.to's top articles for the last N days and rising articles, combinable with a tag parameter, in the normalized contract
  3. User can mine high-view unanswered Stack Exchange questions per tag, ranked by `view_count`, and repeated calls honor the API `backoff` field instead of triggering throttling
  4. User can get rising Hacker News stories with tunable hours / min-points parameters, in the normalized contract

**Plans**: 4/4 plans complete

- [x] 05-01-PLAN.md — SEC-01 guarded getJson `untrustedHost` path (content-type gate + creds-in-URL reject) + move Lemmy onto the guarded path
- [x] 05-02-PLAN.md — TREND-03 `hn_rising` (search_by_date + numericFilters, points/hour velocity re-sort)
- [x] 05-03-PLAN.md — TREND-02 SE `so_unanswered` (high-view no-answers mining, view_count re-rank, backoff/quota handling)
- [x] 05-04-PLAN.md — TREND-01 `devto_top` extended with `mode`/`days`/`tag` (top + rising, forbidden-combo guard)

### Phase 6: Author-Blog Awareness

**Goal**: Any agent can read a chosen author's Medium/Substack/raw-feed posts in the normalized contract — author always a tool parameter — with honest coverage windows and documented dedup/cadence recipes
**Depends on**: None hard — parallelizable with Phase 5 (`getText` is already guarded); coordinate the shared `http_client.js` User-Agent change both phases touch (Medium 403 mitigation)
**Requirements**: ABLOG-01, ABLOG-02, ABLOG-03, ABLOG-04, ABLOG-05
**Success Criteria** (what must be TRUE):

  1. User can fetch an author's recent posts by platform + author parameter (Medium `@user`, Substack publication, or raw feed URL) and get normalized items with HTML-stripped full text and tags
  2. The coverage window is honest and visible: `count` + per-item `created_utc` in output, and tool descriptions explicitly state the feed caps (~10 posts Medium, ~20 Substack) and paywall truncation, so the agent knows what it cannot see
  3. User can list a Substack publication's full archive with reactions/comments filling `score`/`num_comments`; when the unofficial JSON API fails, the tool degrades to the RSS window without hard-erroring
  4. User can fetch posts by tag/keyword on platforms with tag feeds (e.g. Medium `feed/tag/<tag>`), tag as a tool parameter
  5. User can follow documented recipes for posting-cadence tracking and series/follow-up detection using only normal tool output

**Plans**: 2/3 plans executed
**Wave 1**

- [x] 06-01-PLAN.md — Wave 1 — shared Medium-403 → clear tool-level error mapping + UA 1.0→1.1 bump (D-14)
- [x] 06-02-PLAN.md — Wave 1 — rss_author_posts + rss_tag_posts: author-shape platform inference, query/published_before selection, preview-only markers, honest-window descriptions (ABLOG-01/02/04)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 06-03-PLAN.md — Wave 2 — rss_substack_archive (guarded JSON archive enrichment + graceful RSS fallback) + docs/AUTHOR-BLOG-RECIPES.md (ABLOG-03/05)

### Phase 7: Universal Sources & Parameterization Audit

**Goal**: Agents can research any public Discourse forum or Mastodon instance chosen at call time, and no account/instance/feed is hardcoded anywhere in the suite
**Depends on**: Phase 5 (SEC-01 guarded JSON path gates both new servers and the Lemmy parameterization move)
**Requirements**: SRC-10, SRC-11, SRC-13, SEC-02
**Success Criteria** (what must be TRUE):

  1. User can point the Discourse server at any public instance URL (tool parameter) and get latest topics, top-by-period, and topic detail in the normalized contract
  2. User can pull public and hashtag timelines from any Mastodon instance keylessly, instance + hashtag as tool parameters, in the normalized contract
  3. User can get trending tags/links from a Mastodon instance, and instances with trends disabled return empty results gracefully — never an error
  4. A login-required Discourse or locked-down (`AUTHORIZED_FETCH`) Mastodon instance yields a clear tool-level error, not a crash or a contract violation
  5. The parameterization audit passes: no hardcoded accounts/instances/feeds anywhere in the suite; Lemmy's instance is a tool parameter with env as optional default only

**Plans**: 4/4 plans complete

**Wave 1**

- [x] 07-01-PLAN.md — Wave 1 — contract TYPE append (`topic`/`status`) + Lemmy instance parameterization with host-gated Bearer (SEC-02, D-05/D-09/D-13/D-15)

**Wave 2** *(blocked on Wave 1)*

- [x] 07-02-PLAN.md — Wave 2 — Discourse server: discourse_latest/top/topic over the guarded path, category `slug/id` route, D-11 login-failure UX (SRC-10)
- [x] 07-03-PLAN.md — Wave 2 — Mastodon server: public/hashtag timelines + trending tags/links, limit clamp 40, trends-disabled→empty, 401/422 lockdown UX (SRC-11, SRC-13)

**Wave 3** *(blocked on Waves 1–2)*

- [x] 07-04-PLAN.md — Wave 3 — SEC-02 parameterization audit test: allowlist scan of servers/*/server.js + rss resolve* helpers, negative control (SEC-02, D-16)

### Phase 8: Universal Distribution

**Goal**: Any MCP-capable client on any OS can install and run every server — one-click `.mcpb` in Claude Desktop or `npx` from npm elsewhere — with working per-client docs and the cross-source research recipe
**Depends on**: Phases 5, 6, 7 (packaging ships the final v1.1 tool surface once; strictly last)
**Requirements**: PKG-01, PKG-02, PKG-03, DOC-01
**Success Criteria** (what must be TRUE):

  1. User can install any server as a one-click `.mcpb` custom connector in Claude Desktop and call its tools — the staged build bundles `shared/` + production deps so `../../shared` imports survive, and credentials are marked `sensitive` in `user_config`
  2. User can run any server from the published npm package via `npx` on a non-Claude MCP client — one scoped package, a bin entry per server, working on Windows (shebang-safe)
  3. User can follow per-client setup docs (Claude Desktop, OpenCode, Codex, Cursor) — including the Windows `cmd /c npx` spawn and explicit env-block quirks — and reach a working connection
  4. User can follow the cross-source pain-point sweep recipe (one tag through Stack Exchange + Discourse + Mastodon + Dev.to, merged via `mergeRank`) end to end

**Plans**: 4 plans

**Wave 1**

- [ ] 08-01-PLAN.md — npm package identity + bin-ability: package.json (11 medium-research-* bins, files whitelist, v1.1.0, private removed, @anthropic-ai/mcpb devDep) + shared/main.js isEntry() + shebang/guard-swap across 11 servers (PKG-02)
- [ ] 08-02-PLAN.md — manifest retarget/cleanup (Option A entry_point/args, v1.1.0, hn credential cleanup) + D-05 manifest⇄credentials consistency test (PKG-01)

**Wave 2** *(blocked on Wave 1)*

- [ ] 08-03-PLAN.md — scripts/build-mcpb.mjs (stage → mcpb validate → spawn-test → pack, 11 bundles) + .mcpbignore + dist/ gitignore + manual D-04 keychain smoke (PKG-01)
- [ ] 08-04-PLAN.md — docs/INSTALL.md (per-client per-OS setup + manual release checklist) + examples/pain-point-sweep.mjs cross-source sweep + README link (PKG-03, DOC-01)

## Future / Deferred (v2+)

Not part of the v1.1 milestone. Tracked for a later milestone (start via `/gsd-new-milestone`).

- **SRC-12 — Bluesky (AT Protocol)**: public feed reads; revisit if fediverse coverage
  proves valuable.

- **SEC-03 — SSRF hardening follow-up**: optional undici IP-pinning custom-lookup
  dispatcher to close the accepted DNS-rebinding TOCTOU residual (T-04-06) if the tool
  ever runs multi-tenant. Reconsider during SEC-01's threat-model pass.

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation & Credential Infrastructure | v1.0 | 3/3 | Complete | 2026-07-01 |
| 2. Keyless Source Breadth | v1.0 | 3/3 | Complete | 2026-07-02 |
| 3. Keyed Ecosystem & Launch Sources | v1.0 | 2/2 | Complete | 2026-07-02 |
| 4. RSS Multiplier & Output Proof | v1.0 | 4/4 | Complete | 2026-07-03 |
| 5. Guarded JSON Path & Trending Signals | v1.1 | 4/4 | Complete    | 2026-07-10 |
| 6. Author-Blog Awareness | v1.1 | 3/3 | Complete    | 2026-07-14 |
| 7. Universal Sources & Parameterization Audit | v1.1 | 4/4 | Complete    | 2026-07-14 |
| 8. Universal Distribution | v1.1 | 0/4 | Not started | - |

---
*Roadmap updated: 2026-07-08 — v1.1 phases added (coverage 17/17 v1.1 requirements)*
