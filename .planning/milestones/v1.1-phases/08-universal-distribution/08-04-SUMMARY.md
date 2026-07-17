---
phase: 08-universal-distribution
plan: 04
subsystem: docs
tags: [docs, install, npx, mcpb, cross-source, mergeRank, example, release-checklist]

# Dependency graph
requires:
  - phase: 08-01
    provides: "11 medium-research-<source> bins + package name medium-research-mcp@1.1.0 + example:sweep script + files whitelist (docs/INSTALL.md, README.md)"
  - phase: 01-07
    provides: "exported per-source helpers (seUrl/mapSeUnanswered, devtoTopUrl/mapDevtoArticle, normalizeInstance/mapDiscourseTopic, normalizeInstance/mapTimelineStatuses) + shared getJson/buildListEnvelope/mergeRank"
provides:
  - "docs/INSTALL.md: Windows-first per-client setup (Claude Desktop, Cursor, Codex, OpenCode + Claude Code plugin note), per-OS spawn config, env blocks, GUI-env + cold-start caveats, .mcpb keychain note, DOC-01 pointer, maintainer manual release checklist"
  - "examples/pain-point-sweep.mjs: runnable one-tag cross-source sweep (SE + Discourse + Mastodon + Dev.to) merged via mergeRank with per-source graceful degradation"
  - "README.md linking docs/INSTALL.md and the sweep example"
affects: [npm-publish, mcpb-release, medium-blog-pro-consumer]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Phase 6/7 scratchpad-harness pattern for cross-source runs: import getJson + exported helpers + buildListEnvelope + mergeRank, build one envelope per source, mergeRank them — zero new fetch/merge/normalize logic"
    - "Display-only item annotation (_source) before mergeRank: contract item carries no source field, so origin is tagged post-normalize for print; inert to ranking"

key-files:
  created: [docs/INSTALL.md, examples/pain-point-sweep.mjs, README.md]
  modified: []

key-decisions:
  - "Merged-item source labeling done via a display-only _source field set after buildListEnvelope, because the frozen contract item has no source field (source lives on the envelope) and normalizeItem strips items to contract fields"
  - "SE sweep source uses /questions/unanswered sorted by votes (per RESEARCH DOC-01 wiring) mapped with mapSeUnanswered; four sources fetched in parallel via Promise.all since each already degrades independently"
  - "Discourse search.json response shape handled defensively (raw.topics ?? raw.topic_list?.topics) so the search endpoint and list endpoints both map cleanly"
  - "README.md created (was absent) rather than only edited; carries the INSTALL link, sweep pointer, and a restatement of the output contract"

requirements-completed: [PKG-03, DOC-01]

# Metrics
duration: ~15min
completed: 2026-07-16
status: complete
---

# Phase 08 Plan 04: INSTALL docs + runnable pain-point sweep Summary

**Shipped the human-facing half of distribution: a Windows-first `docs/INSTALL.md` covering all four MCP clients plus the Claude Code plugin path (with the `${user_config.*}` silent-spawn gotcha), and `examples/pain-point-sweep.mjs` — a runnable one-tag sweep across Stack Exchange, Discourse, Mastodon, and Dev.to that merges into one ranked list via the shared `mergeRank` and degrades per source, all reusing only existing helpers.**

## Performance

- **Duration:** ~15 min
- **Tasks:** 2
- **Files created:** 3 (docs/INSTALL.md, examples/pain-point-sweep.mjs, README.md)

## Accomplishments

- `examples/pain-point-sweep.mjs` (DOC-01) runs `node examples/pain-point-sweep.mjs rust` end to end against live APIs: it built one contract envelope per source (stackexchange=30, discourse=50, mastodon=40, devto=40 on the live run), merged 160 items via `mergeRank`, and printed the top 15 by descending score — exit 0.
- Graceful degradation verified: pointing Mastodon at a non-resolving host produced `[mastodon] skipped: getaddrinfo ENOTFOUND …` on stderr, `mastodon=0`, and still exited 0 with the other three sources ranked — one failing source never aborts the sweep and never breaks the contract.
- The example reuses only exported server helpers (`seUrl`/`mapSeUnanswered`, `devtoTopUrl`/`mapDevtoArticle`, `normalizeInstance`/`mapDiscourseTopic`, `normalizeInstance`/`mapTimelineStatuses`) plus shared `getJson`/`buildListEnvelope`/`mergeRank` — no new fetch, merge, or normalize logic. Discourse/Mastodon instances are overridable example constants (argv/env), not server defaults (SEC-02).
- `docs/INSTALL.md` (PKG-03) is a Windows-first per-client guide: Claude Desktop, Cursor, Codex (`config.toml` nested `[..].env` sub-table), OpenCode (`command` array + `environment` key), and a Claude Code plugin note surfacing the bundled-`user_config` silent-spawn gotcha (`claude mcp list`). Every Windows snippet uses `cmd /c npx -y`; credentialed servers show explicit env blocks; the GUI-clients-don't-inherit-shell-env and cold-start (`-y`, 5–30s first run) caveats appear as prose, not just in snippets.
- The doc includes a `.mcpb` keychain subsection, a DOC-01 sweep pointer, and a "Publishing (maintainer, manual — do NOT automate)" checklist documenting `npm pack`/`npm publish`, tarball Windows smoke, `npm run build:mcpb`, `git tag v1.1.0`, and `dist/*.mcpb` upload as commands the maintainer runs by hand. No task or script here executes any publish/tag/upload.
- `README.md` (was absent) created and linked to `docs/INSTALL.md`; both are already in the package `files` whitelist so they ship.

## Task Commits

1. **Task 1: examples/pain-point-sweep.mjs (cross-source sweep via mergeRank)** — `b92e5b8` (feat)
2. **Task 2: docs/INSTALL.md per-client setup + release checklist + README link** — `7230cec` (docs)

## Files Created/Modified

- `examples/pain-point-sweep.mjs` (new) — one tag → SE + Discourse + Mastodon + Dev.to → `mergeRank`; per-source try/catch degradation; overridable example instances.
- `docs/INSTALL.md` (new) — per-client per-OS setup, env blocks, GUI-env + cold-start caveats, `.mcpb` note, DOC-01 pointer, manual maintainer release checklist.
- `README.md` (new) — project intro, Install link to docs/INSTALL.md, sweep pointer, output-contract restatement.

## Decisions Made

- **Merged-item source labels via a display-only `_source` field.** The frozen contract item has no `source` field (it lives on the envelope) and `normalizeItem` strips items to contract fields, so after building each envelope the example tags its items with `_source` purely for printing. `mergeRank` reads only `score`, so this is inert to ranking and never touches the contract the servers emit. (Caught at runtime: an initial version read `item.source`, which is `undefined` — the fix is this annotation.)
- **Parallel source fetches via `Promise.all`.** Each source is already wrapped in its own try/catch that degrades to an empty envelope, so running them concurrently is safe and faster.
- **README created, not just edited.** The plan said "link from README, create if absent" — it was absent, so a minimal README carries the INSTALL link, the sweep pointer, and the output contract.

## Deviations from Plan

**1. [Rule 1 - Bug] Merged items lacked a `source` field for display**
- **Found during:** Task 1 first live run
- **Issue:** The print loop read `item.source`, but contract items carry no `source` (it's an envelope field, and `normalizeItem` drops non-contract fields) → `TypeError: Cannot read properties of undefined (reading 'padEnd')`.
- **Fix:** Tag each envelope's normalized items with a display-only `_source` before `mergeRank`, and print `item._source`. Ranking is unaffected (mergeRank reads only `score`); the contract is untouched.
- **Files modified:** examples/pain-point-sweep.mjs
- **Commit:** b92e5b8 (fix folded into the task commit before first commit)

Otherwise the plan executed as written. (RESEARCH DOC-01 offered `/questions/unanswered` or a `/tag/<tag>.json`/`search.json` choice for Discourse; used `/questions/unanswered` for SE and `search.json` for Discourse as the plan's primary wiring specified.)

## Known Stubs

None. The example is fully wired to live APIs and runs end to end; the docs contain no placeholder-as-only-option config. Credential values in snippets are intentional placeholders (`your-libraries-io-key`, etc.) per the T-08-09 mitigation — never real secrets.

## Threat Surface

No new threat surface beyond the plan's `<threat_model>`. T-08-09 (plaintext env blocks) is mitigated: the docs steer Claude Desktop users to the `.mcpb` keychain, mark client `env` blocks as plaintext-on-disk, and use only placeholder secrets. T-08-10 (example fetches user-host instances) and T-08-SC (helper reuse) remain accepted — the sweep calls `getJson(…, { untrustedHost: true })` so the frozen SSRF guard applies unchanged, and it adds no dependency or new network/merge logic.

## User Setup Required

None to complete this plan. To actually connect a client, follow `docs/INSTALL.md`. Publishing (`npm publish`, `git tag v1.1.0`, `dist/*.mcpb` upload) remains the maintainer's manual gate (D-06) — documented, never automated.

## Next Phase Readiness

- PKG-03 and DOC-01 are satisfied; this was the last incomplete plan in phase 08.
- No blockers. The `.mcpb` bundles referenced by the INSTALL `.mcpb`/release sections are produced by plan 08-02/`npm run build:mcpb`; the sweep and docs do not depend on them existing to function.

## Self-Check: PASSED

All created files exist on disk (docs/INSTALL.md, examples/pain-point-sweep.mjs, README.md) and both task commits are present in git history (b92e5b8, 7230cec).

---
*Phase: 08-universal-distribution*
*Completed: 2026-07-16*
