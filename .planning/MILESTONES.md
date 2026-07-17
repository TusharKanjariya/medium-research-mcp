# Milestones

## v1.1 Writer-Aware, Universal Research (Shipped: 2026-07-17)

**Phases completed:** 4 phases (5–8), 15 plans, 18 tasks
**Timeline:** 2026-07-08 → 2026-07-17 · **Tests:** 432 passing, 0 fail · **Source:** ~4.9k LOC (servers + shared)
**Closeout:** verified (all 4 phases verified; open-artifact audit clean; Phase 8 SECURITY.md threats_open: 0)

**Delivered:** Upgraded the suite from 9 to 11 normalized-contract MCP servers, made it writer-aware, parameterized every target, and shipped it as both an npm package and 11 one-click `.mcpb` bundles — installable and driveable by any MCP client.

**Key accomplishments:**

- **Guarded JSON path + trending signals (Phase 5, SEC-01/TREND-01..03):** extended the SSRF chokepoint to opt-in `getJson({ untrustedHost })`, then added `hn_rising` (points/hour velocity), `so_unanswered` (high-view unanswered, backoff-aware), and `devto_top` (top/rising window + tag) — output contract kept frozen.
- **Author-blog awareness in `servers/rss` (Phase 6, ABLOG-01..05):** `rss_author_posts` / `rss_tag_posts` read a chosen Medium/Substack/raw feed (platform inferred from the author string, ambiguous tokens rejected without guessing a host), `preview-only` tag flags paywalled bodies, and `rss_substack_archive` enriches score/comments off the guarded path with graceful RSS fallback.
- **Universal sources + parameterization audit (Phase 7, SRC-10/11/13, SEC-02):** keyless Discourse and Mastodon servers (incl. Mastodon trends) with instance-as-tool-parameter, Lemmy parameterized, and a committed `parameterization-audit.test.js` proving no hardcoded accounts/instances/feeds anywhere.
- **Dual distribution (Phase 8, PKG-01..03, DOC-01):** one unscoped npx-runnable npm package (11 `medium-research-<source>` bins, realpath-hardened `isEntry()` guard) + 11 keychain-credentialed `.mcpb` bundles, each gated by `mcpb validate` and a real MCP-initialize spawn test before pack; `@anthropic-ai/mcpb` stays devDependency-only.
- **Setup docs + live proof:** per-client `INSTALL.md` (Claude Desktop, OpenCode, Codex, Cursor) with a manual release checklist, a runnable cross-source pain-point sweep, live Claude Desktop UAT of the keychain→env credential path, and a full 11-server live smoke (which caught and fixed a latent Discourse object-tags contract bug).

---

## v1.0 MVP (Shipped: 2026-07-03)

**Phases completed:** 4 phases, 12 plans, 23 tasks
**Timeline:** 3 days (2026-07-01 → 2026-07-03) · **Tests:** 254 passing, 0 fail
**Closeout:** override (1 acknowledged deferral — Phase 2 Lemmy live-auth smoke; see STATE.md Deferred Items)

**Delivered:** Nine single-purpose MCP servers under one normalized output contract, with the contract's value proven live by a branch-free multi-source merge.

**Key accomplishments:**

- **Shared Node ESM foundation** — a TTL stale-retaining cache, a resilient `getJson()`/`postJson()`/`getText()` HTTP client (retry/backoff, strict no-4xx-retry, stale fallback), and a Zod output-contract module (raw shapes + factories + a single `toolResult` seam), all proven by the Hacker News reference server.
- **Env-only credential + auth infrastructure** — `credentials.js` as the single `process.env` reader, `auth.js` token exchange (optional Reddit grant, Lemmy login), and the `.mcpb` keychain pattern; required-key sources fail with a clear "set X" error, optional-key sources degrade to anonymous.
- **Eight source servers, each ~pure field-mapping** — Hacker News, Stack Exchange (network-wide via `site`), Lobsters, Lemmy (auth path), Dev.to, GitHub (trending repos + issue pain-point mining), Libraries.io + Product Hunt (required-credential pair; Product Hunt over GraphQL). Hashnode was built then dropped when upstream retired free GraphQL.
- **SSRF-hardened `getText()` chokepoint** — scheme allowlist, `node:net` BlockList private/loopback/link-local/CGNAT/ULA denylist, per-hop redirect re-validation, optional `RSS_ALLOWED_HOSTS` lock-down — the security chokepoint every future arbitrary-URL text source inherits. A Critical IPv6 `::` bypass was caught in code review and fixed.
- **First runtime dependency, gated** — `fast-xml-parser@^4.5.7` (legacy major, NOT ^5; `strnum@1.x` sole transitive) introduced behind a blocking-human supply-chain checkpoint with the resolved tree verified before commit.
- **Generic RSS/Atom fetcher (`rss_fetch`)** — a single tool ingesting any RSS 2.0 / RDF / Atom 1.0 feed into the contract (`type:"article"`, score/num_comments null) via the SSRF-guarded `getText`; documented subreddit `.rss` and YouTube channel/playlist recipes proven by real fixtures, completing SRC-09 and YT-01. (The planned Python YouTube OCR wrapper was dropped — the user runs their own OCR script manually.)
- **The output-contract thesis, proven** — `mergeRank` (`shared/rank.js`) merges HN, Stack Exchange, Lobsters, Dev.to, GitHub, and RSS through one branch-free `flatMap` + nulls-last score-desc comparator; proven offline against real fixtures and demoed live merging 60 items across 6 sources (OUT-02).

---
