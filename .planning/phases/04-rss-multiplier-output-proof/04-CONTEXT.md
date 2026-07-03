# Phase 4: RSS Multiplier & Output Proof - Context

**Gathered:** 2026-07-03
**Status:** Ready for planning

> **Note on how this was gathered:** the discuss-phase area-selection question
> timed out (user away), so Claude captured **recommended defaults** for the four
> gray areas (each tagged **[RECOMMENDED — revise before planning if desired]**).
> **D-13 was then resolved by the user (2026-07-03):** the Python Tesseract OCR
> wrapper is **NOT built** — the user has their own OCR→draft script and runs it
> manually; the project's YouTube job is only to **surface YouTube video links +
> short explanations** (met via the RSS fetcher's YouTube recipe, D-15). This
> **drops the separate Python `youtube-blog-mcp` server** and re-scopes YT-01 —
> see D-13/D-14/D-15 and the ROADMAP-change note at the end.

<domain>
## Phase Boundary

Deliver three things (SRC-09, OUT-02, YT-01), per the ROADMAP:

1. **Generic RSS/Atom fetcher** (SRC-09) — a Node MCP server that ingests any
   feed URL (newsletters, dev blogs, and the read-only subreddit `.rss` recipe)
   and emits contract-shaped feed items with `score`/`num_comments` **null**. The
   biggest coverage-per-line multiplier. It is the project's **first
   arbitrary-URL, XML source** — new SSRF surface and a new non-JSON fetch path.
2. **5+-source uniform-run proof** (OUT-02) — demonstrate a single research run
   pulling from 5+ of the shipped sources into one uniform list the consumer
   ranks/filters with **zero per-source branches**.
3. **YouTube link surfacing** (YT-01, re-scoped 2026-07-03) — **NOT** a Python
   OCR wrapper. The user owns a local Tesseract OCR→draft script and runs it
   **manually**. This project's only YouTube job is to **surface candidate video
   links, each with a short explanation**, as normalized items the user eyeballs
   and then feeds into their own script by hand. Delivered as a **YouTube RSS
   recipe** on top of the SRC-09 fetcher (D-15) — no Python, no OCR code, no
   separate `youtube-blog-mcp` server.

**Out of scope:** the Python `youtube-blog-mcp` OCR wrapper (dropped — user runs
their own script); the OCR/draft-generation step itself (user's local tool); any
new normalized source beyond RSS; the v2 deferred sources (Discourse SRC-10,
Mastodon SRC-11, Bluesky SRC-12); `.mcpb` packaging (PKG-01, v2); changing the
output contract for the Node sources.
</domain>

<decisions>
## Implementation Decisions

### RSS fetcher: SSRF hardening (the critical new surface)
Every prior server fetched a **fixed** (HN/GitHub/Libraries.io/Product Hunt) or
**operator-set** (Lemmy `LEMMY_INSTANCE`) host — untrusted tool input never chose
the outbound host. `rss_fetch(url)` breaks that: the **feed URL comes from tool
input**, so SSRF is a first-class threat (internal services, cloud metadata
`169.254.169.254`, `file://`, loopback).

- **D-01 [RECOMMENDED]:** **Scheme allowlist** — accept `http` and `https` only;
  reject `file:`, `ftp:`, `gopher:`, `data:`, and everything else with a clear
  error.
- **D-02 [RECOMMENDED]:** **Private-range denylist** — resolve the host and reject
  loopback (`127.0.0.0/8`, `::1`), private (`10/8`, `172.16/12`, `192.168/16`),
  link-local incl. cloud-metadata (`169.254.0.0/16`, esp. `169.254.169.254`),
  CGNAT (`100.64/10`), and IPv6 ULA (`fc00::/7`). Applies to the initial host
  **and every redirect hop** (DNS-rebinding / redirect-to-internal guard) — the
  fetch path must re-validate on redirect, not blindly follow. *(Redirect
  re-validation is a researcher/planner detail — flagged so it isn't missed.)*
- **D-03 [RECOMMENDED]:** **Optional operator allowlist** — `RSS_ALLOWED_HOSTS`
  (comma-separated hostnames) via `credentials.js`. When set, only those hosts are
  fetchable (lock-down mode); when unset, default is public-internet minus the
  D-02 denylist. Keeps the tool usable by default while giving cautious operators
  a hard fence.

### RSS fetcher: tool surface & item mapping
- **D-04 [RECOMMENDED]:** **Single `rss_fetch(url, limit?)` list tool** returning
  the contract list envelope. **Deliberate deviation from the `*_hot`/`*_search`/
  `*_get` trio**: RSS has exactly one operation (fetch a feed), items carry their
  own content, and there is no per-item detail endpoint — so **no `*_get`** and
  **no `*_search`** (there is no corpus to search; the "query" is the feed URL
  itself). Justified and documented in the tool description.
- **D-05 [RECOMMENDED]:** Item mapping — `type: "article"` (already in the shared
  TYPE enum — **no enum extension needed**), `title`/`author`/`created_utc`/`url`/
  `permalink`/`tags`(categories)/`text`(description or `content:encoded`,
  HTML-stripped) from the feed entry; **`score` = null, `num_comments` = null**
  (ARCHITECTURE §5). Handle **both RSS 2.0** (`rss>channel>item`) **and Atom 1.0**
  (`feed>entry`). `query` in the envelope = the feed URL (or feed title).
- **D-06 [RECOMMENDED]:** **Subreddit `.rss` = a documented recipe, not a tool** —
  call `rss_fetch("https://www.reddit.com/r/<sub>/.rss")` (or `/.rss?sort=top`).
  Documented in the tool description + README; this is how read-only Reddit
  coverage is recovered (replacing the dropped Reddit OAuth path).

### RSS fetcher: XML fetch path & parsing
- **D-07 [RECOMMENDED]:** Add a shared **`getText(url, opts)`** to
  `shared/http_client.js`, reusing the exact cache + retry/backoff + stale-fallback
  plumbing as `getJson`/`postJson` but returning the **raw response text** (no
  `JSON.parse`). Servers still never call `fetch` directly (CLAUDE.md). The SSRF
  host/redirect validation (D-01/D-02) lives on this fetch path so it protects any
  future text source too.
- **D-08 [RECOMMENDED]:** **Parse feeds with a single lightweight, zero-transitive-
  dependency XML parser** (candidate: `fast-xml-parser` — MIT, no deps) plus a
  **hand-written normalize layer** that maps RSS 2.0 and Atom 1.0 onto the item
  schema. Rationale: robust XML parsing (CDATA, namespaces, entities, both feed
  dialects, quirky subreddit `.rss`) is error-prone to hand-roll; the project
  already carries `sdk` + `zod`, and a no-sub-dependency parser is the right tool
  without a real supply-chain cost. *(Exact package + zero-transitive-dep
  confirmation is a researcher task; hand-roll remains the fallback if no
  acceptable dep exists.)*

### OUT-02: the 5+-source uniform-run proof
- **D-09 [RECOMMENDED]:** The proof is an **automated integration test**
  (`node:test`, e.g. `test/uniform-run.test.js`) that feeds recorded fixtures from
  **5+ shipped sources** (e.g. HN, Stack Exchange, Lobsters, Dev.to, GitHub, RSS)
  through **one generic merge/rank/filter code path with ZERO `if (source === …)`
  branches**, asserting every merged item carries the full contract item schema
  and that ranking (by `score`, nulls last) and filtering work source-agnostically.
- **D-10 [RECOMMENDED]:** Use **recorded fixtures, not live network**, for the CI
  assertion (deterministic, offline — reuse each server's existing test fixtures).
  Additionally ship a **runnable example** (`examples/uniform-run.mjs`) that hits
  live sources for a real demo — the live run is a documented manual smoke (like
  the Phase 3 keyed smokes), not a CI gate.

### YouTube (re-scoped — link surfacing only, NO Python OCR wrapper)
- **D-13 [RESOLVED by user 2026-07-03]:** **The Python `youtube-blog-mcp` OCR
  wrapper is DROPPED.** The user already has a local Tesseract OCR→draft script
  and will run it **manually** on chosen links. This phase builds **no Python
  server, no async-job scaffold, and no OCR/transcript code.** (Supersedes the
  earlier ARCHITECTURE §7 `youtube-blog-mcp/` plan and the original YT-01
  wording.)
- **D-14 [RESOLVED]:** The project's YouTube deliverable is **surfacing candidate
  video links with a short explanation each** — normalized items (url = watch
  link, title, `text` = video description, author = channel) the user reviews and
  then hand-feeds into their own OCR/draft script. No output-contract exception is
  needed anymore, because YouTube is now just normal contract-shaped RSS output
  (not a draft-producing wrapper).
- **D-15 [RECOMMENDED]:** **Delivery = a YouTube RSS recipe on the SRC-09 fetcher**
  (same pattern as the subreddit `.rss` recipe, D-06): call `rss_fetch(
  "https://www.youtube.com/feeds/videos.xml?channel_id=<ID>")` (or the
  `?playlist_id=<ID>` variant) → each recent video maps to a contract item with
  the watch URL, title, description (→ `text`, HTML-stripped), channel (→ author),
  publish time; `score`/`num_comments` null. Documented in the tool description +
  README as the "YouTube channel/playlist" recipe.
  - **Known limitation (documented):** YouTube RSS is **per-channel/playlist, not
    keyword search** (YouTube retired the search RSS feed). Keyword-search-across-
    YouTube would require the YouTube Data API key — **out of the keyless scope
    and not built.** The user supplies channel/playlist IDs (or a channel's
    `youtube.com/@handle` → resolve to `channel_id`).

### Claude's Discretion
- Exact `getText` signature and redirect-validation mechanism, the chosen XML
  parser + normalize function names, RSS-vs-Atom field-precedence details,
  `rss_fetch` page-size/limit defaults, the uniform-run merge/rank helper name and
  fixture set selection, and the Python job-id scheme / FastMCP tool names — all
  planner/executor calls, provided the SSRF guards (D-01/D-02), the output
  contract for `rss_fetch`, and the async job pattern hold.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Output contract & MCP layer (linchpin)
- `docs/ARCHITECTURE.md` §4 — list/detail envelopes + item schema; `score`/`num_comments` may be null but never renamed/dropped.
- `docs/ARCHITECTURE.md` §5 — RSS/Atom row: `score` null, `num_comments` null, `feed URLs`, no auth.
- `docs/ARCHITECTURE.md` §3 — `McpServer` + `registerTool` (Node, raw Zod shapes, stdio). *(The Python/FastMCP side is no longer used — D-13 dropped the Python wrapper.)*
- `docs/ARCHITECTURE.md` §7 — the `youtube-blog-mcp/` layout is **superseded** (D-13); ignore it. YouTube is now a Node RSS recipe (D-15).
- `docs/ARCHITECTURE.md` §8 — cache ~15 min, retry 0.5s/1s/2s, never retry 4xx, stale fallback (the plumbing `getText` must reuse).

### The reference implementation to copy / extend
- `servers/hn/server.js` and `servers/stackexchange/server.js` — the Node server template + optional-param passthrough shape.
- `shared/contract.js` — `buildListEnvelope`/`normalizeItem`/`stripHtml`/`toolResult` + raw Zod shapes; `TYPE` already includes `article` (no extension needed for RSS).
- `shared/http_client.js` — `getJson`/`postJson`; **`getText` is added here (D-07)**, reusing the same cache/retry/stale internals and hosting the SSRF host/redirect validation.
- `shared/credentials.js` — add `RSS_ALLOWED_HOSTS` here (D-03) via the `ENV_VAR` single-source-of-truth pattern; never read `process.env` elsewhere.
- Each server's `test/*.test.js` + `test/fixtures/*.json` — the fixture pattern the OUT-02 uniform-run test (D-09/D-10) reuses.

### Process & requirements
- `docs/ARCHITECTURE.md` §6 + `CLAUDE.md` — never `fetch` directly / never `process.env` outside `credentials.js`; SSRF precedent (Lemmy `lemmyInstance` is operator-set env, not tool input — RSS is the opposite and needs D-01/D-02).
- `docs/server-spec-template.md` — per-server spec + Universal Server Bar the RSS fetcher must satisfy (criterion 4).
- `.planning/REQUIREMENTS.md` — SRC-09, OUT-02, YT-01 (the Phase 4 set).
- `.planning/ROADMAP.md` §"Phase 4" — goal + success criteria. **Plan split revised (D-13): 04-01 RSS fetcher incl. the subreddit + YouTube recipes · 04-02 5+-source uniform-run proof. The former 04-03 Python YouTube wrapper is dropped.** (ROADMAP/REQUIREMENTS YT-01 text needs updating — see the note at the end of this file.)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `shared/http_client.js`: `getJson`/`postJson` share a cache+retry+stale core;
  `getText` (D-07) is a thin sibling returning raw text — reuse, don't fork.
- `shared/contract.js`: `stripHtml` handles the HTML in RSS `description`/
  `content:encoded`; `type:"article"` already valid → RSS needs no enum change.
- `servers/devto/server.js`: precedent for `type:"article"` mapping.
- Every `test/fixtures/*.json`: the recorded-fixture corpus the OUT-02 uniform-run
  test (D-09) merges through one branch-free code path.

### Established Patterns
- Node server: `getJson/postJson` → `map*()` → `buildListEnvelope` →
  `toolResult`; direct-run guard; `node:test` units over fixtures. RSS follows it
  (via `getText` + an XML normalize step).
- Credential/host safety: operator-set env (never tool input) chooses hosts —
  RSS inverts this, hence the D-01/D-02/D-03 SSRF controls layered on `getText`.

### Integration Points
- Output consumed by the `medium-blog-pro` skill — the RSS items must be
  rank/filterable with zero source-specific logic, and OUT-02 is the explicit
  proof of exactly that across 5+ sources.
- YouTube needs **no new code** beyond a documented `rss_fetch` recipe (D-15) —
  it reuses the RSS fetcher entirely. The user's own local OCR/draft script is
  outside this repo and run manually on the surfaced links.

</code_context>

<specifics>
## Specific Ideas

- **SSRF is the headline risk of this phase** — the RSS fetcher is the first place
  untrusted tool input selects the outbound host. D-01/D-02/D-03 must be real,
  tested controls (private-range + redirect re-validation), not a comment.
- **RSS is the coverage multiplier** — one `rss_fetch` tool unlocks arbitrary
  newsletters, dev blogs, and (via D-06) read-only subreddits, which is why it's
  worth a dependency for robust parsing (D-08).
- **OUT-02 is the project's thesis, proven** — the whole point of the normalized
  contract is a branch-free multi-source merge; D-09 makes that an executable
  assertion, not a claim.

</specifics>

<deferred>
## Deferred Ideas

- **RSS `*_search`/`*_get`** — intentionally omitted (D-04); revisit only if the
  consumer needs client-side filtering over a fetched feed window (D-01 pattern).
- **Feed persistence / polling / change-detection** — out of scope; cached bursts
  suffice (project constraint: no real-time/streaming).
- **v2 sources** — Discourse (SRC-10), Mastodon (SRC-11), Bluesky (SRC-12) remain
  deferred to a later milestone.
- **`.mcpb` packaging (PKG-01)** — per-server bundles deferred to v2.
- **YouTube OCR/draft generation** — permanently the user's own local Tesseract
  script, run manually; this project never builds it (D-13).
- **Keyword YouTube search** (YouTube Data API) — out of the keyless scope; the
  user supplies channel/playlist feed IDs (D-15).

None of these are in Phase 4 scope.

</deferred>

---

## ⚠ ROADMAP / REQUIREMENTS change required (from D-13)

The user's 2026-07-03 decision **drops the Python YouTube→blog wrapper**. Before
or during planning, update the planning docs to match (e.g. via `/gsd-phase` /
`/gsd-new-milestone` tooling, not a silent edit):

- **REQUIREMENTS.md YT-01** — re-scope from "YouTube→blog wrapper (Python, async
  job pattern, wraps Tesseract OCR)" to "Surface YouTube video links + short
  explanations via the RSS fetcher's YouTube channel/playlist recipe (SRC-09);
  OCR/draft generation is the user's own local, manual step — out of scope."
- **ROADMAP.md Phase 4** — success criterion 3 (Python wrapper / async job
  pattern) is removed; plan `04-03` is dropped. Phase 4 = RSS fetcher (with
  subreddit + YouTube recipes) + the 5+-source uniform-run proof.
- **PROJECT.md** — the "YouTube wrapper is the one output-contract exception" note
  no longer applies; remove or soften it (no exception remains — YouTube is
  normal RSS output).

*Phase: 4-RSS Multiplier & Output Proof*
*Context gathered: 2026-07-03*
