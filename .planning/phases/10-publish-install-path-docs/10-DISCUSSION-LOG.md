# Phase 10: Publish & Install-Path Docs - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-23
**Phase:** 10-Publish & Install-Path Docs
**Areas discussed:** Lead install path, INSTALL.md location, GitHub repo visibility, Release identity

---

## Lead install path

| Option | Description | Selected |
|--------|-------------|----------|
| One-shot installer | `npx medium-research-mcp install` leads — milestone headline; auto-detect, backup, merge, prompt keys. | ✓ |
| Aggregator entry | Lead with the single manual `medium-research-all` config entry. | |
| Per-source npm | Lead with the 11 individual `npx -y medium-research-<source>` entries. | |

**User's choice:** One-shot installer
**Notes:** The other three paths documented below as alternatives.

---

## INSTALL.md location

| Option | Description | Selected |
|--------|-------------|----------|
| Keep docs/INSTALL.md | Stays in place; already in `files` whitelist + linked from README. | ✓ |
| Promote to root INSTALL.md | More discoverable on GitHub landing; requires whitelist + README + file move. | |

**User's choice:** Keep docs/INSTALL.md
**Notes:** README keeps a short quickstart pointing to it.

---

## GitHub repo visibility

| Option | Description | Selected |
|--------|-------------|----------|
| Already public & pushed | Repo live; just verify github: path. | |
| Make it public this phase | Flip visibility + push latest, then verify live. | ✓ (after reversal) |
| Stays private | Would require rescoping PKG-05/SC2. | (initially chosen, then reversed) |

**User's choice:** Initially "Stays private" → then reversed to "will change repo visibility to public."
**Notes:** The private answer conflicted with PKG-05 + SC2 (live github: verification). On being flagged, user opted to make the repo public, keeping PKG-05/SC2 in scope as written.

---

## Release identity

| Option | Description | Selected |
|--------|-------------|----------|
| Unscoped, 1.2.0, checklist in INSTALL.md | Public unscoped `medium-research-mcp`; bump 1.1.0→1.2.0; checklist stays in INSTALL.md. | ✓ |
| Split checklist to RELEASE.md | Same publish; move checklist to a separate file. | |
| Scoped @TusharKanjariya/… | Publish scoped; changes every documented command + bin names. | |

**User's choice:** Unscoped, 1.2.0, checklist in INSTALL.md
**Notes:** npm name confirmed unclaimed (404) at gather time.

---

## PKG-05 / SC2 handling (follow-up)

| Option | Description | Selected |
|--------|-------------|----------|
| Defer PKG-05 to v2 | Drop github: path from scope. | |
| Document github: as future | Keep as blocked-on-public-repo, no live verify. | |
| Make repo public after all | Make repo public so PKG-05/SC2 stay as-is. | ✓ |

**User's choice:** "Ok then i will change repo visibility to public."
**Notes:** Resolved the private-repo conflict; no requirement deferral needed.

## Claude's Discretion

- INSTALL.md section ordering/wording below the lead path.
- How "verified live" is demonstrated for npm and GitHub paths (clean-machine npx run, spawn-test, inspector).
- Whether to add `repository`/`homepage`/`bugs` metadata to `package.json` with the publish.

## Deferred Ideas

- `.mcpb` aggregator bundle — already in ROADMAP Future/Deferred.
- `package.json` provenance metadata — recommended but optional.
