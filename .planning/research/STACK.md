# Stack Research — v1.1 Writer-Aware, Universal Research

**Domain:** Multi-source MCP research servers (Node, stdio) — v1.1 additions only
**Researched:** 2026-07-08
**Confidence:** MEDIUM-HIGH overall (every endpoint claim live-verified against the real API/feed on 2026-07-08; version claims checked against npm registry)

> **Scope note:** This overwrites the v1.0 stack research. It covers ONLY what the
> five v1.1 feature areas need. Verdict up front: **ZERO new runtime dependencies
> are required.** Every new capability is either a new consumer of the existing
> `fast-xml-parser` RSS pipeline, a plain JSON API reachable through the existing
> `shared/http_client.js`, or a dev-time packaging concern.

## Recommended Stack

### Core Technologies (unchanged — verified still current)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `@modelcontextprotocol/sdk` | ^1.29.0 (locked 1.29.0) | MCP server framework | **1.29.0 is the latest on npm as of 2026-07-08** (verified via registry). No upgrade needed for v1.1; `registerTool` raw-shape convention in `shared/contract.js` stays valid. |
| `zod` | ^4.4 (locked 4.4.3) | Contract validation | Unchanged. New tools reuse `itemShape`/envelope shapes as-is. |
| `fast-xml-parser` | 4.5.7 | RSS/Atom parsing | Already handles Medium and Substack feeds — **both are plain RSS 2.0** (live-verified). No parser change needed. |
| Node built-ins (`fetch`, `node:net`, `node:dns/promises`, `node:crypto`, `node --test`) | Node >= 18 | HTTP, SSRF guard, tests | All new sources are HTTPS JSON or RSS — nothing new required. |

### New Capabilities → Existing-Stack Mapping (the actual v1.1 "stack")

| Capability | Endpoint / Mechanism | Runtime Dep Needed | Integration Point |
|------------|----------------------|--------------------|-------------------|
| Medium author feed | `https://medium.com/feed/@{user}` — RSS 2.0, **latest 10 items only**, `content:encoded` full HTML (abstract-only for member-only posts), tags as CDATA `<category>`, **no claps/stats → `score` and `num_comments` are `null`** | None | Existing RSS pipeline: `getText()` (SSRF-guarded) + `fast-xml-parser` config from `servers/rss/` |
| Substack author feed | `https://{pub}.substack.com/feed` (works on custom domains at `/feed`) — RSS 2.0, ~20 items, full HTML for free posts, **public teaser only for paid posts**, no `<category>`, `dc:creator` present | None | Same RSS pipeline |
| Substack archive (enhancement) | `GET https://{pub}.substack.com/api/v1/archive?sort=new&offset=N&limit=M` — keyless JSON; returns `reaction_count`, `comment_count`, `audience` (`everyone`/`only_paid`), `post_date`, `canonical_url`, `postTags`, `wordcount` (live-verified) | None | `getJson()`. **Undocumented internal API** — build on the RSS baseline first, layer this as the score/num_comments enrichment with graceful fallback |
| Dev.to trending | `GET /api/articles?top=N` (most popular in last N days), `state=fresh\|rising\|all`, `per_page` 1–1000 (default 30) — official Forem docs | None | New params on the existing Dev.to server; `getJson()` |
| SE pain-point mining | `GET /2.3/questions/no-answers` and `/2.3/questions/unanswered`, `sort=votes\|activity\|creation`; **`view_count` is in the DEFAULT question object — no custom filter needed** (live-verified: keyless call returned `view_count`) | None | New tool/params on existing Stack Exchange server |
| HN rising / front page | Algolia: `?tags=front_page` (live front page, verified), rising = `search_by_date?tags=story&numericFilters=created_at_i>{now-24h},points>{threshold}`; keyless, 10k req/hr, `hitsPerPage`≤1000 | None | New params on existing HN server (already Algolia-backed) |
| Discourse server (SRC-10) | Append `.json`: `/latest.json` (verified anonymous), `/top.json?period=daily\|weekly\|monthly\|quarterly\|yearly\|all`, `/t/{id}.json`, `/search.json?q=`, `/categories.json` — keyless on public instances; `login_required` instances 403 | None | New server copied from `servers/hn/`; instance URL is a tool parameter → **must route through the SSRF-guarded fetch path** (user-controlled host, same threat class as RSS) |
| Mastodon server (SRC-11) | `GET /api/v1/timelines/public`, `/api/v1/timelines/tag/{hashtag}` (`limit` default 20 max 40, `local`/`remote`/`only_media`); bonus: `/api/v1/trends/tags` + `/trends/statuses` (keyless, verified on mastodon.social). Keyless unless instance disables public preview (then app token + `read:statuses`, per docs.joinmastodon.org; behavior since v3.0.0, per-instance controls since v4.5.0). ~300 req/5 min/IP | None | New server; instance URL is a tool parameter → SSRF-guarded path, same as Discourse |

### Development Tools (new for PKG-01+, all dev-time only)

| Tool | Version | Purpose | Notes |
|------|---------|---------|-------|
| `@anthropic-ai/mcpb` | **2.1.2** (latest on npm, verified 2026-07-08) | `.mcpb` bundle packing (`mcpb init` / `validate` / `pack` / `sign`) | Install as **devDependency** (pin it) or global. `manifest_version` is still **`"0.3"`** (spec last updated 2025-12-02) — the repo's existing manifests are already on 0.3, no migration. Bundle = zip of `manifest.json` + entry + **bundled `node_modules`** (`npm install --production`). |
| npm `bin` entries + shebang | n/a | npm/npx distribution | Add `#!/usr/bin/env node` to each `servers/*/server.js` and a `bin` map in `package.json` (one command per server, e.g. `"medium-research-hn": "servers/hn/server.js"`). Plain ESM — no build step, no bundler. Add a `files` whitelist (`servers/`, `shared/`, manifests). |
| MCP Inspector | latest via npx | Manual smoke of new servers | Already in use (`npm run inspect:hn`); add `inspect:discourse`, `inspect:mastodon`, `inspect:blogs`. |

## Installation

```bash
# Runtime: NOTHING to install — zero new runtime dependencies.

# Dev (packaging, PKG-01+):
npm install -D @anthropic-ai/mcpb@2.1.2   # pinned; used only by pack scripts
```

## Client Configuration Matrix (PKG-01+ docs deliverable)

All three targets spawn the same stdio process — no server code changes, only docs:

| Client | Config file | Format |
|--------|-------------|--------|
| Claude Desktop | `.mcpb` double-click install (or `claude_desktop_config.json`) | `manifest.json` 0.3, `user_config` with `"sensitive": true` → masked + stored securely (OS keychain) |
| OpenCode | `opencode.json` | `"mcp": { "<name>": { "type": "local", "command": ["npx","-y","<pkg>"], "enabled": true, "environment": {…} } }` |
| Codex CLI | `~/.codex/config.toml` (or project `.codex/config.toml`) | `[mcp_servers.<name>]` with `command`/`args`/`env`; or `codex mcp add <name> --env K=V -- <cmd>`. **Stdio only** — fits this suite exactly |
| Cursor | `~/.cursor/mcp.json` or `<project>/.cursor/mcp.json` | Claude-Desktop-style `mcpServers` `{ command, args, env }` |

`npx -y <pkg>@latest` is the standard cross-client invocation once published to npm.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Medium/Substack via existing RSS pipeline (`fast-xml-parser`) | Medium GraphQL / Substack private feed (`/feed/private/<token>`) | Never for this project — GraphQL is unofficial/brittle; private feeds embed per-user auth tokens (out of scope, read-only public research only) |
| Substack RSS baseline + archive-API enrichment | Archive API only | Never as the only path — it's undocumented and could change; RSS is the stable contract-filling baseline |
| HN Algolia for rising/front-page | HN Firebase `topstories`/`beststories` | Only if Algolia is down — Firebase returns bare ID lists requiring N+1 item fetches (cache-hostile) |
| SE `/questions/no-answers?sort=votes` + client-side `view_count` ranking | `/2.3/search/advanced?accepted=False&views=N` | Use `search/advanced` if server-side view filtering proves necessary; costs more quota per call |
| One npm package, multiple `bin` entries | Scoped package per server (`@scope/hn`, …) | Only if servers ever version independently — today they share `shared/` and one lockfile, so one package is simpler and keeps supply-chain surface minimal |
| Mastodon timelines + trends keyless | Registered app token | Only if targeting instances that disable public preview; make it an optional credential like `GITHUB_TOKEN` — do not require it |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Any new RSS/feed library (`rss-parser`, `feedparser`) | Medium and Substack are plain RSS 2.0 — live-verified to parse with the existing tuned `fast-xml-parser` config (entity-expansion guards already in place) | Existing `servers/rss/` parsing helpers, extracted/shared if needed |
| `masto`, `megalodon`, or any Mastodon client lib | Two GET endpoints with query params; a client lib adds a dependency tree for nothing | `getJson()` |
| Discourse API client libs / `discourse-mcp` | Public reads are bare `.json` GETs, no auth | `getJson()` through the SSRF-guarded path |
| Medium unofficial stats APIs / scraping claps | No public API for claps; scraping violates the "no scraping" constraint | `score: null` — the contract explicitly allows it |
| `mcpb` as a runtime dependency | It's a packaging CLI; bundling it would bloat every `.mcpb` (bundles vendor `node_modules`) | devDependency, invoked only by pack scripts |
| A bundler (esbuild/rollup) for npm publishing | Plain ESM runs directly on Node 18+; a build step adds supply-chain and drift risk for zero gain | `bin` + shebang on source files |
| SDK upgrade "while we're at it" | 1.29.0 is already the latest; nothing in v1.1 needs newer SDK behavior | Stay pinned |

## Stack Patterns by Variant

**If a v1.1 tool takes a user-supplied host (Discourse instance, Mastodon instance, blog feed URL):**
- Route it through the SSRF-guarded fetch path (the `getText`/denylist chokepoint), exactly like the RSS server.
- Because these are the same threat class that motivated the v1.0 SSRF hardening — arbitrary user-controlled outbound hosts.

**If a source has no engagement numbers (Medium RSS, Substack RSS):**
- Emit `score: null`, `num_comments: null` — never invent, never rename.
- Where a keyless enrichment exists (Substack archive API), fill them in with stale-tolerant fallback to `null` on failure.

**If an instance rejects anonymous access (Mastodon public-preview-off, Discourse `login_required`):**
- Surface a clear "instance requires authentication" tool error (Discourse) or honor an *optional* `MASTODON_TOKEN`-style credential (Mastodon), degrading keyless by default — mirroring the existing optional-credential pattern in `shared/credentials.js`.

**For .mcpb packing (PKG-01):**
- One bundle per server, `manifest_version: "0.3"` (already true), `mcp_config.args: ["${__dirname}/server/index.js"]`, `npm install --production` into the bundle, credentials as `user_config` with `"sensitive": true`.
- Because Claude Desktop ships Node — a Node bundle is zero-friction (Anthropic explicitly recommends Node over Python for MCPB).

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `@modelcontextprotocol/sdk` 1.29.0 | `zod` 4.4.x | Already proven in v1.0; raw-shape `registerTool` convention documented in `shared/contract.js` |
| `@anthropic-ai/mcpb` 2.1.2 (CLI) | `manifest_version` "0.3" | Repo manifests already 0.3 — `mcpb validate` should pass without migration |
| Node >= 18 `engines` | npx/npm distribution | Keep `engines.node >= 18` in published package so `npx` fails loudly on ancient Node |

## Feed/API Quirks Cheat Sheet (for the roadmap's author-blog + mining phases)

| Source | Items/page | Engagement fields | Paywall behavior | Gotcha |
|--------|-----------|-------------------|------------------|--------|
| Medium `feed/@user` | 10 (hard cap, rolling) | none → nulls | member-only = abstract only in `content:encoded` | tags are CDATA `<category>`; cadence view limited to last 10 posts |
| Substack `/feed` | ~20 | none → nulls | paid = public teaser + subscribe prompt | works on custom domains at `/feed` |
| Substack `/api/v1/archive` | `limit`/`offset` paged, full archive | `reaction_count`, `comment_count` | `audience: "only_paid"` flags paywalled posts | undocumented — wrap in try/fallback |
| Dev.to `?top=N` | `per_page` ≤ 1000 | `positive_reactions_count`, `comments_count` (existing mapping) | n/a | `top` and `state` are separate filters |
| SE `no-answers`/`unanswered` | `pagesize` ≤ 100 | `score`, `answer_count`, `view_count` (default object) | n/a | `unanswered` = no *accepted/upvoted* answer; `no-answers` = zero answers — expose both semantics deliberately |
| HN Algolia | `hitsPerPage` ≤ 1000, ≤ 1000 total hits | `points`, `num_comments` | n/a | `front_page` tag ≈ 145 hits (rolling); rising needs `search_by_date` + numericFilters |
| Discourse `/latest.json` | 30 topics | `posts_count`, `reply_count`, `like_count` | `login_required` → 403 | detail via `/t/{id}.json`; excerpts sometimes absent |
| Mastodon timelines | `limit` ≤ 40 | `replies_count`, `reblogs_count`, `favourites_count` | preview-off instances → 401/422 | `content` is HTML → existing strip helpers; trends endpoints are a free bonus for pain-point mining |

## Sources

- https://developers.forem.com/api/v1 — Dev.to `top`/`state`/`per_page` (official docs, fetched 2026-07-08)
- https://docs.joinmastodon.org/methods/timelines/ — public/tag timeline auth rules, params, version history (official docs)
- https://github.com/anthropics/mcpb + MANIFEST.md — MCPB format, `manifest_version` 0.3, CLI commands (official repo)
- npm registry — `@anthropic-ai/mcpb@2.1.2`, `@modelcontextprotocol/sdk@1.29.0` latest (verified 2026-07-08)
- **Live probes 2026-07-08** (strongest verification): `medium.com/feed/@ev` (10 items, no stats), `astralcodexten.com/feed` (20 items) + `/api/v1/archive` (reaction/comment counts, `audience`), `api.stackexchange.com/2.3/questions/unanswered?sort=votes` (`view_count` in default object), `hn.algolia.com/api/v1/search?tags=front_page` (145 hits), `meta.discourse.org/latest.json` (anonymous OK), `mastodon.social/api/v1/timelines/tag/rust` + `/api/v1/trends/tags` (keyless OK)
- https://help.medium.com/hc/en-us/articles/214874118 — Medium RSS behavior incl. paywalled-content truncation (official help center, via search)
- https://support.substack.com/hc/en-us/articles/360038239391 — Substack feed URL + paid-post preview behavior (official, via search)
- https://opencode.ai/docs/mcp-servers/, https://developers.openai.com/codex/mcp, Cursor docs (via search) — client stdio config formats
- Confidence tiers assigned via `gsd-tools query classify-confidence` (websearch cross-verified → MEDIUM); live-probe confirmations noted inline

---
*Stack research for: medium-research-mcp v1.1 (author blogs, trending/pain-point mining, Discourse, Mastodon, universal distribution)*
*Researched: 2026-07-08*
