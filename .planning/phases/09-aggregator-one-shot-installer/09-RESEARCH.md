# Phase 9: Aggregator & One-Shot Installer - Research

**Researched:** 2026-07-22
**Domain:** Node CLI packaging + MCP server composition (no new source, no contract change)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Aggregator exposes **all ~44 tools from all 11 sources, unfiltered union**. Existing tool-name prefixes (`hn_`, `so_`/`stackexchange`, `gh_`, `devto_`, `lobsters_`, `lemmy_`, `librariesio_`, `producthunt_`, `rss_`, `discourse_`, `mastodon_`) guarantee no collisions. No curation, no per-source gating.
- **D-02:** Keyed sources (Libraries.io, Product Hunt) mounted **unconditionally** even with keys absent — tools keep their existing fail-loud "set X" behavior at call time. Aggregator never silently drops keyed tools.
- **D-03:** Installer is an **interactive wizard by default**; non-interactive flags (`--client=`, `--yes`, `--separate`) exist for CI.
- **D-04:** Installer targets **4 clients**: Claude Desktop, Cursor, Codex CLI, OpenCode. Formats come from `docs/INSTALL.md` (authoritative).
- **D-05:** **Prompt, write plaintext, warn.** Prompt each required key (LIBRARIESIO_KEY, PRODUCTHUNT_TOKEN), each skippable; write into the config `env`/`environment` block; print a one-line plaintext-vs-keychain notice. Skipping leaves keyless fail-loud behavior.
- **D-06:** **Aggregator single entry by default; `--separate` writes the 11.** Both are non-destructive merges; back up the config file before writing.

### Claude's Discretion
- HOW the 11 `McpServer` instances merge into one process (provided: contract frozen, no tool renames, 11 bins + `.mcpb` keep working, no new runtime dependency).
- Installer config-file discovery paths per OS, backup naming, exact prompt/confirm rendering.
- Whether the installer post-write spawn-tests each server (nice-to-have; NOT required by INST-01).

### Deferred Ideas (OUT OF SCOPE)
- `.mcpb` aggregator bundle (single keychain-credentialed bundle) — deferred.
- Auto-update notification for installed configs — out of v1.2.
- Installer post-write spawn-test / health check — nice-to-have only.
- npm publish, GitHub install-path verification, INSTALL.md rewrite — **Phase 10**.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AGG-01 | Aggregator bin exposing all 11 sources' tools from one process | §Aggregator Merge Seam — `registerTools(server)` refactor + one aggregator `McpServer` |
| INST-01 | `npx medium-research-mcp install` one-shot config installer | §Installer Architecture — `node:readline/promises` wizard, per-client read/merge/write, backup-first |
</phase_requirements>

## Summary

This is a **packaging/CLI phase**, not a source or contract change. Two additions land inside the existing package with **zero new runtime dependencies**: an aggregator bin and an installer bin.

The aggregator's only real design question is how to expose all 11 servers' tools from one process without tripping each server's `isEntry`-gated `connect()`. The installed SDK (`@modelcontextprotocol/sdk@1.29.0`) exposes **no public merge/mount API** — tools live in a private `_registeredTools` map and the only supported composition primitive is `registerTool`. The clean seam is a **mechanical refactor**: each server wraps its `server.registerTool(...)` calls in an exported `registerTools(server)` function and calls it once locally; the aggregator imports all 11 functions and calls each against one `McpServer`. This uses only the public API, touches 11 files with a 2-line-each mechanical change, and is invisible to the 432 tests (they import `map*` helpers, never the `server` instance).

The installer's only real risk is **Codex's TOML config** — Node has no stdlib TOML parser and a dependency is banned. Verdict: **no dep needed.** The installer only ever *generates its own named tables* and appends them; it never needs to *parse* arbitrary user TOML. Non-destructive merge = idempotent remove-then-append of our own `[mcp_servers.medium-research-*]` blocks. JSON clients use stdlib `JSON.parse`/`JSON.stringify`. Interactive prompts use `node:readline/promises`. Backup-before-write is a one-line `copyFileSync`.

**Primary recommendation:** Refactor the 11 servers to export `registerTools(server)`; build `servers/aggregator/server.js` that mounts all 11 on one `McpServer`; build the installer as a stdlib-only `node:readline/promises` wizard with per-client JSON/TOML writers that back up then non-destructively merge. Add two bins (`medium-research-all`, `medium-research-mcp`). No new deps.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Tool registration union | Aggregator process (Node/MCP server) | 11 source modules | One McpServer owns the merged tool surface; source modules own their own tool definitions via `registerTools` |
| Credential resolution | `shared/credentials.js` | — | Frozen single source of truth; aggregator inherits unchanged (no process.env reads elsewhere) |
| HTTP + cache + retry | `shared/http_client.js` | — | Aggregator inherits unchanged; every tool handler already routes through `getJson` |
| Client detection | Installer CLI | filesystem | Existence of each client's config dir/file is the detection signal |
| Config read/merge/write | Installer CLI | Node stdlib (`fs`, `JSON`, string splice for TOML) | Only new outbound file-write surface; backup-first mandatory |
| Interactive prompting | Installer CLI | `node:readline/promises` | Stdlib covers skippable prompts + client selection; no `inquirer` |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | ^1.29.0 (installed) | `McpServer` + `StdioServerTransport` for the aggregator | Already a dependency; `registerTool` is the public composition API `[VERIFIED: node_modules dist/esm/server/mcp.js]` |
| `node:readline/promises` | stdlib | Interactive installer prompts (`rl.question`) | Stdlib; no `inquirer`/`prompts` dep needed `[VERIFIED: Node >=18 engines]` |
| `node:fs` | stdlib | Read/write/back up client configs | Stdlib `[VERIFIED]` |
| `node:path`, `node:os` | stdlib | OS-variant config paths (`%APPDATA%`, `~/.config`) | Stdlib `[VERIFIED]` |

**No new dependencies.** This is the hard constraint (CLAUDE.md, D-scope). The whole phase is stdlib + existing SDK + existing `shared/` modules.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `registerTools(server)` refactor | Copy each server's private `_registeredTools` into the aggregator's map + call `setToolRequestHandlers()` | **Rejected** — reaches into SDK-private internals (`_registeredTools`, `setToolRequestHandlers`) that `^1.29.0` may rename on a minor bump; the stored `RegisteredTool` shape (Zod *object*, not raw shape) does not round-trip cleanly. Zero-file-change but a 3am liability. |
| `node:readline/promises` | `inquirer` / `prompts` / `@clack/prompts` | **Rejected** — new runtime dep, banned by scope. Stdlib covers skippable text prompts and numbered client selection. |
| Text-splice TOML | Add `@iarna/toml` / `smol-toml` | **Rejected** — new dep. We only *generate* our own tables, never *parse* arbitrary user TOML, so no parser is required (see §TOML Verdict). |

## Package Legitimacy Audit

> **N/A — this phase installs zero external packages.** The entire deliverable is stdlib + the already-vendored `@modelcontextprotocol/sdk@1.29.0`. No registry lookups, no new `dependencies` entries. If the plan ever proposes a new dep, that is a scope violation (CONTEXT D-scope: "no new runtime dependency").

## Aggregator Merge Seam (THE key question)

### SDK reality (verified)
`node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js` `[VERIFIED: installed source]`:
- `McpServer` stores tools in a **private** `this._registeredTools = {}` map.
- The **only** public way to add a tool is `registerTool(name, config, cb)` (and legacy `tool(...)`). There is **no** `merge`, `mount`, `import`, or `use` method, and no public tool-listing/registry accessor.
- `registerTool` throws `Tool ${name} is already registered` on duplicate names — D-01's prefixes make this a non-issue (union is collision-free).
- `connect(transport)` just delegates to the low-level `this.server.connect`. Nothing connects at import time.

### Recommended seam: `export function registerTools(server)`
Each of the 11 servers currently does:
```js
export const server = new McpServer({ name: "hn", version: "1.0.0" });
server.registerTool("hn_front_page", {…}, handler);
// …more registerTool calls…
if (isEntry(import.meta.url)) { await server.connect(new StdioServerTransport()); }
```
Refactor (mechanical, per server):
```js
// Wrap the existing registerTool block verbatim — only indentation changes.
export function registerTools(server) {
  server.registerTool("hn_front_page", {…}, handler);
  // …the same registerTool calls, unchanged…
}

export const server = new McpServer({ name: "hn", version: "1.0.0" });
registerTools(server);                       // standalone bin still gets all its tools

if (isEntry(import.meta.url)) {               // unchanged — still gates stdio connect
  await server.connect(new StdioServerTransport());
}
```
Aggregator (`servers/aggregator/server.js`):
```js
#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { isEntry } from "../../shared/main.js";
import { registerTools as hn }           from "../hn/server.js";
import { registerTools as stackexchange } from "../stackexchange/server.js";
import { registerTools as lobsters }     from "../lobsters/server.js";
import { registerTools as lemmy }        from "../lemmy/server.js";
import { registerTools as devto }        from "../devto/server.js";
import { registerTools as github }       from "../github/server.js";
import { registerTools as librariesio }  from "../librariesio/server.js";
import { registerTools as producthunt }  from "../producthunt/server.js";
import { registerTools as rss }          from "../rss/server.js";
import { registerTools as discourse }    from "../discourse/server.js";
import { registerTools as mastodon }     from "../mastodon/server.js";

export const server = new McpServer({ name: "medium-research-all", version: "1.2.0" });
for (const reg of [hn, stackexchange, lobsters, lemmy, devto, github,
                   librariesio, producthunt, rss, discourse, mastodon]) {
  reg(server);
}

if (isEntry(import.meta.url)) {
  await server.connect(new StdioServerTransport());
}
```

### Why this is correct and safe
- **No double stdio (the central pitfall).** When the aggregator is the process entry, importing `../hn/server.js` runs hn's top level, but hn's `isEntry(import.meta.url)` is **false** (hn's URL ≠ the aggregator entry), so hn never connects. Verified against `shared/main.js` logic. `[VERIFIED: shared/main.js]`
- **11 standalone bins unchanged.** `export const server` still exists and still has every tool (`registerTools(server)` runs at module load). Running `node servers/hn/server.js` directly: `isEntry` true → connects, exactly as before.
- **Contract frozen.** `registerTools` calls the identical `registerTool(name, config, cb)` with the same schemas/handlers — no rename, same `structuredContent` + JSON-text output.
- **No new dep.** Pure SDK public API.
- **Harmless waste:** each import constructs one unused `McpServer` (the private `export const server`) that never connects. Negligible memory, no I/O. Not worth removing.

### Blast radius
- **11 server files** — each: introduce `export function registerTools(server) {` before the first `server.registerTool`, close the brace after the last, add one `registerTools(server);` line. Indentation-only change to the body. Keep `export const server`, keep `map*` exports, keep the `isEntry` guard.
- **1 new file** — `servers/aggregator/server.js` (above).
- **package.json** — 2 new bins + (no `files` change if aggregator lives under `servers/`).
- **Tests: zero changes expected.** `test/uniform-run.test.js` and the per-source tests import `map*` named exports (e.g. `import { mapHnHit } from "../servers/hn/server.js"`), never `server`. `registerTools` is additive. `[VERIFIED: grep of test/ imports]`
- Keep it mechanical + covered: one new test asserting the aggregator registers the full union (e.g. count `_registeredTools` keys === sum of the 11, or spawn-initialize + `tools/list` and assert every prefix present). See §Validation Architecture.

## Installer Architecture (INST-01)

### Interactive prompts — stdlib only
`node:readline/promises` is the right tool. `[VERIFIED: Node >=18 stdlib]`
```js
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
const rl = createInterface({ input, output });
const key = (await rl.question("LIBRARIESIO_KEY (Enter to skip): ")).trim();
// empty string === skip → leave server keyless (D-05 fail-loud)
rl.close();
```
**Windows/terminal gotchas:**
- Works in Windows Terminal / PowerShell / cmd on Node ≥18. Line endings: readline strips the trailing `\r`.
- **No TTY (piped/CI) → prompts hang or read EOF.** Guard: if `!process.stdin.isTTY` OR any non-interactive flag is present, require `--client`/`--yes` and never prompt (D-03 CI path).
- **No secret masking in stdlib readline.** Acceptable: D-05 writes plaintext anyway. Do *not* hand-roll a muted-input stream. Optionally note "input is visible."
- Ctrl+C mid-wizard: nothing written yet (write happens last, after confirm) → safe.

### Per-client config: paths, format, entry schema
From `docs/INSTALL.md` (authoritative for format) + verified OS paths:

| Client | Config path | Detect by | Format | Entry schema |
|--------|-------------|-----------|--------|--------------|
| **Claude Desktop** | Win: `%APPDATA%\Claude\claude_desktop_config.json` · macOS: `~/Library/Application Support/Claude/claude_desktop_config.json` · Linux: `~/.config/Claude/claude_desktop_config.json` | `Claude/` dir exists | JSON | `mcpServers[name] = { command, args, env? }` |
| **Cursor** | `~/.cursor/mcp.json` (global) or `<proj>/.cursor/mcp.json` | `~/.cursor/` exists | JSON | `mcpServers[name] = { command, args, env? }` |
| **Codex CLI** | `~/.codex/config.toml` | `~/.codex/` exists | **TOML** | `[mcp_servers.<name>]` `command`/`args` + nested `[mcp_servers.<name>.env]` sub-table |
| **OpenCode** | `~/.config/opencode/opencode.json` (global) or `<proj>/opencode.json` | `~/.config/opencode/` exists | JSON | `mcp[name] = { type:"local", command:[…array…], enabled:true, environment? }` |

`[CITED: docs.opencode.ai/docs/config]` `[CITED: modelcontextprotocol.io/docs/develop/connect-local-servers]` `[VERIFIED: docs/INSTALL.md §54/§100/§135/§164]`

**Cross-client schema differences to encode (from INSTALL.md):**
- **Windows wrapper:** every client uses `command:"cmd", args:["/c","npx","-y",<bin>]` on Windows (npx is a `.cmd` shim → bare `"npx"` gives `spawn npx ENOENT`). macOS/Linux use `command:"npx", args:["-y",<bin>]`. OpenCode folds this into its single `command` array: `["cmd","/c","npx","-y",<bin>]` vs `["npx","-y",<bin>]`.
- **`env` vs `environment`:** Claude Desktop / Cursor / Codex use `env`; **OpenCode uses `environment`**.
- **OpenCode `command` is an array**, not `command`+`args`; also needs `type:"local"` and `enabled:true`.
- **Aggregator entry name** (D-06 default): `medium-research-all`, bin `medium-research-all`. `--separate` writes the 11 `medium-research-<source>` entries (mirror the stopgap `docs/claude_desktop_config.all-servers.json` shape but with `npx -y <bin>`, not absolute `node` paths).
- **Which entries get an `env` block:** only the two required-key servers when the aggregator is separate mode. In **aggregator single-entry mode**, the aggregator entry gets one `env`/`environment` block carrying whichever of `LIBRARIESIO_KEY` / `PRODUCTHUNT_TOKEN` the user provided (both keyed servers run inside the one aggregator process, so both keys go on the single entry).

### TOML Verdict (the real risk — surfaced)
**Node has NO stdlib TOML parser** (`node:toml` does not exist; JSON module imports exist, TOML does not). `[VERIFIED: Node stdlib]` A dependency is banned. **Verdict: no dep needed — do not parse, only generate + splice.**

Rationale: the installer only ever needs to (a) know if *our own* named block already exists, and (b) add/replace *our own* named block. It never needs to understand arbitrary user TOML structure. So:
- **Generate** the block as a controlled string (we own every byte):
  ```toml
  [mcp_servers.medium-research-all]
  command = "cmd"
  args = ["/c", "npx", "-y", "medium-research-all"]
  [mcp_servers.medium-research-all.env]
  LIBRARIESIO_KEY = "…"
  PRODUCTHUNT_TOKEN = "…"
  ```
- **Idempotent non-destructive merge:** read the file as text; for each of our table names, remove any existing `\n[mcp_servers.<name>]` block **up to the next top-level `[` header or EOF** (regex, anchored on line-start `[`), then append the freshly generated block(s) at the end. Appending a new top-level table never disturbs unrelated tables; removing-then-reappending our own keeps re-runs clean and avoids TOML duplicate-table parse errors.
- **The one careful bit:** the block-removal regex must stop at the next line-start `[` so it cannot swallow a following unrelated `[mcp_servers.other]`. Flag this for a targeted unit test (a fixture with our block sandwiched between two unrelated tables → assert both survive).
- **String values need escaping:** keys are API tokens — escape `\` and `"` (and reject/strip control chars/newlines) before interpolating into the TOML string literal. A key with a stray `"` would otherwise corrupt the file. Same applies to JSON, but `JSON.stringify` handles it for free; TOML we escape by hand (small helper).
- **Alternative (documented, not required):** shell out to `codex mcp add <name> --env KEY=VAL -- npx -y <bin>` (INSTALL.md §155) to delegate the TOML write to Codex itself. Clean but depends on `codex` on PATH and one invocation per entry. The text-splice approach has no external-process dependency; prefer it, keep this as a fallback note.

### Backup + non-destructive merge pattern
- **Back up first, always** (D-06). Naming: `<config>.bak-<ISO8601-compact>` e.g. `claude_desktop_config.json.bak-20260722T140355Z`. Timestamped so repeated runs never clobber a prior backup. One `fs.copyFileSync(cfg, backup)` before any write. Skip backup only when the file doesn't exist yet (nothing to preserve — create fresh).
- **JSON merge (Claude Desktop / Cursor / OpenCode):**
  1. `fs.readFileSync` → `JSON.parse`. If the file is missing, start from `{}` (or the OpenCode skeleton with `$schema`).
  2. **Parse failure → abort with a clear message + point at the untouched file.** Do NOT hand-roll a JSONC/comment-tolerant parser. (Real risk: a user hand-added `//` comments; these files are spec'd as plain JSON so this is rare. Fail loud, don't corrupt.)
  3. Ensure the container object exists (`mcpServers` / `mcp`), then **set only our keys** — never replace the whole container, never touch unrelated server entries (D-06).
  4. `JSON.stringify(obj, null, 2)` + write. Preserves every unrelated entry; loses only comments (acceptable, warned).
- **Write is the last step** — after detect → confirm. Nothing is written until the user confirms the diff (D-03), so an abort/Ctrl+C leaves configs untouched.

### package.json wiring
```jsonc
"bin": {
  // …the 11 existing bins UNCHANGED…
  "medium-research-all": "servers/aggregator/server.js",
  "medium-research-mcp": "bin/install.js"          // ← matches package name
}
```
- **`medium-research-mcp` bin name === package name** is what makes `npx medium-research-mcp install` and, in Phase 10, **`npx github:TusharRedlioDesigns/medium-research-mcp` resolve to the default bin (PKG-05)**: npm designates the bin whose key equals the package name as the default executable. `[CITED: npm docs — bin field default resolution]` This new bin *is* the default-bin fix the roadmap flagged (no bin currently matches the package name).
- **The installer bin parses `install` as argv[2]** (so `npx medium-research-mcp install` works, and a bare `npx medium-research-mcp` can print help/usage). Flags: `--separate`, `--client=<claude|cursor|codex|opencode>`, `--yes`.
- **`files` whitelist:**
  - Aggregator at `servers/aggregator/server.js` → already covered by the existing `"servers/"` entry. No change.
  - Installer at `bin/install.js` → **add `"bin/"`** to the `files` array (currently `["servers/","shared/","docs/INSTALL.md","README.md"]`). If the installer instead lives under `servers/` or `shared/`, no `files` change — but `bin/` is the conventional home. Planner's call; whichever dir is chosen must be in `files` or it won't ship in the tarball.
- **`build-mcpb.mjs` is unaffected:** its `SERVERS` array is an explicit 11-name list and it requires a `servers/<name>/manifest.json`. The aggregator dir has no manifest and is not in the list → never bundled (matches the deferred `.mcpb`-aggregator decision). The 11 existing bins/bundles are untouched. `[VERIFIED: scripts/build-mcpb.mjs]`

## Common Pitfalls

### Pitfall 1: Double stdio connect from an imported server
**What goes wrong:** aggregator imports a server module that auto-connects a second `StdioServerTransport` on the same stdin/stdout → JSON-RPC framing corruption.
**Why it won't happen here:** every server gates `connect()` on `isEntry(import.meta.url)`, which is false for any imported (non-entry) module. **Guard:** the aggregator must import via the `registerTools` named export and must NOT call `.connect()` on any imported `server`. Add a test that spawning the aggregator produces exactly one `initialize` handshake.

### Pitfall 2: Assuming a tool-name collision needs handling
**What goes wrong:** adding prefix-dedup logic the union doesn't need. **Reality:** all 11 prefixes are distinct (D-01); `registerTool` would *throw* on a real dup, so a collision surfaces loudly at startup, not silently. Don't build collision handling — let the throw be the check.

### Pitfall 3: TOML merge reaching for a banned parser
**What goes wrong:** `npm i @iarna/toml` to "properly" merge Codex config. **Avoid:** we generate our own tables and never parse user TOML; idempotent remove-then-append of our named blocks is sufficient (see §TOML Verdict).

### Pitfall 4: Windows `npx` ENOENT / MSIX config path
**What goes wrong:** writing `command:"npx"` on Windows → `spawn npx ENOENT` (npx is a `.cmd` shim). **Avoid:** emit `cmd /c npx -y <bin>` on `process.platform === "win32"`. **Second Windows trap:** Claude Desktop installed via **MSIX/Store** actually reads a virtualized `%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude\` copy while "Edit Config" shows `%APPDATA%\Claude\`. Target `%APPDATA%\Claude\` (what manual editors use); note the MSIX case as a known limitation the wizard can print if the standard path isn't found. `[CITED: github.com/anthropics/claude-code issue 26073]`

### Pitfall 5: Clobbering unrelated server entries
**What goes wrong:** writing a fresh `mcpServers`/`mcp` object instead of merging → wipes the user's other MCP servers. **Avoid:** read→parse→set-only-our-keys→write; back up first (D-06). Add a test: fixture config with an unrelated `some-other-server` entry → assert it survives the merge.

### Pitfall 6: Unescaped secret corrupting the config
**What goes wrong:** a key containing `"` or `\` breaks JSON/TOML string literals. **Avoid:** JSON is safe via `JSON.stringify`; for TOML, escape `\` and `"` and reject control chars/newlines in a tiny helper before interpolating.

### Pitfall 7: Prompting in a non-TTY (CI) → hang
**What goes wrong:** `rl.question` with piped stdin hangs or EOFs. **Avoid:** detect `!process.stdin.isTTY`; require explicit flags in that path (D-03).

## Code Examples

### Backup-then-merge JSON (Claude Desktop / Cursor / OpenCode)
```js
import fs from "node:fs";
function backup(cfgPath) {
  if (!fs.existsSync(cfgPath)) return null;                 // nothing to preserve
  const stamp = new Date().toISOString().replace(/[:.]/g, "").replace(/-/g, "");
  const bak = `${cfgPath}.bak-${stamp}`;
  fs.copyFileSync(cfgPath, bak);
  return bak;
}
function mergeJson(cfgPath, containerKey, entries) {         // entries: { name: entryObj }
  let obj = {};
  if (fs.existsSync(cfgPath)) {
    try { obj = JSON.parse(fs.readFileSync(cfgPath, "utf8")); }
    catch { throw new Error(`Cannot parse ${cfgPath} as JSON (comments?). Left unchanged.`); }
  }
  obj[containerKey] ??= {};
  for (const [name, entry] of Object.entries(entries)) obj[containerKey][name] = entry;  // set only ours
  fs.writeFileSync(cfgPath, JSON.stringify(obj, null, 2) + "\n");
}
```

### Idempotent TOML block splice (Codex)
```js
function spliceTomlTable(text, tableName, block) {
  // Remove any existing top-level block for tableName (and its .env sub-table),
  // stopping at the next line-start '[' so unrelated tables are untouched.
  const re = new RegExp(
    `(^|\\n)\\[${tableName.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}(\\.[^\\]]+)?\\][^]*?(?=\\n\\[|$)`,
    "g",
  );
  const cleaned = text.replace(re, "").replace(/\n{3,}/g, "\n\n").trimEnd();
  return `${cleaned}\n\n${block.trim()}\n`;
}
// ponytail: regex splice, not a TOML parser — safe because we only ever add/replace
// our own [mcp_servers.medium-research-*] tables, never edit user tables. Upgrade to
// a real parser only if the installer ever needs to READ arbitrary user TOML.
```

### Client entry builders (platform-aware)
```js
const win = process.platform === "win32";
const cmd = (bin) => win
  ? { command: "cmd", args: ["/c", "npx", "-y", bin] }
  : { command: "npx", args: ["-y", bin] };
const opencodeCmd = (bin) => ({
  type: "local",
  command: win ? ["cmd", "/c", "npx", "-y", bin] : ["npx", "-y", bin],
  enabled: true,
});
// env block key differs: Claude/Cursor/Codex → "env"; OpenCode → "environment"
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hand-edit each client config, one entry per source (11 edits) | One `install` command; one `medium-research-all` entry | This phase | The felt "one command, everything installed" goal |
| `docs/claude_desktop_config.all-servers.json` stopgap (absolute `node` paths) | Installer emits `npx -y <bin>` entries | This phase | Stopgap retired in Phase 10 |

**Deprecated/outdated:** none — no library version churn; this is a stdlib + pinned-SDK phase.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node | aggregator + installer | ✓ (engines `>=18`) | ≥18 | — |
| `@modelcontextprotocol/sdk` | aggregator | ✓ | 1.29.0 (installed) | — |
| `node:readline/promises` | installer prompts | ✓ (stdlib ≥18) | — | flags-only in non-TTY |
| A target client (Claude/Cursor/Codex/OpenCode) | installer write | detected at runtime | — | wizard reports "none found"; user can still `--client` |
| `codex` CLI | (only the rejected `codex mcp add` alt) | not required | — | text-splice TOML (primary path needs no codex CLI) |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** if zero clients are detected, the installer reports what it looked for and exits cleanly (no write).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` (built-in) + `node:assert` |
| Config file | none — `npm test` = `node --test` `[VERIFIED: package.json]` |
| Quick run command | `node --test test/aggregator.test.js` (new) |
| Full suite command | `npm test` (all `test/*.test.js`, ~432 tests must stay green) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AGG-01 | Aggregator registers the full union of 11 sources' tools, prefixes intact | unit | `node --test test/aggregator.test.js` | ❌ Wave 0 |
| AGG-01 | Aggregator spawns and completes one `initialize` + `tools/list` shows every prefix | integration | `node --test test/aggregator.test.js` | ❌ Wave 0 |
| AGG-01 | 11 standalone bins still connect when run directly (regression) | integration | existing `test/uniform-run.test.js` / spawn check | ✅ (extend if needed) |
| INST-01 | JSON merge preserves an unrelated existing entry | unit | `node --test test/installer.test.js` | ❌ Wave 0 |
| INST-01 | TOML splice adds our block, keeps sandwiching user tables, idempotent on re-run | unit | `node --test test/installer.test.js` | ❌ Wave 0 |
| INST-01 | Backup file written before any config change | unit | `node --test test/installer.test.js` | ❌ Wave 0 |
| INST-01 | Platform entry builder emits `cmd /c` on win32, `npx` elsewhere; `env` vs `environment` per client | unit | `node --test test/installer.test.js` | ❌ Wave 0 |
| INST-01 | Secret with `"`/`\` is escaped, does not corrupt JSON/TOML | unit | `node --test test/installer.test.js` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `node --test test/aggregator.test.js` or `test/installer.test.js` (whichever the task touched).
- **Per wave merge:** `npm test` (full suite green — 432 existing + new must all pass).
- **Phase gate:** full suite green before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `test/aggregator.test.js` — covers AGG-01 (union completeness + single-handshake spawn). Make installer merge/splice functions **pure and exported** so they unit-test without touching real client configs (inject the config path + text).
- [ ] `test/installer.test.js` — covers INST-01 (JSON merge non-destructive, TOML splice non-destructive+idempotent, backup-first, platform entry shape, secret escaping). Use `os.tmpdir()` fixtures.
- [ ] Framework install: none — `node:test` is built in.

## Security Domain

> `security_enforcement` default (enabled). This is a local CLI writing to the user's own machine; no network trust boundary is added.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | installer stores, does not authenticate |
| V5 Input Validation | yes | escape secret values before writing to JSON/TOML; validate `--client` against the 4-client allowlist; reject unknown flags |
| V6 Cryptography | no | secrets written plaintext by design (D-05) — **warn**, do not encrypt (keychain path is the `.mcpb` bundle, out of scope) |
| V12 Files & Resources | yes | write only to the detected client config path; back up before overwrite; never follow into unexpected dirs; timestamped backups avoid clobber |
| V14 Config | yes | non-destructive merge (never wipe unrelated entries); fail-loud on unparseable config rather than overwrite |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Plaintext secret on disk | Information Disclosure | D-05 one-line warning + point to `.mcpb` keychain path; accepted trade-off |
| Config corruption / data loss | Tampering | backup-first + parse-or-abort + set-only-our-keys merge |
| Secret injection breaking file syntax | Tampering | escape `\`/`"`, reject control chars in TOML string literals |
| Path confusion (MSIX virtualized Claude path) | (availability) | target `%APPDATA%\Claude\`; report if not found |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `medium-research-mcp` bin (name === package) is the default bin `npx github:owner/repo` resolves to (PKG-05) | package.json wiring | Low — standard npm behavior; Phase 10 verifies the actual GitHub install path. If wrong, Phase 10 adds explicit bin arg. |
| A2 | Linux Claude Desktop config is `~/.config/Claude/claude_desktop_config.json` | per-client table | Low — Linux Claude Desktop is unofficial; installer can skip Linux Claude detection or probe both. |
| A3 | OpenCode global config filename is `opencode.json` under `~/.config/opencode/` (not `config.json`) | per-client table | Low — docs confirm `opencode.json`; installer can accept either name if present. |
| A4 | Installer living at `bin/install.js` requires adding `"bin/"` to `files` | package.json wiring | Low — mechanical; verifiable with `npm pack --dry-run`. |

**All other claims are VERIFIED (installed source / repo files) or CITED (official docs).**

## Open Questions

1. **Installer file location — `bin/` vs under `servers/`/`shared/`?**
   - What we know: aggregator under `servers/` is auto-covered by `files`; installer is not a server.
   - What's unclear: repo convention (no `bin/` dir today).
   - Recommendation: `bin/install.js`, add `"bin/"` to `files`. Confirm with `npm pack --dry-run` (INSTALL.md §272 already prescribes this check).

2. **`--separate` in aggregator vs 11 mode — which entries carry the key `env` blocks?**
   - Recommendation: single aggregator entry → one `env` block on `medium-research-all` with whichever keys provided. `--separate` → keys go only on `medium-research-librariesio` / `medium-research-producthunt` entries (mirror INSTALL.md per-client examples).

## Sources

### Primary (HIGH confidence)
- `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js` (installed) — `McpServer` API: private `_registeredTools`, public `registerTool` only, no merge/mount, dup-name throw, `connect` delegation.
- `shared/main.js` — `isEntry` semantics (why imports don't auto-connect).
- `servers/hn/server.js`, `servers/mastodon/server.js` — uniform export shape across all 11 (verified via grep).
- `scripts/build-mcpb.mjs` — explicit 11-name `SERVERS` list; aggregator not bundled.
- `package.json`, `docs/INSTALL.md`, `docs/claude_desktop_config.all-servers.json` — bins, formats, entry shapes.
- `test/uniform-run.test.js` (import grep) — tests use `map*` exports, not `server`.

### Secondary (MEDIUM confidence)
- [OpenCode Config docs](https://opencode.ai/docs/config/) — global `~/.config/opencode/opencode.json`, `mcp` block schema.
- [MCP: Connect to local servers](https://modelcontextprotocol.io/docs/develop/connect-local-servers) — Claude Desktop config paths.
- [Claude Desktop config location guide](https://www.oreateai.com/blog/locating-your-claude-desktop-configuration-file-a-quick-guide/bffb3e3b775914142430ff17ef620365) — `%APPDATA%\Claude\` / `~/Library/Application Support/Claude/`.
- [claude-code issue 26073](https://github.com/anthropics/claude-code/issues/26073) — Windows MSIX virtualized config path gotcha.

## Metadata

**Confidence breakdown:**
- Aggregator merge seam: HIGH — verified against installed SDK source and the repo's uniform server shape.
- Installer prompts/merge: HIGH — stdlib APIs; formats verified in INSTALL.md; paths cross-checked.
- TOML verdict: HIGH — confirmed no stdlib parser + generate-only strategy removes the need for one.
- Config paths: MEDIUM — OS paths cross-checked via docs; MSIX/Linux edge cases flagged as assumptions.

**Research date:** 2026-07-22
**Valid until:** 2026-08-21 (stable; re-verify only if `@modelcontextprotocol/sdk` major-bumps or a target client changes its config format)
</content>
</invoke>
