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

requirements-completed: [PKG-01]

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
        ref: "Server-side credential path verified live with real test-account creds (throwaway harness, no secret committed): librariesio_search returned 5 normalized packages with a real LIBRARIESIO_KEY and throws 'Missing credential: set LIBRARIESIO_KEY' with none; producthunt GraphQL auth ACCEPTED with a valid v2 Developer Token (real launches returned), throws 'Missing credential: set PRODUCTHUNT_TOKEN' with none, and surfaces a 401 (never a silent empty list) on a bad token"
        status: pass
      - kind: other
        ref: "Live Claude Desktop keychain→env injection UI test (install the two .mcpb in Desktop, confirm the OS-keychain sensitive user_config value reaches the running server) — cannot be driven headlessly; DEFERRED to phase UAT (/gsd-verify-work) per explicit user decision"
        status: deferred
    human_judgment: true

duration: 15min
completed: 2026-07-16
status: complete
---

# Phase 8 Plan 03: Build all 11 .mcpb bundles (stage → validate → spawn-test → pack) Summary

**A single staging script builds all 11 `.mcpb` bundles in Option-A repo-mirroring layout, gating each with `mcpb validate` AND a real MCP-initialize spawn test before `mcpb pack` — 11 validated + spawn-tested bundles sit in `dist/`; the D-04 credential path is verified server-side live (librariesio + producthunt), with only the live Claude Desktop keychain→env UI test deferred to phase UAT per explicit user decision.**

## Status: COMPLETE (Task 2 server-side verified; Desktop keychain UI test deferred to UAT)

All autonomous work (Task 1) is complete and committed. Task 2 (D-04) is resolved as complete-with-caveat: the **server-side credential path is verified live** and the **live Claude Desktop keychain→env injection UI test is deferred to phase UAT** (`/gsd-verify-work`) per the user's explicit decision — it cannot be driven headlessly. The Desktop-keychain UI is NOT claimed as tested here.

## Performance

- **Duration (autonomous portion):** ~15 min
- **Completed:** 2026-07-16 (Task 1 build; Task 2 server-side D-04 smoke)
- **Tasks:** 2 of 2 (Task 2 server-side verified; Desktop keychain UI deferred to UAT)
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
2. **SUMMARY at checkpoint** - `d65da31` (docs)
3. **Task 2 resolution — SUMMARY finalized** - this commit (docs)

_Task 2 (D-04) has no runtime-code commit: the server-side credential path was verified live via a throwaway harness (deleted, no secret committed), and the Desktop keychain UI half is a deferred UAT gate, not code._

## Task 2 (D-04) — Verification Evidence

**Server-side credential path — VERIFIED LIVE this session** (throwaway harness importing the servers' exported functions + shared `getJson`/`postJson` — the reusable phase-6/7 pattern; harness deleted, no secret committed; creds kept only in the gitignored `.env`, `.env.example` remains names-only):

- **librariesio:** `librariesio_search` returned 5 normalized packages with a real key (e.g. `"typescript"`, score 1452903). With no key, `librariesIoParams()` throws the clear `Missing credential: set LIBRARIESIO_KEY`.
- **producthunt:** with a valid Product Hunt v2 **Developer Token**, the GraphQL auth handshake was ACCEPTED — real launches returned (e.g. `"Paradigm"`). With no token, `productHuntHeaders()` throws the clear `Missing credential: set PRODUCTHUNT_TOKEN`. An earlier smoke with the wrong value (an API key/secret pair) was rejected by PH as `invalid_oauth_token` — confirming fail-visible behavior: PH auth rejection surfaces as an HTTP 401 error, never a silent empty list.

**Live Claude Desktop keychain→env injection UI test — DEFERRED to phase UAT (user-approved).** Installing `dist/medium-research-{librariesio,producthunt}.mcpb` in Claude Desktop and confirming the OS-keychain-stored `sensitive` user_config value reaches the running server cannot be driven headlessly; it belongs in `/gsd-verify-work`. NOT claimed as passed — an explicit, user-approved deferral.

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

## Deferred to Phase UAT (user-approved)
- **D-04 live Claude Desktop keychain→env UI test** for the two credentialed bundles. Verify in `/gsd-verify-work`: install `dist/medium-research-{librariesio,producthunt}.mcpb`, enter the key when prompted (field masked), call one tool each, then reinstall with no key and confirm the error names the env var (`LIBRARIESIO_KEY` / `PRODUCTHUNT_TOKEN`). Server-side behavior is already proven (see Task 2 evidence); only the host keychain injection remains.

## Next Phase Readiness
- 11 validated + spawn-tested bundles are in `dist/`; server-side D-04 credential path is verified. Ready for the D-06 manual distribution gate.
- PKG-01 build + server-side credential path complete; the live Desktop keychain UI check rides into phase UAT.

## Self-Check: PASSED
- scripts/build-mcpb.mjs — FOUND
- .mcpbignore — FOUND
- dist/medium-research-hn.mcpb (+ 10 others) — FOUND (gitignored)
- Commit ecfa03e — present in git history
- Task 1: 11 bundles built / validated / spawn-tested — verified
- Task 2: server-side D-04 credential path verified live (librariesio + producthunt); Desktop keychain UI test deferred to UAT (NOT claimed as passed)

---
*Phase: 08-universal-distribution*
*Task 2 resolved (server-side D-04 verified; Desktop keychain deferred to UAT): 2026-07-16*
