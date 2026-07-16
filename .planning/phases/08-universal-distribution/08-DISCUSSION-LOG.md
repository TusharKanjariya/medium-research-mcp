# Phase 8: Universal Distribution - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-16
**Phase:** 8-universal-distribution
**Areas discussed:** .mcpb scope, Release vs prep, npm name/scope, Docs + recipe form

---

## .mcpb scope (PKG-01)

| Option | Description | Selected |
|--------|-------------|----------|
| All 11, this phase | One staging script + spawn-test harness; validated `.mcpb` for every server incl. credentialed. Fully satisfies PKG-01. | ✓ |
| Keyless first, defer creds | Ship 9 keyless bundles now, defer librariesio/producthunt to v2. Partial PKG-01. | |
| Defer all .mcpb to v2 | Ship npm + npx + docs only; PKG-01 → v2. Smallest phase. | |

**User's choice:** Deferred to Claude — "I have no idea what to do, suggest me best and easy to use."
**Notes:** Recommended All-11 because Claude Desktop is the primary consumer and `.mcpb` is its one-click install path (deferring makes install *harder* for the main client); marginal cost per bundle is low once the single staging script exists. User accepted.

---

## Release vs prep

| Option | Description | Selected |
|--------|-------------|----------|
| Prep + manual gate | Produce package + 11 bundles + docs, dry-run validated; leave `npm publish` + tag as a manual command the user runs. | ✓ |
| Publish in-phase | Phase runs `npm publish` + release itself. | |

**User's choice:** Prep + manual gate.
**Notes:** Publishing is irreversible/outward-facing and needs npm login/2FA — kept out of automated execution. Solo/Windows flow.

---

## npm name/scope (PKG-02)

| Option | Description | Selected |
|--------|-------------|----------|
| medium-research-mcp (unscoped) | Matches repo + manifest naming, ties to `medium-blog-pro`, one name to claim. Bins `medium-research-<source>`, bump to 1.1.0. | ✓ |
| Scoped @scope/... | Guaranteed availability under user's npm org. | |

**User's choice:** Deferred to Claude — "Suggest me a good MCP name."
**Notes:** Recommended keeping `medium-research-mcp` to avoid churning 11 manifests + docs for zero functional gain; the name deliberately ties to the skill it feeds. Fallback `@<username>/medium-research-mcp` if taken at publish (zero code change). User accepted implicitly by choosing "Write CONTEXT.md."

---

## Docs + recipe form (PKG-03 / DOC-01)

| Option | Description | Selected |
|--------|-------------|----------|
| (Claude's discretion) | Client list, docs home, recipe format. | ✓ |

**User's choice:** Delegated to Claude.
**Notes:** Decided: document the 4 required clients (Claude Desktop, Cursor, Codex, OpenCode) + a Claude Code plugin-path note; per-OS config (Windows `cmd /c npx -y` + Unix `npx -y`) with explicit `env` blocks; docs home `docs/INSTALL.md` linked from README; DOC-01 shipped as a runnable `examples/pain-point-sweep.mjs` plus prose pointer (smoke-testable, beats prose-only).

---

## Claude's Discretion

- Staging-script layout, ignore-file contents, temp-dir handling, `dist/` output location (within D-02/D-03)
- Whether to add a second-OS (Unix) smoke beyond Windows
- README vs dedicated docs page split (keep `docs/INSTALL.md` canonical)

## Deferred Ideas

- Second-OS (Unix) client smoke — nice-to-have hardening, not blocking for a Windows-primary solo tool
- SEC-03 (IP-pinning) and SRC-12 (Bluesky) remain v2+ per REQUIREMENTS
- Post-v1.1 packaging polish (auto-generated per-server READMEs, CI publish workflow)
