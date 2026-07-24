---
phase: 10-publish-install-path-docs
plan: 01
subsystem: packaging-and-docs
tags: [npm-publish, install-docs, secret-scan, provenance]
requires: [PKG-04-prep, DOC-02]
provides:
  - "package.json@1.2.0 with repository/homepage/bugs provenance metadata"
  - "docs/INSTALL.md rewritten installer-first across four install paths"
  - "README install quickstart leading with npx medium-research-mcp install"
  - "git-history secret-scan result (FAIL) gating the 10-02 public flip"
affects: [package.json, docs/INSTALL.md, README.md]
tech-stack:
  added: []
  patterns: [npm-files-whitelist, default-bin-resolution]
key-files:
  created: []
  modified: [package.json, docs/INSTALL.md, README.md]
  deleted: [docs/claude_desktop_config.all-servers.json]
decisions:
  - "Edited version string directly to 1.2.0 (no npm version — Pitfall 3 double-tag)"
  - "Added repository/homepage/bugs; deliberately NO license key (10-02 operator decision)"
  - "Secret scan is FAIL: real Product Hunt token in git history blocks the 10-02 public flip"
metrics:
  duration: ~20m
  completed: 2026-07-24
status: complete
secret_scan: FAIL
---

# Phase 10 Plan 01: Publish Prep + Install-Path Docs Summary

Bumped the package to 1.2.0 with npm provenance metadata, rewrote docs/INSTALL.md around all four install paths (installer-led), led the README with the one-liner, retired the temp local-path file — and ran the HIGH-severity git-history secret scan, which **FAILED**: a real Product Hunt Developer Token is present in git history and blocks the 10-02 repo public flip.

## Tasks Completed

| Task | Name | Commit | Result |
| ---- | ---- | ------ | ------ |
| 1 (tracer) | Version bump 1.2.0 + provenance metadata + tarball verify | `8073449` | PASS — tarball ships all 13 bins + 7 shared + INSTALL.md, 34 files, no secrets/planning/test |
| 2 | INSTALL.md four-path rewrite + README quickstart + checklist v1.2.0 | `0182a09` | PASS — installer leads (line 33 < GitHub `--package` line 308), v1.2.0 in checklist |
| 3 | Delete temp file + git-history secret scan | (no code commit — untracked deletion + read-only scan) | temp file gone + zero refs = PASS; **secret scan = FAIL** |

## What Was Built

- **package.json @ 1.2.0** — `version` 1.1.0 → 1.2.0; added `repository` (git+https://github.com/TusharKanjariya/medium-research-mcp.git), `homepage`, `bugs`. No `license` key (deferred to the 10-02 operator IP decision, per plan). `files`/`bin`/deps untouched. `npm pack --dry-run` confirms 34 files: aggregator + 11 servers + `bin/install.js` (13 bins), all 7 `shared/*.js`, `docs/INSTALL.md`, `README.md` — and none of `.env`, `.planning/`, `test/`, `examples/`, `scripts/`.
- **docs/INSTALL.md** — new "Install paths" overview + four sections, installer-first: (1) one-shot `npx medium-research-mcp install` (recommended; auto-detect, config backup, non-destructive aggregator merge, skippable LIBRARIESIO_KEY/PRODUCTHUNT_TOKEN prompts), (2) aggregator single manual entry, (3) per-source npm (existing per-client blocks + credentials table retained), (4) GitHub with both `npx github:… install` and `npx --package=github:… medium-research-<source>` forms plus the default-bin gotcha note. Publishing checklist reconciled to v1.2.0 (`medium-research-mcp-1.2.0.tgz`, `git tag v1.2.0`) with three new operator steps: npm-name 404 re-check, repo public-flip + `git push origin master`, clean-dir live-verify of both paths with a fresh cache. Manual `git tag` retained (no `npm version minor`).
- **README.md** — Install section leads with the `npx medium-research-mcp install` one-liner and keeps the docs/INSTALL.md pointer.
- **docs/claude_desktop_config.all-servers.json** — DELETED. It was git-untracked (never committed), so `rm` is complete; zero references in README.md or docs/ (verified). No tracked git change results.

## Secret Scan Result: FAIL (blocks the 10-02 public flip)

The full-history scan (`git log -p --all`) over every shared/credentials.js ENV_VAR reported 7 raw hits. Manual triage:

**REAL credential (HIGH — blocking):**
- **Product Hunt Developer Token** `dgT8qU…BDpak` (value redacted from this file — treat as compromised, rotate) committed in git history in `.planning/` process docs. Present in commits:
  - `b2071b9851e0820194129be257e1e478238825c9` — `.planning/phases/08-universal-distribution/.continue-here.md`
  - `de63eb67be73a97d9a9d6870c0671df3a1b3638e` — `.planning/HANDOFF.json`
  - `9613e25376c32eb9006ee899be053c582cd39cdb` — `.planning/phases/08-universal-distribution/.continue-here.md`
  - NOTE: the token is **NOT in the current tree** (scrubbed from working files) but **remains in history**. The npm tarball path is unaffected (`.planning/` is excluded by the `files` whitelist — Task 1 confirmed). The **GitHub visibility flip (D-06/10-02) would expose it**: flipping the repo public makes the entire history — including these commits — world-readable.

**False positives (not real values — cleared):**
- `assert.deepEqual(envFor({ LIBRARIESIO_KEY: "", PRODUCTHUNT_TOKEN: undefined }), {})` — test asserting empty/undefined; no value.
- `REDDIT_PASSWORD: SECRET_PW` / `LEMMY_PASSWORD: SECRET_PW` (x4) — `SECRET_PW` is a test-fixture variable name, not a credential value.

**Required remediation before 10-02 may proceed (operator, human-gated):**
1. **Rotate/revoke** the leaked Product Hunt Developer Token on producthunt.com immediately — it has been in local history and must be treated as compromised regardless of scrubbing.
2. **Scrub the token from git history** (git filter-repo / BFG) so no commit carries it, then force-push the cleaned history — OR keep the repo private until history is clean.
3. **Re-run the secret scan → must report `secret-hits=0` (PASS)** before the 10-02 public-flip checkpoint.

This is a Rule 4 / operator decision (live-secret rotation + history rewrite) — not executor-auto-fixable. Recording FAIL and blocking 10-02 is the designed outcome of this gate.

## Deviations from Plan

None to the implementation. The secret scan producing FAIL is a planned, documented gate outcome (Task 3 acceptance criteria explicitly cover the FAIL branch), not a deviation.

## Known Stubs

None.

## Verification

- Task 1 automated verify: PASS (version 1.2.0, metadata present, no license, aggregator + installer in tarball).
- Task 2 automated verify: PASS (installer leads at line 33 before GitHub `--package` at line 308; `v1.2.0` in checklist; README quickstart present).
- Task 3 automated verify: temp file gone + zero references = PASS; **git-history secret scan = FAIL (`secret-hits` includes 1 real Product Hunt token across 3 commits)**.
- `npm test` not re-run for a docs/metadata-only change (no server/tool/shared code touched; output contract untouched). Per project MEMORY, `npm test` ground truth is on master WITH network; nothing in this plan can regress a bin.

## Self-Check: PASSED

- package.json @ 1.2.0 with repository/homepage/bugs — FOUND (verified via node require).
- docs/INSTALL.md four paths installer-first + v1.2.0 checklist — FOUND.
- README.md leads with installer one-liner — FOUND.
- docs/claude_desktop_config.all-servers.json — CONFIRMED ABSENT.
- Commit `8073449` (Task 1) — FOUND.
- Commit `0182a09` (Task 2) — FOUND.
