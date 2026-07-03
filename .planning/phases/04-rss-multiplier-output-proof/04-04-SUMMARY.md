---
phase: 04-rss-multiplier-output-proof
plan: 04
subsystem: testing
tags: [output-contract, merge, ranking, node-test, fixtures, out-02]

# Dependency graph
requires:
  - phase: 04-03
    provides: "RSS server (parseFeed/normalizeFeed) + recorded rss-*.xml fixtures the proof merges"
  - phase: 04-01
    provides: "shared/contract.js buildListEnvelope + ItemSchema (the uniform item shape)"
provides:
  - "shared/rank.js — mergeRank(envelopes) branch-free merge + nulls-last score-desc rank, plus filterByMinScore (the reference path medium-blog-pro consumes)"
  - "test/uniform-run.test.js — offline 5+-source uniform-run proof (OUT-02) with a structural no-source-branch guard"
  - "examples/uniform-run.mjs — runnable live 6-source demo (manual smoke, not a CI gate)"
affects: [medium-blog-pro-consumer, output-contract, future-source-servers]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Branch-free multi-source merge/rank shipped in shared/ (not test-local) so the OUT-02 proof asserts the real consumer code path"
    - "Structural test guard: assert mergeRank.length === 1 and regex mergeRank.toString() for the absence of any source-keyed conditional"
    - "Live demo invokes real registered tool handlers via server._registeredTools[name].handler(args) — zero endpoint duplication"

key-files:
  created:
    - shared/rank.js
    - test/uniform-run.test.js
    - examples/uniform-run.mjs
  modified: []

key-decisions:
  - "mergeRank lives in shared/rank.js (D-09) so the proof exercises the same branch-free path the consumer runs, not a test-local copy"
  - "TDD RED/GREEN for mergeRank was driven by test/uniform-run.test.js itself (the plan's stated verify command) rather than adding a separate unit-test file, keeping to the plan's declared file set"
  - "Structural no-branch guard forbids any === string-literal comparison inside mergeRank, closing the per-source-branch loophole beyond just the word 'source'"
  - "Live demo fixed on 6 keyless sources (HN, Stack Exchange, Lobsters, Dev.to, GitHub anon, RSS) so it runs with no credentials"

patterns-established:
  - "Pattern: prove a cross-cutting contract property with an integration test that merges 5+ real fixtures through one shared helper, plus a structural guard on the helper's source text"
  - "Pattern: a manual live smoke in examples/ (never discovered by node --test) mirrors an offline CI proof — the Phase 3 keyed-smoke discipline"

requirements-completed: [OUT-02]

coverage:
  - id: D1
    description: "mergeRank merges envelopes from 5+ shipped sources into one uniform list via a single branch-free call; every merged item satisfies ItemSchema"
    requirement: OUT-02
    verification:
      - kind: integration
        ref: "test/uniform-run.test.js#(a) every merged item validates against the full contract ItemSchema"
        status: pass
    human_judgment: false
  - id: D2
    description: "Ranking is score-descending with null-score (RSS) items last, and a source-agnostic filterByMinScore reads only contract fields and never throws on null"
    requirement: OUT-02
    verification:
      - kind: integration
        ref: "test/uniform-run.test.js#(b) ranking is score-descending with null scores sorted last, source-agnostic"
        status: pass
      - kind: integration
        ref: "test/uniform-run.test.js#(c) a source-agnostic filter reads only contract fields and never throws on null"
        status: pass
    human_judgment: false
  - id: D3
    description: "Structural guard proves mergeRank has no source parameter and no source-keyed branch (the OUT-02 branch-free property)"
    requirement: OUT-02
    verification:
      - kind: integration
        ref: "test/uniform-run.test.js#(d) mergeRank has no source parameter and no source-keyed branch"
        status: pass
    human_judgment: false
  - id: D4
    description: "examples/uniform-run.mjs runs a live 5+-source merge via mergeRank and prints a ranked list; a valid module not run by node --test"
    requirement: OUT-02
    verification:
      - kind: manual_procedural
        ref: "node examples/uniform-run.mjs (live) — merged 60 items from 6 sources, ranked score-desc; node --check passes"
        status: pass
    human_judgment: true
    rationale: "Live network demo (keyless manual smoke, D-10) — network-dependent and human-eyeballed, not a CI gate; per the 'live-API smokes deferred' pattern it is recorded as a manual UAT item."

# Metrics
duration: 12min
completed: 2026-07-03
status: complete
---

# Phase 4 Plan 04: 5+-Source Uniform-Run Proof (OUT-02) Summary

**mergeRank in shared/rank.js merges HN, Stack Exchange, Lobsters, Dev.to, GitHub, and RSS through ONE branch-free flatMap + nulls-last score-desc comparator — proven offline against real fixtures and demoed live across 6 sources.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-03T16:00Z (approx)
- **Completed:** 2026-07-03T10:39Z (UTC)
- **Tasks:** 3 (executed as one TDD RED→GREEN cycle + the live demo)
- **Files modified:** 3 created

## Accomplishments
- **OUT-02 proven, not claimed:** a single `mergeRank([...])` call merges 5+ shipped sources into one uniform list with ZERO per-source branches — `mergeRank` takes only `envelopes` and reads only the contract `score` field.
- **shared/rank.js** ships `mergeRank(envelopes)` (flat concat + one nulls-last score-descending comparator) and `filterByMinScore(items, min)` (source-agnostic filter over contract fields) — the same reference path the medium-blog-pro consumer runs.
- **test/uniform-run.test.js** loads real recorded fixtures from HN, Stack Exchange, Lobsters, Dev.to, GitHub (numeric scores) and RSS (null scores), merges them through one call, and asserts: (a) every item `ItemSchema.parse`s; (b) score-desc with nulls last; (c) source-agnostic filtering never throws on null; (d) a structural guard that `mergeRank` has no source parameter and no source-keyed branch.
- **examples/uniform-run.mjs** live demo invokes the real registered tool handlers on 6 keyless sources, merges via `mergeRank`, and prints the top-N ranked list — a manual smoke, not a CI gate (D-10).
- Full suite green: **247 tests pass, 0 fail**.

## Task Commits

1. **Task 2 authored first as TDD RED — failing uniform-run proof** - `f83cf51` (test)
2. **Task 1 — mergeRank branch-free merge/rank in shared/rank.js (GREEN)** - `2858254` (feat)
3. **Task 3 — live 5+-source uniform-run demo** - `6776cf9` (feat)

**Plan metadata:** _(this commit)_ (docs: complete plan)

_TDD note: Task 1 (`shared/rank.js`) and Task 2 (`test/uniform-run.test.js`) were executed as a single RED→GREEN cycle. The plan's Task-1 verify command IS `node --test test/uniform-run.test.js`, so the uniform-run proof was written first (RED, module-not-found), then `mergeRank` implemented to turn it GREEN — test-first, no separate throwaway unit test._

## Files Created/Modified
- `shared/rank.js` - `mergeRank(envelopes)` branch-free merge + nulls-last score-desc rank; `filterByMinScore(items, min)` source-agnostic filter. Tiny, dependency-free.
- `test/uniform-run.test.js` - Offline OUT-02 proof merging 6 real source fixtures through one `mergeRank` call; contract-shape, ordering, filter, and structural no-branch assertions.
- `examples/uniform-run.mjs` - Live 6-source demo (manual smoke); calls real tool handlers, merges via `mergeRank`, prints ranked top-N.

## Decisions Made
- Placed `mergeRank` in `shared/rank.js` per D-09 so the proof asserts the real consumer path and the consumer gets a reference implementation.
- Drove TDD through the plan's own verify target (`test/uniform-run.test.js`) instead of adding an extra unit-test file, staying within the plan's declared `files_modified`.
- Strengthened the structural guard beyond the plan's minimum: in addition to `mergeRank.length === 1` and no `if (... source ...)`, it also forbids any `=== "literal"` inside the function body — a per-source `===` switch is exactly the branch OUT-02 forbids.

## Deviations from Plan

None - plan executed exactly as written. (Tasks 1 and 2 were sequenced test-first as one TDD cycle per the plan's `tdd="true"` Task 1 and its `node --test test/uniform-run.test.js` verify command; no scope or behavior change.)

## Issues Encountered
None. All 6 mappers produced ItemSchema-valid envelopes on the first integration run; the live demo reached all 6 sources.

## Known Stubs
None. `mergeRank`/`filterByMinScore` are complete, data-backed, and exercised by both the offline proof and the live demo.

## User Setup Required
None - no external service configuration required. The live demo is keyless (`node examples/uniform-run.mjs`); GitHub is called anonymously.

## Next Phase Readiness
- OUT-02 is complete — the project's uniform-output thesis is now an executable assertion and a runnable demo.
- Phase 4 requirements (SRC-09, OUT-02, YT-01) are all delivered; the phase is ready for `/gsd-verify-work`. The live `examples/uniform-run.mjs` smoke should be recorded as a manual UAT item (keyless — it can run without credentials).

## Self-Check: PASSED
- `shared/rank.js` — FOUND
- `test/uniform-run.test.js` — FOUND
- `examples/uniform-run.mjs` — FOUND
- commit `f83cf51` (test) — FOUND
- commit `2858254` (feat rank.js) — FOUND
- commit `6776cf9` (feat example) — FOUND
- `npm test` — 247 pass / 0 fail

---
*Phase: 04-rss-multiplier-output-proof*
*Completed: 2026-07-03*
