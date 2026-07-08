# Feature Research

**Domain:** Writer-aware blog-topic research MCP suite (v1.1 milestone — NEW features only: author-blog feed tools, trending/pain-point mining, Discourse, Mastodon, universal distribution)
**Researched:** 2026-07-08
**Confidence:** HIGH overall (API mechanics verified against official docs / live endpoints; MEDIUM on Medium/Substack feed specifics, which are community-documented + one live probe)

Scope note: v1.0 features (9 servers, contract, mergeRank, RSS fetcher) are shipped
and NOT re-researched here. This file covers only the v1.1 target features.

## How the Target Features Actually Work (verified behavior)

Facts that constrain feature design — each verified this cycle:

| Fact | Detail | Confidence |
|------|--------|------------|
| Medium author RSS = **10 most recent posts** | `medium.com/feed/@user`. Items carry `title`, `link`, `pubDate`, up to 5 `<category>` tags, `content:encoded` (full body for free posts, **abstract only for paywalled posts**). **Zero stats** — no claps/views/responses. | MEDIUM |
| Substack RSS = **~20 most recent posts** | `<pub>.substack.com/feed` (or custom domain `/feed`). Verified live: `newsletter.pragmaticengineer.com/feed` returned exactly 20 items. No stats; paid-post bodies truncated. Full archive only via **unofficial** `/api/v1/posts?limit&offset` JSON (undocumented, rate-limited). | MEDIUM–HIGH (count verified empirically) |
| Dev.to has a native top window | `GET /api/articles?top=N` = most popular articles published in the last N days; combines with `tag=`. Also `state=fresh\|rising`. Articles include `positive_reactions_count`, `comments_count`. | HIGH (official Forem docs) |
| Stack Exchange has **no view sort** | `/questions/no-answers` + `/questions/unanswered` sort only by `activity\|votes\|creation`. But `view_count` IS in the default question object → "high-view unanswered" = fetch a tagged window, rank by `view_count` client-side. `/search/advanced` adds `answers=0`, `accepted=False`. | MEDIUM |
| HN has **no native "rising"** | Algolia HN API: compute it — `/search_by_date?tags=story&numericFilters=points>P,created_at_i>T` (young stories already scoring), rank by points/hour client-side. `tags=front_page` gives the literal current front page. Keyless. | HIGH |
| Mastodon trends are keyless | `/api/v1/trends/tags` (max 20), `/trends/statuses` (max 40), `/trends/links` (max 20) are OAuth:Public — no auth on instances that allow it, alongside the planned hashtag/public timelines. | HIGH (official docs) |
| Discourse top windows are keyless | `/top.json?period=daily\|weekly\|monthly\|quarterly\|yearly\|all`, `/latest.json`, `/c/<slug>/<id>.json` — no API key for public categories. Topics carry `like_count`, `posts_count`, `views`. | MEDIUM |

**Design consequence #1 (author tools):** dedup/series/cadence can only ever see a
10–20-post window from official feeds. The right behavior is *honest windowing*:
return the normalized window plus enough signal (count, oldest `created_utc`)
for the consuming skill to know coverage is partial — not to pretend the feed is
the catalog.

**Design consequence #2 (topic signals):** the three signal families are
complementary and all map cleanly onto the existing contract:
- **Dev.to top-of-window** = *what resonated* (reactions over 7/30 days, per tag) → proven-demand topics.
- **SE high-view unanswered** = *pain points* (many people searching, nobody answered well) → the classic content-gap play; the single best "write a tutorial on X" predictor.
- **HN rising** = *what's about to peak* (velocity on young stories) → catch a trend before it saturates.

## Feature Landscape

### Table Stakes (v1.1 is incomplete without these)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| `author_posts` tool (new author-blog server): `platform` (`medium`/`substack`/raw feed URL) + `author` as **tool parameters** → normalized `{source, query, count, results[]}` | The milestone's headline: "am I repeating myself?" needs the author's recent posts in the same shape as research results | LOW–MEDIUM | Builds feed URL from params, fetches via `getText()` (SSRF guard already exists), parses with `fast-xml-parser@4` — largely a re-skin of `servers/rss` normalization. `score`/`num_comments` = `null` (contract-legal) |
| Full-text + tags in author items | Dedup and series detection are done by the *calling LLM* comparing titles/tags/text — needs `<category>` → `tags[]`, HTML-stripped `content:encoded` → `text` | LOW | Truncate `text` sensibly (existing trimming convention); paywalled Medium posts degrade to abstract — acceptable, still enough for dedup |
| Coverage-window honesty | Feed shows only 10 (Medium) / 20 (Substack) posts; the skill must not treat "not in feed" as "never written" | LOW | `count` + per-item `created_utc` already convey it; tool descriptions must state the window explicitly so the agent reasons correctly |
| Dev.to trending: `top` (days) param on existing list tool | Native API support; the cheapest high-quality "what resonated this week/month" signal | LOW | Param passthrough on `servers/devto` + zod schema; combine with existing `tag` param |
| SE pain-point tool: high-view unanswered per tag | Strongest "good blog topic" predictor; users of a writer-research suite expect a pain-point miner | MEDIUM | New tool on `servers/stackexchange`: `/questions/no-answers?tagged=X&sort=votes` (or creation window), client-side rank by `view_count`; keep `score`=question score, `num_comments`=answer count per contract |
| HN rising tool | "What's climbing right now" is expected from any HN research tool; front page alone is too late | MEDIUM | New tool on `servers/hn`: Algolia `search_by_date` + `numericFilters=points>P,created_at_i>now-Nh`, rank by points/hour client-side; expose `hours` + `min_points` as params with defaults |
| Discourse server (SRC-10): `instance` as tool parameter; `latest`, `top(period)`, topic detail | Already validated as highest-value new source; one generic server unlocks every public Discourse forum | MEDIUM | Copy `servers/hn` pattern; `score`=like/activity count, `num_comments`=`posts_count−1`; instance URL must pass the same SSRF hygiene thinking as RSS |
| Mastodon server (SRC-11): `instance` + `hashtag` as tool parameters; hashtag + public timelines | Second validated new source; keyless practitioner signal | MEDIUM | `score`=favourites+reblogs, `num_comments`=`replies_count`; pace ≥250 ms/instance, respect the 300 req/5 min public ceiling |
| npm-published packages + per-client config docs | "Universal" means any MCP client (OpenCode, Codex, GPT clients) can `npx` a server; npm is the lowest common denominator | MEDIUM | Needs `bin` entries, package naming scheme, README config snippets per client; no code change to servers |
| Parameterization rule enforced everywhere (cross-cutting) | Hard rule from the user: no hardcoded accounts/instances/feeds; env only for credentials/optional defaults | LOW | Convention + review checklist item; already the pattern in `rss_fetch` |

### Differentiators (competitive advantage for a writer-focused suite)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| `.mcpb` one-click bundles (PKG-01) | Claude Desktop users install a connector with zero terminal use; almost no research-MCP ships this | MEDIUM–HIGH | `manifest.json` scaffolds already exist per server from v1.0; needs pack tooling + `sensitive` credential wiring + testing per bundle |
| Cadence view derived from the feed window | "You post every ~9 days; it's been 15" — the feed's `pubDate`s over 10–20 posts are enough for a rolling cadence estimate | LOW | Cheapest form: agent computes it from `created_utc` in the normal list output (zero new code, document the recipe). Optional convenience tool later; don't bloat the contract |
| Substack full-archive listing (unofficial `/api/v1/posts` pagination) | Breaks the 20-post dedup ceiling for Substack authors — real catalog awareness | MEDIUM | **Risk-flagged:** undocumented endpoint, may break/throttle; it *is* JSON (not scraping HTML) so it skirts, not violates, the no-scraping rule. Ship behind a separate tool name, degrade to RSS on failure |
| Mastodon trends tools (`trends/tags`, `trends/links`) | "What's hot across the fediverse" beyond a single hashtag — keyless, and links-trending surfaces blog-worthy articles directly | LOW | Same server as SRC-11, two more endpoints; some instances disable trends → return empty results gracefully, never hard-error |
| Dev.to `state=rising` passthrough | Early-momentum signal to pair with `top` windows | LOW | One more enum value on the same tool |
| Cross-source pain-point sweep recipe | One documented invocation pattern: same tag through SE-unanswered + Discourse-top + Mastodon-hashtag + Dev.to-top, merged by existing `mergeRank` | LOW | Zero new code — documentation leveraging OUT-02; this is the suite's unique story vs single-source MCPs |
| Follow-up/series detection support | Feed `title` conventions ("Part 2", shared tag runs) + `text` let the LLM spot series and propose the next installment | LOW | No new code beyond `author_posts` — call it out in tool description so agents use it |

### Anti-Features (deliberately NOT building)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Medium/Substack **stats scraping** (claps, views, subscriber counts, open rates) | Writers want to know what performed | Not in any feed or public API; requires authenticated session scraping — brittle, ToS-hostile, per-account credentials the suite forbids hardcoding | `score: null` is contract-legal; engagement signal comes from *community* sources (Dev.to reactions, HN points). Writer checks own dashboards manually |
| **Post drafting/publishing** | "Close the loop" appeal | Out of scope by charter — these are research tools; Medium's write API is effectively dead anyway | `medium-blog-pro` skill owns drafting; suite stays read-only |
| Persistent **embedding/vector index** of the author catalog for dedup | "Proper" semantic dedup | Adds state, storage, and a heavy dep to a stateless stdio suite; the calling LLM already does semantic comparison over titles+tags+text better than cosine-on-titles | Return clean normalized text; dedup is the consuming agent's inference job |
| Scraping Medium archive/profile HTML for full catalog | Beat the 10-post feed limit | Medium is aggressively anti-bot; archive pages unstable; violates the "no scraping without a usable API" rule | Accept the window; for Substack use the unofficial JSON API (differentiator above); writer's full catalog can be supplied to the skill as context by the user |
| Hardcoded default author/instance/feed (env or code) | Convenience for the primary user | Violates the milestone's hard parameterization rule; breaks "any agent, any target" | All targets are tool parameters; env reserved for credentials and *optional* defaults only |
| Scheduled monitoring / streaming / webhooks | "Alert me when something rises" | Repo explicitly excludes real-time; stdio MCP has no daemon lifecycle | Cached research bursts at call time; agent re-calls the rising tool when it wants freshness |
| Opinionated "topic score" ML ranking baked into servers | One number is seductive | Servers are dumb normalizers by design; a baked score hides provenance and breaks the uniform contract's neutrality | `mergeRank` + the LLM rank with full visibility; keep `score` = raw source engagement |
| Bluesky server in v1.1 | Fediverse completeness | Feed model more involved (AT Protocol); marginal signal over Mastodon for dev topics right now | Revisit v2 if Mastodon coverage proves valuable (per ADDITIONAL-SOURCES.md) |

## Feature Dependencies

```
author_posts (new server)
    └──requires──> shared getText() SSRF guard        [v1.0, shipped]
    └──requires──> fast-xml-parser normalization       [v1.0, servers/rss]
    └──requires──> contract.js item schema             [v1.0, shipped]

Substack full-archive tool ──extends──> author_posts (fallback to RSS on failure)
Cadence/series recipes     ──enhance──> author_posts (no new code)

devto top/rising params    ──extend──> servers/devto   [v1.0]
SE high-view unanswered    ──extends──> servers/stackexchange (site param) [v1.0]
HN rising                  ──extends──> servers/hn (Algolia client) [v1.0]

Discourse server (SRC-10)  ──requires──> server template pattern + cache/http [v1.0]
Mastodon server (SRC-11)   ──requires──> server template pattern + cache/http [v1.0]
Mastodon trends tools      ──require──> Mastodon server (SRC-11)

npm distribution           ──requires──> all servers stable (any order after code lands)
.mcpb bundles (PKG-01)     ──require──> manifest.json scaffolds [v1.0] + npm packaging decisions
Cross-source sweep recipe  ──requires──> SE/Discourse/Mastodon tools + mergeRank [v1.0 OUT-02]
```

### Dependency Notes

- **Author server before distribution:** packaging should ship the full v1.1 tool
  surface once; land code features first, package last.
- **Trending params are independent of each other** — three small, parallelizable
  changes to three existing servers.
- **Mastodon trends ride SRC-11** — same server, near-zero marginal cost, but only
  after the timeline tools exist.
- **No conflicts identified** — nothing in v1.1 touches the output contract shape.

## MVP Definition

### Launch With (v1.1 core)

- [ ] `author_posts` (Medium/Substack/feed-URL param) — the milestone's headline capability
- [ ] Dev.to `top=N` (+ `state=rising`) params — cheapest trending win, native API
- [ ] SE high-view unanswered tool — the strongest pain-point→topic signal
- [ ] HN rising tool — early-trend detection
- [ ] Discourse server (SRC-10) — validated multiplier source
- [ ] Mastodon server (SRC-11, timelines) — validated fediverse source
- [ ] npm packages + client config docs — "universal" is a milestone goal
- [ ] Parameterization rule audit — cross-cutting acceptance gate

### Add After Validation (v1.1.x)

- [ ] `.mcpb` bundles (PKG-01) — once npm packaging shape settles
- [ ] Mastodon trends tools — if SRC-11 timelines prove useful
- [ ] Substack full-archive tool — if 20-post dedup ceiling actually bites in practice
- [ ] Cross-source pain-point sweep doc recipe — once all trend tools exist

### Future Consideration (v2+)

- [ ] Bluesky (AT Protocol) — revisit if fediverse signal proves valuable
- [ ] Cadence convenience tool — only if agents demonstrably fail computing it from `created_utc`

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| `author_posts` server | HIGH | LOW–MEDIUM | P1 |
| SE high-view unanswered | HIGH | MEDIUM | P1 |
| Dev.to top/rising params | HIGH | LOW | P1 |
| HN rising | MEDIUM–HIGH | MEDIUM | P1 |
| Discourse server | MEDIUM–HIGH | MEDIUM | P1 |
| Mastodon server (timelines) | MEDIUM | MEDIUM | P1 |
| npm + config docs | HIGH | MEDIUM | P1 |
| Parameterization audit | HIGH | LOW | P1 |
| `.mcpb` bundles | MEDIUM–HIGH | MEDIUM–HIGH | P2 |
| Mastodon trends tools | MEDIUM | LOW | P2 |
| Substack full archive (unofficial) | MEDIUM | MEDIUM (+risk) | P2 |
| Sweep recipe docs | MEDIUM | LOW | P2 |
| Bluesky | LOW–MEDIUM | HIGH | P3 |

**Priority key:** P1 must-have for v1.1 · P2 add when possible · P3 future.

## Competitor Feature Analysis

| Feature | Typical single-source MCP (e.g. reddit-mcp-buddy, hn-mcp) | Feed-reader tools (RSS.app, rss-bridge) | Our Approach |
|---------|--------------------------------------------------------------|------------------------------------------|--------------|
| Author catalog awareness | Absent | Raw feed passthrough, no normalization | Normalized `author_posts` with dedup/series/cadence signals in-band |
| Trending windows | Front-page only | None | Native windows (Dev.to `top`), computed windows (HN velocity, SE view-rank) |
| Pain-point mining | Absent | Absent | SE high-view unanswered per tag — unique for a writer suite |
| Multi-source merge | Per-source shapes, consumer branches | N/A | Branch-free `mergeRank` across all of the above (shipped v1.0) |
| Distribution | npx one-liner at best | SaaS | npm + `.mcpb` + per-client docs |

## Sources

- Medium RSS behavior: [quickcoder.org RSS overview](https://quickcoder.org/rss-overview/) (10-post limit, fields, paywall abstract, no stats); [Medium Help Center feeds article](https://help.medium.com/hc/en-us/articles/214874118-Using-RSS-feeds-of-profiles-publications-and-topics)
- Substack: live probe of `newsletter.pragmaticengineer.com/feed` (20 items, 2026-07-08); [substack-feed-api](https://github.com/rohit1901/substack-feed-api); [rss-bridge Substack notes](https://rss-bridge.github.io/rss-bridge/Bridge_Specific/Substack.html); unofficial `/api/v1/posts` per [Substack scraping guide](https://thedatacollector.substack.com/p/how-to-scrape-substack-newsletters)
- Dev.to: [Forem API v0 docs](https://developers.forem.com/api/v0) (`top`, `state`, reactions/comments fields) — official, HIGH
- Stack Exchange: API docs for `/questions/no-answers` (sorts: activity/votes/creation; `view_count` in question object) via [StackAPI docs](https://stackapi.readthedocs.io/en/latest/api.html) and API reference — MEDIUM
- HN: [HN Algolia API](https://hn.algolia.com/api) (`search_by_date`, `numericFilters`, `front_page` tag) — HIGH
- Mastodon: [docs.joinmastodon.org trends methods](https://docs.joinmastodon.org/methods/trends/) (OAuth: Public, limits 20/40/20) — official, HIGH
- Discourse: `.planning/research/ADDITIONAL-SOURCES.md` (2026-07-01 verified scan) + `/top.json?period=` public behavior — MEDIUM
- Project context: `.planning/PROJECT.md`, v1.0 shipped state

---
*Feature research for: medium-research-mcp v1.1 (Writer-Aware, Universal Research)*
*Researched: 2026-07-08*
