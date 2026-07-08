# medium-research-mcp

## What This Is

A suite of nine small, single-purpose **MCP servers** (Node) that each wrap one
developer-community source's public API — Hacker News, Stack Exchange, Lobsters,
Lemmy, Dev.to, GitHub, Libraries.io, Product Hunt, and a generic SSRF-hardened
RSS/Atom fetcher (which also covers subreddit `.rss` and YouTube channel/playlist
feeds via documented recipes). Every server emits the **same normalized JSON
shape** so the `medium-blog-pro` skill can pull blog-topic research from many
sources in one pass with zero per-source logic — proven live by a branch-free
5+-source uniform-run merge. *(Shipped v1.0, 2026-07-03. The originally-planned
Python YouTube→blog OCR wrapper was dropped — the user runs their own local OCR
script manually on the YouTube links the RSS recipe surfaces.)*

## Core Value

**Uniform normalized output across every source.** If everything else fails,
the one thing that must hold is the output contract — `{ source, query, count,
results[] }` for lists and `{ source, item }` for details, with a fixed item
schema — because that is what lets the consuming skill rank, filter, and cite
across sources without a single source-specific branch.

## Current Milestone: v1.1 Writer-Aware, Universal Research

**Goal:** Upgrade the suite into a writer-aware idea engine that any MCP-capable
agent (Claude Desktop, OpenCode, Codex, GPT clients, …) can install and drive —
with all targets (blogs, forums, instances) chosen by the agent at call time,
never hardcoded.

**Target features:**
- Author-blog tools — local stdio server exposing Medium/Substack feed reading in
  the normalized contract; author username/feed URL is a tool parameter; enables
  topic dedup, follow-up detection, and cadence view for any author
- Trending & pain-point mining — Dev.to top-of-week/month, Stack Exchange
  high-view unanswered questions, HN rising — new tools/params on existing servers
- Discourse server (SRC-10) — instance URL as tool parameter, any public forum
- Mastodon server (SRC-11) — instance + hashtag as tool parameters, keyless
- Universal distribution (PKG-01+) — `.mcpb` custom-connector bundles for Claude
  Desktop and npm-published packages + config docs for all other MCP clients
- Parameterization rule (cross-cutting) — no hardcoded accounts/instances/feeds;
  targets are tool inputs, env only for credentials/optional defaults

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- ✓ Shared foundation: TTL cache, `getJson()`/`postJson()`/`getText()` HTTP client
      (retry + stale fallback), and the normalized output contract, proven by a
      Hacker News reference server — v1.0 Phase 1 (FOUND-01..05, OUT-01, OUT-03)
- ✓ Credential + auth infrastructure: env-only `credentials.js`, `auth.js`
      token exchange (optional Reddit grant, Lemmy login), `.mcpb` keychain
      pattern — v1.0 Phase 1 (CRED-01..04)
- ✓ Eight source servers under one contract — Stack Exchange (network via `site`),
      Lobsters, Lemmy (auth path), Dev.to, GitHub (repos + issues, optional PAT),
      Libraries.io + Product Hunt (required-credential pair) — v1.0 Phases 2–3
      (SRC-01..03, SRC-05..08)
- ✓ Generic SSRF-hardened RSS/Atom fetcher (`rss_fetch`) incl. subreddit `.rss`
      and YouTube channel/playlist recipes — v1.0 Phase 4 (SRC-09, YT-01)
- ✓ Branch-free 5+-source uniform-run merge (`shared/rank.js` `mergeRank`),
      proven offline + demoed live across 6 sources — v1.0 Phase 4 (OUT-02)

### Active

<!-- Current scope for the NEXT milestone. Empty until /gsd-new-milestone. -->

<!-- v1.1 scope — REQ-IDs assigned in REQUIREMENTS.md -->

- [ ] Author-blog tools: Medium/Substack feed reading in the normalized contract,
      author as tool parameter (dedup, follow-up, cadence)
- [ ] Trending & pain-point mining on existing servers (Dev.to top window,
      Stack Exchange high-view unanswered, HN rising)
- [ ] Discourse generic fetcher (SRC-10), instance as tool parameter
- [ ] Mastodon public/hashtag timelines (SRC-11), instance as tool parameter
- [ ] Universal distribution: `.mcpb` bundles + npm packages + client config docs
      (PKG-01+)
- [ ] Parameterization rule: no hardcoded accounts/instances/feeds anywhere

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- General-purpose Reddit/social **client** — read-only topic research only, no
  posting or account actions
- **Writing the posts** — these are research tools; drafting is the skill's job.
  (The YouTube angle is just link surfacing via RSS — OCR/draft generation is the
  user's own local Tesseract script, run manually and outside this repo.)
- **Scraping sources without a usable API** (Quora, Indie Hackers) — brittle and
  against the "mechanical to add" principle
- **Real-time / streaming** — cached research bursts are sufficient
- **Reddit OAuth app path** — still gated by karma; Lemmy is the true no-app
  replacement and subreddit `.rss` recovers read-only Reddit coverage

## Context

- **Origin:** replaces a single Reddit MCP that broke on two of Reddit's gates —
  app creation needs karma, and reading a subreddit required joining it. The
  multi-source design removes that single point of failure.
- **Consumer:** the `medium-blog-pro` skill calls these tools in its Phase 0
  research step and reads their JSON output.
- **Reference implementation:** patterned after reddit-mcp-buddy.
- **Additional-source scan (2026-07-01):** Discourse (generic `/latest.json`)
  and Mastodon (public/hashtag timelines) are verified keyless additions worth
  adding post-v1; subreddit `.rss` folds into the RSS fetcher. See
  `.planning/research/ADDITIONAL-SOURCES.md`.
- Full technical detail lives in `docs/PRD.md` and `docs/ARCHITECTURE.md`;
  per-source spec template in `docs/server-spec-template.md`.

## Current State

**Shipped v1.0 (2026-07-03).** 9 MCP servers under one normalized contract + the
live uniform-run proof. ~3,400 LOC source, ~3,700 LOC tests (**254 tests, 0 fail**),
12 plans across 4 phases in 3 days. Runtime deps: `@modelcontextprotocol/sdk`,
`zod`, `fast-xml-parser@4` (`+strnum`). Per-phase threat models; SSRF + supply-chain
hardened. One known accepted residual: DNS-rebinding TOCTOU on `getText` (T-04-06,
acceptable for a local single-user tool). One deferred live smoke: Phase 2 Lemmy
authenticated-read (needs `LEMMY_*` creds).

**Next milestone goals (candidates):** the v2 deferred sources (Discourse, Mastodon,
Bluesky), `.mcpb` one-click packaging (PKG-01), and the optional IP-pinning SSRF
follow-up. Start with `/gsd-new-milestone`.

## Constraints

- **Tech stack**: Node (`type: module`, `@modelcontextprotocol/sdk` + `zod` +
  `fast-xml-parser@4` for the RSS fetcher, stdio, native `fetch`) — Claude Desktop
  ships a Node runtime so a Node `.mcpb` needs no external runtime. *(No Python: the
  YouTube OCR wrapper was dropped 2026-07-03; the user's OCR script is external/manual.)*
- **Output contract**: every server conforms exactly to ARCHITECTURE §4; `score`
  and `num_comments` may be `null` but must never be renamed or dropped.
- **Security**: credentials never hardcoded, never read from `process.env`
  outside `shared/credentials.js`; `.mcpb` secrets marked `sensitive` (keychain).
- **Dependencies**: free/keyless API tiers preferred; where a key is required
  (Libraries.io, Product Hunt) fail with a clear "set X" error; where keyless
  tiers exist (Stack Exchange, GitHub, Reddit reads) degrade gracefully.
- **Compliance**: personal/non-commercial use (Product Hunt API is non-commercial
  by default); respect each source's rate limits.
- **Resilience**: ~15-min in-memory TTL cache, retry with backoff, stale-cache
  fallback — a tool call never hard-errors on a transient blip.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| One server per source, shared cache/http/credentials/auth modules | Adding a source stays mechanical; uniformity enforced by the contract, not the language | ✓ Good — 9 servers, each ~pure field-mapping |
| Normalized output contract is the linchpin | Lets `medium-blog-pro` consume any source with no per-source code | ✓ Good — proven live by the branch-free `mergeRank` across 6 sources (OUT-02) |
| Multi-source instead of single Reddit MCP | Removes the karma/join single point of failure | ✓ Good — Reddit coverage recovered via the subreddit `.rss` recipe, no OAuth |
| Coarse phase granularity, parallel execution | Solo operator with a clear design; sources are largely independent | ✓ Good — 4 phases, 12 plans, 3 days |
| Drop a source when it goes paid, not degrade the contract | Hashnode (SRC-04) retired free GraphQL; keyless/non-commercial premise is non-negotiable | ✓ Good — dropped cleanly, contract intact |
| Drop the Python YouTube OCR wrapper; surface YouTube links via the RSS recipe | User owns the OCR script and runs it manually; avoids a second runtime + supply-chain surface | ✓ Good — YT-01 met with zero new code |
| Add one vetted runtime dep (`fast-xml-parser@4`) behind a human supply-chain gate | Robust RSS 2.0/Atom parsing beats a fragile hand-roll; v4 keeps the tree to `+strnum` only | ✓ Good — `--ignore-scripts`, tree verified |
| SSRF chokepoint on the shared `getText`, not per-server | RSS is the first user-controlled outbound host; centralizing the guard protects every future text source | ✓ Good — code review caught + fixed a real IPv6 `::` bypass |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-07-08 after starting milestone v1.1 Writer-Aware, Universal Research*
