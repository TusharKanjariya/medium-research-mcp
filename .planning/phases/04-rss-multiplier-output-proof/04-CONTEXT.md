# Phase 4: RSS Multiplier & Output Proof - Context

**Gathered:** 2026-07-03
**Status:** Ready for planning

> **Note on how this was gathered:** the discuss-phase area-selection question
> timed out (user away). Phase 4 is well-scoped by the ROADMAP and every decision
> below is a reversible, planner-actionable choice, so Claude captured
> **recommended defaults** for the four gray areas rather than blocking. Each
> carries a **[RECOMMENDED — revise before planning if desired]** tag. **ONE item
> genuinely needs user input — the YouTube wrapper's OCR-script logistics (D-13) —
> flagged [NEEDS CONFIRMATION].** Re-run `/gsd-discuss-phase 4` or edit this file
> to change any of them.

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
3. **YouTube→blog wrapper** (YT-01) — a structurally different **Python**,
   local-only MCP server using the async job pattern (`start_youtube_job` → id,
   `check_job_status(id)`) around an OCR/transcript step, producing blog **draft**
   material (the one output-contract exception).

**Out of scope:** any new normalized source beyond RSS; the v2 deferred sources
(Discourse SRC-10, Mastodon SRC-11, Bluesky SRC-12); `.mcpb` packaging (PKG-01,
v2); changing the output contract for the Node sources.
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

### YouTube→blog wrapper (Python, local-only)
- **D-11 [RECOMMENDED]:** **Location** — a sibling subdirectory `youtube-blog-mcp/`
  **inside this repo** (matching ARCHITECTURE §7), NOT a literal separate git repo.
  "Separate" means a separate runtime/package (Python, own `requirements.txt`,
  `FastMCP`, stdio) — kept alongside the Node servers for cohesion.
- **D-12 [RECOMMENDED]:** **Async job pattern** — `start_youtube_job(url)` returns
  a job id immediately; `check_job_status(id)` returns `queued|running|done|error`
  plus the drafted output when done. **In-memory job store** (dict keyed by id) —
  local-only single-process bursts don't need persistence across restarts;
  file-based only if that requirement emerges (it doesn't for v1).
- **D-13 [NEEDS CONFIRMATION]:** The ROADMAP/PROJECT say the wrapper "wraps an
  **existing** Tesseract OCR script," but **no such script exists in this repo.**
  Recommended default: build the **async-job MCP scaffold + a pluggable OCR/
  transcript adapter** (a clearly-marked integration point) so the job lifecycle
  is real and testable, with the actual OCR step behind an adapter the operator
  points at their Tesseract script (or a ytdlp+tesseract pipeline). **Please
  confirm:** do you have the existing OCR script to wrap (and where), should the
  phase build the full OCR pipeline, or is the scaffold+adapter the right v1 line?
- **D-14 [RECOMMENDED]:** **Output-contract exemption** — the YouTube wrapper
  produces blog **draft** material, not normalized research items (PROJECT.md
  names it "the one exception"). Its tools return job id / status / drafted text
  and are **exempt** from `{ source, query, count, results[] }`. Documented as an
  explicit, intentional exception so the contract's universality still reads true
  for the research sources.

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
- `docs/ARCHITECTURE.md` §3 — `McpServer` + `registerTool` (Node, raw Zod shapes, stdio) AND the Python side (`mcp` package, `FastMCP`, stdio) for the YouTube wrapper.
- `docs/ARCHITECTURE.md` §7 — the `youtube-blog-mcp/` layout (Python, separate, local-only, `server.py`, async job pattern).
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
- `.planning/ROADMAP.md` §"Phase 4" — goal, 4 success criteria, and the plan split (04-01 RSS · 04-02 uniform-run harness · 04-03 Python YouTube wrapper).

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
- The Python YouTube wrapper is a separate runtime (local-only) — no shared code
  with the Node servers; it is the contract exception (D-14).

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
- **Full YouTube OCR pipeline** — if D-13 is confirmed as scaffold+adapter for v1,
  the complete ytdlp+Tesseract implementation is a follow-up.

None of these are in Phase 4 scope.

</deferred>

---

*Phase: 4-RSS Multiplier & Output Proof*
*Context gathered: 2026-07-03*
