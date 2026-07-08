---
phase: quick-260708-h5g
plan: 01
subsystem: shared-contract, rss-server, docs
tags: [bugfix, tdd, html-entities, rss, claude-md-drift]
status: complete
requires: []
provides:
  - "stripHtml decodes astral-plane numeric entities (emoji) correctly and never throws on malformed ones"
  - "mapRssItem collapses object-valued content:encoded via textOf() (WR-01 pattern)"
  - "CLAUDE.md commands/steps match the actual repo (inspect:hn exists; no phantom build-mcpb.sh)"
affects: []
tech-stack:
  added: []
  patterns:
    - "Guarded String.fromCodePoint helper (decodeCodePoint) for numeric entity refs"
    - "WR-01 textOf() object-collapse extended from author to content:encoded"
key-files:
  created: []
  modified:
    - shared/contract.js
    - test/contract.test.js
    - servers/rss/server.js
    - test/rss.test.js
    - CLAUDE.md
    - package.json
decisions:
  - "Out-of-range numeric entities (> 0x10FFFF) are left verbatim in output rather than replaced with U+FFFD — preserves source fidelity and never throws"
  - "Only inspect:hn added to package.json scripts (no sibling scripts for the other 8 servers) — matches exactly what CLAUDE.md documents"
metrics:
  duration: "4min"
  tasks: 3
  completed: "2026-07-08"
---

# Quick Task 260708-h5g: Fix CONCERNS.md Bugs (Astral Entity Decoding, content:encoded, CLAUDE.md Drift) Summary

**One-liner:** Guarded fromCodePoint fixes emoji-mangling in stripHtml, content:encoded now rides the WR-01 textOf() collapse so attribute-carrying feeds never emit "[object Object]", and CLAUDE.md's commands finally match the repo (real inspect:hn script, phantom build-mcpb.sh removed).

## What was done

### Task 1: Astral-plane numeric entity decoding in stripHtml (TDD)
- **RED** (`9c50276`): 4 new tests in `test/contract.test.js` — decimal `&#128512;` → U+1F600, hex `&#x1F680;`/`&#X1F680;` → U+1F680, out-of-range `&#1114112;` must not throw and stays verbatim, BMP `&#65;`/`&#x42;` regression pins. 3 failed on old code as expected.
- **GREEN** (`3b5d703`): added module-private `decodeCodePoint(match, cp)` in `shared/contract.js` returning `String.fromCodePoint(cp)` for integer code points in `0..0x10FFFF` and the original match otherwise; wired both the decimal and hex replacers through it. Replacer order (apostrophe special-case first) preserved. The old `String.fromCharCode` truncated astral code points to lone surrogate halves; the guard also closes a potential RangeError hard-error on malformed entities in untrusted feed content (threat T-quick-01, mitigated — Test 3 asserts no-throw).

### Task 2: content:encoded through textOf() in mapRssItem (TDD)
- **RED** (`bd1c5df`): 3 new tests in `test/rss.test.js` in the WR-01 block — object-valued `content:encoded` with `#text` maps to the string; attribute-only object falls back to description; envelope-level text is `"Full body & more"` (stripped + decoded), never `"[object Object]"`. All 3 failed on old code.
- **GREEN** (`7c69d49`): one-line fix in `servers/rss/server.js` `mapRssItem` — `text: textOf(item["content:encoded"]) ?? textOf(item.description) ?? null`, with a WR-01 comment. Behavior-preservation held: zero existing tests needed modification (textOf returns strings unchanged).

### Task 3: CLAUDE.md drift (`5514551`)
- `package.json`: added `"inspect:hn": "npx @modelcontextprotocol/inspector node servers/hn/server.js"` — the documented command is now real.
- `CLAUDE.md` step 6: dropped the instruction to add `build-mcpb.sh` (glob-verified: exists nowhere under `servers/*/`); noted `.mcpb` packing is deferred to v2 (PKG-01) and manifests are documentation/scaffold for now.
- `CLAUDE.md` Commands block: phantom `cd servers/<name> && ./build-mcpb.sh` line replaced with a PKG-01 deferral comment. Every remaining command corresponds to a real script or real files.

## Verification

- `npm ci` run (fresh worktree); full offline suite `node --test`: **261/261 pass** (254 baseline + 7 new).
- Task 3 script check (`node -e` against package.json) passes.
- CLAUDE.md contains no remaining reference to a packaging script as an existing file.
- Output contract untouched: no schema field renamed or dropped; changes confined to entity decoding internals and one field-mapping line.

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None.

## Commits

| Task | Commit | Type | Description |
|------|--------|------|-------------|
| 1 (RED) | 9c50276 | test | failing astral-entity tests for stripHtml |
| 1 (GREEN) | 3b5d703 | fix | guarded fromCodePoint entity decoding |
| 2 (RED) | bd1c5df | test | failing object-valued content:encoded tests |
| 2 (GREEN) | 7c69d49 | fix | content:encoded routed through textOf() (WR-01) |
| 3 | 5514551 | docs | CLAUDE.md drift + inspect:hn script |

## TDD Gate Compliance

Both TDD tasks have a `test(...)` commit (RED, verified failing) followed by a `fix(...)` commit (GREEN, verified passing). No refactor pass was needed.

## Self-Check: PASSED

All 6 modified files + SUMMARY.md exist on disk; all 5 commit hashes (9c50276, 3b5d703, bd1c5df, 7c69d49, 5514551) found in git log.
