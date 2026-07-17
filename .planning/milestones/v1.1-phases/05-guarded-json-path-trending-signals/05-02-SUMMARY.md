---
phase: 05-guarded-json-path-trending-signals
plan: 02
subsystem: api
tags: [hackernews, algolia, trending, velocity, mcp, zod]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "HN reference server (mapHnHit, buildListEnvelope, toolResult, getJson chokepoint)"
provides:
  - "hn_rising MCP tool — rising HN stories approximated by points/hour velocity re-sort over a recency+points window"
  - "exported pure helper risingNumericFilters({hours,minPoints,nowSeconds}) — Algolia numericFilters string builder"
  - "exported pure helper rankByVelocity(hits, nowSeconds) — points/hour descending re-sort with 1/60h age floor"
affects: [stackexchange no-answers mining, devto trending, consumer mergeRank ordering]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Injected-clock pure ordering helpers (nowSeconds argument) for deterministic offline velocity tests"
    - "Server-side velocity re-sort of date-ordered Algolia hits BEFORE field-mapping (never return raw date order)"

key-files:
  created: []
  modified:
    - servers/hn/server.js
    - test/hn.test.js

key-decisions:
  - "Velocity is an ordering signal only — never added to the item; frozen contract preserved (type stays 'story')"
  - "Clock captured once in the handler (Math.floor(Date.now()/1000)) and threaded into both helpers so filter cutoff and re-sort share one 'now'"
  - "1/60-hour age floor guards divide-by-zero on very-fresh posts (A4)"
  - "Tool description explicitly states rising is a velocity APPROXIMATION, not HN's real front-page algorithm (D-11)"

patterns-established:
  - "Pattern: exported pure URL/ordering helpers with injected clock for offline determinism (mirrors seUrl/mapHnHit export convention)"
  - "Pattern: re-sort raw hits by engagement velocity before .map(mapHnHit) to keep downstream mergeRank meaningful (Pitfall 3)"

requirements-completed: [TREND-03]

coverage:
  - id: D1
    description: "hn_rising returns story items ordered by points/hour velocity (fast climbers first), never raw date order"
    requirement: "TREND-03"
    verification:
      - kind: unit
        ref: "test/hn.test.js#rankByVelocity orders by points/hour desc — a fresh climber outranks an older high-points hit"
        status: pass
    human_judgment: false
  - id: D2
    description: "hours and minPoints are agent-tunable params (defaults 24h / >=10 points) encoded into the Algolia numericFilters window"
    requirement: "TREND-03"
    verification:
      - kind: unit
        ref: "test/hn.test.js#risingNumericFilters builds points>N,created_at_i>cutoff from the injected clock"
        status: pass
    human_judgment: false
  - id: D3
    description: "velocity re-sort tolerates age-0 fresh posts without divide-by-zero (1/60h floor) yielding finite ordering"
    requirement: "TREND-03"
    verification:
      - kind: unit
        ref: "test/hn.test.js#rankByVelocity guards divide-by-zero on an age-0 hit (1/60h floor) — finite velocity, no throw"
        status: pass
    human_judgment: false
  - id: D4
    description: "hn_rising is registered on the HN server with an outputSchema (frozen list envelope contract, optional query param)"
    requirement: "TREND-03"
    verification:
      - kind: unit
        ref: "test/hn.test.js#hn_rising is registered with an outputSchema (contract validation on return)"
        status: pass
    human_judgment: false

# Metrics
duration: 12min
completed: 2026-07-10
status: complete
---

# Phase 5 Plan 02: HN Rising (Velocity-Approximated Trending) Summary

**hn_rising tool that approximates HN's rising stories via Algolia search_by_date + numericFilters, re-sorted server-side by points/hour velocity, with two exported pure helpers and deterministic injected-clock tests**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-10T10:50:00Z
- **Completed:** 2026-07-10T11:02:32Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added `hn_rising` MCP tool: fetches `search_by_date` over a `points>N,created_at_i>cutoff` recency window (keyless, fixed-host, through `getJson`), then re-sorts hits by points/hour velocity BEFORE mapping so genuine fast-climbers surface first (Pitfall 3 honored — never raw date order).
- Extracted two exported pure helpers — `risingNumericFilters({hours,minPoints,nowSeconds})` and `rankByVelocity(hits, nowSeconds)` — both taking an injected clock for deterministic offline unit testing (D-11 testability).
- Tunable `hours` (default 24, max 168) and `minPoints` (default 10, max 1000) params, plus an optional `query` that scopes rising to matching stories (D-12, D-13).
- Reused `mapHnHit` unchanged; item shape and `TYPE` = `"story"` untouched — velocity never enters the item (frozen contract).
- Tool description plainly documents rising as a velocity approximation, not HN's real front-page algorithm.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add risingNumericFilters + rankByVelocity helpers and the hn_rising tool** - `12fcb73` (feat)
2. **Task 2: Deterministic velocity + numericFilters tests and hn_rising registration smoke** - `ab679b5` (test)

## Files Created/Modified
- `servers/hn/server.js` - Added exported `risingNumericFilters` + `rankByVelocity` helpers and the `hn_rising` registerTool block (velocity re-sort before mapping; reuses `mapHnHit`).
- `test/hn.test.js` - Added helper unit tests (exact numericFilters string, points/hour ordering, divide-by-zero floor), extended imports, and updated the registration smoke to the 4-tool set with an `hn_rising` outputSchema assertion.

## Decisions Made
- Followed plan as specified. Velocity is ordering-only (never an item field); clock captured once per invocation and threaded into both helpers; 1/60h age floor for divide-by-zero.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- The pre-existing "registers exactly hn_front_page, hn_search, hn_get_item" assertion necessarily failed after Task 1 registered the fourth tool. This is the intended atomic split: Task 1 ships the server code (its acceptance criteria — `node --check` + grep markers — all held), and Task 2 updates the assertion to the 4-tool set. Full suite is green (16/16) after Task 2.

## User Setup Required

None - no external service configuration required. `hn_rising` is a keyless, fixed-host Algolia GET through the existing shared client.

## Next Phase Readiness
- HN trending signal (TREND-03) complete and contract-conformant; ready for the remaining phase-5 trending tools (SE no-answers mining 05-03, Dev.to top/rising) and the shared `getJson` SSRF guard work.
- No blockers. Zero new dependencies.

## Self-Check: PASSED

- FOUND: servers/hn/server.js
- FOUND: test/hn.test.js
- FOUND: 05-02-SUMMARY.md
- FOUND commit: 12fcb73 (Task 1, feat)
- FOUND commit: ab679b5 (Task 2, test)

---
*Phase: 05-guarded-json-path-trending-signals*
*Completed: 2026-07-10*
