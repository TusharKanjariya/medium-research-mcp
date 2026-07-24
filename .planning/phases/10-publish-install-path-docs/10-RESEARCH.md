# Phase 10: Publish & Install-Path Docs - Research

**Researched:** 2026-07-23
**Domain:** npm publish mechanics, `npx github:` install path, INSTALL.md rewrite
**Confidence:** HIGH (all claims grounded in this repo's actual package.json / bins / `npm pack --dry-run` / npm CLI docs)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** One-shot installer leads INSTALL.md. `npx medium-research-mcp install` is presented first; the other three paths (aggregator manual entry, per-source npm `npx -y medium-research-<source>`, GitHub `npx github:…`) documented below as alternatives.
- **D-02:** INSTALL.md stays at `docs/INSTALL.md` (no move to root). README keeps a short quickstart pointing to it. Reversible.
- **D-03:** Publish unscoped, public `medium-research-mcp`. Name currently unclaimed (404). One-way — the name + `npx` command surface become a public contract.
- **D-04:** Bump `1.1.0` → `1.2.0` (minor) as part of the human release checklist.
- **D-05:** Human release checklist stays in `docs/INSTALL.md` (its current §272 location). Not split into RELEASE.md.
- **D-06:** Make the repo public this phase, then verify `npx github:TusharKanjariya/medium-research-mcp` live on a machine with no clone. `<owner>` = `TusharKanjariya`. One-way (practically).
- **D-07:** PKG-05 and SC2 stay in scope as written. No deferral.
- **D-08:** Delete `docs/claude_desktop_config.all-servers.json` (SC4). Confirm nothing in README/INSTALL links to it first.

### Claude's Discretion
- Exact INSTALL.md section ordering/wording below the lead path; visual delineation of the four paths.
- How "verified live" for npm and GitHub paths is demonstrated (clean-machine / clean-dir `npx`, spawn-test, or inspector) — planner's call, provided both paths are actually exercised (SC1, SC2).
- Whether to add `repository`/`homepage`/`bugs` metadata to `package.json` (recommended for npm provenance, not required by criteria).

### Deferred Ideas (OUT OF SCOPE)
- `.mcpb` aggregator bundle — ROADMAP Future/Deferred; not this phase.
- `repository`/`homepage`/`bugs` metadata — recommended but optional; include if trivial.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PKG-04 | Publish `medium-research-mcp` to public npm so `npx -y medium-research-<source>` works on any machine | Tarball verified correct via `npm pack --dry-run` (all 13 bins + shared + INSTALL.md present, 34 files). Name 404 (available). No `.npmignore`; `files` whitelist governs. No lifecycle scripts → `--ignore-scripts` is a no-op (safe). Release checklist already in INSTALL.md §272. |
| PKG-05 | Install without npm registry via `npx github:<owner>/medium-research-mcp`; verified working + documented | Default-bin rule confirmed (npm docs): bare `npx github:owner/repo` runs the name-matching bin = `bin/install.js`. Individual server needs `npx --package=github:owner/repo medium-research-<source>`. Repo private → must flip public + push (20+ unpushed commits) before live verify. Git installs ship all tracked files (not `files` whitelist) but no bin imports outside `servers/`/`shared/`, so both paths run identically. |
| DOC-02 | INSTALL.md covers all four paths; temp `all-servers.json` retired | Current INSTALL.md structure mapped below. Temp file is **untracked** and referenced in **zero** README/INSTALL/runtime locations (only planning docs) — deletion is a plain `rm`, no doc edits chase it. |
</phase_requirements>

## Summary

This phase is a publish + documentation phase with **no source-code changes** beyond `package.json` metadata/version and doc edits. All three deliverables were de-risked by direct inspection of this repo:

- **The tarball is already correct.** `npm pack --dry-run` ships all 13 bins (11 servers + `medium-research-all` aggregator + `medium-research-mcp` installer), all 7 `shared/` modules, `docs/INSTALL.md`, and `README.md` — 34 files, 78.5 kB. Every bin's `import` resolves inside `servers/` or `shared/` (both whitelisted), so nothing a bin needs at runtime is omitted. SC1/SC3 risk is LOW. `[VERIFIED: npm pack --dry-run]`
- **The GitHub path has one sharp edge worth documenting, not fixing.** Bare `npx github:TusharKanjariya/medium-research-mcp` runs `bin/install.js` (the installer), NOT a server — because npm's default-bin rule picks the bin whose name matches the package name, and `medium-research-mcp` → `bin/install.js` exists. To start a specific server over GitHub you need `npx --package=github:TusharKanjariya/medium-research-mcp medium-research-hn`. This is actually *convenient*: `npx github:…/medium-research-mcp install` cleanly mirrors the npm `npx medium-research-mcp install` lead path. `[CITED: docs.npmjs.com/cli/v10/commands/npx]`
- **The temp file deletion is trivial and self-contained.** `docs/claude_desktop_config.all-servers.json` is untracked (never committed) and grep found zero references in README, INSTALL.md, or any runtime code — only in planning docs. `rm` it; nothing else changes. `[VERIFIED: git ls-files + grep]`

**Primary recommendation:** Plan three thin tasks — (1) `package.json` version bump to 1.2.0 + optional metadata; (2) INSTALL.md rewrite leading with the installer, four paths, retire the temp file; (3) the human-gated release + live-verify checkpoint (npm publish, repo-public flip + push, clean-dir `npx` verification of both npm and GitHub paths). Do not automate the publish or the visibility flip.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Package publish (PKG-04) | npm registry (external) | Operator (human gate) | Publish is a human-run release step; nothing in-repo automates it |
| GitHub install path (PKG-05) | git/GitHub (external) | Operator (visibility flip + push) | Requires repo public + latest pushed before it resolves |
| Install docs (DOC-02) | Repo docs (`docs/INSTALL.md`, `README.md`) | — | Pure doc edits + one file deletion |
| Version/metadata | `package.json` | — | Single-file edit; no code touched |

## Standard Stack

Not applicable — **no new packages or libraries are added this phase.** The only tools are `npm` (publish/pack) and `git`/`gh` (visibility + push), both already required by the project. The `files` whitelist and `bin` map already exist and are correct.

### Tooling used (already present)
| Tool | Purpose | Notes |
|------|---------|-------|
| `npm pack --dry-run` | Inspect tarball contents (SC3) | Output enumerated below; already correct |
| `npm publish` | First public publish (PKG-04) | Human-gated; needs `npm login` first |
| `git` / `gh repo edit` | Flip repo public + push (PKG-05) | 20+ unpushed commits on `master` |
| `npx` (`--package`) | Live-verify both install paths | Clean-dir commands below |

## Package Legitimacy Audit

**Not applicable — this phase installs no external packages.** No `npm install` of any new dependency occurs; the publish ships the existing dependency set (`@modelcontextprotocol/sdk ^1.29.0`, `fast-xml-parser ^4.5.7`, `zod ^4.4`), all previously vetted. No SLOP/SUS surface introduced.

## Architecture Patterns

### The two install-path surfaces (data flow)

```
                         PKG-04 (npm registry path)
  operator ──npm login──> npm publish ──> registry: medium-research-mcp@1.2.0
                                                 │
   end user (no clone) ──> npx -y medium-research-hn ──fetch tarball──> run servers/hn/server.js
                       └──> npx -y medium-research-all ──> run aggregator (37 tools)
                       └──> npx medium-research-mcp install ──> run bin/install.js (lead path, D-01)
                            [files whitelist governs; 34 files ship]

                         PKG-05 (GitHub path — no registry)
  operator ──> flip repo PUBLIC + git push (latest) ──> github.com/TusharKanjariya/medium-research-mcp
                                                 │
   end user (no registry) ──> npx github:TusharKanjariya/medium-research-mcp install
                                  └─ default bin = medium-research-mcp = bin/install.js (name-match rule)
                       └──> npx --package=github:.../medium-research-mcp medium-research-hn  (specific server)
                            [ALL tracked files ship; .gitignore governs, NOT files whitelist]
```

### Pattern 1: Default-bin resolution (the PKG-05 gotcha)
**What:** When `npx <pkgspec>` is given no command, npm picks the bin matching the unscoped package name if the package has multiple bins.
**Rule (quoted):** "If the package has multiple `bin` entries, and one of them matches the unscoped portion of the `name` field, then that command will be used." `[CITED: docs.npmjs.com/cli/v10/commands/npx]`
**Consequence here:** package `name` = `medium-research-mcp`; a `medium-research-mcp` bin exists → `bin/install.js`. So `npx github:TusharKanjariya/medium-research-mcp` (and `npx -y medium-research-mcp` on npm) **runs the installer**, not a server.
**To run a non-default bin:** `npx --package=<pkgspec> <command>`, e.g. `npx --package=github:TusharKanjariya/medium-research-mcp medium-research-hn`. `[CITED: docs.npmjs.com/cli/v10/commands/npx]`
**Document both forms in INSTALL.md's GitHub section.**

### Pattern 2: `files` whitelist vs git-install checkout (npm path ≠ github path)
**What:** The `files` whitelist (`servers/`, `shared/`, `bin/`, `docs/INSTALL.md`, `README.md`) governs the **npm tarball only**. `npm install github:…` / `npx github:…` checks out **all git-tracked files**, respecting `.gitignore`, ignoring `files`. `[VERIFIED: git ls-files + npm behavior]`
**What ships over each path:**
- npm tarball (34 files): `servers/`, `shared/`, `bin/`, `docs/INSTALL.md`, `README.md`, `package.json` only.
- github install (all tracked): additionally `.planning/`, `docs/PRD.md`, `docs/ARCHITECTURE.md`, `examples/`, `test/`, `scripts/`, `CLAUDE.md`, `.env.example`, `package-lock.json`, `.claude/`.
**Does the difference break anything?** No. Every bin `import` resolves inside `servers/`/`shared/` (grep-verified — see below); no bin reads from `examples/`, `scripts/`, or `test/`. Both paths run every server identically. The github path merely ships harmless extra bloat. `[VERIFIED: grep of all bin imports]`
**Secret-leak check:** git-tracked extras include `.env.example` (placeholders by convention; real `.env` is `.gitignore`d) — no real secret ships. CLAUDE.md forbids hardcoded credentials, so no source file carries one.

### Anti-Patterns to Avoid
- **Automating the publish or the visibility flip.** ROADMAP checkpoint + D-06 require these stay human-gated. Do not add a `prepublishOnly`/CI publish step.
- **Bumping version via `npm version minor` without deciding the tag policy.** `npm version minor` edits package.json AND creates a git commit + tag by default — which collides with the manual `git tag v1.x.x` step already in INSTALL.md's checklist. Either use `npm version minor --no-git-tag-version` (edit only) or drop the manual tag step. See Pitfall 3.
- **Chasing the temp-file deletion through docs.** It has zero README/INSTALL references; a plain `rm` is complete. Adding "remove the link to it" tasks would be dead work.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Verify tarball contents | A custom file-list script | `npm pack --dry-run` | Emits the exact ship list; already run below |
| Simulate a consumer install | A fresh VM / second machine | Clean temp dir + fresh npm cache + `npx` (commands below) | Reproduces registry/github fetch without a second machine |
| Flip repo visibility | Manual GitHub web clicks in a plan step | Operator action `gh repo edit --visibility public` (human-gated) | It is a gated release step, not an automatable task |

**Key insight:** Everything this phase "builds" already exists or is a one-line command. The work is sequencing the human gate correctly, not writing code.

## Runtime State Inventory

This phase renames nothing and migrates no stored data, but it DOES flip two external runtime surfaces (npm registry, GitHub visibility) and bump a version string. Inventory:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no datastore keys change. | None |
| Live service config | (1) npm registry: name `medium-research-mcp` currently absent (404) → first publish creates it. (2) GitHub repo visibility: currently **private** → flip public. | Human-gated: `npm publish`; `gh repo edit --visibility public` |
| OS-registered state | None. | None |
| Secrets/env vars | None renamed. `npm login` needs a valid npm account/token at publish time (operator's, not in repo). | Operator provides npm auth at publish |
| Build artifacts / version strings | `package.json` version `1.1.0` → bump to `1.2.0` (D-04). Note: per-server `McpServer` `version` fields are `"1.0.0"` and the aggregator is already `"1.2.0"` — these are **MCP protocol identity versions, independent of the npm package version**; they do NOT need to change and their inconsistency is harmless (cosmetic). `git push` of 20+ unpushed `master` commits is required before the GitHub path reflects latest. | Edit package.json version; `git push origin master` before SC2 verify |

**Canonical question — after files are updated, what still has the old state?** The npm registry (until publish) and the remote GitHub `master` (20+ commits behind local — verified via `git log @{u}..HEAD`). Both are operator push/publish actions, not code edits.

## Common Pitfalls

### Pitfall 1: Live SC2 verification run BEFORE the repo is public + pushed
**What goes wrong:** `npx github:TusharKanjariya/medium-research-mcp …` 404s (private repo) or resolves to a stale commit (unpushed local work).
**Why it happens:** Repo is private now; `git log @{u}..HEAD` shows 20+ local-only commits on `master`. `[VERIFIED: git]`
**How to avoid:** Order the checkpoint strictly: (a) flip public, (b) `git push origin master`, (c) THEN run the clean-dir GitHub verify. Do the npm publish before the npm verify likewise.
**Warning signs:** `npm error 404` or an old installer behavior during verify.

### Pitfall 2: Local resolution masking the registry/github fetch during verify
**What goes wrong:** Running `npx -y medium-research-hn` from inside the repo working tree (or with a warm cache) resolves the *local* package, so the test passes without ever hitting the registry — a false green for SC1/SC2.
**Why it happens:** npx/npm prefer a local `node_modules`/project resolution and cache installed specs.
**How to avoid:** Verify from **outside** the repo, in a scratch dir, with a fresh cache. Concrete commands:
```bash
# npm path (SC1) — after publish
mkdir /tmp/verify-npm && cd /tmp/verify-npm
npm_config_cache=$(mktemp -d) npx -y medium-research-hn </dev/null   # should start on stdio, not ENOENT/404
npm_config_cache=$(mktemp -d) npx -y medium-research-all </dev/null  # aggregator

# github path (SC2) — after public + push
mkdir /tmp/verify-gh && cd /tmp/verify-gh
npm_config_cache=$(mktemp -d) npx --package=github:TusharKanjariya/medium-research-mcp medium-research-hn </dev/null
npx github:TusharKanjariya/medium-research-mcp install   # runs bin/install.js (default bin)
```
On Windows, run these from a folder outside the repo (e.g. `%TEMP%\verify-npm`); `npx --ignore-existing` is an alternative to a fresh cache dir.
**Warning signs:** Verify "passes" instantly with no download — you're hitting the local copy.

### Pitfall 3: `npm version minor` double-tagging against the manual checklist
**What goes wrong:** INSTALL.md's checklist already does `git tag v1.x.x` by hand; `npm version minor` also commits + tags, producing a duplicate/again-tag conflict or an unexpected commit in the human-gated flow.
**How to avoid:** Pick one: either `npm version minor --no-git-tag-version` (edits package.json only, operator tags manually per checklist) OR let `npm version minor` own the tag and remove the manual `git tag` line. Recommend the former to keep the existing checklist authoritative. `[CITED: docs.npmjs.com/cli/commands/npm-version]`

### Pitfall 4: README-in-tarball links to files the npm tarball doesn't ship
**What goes wrong:** `README.md` (which ships) links to `examples/pain-point-sweep.mjs`, `docs/PRD.md`, `docs/ARCHITECTURE.md` — none of which are in the `files` whitelist, so an npm-registry consumer clicking those in the unpacked package hits dead relative paths.
**Why it happens:** README written for the repo context, not the tarball context.
**How to avoid:** Low severity (links resolve fine on GitHub; the npm page renders README with GitHub-relative links working when `repository` is set). If adding `repository` metadata (Claude's discretion), those relative links resolve on npmjs.com. Not a blocker for any success criterion — note only.

## Code Examples

### `npm pack --dry-run` output (SC3 evidence — already correct)
```
34 files, 78.5 kB. Includes:
  bin/install.js
  servers/aggregator/server.js          <- the aggregator (SC3)
  servers/{hn,stackexchange,lobsters,lemmy,devto,github,librariesio,
           producthunt,rss,discourse,mastodon}/server.js   <- 11 servers
  shared/{auth,cache,contract,credentials,http_client,main,rank}.js
  docs/INSTALL.md, README.md, package.json
```
`[VERIFIED: npm pack --dry-run, 2026-07-23]`

### All bin imports resolve inside the whitelist (SC1 evidence)
```
servers/*/server.js  ->  ../../shared/{main,http_client,contract,credentials,auth}.js
bin/install.js       ->  ../shared/main.js
servers/aggregator   ->  ../<source>/server.js  (all 11, inside servers/)
```
No import references `examples/`, `scripts/`, or `test/`. `[VERIFIED: grep of servers,bin,shared/**/*.js]`

### GitHub install commands to document (DOC-02, GitHub section)
```bash
# Lead / installer (mirrors the npm `npx medium-research-mcp install`):
npx github:TusharKanjariya/medium-research-mcp install

# A specific single server over GitHub (requires --package):
npx --package=github:TusharKanjariya/medium-research-mcp medium-research-hn
npx --package=github:TusharKanjariya/medium-research-mcp medium-research-all
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Temp local-path `docs/claude_desktop_config.all-servers.json` (absolute `node` paths) | `npx medium-research-mcp install` (one-shot installer) + `npx -y medium-research-<source>` | Phase 9→10 | Stopgap retired (SC4); installer + published package replace it |
| Private repo, unpublished package | Public repo + public npm `medium-research-mcp@1.2.0` | This phase | Any machine installs with no clone |

**Deprecated/outdated:**
- `docs/claude_desktop_config.all-servers.json` — untracked stopgap; `rm` this phase. No references outside planning docs. `[VERIFIED: grep + git ls-files]`

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `npx github:owner/repo` accepts the `github:` shorthand spec (npm docs synopsis lists only `<pkg>[@version]`, but npx installs anything `npm install` accepts, which includes `github:`). | PKG-05 / Pattern 1 | LOW — the in-scope SC2 live verification is exactly what confirms this; if it failed, fall back to `npx github.com/owner/repo` or `git+https://…` spec. Resolve by the live run. |
| A2 | npm name `medium-research-mcp` is still unclaimed at publish time. | PKG-04 | HIGH if wrong — publish under the documented name fails. Mitigation: re-run `npm view medium-research-mcp version` immediately before `npm publish` (must 404). Verified 404 on 2026-07-23. |

**All other claims are [VERIFIED] against this repo or [CITED] from npm docs.**

## Open Questions

1. **Does `license` belong in package.json for a first public publish?**
   - What we know: `license`, `repository`, `homepage`, `bugs`, `author` are all currently **undefined** in package.json. `[VERIFIED]` npm warns and marks the package effectively proprietary without a `license`.
   - What's unclear: The project's intended license (an IP/business decision, not a mechanical one) — CONTEXT lists only `repository`/`homepage`/`bugs` as discretionary, silent on `license`.
   - Recommendation: The planner should surface `license` as a one-question decision for the operator alongside the publish (add e.g. `"license": "MIT"` + a LICENSE file, or `"UNLICENSED"` + `"private"` considerations). Adding `repository`/`homepage`/`bugs` is trivial and recommended (fixes Pitfall 4's README links on npmjs.com). Do not guess a license.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| npm CLI | pack/publish (PKG-04) | ✓ | (project uses npm; `npm pack` ran cleanly) | — |
| npm account + login | `npm publish` (PKG-04) | Operator-provided | — | None — publish blocks without auth (human gate) |
| git + push access | GitHub path + push latest (PKG-05) | ✓ | remote = TusharKanjariya/medium-research-mcp | — |
| `gh` CLI (optional) | `gh repo edit --visibility public` | Operator | — | GitHub web UI (Settings → Danger Zone) |
| Node ≥18 | running any bin | ✓ | `engines.node >=18` declared | — |

**Missing dependencies with no fallback:** npm-registry auth (`npm login`) is an operator credential, not in-repo — the publish step pauses for it by design.
**Missing dependencies with fallback:** `gh` CLI → GitHub web UI for the visibility flip.

## Security Domain

> `workflow.security_enforcement: true` in config → section included.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture | yes | Publish surface: confirm no secret ships in the tarball or over the git checkout |
| V6 Cryptography | no | No crypto changes this phase |
| V5 Input Validation | no | No new input surface (installer validation already landed Phase 9) |
| V14 Config / Supply chain | yes | First public publish — provenance, whitelist integrity, no postinstall scripts |

### Known Threat Patterns for a first public publish

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Secret leaks into published tarball | Information Disclosure | `npm pack --dry-run` review (done: 34 files, no `.env`, no `.planning/`, no `test/`); `files` whitelist governs the tarball. `.env` is `.gitignore`d so it also can't ship over the github path; `.env.example` holds placeholders only. `[VERIFIED]` |
| Malicious/unexpected lifecycle script runs on consumer install | Tampering / Elevation | package.json has **zero** lifecycle scripts (no `prepare`/`prepack`/`postinstall`/`prepublishOnly`). `[VERIFIED]` → `--ignore-scripts` install is a no-op that still starts the bins, proving no install-time code is needed. Document the `--ignore-scripts` verify in the checklist (already there). |
| Name-squat / wrong package installed | Spoofing | Re-confirm the name is unclaimed (`npm view` → 404) immediately before publish (A2). Unscoped public name is a one-way contract (D-03). |
| Repo made public exposes sensitive planning/history | Information Disclosure | Git checkout over the github path ships `.planning/`, `CLAUDE.md`, `.claude/`. Confirm these contain no secrets before the visibility flip (they are process docs; CLAUDE.md forbids hardcoded credentials). Low risk — note for operator awareness. |

**`--ignore-scripts` posture:** consistent and safe — there are no scripts to skip, so a `--ignore-scripts` consumer install behaves identically to a normal one and every bin still runs. `[VERIFIED]`

## Sources

### Primary (HIGH confidence)
- This repo's `package.json`, `bin/install.js`, `servers/aggregator/server.js`, all `servers/*/server.js` imports — inspected directly.
- `npm pack --dry-run` — actual tarball manifest (34 files) captured 2026-07-23.
- `git ls-files`, `git log @{u}..HEAD`, `git status` — tracking + push state.
- `npm view medium-research-mcp version` — 404 (name available), 2026-07-23.

### Secondary (MEDIUM confidence)
- `docs.npmjs.com/cli/v10/commands/npx` — default-bin selection rule and `--package` flag (quoted).
- `docs.npmjs.com/cli/commands/npm-version` — `npm version` commit/tag behavior.

### Tertiary (LOW confidence)
- A1 (github: spec acceptance by npx) — inferred from npm install spec support; resolved by the in-scope SC2 live verification.

## Metadata

**Confidence breakdown:**
- Tarball correctness / SC1 / SC3: HIGH — `npm pack --dry-run` + grep of every bin import, run this session.
- GitHub path / SC2 mechanics: HIGH for the default-bin rule (npm docs quoted); MEDIUM for `github:` spec resolution (resolved by the required live run).
- Temp-file deletion / SC4: HIGH — git-untracked + zero references verified.
- Publish/version mechanics: HIGH — no lifecycle scripts, no `.npmignore`, name 404 all verified.

**Research date:** 2026-07-23
**Valid until:** 2026-08-22 (stable; re-confirm the npm name 404 immediately before publish regardless)
</content>
</invoke>
