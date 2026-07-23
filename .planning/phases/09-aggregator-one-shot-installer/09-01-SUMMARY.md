---
phase: 09-aggregator-one-shot-installer
plan: 01
subsystem: infra
tags: [mcp, aggregator, modelcontextprotocol-sdk, stdio, registerTools]

# Dependency graph
requires:
  - phase: 08-distribution
    provides: "11 standalone servers with export const server + isEntry stdio guard; .mcpb build pipeline"
provides:
  - "medium-research-all aggregator bin — one MCP process exposing the full 37-tool union across all 11 sources"
  - "registerTools(server) merge seam exported by every servers/*/server.js"
  - "test/aggregator.test.js — union-completeness + standalone-bin regression"
affects: [09-02-installer, 10-publish]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "registerTools(server) merge seam: each server wraps its registerTool block in an exported function called both locally (standalone bin) and by the aggregator"
    - "Aggregator imports only registerTools (never the server instance) and never .connect()s an imported server — one isEntry-gated stdio connect per process"

key-files:
  created:
    - servers/aggregator/server.js
    - test/aggregator.test.js
  modified:
    - servers/hn/server.js
    - servers/stackexchange/server.js
    - servers/lobsters/server.js
    - servers/lemmy/server.js
    - servers/devto/server.js
    - servers/github/server.js
    - servers/librariesio/server.js
    - servers/producthunt/server.js
    - servers/rss/server.js
    - servers/discourse/server.js
    - servers/mastodon/server.js
    - package.json

key-decisions:
  - "Merge seam is registerTools(server) exported per server; aggregator calls all 11 against one McpServer. Public SDK API only — no reach into private _registeredTools (research §Alternatives)."
  - "Hoisting layout for the 10 expansion servers: keep export const server in place, wrap the registerTool block in a hoisted export function registerTools, call registerTools(server) at the bottom — smallest, schema-preserving diff (no body re-indent)."
  - "stackexchange: exported fetchQuestionDetail helper relocated ABOVE registerTools — an export statement cannot nest inside a function."
  - "Keyed sources (librariesio, producthunt) mounted unconditionally; fail-loud 'set X' behavior stays at call time (D-02), not mount time."

patterns-established:
  - "Aggregator mount loop over a list of registerTools functions; union is collision-free by D-01 prefixes so no dedup code — registerTool's duplicate-name throw is the guard (Pitfall 2)."

requirements-completed: [AGG-01]

coverage:
  - id: D1
    description: "medium-research-all aggregator exposes the full 37-tool union across all 11 source prefixes with names/schemas/envelope byte-identical to standalone servers"
    requirement: "AGG-01"
    verification:
      - kind: integration
        ref: "test/aggregator.test.js#aggregator exposes the full 37-tool union across all 11 sources"
        status: pass
    human_judgment: false
  - id: D2
    description: "The 11 standalone bins still start over real stdio after the registerTools refactor (isEntry guard intact; importing a server never auto-connects)"
    requirement: "AGG-01"
    verification:
      - kind: integration
        ref: "test/aggregator.test.js#standalone hn bin still starts over real stdio"
        status: pass
    human_judgment: false
  - id: D3
    description: "Full existing suite (439) plus the new aggregator test pass with zero per-source test edits and no contract changes"
    requirement: "AGG-01"
    verification:
      - kind: integration
        ref: "npm test (441 pass)"
        status: pass
    human_judgment: false

# Metrics
duration: 18min
completed: 2026-07-23
status: complete
---

# Phase 9 Plan 01: Aggregator (`medium-research-all`) Summary

**One MCP process (`medium-research-all`) mounting the full 37-tool union across all 11 sources via an exported `registerTools(server)` merge seam — tool names, schemas, and output contract byte-identical to the standalone bins, zero new dependencies.**

## Performance

- **Duration:** ~18 min
- **Completed:** 2026-07-23
- **Tasks:** 2
- **Files modified:** 13 (2 created, 11 modified)

## Accomplishments
- Built `servers/aggregator/server.js` — a single `McpServer` named `medium-research-all` that mounts every source's tools by calling each server's `registerTools(server)` against one server; exactly one `isEntry`-gated stdio connect, never connects an imported server (Pitfall 1).
- Refactored all 11 `servers/*/server.js` to export `registerTools(server)` (the same `registerTool` calls, wrapped verbatim), with each standalone bin calling it locally so its tool set is unchanged.
- Added `test/aggregator.test.js`: in-process `Client`/`InMemoryTransport` union check (asserts all 37 tools + exact count) and a real-stdio spawn regression proving the hn standalone bin still completes the MCP initialize handshake.
- Registered the `medium-research-all` bin in `package.json`; no `files`/`dependencies` change, `.mcpb` build pipeline (`scripts/build-mcpb.mjs`) untouched.

## Task Commits

1. **Task 1 (tracer): End-to-end aggregator seam via Hacker News** — `7fc168d` (feat)
2. **Task 2: Expand the union to all 11 sources** — `02dddc1` (feat)

## Files Created/Modified
- `servers/aggregator/server.js` (created) - the `medium-research-all` McpServer; mounts all 11 sources via a registerTools loop.
- `test/aggregator.test.js` (created) - union-completeness (in-memory) + standalone-bin stdio regression.
- `servers/hn/server.js` - registerTools seam (function-before-const layout, from the tracer).
- `servers/{stackexchange,lobsters,lemmy,devto,github,librariesio,producthunt,rss,discourse,mastodon}/server.js` - registerTools seam (hoisting layout).
- `package.json` - added `medium-research-all` bin.

## Decisions Made
- **Public SDK API only.** The SDK exposes no merge/mount primitive and stores tools in a private `_registeredTools` map; the `registerTools(server)` seam is the sanctioned path (reaching into the private map was rejected in research §Alternatives).
- **Two internal layouts, one contract.** The tracer (hn) places `export function registerTools` before `export const server`; the 10 expansion servers keep the const in place and rely on function-declaration hoisting to call `registerTools(server)` at the bottom. Both are functionally identical; the hoisting layout gives the smallest, schema-preserving diff for the mechanical repeat.
- **No dedup/collision code** in the aggregator — D-01 prefixes make the union collision-free and `registerTool` throws loudly on a real duplicate (Pitfall 2).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Relocated `stackexchange` exported helper out of the wrapper function**
- **Found during:** Task 2 (expanding the union)
- **Issue:** `servers/stackexchange/server.js` has an `export async function fetchQuestionDetail` sitting *between* two `registerTool` blocks. The uniform wrap swept it inside `registerTools`, producing `SyntaxError: Unexpected token 'export'` (an `export` cannot nest in a function).
- **Fix:** Moved the `fetchQuestionDetail` helper (with its doc comment) above `export function registerTools`. It remains a top-level export used by the `so_get_question` handler via closure — no behavior change.
- **Files modified:** servers/stackexchange/server.js
- **Verification:** `node --check` passes; standalone stackexchange bin spawns and lists its 4 tools; full suite green.
- **Committed in:** `02dddc1` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to keep stackexchange's existing `fetchQuestionDetail` export intact while applying the uniform seam. No scope creep, no contract change.

## Issues Encountered
None beyond the deviation above — the uniform wrap applied cleanly to the other 9 servers (verified by `node --check` across all 11).

## User Setup Required
None - no external service configuration required. Keyed sources (librariesio, producthunt) are mounted unconditionally and keep their existing "set X" fail-loud behavior at call time (D-02).

## Next Phase Readiness
- AGG-01 satisfied: the aggregator bin is registered and green. Ready for Plan 09-02 (the `medium-research-mcp install` one-shot config installer), which will offer `medium-research-all` as the default single-entry config.
- The 11 `.mcpb` bundles and `scripts/build-mcpb.mjs` SERVERS array are untouched — the aggregator has no `manifest.json`, so it is never bundled.

## Self-Check: PASSED

- FOUND: servers/aggregator/server.js
- FOUND: test/aggregator.test.js
- FOUND commit 7fc168d (Task 1)
- FOUND commit 02dddc1 (Task 2)

---
*Phase: 09-aggregator-one-shot-installer*
*Completed: 2026-07-23*
