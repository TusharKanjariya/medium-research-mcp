# Project Research Summary

**Project:** medium-research-mcp — milestone v1.1 "Writer-Aware, Universal Research"
**Domain:** Multi-source MCP research servers (Node, stdio) — author-blog awareness, trending/pain-point mining, two new sources, universal distribution
**Researched:** 2026-07-08
**Confidence:** MEDIUM-HIGH

## Executive Summary

v1.1 is a purely additive milestone on a settled v1.0 architecture. The headline verdict from stack research: **zero new runtime dependencies are required.** Every new capability — Medium/Substack author feeds, Dev.to top-window, Stack Exchange high-view-unanswered mining, HN rising, Discourse (SRC-10), Mastodon (SRC-11) — is either a new consumer of the existing `fast-xml-parser` RSS pipeline or a keyless JSON GET through `shared/http_client.js`. The only new tooling is dev-time packaging (`@anthropic-ai/mcpb@2.1.2` as a devDependency, npm `bin` entries + shebangs).

The recommended approach has one hard gate: **extend the SSRF guard from `getText` to a guarded JSON path before building Discourse or Mastodon.** The v1.1 parameterization rule (instance URLs and authors are tool inputs, never hardcoded) makes every new server a user-controlled-host server — the exact threat class the v1.0 guard was built for, but today only on the text/RSS path. Everything else is mechanical: trending tools are additive `registerTool` blocks on existing servers, author-blog tools extend the rss server (avoiding a server-to-server import), and the two new servers are hn-template copies over the guarded path. The output contract stays frozen — new signals express themselves through endpoint selection and server-side ordering, never new item fields.

Key risks are all catalogued and preventable: Medium's CDN bot-blocking (403s on default UA) meets the repo's no-4xx-retry policy badly — fix the User-Agent in the shared client first; author feeds are hard-capped windows (10 posts Medium, ~20 Substack) with paywalled bodies truncated, so dedup/cadence features must be designed around "honest windowing" from day one; and distribution has three well-documented failure modes (`.mcpb` bundles breaking `../../shared` imports, Windows `spawn npx ENOENT`, clients not inheriting shell env) that a staging build script, per-OS docs, and spawn tests prevent.

## Key Findings

### Recommended Stack

No runtime changes. The existing stack (`@modelcontextprotocol/sdk` 1.29.0 — already latest, `zod` 4.4.x, `fast-xml-parser` 4.5.7, Node >= 18 built-ins) covers every v1.1 feature; all endpoints were live-verified on 2026-07-08. Do NOT add a feed library, Mastodon/Discourse client libs, a bundler, or upgrade the SDK.

**Core technologies:**
- Existing RSS pipeline (`getText` + `fast-xml-parser`): Medium (`medium.com/feed/@user`) and Substack (`{pub}.substack.com/feed`) are plain RSS 2.0 — parse as-is
- `getJson()` via `shared/http_client.js`: all new JSON endpoints (Dev.to `top=N`, SE `no-answers`/`unanswered` with default-object `view_count`, HN Algolia `search_by_date`+`numericFilters`, Discourse `.json` routes, Mastodon timelines/trends) — all keyless
- `@anthropic-ai/mcpb` 2.1.2 (devDependency only): `.mcpb` packing; `manifest_version` "0.3" — existing manifests need no migration
- npm distribution: one package, `bin` map with one entry per server, shebang lines, `files` whitelist — no build step

### Expected Features

**Must have (table stakes, all P1):**
- `author_posts` tools (Medium/Substack/raw-feed-URL as tool params) with full-text + tags and explicit coverage-window honesty — the milestone's headline
- Dev.to `top=N` days param (+ `state=rising`) — cheapest trending win, native API
- SE high-view unanswered tool — the strongest pain-point-to-blog-topic signal (fetch tagged window, rank by `view_count` client-side; no server-side view sort exists)
- HN rising tool — computed velocity (`search_by_date` + points/age filters); HN has no native rising endpoint
- Discourse server (SRC-10) and Mastodon server (SRC-11), instance as tool parameter
- npm packages + per-client config docs (Claude Desktop, Cursor, Codex, OpenCode)
- Parameterization rule audit (no hardcoded accounts/instances/feeds; Lemmy instance demoted to tool param)

**Should have (P2 differentiators):**
- `.mcpb` one-click bundles (PKG-01) — after npm packaging shape settles
- Mastodon trends tools (`trends/tags`, `trends/links`) — near-zero cost once SRC-11 exists
- Substack full-archive via undocumented `/api/v1/archive` JSON — score/comment enrichment with graceful RSS fallback
- Cross-source pain-point sweep recipe (docs only, uses existing `mergeRank`)

**Defer (v2+ / anti-features):**
- Bluesky (AT Protocol complexity, marginal signal)
- Medium/Substack stats scraping (no API; `score: null` is contract-legal), post publishing, embedding/vector dedup index, scheduled monitoring, baked-in topic scores

### Architecture Approach

Hub-and-spoke unchanged; v1.1 makes **one shared change** (guarded JSON path, e.g. `getJson(url, { untrustedHost: true })` reusing `assertSafeUrl` + redirect re-validation), adds two server dirs (discourse, mastodon), extends four existing servers (rss gains author tools, hn/stackexchange/devto gain trending tools, lemmy joins the parameterization sweep), and adds a repo-level distribution layer (`scripts/build-mcpb.mjs` staging server+shared+prod node_modules per bundle; publishable root `package.json` with a `bin` per server). Author-blog tools live IN the rss server — a sibling server would duplicate the parser or break the `servers/* -> shared/*` dependency direction. Writer-awareness computations split cleanly: servers do recall (normalized prior posts, server-side ordering), the consuming agent does precision (semantic dedup, cadence math over `created_utc`), optionally aided by a `shared/writer.js` reference helper mirroring `rank.js`.

**Major components:**
1. `shared/http_client.js` (MODIFIED) — SSRF guard extended to a guarded JSON path; prerequisite for every tool-param-host server
2. `servers/rss` (MODIFIED) — `rss_author_posts` with platform/author params, `query`/`published_before` selection
3. `servers/hn`, `stackexchange`, `devto` (MODIFIED) — additive trending/pain-point tools, zero shared changes
4. `servers/discourse`, `servers/mastodon` (NEW) — hn-template copies over the guarded JSON path
5. Distribution layer (NEW) — `build-mcpb.mjs`, bin map + shebangs, manifest cleanup x11, `docs/INSTALL.md`

### Critical Pitfalls

1. **SSRF gap on instance URLs** — Discourse/Mastodon tool-param hosts hitting unguarded `getJson` bypass all v1.0 hardening. Land the guarded JSON path first; test `127.0.0.1`/`169.254.169.254` rejection.
2. **Medium bot-blocking x no-4xx-retry policy** — default undici UA gets 403'd, hard-erroring every Medium call. Set a descriptive browser-plausible UA in the shared client before the author tools land; map 403 to a clear tool-level error.
3. **Dedup/cadence on truncated windows** — Medium feeds = 10 latest posts, paywalled bodies abstract-only; Substack paid posts end in "Read more". Design for title+teaser dedup, detect preview markers, document window caps in tool descriptions; never scrape around it.
4. **Per-instance variance (Discourse/Mastodon)** — `login_required`/`AUTHORIZED_FETCH` instances 403/401; content-type-check before JSON.parse; clamp Mastodon `limit` at 40 in zod; smoke >=3 real instances each.
5. **Distribution breakage** — `.mcpb` naive packing breaks `../../shared` imports (stage repo layout + vendored prod node_modules, spawn-test every bundle); Windows needs `cmd /c npx -y`; clients don't inherit shell env (explicit `env` blocks in every per-client doc).
6. **Quota abuse in trending tools** — honor SE `backoff`/`quota_remaining`; Dev.to `top` is integer days not `"week"`; document HN rising as an approximation with date-based ordering.

## Implications for Roadmap

Based on research, suggested phase structure (matches ARCHITECTURE's explicit build-order table):

### Phase 1: Shared foundations + trending tools
**Rationale:** The guarded JSON path is the single gating dependency for everything with a user-supplied host; trending tools have zero dependencies and parallelize alongside it.
**Delivers:** `getJson` untrusted-host guard (with injectable-lookup + redirect-hop tests), shared UA default for feed fetches, `hn_rising`, `so_unanswered` (view-ranked), `devto_top(days)`.
**Addresses:** Three P1 trending features.
**Avoids:** Pitfalls 3 (pre-empted), 6 (backoff/schema handling baked in).

### Phase 2: Author-blog tools (rss server extension)
**Rationale:** The milestone's headline capability; independent of Phase 1's guard (getText is already guarded) so can run in parallel, but benefits from the shared UA change.
**Delivers:** `rss_author_posts` (medium/substack/feed-URL params, query/published_before selection), preview-marker detection, optional `shared/writer.js` helpers, honest-window tool descriptions; optionally Substack archive enrichment (P2, graceful fallback).
**Avoids:** Pitfalls 1 (Medium 403 mapping) and 2 (truncated-text dedup) — verify against a paid Medium author and paywalled Substack.

### Phase 3: New servers + parameterization sweep
**Rationale:** Both servers require the Phase 1 guard; Lemmy's instance-to-tool-param move uses the same mechanism, so all three belong together.
**Delivers:** Discourse server (SRC-10: latest/top/search/topic-detail), Mastodon server (SRC-11: hashtag/public timelines, optionally trends), Lemmy parameterized with env as optional default, TYPE enum appended (`"topic"`, `"status"`).
**Avoids:** Pitfalls 4 and 5 — multi-instance smokes including one login-required Discourse and one locked-down Mastodon instance.

### Phase 4: Universal distribution
**Rationale:** Strictly last — packaging must ship the final v1.1 tool surface once; no code the earlier phases produce depends on it.
**Delivers:** Publishable `package.json` (bin map, shebangs, `files` whitelist, `engines` >= 18), `scripts/build-mcpb.mjs` staging + `mcpb pack` per server, manifest cleanup x11 (per-server `user_config` only, `sensitive: true`), `docs/INSTALL.md` with per-client per-OS snippets (Windows first).
**Avoids:** Distribution pitfalls 7-10 — spawn-test every bundle, `npm pack` tarball inspection, Windows `cmd /c npx` connection test, explicit env-block docs.

### Phase Ordering Rationale

- The guarded JSON path is the only cross-cutting dependency; landing it first unblocks Phase 3's parallelism and closes the SSRF hole before it can exist.
- Phases 1-2 are largely parallel (independent servers, one shared file touched by each — coordinate the http_client changes).
- Distribution last because packaging a moving tool surface means re-packing; nothing in it feeds back into code except shebang lines.
- Nothing in any phase touches the frozen output contract — the load-bearing invariant survives v1.1 untouched by design.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3 (new servers):** per-instance behavioral variance (Discourse login_required/pagination, Mastodon 4.5 timeline controls) is inherently un-fixture-able — plan live multi-instance verification; the guarded-JSON refactor deserves a threat-model pass (touches the v1.0 SSRF chokepoint incl. the accepted DNS-rebinding TOCTOU residual T-04-06).
- **Phase 4 (distribution):** verify `manifest_version` currency at execution time (spec has drifted 0.3 -> ~0.4 per one source); `${user_config.*}` env delivery differs per install path — needs the hands-on verification checklist, not more web research.

Phases with standard patterns (skip research-phase):
- **Phase 1 (trending tools):** all endpoints live-verified with exact params documented; pure additive `registerTool` blocks.
- **Phase 2 (author-blog):** re-skin of the shipped `servers/rss` pipeline; feed quirks fully catalogued in STACK.md's cheat sheet.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM-HIGH | Every endpoint claim live-probed 2026-07-08; versions verified against npm registry |
| Features | HIGH | API mechanics from official docs + live probes; MEDIUM on Medium/Substack feed specifics (community-documented + probes) |
| Architecture | MEDIUM-HIGH | Codebase claims HIGH (read from source); external packaging/client claims web-verified |
| Pitfalls | MEDIUM | Official docs where they exist; per-instance Discourse/Mastodon behavior inherently variable |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **Substack archive API stability:** undocumented endpoint — ship as enrichment with RSS fallback; treat breakage as expected, not a bug.
- **MCPB spec version drift:** STACK says 0.3 is current, PITFALLS cites ~0.4 movement — re-verify `mcpb validate` against the pinned CLI at Phase 4 execution.
- **Medium 403 rate in the wild:** only observable from non-residential networks; verify error-message quality during Phase 2, plan the LOW-cost UA recovery if it ships imperfect.
- **`${user_config.*}` on the Claude Code plugin path:** known gotcha ("can silently fail to spawn") — Phase 4 checklist item, cannot be resolved by research.
- **SE `unanswered` vs `no-answers` semantics:** pick one deliberately (or expose both) and document during Phase 1 planning.

## Sources

### Primary (HIGH confidence)
- Live probes 2026-07-08: `medium.com/feed/@ev`, Substack feeds + `/api/v1/archive`, SE `/questions/unanswered`, HN Algolia `front_page`, `meta.discourse.org/latest.json`, `mastodon.social` timelines/trends
- Official docs: Forem API v1, docs.joinmastodon.org (timelines/trends), hn.algolia.com/api, modelcontextprotocol/mcpb repo + MANIFEST.md, npm registry version checks
- Codebase: `.planning/codebase/ARCHITECTURE.md`, `CONCERNS.md`, `servers/rss/server.js`, `servers/hn/manifest.json`, `.planning/research/ADDITIONAL-SOURCES.md`

### Secondary (MEDIUM confidence)
- Medium/Substack help centers + community feed documentation (quickcoder.org, FreshRSS/rss-bridge discussions) — window caps, paywall truncation
- SE throttle docs, Discourse Meta rate-limit/pagination threads, Mastodon 4.5 dev blog + AUTHORIZED_FETCH PRs
- Client config docs: OpenCode, Codex CLI, Cursor; npx-on-Windows issue threads

### Tertiary (LOW confidence)
- Substack `/api/v1/archive` and `/api/v1/posts` behavior (undocumented, single-cycle probes) — validate at implementation time

---
*Research completed: 2026-07-08*
*Ready for roadmap: yes*
