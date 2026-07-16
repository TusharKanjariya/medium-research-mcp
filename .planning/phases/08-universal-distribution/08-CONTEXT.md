# Phase 8: Universal Distribution - Context

**Gathered:** 2026-07-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Package the complete, now-frozen 11-server tool surface so any MCP client on any
OS can install and run it. Delivers:

- **PKG-01** — one-click `.mcpb` custom-connector bundles (staged build so
  `../../shared` imports survive; credentials `sensitive` in `user_config`)
- **PKG-02** — one scoped-or-unscoped npm package, `npx`-runnable, a `bin` entry
  per server, Windows-safe shebangs
- **PKG-03** — per-client setup docs (Claude Desktop, Cursor, Codex, OpenCode +
  a Claude Code plugin-path note) with per-OS spawn config and env blocks
- **DOC-01** — cross-source pain-point sweep recipe (one tag → SE + Discourse +
  Mastodon + Dev.to, merged via `mergeRank`)

**This phase adds only dev-time packaging tooling and docs. The output contract,
every server's tool surface, and all runtime behavior are FROZEN — packaging must
not change them.** New capabilities belong in other phases/milestones.

</domain>

<decisions>
## Implementation Decisions

### `.mcpb` scope (PKG-01)
- **D-01:** Ship `.mcpb` bundles for **all 11 servers** in v1.1 — including the
  two credentialed servers (`librariesio`, `producthunt`). Rationale: Claude
  Desktop is the primary consumer and `.mcpb` is its *one-click* install path, so
  this is the headline install UX, not a nice-to-have. The hard work is one
  staging build script; the remaining 10 bundles are mechanical once it works.
  Fully satisfies PKG-01 (no partial/defer).
- **D-02:** Build via a **single staging script** (e.g. `scripts/build-mcpb.mjs`)
  that, per server, stages `servers/<name>/` + `shared/` + a production-only
  `node_modules` (`npm ci --omit=dev` against the root lockfile) into a temp dir
  **preserving relative import depth** (so `../../shared/*.js` resolves), then
  runs `mcpb pack` on the stage — **never** pack the live source tree (Pitfall 7).
- **D-03:** Every bundle is validated two ways before it counts as done:
  `mcpb validate` (manifest) **and** an actual `node` **spawn test** of the staged
  entry point. Bundle must not include `test/` or dev deps (ignore file); size
  sanity-check (not source-only KB, not tens of MB).
- **D-04:** Credentialed-server keychain delivery (`${user_config.*}` → env) is
  verified with **one manual Claude Desktop smoke** per credentialed server,
  reusing the Phase 6/7 throwaway scratchpad-harness pattern. Confirm the "set X"
  error also names the `user_config` field, not just the env var (Pitfall 8).
- **D-05:** Check/refresh `manifest_version` against the current MCPB spec; the
  v1.0 scaffold manifests are `"0.3"` and may need a bump. Assert every manifest
  `user_config` env ref matches an `ENV_VAR` entry in `shared/credentials.js`
  (a ~5-line test — `ENV_VAR` stays the single source of truth).

### Release mechanics (npm publish / distribution)
- **D-06:** **Prep + manual gate.** This phase produces the publishable package,
  all 11 validated `.mcpb` bundles, and the docs — all **dry-run validated**
  (`npm pack` tarball inspection, `mcpb validate` + spawn test). The actual
  `npm publish`, `.mcpb` distribution, and git tag / GitHub release are left as
  **documented commands the user runs manually** (e.g. `!npm publish`, tag
  `v1.1.0`). Rationale: publishing is irreversible/outward-facing and needs the
  user's npm login/2FA — it must not run inside automated execution.
- **D-07:** `npm pack` tarball must be inspected to confirm `files` includes
  `servers/` **and** `shared/` (else the same `ERR_MODULE_NOT_FOUND` as Pitfall 7
  ships to npm). Test the tarball install on Windows before the manual publish.

### npm package identity (PKG-02)
- **D-08:** Package name = **`medium-research-mcp`** (unscoped). Matches the repo
  name and the existing manifest naming (`medium-research-hn`), ties to the
  `medium-blog-pro` skill it feeds, one name to claim, no npm org setup. If the
  name is taken at publish time, fallback is `@<npm-username>/medium-research-mcp`
  with zero code change (the name only binds at `npm publish`).
- **D-09:** `bin` map = **one entry per server**, named `medium-research-<source>`
  (11 bins: hn, stackexchange, lobsters, lemmy, devto, github, librariesio,
  producthunt, rss, discourse, mastodon). Each bin file: shebang
  `#!/usr/bin/env node` first, then load the server; keep `"type": "module"`.
- **D-10:** Version bump `1.0.0` → **`1.1.0`**; unset `"private": true`; add a
  `files` whitelist (`servers/`, `shared/`, docs as needed). No build step for the
  npm path (source is already ESM-runnable).

### Client docs (PKG-03)
- **D-11:** Document **Claude Desktop, Cursor, Codex, OpenCode** (the four
  required) **plus a short Claude Code plugin-path note** (the hn manifest already
  flags its `${user_config.*}` silent-spawn-failure gotcha — surface it, don't
  hide it).
- **D-12:** Every client snippet shows **per-OS** config: Windows
  `"command": "cmd", "args": ["/c", "npx", "-y", ...]` and Unix `npx -y ...`
  (always `-y` — omitting it hangs a stdio server on the cold-start prompt,
  Pitfall 9). Each credentialed server's snippet shows an explicit **`env` block**;
  state plainly that GUI clients do **not** inherit shell-exported vars (Pitfall 10).
- **D-13:** Docs home = **`docs/INSTALL.md`** with per-client sections, linked from
  README. Windows-first (the dev's own platform).

### DOC-01 recipe
- **D-14:** Ship the cross-source pain-point sweep as a **runnable
  `examples/pain-point-sweep.mjs`** (one tag → Stack Exchange + Discourse +
  Mastodon + Dev.to → `mergeRank`) that *is* the recipe, plus a short prose
  pointer in the docs. Runnable (smoke-testable) beats prose-only — unlike the
  docs-only ABLOG-05 recipes, this one can actually execute against live APIs.

### Claude's Discretion
- Exact staging-script layout, the `.mcpbignore`/ignore-file contents, temp-dir
  handling, and whether bundles are emitted to `dist/` — planner/executor's call,
  within D-02/D-03.
- Whether a second-OS (Unix) smoke is added beyond Windows — nice-to-have; the
  required smoke surface is Windows + at least one documented client (Pitfall 10
  suggests one Unix-like too, but not blocking for a Windows-primary solo tool).
- README vs a dedicated docs page split — keep `docs/INSTALL.md` canonical (D-13).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` §Universal Distribution (PKG) + §Documentation (DOC) — PKG-01, PKG-02, PKG-03, DOC-01 acceptance criteria
- `.planning/ROADMAP.md` §"Phase 8: Universal Distribution" — goal + 4 success criteria

### Distribution research (the core inputs — read in full)
- `.planning/research/PITFALLS.md` §Pitfall 7 (`.mcpb` breaks `../../shared` — stage repo + vendored prod node_modules, spawn-test each), §8 (`${user_config.*}` env/keychain per-host variance), §9 (Windows `spawn npx ENOENT` → `cmd /c npx -y`; cold-start timeout; ESM shebang), §10 (clients don't inherit shell env/cwd — explicit `env` blocks per doc)
- `.planning/research/PITFALLS.md` §Technical Debt Patterns + §Integration Gotchas (MCPB / npm-npx / clients rows)
- `.planning/research/SUMMARY.md` §"Phase 4: Universal distribution" / distribution paragraphs — one package + bin-per-server, `@anthropic-ai/mcpb@2.1.2` devDependency, `build-mcpb.mjs` staging
- `.planning/research/STACK.md` — confirms zero new runtime deps; mcpb devDependency only

### Scaffold & code the packaging wraps
- `servers/hn/manifest.json` — canonical scaffold manifest shape (KNOWN GOTCHA note; `user_config`/`sensitive`/`mcp_config.env`); all 11 manifests mirror it
- `shared/credentials.js` §`ENV_VAR` — single source of truth for env-var names; manifests must match it
- `package.json` — current root package (`private:true`, name `medium-research-mcp`, `type:module`, deps) — the artifact PKG-02 modifies
- `CLAUDE.md` §"How to add a new server" note 6 — `.mcpb` packing deferred to v2 (PKG-01); this phase activates it
- `.planning/codebase/STRUCTURE.md`, `.planning/codebase/INTEGRATIONS.md` — repo layout + how servers import `shared/`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **All 11 `servers/*/manifest.json`** already exist as scaffold with the
  `user_config`/`sensitive` keychain pattern and `mcp_config.env` `${user_config.*}`
  refs — packaging activates them, does not author them from scratch.
- **`shared/rank.js` `mergeRank`** — the DOC-01 recipe merges cross-source results
  through it (already proven live across 6 sources in v1.0). No new merge code.
- **Phase 6/7 scratchpad-harness pattern** (throwaway `.mjs` importing a server's
  exported functions + `getJson`/`getText`, run against real instances) — reuse
  for `.mcpb` spawn/smoke checks and the `pain-point-sweep.mjs` example.
- **`shared/credentials.js` `ENV_VAR` map** — reuse as the manifest-consistency
  assertion source.

### Established Patterns
- Every server imports `../../shared/*.js` and all deps live in one **root
  `node_modules`** — this is exactly what a naive `.mcpb` pack breaks (Pitfall 7);
  the staging script must preserve that relative depth.
- Servers are **network-only, no cwd/relative-file dependence** — good for spawn
  under client-defined cwd (Pitfall 10). Keep it that way (audit, don't add file I/O).
- ESM throughout (`"type": "module"`, SDK is ESM-only) — bin shebangs + `type:module`
  are mandatory (Pitfall 9).

### Integration Points
- `package.json` gains `bin`, `files`, version bump, `private` removal, and a
  `build-mcpb` script; new `scripts/build-mcpb.mjs`; new `docs/INSTALL.md`; new
  `examples/pain-point-sweep.mjs`. No server source changes beyond thin bin
  wrappers (if the entry `server.js` isn't already directly `bin`-able).

</code_context>

<specifics>
## Specific Ideas

- User had no strong priors on packaging mechanics and explicitly delegated the
  "best / easiest to use" path — hence the recommendations above lean on the
  research (Pitfalls 7–10) and the "Claude Desktop one-click is the headline UX"
  framing. The consuming client reality (primary = Claude Desktop; dev machine =
  Windows) drives the all-11-`.mcpb` + Windows-first decisions.
- Publishing must stay a human-run command — the user is a solo operator and the
  action is irreversible/outward-facing.

</specifics>

<deferred>
## Deferred Ideas

- **Second-OS (Unix) client smoke** beyond Windows — nice-to-have hardening;
  Pitfall 10 recommends it, but not blocking for a Windows-primary solo tool.
  Planner may include a light Unix smoke if cheap.
- **SEC-03** (IP-pinning DNS-rebinding fix) and **SRC-12** (Bluesky) remain v2+
  per REQUIREMENTS — out of this phase.
- Any post-v1.1 packaging polish (auto-generated per-server READMEs, CI publish
  workflow) — not in scope; this phase ships the artifacts + manual publish gate.

### Reviewed Todos (not folded)
None — the pending-todos scan returned no matches for this phase.

</deferred>

---

*Phase: 8-universal-distribution*
*Context gathered: 2026-07-16*
