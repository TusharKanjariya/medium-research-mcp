---
phase: 09-aggregator-one-shot-installer
fixed_at: 2026-07-23T00:00:00Z
review_path: .planning/phases/09-aggregator-one-shot-installer/09-REVIEW.md
iteration: 1
findings_in_scope: 1
fixed: 1
skipped: 0
status: all_fixed
---

# Phase 9: Code Review Fix Report

**Fixed at:** 2026-07-23
**Source review:** .planning/phases/09-aggregator-one-shot-installer/09-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 1 (Critical + Warning; INFO findings IN-01/IN-02/IN-03 out of scope)
- Fixed: 1
- Skipped: 0

## Fixed Issues

### WR-01: `mergeJson` silently discards our entry when the container key holds a non-object

**Files modified:** `bin/install.js`, `test/installer.test.js`
**Commit:** 656f924
**Applied fix:** Added a container-type guard in `mergeJson` immediately after
`obj[containerKey] ??= {}`. If the container key already exists and is not a plain
object (array / string / number / non-null non-object), the function now throws
`"<cfgPath> \"<containerKey>\" is not a JSON object. Left unchanged."` instead of
silently no-opping and letting `JSON.stringify` drop a named property assigned to an
array. This mirrors the top-level object guard directly above it and preserves the
non-destructive-merge contract for the normal object case (unchanged behavior).
Stdlib-only, no new dependencies. Added `test/installer.test.js` case
`"mergeJson throws (not silent no-op) when the container key holds a non-object"`
covering the `{"mcpServers": []}` array-container path and asserting the file is left
byte-unchanged.

**Verification:** `node -c` syntax check passed on both files. Full suite:
installer tests 21/21 pass (including the new guard case). The 14 pre-existing
suite failures (lobsters, mastodon, producthunt, rss, stackexchange, uniform-run)
are network-dependent source tests that fail identically on the unmodified base
tree in this offline sandbox — confirmed via `git stash` comparison (14 fail before,
14 fail after). This fix introduced zero new failures.

## Skipped Issues

None.

---

_Fixed: 2026-07-23_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
