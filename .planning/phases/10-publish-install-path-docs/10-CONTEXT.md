# Phase 10: Publish & Install-Path Docs - Context

**Gathered:** 2026-07-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the existing `medium-research-mcp` package publicly installable and document
every install path. Three deliverables (PKG-04, PKG-05, DOC-02):

1. **PKG-04** — publish the package publicly to npm (unscoped `medium-research-mcp`)
   so the documented `npx -y medium-research-<source>` config works on any machine.
2. **PKG-05** — make the GitHub repo public and verify the
   `npx github:TusharKanjariya/medium-research-mcp` install path works **live** on a
   clean machine (not just documented).
3. **DOC-02** — rewrite `docs/INSTALL.md` around all four install paths (one-shot
   installer, aggregator, per-source npm, GitHub) and retire the temp
   `docs/claude_desktop_config.all-servers.json` local-path file.

No new server code, no new tools — Phase 9 already put the aggregator and installer
in the tarball. This phase publishes, verifies, and documents.

`npm publish` and the GitHub visibility flip are **human-gated operator steps** —
execution pauses for the operator; do not automate.
</domain>

<decisions>
## Implementation Decisions

### INSTALL.md structure (DOC-02)
- **D-01:** **One-shot installer leads.** `npx medium-research-mcp install` is
  presented first as the recommended path for a new reader (the milestone's
  headline: auto-detects client, backs up, non-destructive merge of the aggregator
  entry, prompts for the 2 keys). The other three paths — aggregator manual entry,
  per-source npm `npx -y medium-research-<source>`, and GitHub `npx github:…` —
  are documented below it as alternatives.
- **D-02:** **INSTALL.md stays at `docs/INSTALL.md`.** No move to root. It is already
  in the package `files` whitelist and linked from README. README keeps a short
  quickstart that points to it. — **Reversibility:** reversible.

### Release identity (PKG-04)
- **D-03:** **Publish unscoped, public `medium-research-mcp`.** The npm name is
  currently unclaimed (verified 404), so the documented `npx -y medium-research-<source>`
  commands and bin names work as-is with no scope prefix. — **Reversibility:**
  one-way — once published to npm under this name, the name and the `npx` command
  surface are a public contract; renaming/scoping later breaks every documented
  install command and any downstream config already written.
- **D-04:** **Bump `1.1.0` → `1.2.0`** (minor, matches the v1.2 One-Shot Install
  milestone) as part of the human release checklist.
- **D-05:** **Human release checklist stays in `docs/INSTALL.md`** (its current
  location, §272-ish): version bump, `npm pack --dry-run` tarball inspection,
  `--ignore-scripts` install verification, `files` whitelist intact, `npm login` +
  `npm publish`. Not split into a separate RELEASE.md.

### GitHub install path (PKG-05)
- **D-06:** **Make the repo public this phase, then verify live.** The repo
  (`github.com/TusharKanjariya/medium-research-mcp`) is currently private. This
  phase includes the operator action of flipping visibility to public and pushing
  latest, after which `npx github:TusharKanjariya/medium-research-mcp` is verified
  end-to-end on a machine with no clone. `<owner>` resolves to `TusharKanjariya`.
  — **Reversibility:** one-way (practically) — a public repo can be re-privatized,
  but the published npm package and any external clones/forks persist. Treat the
  visibility flip as a deliberate, gated release step.
- **D-07:** PKG-05 and SC2 stay **in scope as written** (the user reversed an
  initial "keep private" answer). No requirement deferral needed.

### Retire the temp file (DOC-02)
- **D-08:** Delete `docs/claude_desktop_config.all-servers.json` — the installer now
  automates what that stopgap did (SC4 requires it be gone). Confirm nothing in
  README/INSTALL still links to it before removing.

### Claude's Discretion
- Exact INSTALL.md section ordering/wording below the lead path; how the four paths
  are visually delineated.
- How "verified live" for the npm and GitHub paths is demonstrated (clean-machine /
  clean-dir `npx` run, spawn-test, or inspector) — the planner's call, provided both
  paths are actually exercised, not just documented (SC1, SC2).
- Whether to add `repository`/`homepage`/`bugs` metadata to `package.json` alongside
  the publish (recommended for npm provenance, but not required by the criteria).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Install docs & the file being rewritten (authoritative)
- `docs/INSTALL.md` — the file DOC-02 rewrites. Holds the four per-client config
  formats (Claude Desktop, Cursor, Codex CLI, OpenCode) and the existing human
  release checklist. Lead path becomes `npx medium-research-mcp install`.
- `docs/claude_desktop_config.all-servers.json` — temp local-path stopgap to
  **delete** this phase (SC4).
- `README.md` — keeps a short quickstart pointing at `docs/INSTALL.md`.

### Package / publish surface
- `package.json` — `name` (`medium-research-mcp`), `version` (bump 1.1.0→1.2.0),
  `bin` (13 bins incl. `medium-research-all` + `medium-research-mcp` installer),
  `files` whitelist (`servers/`, `shared/`, `bin/`, `docs/INSTALL.md`, `README.md`)
  — the tarball contents SC3 verifies via `npm pack --dry-run`.
- `bin/install.js` — the one-shot installer (the lead documented path).

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` — PKG-04, PKG-05, DOC-02 acceptance wording.
- `.planning/ROADMAP.md` §"Phase 10" — goal, the human-gated checkpoint, and the
  4 success criteria.

### Frozen constraints (do not break)
- `CLAUDE.md` / `.claude/CLAUDE.md` — output contract, credential rules; unchanged
  by a publish/docs phase but must not regress.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`docs/INSTALL.md` per-client blocks** — the config shapes to reference/reorder
  in the rewrite; don't reinvent formats.
- **`package.json` `files` whitelist** — already ships `docs/INSTALL.md` + the bins;
  the aggregator (`medium-research-all`) and installer (`bin/install.js`) land in
  the tarball via `servers/` and `bin/` (SC3 verifies).

### Established Patterns
- Publishing is human-gated (roadmap Checkpoint): version bump → `npm pack --dry-run`
  inspect → `--ignore-scripts` verify → `npm login` → `npm publish`. Execution pauses
  for the operator.
- Prior phase (v1.1 Phase 8) already proved the npx-runnable package + `isEntry()`
  bin guard work under copy/registry installs — this phase just makes it public.

### Integration Points
- npm registry (new: first public publish) and GitHub repo visibility (new: private→
  public) are the two external, human-gated surfaces this phase touches.
- No source/tooling code changes required beyond `package.json` metadata/version and
  the INSTALL.md/README doc edits + temp-file deletion.
</code_context>

<specifics>
## Specific Ideas

- The "one command, everything installed" feel from Phase 9 carries into the docs:
  the installer path should read as the shortest, most confident path for a newcomer.
- `<owner>` in all PKG-05 references = `TusharKanjariya` (from the git remote).
- npm name `medium-research-mcp` confirmed available (404 on registry) at gather time
  — planner/operator should re-confirm right before publish in case it's claimed.
</specifics>

<deferred>
## Deferred Ideas

- **`.mcpb` aggregator bundle** — already in ROADMAP Future/Deferred; not this phase.
- **`repository`/`homepage`/`bugs` package.json metadata** — recommended but optional
  (Claude's discretion, D-08 note); include with the publish if trivial.

None expand Phase 10 scope — discussion stayed within the publish/docs boundary.
</deferred>

---

*Phase: 10-Publish & Install-Path Docs*
*Context gathered: 2026-07-23*
