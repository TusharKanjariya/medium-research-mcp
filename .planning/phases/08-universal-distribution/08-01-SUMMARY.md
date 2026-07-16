---
phase: 08-universal-distribution
plan: 01
subsystem: infra
tags: [npm, npx, bin, esm, packaging, mcpb, shebang, isEntry]

# Dependency graph
requires:
  - phase: 01-07 (frozen 11-server surface)
    provides: 11 servers/*/server.js each importing ../../shared/*.js, shared/credentials.js ENV_VAR
provides:
  - "package.json as one unscoped npx-runnable npm package: 11 medium-research-<source> bins, files whitelist (servers/ + shared/), version 1.1.0, private removed, @anthropic-ai/mcpb@2.1.2 devDependency"
  - "shared/main.js isEntry(import.meta.url) — realpath-hardened universal entry guard"
  - "all 11 servers/*/server.js: #!/usr/bin/env node shebang + isEntry() guard (bin-executable, symlink-safe)"
affects: [08-02-mcpb-bundles, 08-03-client-docs, 08-04-pain-point-sweep, npm-publish]

# Tech tracking
tech-stack:
  added: ["@anthropic-ai/mcpb@2.1.2 (devDependency only)"]
  patterns:
    - "Shared isEntry() guard replaces per-file naive pathToFileURL main-guard"
    - "bin-per-server ESM: shebang line 1 + type:module, no build step for npm path"

key-files:
  created: [shared/main.js]
  modified: [package.json, "servers/*/server.js (all 11)"]

key-decisions:
  - "isEntry() realpaths process.argv[1] before compare so bin works under both copy (npx/registry/Windows) and symlinked (pnpm/npm link) installs (Pitfall B)"
  - "@anthropic-ai/mcpb pinned exactly 2.1.2 in devDependencies ONLY — never runtime dep"
  - "files whitelist ships servers/ AND shared/ (omitting shared/ ships ERR_MODULE_NOT_FOUND per Pitfall 9); excludes test/ and .planning/"

patterns-established:
  - "Entry guard: import { isEntry } from '../../shared/main.js'; connect only when isEntry(import.meta.url)"
  - "Mechanical cross-server edits applied via a single asserted transform script (byte-preserving Option A)"

requirements-completed: [PKG-02]

coverage:
  - id: D1
    description: "package.json is one unscoped npx-runnable package: 11 medium-research-<source> bins, files whitelist (servers/ + shared/, no test/ or .planning/), version 1.1.0, private removed, @anthropic-ai/mcpb@2.1.2 devDependency only"
    requirement: "PKG-02"
    verification:
      - kind: automated_ui
        ref: "node -e package.json assertions (bin count 11, version 1.1.0, no private, files incl servers+shared, mcpb devDep, not in deps)"
        status: pass
      - kind: other
        ref: "npm pack --dry-run lists servers/ + shared/, 0 test/ or .planning/ entries"
        status: pass
    human_judgment: false
  - id: D2
    description: "shared/main.js exports realpath-hardened isEntry(); all 11 servers begin with node shebang, pass node --check, import isEntry and connect only via isEntry(import.meta.url); existing tests non-regressive"
    requirement: "PKG-02"
    verification:
      - kind: unit
        ref: "node --test test/hn.test.js test/discourse.test.js test/mastodon.test.js — 73 pass 0 fail"
        status: pass
      - kind: other
        ref: "isEntry false-positive check + head-1 shebang + node --check across 11 servers; no naive pathToFileURL guard remains"
        status: pass
    human_judgment: false

# Metrics
duration: 12min
completed: 2026-07-16
status: complete
---

# Phase 08 Plan 01: One npx-runnable npm package (bin + files + isEntry guard) Summary

**Turned the repo into one unscoped `medium-research-mcp@1.1.0` npm package with 11 `medium-research-<source>` bins, a servers/+shared/ files whitelist, Windows-safe shebangs, and a shared realpath-hardened `isEntry()` entry guard — `npx medium-research-<source>` is runnable with no build step (publish left as the user's manual gate, D-06).**

## Performance

- **Duration:** ~12 min
- **Tasks:** 2
- **Files modified:** 13 (package.json, shared/main.js new, 11 server.js)

## Accomplishments
- package.json is now publishable: 11-entry `bin` map, `files` whitelist shipping `servers/` + `shared/`, version `1.1.0`, `private` removed, `@anthropic-ai/mcpb@2.1.2` as a devDependency only; runtime `dependencies` untouched.
- `npm pack --dry-run` confirms `servers/` and `shared/` ship while `test/` and `.planning/` are excluded (T-08-01 information-disclosure mitigation).
- `shared/main.js` exports `isEntry(import.meta.url)` that realpaths `process.argv[1]` before comparing, so the bin connects under both copy installs (npx/registry/Windows `cmd /c npx`) and symlinked installs (pnpm/`npm link`) — Pitfall B fixed — and never throws at import time.
- All 11 `servers/*/server.js` now begin with `#!/usr/bin/env node`, use `isEntry()` in place of the naive `pathToFileURL` guard, and drop the now-unused `pathToFileURL` import. 73 existing server tests still pass — tool surface and frozen output contract unchanged.

## Task Commits

1. **Task 1: Rewrite package.json for one npx-runnable package** - `fb957a7` (feat)
2. **Task 2: Shared isEntry() guard + shebang/guard-swap across all 11 servers** - `0e4e6f6` (feat)

## Files Created/Modified
- `package.json` - bin (11), files whitelist, version 1.1.0, private removed, mcpb devDependency, build:mcpb + example:sweep scripts (forward refs to plans 03/04)
- `package-lock.json` - records @anthropic-ai/mcpb dev-time install
- `shared/main.js` (new) - `isEntry(importMetaUrl)` realpath-hardened entry guard
- `servers/{hn,stackexchange,lobsters,lemmy,devto,github,librariesio,producthunt,rss,discourse,mastodon}/server.js` - shebang line 1 + isEntry guard swap (process lifecycle only)

## Decisions Made
- Applied the byte-preserving guard/shebang swap across all 11 servers via a single asserted Node transform script (EOL-aware: 9 files CRLF, 2 LF) rather than 33 hand edits — the guard block and `pathToFileURL` import were byte-identical across every server, so a script with per-file occurrence assertions is safer and deterministic.
- Kept the existing `// Connect over stdio only when run directly…` comment above each guard (still accurate); only the conditional itself changed.

## Deviations from Plan
None - plan executed exactly as written. (The plan's `verify` block references `pathToFileURL` on a matching line only in the acceptance regex; confirmed no server.js retains the literal `import.meta.url === pathToFileURL` after the swap.)

## Issues Encountered
- First transform pass asserted the guard block with LF newlines and failed on the 9 CRLF-line-ending servers (Windows dev platform). Fixed by making the script detect per-file EOL and build the search/replace strings with that EOL — all 11 then transformed cleanly. No file content damage; caught by the pre-write occurrence assertions.

## User Setup Required
None - no external service configuration required. Publishing (`npm publish`, git tag `v1.1.0`) remains the user's manual gate (D-06).

## Next Phase Readiness
- `package.json` and all 11 `server.js` files are owned and finalized by this plan, so later-wave plans (08-02 .mcpb bundles, 08-03 client docs, 08-04 pain-point sweep) will not contend on them.
- `build:mcpb` and `example:sweep` scripts are forward-referenced; the target files (`scripts/build-mcpb.mjs`, `examples/pain-point-sweep.mjs`) are produced by plans 03/04.
- No blockers.

---
*Phase: 08-universal-distribution*
*Completed: 2026-07-16*
