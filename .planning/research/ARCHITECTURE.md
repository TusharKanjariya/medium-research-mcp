# Architecture Research — v1.1 Integration

**Domain:** Multi-source MCP research suite (existing, shipped v1.0) — integration architecture for v1.1 features
**Researched:** 2026-07-08
**Confidence:** MEDIUM (all external claims web-verified against official docs; codebase claims HIGH — read directly from source)

**Scope note:** This is SUBSEQUENT-MILESTONE research. The v1.0 hub-and-spoke
architecture (`servers/<source>/server.js` spokes over `shared/` hub) is settled
and is NOT redesigned here. See `.planning/codebase/ARCHITECTURE.md` for the
as-built system. This file answers only: *how do the v1.1 features plug in?*

## Standard Architecture

### System Overview (v1.1 delta)

```
┌────────────────────────────────────────────────────────────────────────────┐
│        Any MCP client (Claude Desktop, Cursor, Codex CLI, OpenCode)        │
│   installed via: .mcpb bundle (Claude Desktop) OR npm bin (everyone else)  │
├──────────┬──────────┬───────────┬───────────────┬───────────┬─────────────┤
│ hn       │ stackex. │ devto     │ rss (extended)│ discourse │ mastodon    │
│ +hn_     │ +so_     │ devto_top │ +rss_author_  │ NEW SRC-10│ NEW SRC-11  │
│ rising   │ unanswrd │ +days win │  posts        │ instance =│ instance =  │
│ (new     │ (new     │ (modified │ (new tools on │ tool param│ tool param  │
│  tool)   │  tool)   │  tool)    │  existing srv)│           │             │
└────┬─────┴────┬─────┴────┬──────┴──────┬────────┴─────┬─────┴──────┬──────┘
     │          │          │             │              │            │
     ▼          ▼          ▼             ▼              ▼            ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                         shared/ (hub — ONE change)                          │
│  http_client.js: SSRF guard extended from getText to a guarded JSON path   │
│                  (Discourse/Mastodon/Lemmy hosts become tool params)       │
│  contract.js / cache.js / credentials.js / auth.js / rank.js: UNCHANGED    │
│  writer.js (NEW, optional): cadence/dedup helpers — rank.js precedent,     │
│                  consumer-side reference impl, NOT in tool output           │
└────────────────────────────────────┬───────────────────────────────────────┘
                                     ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  NEW upstreams: medium.com/feed/@user, <pub>.substack.com/feed,             │
│  any-discourse-instance/latest.json, any-mastodon-instance/api/v1/...      │
├────────────────────────────────────────────────────────────────────────────┤
│  NEW build/distribution layer (repo-level, not runtime):                    │
│  scripts/build-mcpb.mjs → dist/<source>.mcpb   (per-server bundles)        │
│  package.json bin map → npm publish            (one package, many bins)    │
│  docs/INSTALL.md → per-client config snippets                              │
└────────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities (new vs modified — explicit)

| Component | Status | Responsibility |
|-----------|--------|----------------|
| `shared/http_client.js` | **MODIFIED** | Extend the SSRF guard (`assertSafeUrl` + manual-redirect re-validation, today only in `getText`) to a guarded JSON path — either `getJson(url, { untrustedHost: true })` or a `getJsonSafe()` built on the same guarded fetch loop. Prerequisite for every tool-param-host server. |
| `servers/rss/server.js` | **MODIFIED** | Gains author-blog tools (`rss_author_posts`, optionally `rss_author_check`); keeps `rss_fetch`. Feed-URL construction for Medium/Substack handles live here. No shared change needed — `getText` is already guarded. |
| `servers/hn/server.js` | **MODIFIED** | New `hn_rising` tool (Algolia `search_by_date` + `numericFilters=created_at_i>…,points>…`, or `tags=front_page`). Pure additive `registerTool` block. |
| `servers/stackexchange/server.js` | **MODIFIED** | New `so_unanswered` tool (`/2.3/questions/no-answers` or `/unanswered`, `site=` param, custom `filter=` including `view_count`; rank by views server-side before envelope). |
| `servers/devto/server.js` | **MODIFIED** | `devto_top` gains a `days` window param (Forem `top=N` = most popular in last N days → top-of-week/month). |
| `servers/lemmy/server.js` | **MODIFIED** (parameterization sweep) | `LEMMY_INSTANCE` demoted from required env to optional default; instance becomes a tool param → must route through the guarded JSON path. |
| `servers/discourse/` | **NEW** | SRC-10. Straight copy of the hn template EXCEPT base URL comes from a tool param → guarded JSON path. `/latest.json`, `/top.json?period=`, `/search.json?q=`, `/t/<id>.json`. |
| `servers/mastodon/` | **NEW** | SRC-11. Same pattern: instance is a tool param → guarded JSON path. `/api/v1/timelines/tag/:hashtag`, `/api/v1/timelines/public`. Keyless. |
| `shared/writer.js` | **NEW (optional)** | Pure cadence/dedup/follow-up helpers over contract items (`created_utc`, `title`, `tags`) — the `rank.js` precedent: reference implementation for the consuming skill, never part of tool output. |
| `scripts/build-mcpb.mjs` | **NEW** | Stages each server + `shared/` + prod `node_modules` and runs `mcpb pack` per server → `dist/*.mcpb` (already gitignored). |
| Root `package.json` | **MODIFIED** | Drop `private: true`; add `bin` map (one bin per server); `files` whitelist (`servers/`, `shared/`); `build:mcpb` script. Shebang added to each `server.js`. |
| `servers/*/manifest.json` (x11) | **MODIFIED/NEW** | Promoted from scaffold to real: per-server `user_config` only (stop documenting other servers' creds in the hn manifest), correct `entry_point`. |
| `docs/INSTALL.md` | **NEW** | Per-client config snippets (Claude Desktop, Cursor `~/.cursor/mcp.json`, Codex `~/.codex/config.toml`, OpenCode `opencode.json`). |
| `shared/contract.js`, `cache.js`, `credentials.js`, `auth.js`, `rank.js` | **UNCHANGED** | Contract fields are frozen; new signals express themselves through tool *selection/ordering*, never new item fields (see Anti-Patterns). |

## Recommended Project Structure (delta only)

```
medium-research-mcp/
├── servers/
│   ├── rss/server.js          # MODIFIED: + author-blog tools (rss_author_*)
│   ├── hn/server.js           # MODIFIED: + hn_rising
│   ├── stackexchange/server.js# MODIFIED: + so_unanswered
│   ├── devto/server.js        # MODIFIED: devto_top days window
│   ├── lemmy/server.js        # MODIFIED: instance → tool param (env = default)
│   ├── discourse/             # NEW: server.js + manifest.json (hn-template copy)
│   └── mastodon/              # NEW: server.js + manifest.json (hn-template copy)
├── shared/
│   ├── http_client.js         # MODIFIED: guarded JSON path (SSRF on getJson)
│   └── writer.js              # NEW (optional): cadence/dedup consumer helpers
├── scripts/
│   └── build-mcpb.mjs         # NEW: stage + `mcpb pack` per server → dist/
├── dist/                      # generated, gitignored (*.mcpb already ignored)
├── docs/INSTALL.md            # NEW: per-client install/config matrix
└── package.json               # MODIFIED: publishable, bin map, build script
```

### Structure Rationale

- **No new directories beyond `scripts/` and two server dirs** — v1.1 is additive; the v1.0 layout absorbs everything else.
- **`dist/` staging for .mcpb** keeps the repo layout inside each bundle identical to the repo (bundle root contains `servers/<x>/server.js` + `shared/` + `node_modules/`), so the `../../shared/*.js` relative imports resolve **unchanged** — zero code rewrites for packaging.

## Architectural Patterns (the four integration decisions)

### Decision 1: Author-blog tools → extend the existing rss server (not a new server)

**What:** Add `rss_author_posts({ platform: "medium"|"substack"|"feed", author_or_url, query?, published_before?, limit? })` to `servers/rss/server.js`. The server builds the feed URL (`medium.com/feed/@user`, `<pub>.substack.com/feed`, or raw URL passthrough), fetches via the already-SSRF-guarded `getText`, and reuses the module-local XML parser + `mapRssItem`/`mapAtomEntry` helpers as-is. Emit `source: "authorblog"` (or the platform name) in the envelope — `SOURCE` is just a string; a server may emit per-tool source values.

**Why not a new `servers/authorblog/`:** the parser and field maps live in `servers/rss/server.js`; a sibling server would either duplicate them or import server→server, breaking the strict `servers/* → shared/*` dependency direction. The clean alternative (extract parsing into `shared/feed.js`) is a refactor of shipped, tested code with no behavioral payoff — do it later only if a third feed-consuming server appears. This also means one fewer .mcpb bundle / npm bin to distribute.

**Where dedup / follow-up / cadence live (the contract question):**

| Computation | Lives where | Why |
|---|---|---|
| Feed-URL construction | rss server (tool param → URL) | Parameterization rule: author is a tool input |
| Topic pre-filter (dedup candidates) | rss server, via `query` param → returns a **list envelope of matching prior posts** | Contract-conformant: "already covered?" = `count > 0`; results are citable items |
| Follow-up detection | Same tool, `published_before`/`older_than_days` param | Still just selection over items |
| Semantic "is this the same topic?" | **The agent** | The LLM beats substring matching; server does cheap recall, agent does precision |
| Cadence | **The agent**, from `created_utc` already on every item (optional pure helper in `shared/writer.js`, rank.js-style) | A cadence summary is a scalar, not an item list — it cannot ride the envelope without breaking the contract |

**Trade-offs / known limits (verified):** Medium author feeds carry only the **latest ~10 posts** and member-only posts are **truncated to an abstract**; Substack truncates paid posts ("Read more" marker). Dedup/follow-up over Medium therefore only sees the last ~10 posts — document this on the tool description; do NOT try to scrape around it (out of scope: no scraping).

### Decision 2: Trending / pain-point mining → new tools on existing servers (no new server)

**What:** exactly the codebase's documented extension point ("new tool on an existing server: add a `registerTool` block").

- `hn_rising` — Algolia keyless: `search_by_date` + `numericFilters=created_at_i>{now-Nh},points>{threshold}` (rising = young stories crossing a velocity threshold); `tags=front_page` gives the literal front page as a cross-check.
- `so_unanswered` — `/2.3/questions/no-answers` (zero answers) or `/questions/unanswered` (no accepted/upvoted answer — pick one, document which), `sort=votes`, custom `filter=` including `view_count`; server sorts by `view_count` before building the envelope. Keyless works; `STACKEXCHANGE_KEY` raises quota (existing optional-cred path).
- `devto_top(days)` — Forem `GET /api/articles?top=N` = most popular in last N days; 7 and 30 give top-of-week/month.

**Trade-off:** none structurally — all GET via existing `getJson` against fixed module-constant hosts; zero shared changes.

### Decision 3: Discourse + Mastodon → straight pattern copies, gated on ONE shared change

**What:** both are mechanical hn-template copies (keyless JSON GET, pure field mapping) **except** the instance URL is a tool parameter. That breaks v1.0's invariant "untrusted input never selects a host EXCEPT `rss_fetch`, which is why the SSRF guard lives in `getText`". The guard must therefore extend to the JSON path **before** either server is built.

**How:** refactor `shared/http_client.js` so the guarded fetch loop (scheme allowlist → DNS-resolved private-range denylist → `redirect: "manual"` with per-hop re-validation, max 5) is shared between `getText` and a guarded JSON entry point (`getJson(url, { untrustedHost: true })` recommended — one function, explicit opt-in, existing callers untouched). Reuse/generalize the `RSS_ALLOWED_HOSTS` operator-allowlist mechanism.

**Per-source notes (verified against official docs):**
- Discourse: `/latest.json`, `/top.json?period=weekly|monthly`, `/search.json?q=`, `/t/<id>.json` are keyless on public instances; `login_required` instances return 403 → definitive 4xx, existing no-retry/no-stale policy already yields the right behavior; give a clear "instance requires login" message.
- Mastodon: `/api/v1/timelines/tag/:hashtag` and `/timelines/public` are keyless **unless the instance admin disables unauthenticated access** → 401, same clear-error treatment. ~300 req/5 min/IP ceiling — the 15-min TTL cache keeps usage far below it. `score = favourites_count + reblogs_count`, `num_comments = replies_count`.
- New item `type` values (e.g. `"topic"`, `"status"`): APPEND to the `TYPE` enum in `shared/contract.js` — append-only rule, no reorder.
- Same milestone, same mechanism: Lemmy's `LEMMY_INSTANCE` becomes a tool param with env as optional default (parameterization rule), which moves Lemmy onto the guarded path too.

### Decision 4: Universal distribution → per-server .mcpb bundles + ONE npm package with a bin per server

**.mcpb (Claude Desktop):** the MCPB format (spec: `modelcontextprotocol/mcpb`, adopted by the MCP project Nov 2025) is a zip of the whole server + `manifest.json`; the `@anthropic-ai/mcpb` CLI provides `mcpb init` / `mcpb pack`. There is no multi-server bundle — **one bundle per server** (11 bundles). Node bundles must **vendor `node_modules`** (`npm ci --omit=dev` at build time); the prod tree here is tiny (SDK + zod + fast-xml-parser), so duplicating it per bundle is fine.

- Build script `scripts/build-mcpb.mjs` (npm script `build:mcpb`): for each `servers/*/manifest.json`, stage `dist/stage/<source>/` mirroring the repo layout (`servers/<source>/server.js`, `shared/`, prod `node_modules/`, `manifest.json` at root with `entry_point: "servers/<source>/server.js"` and `mcp_config.args: ["${__dirname}/servers/<source>/server.js"]`), then `mcpb pack` → `dist/<source>.mcpb`. Relative imports survive untouched.
- Manifests need cleanup: today `servers/hn/manifest.json` documents *other* servers' credentials as a pattern demo — each real manifest should declare only its own `user_config`, with `"sensitive": true` fields (OS keychain) injected via `${user_config.*}` into `mcp_config.env`.

**npm (every other client):** **one package** (root `package.json`, e.g. `medium-research-mcp`) with a `bin` map — one bin per server (`medium-research-hn`, `medium-research-devto`, …), each `server.js` gaining a `#!/usr/bin/env node` shebang (harmless under plain `node` invocation).

- Why one package, not eleven: `shared/` ships once, one version number, one `npm publish`; per-server packages would force `shared/` into its own published dependency + npm workspaces — the `@modelcontextprotocol/server-*` one-package-per-server convention exists for *independent* servers, not eleven thin spokes over one hub, and is unjustified overhead for a solo maintainer.
- Accepted trade-off: `npx -y <pkg>` alone only runs the bin matching the package name, so multi-bin invocation is `npx -y -p medium-research-mcp medium-research-hn` (or a one-time `npm i -g`). `docs/INSTALL.md` documents the exact per-client incantation.
- Client-agnostic check: all four target clients reduce to `command + args + env` for stdio servers (Claude Desktop `claude_desktop_config.json` / Cursor `~/.cursor/mcp.json` `mcpServers{}`; Codex `~/.codex/config.toml` `[mcp_servers.<name>]`; OpenCode `opencode.json` `mcp{}`). The servers already satisfy this — pure stdio, no logging to stdout, env only for credentials/defaults. **The only code change distribution requires is the shebang lines.**

## Data Flow

### New flow: tool-parameter host (Discourse / Mastodon / parameterized Lemmy)

```
agent supplies instance URL as tool input        (UNTRUSTED HOST — new for JSON)
    ↓
handler builds https://<instance>/latest.json
    ↓
getJson(url, { untrustedHost: true })            (MODIFIED shared/http_client.js)
    ↓ assertSafeUrl: scheme allowlist → DNS private-range denylist
    ↓ fetch redirect:"manual", re-validate every hop (≤5)
    ↓ cache/retry/stale exactly as today
map*() field mapping → buildListEnvelope → toolResult   (unchanged)
```

### Author-blog flow (no shared change)

```
agent supplies platform + author (or raw feed URL)
    ↓ server builds medium.com/feed/@user | <pub>.substack.com/feed
getText(url)  ← SSRF guard already here (v1.0)
    ↓ existing XML parser + mapRssItem/mapAtomEntry
    ↓ optional server-side selection: query filter, published_before
list envelope of the author's prior posts → agent does semantic dedup,
follow-up judgment, and cadence math over created_utc
```

### Key Data Flows

1. **Pain-point signal is selection, not schema:** "high-view unanswered" reaches the agent as *which items the tool returned and in what order* — `view_count` ranks server-side and is never added to the item shape.
2. **Writer-awareness is agent-side synthesis:** the servers provide recall (an author's prior posts as contract items); the agent/skill provides precision (semantic dedup, cadence interpretation), optionally via `shared/writer.js` reference helpers — exactly how `rank.js`/OUT-02 already splits responsibilities.

## Anti-Patterns

### Anti-Pattern 1: Adding fields to the item schema for new signals

**What people do:** add `view_count`, `is_duplicate`, or `cadence_days` to items/envelopes for the new tools.
**Why it's wrong:** the contract is the load-bearing invariant; other sources can't populate the field, `outputSchema` diverges per server, and the consuming skill grows source-specific branches — the exact failure the suite exists to prevent.
**Do this instead:** express signals through endpoint choice, server-side ordering, and tool params; scalars (cadence) are computed by the consumer from `created_utc`.

### Anti-Pattern 2: Fetching a tool-supplied host through the unguarded getJson

**What people do:** copy the hn template for Discourse/Mastodon and pass `https://<tool-input>/latest.json` to today's `getJson`.
**Why it's wrong:** v1.0's SSRF guard lives only in `getText`; a tool-param host on the JSON path is a live SSRF hole (internal-network reads via a "forum instance" URL).
**Do this instead:** land the guarded JSON path in `shared/http_client.js` first; make it the documented rule: *any server whose host comes from tool input uses the guarded path* — the SSRF chokepoint stays in shared, per the v1.0 key decision.

### Anti-Pattern 3: Per-server npm packages / npm install at .mcpb install time

**What people do:** split into 11 published packages, or ship .mcpb bundles that run `npm install` on first launch.
**Why it's wrong:** 11 packages multiply publish/version drift across a shared hub; MCPB explicitly requires vendored `node_modules` (bundles must be self-contained — Claude Desktop will not install deps).
**Do this instead:** one npm package with a bin map; `build-mcpb.mjs` stages prod `node_modules` into every bundle.

## Integration Points

### External Services (new in v1.1)

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Medium feeds | `getText` on `medium.com/feed/@user` | Latest ~10 posts only; paywalled posts truncated to abstract — document as tool limitation |
| Substack feeds | `getText` on `<pub>.substack.com/feed` | Paid posts truncated ("Read more"); free posts full `content:encoded` |
| Discourse (any instance) | guarded `getJson` on `/latest.json`, `/top.json`, `/search.json`, `/t/<id>.json` | Keyless; `login_required` → 403 clear error; polite per-instance pacing |
| Mastodon (any instance) | guarded `getJson` on `/api/v1/timelines/tag/:h`, `/timelines/public` | Keyless unless instance disables unauth reads (401); ~300 req/5 min/IP |
| HN Algolia (existing) | `getJson`, `search_by_date` + `numericFilters` | Keyless; 1000-hit cap irrelevant at research volumes |
| Stack Exchange (existing) | `getJson`, `/questions/no-answers` + custom `filter` | Keyless degrades; key raises quota (existing optional-cred path) |
| Claude Desktop packaging | `mcpb pack` per server | Manifest `user_config` `"sensitive": true` → keychain; known gotcha: `${user_config.*}` env refs are rough on the Claude Code plugin path (documented in the v1.0 hn manifest) |
| Other MCP clients | npm bin + `command/args/env` config | Cursor `mcp.json`, Codex `config.toml`, OpenCode `opencode.json` — all stdio-standard |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| new servers ↔ `shared/` | direct import, `servers/* → shared/*` only | Unchanged rule; author tools live IN the rss server precisely to avoid a server→server import |
| trending tools ↔ contract | selection/ordering only | No schema change, no shared change |
| build scripts ↔ servers | read-only staging of `servers/`, `shared/`, `node_modules` | `scripts/` never imported at runtime; `dist/` gitignored |
| `shared/writer.js` ↔ skill | consumer-side pure functions over contract items | Mirrors `rank.js`; not referenced by any server |

## Suggested Build Order (dependencies explicit)

| # | Work | Depends on | Parallel with |
|---|------|-----------|---------------|
| 1 | **Guarded JSON path** in `shared/http_client.js` (+ tests: injectable `lookup`, redirect hops) | — | 2, 3 |
| 2 | **Trending tools** on hn / stackexchange / devto (3 independent additive plans) | — | 1, 3 |
| 3 | **Author-blog tools** on the rss server (+ `shared/writer.js` helpers if desired) | — (getText already guarded) | 1, 2 |
| 4 | **Discourse server** (SRC-10) | 1 | 5, 6 |
| 5 | **Mastodon server** (SRC-11) | 1 | 4, 6 |
| 6 | **Parameterization sweep** (Lemmy instance → tool param w/ env default; audit no other hardcoded targets) | 1 | 4, 5 |
| 7 | **Distribution** (PKG-01+): publishable package.json + shebangs + bin map, `build-mcpb.mjs`, manifest cleanup (all 11), `docs/INSTALL.md` | 2–6 (tool surface + server list must be final) | — |

Natural phase shape: **(A)** items 1–3 (shared change + additive tools, mostly parallel) → **(B)** items 4–6 (the two new servers + sweep, parallel once 1 lands) → **(C)** item 7 (distribution, strictly last). Distribution needs no per-phase research; the guarded-JSON refactor deserves a threat-model pass (it touches the v1.0 SSRF chokepoint, including the accepted DNS-rebinding TOCTOU residual T-04-06 — decide whether the optional IP-pinning follow-up rides along).

## Sources

- Codebase (HIGH): `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/STRUCTURE.md`, `servers/rss/server.js`, `servers/hn/manifest.json`, `.planning/research/ADDITIONAL-SOURCES.md` (2026-07-01 keyless-API verification)
- MCPB format + CLI (MEDIUM, official repo + MCP blog): [modelcontextprotocol/mcpb README](https://github.com/modelcontextprotocol/mcpb/blob/main/README.md), [@anthropic-ai/mcpb on npm](https://www.npmjs.com/package/@anthropic-ai/mcpb), [MCP blog: Adopting the MCP Bundle format](https://blog.modelcontextprotocol.io/posts/2025-11-20-adopting-mcpb/)
- npm distribution conventions (MEDIUM): [MCP docs: Connect to local MCP servers](https://modelcontextprotocol.io/docs/develop/connect-local-servers), [Speakeasy: Distribute your MCP server](https://www.speakeasy.com/mcp/distributing-mcp-servers)
- Medium feeds (MEDIUM): [Medium Help Center: RSS feeds](https://help.medium.com/hc/en-us/articles/214874118-Using-RSS-feeds-of-profiles-publications-and-topics), [The Medium RSS feed in detail](https://quickcoder.org/rss-overview/)
- Substack feeds (MEDIUM): [Substack support: publication RSS](https://support.substack.com/hc/en-us/articles/360038239391-Is-there-an-RSS-feed-for-my-publication), [FreshRSS discussion: paid-post truncation](https://github.com/FreshRSS/FreshRSS/discussions/6667)
- Mastodon keyless access (MEDIUM): [docs.joinmastodon.org: timelines methods](https://docs.joinmastodon.org/methods/timelines/)
- Trending endpoints (MEDIUM): [HN Algolia API](https://hn.algolia.com/api), [Forem API v1](https://developers.forem.com/api/v1), Stack Exchange API 2.3 (`/questions/no-answers`, custom filters)
- Client configs (MEDIUM): [OpenAI Codex MCP docs](https://developers.openai.com/codex/mcp), Composio guides for [OpenCode](https://composio.dev/content/mcp-with-opencode) and Codex

---
*Architecture research for: medium-research-mcp v1.1 (Writer-Aware, Universal Research)*
*Researched: 2026-07-08*
