# Phase 8: Universal Distribution - Research

**Researched:** 2026-07-16
**Domain:** Dev-time packaging & distribution of an 11-server Node/stdio MCP suite (`.mcpb` bundles + npm/npx + per-client docs)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Ship `.mcpb` for ALL 11 servers in v1.1, including credentialed (`librariesio`, `producthunt`). Fully satisfies PKG-01, no partial/defer.
- **D-02:** Build via a **single staging script** (e.g. `scripts/build-mcpb.mjs`): per server, stage `servers/<name>/` + `shared/` + a production-only `node_modules` (`npm ci --omit=dev` against the root lockfile) into a temp dir **preserving relative import depth** (so `../../shared/*.js` resolves), then run `mcpb pack` on the stage. **Never** pack the live source tree.
- **D-03:** Every bundle validated two ways: `mcpb validate` (manifest) **and** a real `node` **spawn test** of the staged entry point. No `test/` or dev deps in the bundle (ignore file). Size sanity-check.
- **D-04:** Credentialed-server keychain delivery (`${user_config.*}` → env) verified with one manual Claude Desktop smoke per credentialed server (reuse Phase 6/7 throwaway scratchpad-harness). Confirm the "set X" error also names the `user_config` field.
- **D-05:** Check/refresh `manifest_version` against current spec. Assert every manifest `user_config` env ref matches an `ENV_VAR` entry in `shared/credentials.js` (~5-line test).
- **D-06:** **PREP + MANUAL GATE.** Phase produces dry-run-validated artifacts. Actual `npm publish`, `.mcpb` distribution, git tag/release are documented commands the USER runs. No automated publish.
- **D-07:** `npm pack` tarball must be inspected to confirm `files` includes `servers/` AND `shared/`. Test tarball install on Windows before manual publish.
- **D-08:** Package name = **`medium-research-mcp`** (unscoped). Fallback `@<npm-username>/medium-research-mcp` (binds only at publish; zero code change).
- **D-09:** `bin` map = one entry per server, `medium-research-<source>` (11 bins). Each bin: shebang `#!/usr/bin/env node` first; keep `"type": "module"`.
- **D-10:** Version `1.0.0` → `1.1.0`; unset `"private": true`; add `files` whitelist (`servers/`, `shared/`, docs as needed). No build step for the npm path.
- **D-11:** Document Claude Desktop, Cursor, Codex, OpenCode + a short Claude Code plugin-path note (surface the `${user_config.*}` silent-spawn gotcha).
- **D-12:** Every client snippet shows per-OS config: Windows `cmd /c npx -y ...`, Unix `npx -y ...` (always `-y`). Each credentialed snippet shows an explicit `env` block; state GUI clients do NOT inherit shell-exported vars.
- **D-13:** Docs home = `docs/INSTALL.md`, per-client sections, linked from README, Windows-first.
- **D-14:** DOC-01 = runnable `examples/pain-point-sweep.mjs` (one tag → SE + Discourse + Mastodon + Dev.to → `mergeRank`) + short prose pointer.

### Claude's Discretion
- Exact staging-script layout, `.mcpbignore` contents, temp-dir handling, whether bundles emit to `dist/` (within D-02/D-03).
- Whether a second-OS (Unix) smoke is added beyond Windows (nice-to-have; Windows + one documented client is the required surface).
- README vs dedicated docs page split — keep `docs/INSTALL.md` canonical.

### Deferred Ideas (OUT OF SCOPE)
- Second-OS (Unix) client smoke beyond Windows — planner may include a light one if cheap, not blocking.
- SEC-03 (IP-pinning DNS-rebinding fix), SRC-12 (Bluesky) — v2+.
- Post-v1.1 packaging polish (auto-generated per-server READMEs, CI publish workflow) — not in scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PKG-01 | One-click `.mcpb` custom-connector bundles for all 11 servers; `../../shared` survives; creds `sensitive` in `user_config` | Staging layout (Option A, §Architecture) keeps `../../shared` byte-identical; `mcpb pack` bundles vendored `node_modules`; manifest_version 0.3 verified current; per-server manifest cleanup table (§Manifest Cleanup) |
| PKG-02 | One unscoped npm package `medium-research-mcp`, `npx`-runnable, `bin` per server, Windows-safe shebangs | `bin`-ability verified empirically (§Pitfall B); shebang + `type:module` + `files` whitelist recipe; `npm pack` inspection commands |
| PKG-03 | Per-client setup docs (Claude Desktop, Cursor, Codex, OpenCode + Claude Code plugin note), per-OS spawn + env blocks | Current config schemas for all five clients verified this session (§Client Config Matrix) |
| DOC-01 | Runnable `examples/pain-point-sweep.mjs` merging one tag across SE + Discourse + Mastodon + Dev.to via `mergeRank` | `mergeRank` input shape confirmed; exported per-server helpers mapped (§DOC-01 Recipe) |
</phase_requirements>

## Summary

This phase is **dev-time packaging tooling + docs only** — the frozen output contract, tool surface, and runtime behavior must not change. Every execution-time unknown flagged by the discuss step is now resolved with live verification (npm registry, official `mcpb` CLI.md/MANIFEST.md, and empirical tests run this session on this Windows machine).

The three headline facts: (1) the mcpb CLI is still published as **`@anthropic-ai/mcpb@2.1.2`** (bin `mcpb`); the GitHub repo moved to `modelcontextprotocol/mcpb` but neither `@modelcontextprotocol/mcpb` nor bare `mcpb` exist on npm — do not depend on those. (2) **`manifest_version` "0.3" is current** (spec last updated 2025-12-02) — the scaffold manifests need no version bump. (3) `mcpb pack <dir>` **automatically zips `node_modules`** from the staged directory (excluding `.cache`/`.bin`), so the whole job reduces to staging a directory whose layout keeps `../../shared` and the bare `node_modules` resolvable, then pointing the manifest `entry_point` at it.

**Primary recommendation:** Stage each bundle in **repo-mirroring layout** (Option A): stage root holds `manifest.json` + `node_modules/` + `shared/` + `servers/<name>/server.js`, with `entry_point`/`args` retargeted to `servers/<name>/server.js`. This keeps every `server.js` **byte-identical** (no import rewriting), resolves `../../shared/*.js` and bare deps natively, and matches how `mcpb pack` bundles. For npm, add a `#!/usr/bin/env node` shebang to each `server.js` and list it directly as a `bin` target — verified to work for `npx`/registry (copy) installs including Windows `cmd /c npx`. One robustness caveat on the existing main-guard under symlinked installs is documented below.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `.mcpb` bundle build | Dev-time build script (`scripts/build-mcpb.mjs`) | `@anthropic-ai/mcpb` CLI | Staging + `mcpb pack` is a repo-local build step; produces artifacts, changes no runtime code |
| npm/npx distribution | `package.json` (`bin`/`files`/`version`) + shebangs | Node runtime on client machine | npx spawns `node server.js` from the published tarball; no build/bundler |
| Credential delivery to server | MCP client (keychain/`user_config` → env) | `shared/credentials.js` (unchanged) | Client injects env; server reads it via the existing single-source-of-truth accessor |
| Per-client spawn config | Docs (`docs/INSTALL.md`) | Each client's config file | Every client spawns the same stdio process; only the config wrapper differs |
| Cross-source merge (DOC-01) | `examples/pain-point-sweep.mjs` | `shared/rank.js` `mergeRank` (unchanged) | Example composes existing exported helpers; no new merge code |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@anthropic-ai/mcpb` | **2.1.2** (latest, verified 2026-07-16) | `.mcpb` pack/validate CLI | Official Anthropic package; bin `mcpb`; the only supported `.mcpb` tool `[VERIFIED: npm registry]` |
| npm `bin` + `#!/usr/bin/env node` | n/a (Node built-in) | npx distribution | Plain ESM runs directly on Node ≥18; no bundler needed `[VERIFIED: this session]` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@modelcontextprotocol/inspector` | latest via npx | Manual server smoke | Already used (`npm run inspect:hn`); optional per-server smoke |

**Installation:**
```bash
npm install -D @anthropic-ai/mcpb@2.1.2   # devDependency only — never a runtime dep
```

**Do NOT install:** `@modelcontextprotocol/mcpb` or `mcpb` (both return npm 404 — they do not exist), any bundler (esbuild/rollup), or `mcpb` as a runtime dep (it would bloat every bundle). `[VERIFIED: npm registry]`

## Package Legitimacy Audit

| Package | Registry | Age | Maintainers | Source Repo | Verdict | Disposition |
|---------|----------|-----|-------------|-------------|---------|-------------|
| `@anthropic-ai/mcpb` | npm | latest 2.1.2 | `*@anthropic.com` (zak, ben, nikhil, ejlangev, jv, ollie, packy) | github.com/modelcontextprotocol/mcpb (formerly anthropics/mcpb) | **OK** | Approved (devDependency) |

**Packages removed due to [SLOP]:** none.
**Packages flagged [SUS]:** none. Official Anthropic-maintained package; all maintainer emails `@anthropic.com`; not deprecated. `[VERIFIED: npm registry — npm view maintainers/deprecated]`

> Note: the automated `gsd-tools query package-legitimacy check` seam was not resolvable on PATH in this environment; verdict established directly via `npm view @anthropic-ai/mcpb version/maintainers/deprecated/bin` (2.1.2, `@anthropic.com` maintainers, bin `mcpb`, not deprecated).

## Architecture Patterns

### `.mcpb` bundle data flow

```
scripts/build-mcpb.mjs  (run once per server, loop over 11)
  │
  ├─ npm ci --omit=dev  ─────────────►  prod node_modules  (sdk, fast-xml-parser, zod)
  │                                       (cache/reuse across the 11 bundles)
  ├─ mkdtemp <stage>/
  │     ├─ manifest.json          ◄── cleaned per-server manifest (entry_point retargeted)
  │     ├─ node_modules/          ◄── copied prod deps
  │     ├─ shared/                ◄── copied verbatim  (contract, http_client, cache,
  │     │                              credentials, auth, rank)
  │     └─ servers/<name>/        ◄── copied verbatim  (server.js BYTE-IDENTICAL)
  │
  ├─ mcpb validate <stage>                       ── gate 1: manifest valid
  ├─ node <stage>/servers/<name>/server.js       ── gate 2: spawns, connects stdio
  └─ mcpb pack <stage>  dist/medium-research-<name>.mcpb
        │  (auto-zips node_modules minus .cache/.bin; applies .mcpbignore)
        ▼
   dist/medium-research-<name>.mcpb   ──►  user double-clicks in Claude Desktop
                                            (sensitive user_config → OS keychain → env)
```

### Recommended project structure (new/changed artifacts only)
```
scripts/build-mcpb.mjs      # NEW — staging + validate + spawn-test + pack loop
examples/pain-point-sweep.mjs  # NEW — DOC-01 runnable recipe
docs/INSTALL.md             # NEW — per-client, per-OS setup
dist/                       # NEW (gitignored) — emitted .mcpb bundles + npm tarball
.mcpbignore                 # NEW — belt-and-suspenders excludes (test/, *.md, .planning/)
package.json               # MODIFIED — bin map, files whitelist, version 1.1.0, unset private
servers/*/manifest.json    # MODIFIED — entry_point retarget + user_config cleanup (see below)
servers/*/server.js        # MODIFIED — add shebang line ONLY (byte-preserving otherwise)
```

### Pattern 1: Staging layout — **Option A (mirror repo depth), RECOMMENDED**
**What:** Stage keeps the two-level `servers/<name>/` depth so `../../shared` resolves with zero source edits.
**When to use:** Always, for this repo (D-02 "preserve relative import depth").
```
<stage>/
  manifest.json                 # entry_point: "servers/<name>/server.js"
  node_modules/                 # prod deps (Node walks up from servers/<name>/ to here)
  shared/*.js                   # ../../shared from servers/<name>/ -> <stage>/shared  ✓
  servers/<name>/server.js      # imports "../../shared/x.js" UNCHANGED  ✓
```
- `${__dirname}` in `mcp_config` = bundle root (`<stage>`), per MANIFEST spec (`${__dirname}/server/index.js` example). `[CITED: modelcontextprotocol/mcpb MANIFEST.md]`
- So each manifest changes: `entry_point: "server.js"` → `"servers/<name>/server.js"`, and `args: ["${__dirname}/server.js"]` → `["${__dirname}/servers/<name>/server.js"]`.
- Bare imports (`@modelcontextprotocol/sdk`, `zod`, `fast-xml-parser`) resolve by Node walking up to `<stage>/node_modules` ✓.

**Anti-pattern — Option B (flatten + rewrite imports):** stage `server.js` at root beside `shared/` and sed `../../shared` → `./shared`. Rejected: rewrites source at stage time (fragile, diff-noisy, must re-verify every `../../` occurrence across all shared imports). Option A keeps `server.js` byte-identical — strictly lazier and lower-risk.

### Pattern 2: npm `bin` = the server file directly (+ shebang)
**What:** Each `servers/<name>/server.js` gets a `#!/usr/bin/env node` first line and is listed as a `bin` target — no separate wrapper file.
**When to use:** For all 11 (D-09). The existing main-guard already auto-connects only when run as the entry.
```jsonc
// package.json
"bin": {
  "medium-research-hn":            "servers/hn/server.js",
  "medium-research-stackexchange": "servers/stackexchange/server.js",
  "medium-research-lobsters":      "servers/lobsters/server.js",
  "medium-research-lemmy":         "servers/lemmy/server.js",
  "medium-research-devto":         "servers/devto/server.js",
  "medium-research-github":        "servers/github/server.js",
  "medium-research-librariesio":   "servers/librariesio/server.js",
  "medium-research-producthunt":   "servers/producthunt/server.js",
  "medium-research-rss":           "servers/rss/server.js",
  "medium-research-discourse":     "servers/discourse/server.js",
  "medium-research-mastodon":      "servers/mastodon/server.js"
}
```
```js
// first line of each server.js (add only this; rest byte-identical)
#!/usr/bin/env node
```

### Anti-Patterns to Avoid
- **Packing `servers/<name>/` live** → `ERR_MODULE_NOT_FOUND: shared/…` at spawn (Pitfall 7). Always stage.
- **Hand-zipping `.mcpb`** → skips manifest validation + ignore rules. Use `mcpb pack`.
- **One npm package per server** → 11 names to squat, `shared/` duplication. One package, 11 bins (D-08/D-09).
- **A thin `bin/` wrapper that just `import()`s server.js** → the server's main-guard sees the wrapper as entry, so `server.connect()` never fires and the server silently won't start. If you must wrap, the wrapper is dead weight; ship `server.js` as bin directly.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Zip a `.mcpb` with correct structure | Custom zip + manifest validator | `mcpb pack` / `mcpb validate` | Handles node_modules inclusion, default excludes, schema validation |
| Bundle prod deps | Manual copy of `node_modules` subtree | `npm ci --omit=dev` into a clean dir | Deterministic from lockfile; drops dev deps automatically |
| Cross-source merge in the example | New ranking loop | `shared/rank.js` `mergeRank` | Already the proven, source-agnostic reference impl |
| Env-var name source of truth | Re-list vars in manifests | `shared/credentials.js` `ENV_VAR` + a 5-line assertion | Single source of truth (D-05) |

**Key insight:** `mcpb pack` already does the archive + exclude + validate work; the only real engineering is the **staging layout** (Option A) and the **manifest cleanup**.

## Manifest Cleanup (drives the D-05 consistency test)

The scaffold manifests were copied from `servers/hn/manifest.json`, which **over-declares** `user_config` — it lists `reddit_client_secret` + `librariesio_key` env refs that **HN never reads**. The D-05 test must both (a) assert every manifest env ref ∈ `ENV_VAR`, and (b) match each server's **actual** credential imports. Verified per-server credential usage this session (`grep credentials.js servers/*/server.js`):

| Server | Reads (via credentials.js) | ENV var(s) | Required? | Sensitive? | Target `user_config` |
|--------|---------------------------|-----------|-----------|-----------|----------------------|
| hn | none | — | — | — | `{}` (empty) |
| lobsters | none | — | — | — | `{}` |
| devto | none | — | — | — | `{}` |
| discourse | none | — | — | — | `{}` |
| mastodon | none (keyless server) | — | — | — | `{}` |
| github | `githubHeaders` | `GITHUB_TOKEN` | optional | yes | 1 optional sensitive field |
| stackexchange | `stackExchangeParams` | `STACKEXCHANGE_KEY` | optional | yes | 1 optional sensitive field |
| librariesio | `librariesIoParams` | `LIBRARIESIO_KEY` | **required** | yes | 1 required sensitive field (already correct) |
| producthunt | `productHuntHeaders` | `PRODUCTHUNT_TOKEN` | **required** | yes | 1 required sensitive field |
| lemmy | `lemmyInstance`, `lemmyCreds` | `LEMMY_INSTANCE`, `LEMMY_USERNAME`, `LEMMY_PASSWORD` | optional | password: yes; instance/user: no | 3 optional fields (password sensitive) |
| rss | `userAgent`, `rssAllowedHosts` (inside getText) | `MCP_USER_AGENT`, `RSS_ALLOWED_HOSTS` | optional | no (not secrets) | 2 optional non-sensitive fields |

**Note for planner:** `ENV_VAR` also contains `REDDIT_*` entries, but **no `servers/reddit` exists** in the suite — those belong to no manifest. The D-05 assertion should be direction-safe: *manifest env ref ⇒ exists in ENV_VAR AND is imported by that server*, not *every ENV_VAR must appear in some manifest*. `[VERIFIED: this session — grep of server sources + ENV_VAR map]`

## DOC-01 Recipe (`examples/pain-point-sweep.mjs`)

`mergeRank(envelopes)` takes an array of **list envelopes** `{ source, query, count, results }` and returns one `score`-desc array (nulls last), reading only the contract `score` field. `[VERIFIED: shared/rank.js source]`

The servers export **mapping/URL helpers** (`mapSeUnanswered`, `seUrl`, `devtoTopUrl`, `mapDevtoArticle`, `normalizeInstance`, `mapTimelineStatuses`, `mapDiscourseTopic`, `buildListEnvelope`) but **not** a one-shot "fetch tag → envelope" function (that logic lives inside the un-exported `registerTool` handlers). So the example follows the **Phase 6/7 scratchpad-harness pattern**: import `getJson` + the exported helpers + `buildListEnvelope` + `mergeRank`, build one list envelope per source for a single tag, then `mergeRank` them.

**Concrete wiring (one tag, e.g. `"rust"`):**
- **Dev.to:** `getJson(devtoTopUrl({ tag, days: 7 }))` → `map` items with `mapDevtoArticle` → `buildListEnvelope`.
- **Stack Exchange:** `getJson(seUrl("/questions/unanswered", { tagged: tag, sort: "votes", site: "stackoverflow" }))` → `mapSeUnanswered` → envelope. (SE items carry `score` + `view_count`.)
- **Discourse:** pick a public instance param (e.g. `https://meta.discourse.org`), `normalizeInstance` → `getJson(<base>/search.json?q=<tag>)` (or `/tag/<tag>.json`) → `mapDiscourseTopic` → envelope.
- **Mastodon:** pick an instance param (e.g. `https://mastodon.social`), `normalizeInstance` → `getJson(<base>/api/v1/timelines/tag/<tag>?limit=40)` → `mapTimelineStatuses`/`mapMastodonStatus` → envelope.
- `mergeRank([se, discourse, mastodon, devto])` → print top N.

This is smoke-testable against live APIs (D-14). It requires Discourse + Mastodon **instance parameters** (tool inputs per SEC-02) — the example hardcodes public instances as *example values*, not defaults baked into servers, so the parameterization rule is respected. Reuses zero new server code.

## Common Pitfalls

### Pitfall A: `.mcpb` breaks `../../shared` imports (Pitfall 7)
**What goes wrong:** Packing `servers/<name>/` directly bundles a server whose `../../shared/*.js` and `zod`/`sdk` resolve to nothing in the isolated ZIP → `ERR_MODULE_NOT_FOUND` at spawn, after a clean `mcpb validate` pass.
**How to avoid:** Staging Option A + `mcpb pack` bundling the prod `node_modules`. **Gate every bundle with a real `node <stage>/servers/<name>/server.js` spawn test** — `mcpb validate` only checks the manifest, not resolvability.
**Warning signs:** Bundle ≈ source-only KB (node_modules missing) or tens of MB (dev deps leaked). `[VERIFIED: this session — mcpb pack bundles node_modules minus .cache/.bin]`

### Pitfall B: Main-guard silently fails under symlinked installs (npm bin-ability)
**What goes wrong:** Every `server.js` gates stdio connect on `import.meta.url === pathToFileURL(process.argv[1]).href`. Under a **symlinked install** (`pnpm`, `npm link`, `npm install <local-path>`), `process.argv[1]` is the symlink path but `import.meta.url` is the realpath → **mismatch → server never connects** (looks like a silent spawn failure / "server disconnected").
**Empirical results (this session, Windows, Node 24):**

| Install type | naive guard match | realpath guard match |
|--------------|-------------------|----------------------|
| Copy (npm pack tarball / registry / `npx -y`) | **true** ✅ | true |
| Symlinked (`npm install ../pkg`, pnpm, `npm link`) | **false** ❌ | true ✅ |

**Impact on THIS phase's required surface:** The documented path is `npx -y medium-research-mcp` (registry → copy install) and Windows `cmd /c npx -y` (uses the `.cmd` shim → copy). **Both work with the existing naive guard + shebang** — so PKG-02's required Windows+npx surface is **not blocked**. The failure is only for pnpm-based clients / local dev installs.
**Recommendation (planner decision):** Harden the guard to `import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href` so it works under *all* install types. This is byte-cheap and never regresses copy installs. It touches server source, but only the guard expression — consider extracting a shared `isEntry(importMetaUrl)` helper (`shared/main.js`) to avoid 11 divergent edits (each server calls `if (isEntry(import.meta.url)) await server.connect(...)`). If the planner prefers zero server-source change, ship as-is (copy installs work) and document "install, don't `npm link`" — but the realpath fix is the honest robustness win.
**Warning signs:** `spawn npx ENOENT` (missing `cmd /c` on Windows — Pitfall 9), or server connects under `npx` but not under a pnpm client. `[VERIFIED: this session — reproduced both cases with npm pack + local install tests]`

### Pitfall C: Windows spawn + cold start (Pitfall 9)
**What goes wrong:** Clients that `spawn("npx", …)` hit `spawn npx ENOENT` on Windows (npx.cmd needs a shell); omitting `-y` hangs a stdio server on the install prompt forever; first `npx` run downloads deps (5–30s) and can exceed spawn timeouts.
**How to avoid:** Every Windows snippet uses `"command": "cmd", "args": ["/c", "npx", "-y", "medium-research-<source>"]`; Unix uses `"command": "npx", "args": ["-y", "medium-research-<source>"]`. Document a "global install / absolute node path" fallback for short-timeout clients. `[CITED: forum.cursor.com spawn-npx-enoent; claude-code#58510]`

### Pitfall D: Clients don't inherit shell env (Pitfall 10)
**What goes wrong:** GUI clients (Claude Desktop, Cursor) spawn with a minimal env — `.bashrc`/`.zshrc` exports never arrive, so optional creds silently vanish (server runs keyless, quality degrades, nothing errors). cwd is client-defined.
**How to avoid:** Every credentialed client snippet includes an explicit `env` block; state plainly that shell-exported vars are NOT inherited by GUI clients. Servers are already network-only (no cwd dependence — keep it that way; don't add relative file I/O). `[CITED: claude-code#1254; MCP debugging docs]`

### Pitfall E: `${user_config.*}` divergence on the Claude Code plugin path (Pitfall 8)
**What goes wrong:** `sensitive` `user_config` → keychain → env works in Claude Desktop's custom-connector path, but the hn manifest already documents a KNOWN GOTCHA: on the Claude Code plugin path a bundled server "can silently fail to spawn." A required-cred bundle whose key never arrives hits the "set X" error (or worse, degrades silently).
**How to avoid:** Cannot be resolved by research — it's a hands-on checklist item (D-04): Claude Desktop install + a cred-requiring tool call per credentialed server; `claude mcp list` on the plugin path. Ensure the "set X" error text also names the `user_config` field. `[CITED: servers/hn/manifest.json KNOWN GOTCHA note]`

## Code Examples

### mcpb CLI (verified subcommands + syntax)
```bash
# validate a staged manifest (accepts manifest.json OR a directory)
mcpb validate <stage>              # or: mcpb validate <stage>/manifest.json

# pack a staged dir -> .mcpb (auto-zips node_modules minus .cache/.bin;
# applies default excludes + .mcpbignore)
mcpb pack <stage> dist/medium-research-<source>.mcpb

# other subcommands: init, sign, unpack, info
```
Default `mcpb pack` excludes: `.git/`, `.DS_Store`, `.gitignore`, `*.log`, `npm-debug.log*`, `.npm/`, `.npmrc`, `.yarn/`, `package-lock.json`, `yarn.lock`, `*.map`, `.env.local`, `.env.*.local`, `node_modules/.cache/`, `node_modules/.bin/`. Add `test/`, `*.md`, `.planning/` etc. via `.mcpbignore`. `[CITED: modelcontextprotocol/mcpb CLI.md]`

### Node manifest shape (current spec, manifest_version 0.3)
```jsonc
{
  "manifest_version": "0.3",
  "name": "medium-research-librariesio",
  "version": "1.1.0",
  "description": "…",
  "author": { "name": "Tushar Kanjariya" },
  "user_config": {
    "librariesio_key": { "type": "string", "title": "Libraries.io API key",
      "sensitive": true, "required": true }
  },
  "server": {
    "type": "node",
    "entry_point": "servers/librariesio/server.js",     // ← retargeted for Option A
    "mcp_config": {
      "command": "node",
      "args": ["${__dirname}/servers/librariesio/server.js"],  // ← retargeted
      "env": { "LIBRARIESIO_KEY": "${user_config.librariesio_key}" }
    }
  }
}
```
`[CITED: modelcontextprotocol/mcpb MANIFEST.md — manifest_version 0.3, node mcp_config shape, ${user_config.*} env pattern]`

### package.json changes (PKG-02)
```jsonc
{
  "name": "medium-research-mcp",
  "version": "1.1.0",            // was 1.0.0
  "type": "module",             // keep
  // "private": true,           // REMOVE
  "engines": { "node": ">=18" },
  "files": ["servers/", "shared/", "docs/INSTALL.md", "README.md"],  // NO test/, NO .planning/
  "bin": { /* 11 entries, see Pattern 2 */ },
  "scripts": {
    "build:mcpb": "node scripts/build-mcpb.mjs",
    "example:sweep": "node examples/pain-point-sweep.mjs"
  },
  "devDependencies": { "@anthropic-ai/mcpb": "2.1.2" }
}
```

## Client Config Matrix (PKG-03) — current schemas, verified 2026-07-16

All five clients spawn the **same stdio process**; only the wrapper differs. Use `medium-research-<source>` as both the config key and the npx target.

### Claude Desktop — `claude_desktop_config.json` (or double-click `.mcpb`)
```jsonc
// Windows
"mcpServers": {
  "medium-research-hn": { "command": "cmd", "args": ["/c","npx","-y","medium-research-hn"] },
  "medium-research-librariesio": {
    "command": "cmd", "args": ["/c","npx","-y","medium-research-librariesio"],
    "env": { "LIBRARIESIO_KEY": "…" } }
}
// macOS/Linux: "command": "npx", "args": ["-y","medium-research-hn"]
```
Preferred install = the `.mcpb` (keychain-backed `user_config`). `[CITED: claudefast/truefoundry Cursor+Desktop guides; MANIFEST.md]`

### Cursor — `~/.cursor/mcp.json` or `<project>/.cursor/mcp.json`
Same `mcpServers` `{ command, args, env }` shape as Claude Desktop. Windows needs `cmd /c npx -y` (or full `npx.cmd` path if PATH isn't inherited). Supports `${env:VAR}` substitution; Cursor reads env at spawn — restart after edits. `[CITED: forum.cursor.com; truefoundry 2026 guide]`

### Codex CLI — `~/.codex/config.toml` (or project `.codex/config.toml`)
```toml
[mcp_servers.medium-research-hn]
command = "npx"
args = ["-y", "medium-research-hn"]
# Windows: command = "cmd", args = ["/c","npx","-y","medium-research-hn"]

[mcp_servers.medium-research-librariesio]
command = "npx"
args = ["-y", "medium-research-librariesio"]
[mcp_servers.medium-research-librariesio.env]
LIBRARIESIO_KEY = "…"
```
Transport derived from `command` vs `url` (no transport key). Env goes in a nested `[mcp_servers.<name>.env]` sub-table. Or: `codex mcp add <name> --env K=V -- npx -y medium-research-<source>`. Optional `startup_timeout_sec` (default 10) matters for npx cold start. `[CITED: developers.openai.com/codex/mcp]`

### OpenCode — `opencode.json`
```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "medium-research-hn": {
      "type": "local",
      "command": ["npx","-y","medium-research-hn"],   // command is an ARRAY here
      "enabled": true
    },
    "medium-research-librariesio": {
      "type": "local",
      "command": ["npx","-y","medium-research-librariesio"],
      "enabled": true,
      "environment": { "LIBRARIESIO_KEY": "…" }        // key is "environment", not "env"
    }
  }
}
```
Note the two schema differences vs the others: `command` is a single array, and env is `"environment"`. `{env:NAME}` substitutes a host env var. `[CITED: opencode.ai/docs/mcp-servers]`

### Claude Code plugin path (note only, per D-11)
```bash
claude mcp add --transport stdio medium-research-hn -- npx -y medium-research-hn
# with cred (flag BEFORE the name; keep an option between --env and name):
claude mcp add --transport stdio --env LIBRARIESIO_KEY=… medium-research-librariesio -- npx -y medium-research-librariesio
```
Scopes: `local` (default, per-project in `~/.claude.json`), `user` (global), `project` (`.mcp.json`, committable). **Surface the KNOWN GOTCHA:** bundled `${user_config.*}` servers can silently fail to spawn on the plugin path — check `claude mcp list`. `[CITED: code.claude.com/docs/en/mcp]`

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `dxt` / Desktop Extensions | `.mcpb` (MCP Bundles) via `@anthropic-ai/mcpb` | 2025 rename; repo → `modelcontextprotocol/mcpb` 2025-11 | npm package name **stayed** `@anthropic-ai/mcpb`; don't chase a `@modelcontextprotocol/*` package (404) |
| Hand-written manifests as "scaffold only" (v1.0) | Live `mcpb pack` of staged bundles | This phase | manifest_version 0.3 still valid — no migration, just entry_point retarget + user_config cleanup |

**Deprecated/outdated:** none blocking. `manifest_version` 0.3 is current (spec last updated 2025-12-02), not superseded.

## Runtime State Inventory

> Packaging phase — no data migration. But three "runtime state" surfaces exist and must be handled:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — servers are stateless/network-only. | None |
| Live service config | Client config files (`claude_desktop_config.json`, `~/.cursor/mcp.json`, `~/.codex/config.toml`, `opencode.json`) are **user-edited, not in repo** — docs must give exact per-OS snippets or setup fails silently. | Docs (D-11–D-13) |
| OS-registered state | `.mcpb` `sensitive` `user_config` → **OS keychain** (Claude Desktop). Verified only by a live install smoke (D-04), not by `mcpb validate`. | Manual Claude Desktop smoke per credentialed server |
| Secrets/env vars | `ENV_VAR` map in `shared/credentials.js` is the single source of truth; manifests must reference only vars their server actually reads (see Manifest Cleanup). Never in the npm tarball (`files` whitelist excludes `.env`). | Manifest cleanup + `npm pack` inspection |
| Build artifacts | `dist/*.mcpb` + `npm pack` tarball — gitignore `dist/`; the tarball is throwaway (dry-run inspection only, D-07). Prod `node_modules` staged fresh per build (`npm ci --omit=dev`). | Add `dist/` to `.gitignore` |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | everything | ✓ | v24.18.0 (≥18 ✓) | — |
| npm (`npm ci`, `npm pack`, `npm view`) | staging, tarball, bin | ✓ | bundled with Node | — |
| `@anthropic-ai/mcpb` CLI | `.mcpb` build (PKG-01) | ✗ (not yet installed) | 2.1.2 available on npm | `npm i -D @anthropic-ai/mcpb@2.1.2` or `npx @anthropic-ai/mcpb` |
| Claude Desktop | D-04 keychain smoke, D-11 docs | assumed (dev's primary client) | — | manual step; can't be automated |
| Cursor / Codex / OpenCode | PKG-03 doc smoke | not required installed | — | docs verified against official schemas; one client smoke suffices (D-12) |

**Missing dependencies with no fallback:** none.
**Missing with fallback:** `@anthropic-ai/mcpb` — install as devDependency (planned). Live-install client smokes (D-04) are inherently manual, not a code fallback.

## Validation Architecture

Test framework = Node's built-in `node --test` (existing `"test": "node --test"`). This phase adds packaging assertions, not server-behavior tests.

### Phase Requirements → Verification Map
| Req | Behavior | Type | Command / Check | Exists? |
|-----|----------|------|-----------------|---------|
| PKG-01 | Each bundle spawns with shared+deps resolved | spawn test | `node <stage>/servers/<name>/server.js` (expect clean stdio connect, no `ERR_MODULE_NOT_FOUND`) | ❌ Wave 0 (in build script) |
| PKG-01 | Manifest valid | CLI | `mcpb validate <stage>` | ❌ Wave 0 |
| PKG-01/D-05 | Manifest env refs ⊆ ENV_VAR AND imported by server | unit | `node --test test/manifest-consistency.test.js` (~5 lines, asserts against `ENV_VAR` + per-server grep) | ❌ Wave 0 |
| PKG-01/D-03 | Bundle excludes test/dev deps; sane size | script assert | check bundle size band; assert no `test/` entry | ❌ Wave 0 |
| PKG-02/D-07 | Tarball ships `servers/` + `shared/`; bins have shebangs | inspection | `npm pack` → `tar -tzf <tgz>` grep `servers/`,`shared/`; assert first bin line `#!/usr/bin/env node` | ❌ Wave 0 |
| PKG-02 | Windows `cmd /c npx -y` connects | manual smoke | install tarball, spawn via a client on Windows | ❌ manual (D-04/D-07) |
| DOC-01 | Sweep runs end-to-end | smoke | `node examples/pain-point-sweep.mjs` (live APIs; prints merged ranked list) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the relevant unit check (`node --test test/manifest-consistency.test.js`) + `node <stage>/…/server.js` spawn for the touched bundle.
- **Per wave merge:** full `node scripts/build-mcpb.mjs` (validate+spawn all 11) + `npm pack` inspection + `node examples/pain-point-sweep.mjs`.
- **Phase gate:** all 11 bundles validate+spawn; tarball inspected; one Windows client smoke; credentialed-server keychain smoke (D-04).

### Wave 0 Gaps
- [ ] `test/manifest-consistency.test.js` — D-05 assertion (env refs ⊆ ENV_VAR + server import check) — covers PKG-01/D-05
- [ ] `scripts/build-mcpb.mjs` — embeds validate + spawn-test gates — covers PKG-01/D-03
- [ ] `examples/pain-point-sweep.mjs` — is its own smoke — covers DOC-01
- [ ] `.gitignore` entry for `dist/`
- [ ] Framework install: `npm i -D @anthropic-ai/mcpb@2.1.2`

## Security Domain

Dev-tooling + docs phase; no new runtime attack surface. Relevant controls:

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V6 Cryptography / secret storage | yes | `.mcpb` secrets MUST be `"sensitive": true` → OS keychain, never plaintext config. Assert per credentialed manifest. |
| V14 Config / supply chain | yes | `files` whitelist keeps `.env`/local config OUT of the npm tarball (inspect `npm pack`); `@anthropic-ai/mcpb` pinned, official Anthropic package |
| V5 Input validation | unchanged | Frozen — no server logic changes; SSRF guard/parameterization untouched (do not weaken) |

| Threat | STRIDE | Mitigation |
|--------|--------|------------|
| API key committed to public npm | Information disclosure | `files` allowlist + `npm pack` tarball inspection before manual publish (D-07) |
| Secret written plaintext to host config | Information disclosure | `sensitive: true` in every credentialed `user_config`; D-05 test + D-04 keychain smoke |
| Slopsquat on the mcpb dep | Tampering | Pinned `@anthropic-ai/mcpb@2.1.2`, verified Anthropic maintainers |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `${__dirname}` in `mcp_config.args` = bundle extraction root, so `servers/<name>/server.js` is the correct retargeted path under Option A | Pattern 1 | If `${__dirname}` were the entry file's dir, args path would differ — **verify with the D-04 Claude Desktop install smoke** (spawn test catches it). Backed by MANIFEST.md `${__dirname}/server/index.js` example (CITED), so LOW risk. |
| A2 | Discourse/Mastodon live endpoints (meta.discourse.org, mastodon.social) still keyless for the DOC-01 example | DOC-01 | Example may need a different public instance; caught immediately by running the example (it IS the smoke). LOW. |

**All other claims are VERIFIED (this session) or CITED (official docs).**

## Open Questions

1. **Main-guard hardening (Pitfall B) — realpath fix or ship copy-install-only?**
   - Known: naive guard works for `npx`/registry (copy) incl. Windows; fails for pnpm/`npm link` (symlink).
   - Unclear: whether any target user runs a pnpm-based client. Required surface (npx + Windows) is unaffected.
   - Recommendation: apply the one-line realpath fix via a shared `isEntry()` helper — cheap, universal, no regression. Planner's call whether to touch server source at all given the frozen-surface rule (it's a guard, not tool behavior).

2. **`${__dirname}` resolution under Option A (A1 above).**
   - Recommendation: rely on the D-04 Claude Desktop install smoke to confirm; the `node` spawn test in the build script already proves resolvability from the stage. If the real host resolves `${__dirname}` differently than the stage spawn, the smoke is the only place it surfaces.

3. **`.mcpb` distribution channel (D-06 manual gate).**
   - Bundles are built + validated here, but *how* the user distributes them (GitHub Release attach? direct file?) is the user's manual step. Docs should state where `dist/*.mcpb` land and that the user attaches them to the `v1.1.0` release.

## Sources

### Primary (HIGH confidence — verified this session)
- npm registry: `npm view @anthropic-ai/mcpb version/dist-tags/bin/deprecated/maintainers` → 2.1.2, bin `mcpb`, not deprecated, `@anthropic.com` maintainers; `@modelcontextprotocol/mcpb` + `mcpb` → 404
- Empirical bin/main-guard tests (Node 24, Windows): copy install (npm pack tarball) → naive guard true; symlink install → naive false / realpath true
- Empirical: `mcpb pack` bundles `node_modules` (minus `.cache`/`.bin`) — confirmed via CLI.md default-exclude list
- Codebase (read this session): `servers/hn/manifest.json`, `servers/librariesio/manifest.json`, `shared/credentials.js` (`ENV_VAR`), `shared/rank.js` (`mergeRank`), `package.json`, per-server `grep credentials.js`, main-guard in `servers/hn/server.js`

### Secondary (MEDIUM — official docs)
- github.com/modelcontextprotocol/mcpb — MANIFEST.md (manifest_version 0.3, node mcp_config, `${user_config.*}`), CLI.md (`mcpb pack`/`validate` syntax, default excludes, `.mcpbignore`)
- developers.openai.com/codex/mcp (Codex config.toml), opencode.ai/docs/mcp-servers (opencode.json), code.claude.com/docs/en/mcp (`claude mcp add`), forum.cursor.com + truefoundry 2026 guide (Cursor mcp.json + Windows npx)
- `.planning/research/PITFALLS.md` §7–10, `.planning/research/STACK.md`, `.planning/research/SUMMARY.md`

## Metadata

**Confidence breakdown:**
- Standard stack (mcpb 2.1.2, manifest 0.3): HIGH — npm + official spec verified this session
- Architecture (staging Option A, bin-ability): HIGH — empirically reproduced; A1 (`${__dirname}`) leans on cited example, confirmed by build-script spawn test + D-04 smoke
- Client configs: HIGH for Codex/OpenCode/Claude Code (official docs), MEDIUM-HIGH for Cursor/Desktop (guides + community)
- Pitfalls: HIGH — bin/main-guard and node_modules bundling directly reproduced

**Research date:** 2026-07-16
**Valid until:** 2026-08-15 (30 days; mcpb spec + client schemas are moving — re-verify `mcpb --version` and manifest_version at execution if past this)
