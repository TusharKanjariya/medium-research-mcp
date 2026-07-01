# Phase 1: Foundation & Credential Infrastructure - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-01
**Phase:** 1-Foundation & Credential Infrastructure
**Areas discussed:** Contract enforcement, Reddit in auth.js, Test harness, Package structure

---

## Contract enforcement

| Option | Description | Selected |
|--------|-------------|----------|
| Shared schema + factory | Shared module exports Zod schemas + `normalizeItem()`/`buildEnvelope()` every server imports | ✓ |
| Shared schema, per-server build | Share Zod schema as outputSchema, each server writes its own mapping | |
| Documented convention | No shared module; each server follows ARCHITECTURE §4 by hand | |

**User's choice:** Shared schema + factory
**Notes:** Highest-leverage call — directly serves the core value (uniform output). Adding a source becomes pure field-mapping; contract cannot drift.

---

## Reddit in auth.js

| Option | Description | Selected |
|--------|-------------|----------|
| Lemmy-only, leave a seam | Build Lemmy login now; structure for Reddit later | |
| Build Reddit grant too | Full Reddit OAuth2 password grant now | |
| Drop Reddit entirely | Lemmy + subreddit .rss replace Reddit | |

**User's choice:** Free-text — "give option to enter their username and password and try to access the subreddit, and Lemmy too."
**Notes:** Surfaced the technical reality that Reddit's password grant also requires a karma-gated script app (username/password alone is insufficient), while public subreddit reads are keyless via `.json`/`.rss`. Re-asked with that context.

### Follow-up: How should the Reddit path work?

| Option | Description | Selected |
|--------|-------------|----------|
| Keyless + optional login | Keyless public reads by default; optional password grant (username/password + app id/secret) for restricted/higher-limit; degrade to keyless. Lemmy keeps login. | ✓ |
| Keyless reads only | Public subreddit reads only, no Reddit login path | |
| Full login required | Strictly password grant, no keyless fallback | |

**User's choice:** Keyless + optional login
**Notes:** Honors the "option to enter username/password" intent while working out of the box and not depending on the karma-gated app. Docs must be explicit about the app-credential requirement.

---

## Test harness

| Option | Description | Selected |
|--------|-------------|----------|
| node:test built-in | Node's built-in `node:test` + `node:assert`, zero deps, `node --test` | ✓ |
| Vitest | Add vitest dev dependency | |

**User's choice:** node:test built-in
**Notes:** Matches the no-external-runtime ethos; sets the test pattern for all servers.

---

## Package structure

| Option | Description | Selected |
|--------|-------------|----------|
| Single root package.json | One root package.json; servers import `../../shared` | ✓ |
| Per-server package.json | npm workspaces; each server independently buildable | |

**User's choice:** Single root package.json
**Notes:** Matches ARCHITECTURE §2; per-server `.mcpb` bundling handled later by `build-mcpb.sh` staging, so workspaces aren't needed upfront.

## Claude's Discretion

- Internal `shared/` file/function names beyond the public API, retry jitter, cache-key derivation.
- HN `type` enum mapping (story/ask/show/job).

## Deferred Ideas

- Dedicated Reddit reader server (keyless `.json` + optional auth) — roadmap backlog; read-only Reddit currently via RSS `.rss` in Phase 4.
- Per-server `package.json` / npm workspaces — revisit for `.mcpb` distribution (PKG-01, v2).
- vitest/framework tests — only if `node:test` proves limiting.
