---
phase: 04-rss-multiplier-output-proof
plan: 02
subsystem: infra
tags: [fast-xml-parser, strnum, rss, xml, supply-chain, dependencies]

# Dependency graph
requires:
  - phase: 04-rss-multiplier-output-proof (04-01)
    provides: RSS server scaffold that will consume this parser in 04-03
provides:
  - fast-xml-parser@^4.5.7 (legacy major) as the project's first XML-parsing runtime dependency
  - Committed lockfile recording the minimal fast-xml-parser@4.5.7 -> strnum@1.1.2 tree
affects: [04-03-rss-server, rss, xml-parsing]

# Tech tracking
tech-stack:
  added: [fast-xml-parser@4.5.7, strnum@1.1.2]
  patterns:
    - "Blocking-human supply-chain gate before adding any new runtime dependency (D-08)"
    - "Install with --ignore-scripts + npm ls tree verification before trusting a new package"

key-files:
  created: []
  modified: [package.json, package-lock.json]

key-decisions:
  - "Pinned fast-xml-parser to ^4.5.7 (legacy major) NOT ^5 — v5 explodes into 6+ new low-download sub-packages the project rejects (D-08)"
  - "Did NOT upgrade past the moderate advisory GHSA-gh4j-gqv2-49f6 to ^5 — the advisory is in XMLBuilder (XML output), which this project never uses (it only parses feeds); upgrading would violate D-08"

patterns-established:
  - "Supply-chain checkpoint: verify resolved tree (npm ls) + absence of postinstall before committing a new dep"

requirements-completed: [SRC-09]

coverage:
  - id: D1
    description: "fast-xml-parser@^4.5.7 installed with resolved tree exactly fast-xml-parser@4.5.7 -> strnum@1.1.2 (no ^5, no extra transitive deps, no postinstall)"
    requirement: "SRC-09"
    verification:
      - kind: other
        ref: "npm ls fast-xml-parser strnum => fast-xml-parser@4.5.7 -> strnum@1.1.2"
        status: pass
      - kind: unit
        ref: "npm test (node --test) — 227 pass, 0 fail after install"
        status: pass
    human_judgment: false

# Metrics
duration: 2min
completed: 2026-07-03
status: complete
---

# Phase 4 Plan 02: fast-xml-parser Supply-Chain Gate + Install Summary

**Introduced the project's first XML-parsing runtime dependency — `fast-xml-parser@^4.5.7` (legacy major, NOT ^5) with `strnum@1.1.2` as its sole zero-dep transitive — behind a blocking-human supply-chain gate, with the resolved tree verified before commit.**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-07-03T10:16:48Z
- **Completed:** 2026-07-03T10:18:13Z
- **Tasks:** 2 (1 checkpoint satisfied by recorded operator verification, 1 auto)
- **Files modified:** 2

## Accomplishments
- Added `fast-xml-parser@^4.5.7` to `package.json` dependencies (legacy `^4` line, explicitly NOT `^5`).
- Installed with `--ignore-scripts`; confirmed the resolved tree is exactly `fast-xml-parser@4.5.7 -> strnum@1.1.2` with no other transitive deps.
- Verified neither package declares a `postinstall` (nor any install lifecycle) script.
- Committed `package-lock.json` recording the minimal 4.x -> strnum 1.x tree.
- Existing test suite still green: 227 pass, 0 fail.

## Task Commits

1. **Task 1: Supply-chain gate (D-08)** — no commit; blocking-human checkpoint satisfied by recorded operator verification (operator ran `npm view` this session: resolves to 4.5.7, MIT, only dep `strnum@^1.0.5`, no install lifecycle scripts, integrity sha512 present).
2. **Task 2: Install and verify fast-xml-parser@^4.5.7** — `ed4155d` (chore)

## Files Created/Modified
- `package.json` — added `"fast-xml-parser": "^4.5.7"` to dependencies.
- `package-lock.json` — records resolved tree `fast-xml-parser@4.5.7 -> strnum@1.1.2`.

## Decisions Made
- **Pinned to `^4.5.7` (legacy), not `^5`** — per D-08 / 04-RESEARCH. The `^5` line pulls in 6+ new low-download sub-packages; `^4` carries a single zero-dep transitive (`strnum@1`). Verification would have failed loudly on a `^5` tree, any extra transitive, or a postinstall.
- **Did not act on advisory GHSA-gh4j-gqv2-49f6** (`npm audit` moderate: "XMLBuilder XML Comment and CDATA Injection"). The vulnerable component is **XMLBuilder** (XML *output*/serialization); this project only *parses* RSS/Atom feeds and never builds XML, so the advisory does not apply to the usage pattern. The only offered fix upgrades to `fast-xml-parser@5.9.3` — a breaking change that directly violates D-08 (the whole point of this plan is to stay on `^4`). Documented here rather than remediated; will be re-evaluated if a `^4`-line fix ships.

## Deviations from Plan

None — plan executed exactly as written. The Task 1 blocking-human checkpoint was pre-satisfied by recorded operator verification (supplied in the execution context), so the executor honored the recorded approval and proceeded rather than re-prompting.

## Issues Encountered
- `npm audit` reports one moderate advisory (GHSA-gh4j-gqv2-49f6) against `fast-xml-parser <5.7.0`. Assessed as **not applicable** (XMLBuilder-only; project parses, never builds XML) and **not remediable within D-08** (fix requires `^5`). No action taken; documented under Decisions Made.

## Security / Threat Model
- **T-04-SC (Tampering — npm install)**: mitigated. Blocking-human supply-chain checkpoint (recorded operator verification) + `--ignore-scripts` install + `npm ls` tree verification (exactly `4.5.7 -> strnum 1.1.2`, no postinstall) before commit.
- **T-04-SC-2 (Version drift to ^5)**: mitigated. Pinned `^4.5.7`; resolved tree confirmed on the `4.x` line with the single `strnum@1.x` transitive.

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
- Parser dependency is in place and lockfile-committed; 04-03 can now build the RSS server's XML parsing on `fast-xml-parser@4`.
- No blockers. Note for future: the XMLBuilder advisory is tracked but non-applicable; revisit if a `^4`-line patch (`4.5.x+`) becomes available.

## Self-Check: PASSED

- `package.json` records `fast-xml-parser` — FOUND
- SUMMARY.md — FOUND
- Task 2 commit `ed4155d` — FOUND

---
*Phase: 04-rss-multiplier-output-proof*
*Completed: 2026-07-03*
