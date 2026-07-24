---
phase: 10-publish-install-path-docs
verified: 2026-07-24T00:00:00Z
status: passed
score: 4/4 must-haves verified
behavior_unverified: 0
overrides_applied: 0
requirements_coverage:
  PKG-04: satisfied
  PKG-05: satisfied
  DOC-02: satisfied
warnings:
  - "REQUIREMENTS.md still marks PKG-04 and PKG-05 as [ ]/Pending in the traceability table despite both being satisfied this phase — bookkeeping lag, not a goal gap"
  - "The literal command text `npx -y medium-research-<source>` in REQUIREMENTS.md PKG-04 and ROADMAP SC1 is the bare form that 404s; the working documented command (INSTALL.md/README, what users follow) is the corrected `npx -y -p medium-research-mcp <bin>` form shipped in 1.2.1 — planning-doc text is stale, user-facing docs are correct"
deviations:
  - "Published latest is 1.2.1, not the planned 1.2.0. 1.2.0 was published first; SC1 live-verify caught a real defect (bare `npx -y medium-research-<source>` 404s because sources are bins inside one package, not standalone packages). 1.2.1 patch (commit d028294) corrected the installer's three config builders and all INSTALL.md invocations to `npx -y -p medium-research-mcp <bin>`. Legitimate mid-phase fix; goal met in final state."
---

# Phase 10: Publish & Install-Path Docs — Verification Report

**Phase Goal:** Anyone on any machine can install via npm or GitHub with the documented commands — no clone, no local-path hacks
**Verified:** 2026-07-24
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

The goal is achieved and independently demonstrated. From a scratch directory outside the
repo, `npx -y -p medium-research-mcp medium-research-hn` fetched the package from the public
npm registry and returned a valid MCP `initialize` handshake (`serverInfo {name:"hn"}`) — a
clean-machine install with no clone. The GitHub repo is public with the same 13-bin package,
and INSTALL.md documents all four paths installer-first with corrected commands.

### Observable Truths (ROADMAP Success Criteria)

| # | Truth (SC) | Status | Evidence |
| - | ---------- | ------ | -------- |
| SC1 | No-clone machine: npm path starts any server from public registry | ✓ VERIFIED | Live handshake from scratch dir: `npx -y -p medium-research-mcp medium-research-hn` → `serverInfo {name:"hn"}` fetched from registry. Registry `latest`=1.2.1 with 13 bins. |
| SC2 | GitHub path works live on a no-clone machine | ✓ VERIFIED | Repo `TusharKanjariya/medium-research-mcp` is PUBLIC (default `master`), published bin map includes installer+aggregator+servers, `--package=github:…` + default-bin forms documented; operator recorded live `serverInfo {name:"hn"}` over the GitHub path (10-02 checkpoint). |
| SC3 | Tarball contains aggregator + installer (pre-publish `npm pack --dry-run`) | ✓ VERIFIED | `npm pack --dry-run` = 35 files: 13 bins (11 servers + `servers/aggregator/server.js` + `bin/install.js`), 7 `shared/*.js`, LICENSE, `docs/INSTALL.md`; zero `.env`/`.planning`/`test` files. |
| SC4 | INSTALL.md covers all four paths; temp local-path file gone | ✓ VERIFIED | INSTALL.md sections: (1) One-shot installer [line 40, recommended], (2) Aggregator, (3) Per-source npm, (4) GitHub. `docs/claude_desktop_config.all-servers.json` absent on disk; zero references outside `.planning/`. |

**Score:** 4/4 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `package.json` | 1.2.x + repository/homepage/bugs + MIT | ✓ VERIFIED | version 1.2.1, license MIT, repository/homepage/bugs all point at the GitHub repo, 13-bin map intact, files whitelist intact |
| `LICENSE` | MIT (operator choice at gate) | ✓ VERIFIED | MIT License, Copyright 2026 Tushar Kanjariya; ships in tarball |
| `docs/INSTALL.md` | Four paths, installer-led, corrected commands | ✓ VERIFIED | installer at line 40 precedes GitHub `--package` at 308; 9 uses of corrected `-p` form; zero bare `npx -y medium-research-<source>` forms; checklist reconciled to 1.2.1 |
| `README.md` | Leads with installer one-liner + INSTALL pointer | ✓ VERIFIED | `npx medium-research-mcp install` at line 18; links `docs/INSTALL.md` at line 25; no bare broken form |
| `docs/claude_desktop_config.all-servers.json` | DELETED | ✓ VERIFIED | absent from disk and git status; not found anywhere in repo |
| Published npm `medium-research-mcp` | Public, latest, 13 bins | ✓ VERIFIED | `npm view` latest=1.2.1, license MIT, 13 bins incl installer+aggregator+hn |
| Public GitHub repo, master pushed | Public, master default | ✓ VERIFIED | `gh repo view`: PUBLIC, isPrivate=false, default `master`. (Local is 1 commit ahead — the 10-02 planning-summary commit; release/code commits are on origin.) |

### Key Link Verification

| From | To | Via | Status |
| ---- | -- | --- | ------ |
| package.json files whitelist | 13 bins + 7 shared in tarball | `npm pack --dry-run` = 35 files | ✓ WIRED |
| installer default-bin `medium-research-mcp` | `bin/install.js` | package.json bin map + published bin map | ✓ WIRED |
| bin/install.js config builders | working npx command | emits `npx -y -p medium-research-mcp <bin>` (JSON L92-93, OpenCode L106-107, TOML L143) | ✓ WIRED |
| npm registry name | documented npx commands | published unscoped `medium-research-mcp`; INSTALL/README use it | ✓ WIRED |

### Security Gate (git-history secret scan)

| Check | Result | Status |
| ----- | ------ | ------ |
| Real credential values in `git log -p --all` for every credentials.js ENV_VAR | `real-secret-hits=0` | ✓ PASS |
| Redaction marker present where token was | `PRODUCTHUNT-TOKEN-REDACTED` × 7 | ✓ PASS |
| Committed `.env` in history | none | ✓ PASS |

The 10-01 scan originally FAILed (real Product Hunt token in `.planning/` history). History was
scrubbed with `git filter-repo` and cleaned history was force-pushed to origin BEFORE the public
flip (ordering correct — the flip never exposed the token). Operator rotated the token. Gate
correctly blocked, then cleared — the designed control worked.

### Prohibitions (all judgment-tier, resolved)

| Prohibition | Status |
| ----------- | ------ |
| MUST NOT ship a secret in tarball or history | ✓ resolved (scan clean, `.planning` excluded from tarball) |
| MUST NOT flip public without a passing secret scan | ✓ resolved (scrubbed to PASS before flip) |
| MUST NOT run `npm version minor` (double-tag) | ✓ resolved (version string edited directly) |
| MUST NOT automate publish or visibility flip | ✓ resolved (both operator-run, human-gated) |
| MUST NOT publish under scoped/renamed name | ✓ resolved (published unscoped `medium-research-mcp`) |
| MUST NOT publish from dirty tree / flip with unpushed master | ✓ resolved (clean tree; force-pushed clean history before flip) |

### Requirements Coverage

| Requirement | Description | Status | Evidence |
| ----------- | ----------- | ------ | -------- |
| PKG-04 | Configure any server on any machine via npm; package published | ✓ SATISFIED | Published 1.2.1 public; live npm handshake verified. NOTE: literal `npx -y medium-research-<source>` text is superseded by the working `-p` form. |
| PKG-05 | Install via `npx github:<owner>/medium-research-mcp` without npm registry | ✓ SATISFIED | Repo public, GitHub path documented + operator live-verified |
| DOC-02 | INSTALL.md covers all four paths; temp file retired | ✓ SATISFIED | Four-path installer-led INSTALL.md; temp file gone |

Bookkeeping note: REQUIREMENTS.md still lists PKG-04 and PKG-05 as `[ ]`/Pending in the
traceability table — update to Complete during ship/cleanup. Not a goal gap.

### Anti-Patterns Found

None material. No debt markers, stubs, or empty implementations introduced. `bin/install.js`,
`servers/aggregator/server.js`, `servers/hn/server.js` all pass `node --check`.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| npm path starts server on clean machine | `npx -y -p medium-research-mcp medium-research-hn` (scratch dir) | MCP `serverInfo {name:"hn"}` | ✓ PASS |
| Published artifact carries all bins | `npm view medium-research-mcp@1.2.1 bin` | 13 bins incl installer+aggregator | ✓ PASS |
| Tarball excludes secrets/planning/test | `npm pack --dry-run` | 35 files, 0 bad | ✓ PASS |
| Bins load | `node --check` × 3 | OK | ✓ PASS |

### Human Verification Required

None outstanding. The two irreversible install paths (SC1 npm, SC2 GitHub) were verified live
by the operator at the human-gated wave-2 checkpoints and independently re-confirmed here for
the npm path. The one `backstop`-tier truth in 10-02 (npm publish atomicity / safe retry under
a version) is satisfied by outcome — the publish completed and `latest`=1.2.1 — so no separate
human check is warranted.

### Gaps Summary

No goal gaps. The phase goal — install via npm or GitHub with the documented commands, no clone,
no local-path hacks — is achieved and independently demonstrated. Two documentation-consistency
warnings remain (REQUIREMENTS.md traceability not flipped to Complete; stale bare-form command
text in PKG-04/SC1 planning docs), both cosmetic and appropriate to clean up at ship time. The
notable deviation (1.2.1 patch correcting the npx invocation form) is a legitimate fix caught by
the live-verify gate — exactly what that gate exists for — and leaves the final state correct.

---

_Verified: 2026-07-24_
_Verifier: Claude (gsd-verifier)_
