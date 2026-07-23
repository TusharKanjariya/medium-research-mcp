---
phase: 09-aggregator-one-shot-installer
reviewed: 2026-07-23T00:00:00Z
depth: standard
files_reviewed: 16
files_reviewed_list:
  - bin/install.js
  - servers/aggregator/server.js
  - servers/hn/server.js
  - servers/stackexchange/server.js
  - servers/lobsters/server.js
  - servers/lemmy/server.js
  - servers/devto/server.js
  - servers/github/server.js
  - servers/librariesio/server.js
  - servers/producthunt/server.js
  - servers/rss/server.js
  - servers/discourse/server.js
  - servers/mastodon/server.js
  - test/aggregator.test.js
  - test/installer.test.js
  - package.json
findings:
  critical: 0
  warning: 1
  info: 3
  total: 4
status: issues_found
---

# Phase 9: Code Review Report

**Reviewed:** 2026-07-23
**Depth:** standard
**Files Reviewed:** 16
**Status:** issues_found

## Summary

Reviewed the aggregator (`medium-research-all`), the stdlib-only install wizard,
the 11 `registerTools()` seam edits, and both new test files. I traced the two
highest-risk invariants end to end rather than trusting the comments:

- **Output contract preserved through the seam.** Every server exports
  `registerTools(server)` containing the *same* `server.registerTool(name, {…},
  handler)` calls; no name is altered, no handler return shape changed, no tool
  dropped. The 37-tool union (4+4+4+3+4+3+2+2+4+3+4) is complete and matches the
  test assertion. No tool-name collisions across prefixes.
- **Single stdio connect holds.** `isEntry` (shared/main.js) realpath-compares
  `import.meta.url` to `process.argv[1]`, so when the aggregator is the entry only
  its own `.connect()` fires; each imported server's `isEntry` is false. Importing
  a server does construct its throwaway module-level `server` and call
  `registerTools` on it, but that never connects — no import-time transport, no
  double stdio. Invariant verified, not assumed.
- **Installer secret handling is sound in the main paths.** No key value is ever
  logged (all `console.log` output is paths/ids/status), JSON values go through
  `JSON.stringify` (auto-escaped), TOML values go through `escapeTomlString`
  (backslash/quote escaped, control chars/newlines rejected — blocks table/line
  injection from a pasted key), `backupConfig()` runs before every write, the
  JSON/TOML merges are non-destructive + idempotent, and the non-TTY guard exits
  loudly instead of hanging. Path construction uses fixed config names off
  `homedir`/`APPDATA` with no user input in the path, and `--client` is
  allowlist-validated. `process.env.APPDATA` read is documented path-discovery,
  not a credential read (permitted per the install.js boundary).

No BLOCKER-class correctness or security defect was found after adversarial
tracing. The remaining findings are one robustness gap in the JSON merge and
three minor quality/hardening items.

## Warnings

### WR-01: `mergeJson` silently discards our entry when the container key holds a non-object

**File:** `bin/install.js:56-75`
**Issue:** The function validates that the *top-level* parsed value is a plain
object (lines 68-70) but does not validate the *container* (`mcpServers` / `mcp`).
`obj[containerKey] ??= {}` only fills a missing/null container, so if an existing
config has `{"mcpServers": []}` (an array) the `??=` is a no-op, then
`obj[containerKey][name] = entry` sets a named property on the array. `JSON.stringify`
drops named properties on arrays, so the file is rewritten as `"mcpServers": []`
— our server entry is silently lost while the CLI reports success ("wrote to …").
A string container hits the same missing-validation path and throws a raw
`TypeError` instead of the clear "not a JSON object" message the top-level guard
already produces. This is unlikely with real client configs (the container is
always an object), but it is a genuine silent-failure in a config-mutation tool
and the defensiveness is inconsistent with the top-level check right above it.
**Fix:**
```js
obj[containerKey] ??= {};
const c = obj[containerKey];
if (typeof c !== "object" || c === null || Array.isArray(c)) {
  throw new Error(`${cfgPath} "${containerKey}" is not a JSON object. Left unchanged.`);
}
for (const [name, entry] of Object.entries(entries)) c[name] = entry;
```

## Info

### IN-01: Aggregator server version (1.2.0) drifts from package + sibling servers

**File:** `servers/aggregator/server.js:31-34`
**Issue:** The aggregator declares `version: "1.2.0"`, but `package.json` is
`1.1.0` (`package.json:3`) and every sibling server declares `1.0.0`. MCP clients
surface this version, so a new server in a `1.1.0` package reporting a *higher*
version than the package is confusing and inconsistent.
**Fix:** Align the aggregator to the package version (`1.1.0`) — or, if server
versions are intentionally independent, standardize them (all servers at `1.0.0`
would make the `1.2.0` outlier obviously deliberate).

### IN-02: Interactive key entry is echoed to the terminal (no masking)

**File:** `bin/install.js:381-384`
**Issue:** `rl.question("LIBRARIESIO_KEY (Enter to skip): ")` echoes typed/pasted
input, so the secret is visible on-screen (and in terminal scrollback) during
entry. Storage-at-rest is already disclosed via `PLAINTEXT_WARNING`, but the
on-screen echo is an additional shoulder-surf/scrollback exposure for a wizard
whose whole job is handling secrets. Low priority for a local, interactive CLI.
**Fix:** Optionally mute stdout echo while reading a key (write `*`/nothing on
`readline` `line`/keypress), or leave as-is and note the tradeoff — stdlib
`readline/promises` has no built-in mask, so this is a deliberate simplicity call.

### IN-03: Config files containing plaintext keys are written with default permissions

**File:** `bin/install.js:74, 171`
**Issue:** `fs.writeFileSync(cfgPath, …)` uses default mode (typically `0644` on
POSIX), so a config that may embed `LIBRARIESIO_KEY`/`PRODUCTHUNT_TOKEN` is
group/world-readable. The clients themselves generally write these files with
default perms too, so tightening only our write is arguably inconsistent — hence
INFO, not WARNING — but a secret-writing installer restricting to `0600` is a
reasonable hardening. (Windows perms model differs; guard by platform.)
**Fix (optional, POSIX):**
```js
fs.writeFileSync(cfgPath, JSON.stringify(obj, null, 2) + "\n", { mode: 0o600 });
```

---

_Reviewed: 2026-07-23_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
