# Plan 10-02 Summary — Publish + Repo Public Flip + Live Verify

**Status:** COMPLETE (operator-gated; executed interactively with the user)
**Requirements:** PKG-04, PKG-05
**Wave:** 2 (depends on 10-01)

## What shipped

- **Published `medium-research-mcp` to public npm** — `1.2.0` first, then `1.2.1` after
  the SC1 live-verify caught a real bug (below). `latest` → **1.2.1**.
- **GitHub repo flipped public** — `github.com/TusharKanjariya/medium-research-mcp` is
  now PUBLIC (default branch `master`), with cleaned history force-pushed (master + the
  `v1.1` tag). `npx github:…` install path works live.
- **MIT license** applied (operator decision at the Task 1 gate): `LICENSE` file +
  `"license": "MIT"` in package.json.

## Task 1 — Release authorization (checkpoint:decision)

- Secret-scan gate: **REMEDIATED** (10-01 found a leaked Product Hunt token; history was
  scrubbed with `git filter-repo` before this plan — 0 token occurrences in `git log -p --all`).
- Name re-check: `npm view medium-research-mcp version` → 404 (free) immediately before publish.
- License decision: **MIT**. Go/no-go: **proceed** on both one-way doors.

## Task 2 — npm publish + SC1 (checkpoint:human-verify) → PASS (after 1.2.1 fix)

- `npm whoami` → `tushar_kanjariya`; published from a clean tree.
- **1.2.0 published** (35 files: all 13 bins + 7 shared + LICENSE + INSTALL.md; no `.env`/`.planning`).
- **SC1 live-verify caught a real defect** (exactly what "verify live, not just documented" exists for):
  bare `npx -y medium-research-<source>` / `npx -y medium-research-all` **404** — those are
  *bins inside* the `medium-research-mcp` package, not standalone packages, so `npx` can't
  resolve them by bare name.
  - **Fix (committed `d028294`, released as 1.2.1):** emit `npx -y -p medium-research-mcp <bin>`
    in all three installer config builders (`bin/install.js` JSON/OpenCode/TOML), update
    `test/installer.test.js` assertions, and correct all 24 invocation forms in `docs/INSTALL.md`.
    Full suite green (462/0).
- **SC1 re-verify (1.2.1, fresh npm cache, scratch dir outside the repo):**
  - `npx -y -p medium-research-mcp medium-research-hn` → MCP `serverInfo {name:"hn"}` ✓
  - `npx -y -p medium-research-mcp medium-research-all` → MCP `serverInfo {name:"medium-research-all"}` ✓
  - `npx medium-research-mcp` → default bin (installer) resolves ✓
- The user's `opencode.json` (written by the 1.2.0 installer with the broken bare form) was
  corrected to the `-p medium-research-mcp` form.

## Task 3 — Repo public flip + push + SC2 (checkpoint:human-verify) → PASS

- **Ordering (history was rewritten):** force-pushed cleaned history + tag to origin
  **before** flipping public, so the flip never exposed the old token history.
  - `git push --force origin master` → `186497a...d028294`
  - `git push --force origin v1.1` → `4a2be8d...84209a4`
  - Verified `origin/master` + `origin/v1.1`: **0 token commits**; local 0 ahead.
  - `gh repo edit --visibility public` → repo PUBLIC.
- **SC2 live-verify (fresh npm cache, scratch dir):**
  - `npx --package=github:TusharKanjariya/medium-research-mcp medium-research-hn` → MCP `serverInfo {name:"hn"}` ✓
  - `npx github:TusharKanjariya/medium-research-mcp install` → default bin (installer) started, non-TTY safe-exit ("Nothing written") ✓

## Success criteria — all met

- **SC1** ✓ npm path starts servers on a clean machine (corrected `-p` form, verified live).
- **SC2** ✓ GitHub install path verified live on the now-public repo.
- **SC3** ✓ tarball ships aggregator + installer (verified in 10-01; 35 files at 1.2.1).
- **SC4** ✓ four-path installer-led INSTALL.md; temp local-path file deleted (10-01).

## Operator actions (not automated — one-way doors)

`npm login`, `npm publish` (×2: 1.2.0 then 1.2.1), the force-pushes, and the visibility flip
were all run by the operator. The Product Hunt token was rotated on producthunt.com per the
Task 1 gate.

## Deviations

- **1.2.1 patch** for the SC1 npx-invocation bug (documented above) — a real code+docs+test
  fix discovered at live verification, not in the original plan. 1.2.0 remains on the registry
  (npm doesn't allow silent overwrite) but `latest` points to the correct 1.2.1.
