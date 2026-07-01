# medium-research-mcp

## What This Is

A suite of small, single-purpose **MCP servers** (Node) that each wrap one
developer-community source's public API — Hacker News, Stack Exchange, Lobsters,
Lemmy, Hashnode, Dev.to, GitHub, Libraries.io, Product Hunt, and a generic
RSS/Atom fetcher — plus a separate Python YouTube→blog wrapper. Every server
emits the **same normalized JSON shape** so the `medium-blog-pro` skill can pull
blog-topic research from many sources in one pass with zero per-source logic.

## Core Value

**Uniform normalized output across every source.** If everything else fails,
the one thing that must hold is the output contract — `{ source, query, count,
results[] }` for lists and `{ source, item }` for details, with a fixed item
schema — because that is what lets the consuming skill rank, filter, and cite
across sources without a single source-specific branch.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- ✓ Shared foundation: TTL cache, `getJson()` HTTP client (retry + stale
      fallback), and the normalized output contract, proven by a Hacker News
      reference server — Phase 1 (FOUND-01..05, OUT-01, OUT-03; 64 tests)
- ✓ Credential + auth infrastructure: env-only `credentials.js`, `auth.js`
      token exchange (optional Reddit grant, Lemmy login), `.mcpb` keychain
      pattern — Phase 1 (CRED-01..04)

### Active

<!-- Current scope. Building toward these. -->

- [ ] Source servers, each conforming exactly to the contract: Stack Exchange
      (network via `site`), Lobsters, Lemmy, Hashnode, Dev.to, GitHub
      (repos + issues/discussions), Libraries.io, Product Hunt
- [ ] Generic RSS/Atom fetcher (the multiplier — newsletters, dev blogs, and
      read-only subreddit `.rss`)
- [ ] A single research run pulls from 5+ sources with uniform output
- [ ] YouTube→blog wrapper (Python, async job pattern) — separate, local-only

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- General-purpose Reddit/social **client** — read-only topic research only, no
  posting or account actions
- **Writing the posts** — these are research tools; drafting is the skill's job
  (the YouTube wrapper is the one exception, producing draft material)
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

## Constraints

- **Tech stack**: Research servers are Node (`type: module`, `@modelcontextprotocol/sdk`
  + `zod`, stdio, native `fetch`) — Claude Desktop ships a Node runtime so a Node
  `.mcpb` needs no external runtime. YouTube wrapper is Python (wraps an existing
  Tesseract OCR script; local-only).
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
| Node for research servers, Python only for YouTube wrapper | Claude Desktop bundles Node → zero-runtime `.mcpb`; YouTube wraps existing Python OCR | — Pending |
| One server per source, shared cache/http/credentials/auth modules | Adding a source stays mechanical; uniformity enforced by the contract, not the language | — Pending |
| Normalized output contract is the linchpin | Lets `medium-blog-pro` consume any source with no per-source code | — Pending |
| Multi-source instead of single Reddit MCP | Removes the karma/join single point of failure | — Pending |
| Coarse phase granularity, parallel execution | Solo operator with a clear design; sources are largely independent | — Pending |

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
*Last updated: 2026-07-01 after Phase 1 (Foundation & Credential Infrastructure) completion*
