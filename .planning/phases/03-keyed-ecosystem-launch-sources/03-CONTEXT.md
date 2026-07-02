# Phase 3: Keyed Ecosystem & Launch Sources - Context

**Gathered:** 2026-07-02
**Status:** Ready for planning

> **Note on how this was gathered:** the discuss-phase question timed out (user
> away). Because Phase 3 is a mechanical copy of the proven Phase 1/2 pattern and
> every decision below is a reversible, planner-actionable choice (not a
> sensitive or irreversible action), Claude captured **recommended defaults** for
> the four gray areas rather than blocking. Each carries a **[RECOMMENDED —
> revise before planning if desired]** tag. Re-run `/gsd-discuss-phase 3` or edit
> this file to change any of them.

<domain>
## Phase Boundary

Deliver three source servers — **GitHub** (optional PAT), **Libraries.io**
(required key), **Product Hunt** (required token) — covering SRC-06, SRC-07,
SRC-08. Each is the same field-map-over-shared-modules copy proven in Phases 1–2
(`getJson`/`postJson`, `buildListEnvelope`/`buildDetailEnvelope`, `normalizeItem`,
`toolResult`, the `credentials.js` helpers that already exist). The point of the
phase is to exercise the **optional-PAT** path (GitHub degrades to anonymous) and
the **required-credential** path (Libraries.io / Product Hunt fail loudly with a
clear "set X" error), while surfacing ecosystem pain-point and launch/momentum
signal for blog topics.

**Out of scope:** the RSS multiplier, the 5+-source uniform-run proof, and the
Python YouTube wrapper (all Phase 4); any source not in SRC-06..08; any new tool
family beyond what these three sources need.
</domain>

<decisions>
## Implementation Decisions

### GitHub tool surface (two entity types on a uniform shape)
GitHub is the one source that carries **two distinct entity types** — trending
**repos** (stars→`score`, `num_comments` null) and **issues** for pain-point
mining (reactions→`score`, comments→`num_comments`). Rather than force both
into the single `*_hot`/`*_search`/`*_get` trio, split by entity while keeping a
predictable, uniform surface:

- **D-01 [RECOMMENDED — revise before planning if desired]:** GitHub exposes
  three tools:
  - `gh_trending_repos({ query?, language?, since? })` — Search API repos,
    `stars`→`score`, `num_comments` null, `type:"repo"`.
  - `gh_search_issues({ query, labels?, repo? })` — Search **issues** endpoint,
    reactions total→`score`, comment count→`num_comments`, `type:"issue"`. This
    is the pain-point miner.
  - `gh_get_item({ ... })` — detail for either a repo or an issue; for an issue,
    top-level issue comments → `comments[]` (HN precedent); for a repo,
    `comments: []` (n/a).
- **D-02 [RECOMMENDED]:** **Issues cover the "issues/discussions" intent for
  v1; GitHub Discussions (GraphQL-only) are deferred, not dropped.** The Search
  issues REST endpoint keeps GitHub on the `getJson()` path like every other
  keyless-style server and already surfaces abundant pain-point/Q&A signal. If
  the planner finds Discussions cheap to add via the existing `postJson()`
  GraphQL path, they may include them — but it is a stretch goal, not a blocker
  on success criterion 1. *(This narrows ROADMAP §Phase 3 criterion 1's
  "issues/discussions" to issues-first; flagged explicitly here.)*

### 'Trending' / 'rising' semantics (extends Phase 2 D-07 native-trending)
None of these sources has a single clean native "trending" feed, so each tool's
default maps onto the most defensible momentum signal, with a param to override:

- **D-03 [RECOMMENDED]:** **GitHub trending** = Search API `sort=stars`,
  `order=desc`, windowed by a recent-activity qualifier (e.g.
  `created:>{today-7d}` or `pushed:>{today-7d}`); default window **7 days**,
  overridable via a `since` param (`day`/`week`/`month`). GitHub has no official
  trending API — this emulates it via Search, per the ROADMAP ("Search API,
  stars→score").
- **D-04 [RECOMMENDED]:** **Libraries.io** default sort = **most-depended**
  (`dependents_count`), because it is the stablest momentum signal and maps
  directly to `score`. A `sort` param switches to `rank` or recently-updated
  ("rising"). `num_comments` is null (n/a for packages).
- **D-05 [RECOMMENDED]:** **Product Hunt** default = **today's** launches, with a
  `period` param to switch to **this-week**; ordered by votes (`score`=votes,
  `num_comments`=comments), matching Phase 2 D-07.

### Filtering surface (extends Phase 2 D-03 free-passthrough)
- **D-06 [RECOMMENDED]:** **Libraries.io `platform`** param is a **free
  passthrough** (default `npm`) exactly like Stack Exchange's `site` (Phase 2
  D-03) — Libraries.io validates the platform server-side and errors on unknown
  values; no local whitelist to maintain.
- **D-07 [RECOMMENDED]:** **Product Hunt `topic`** param is an optional
  passthrough (topic slug); when absent, return the overall daily/weekly
  leaderboard. Product Hunt's GraphQL `posts(topic:)` filter validates the slug.

### Pain-point mining query design (GitHub issues)
- **D-08 [RECOMMENDED]:** `gh_search_issues` uses the GitHub Search issues
  endpoint with `is:issue` (open by default). Query = the caller's free text plus
  an optional `labels` filter (supports common pain labels — `bug`,
  `help wanted`, `question`, `good first issue` — none applied by default) and an
  optional `repo`/`owner` scope (default: **global** search across GitHub). Sort
  by reactions/interactions so the highest-signal pain points surface first.
- **D-09 [RECOMMENDED]:** Populate `score` from the issue's **reaction total**.
  Exact mechanism (the `reactions` object is GA on the REST issues API; the
  Search endpoint may need the `squirrel-girl` accept header or a `reactions`
  request) is a **researcher/planner detail** — flagged here so `score` isn't
  silently null.

### Required-credential behavior & verification (success criterion 4)
- **D-10:** Required creds resolve **lazily at tool-call time** via the existing
  `librariesIoParams()` / `productHuntHeaders()` helpers, which already throw
  `Missing credential: set LIBRARIESIO_KEY` / `set PRODUCTHUNT_TOKEN`. The server
  still registers and starts; the error surfaces on the call. A unit/Inspector
  check asserts the throw when the env var is unset. GitHub degrades to anonymous
  via `githubHeaders()` returning `{}` (CRED-04). *(Carried-forward infra, not a
  new decision — restated because criterion 4 requires it be explicitly
  verified.)*

### Plan split (from ROADMAP)
- **D-11:** Two plans, matching the ROADMAP: **03-01 GitHub** (largest —
  two entity types), **03-02 Libraries.io + Product Hunt** (the required-key
  pair). Product Hunt is the one GraphQL server here → reuse the `postJson()`
  path added in Phase 2; Libraries.io and GitHub are REST via `getJson()`.

### Claude's Discretion
- Exact `normalize*`/field-map function names, URL/query builders, GitHub Search
  qualifier strings and the trending time-window arithmetic, the Libraries.io
  endpoint choice (search vs project endpoints) and `sort` enum values, the
  Product Hunt GraphQL query strings and pagination, the reaction-count fetch
  mechanism (D-09), and page sizes — all planner/executor calls, provided the
  ARCHITECTURE §4 contract and the §5 per-source `score`/`num_comments` meaning
  hold.
- Per-source `type` enum: GitHub repo→`repo`, GitHub issue→`issue`,
  Libraries.io→`package`, Product Hunt→`launch`/`post` (following ARCHITECTURE
  §4/§5).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Output contract & MCP layer (linchpin)
- `docs/ARCHITECTURE.md` §4 — list/detail envelopes + item schema; `score`/`num_comments` may be null but never renamed/dropped.
- `docs/ARCHITECTURE.md` §5 — per-source `score`/`num_comments` meaning for exactly these three: GitHub repos (stars / n/a), GitHub issues/discussions (reactions / comments), Libraries.io (dependents/rank / n/a), Product Hunt (votes / comments), plus each source's API + auth column.
- `docs/ARCHITECTURE.md` §3 — `McpServer` + `registerTool` with raw Zod shapes, stdio; return both `structuredContent` and JSON-text `content`.
- `docs/ARCHITECTURE.md` §8 — cache ~15 min, retry 0.5s/1s/2s, never retry 4xx, stale fallback.

### The reference implementation to copy
- `servers/hn/server.js` — canonical server template (field-map + URL build + shared factories + dual return). Copy its structure.
- `servers/stackexchange/server.js` — closest analog for the **optional-key + `site`-style passthrough param** pattern (GitHub PAT + Libraries.io `platform`).
- `servers/devto/server.js` — closest analog for the **client-side `*_search` fallback (D-01, Phase 2)** if any GitHub/Libraries tool needs it.
- `shared/contract.js` — `buildListEnvelope`/`buildDetailEnvelope`/`normalizeItem`/`stripHtml`/`toolResult` + raw shapes. Do NOT re-implement.
- `shared/http_client.js` — `getJson()` (GitHub, Libraries.io) and `postJson()` (Product Hunt GraphQL). All HTTP goes through these.
- `shared/credentials.js` — `githubHeaders()` (optional PAT), `librariesIoParams()` (required key, throws), `productHuntHeaders()` (required token, throws), `userAgent()`. **Already implemented — reuse, do not add new env reads.**

### Credentials & process
- `docs/ARCHITECTURE.md` §6 — credential helpers + graceful-vs-required rules (GitHub optional → anonymous; Libraries.io/Product Hunt required → clear "set X"; CRED-04).
- `CLAUDE.md` — "how to add a new server" steps, output-contract "DO NOT BREAK", never-`fetch`/never-`process.env` rules.
- `docs/server-spec-template.md` — per-server spec + Universal Server Bar acceptance checklist each of the three servers must satisfy.
- `.planning/REQUIREMENTS.md` — SRC-06, SRC-07, SRC-08 (the Phase 3 requirement set); CRED-01/CRED-04.
- `.planning/ROADMAP.md` §"Phase 3" — goal, 4 success criteria, Universal Server Bar, and the plan split (03-01 GitHub · 03-02 Libraries.io + Product Hunt).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `servers/hn/server.js`: the template every server mirrors — only field-map and
  URL/query change.
- `servers/stackexchange/server.js`: precedent for optional-key + free-passthrough
  param (`site` → reuse the shape for GitHub `language`/`labels` and Libraries.io
  `platform`).
- `shared/contract.js`: factories + raw Zod shapes → each server is pure
  field-mapping; `stripHtml` centralizes HTML cleanup (GitHub issue bodies,
  Product Hunt descriptions).
- `shared/credentials.js`: `githubHeaders()`, `librariesIoParams()`,
  `productHuntHeaders()` **already exist and are unit-scaffolded** — Phase 3 just
  wires them into request headers/params.
- `shared/http_client.js` `postJson()`: added in Phase 2 (originally for
  Hashnode GraphQL, retained as generic infra) — the Product Hunt GraphQL path
  reuses it directly.
- `servers/hn/manifest.json`: `.mcpb` manifest shape to copy per server (with
  `user_config` + `"sensitive": true` for LIBRARIESIO_KEY / PRODUCTHUNT_TOKEN /
  optional GITHUB_TOKEN).

### Established Patterns
- Handler shape: `getJson(url)`/`postJson(url, body)` → `map*()` →
  `buildListEnvelope`/`buildDetailEnvelope` → `toolResult(env)`; `registerTool`
  takes raw Zod shapes (SDK 1.29 — not `z.object`).
- Direct-run guard (`import.meta.url === pathToFileURL(process.argv[1]).href`) so
  importing a server for tests doesn't open a live stdio transport.
- Tests: `node:test` units over fixture payloads for each `map*()` helper, a
  "tools register / declare outputSchema" check, **plus** (new for required-key
  servers) an assertion that a missing key throws the clear "set X" error.

### Integration Points
- Output consumed by the `medium-blog-pro` skill — all three servers must be
  rankable/filterable with zero source-specific logic (OUT-01).

</code_context>

<specifics>
## Specific Ideas

- **Uniformity over source-faithfulness**, again: GitHub's two entity types are
  surfaced through explicit, predictable tool names (`gh_trending_repos` vs
  `gh_search_issues`) rather than overloading one `*_search` — the consumer
  should never guess whether a result is a repo or an issue; `type` and the tool
  name both say so.
- **The pain-point signal is the product value** of GitHub here (D-08/D-09):
  open issues with high reaction counts are exactly the "what are developers
  frustrated by" signal `medium-blog-pro` wants for blog topics — so reactions→
  `score` must not be silently null.
- **Required-key servers are the phase's proof obligation** (criterion 4): the
  clean "set LIBRARIESIO_KEY" / "set PRODUCTHUNT_TOKEN" failure is a *feature* to
  test, not an edge case.

</specifics>

<deferred>
## Deferred Ideas

- **GitHub Discussions via GraphQL** — deferred from D-02; add later if the
  issues-only signal proves insufficient, reusing the `postJson()` GraphQL path.
- **GitHub trending via the (unofficial) trending page / third-party trending
  APIs** — rejected in favor of the Search API emulation (D-03) to stay on the
  supported, keyless-capable REST path.
- **Libraries.io per-package detail enrichment** (dependents list, SourceRank
  breakdown) beyond the contract item — revisit only if the skill needs it.
- **Product Hunt collections / makers / comments-thread depth** — beyond
  today/this-week launch lists; out of scope for this phase.

None of these are in Phase 3 scope.

</deferred>

---

*Phase: 3-Keyed Ecosystem & Launch Sources*
*Context gathered: 2026-07-02*
