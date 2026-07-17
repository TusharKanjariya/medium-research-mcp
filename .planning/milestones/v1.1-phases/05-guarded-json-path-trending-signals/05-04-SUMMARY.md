---
phase: 05-guarded-json-path-trending-signals
plan: 04
subsystem: api
tags: [mcp, devto, forem, zod, trending, rising, zero-deps]

# Dependency graph
requires:
  - phase: 02-source-servers
    provides: devto server (devto_top/devto_tag/devto_search/devto_get), mapDevtoArticle/toTags, FOREM_HEADERS, frozen output contract
provides:
  - devto_top extended in place with an explicit mode enum (top | rising), integer days window (top mode only), and an optional tag filter (both modes)
  - exported pure devtoTopUrl({mode,days,tag,limit}) helper that throws on the forbidden mode=rising + days combo before any fetch
affects: [merge-rank, trending-signals, medium-blog-pro]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cross-field validation impossible in raw-shape registerTool lives in an exported pure URL-builder helper that throws pre-fetch, unit-tested directly (Pitfall 4)"
    - "Extend an existing tool in place (D-14) rather than adding a near-duplicate tool"

key-files:
  created: []
  modified:
    - servers/devto/server.js
    - test/devto.test.js

key-decisions:
  - "Forbidden rising+days combo enforced in devtoTopUrl (throws before fetch), not the Zod schema — raw-shape registration cannot cross-field .refine() (D-15, Pitfall 4)"
  - "query envelope field carries the tag filter (tag ?? null) rather than staying null, so the free-text query reflects what was requested"
  - "No username/state combos accepted — the only user-supplied forbidden pairing possible is rising+days, so that is the one guarded"

patterns-established:
  - "Pure exported URL-builder helper as the cross-field validation seam for raw-shape MCP tools"

requirements-completed: [TREND-01]

coverage:
  - id: D1
    description: "devto_top mode=top returns top-of-window articles for N integer days (default 7); builds top=<days>&per_page, never state=rising"
    requirement: TREND-01
    verification:
      - kind: unit
        ref: "test/devto.test.js#devtoTopUrl top mode builds top=<days>+per_page and NOT state=rising"
        status: pass
      - kind: unit
        ref: "test/devto.test.js#devtoTopUrl top mode falls back to the TOP_DAYS default (top=7) when days omitted"
        status: pass
    human_judgment: false
  - id: D2
    description: "devto_top mode=rising returns rising articles; builds state=rising&per_page, never top="
    requirement: TREND-01
    verification:
      - kind: unit
        ref: "test/devto.test.js#devtoTopUrl rising mode builds state=rising+per_page and NOT top="
        status: pass
    human_judgment: false
  - id: D3
    description: "devtoTopUrl throws on the forbidden mode=rising + days combo before any fetch (D-15)"
    requirement: TREND-01
    verification:
      - kind: unit
        ref: "test/devto.test.js#devtoTopUrl throws on the forbidden mode=rising + days combo BEFORE any fetch (D-15)"
        status: pass
    human_judgment: false
  - id: D4
    description: "optional tag filters either mode and is encodeURIComponent-ed; days validated as integer (rejects 'week'); mode enum rejects unknown values"
    requirement: TREND-01
    verification:
      - kind: unit
        ref: "test/devto.test.js#devtoTopUrl honors an optional tag in BOTH modes (encodeURIComponent-ed)"
        status: pass
      - kind: unit
        ref: "test/devto.test.js#devto_top schema accepts integer days but rejects a string like 'week'"
        status: pass
      - kind: unit
        ref: "test/devto.test.js#devto_top schema accepts mode top|rising but rejects an unknown mode"
        status: pass
    human_judgment: false
  - id: D5
    description: "devto_top extended in place — registered-tool set stays exactly the original four (no 5th tool, D-14); output contract unchanged"
    requirement: TREND-01
    verification:
      - kind: unit
        ref: "test/devto.test.js#devto server registers exactly devto_get, devto_search, devto_tag, devto_top"
        status: pass
      - kind: unit
        ref: "test/devto.test.js#devto_top remains a single extended tool with an outputSchema (no 5th tool added)"
        status: pass
    human_judgment: false

# Metrics
duration: 12min
completed: 2026-07-10
status: complete
---

# Phase 5 Plan 04: Extend devto_top with mode/days/tag (TREND-01) Summary

**devto_top extended in place with an explicit mode enum (top | rising), an integer days window, and an optional tag — cross-field rising+days rejection lives in an exported pure devtoTopUrl helper that throws before any fetch.**

## Performance

- **Duration:** ~12 min
- **Completed:** 2026-07-10
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Extended the existing `devto_top` tool (D-14 — no 5th tool) with `mode: z.enum(["top","rising"])`, the existing integer `days`, and an optional `tag`; documented in the tool description that `days` is an INTEGER number of days (7 = week, 30 = month) applying only in top mode.
- Added exported pure `devtoTopUrl({mode,days,tag,limit})` that builds `top=<days>&per_page` (top mode, default `TOP_DAYS`=7) vs `state=rising&per_page` (rising mode), folds in `encodeURIComponent(tag)` in either mode, and THROWS on the forbidden `mode=rising` + `days` combo before any fetch (D-15, Pitfall 4).
- Handler now builds the URL via `devtoTopUrl` before the `getJson(url, { headers: FOREM_HEADERS })` call and threads the tag into the envelope `query` field. `mapDevtoArticle`/`toTags` reused unchanged; item TYPE stays `"article"`; output contract frozen.
- Added 8 offline tests: top/rising URL shapes, default-days fallback, forbidden-combo throw, tag honored+encoded in both modes, integer-days schema rejection of `"week"`, mode-enum rejection of `"hot"`, and confirmation the registered-tool set stays exactly the original four.

## Task Commits

1. **Task 1: Add devtoTopUrl helper and extend devto_top with mode/days/tag** — `225167f` (feat)
2. **Task 2: devtoTopUrl unit tests + registration smoke** — `182e8e2` (test)

## Files Created/Modified
- `servers/devto/server.js` - Added exported `devtoTopUrl` helper; extended `devto_top` inputSchema (mode/tag added, days retained) and rewrote its handler to build the URL via the helper before fetch and carry the tag in the envelope query.
- `test/devto.test.js` - Imported `devtoTopUrl`; added top/rising/default/forbidden-combo/tag-encoding URL tests, integer-days + mode-enum schema tests, and a no-5th-tool registration assertion.

## Decisions Made
- The forbidden `rising` + `days` combination is enforced in `devtoTopUrl` (throws pre-fetch), not the schema, because `registerTool` takes a raw field shape that cannot `.refine()` across fields (D-15, Pitfall 4). The SDK compiles the raw shape into a Zod object exposing `.parse`, so schema tests call `inputSchema.parse(...)` directly.
- The envelope `query` now carries `tag ?? null` (previously always `null`) so a tag-filtered result reflects the requested filter in the contract.

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
- Initial schema tests wrapped `inputSchema` in `z.object(...)`; the SDK already compiles the raw shape into a `ZodMiniObject` exposing `.parse`. Fixed to call `inputSchema.parse(...)` directly (matching the `test/stackexchange.test.js` registration pattern) and dropped the now-unused `zod` import. Caught and resolved before the Task 2 commit; final `npm test` is fully green.

## Next Phase Readiness
- TREND-01 satisfied: agents can pull Dev.to top-of-window AND rising articles, combinable with a tag, over the frozen contract.
- Full suite green: `node --test test/devto.test.js` (23 tests) and `npm test` (291 tests) pass. `node --check servers/devto/server.js` exits 0.

## Self-Check: PASSED

All modified files exist on disk; both task commits (`225167f`, `182e8e2`) are present in git history.

---
*Phase: 05-guarded-json-path-trending-signals*
*Completed: 2026-07-10*
