# Phase 2: Keyless Source Breadth - Context

**Gathered:** 2026-07-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver five source servers — **Stack Exchange** (network-wide via a `site`
param, optional key), **Lobsters**, **Lemmy**, **Hashnode**, **Dev.to** —
covering SRC-01..05. Each is a mechanical copy of the Phase 1 HN pattern: a
field-map + URL/query construction on top of the shared modules
(`getJson`, `buildListEnvelope`/`buildDetailEnvelope`, `toolResult`,
`credentials.js` helpers, `auth.js`). The point of the phase is to prove that
adding a source reduces to field-mapping and that the output contract holds
across very different payloads (REST, GraphQL, federated, no-search). Lemmy
additionally exercises the `auth.js` username/password path end-to-end.

Out of scope: keyed sources (GitHub/Libraries.io/Product Hunt = Phase 3), the
RSS multiplier + YouTube wrapper (Phase 4), and any new source not in SRC-01..05.
</domain>

<decisions>
## Implementation Decisions

### Search on sources without native full-text search
- **D-01:** Every source exposes a working `*_search` tool for a **uniform tool
  surface**. Where the source has no real full-text search (Dev.to; Lobsters'
  search is weak), `*_search` does **client-side filtering**: fetch a recent/top
  page via the source's list endpoint, then substring-match the query against
  `title` + `tags` + `text`, returning contract items. **Documented caveat:** it
  only matches within the fetched window (not the full corpus) — note the window
  size in the tool description so the consumer/skill knows the limitation.
  Sources with native search (Stack Exchange, Hashnode GraphQL) use it directly.

### Stack Exchange site & tool surface
- **D-02:** Tool names stay **`so_hot_questions` / `so_search` / `so_get_question`**
  (fixed by the ROADMAP success criteria), even though the server is network-wide.
- **D-03:** `site` param **defaults to `stackoverflow`** and is a **free
  passthrough** — any site string is forwarded to the SE API, which validates it
  and returns a clear error for unknown sites. No local whitelist to maintain.
- **D-04:** Use the existing `stackExchangeParams()` helper — include
  `STACKEXCHANGE_KEY` when present (higher quota), run keyless otherwise
  (graceful degradation, CRED-04). (SE bodies require a `filter` to be returned —
  planner/researcher detail, but flagged here so `text` isn't silently empty.)

### Lemmy instance & auth
- **D-05:** Anonymous public reads default to instance **`programming.dev`**
  (dev-topic relevance) with listing type **`All`** (federated) so results reach
  beyond that instance's local communities. Overridable via `LEMMY_INSTANCE`.
- **D-06:** When `LEMMY_*` creds are present, auto-authenticate via
  `auth.js` `lemmyJwt()` and send the jwt as `Authorization: Bearer <jwt>` on
  reads — this is the end-to-end exercise of the Phase 1 auth path required by
  the phase goal. Absent creds → anonymous reads (no hard error).

### 'Trending' / hot semantics
- **D-07:** Each source's hot/trending tool defaults to that API's **native
  trending** notion, with optional `sort`/time params to override:
  SE `so_hot_questions` → hot (default) / votes; Dev.to → top of the past week;
  Hashnode → its trending feed; Lobsters → hottest. Least-surprising per-source
  behavior rather than one forced global ordering.

### Carried forward from Phase 1 (not re-decided)
- Output contract enforced by the shared module (D-01/D-02 of Phase 1): every
  server is pure field-mapping into `normalizeItem()`; reuse the same Zod raw
  shapes as `registerTool` output schemas.
- **Detail = top-level comments only** (HN precedent). For SE, map **answers →
  `comments[]`** and answer count → `num_comments`; for Lemmy/Hashnode/Dev.to
  flatten the top level of the comment/response tree, not the nested replies.
- `node:test` + `node:assert` harness (D-06 Phase 1); single root `package.json`
  (D-07 Phase 1); fetch only through `getJson()`; never read `process.env`
  outside `credentials.js`.

### Claude's Discretion
- Exact `normalize*`/field-map function names per server, URL/query builders, SE
  `filter` id selection to surface body text, GraphQL query strings for Hashnode,
  Dev.to page size for the client-side search window, and Lemmy sort enum values —
  all planner/executor calls, provided the contract (ARCHITECTURE §4) and §5
  per-source `score`/`num_comments` meaning hold.
- Per-source `type` enum mapping (SE question→`question`, Lobsters→`story`/`article`,
  Dev.to/Hashnode→`article`, Lemmy→`post`) following ARCHITECTURE §4/§5.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Output contract & MCP layer (linchpin)
- `docs/ARCHITECTURE.md` §4 — list/detail envelopes + item schema; `score`/`num_comments` may be null but never renamed/dropped.
- `docs/ARCHITECTURE.md` §5 — per-source `score`/`num_comments` meaning: Stack Exchange (votes / answers), Lobsters (upvotes / comments), Lemmy (score / comments), Hashnode (reactions / responses), Dev.to (reactions / comments), and each source's API + auth.
- `docs/ARCHITECTURE.md` §3 — `McpServer` + `registerTool` with raw Zod shapes, stdio; return both `structuredContent` and JSON-text `content`.
- `docs/ARCHITECTURE.md` §8 — cache ~15 min, retry 0.5s/1s/2s, never retry 4xx, stale fallback.

### The reference implementation to copy
- `servers/hn/server.js` — the canonical server template (field-map + URL build + shared factories + dual return). Copy its structure.
- `shared/contract.js` — `buildListEnvelope`/`buildDetailEnvelope`/`normalizeItem`/`stripHtml`/`toolResult` + raw shapes. Do NOT re-implement.
- `shared/http_client.js` — `getJson()` (all HTTP goes through it).
- `shared/credentials.js` — `stackExchangeParams()` (optional SE key), `lemmyCreds()`, `userAgent()`.
- `shared/auth.js` — `lemmyJwt()` cached-token path for the Lemmy auth exercise.

### Credentials & process
- `docs/ARCHITECTURE.md` §6 — credential helpers + graceful vs required rules (SE key optional → keyless fallback; CRED-04).
- `CLAUDE.md` — "how to add a new server" steps, output-contract "DO NOT BREAK", never-`fetch`/never-`process.env` rules.
- `docs/server-spec-template.md` — the per-server spec + Universal Server Bar acceptance checklist each of the five servers must satisfy.
- `.planning/REQUIREMENTS.md` — SRC-01..05 (the Phase 2 requirement set).
- `.planning/ROADMAP.md` §"Phase 2" — goal, 5 success criteria, and the plan split (02-01 Stack Exchange · 02-02 Lobsters+Lemmy · 02-03 Hashnode+Dev.to).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `servers/hn/server.js`: the template — every Phase 2 server mirrors its shape;
  only the field-map (`mapHnHit`/`mapHnItem` analogues) and URL/query change.
- `shared/contract.js`: factories + raw Zod shapes make each server pure
  field-mapping; HTML stripping is centralized in `stripHtml`.
- `shared/credentials.js`: `stackExchangeParams()` already returns `{key}` or `{}`
  for the optional-key path; `lemmyCreds()` gates auth; `userAgent()` for outbound.
- `shared/auth.js`: `lemmyJwt()` already implements the cached login exchange —
  Phase 2 wires its returned jwt into Lemmy read headers.
- `servers/hn/manifest.json`: `.mcpb` manifest shape to copy per server.

### Established Patterns
- Handler shape: `getJson(url)` → `map*()` → `buildListEnvelope`/`buildDetailEnvelope`
  → `toolResult(env)`; `registerTool` takes raw Zod shapes (SDK 1.29 — not `z.object`).
- Direct-run guard (`import.meta.url === pathToFileURL(process.argv[1]).href`) so
  importing a server for tests doesn't open a live stdio transport.
- Tests: `node:test` units over mock/fixture payloads for each `map*()` helper
  plus a "tools register / declare outputSchema" check.

### Integration Points
- Output consumed by the `medium-blog-pro` skill — all five servers must be
  rankable/filterable with zero source-specific logic (OUT-01).

</code_context>

<specifics>
## Specific Ideas

- Uniformity is the priority: the consumer wants a working `*_search` on every
  source even when the API lacks real search — hence the client-side-filter
  decision (D-01), with the window limitation stated honestly in the tool description.
- Lemmy is the auth proof for the phase: getting an authenticated read working
  against `programming.dev` validates the Phase 1 `auth.js` path in production.

</specifics>

<deferred>
## Deferred Ideas

- **Full-corpus search / pagination cursors** for client-side-filtered sources —
  if the fetched-window limitation of D-01 proves too narrow, a paged/iterative
  search could be added later; out of scope for this phase.
- **Dedicated Reddit `.json` source server** — still deferred (Phase 1 note);
  read-only Reddit coverage is planned via the RSS `.rss` recipe in Phase 4.
- **Additional Stack Exchange convenience (site discovery tool, tag browsing)** —
  beyond the three roadmap-fixed tools; revisit only if needed.

None of these are in Phase 2 scope.

</deferred>

---

*Phase: 2-Keyless Source Breadth*
*Context gathered: 2026-07-02*
