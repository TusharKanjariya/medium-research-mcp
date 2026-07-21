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

## Current Milestone: v1.2 One-Shot Install

**Goal:** Anyone can get all 11 servers into any MCP client with one command —
no manual per-server adds, no local-path hacks.

**Target features:**
- npm publish (PKG-04) — `medium-research-mcp` published publicly so the
  documented `npx -y medium-research-<source>` config works on any machine;
  INSTALL.md's manual release checklist is the base
- GitHub install path (PKG-05) — same package runnable via
  `npx github:<owner>/medium-research-mcp`; both routes documented
- One-shot installer (INST-01) — `npx medium-research-mcp install` detects the
  client (Claude Desktop, OpenCode, Codex, Cursor), backs up its config, merges
  all 11 entries non-destructively, prompts for the 2 required keys
- Aggregator server (AGG-01) — new `medium-research-all` bin exposing all 11
  sources' tools from one process, so a client needs exactly one config entry;
  the 11 single-purpose servers remain the primary shape
- Docs (DOC-02) — INSTALL.md rewritten around the new install paths; retire the
  temp local-path config file

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
- ✓ Guarded JSON path — opt-in `getJson(url, { untrustedHost: true })` reuses the
      `getText` SSRF guard (no forked guard); Lemmy's instance calls ride it; the
      single gating dependency for v1.1's tool-param-host servers — v1.1 Phase 5 (SEC-01)
- ✓ Trending & pain-point mining — `hn_rising` (points/hour velocity), Stack Exchange
      `so_unanswered` (high-view no-answers, view_count rank, backoff sleep-within),
      Dev.to `devto_top` extended with `mode`/`days`/`tag`; output contract kept frozen
      — v1.1 Phase 5 (TREND-01..03)
- ✓ Author-blog awareness — Medium/Substack feed reading in the normalized contract
      inside `servers/rss` (author as tool param; dedup, follow-up, cadence; Substack
      archive score/comment enrichment; preview-only paywall tag) — v1.1 Phase 6 (ABLOG-01..05)
- ✓ Discourse generic fetcher (SRC-10) + Mastodon public/hashtag timelines (SRC-11) —
      instance as tool parameter, keyless over the guarded untrustedHost path — v1.1 Phase 7 (SRC-10, SRC-11, SRC-13)
- ✓ Parameterization audit — no hardcoded accounts/instances/feeds; committed
      `parameterization-audit.test.js` scans every server (SEC-02) — v1.1 Phase 7
- ✓ Universal distribution — one npx-runnable npm package (11 `medium-research-<source>`
      bins) + 11 `.mcpb` keychain-credentialed bundles + per-client INSTALL docs +
      live cross-source pain-point sweep — v1.1 Phase 8 (PKG-01..03, DOC-01)

### Active

<!-- Current scope for the NEXT milestone. Empty until /gsd-new-milestone. -->

- [ ] **PKG-04**: User can configure any server on any machine with `npx -y medium-research-<source>` (package published to npm)
- [ ] **PKG-05**: User can install without npm registry via `npx github:<owner>/medium-research-mcp` (documented GitHub path)
- [ ] **INST-01**: User can add all 11 servers to their MCP client in one command (`npx medium-research-mcp install` — detect, backup, merge, prompt for required keys)
- [ ] **AGG-01**: User can add ONE config entry (`medium-research-all`) and get every source's tools
- [ ] **DOC-02**: User can follow INSTALL.md for npm, GitHub, installer, and aggregator paths (temp local-path file retired)

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
| Dual distribution: one npx-runnable npm package AND per-source `.mcpb` bundles | npm covers any MCP client; `.mcpb` gives Claude Desktop keychain-backed one-click install; `@anthropic-ai/mcpb` stays devDependency-only | ✓ Good — v1.1 Phase 8; live Desktop UAT confirmed keychain→env injection + fail-closed required-cred UX |
| `isEntry()` realpath entry guard shared across all 11 bins | One guard works under both copy (npx/registry/Windows) and symlinked (pnpm/npm link) installs | ✓ Good — bins run with no build step; 73 server tests unchanged |

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
*Last updated: 2026-07-20 — started milestone v1.2 One-Shot Install (PKG-04/05, INST-01, AGG-01, DOC-02).*
