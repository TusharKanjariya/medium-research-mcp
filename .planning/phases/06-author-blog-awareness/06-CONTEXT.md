# Phase 6: Author-Blog Awareness - Context

**Gathered:** 2026-07-14
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase makes the suite **writer-aware**: any agent can read a chosen author's
Medium / Substack / raw-feed posts in the normalized contract — the author is
**always a tool parameter** — with **honest coverage windows** and documented
dedup/cadence recipes. Delivers ABLOG-01..05.

The new tools live **inside `servers/rss`** (not a sibling server), reusing the
shipped `parseFeed` / `normalizeFeed` / `mapRssItem` / `textOf` pipeline. A sibling
server would either duplicate the parser or invert the `servers/* → shared/*`
dependency direction (roadmap + research decision).

**In scope:**
- ABLOG-01 — fetch an author's recent posts by author parameter (Medium `@user`,
  Substack publication, or raw feed URL) in the normalized contract, HTML-stripped
  full text + tags.
- ABLOG-02 — honest, visible coverage window: `count` + per-item `created_utc` in
  output, and tool descriptions that explicitly state the feed caps (~10 Medium,
  ~20 Substack) and paywall truncation.
- ABLOG-03 — list a Substack publication's full archive via the unofficial
  `/api/v1/archive` JSON (fills `score`/`num_comments` from reactions/comments);
  degrades to the RSS window on failure, never hard-errors.
- ABLOG-04 — fetch posts by tag/keyword on platforms with tag feeds (Medium
  `feed/tag/<tag>`), tag as a tool parameter.
- ABLOG-05 — documented recipes for posting-cadence tracking and series/follow-up
  detection from normal tool output (docs only, no new tool logic).

**Not in this phase:** Discourse/Mastodon servers + Lemmy parameterization (Phase 7),
`.mcpb`/npm packaging (Phase 8). No new runtime dependencies — everything is the
existing `fast-xml-parser` RSS pipeline plus one keyless guarded JSON GET (Substack
archive).

**Coordination point (shared file):** the Medium 403 mitigation lives in
`shared/http_client.js`. NOTE — the browser-plausible identified User-Agent
**already exists** (`getText` merges `User-Agent: userAgent()` =
`medium-research-mcp/1.0 (+github…)`, `shared/credentials.js:79`). The only shared
touch this phase needs is (a) optionally bump the version string to `1.1`, and
(b) map a Medium 403 / anti-bot response to a **clear tool-level error** rather than
a generic HTTP failure — no new guard, no per-verb retry-policy fork.

</domain>

<decisions>
## Implementation Decisions

### Tool surface (ABLOG-01/03/04)
- **D-01:** Add **three focused tools** to `servers/rss`, alongside the existing
  `rss_fetch`:
  - `rss_author_posts(author, query?, published_before?)` — ABLOG-01/02
  - `rss_tag_posts(tag)` — ABLOG-04
  - `rss_substack_archive(publication)` — ABLOG-03
  This deliberately relaxes the current "single-tool rss server" comment. Each tool
  is single-responsibility; the extra MCP surface is the accepted cost of clarity
  over a dense polymorphic schema (mirrors Phase 5's D-14/D-15 preference for
  explicit, self-documenting tools over param-inferred modes). Update the
  `rss_fetch` "SINGLE-TOOL DESIGN (deliberate)" note so it no longer claims the
  server exposes only `rss_fetch`.

### Author parameterization (ABLOG-01)
- **D-02:** **Single smart `author` field** — no explicit `platform` enum. The
  server infers the platform from the string's shape. This is the one place the
  phase intentionally departs from Phase 5's "never infer" posture (D-15): the
  author string is a natural, unambiguous identifier for a human agent to supply,
  and the three shapes are mutually distinguishable without guessing intent.
- **D-03:** **Inference table (document it in the tool description):**
  - Starts with `@` (e.g. `@ev`) → Medium profile feed
    `https://medium.com/feed/@<user>`
  - Contains `substack.com` (bare `pub.substack.com` or a full Substack URL) →
    Substack feed `https://<pub>.substack.com/feed`
  - Any other `http(s)://…` → treated as a **raw feed URL**, passed to `getText`
    as-is (same path as `rss_fetch`)
  - A bare token with no `@`, no `substack.com`, and no scheme is **ambiguous** →
    return a clear tool-level error asking for one of the three explicit forms.
    Do NOT guess a host (guessing a host is a mild SSRF/typo footgun and violates
    the keyless-explicit premise).
- **D-04:** `query?` (keyword filter over title/teaser) and `published_before?`
  (ISO date, filter on `created_utc`) are optional selection params on
  `rss_author_posts`, applied **after** the feed is fetched and normalized — the
  feed window is fixed by the platform, these only narrow what's returned.

### Coverage-window honesty (ABLOG-02)
- **D-05:** **Honest windowing from day one.** Tool descriptions state the hard caps
  explicitly: "Medium feeds return at most the ~10 most recent posts; Substack ~20;
  older history is not reachable keylessly (except a Substack publication's full
  archive via `rss_substack_archive`)." `count` + per-item `created_utc` are already
  contract fields — no new field. Never present a 10-item Medium window as an
  author's full history.

### Paywall / preview truncation signal (ABLOG-02)
- **D-06:** **Surface preview-only posts via a `tags[]` marker, NOT a new contract
  field and NOT inline text pollution.** When a paywall/truncation marker is
  detected (Substack's trailing "Read more"; Medium member-only abstract-only
  items), append the literal tag **`preview-only`** to the item's `tags[]`. This is
  machine-readable for the consuming `medium-blog-pro` skill and keeps `text` clean
  (the skill may cite `text` verbatim). The contract stays frozen — `tags` is an
  existing field.
- **D-07:** Detect truncation heuristically: Substack items whose text ends with a
  "Read more" marker; Medium items that are member-only / abstract-only. Feed `text`
  is **teaser-quality** and must be treated as such by any dedup/cadence recipe.

### Substack archive enrichment (ABLOG-03) — IN SCOPE this phase
- **D-08:** Ship `rss_substack_archive(publication)`. It calls the unofficial
  `https://<pub>.substack.com/api/v1/archive` JSON endpoint. The publication host is
  **user-supplied tool input**, so this MUST use the Phase 5 guarded JSON path:
  `getJson(url, { untrustedHost: true })` (SSRF guard + content-type check). This is
  exactly the reuse Phase 5's SEC-01 was built to enable.
- **D-09:** **Enrichment:** map archive reactions → `score` and comment count →
  `num_comments` (both currently `null` on RSS-window items). Same frozen item
  schema — just fills existing fields the RSS path can't.
- **D-10:** **Graceful degrade (AC3):** on ANY archive failure (endpoint gone,
  non-JSON login page caught by the D-03 content-type gate, throttle) the tool
  **falls back to the RSS window** (`<pub>.substack.com/feed`) and returns that —
  it never hard-errors. Treat archive breakage as *expected*, not a bug (undocumented
  endpoint; research LOW-confidence tier).

### Tag feeds (ABLOG-04)
- **D-11:** `rss_tag_posts(tag)` is **Medium-only in v1.1** — Medium's
  `https://medium.com/feed/tag/<tag>` is the only keyless public tag feed among the
  supported platforms. Document this explicitly in the tool description ("tag feeds
  are Medium-only; Substack/raw feeds have no keyless tag endpoint"). No `platform`
  param is needed precisely because only one platform qualifies — consistent with
  the single-smart-field philosophy (D-02).

### Dedup / cadence recipes (ABLOG-05) — docs only
- **D-12:** Provide the recipes in **BOTH places**: concise recipe pointers embedded
  in the relevant tool descriptions (mirroring `rss_fetch`'s existing `RECIPE —`
  blocks), AND a fuller standalone `docs/AUTHOR-BLOG-RECIPES.md` with the worked
  cadence-tracking and series/follow-up-detection recipes. Tool descriptions stay
  scannable; the docs file carries the detail.
- **D-13:** Recipes operate on **normal tool output only** (`created_utc` for
  cadence; `title` + teaser for series/follow-up detection) and must be written to
  **tolerate teaser-quality text and the ~10/~20 windows** — explicitly warn that
  cadence over a Medium feed reflects only the last ~10 posts, not lifetime cadence.
  No new tool logic, no scraping, no cookie/subscription workarounds.

### Medium 403 handling (shared coordination)
- **D-14:** Map a Medium 403 / anti-bot response to a **clear tool-level error**
  ("Medium is blocking automated fetches from this network; the feed may still work
  from another network") instead of a generic HTTP failure. Keep the strict
  no-4xx-retry policy — do NOT add a retry loop around the browser UA (that behaves
  like the bot it's pretending not to be). The identified UA already exists; only the
  error mapping (and an optional `1.0 → 1.1` version bump) is new.

### Claude's Discretion
- Exact tag string for preview detection is `preview-only` (D-06); the planner may
  refine the *detection heuristics* (D-07) provided the marker surfaces in `tags[]`.
- Field-name mapping details for the Substack archive JSON (which archive keys hold
  reaction/comment counts) are left to the researcher/planner to confirm against a
  live probe — the *contract mapping* (reactions→`score`, comments→`num_comments`) is
  locked.
- The ambiguous-bare-token error wording (D-03) and the precise `docs/` filename
  (D-12) are the planner's to finalize.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone research (already written for v1.1 — read first)
- `.planning/research/SUMMARY.md` §"Phase 2: Author-blog tools (rss server
  extension)" — this phase's approach, the "zero new runtime deps" verdict, and the
  rss-server-extension (not sibling server) decision
- `.planning/research/PITFALLS.md` §Pitfall 1 — Medium bot-blocking vs the
  no-4xx-retry policy (source of D-14; the UA + 403-mapping guidance)
- `.planning/research/PITFALLS.md` §Pitfall 2 — dedup/cadence on truncated paywalled
  text (source of D-05/D-06/D-07/D-13; treat feed `text` as teaser-quality)
- `.planning/research/PITFALLS.md` §"Looks Done But Isn't" — the paid-Medium-author
  + paywalled-Substack verification checklist for this phase
- `.planning/research/PITFALLS.md` §"Integration Gotchas" (Medium/Substack rows) and
  §"Recovery Strategies"

### The code being extended
- `servers/rss/server.js` — `parseFeed`, `normalizeFeed`, `mapRssItem`,
  `mapAtomEntry`, `textOf`, `pickAlternate`; the existing `rss_fetch` registration
  and its `SINGLE-TOOL DESIGN` note (update per D-01); reuse the parser, add three
  tools
- `shared/http_client.js` — `getText` (author/tag feeds; UA already merged here) and
  `getJson(url, { untrustedHost: true })` (Substack archive, D-08); the `assertSafeUrl`
  guard + content-type gate (D-03 from Phase 5) the archive call rides
- `shared/credentials.js:75-81` — `userAgent()` default (D-14 version-bump touch point)
- `shared/contract.js` — frozen item schema; `score`/`num_comments`/`tags` are the
  existing fields D-06/D-09 fill; `buildListEnvelope` / `normalizeItem` / `toolResult`
  (no envelope hand-rolling); append-only `TYPE` enum

### Prior-phase context that carries forward
- `.planning/phases/05-guarded-json-path-trending-signals/05-CONTEXT.md` §D-01/D-02/D-03
  — the guarded JSON path + content-type check `rss_substack_archive` depends on;
  the frozen-contract discipline (OQ-1) this phase inherits verbatim

### Requirements / roadmap
- `.planning/REQUIREMENTS.md` — ABLOG-01..05 (verbatim acceptance criteria)
- `.planning/ROADMAP.md` §"Phase 6: Author-Blog Awareness" — goal + 5 success criteria

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`parseFeed` / `normalizeFeed` / `mapRssItem` / `mapAtomEntry` / `textOf`
  (`servers/rss/server.js`)** — the entire RSS→contract pipeline already exists;
  author + tag tools are new `registerTool` blocks that call `getText` and reuse
  these. `textOf` already handles the WR-01 `content:encoded` / `dc:creator`
  object-collapse — Medium/Substack CDATA bodies go through it unchanged.
- **`getText` (`shared/http_client.js`)** — SSRF-guarded, UA-defaulted, cached,
  retry+stale text fetch. Author/tag feeds use it directly (fixed shapes, D-03).
- **`getJson(url, { untrustedHost: true })` (`shared/http_client.js`)** — the Phase 5
  guarded JSON path; `rss_substack_archive`'s user-supplied host rides it (D-08),
  and the D-03 content-type gate turns a Substack login-HTML-200 into the graceful
  RSS fallback (D-10) instead of a `JSON.parse` crash.
- **`buildListEnvelope` / `normalizeItem` / `toolResult` (`shared/contract.js`)** —
  every tool maps fields then uses these; no envelope hand-rolling.

### Established Patterns
- **Single fetch chokepoint** — all HTTP through `shared/http_client.js`; author
  tools stay on `getText`, archive on guarded `getJson`. Never call `fetch` directly.
- **Frozen output contract** — new writer signals (reactions, comments, preview
  state) ride existing fields (`score`, `num_comments`, `tags`); zero schema change.
- **`rss_fetch` RECIPE-block description style** — the model for D-12's in-description
  recipes and the honest-window caveats (D-05).

### Integration Points
- `servers/rss/server.js` gains three `registerTool` blocks + one `docs/` file; the
  only shared-file touch is the D-14 403-error mapping / optional UA version bump in
  `shared/http_client.js` + `shared/credentials.js`.
- Offline tests should cover: platform inference table (D-03) incl. the ambiguous
  reject; a paywalled Substack fixture (trailing "Read more" → `preview-only` tag,
  D-06); a Medium member-only abstract fixture; a Substack archive JSON fixture AND
  an archive-failure → RSS-fallback fixture (D-10); an SSRF reject
  (`127.0.0.1`/`169.254.169.254`) on the archive host.

</code_context>

<specifics>
## Specific Ideas

- **Verify against a PAID Medium author and a PAYWALLED Substack**, not just free
  ones — the truncation markers (D-07) and `preview-only` tag (D-06) only appear on
  paid content. This is on the research "Looks Done But Isn't" checklist.
- **The Substack archive endpoint is undocumented (LOW-confidence tier)** — the plan
  must synthesize both a success fixture and a failure fixture, and the failure path
  (D-10) is the *expected* case, tested first-class.
- **`preview-only`** is the exact tag string (D-06) so the consuming skill can match
  it deterministically.
- **Cadence recipe honesty (D-13):** the docs recipe must lead with "this reflects
  only the ~10 most recent Medium posts / ~20 Substack" so a reader never concludes
  "the author slowed down" from a windowed feed.

</specifics>

<deferred>
## Deferred Ideas

- **Non-Medium tag feeds** — Substack/other-platform tag or keyword feeds have no
  keyless public endpoint; `rss_tag_posts` is Medium-only in v1.1 (D-11). Revisit if
  a keyless tag endpoint appears.
- **Semantic / embedding-based dedup index** — v1.1 dedup stays title+teaser
  heuristic (docs recipe, D-13). A vector dedup index is explicitly a v2+ anti-feature
  per `SUMMARY.md`.
- **Medium/Substack stats scraping & post publishing** — no keyless API; `score: null`
  is contract-legal. v2+ anti-features (`SUMMARY.md`).
- **Cookie/subscription workarounds to read full paywalled bodies** — out of scope
  and against the keyless premise; never attempt.

None of the above blocks Phase 6. Discussion stayed within the ABLOG-01..05 boundary.

</deferred>

---

*Phase: 6-Author-Blog Awareness*
*Context gathered: 2026-07-14*
