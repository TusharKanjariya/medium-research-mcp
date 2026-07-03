# Milestones

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
