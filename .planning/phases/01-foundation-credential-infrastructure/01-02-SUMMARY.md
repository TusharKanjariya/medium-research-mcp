---
phase: 01-foundation-credential-infrastructure
plan: 02
subsystem: api
tags: [mcp, hackernews, algolia, zod, node-test, output-contract]

# Dependency graph
requires:
  - phase: 01-01
    provides: shared/contract.js (normalizeItem/buildListEnvelope/buildDetailEnvelope/toolResult + raw shapes) and shared/http_client.js (getJson)
provides:
  - Hacker News reference server (servers/hn/server.js) with three tools — hn_front_page, hn_search, hn_get_item
  - mapHnHit / mapHnItem field-mapping helpers (the per-source glue template)
  - Captured offline Algolia fixtures (story, job, item tree) + node:test field-map/smoke suite
  - The end-to-end proof that adding a source = pure field-mapping into the shared contract
affects: [stack-exchange, lobsters, lemmy, hashnode, dev-to, github, rss, "any future source server"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-source server = field-map helpers (mapXHit/mapXItem) + URL construction only; fetch/normalize/envelope/dual-return all imported from shared"
    - "registerTool with RAW Zod shapes (listEnvelopeShape/detailEnvelopeShape) as outputSchema — never z.object(...) at SDK 1.29.0"
    - "Guarded stdio connect (import.meta.url === pathToFileURL(process.argv[1]).href) so the module imports offline for tests but connects when run directly"
    - "Real captured API payloads as offline fixtures to pin the field map"

key-files:
  created:
    - servers/hn/server.js
    - test/hn.test.js
    - test/fixtures/hn-story.json
    - test/fixtures/hn-job.json
    - test/fixtures/hn-item.json
  modified: []

key-decisions:
  - "Guarded the StdioServerTransport connect to direct execution so tests can import mapHnHit/mapHnItem/server without starting a live transport"
  - "hn_get_item item.num_comments left null (the /items/:id endpoint carries no num_comments field); the top-level comment count lives in item.comments"
  - "Detail-node type derived from the node's own `type` field (comment/job/else->story) since /items/:id has no _tags"

patterns-established:
  - "Field-mapping-only source servers: mapHnHit returns a RAW partial item fed through buildListEnvelope->normalizeItem (defaulting + HTML strip stay shared)"
  - "encodeURIComponent on every user-supplied URL segment (query, id) — Tampering mitigation T-02-01"

requirements-completed: [FOUND-04, OUT-01]

coverage:
  - id: D1
    description: "mapHnHit maps an Algolia search hit onto the exact contract item (objectID->id stringified, points->score, num_comments->num_comments, _tags->type, constructed news.ycombinator.com permalink, filtered tags)"
    requirement: "FOUND-04"
    verification:
      - kind: unit
        ref: "test/hn.test.js#mapHnHit maps a story hit onto the exact contract fields"
        status: pass
      - kind: unit
        ref: "test/hn.test.js#mapHnHit derives type from _tags per the type map"
        status: pass
      - kind: unit
        ref: "test/hn.test.js#mapHnHit filters _tags to human-meaningful tags, dropping author_*/story_* noise"
        status: pass
    human_judgment: false
  - id: D2
    description: "Job stories yield null score and null num_comments (verified Algolia behavior)"
    requirement: "OUT-01"
    verification:
      - kind: unit
        ref: "test/hn.test.js#mapHnHit yields null score and null num_comments for a job story"
        status: pass
    human_judgment: false
  - id: D3
    description: "mapHnItem maps the /items/:id root node onto the item and flattens ONLY top-level children into comments [{id,author,text}] with HTML stripped downstream"
    requirement: "FOUND-04"
    verification:
      - kind: unit
        ref: "test/hn.test.js#mapHnItem flattens ONLY top-level children into comments [{id,author,text}]"
        status: pass
      - kind: unit
        ref: "test/hn.test.js#mapHnItem comments are HTML-stripped through buildDetailEnvelope"
        status: pass
    human_judgment: false
  - id: D4
    description: "hn_front_page, hn_search, hn_get_item register on the McpServer and return contract-shaped envelopes with both structuredContent and JSON-text content"
    requirement: "OUT-01"
    verification:
      - kind: unit
        ref: "test/hn.test.js#hn server registers exactly hn_front_page, hn_search, hn_get_item"
        status: pass
      - kind: unit
        ref: "test/hn.test.js#each hn tool declares an outputSchema (contract validation on return)"
        status: pass
      - kind: integration
        ref: "node -e handler invocation: front_page/search/get_item envelopes parse against ListEnvelopeSchema/DetailEnvelopeSchema against the live Algolia API"
        status: pass
    human_judgment: false
  - id: D5
    description: "MCP Inspector visual confirmation that the three tools list and return exact-contract data (Success Criteria 1, manual)"
    verification:
      - kind: manual_procedural
        ref: "npm run inspect:hn (or npx @modelcontextprotocol/inspector node servers/hn/server.js)"
        status: unknown
    human_judgment: true
    rationale: "The MCP Inspector is an interactive UI check of tool listing/invocation; the automated handler-invocation integration test (D4) already proves the same envelopes, but Inspector sign-off is a human visual confirmation."

# Metrics
duration: 22min
completed: 2026-07-01
status: complete
---

# Phase 01 Plan 02: Hacker News Reference Server Summary

**Three MCP tools (hn_front_page, hn_search, hn_get_item) over the Algolia HN Search API whose only HN-specific code is the mapHnHit/mapHnItem field map — everything else (fetch, normalize, envelope, dual-return) is imported from the shared contract, proving that adding a source reduces to pure field-mapping.**

## Performance

- **Duration:** ~22 min
- **Started:** 2026-07-01
- **Completed:** 2026-07-01
- **Tasks:** 2
- **Files modified:** 5 (all created)

## Accomplishments
- `mapHnHit` / `mapHnItem` field-mapping helpers convert real captured Algolia payloads into exact contract items/details — job stories correctly yield `null` score/num_comments, and `_tags` are filtered to human-meaningful values with `type` derived per the ARCHITECTURE §4 enum.
- Three tools registered via `registerTool` with RAW Zod shapes (`listEnvelopeShape`/`detailEnvelopeShape`) as `outputSchema`; every handler fetches through `getJson` (no direct `fetch`) and returns `toolResult(envelope)` so both `structuredContent` and JSON-text `content` are emitted.
- Live end-to-end run confirmed all three tools return envelopes that parse against `ListEnvelopeSchema`/`DetailEnvelopeSchema` (Success Criteria 1); `hn_get_item` flattens the top-level comment tree.
- Offline test suite (`node --test`) of 12 hn tests (40 across the repo) pins the field map against captured fixtures with zero network access.

## Task Commits

Each task was committed atomically:

1. **Task 1: mapHnHit/mapHnItem helpers + captured Algolia fixtures** - `c5a35cb` (feat)
2. **Task 2: register hn_front_page, hn_search, hn_get_item over stdio** - `3d8dc94` (feat)

_Note: Task 1 was executed TDD-style (test written and confirmed RED before the helpers made it GREEN); both stages landed in the single Task 1 commit._

## Files Created/Modified
- `servers/hn/server.js` - HN reference server: `mapHnHit`/`mapHnItem` field map + three `registerTool` tools + guarded stdio connect.
- `test/hn.test.js` - `node:test` field-map units + registration smoke, all offline against fixtures.
- `test/fixtures/hn-story.json` - Real Algolia story hit (points/num_comments present).
- `test/fixtures/hn-job.json` - Real Algolia job hit (no points/num_comments → null score/num_comments).
- `test/fixtures/hn-item.json` - Real `/items/:id` node with a nested reply tree (top-level flattening + one HTML-bearing comment).

## Decisions Made
- **Guarded stdio connect** — `server.connect(new StdioServerTransport())` runs only when the module is executed directly (`import.meta.url === pathToFileURL(process.argv[1]).href`), so `test/hn.test.js` can import `mapHnHit`/`mapHnItem`/`server` without starting a live transport. This satisfies the plan's "connect at module top level" while keeping the smoke test offline.
- **`hn_get_item` item.num_comments = null** — the Algolia `/items/:id` payload carries no `num_comments` field; the actual top-level comments are returned in `item.comments`, so reporting `null` is the honest mapping rather than a misleading top-level-only count.
- **Detail-node type** derived from the node's own `type` field (`comment`/`job`/else→`story`) because `/items/:id` has no `_tags` (unlike search hits, which go through `_tags`).

## Deviations from Plan

None - plan executed exactly as written. All acceptance criteria for both tasks met; the shared contract carried all reusable behavior with no per-server reinvention.

## Issues Encountered
- The captured `hn-job.json` fixture (an authentic older job post) omits the `points`/`num_comments` keys entirely rather than sending explicit `null`; both map to `null` via `?? null`, so the "job → null score/num_comments" acceptance holds against real data.
- The initially captured item fixture's first three top-level comments had no nested replies and no HTML, so it could not prove top-level-only flattening or HTML stripping. Re-captured (real) top-level comments that carry nested replies, and swapped in a genuine HTML-bearing top-level comment (id 16582152) so both behaviors are exercised against ground-truth payloads.

## User Setup Required

None - the HN source needs no auth (Algolia HN Search API is keyless).

## Next Phase Readiness
- The HN server is the working template: later source servers (Stack Exchange, Lobsters, Lemmy, Dev.to, GitHub, RSS, …) copy `servers/hn/` and rewrite only the `mapXHit`/`mapXItem` field map + URL construction.
- `manifest.json` and `build-mcpb.sh` for the HN server are intentionally out of this plan's scope (documented for a later packaging pass per CONTEXT D-07).
- Credential/auth plumbing (`credentials.js`, `auth.js`, `.env.example`) is a separate Phase 1 plan; the HN server does not depend on it.

## Self-Check: PASSED
- servers/hn/server.js — FOUND
- test/hn.test.js — FOUND
- test/fixtures/hn-story.json — FOUND
- test/fixtures/hn-job.json — FOUND
- test/fixtures/hn-item.json — FOUND
- Commit c5a35cb — FOUND
- Commit 3d8dc94 — FOUND

---
*Phase: 01-foundation-credential-infrastructure*
*Completed: 2026-07-01*
