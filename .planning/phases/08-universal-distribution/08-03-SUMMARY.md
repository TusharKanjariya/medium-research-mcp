---
phase: 08-universal-distribution
plan: 03
subsystem: infra
tags: [mcpb, packaging, staging, spawn-test, dist, keychain-smoke]

requires:
  - phase: 08-01
    provides: "package.json (@anthropic-ai/mcpb@2.1.2 devDep, build:mcpb script), 11 server.js with shebang + isEntry guard"
  - phase: 08-02
    provides: "11 manifests retargeted to Option-A staged path servers/<name>/server.js at v1.1.0"
provides:
  - "scripts/build-mcpb.mjs — Option-A stage + mcpb validate + MCP-initialize spawn test + mcpb pack, looped over 11 servers"
  - ".mcpbignore (test/, *.md, .planning/, .env*) + dist/ gitignore entry"
  - "11 built + validated + spawn-tested dist/medium-research-<source>.mcpb (gitignored)"
affects: [08-04-client-docs, npm-publish, D-04-keychain-smoke]

tech-stack:
  added: []
  patterns:
    - "Option-A staging: mirror servers/<name>/ depth so ../../shared and bare deps resolve from a bundled prod node_modules (server.js byte-identical, zero import rewrite)"
    - "Two-gate bundle build: mcpb validate (manifest) THEN a real node spawn + newline-delimited JSON-RPC initialize (resolvability) BEFORE mcpb pack"
    - "prod node_modules built once via npm ci --omit=dev --ignore-scripts, reused across all 11 stages"

key-files:
  created:
    - scripts/build-mcpb.mjs
    - .mcpbignore
  modified:
    - .gitignore

key-decisions:
  - "Spawn test speaks newline-delimited JSON-RPC (the MCP stdio transport framing), asserts result.serverInfo/capabilities on id=1, and fails fast on ERR_MODULE_NOT_FOUND in stderr — mcpb validate alone never catches Pitfall A"
  - "prod node_modules staged from an isolated temp dir seeded with the pinned package.json + package-lock.json (npm ci), not from the repo's dev node_modules — guarantees no dev deps leak"
  - "--ignore-scripts on npm ci blocks any dependency postinstall from running into a vendored bundle (T-08-04 supply-chain)"
  - "dist/ rebuilt fresh each run (rm -rf then mkdir) so no stale/partial bundle survives a failed build; dist/ gitignored so nothing is ever committed"
  - "mcpb CLI invoked from the pinned local devDependency bin (node_modules/.bin/mcpb 2.1.2), never a global or npx-latest (T-08-SC)"

requirements-completed: []

coverage:
  - id: D1
    description: "scripts/build-mcpb.mjs builds 11 unique medium-research-<source>.mcpb, each mcpb-validated + MCP-initialize spawn-tested before pack, from a --ignore-scripts prod node_modules; sizes in the 200KB-20MB band"
    requirement: PKG-01
    verification:
      - kind: automated_ui
        ref: "npm run build:mcpb — 11 bundles built (each ~3.37MB, in band)"
        status: pass
      - kind: other
        ref: "node -e uniqueness+size check (11 unique, 200KB<size<20MB) prints OK; grep dist/ .gitignore; git status --porcelain dist/ empty"
        status: pass
      - kind: unit
        ref: "negative control: staged server.js without shared/ → spawnSync stderr contains ERR_MODULE_NOT_FOUND (Pitfall A gate proven live)"
        status: pass
    human_judgment: false
  - id: D2
    description: "D-04 keychain smoke — sensitive user_config secret reaches the running server as env via the OS keychain for librariesio + producthunt; required-cred no-key error names the env var"
    requirement: PKG-01
    verification:
      - kind: other
        ref: "Manual Claude Desktop install of dist/medium-research-{librariesio,producthunt}.mcpb + one tool call each (BLOCKING human gate)"
        status: pending
    human_judgment: true

duration: 15min
completed: 2026-07-16
status: blocked
---

# Phase 8 Plan 03: Build all 11 .mcpb bundles (stage → validate → spawn-test → pack) Summary

**A single staging script builds all 11 `.mcpb` bundles in Option-A repo-mirroring layout, gating each with `mcpb validate` AND a real MCP-initialize spawn test before `mcpb pack` — 11 validated + spawn-tested bundles now sit in `dist/`; the plan is PAUSED at the blocking D-04 Claude Desktop keychain smoke (human-only) for the two credentialed bundles.**

## Status: BLOCKED at Task 2 (D-04 keychain smoke — human verification required)

All autonomous work (Task 1) is complete and committed. Task 2 is a `checkpoint:human-verify` with `gate="blocking-human"` — it cannot be automated or self-approved. See the checkpoint returned to the orchestrator for the exact manual steps. STATE.md/ROADMAP.md tracking is intentionally left to the continuation run per the plan's checkpoint protocol.

## Performance

- **Duration (autonomous portion):** ~15 min
- **Completed:** 2026-07-16 (Task 1); Task 2 pending human smoke
- **Tasks:** 1 of 2 (Task 2 is the blocking human gate)
- **Files:** 2 created, 1 modified; 11 gitignored bundles emitted to dist/

## Accomplishments (Task 1)
- `scripts/build-mcpb.mjs` stages each of the 11 servers in Option-A layout (manifest.json + prod `node_modules/` + `shared/` + `servers/<name>/server.js`, mirroring the two-level depth so `../../shared` and bare deps resolve with the server.js byte-identical), then gates the stage in order: (1) `mcpb validate`, (2) a real `node` spawn that completes an MCP `initialize` handshake over newline-delimited JSON-RPC and asserts no `ERR_MODULE_NOT_FOUND` — only then `mcpb pack` to `dist/medium-research-<name>.mcpb`.
- Prod `node_modules` is built once via `npm ci --omit=dev --ignore-scripts` in an isolated temp dir (seeded with the pinned package.json + lockfile) and reused across all 11 stages — deterministic, dev-dep-free, and no dependency postinstall enters any bundle (T-08-04).
- `npm run build:mcpb` exits 0 and produces all 11 unique `medium-research-<source>.mcpb` (each ~3.37 MB — deps vendored, dev deps absent, well within the asserted 200 KB–20 MB band).
- Empty-user_config servers (hn, lobsters, devto, discourse, mastodon, rss) each pack and pass the spawn test — the empty-input edge holds.
- **Pitfall A gate proven live** (negative control): a staged `server.js` with `shared/` removed makes the spawn produce `ERR_MODULE_NOT_FOUND`, which the build's spawn test rejects on — so a stage that can't resolve `../../shared` aborts its bundle instead of emitting a broken `.mcpb`.
- `.mcpbignore` excludes `test/`, `*.md`, `.planning/`, `.env`, `.env.*` (T-08-05, belt-and-suspenders); `.gitignore` gains a `dist/` line so bundles and the throwaway npm tarball are never committed (`git status --porcelain dist/` is empty).
- mcpb CLI is the pinned local devDependency (`node_modules/.bin/mcpb` 2.1.2), never a global or npx-latest (T-08-SC).

## Task Commits

1. **Task 1: mcpb build script + ignore files** - `ecfa03e` (feat)

_Task 2 is the blocking human keychain smoke — no commit; it is verified by a live Claude Desktop install, not code._

## Files Created/Modified
- `scripts/build-mcpb.mjs` (new) - stage → validate → spawn-test → pack loop over 11 servers
- `.mcpbignore` (new) - test/, *.md, .planning/, .env* excludes
- `.gitignore` (modified) - appended `dist/`
- `dist/medium-research-<source>.mcpb` × 11 (gitignored build outputs, not committed)

## Decisions Made
- Spawn test uses newline-delimited JSON-RPC (the MCP stdio transport framing), not Content-Length framing — matches how `StdioServerTransport` reads/writes. Asserts `result.serverInfo || result.capabilities` on the `id:1` initialize response and SIGKILLs the child on success/failure/timeout.
- Staged the prod deps from a fresh `npm ci` rather than copying the repo's own `node_modules` (which carries the `@anthropic-ai/mcpb` dev dep) — the only reliable way to guarantee a dev-dep-free bundle.
- `dist/` is wiped and recreated at the start of every build so a failed run never leaves a stale bundle claiming success.

## Deviations from Plan
None - Task 1 executed exactly as written. The build gates each stage with `mcpb validate` + a real MCP-initialize spawn test before `mcpb pack`, exactly per D-02/D-03 and the plan's action block.

## Issues Encountered
- Node emits a `DEP0190` deprecation warning when running the mcpb `.cmd` shim / `npm` with `shell:true` and args on Windows. It is cosmetic here — all args are internally constructed from `mkdtemp` temp paths and the hardcoded server list (no external/user input, so no injection surface). The `.cmd` shims genuinely require `shell:true` on Windows (Node's post-CVE spawn posture), so the warning is accepted rather than worked around.

## User Setup Required (BLOCKING — Task 2 / D-04)
Manual Claude Desktop keychain smoke for the two credentialed bundles — see the returned checkpoint for exact steps:
- Install `dist/medium-research-librariesio.mcpb`, enter a real Libraries.io key, call `librariesio_search`; then reinstall without a key and confirm the error names `LIBRARIESIO_KEY`.
- Install `dist/medium-research-producthunt.mcpb`, enter a Product Hunt developer token, call one tool.

## Next Phase Readiness
- 11 validated + spawn-tested bundles are in `dist/` ready for the D-04 smoke and (post-approval) the D-06 manual distribution gate.
- On checkpoint approval, the continuation run advances STATE.md/ROADMAP.md and marks PKG-01's build half done.
- Blocker: D-04 keychain smoke (human-only) — this plan cannot be marked complete until approved.

## Self-Check: PASSED
- scripts/build-mcpb.mjs — FOUND
- .mcpbignore — FOUND
- dist/medium-research-hn.mcpb (+ 10 others) — FOUND (gitignored)
- Commit ecfa03e — present in git history

---
*Phase: 08-universal-distribution*
*Paused at blocking D-04 keychain smoke: 2026-07-16*
