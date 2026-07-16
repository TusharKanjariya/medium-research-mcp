---
phase: 08-universal-distribution
reviewed: 2026-07-16T11:31:00Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - shared/main.js
  - scripts/build-mcpb.mjs
  - examples/pain-point-sweep.mjs
  - test/manifest-consistency.test.js
  - package.json
  - servers/hn/server.js
  - servers/hn/manifest.json
findings:
  critical: 0
  warning: 4
  info: 4
  total: 8
status: issues_found
---

# Phase 8: Code Review Report

**Reviewed:** 2026-07-16T11:31:00Z
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Phase 8 is dev-time packaging. The novel logic is sound: `isEntry()` is correct on
both POSIX and Windows for copy and symlinked installs and never throws; the frozen
output contract is untouched (the hn swap only added the shebang + `isEntry` guard
and changed no tool registration, handler, or item shape); `package.json` ships both
`servers/` and `shared/` in `files`, keeps `@anthropic-ai/mcpb` in devDependencies
only, and adds no runtime dependency; the build script correctly uses
`npm ci --omit=dev --ignore-scripts` so no dependency postinstall can ride into a
bundle. All imports in the sweep example resolve to real exports, and every source
fetch is wrapped so one bad source degrades to an empty envelope without breaking the
contract.

No Critical issues. Findings are packaging-robustness Warnings on `build-mcpb.mjs`
(partial `dist/` on failure, unquoted shell args, temp-dir leaks), one
`process.env`-in-example convention flag, and Info-level test-completeness notes.

## Structural Findings (fallow)

None provided.

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: A mid-loop build failure leaves a partial `dist/` populated with a subset of bundles

**File:** `scripts/build-mcpb.mjs:146-191`
**Issue:** `dist/` is wiped only at the *start* of `main()` (line 148). Bundles are
written into `dist/` one at a time inside the loop (line 168). If server N fails a
gate (`spawnTest` rejects, size out of band, `mcpb pack` throws), `main().catch`
prints and exits 1 — but `dist/` still contains the N-1 `.mcpb` files built before the
failure. A release operator who runs `npm run build:mcpb` and then uploads `dist/*`
without checking the exit code would publish an incomplete set that *looks* populated.
This is the last phase before a public release, so a half-built `dist/` that survives a
failed run is a real release-safety hazard. (The header comment claims "no partial
artifact is ever committed," which is true only for the next run's initial wipe, not
for the failed run's leftovers.)
**Fix:** Build into a staging dir and promote to `dist/` only after all 11 succeed, or
clean `dist/` in the failure path:
```js
main().catch((e) => {
  fs.rmSync(DIST, { recursive: true, force: true }); // no partial set survives a failure
  console.error(`\nBUILD FAILED: ${e.message}`);
  process.exit(1);
});
```

### WR-02: `execFileSync(..., { shell: true })` with unquoted interpolated paths breaks on paths containing spaces

**File:** `scripts/build-mcpb.mjs:40-47, 163, 168`
**Issue:** On Windows `runMcpb` runs with `shell: true`, and Node does **not** quote
arguments when `shell` is enabled — it joins `file + args` with spaces into a single
cmd.exe command line. The interpolated `stage`, `out`, and `manifest.json` paths come
from `os.tmpdir()` and `ROOT`. If `TEMP` or the repo path contains a space (e.g.
`C:\Users\John Doe\...`), `mcpb validate C:\...\John Doe\...` splits at the space and
the build fails with a confusing error. Shell metacharacters (`&`, `^`) in a path
would be interpreted rather than passed literally. Injection is not realistic here
(paths are build-controlled, not user input), but the robustness gap is real and
silent. On the current machine it happens to work only because `tmpdir()` resolves to
an 8.3 short name with no spaces.
**Fix:** Quote the interpolated path arguments before joining, e.g. wrap each path arg
in double quotes when `shell` is true, or invoke the shim via `cmd /c` with explicitly
quoted args. Minimal:
```js
const q = (a) => (process.platform === "win32" ? `"${a}"` : a);
execFileSync(mcpbBin, args.map(q), { cwd: ROOT, stdio: [...], shell: process.platform === "win32" });
```

### WR-03: Temp dirs leak on failure paths outside the try/finally

**File:** `scripts/build-mcpb.mjs:51-61, 129-144, 152-181`
**Issue:** `buildProdModules()` (line 52) calls `fs.mkdtempSync` *before* the loop's
`try/finally`. If `npm ci` fails (line 55), the freshly created temp dir — soon to hold
a full prod `node_modules` (tens of MB) — is never removed, because the `finally` that
cleans `path.dirname(prodModules)` (line 179) is only entered after `prodModules` is
assigned. Similarly, `stageServer()` (line 130) `mkdtempSync`s the stage dir first; if
any `copyFileSync`/`cpSync` inside it throws, that stage dir leaks because it is pushed
to `stages` (line 158) only *after* `stageServer` returns. Repeated failed builds
accumulate large orphaned temp trees.
**Fix:** Wrap `buildProdModules`'s copy/install in a try that removes `dir` on throw,
and have `stageServer` clean its own `stage` on failure (or push to `stages`
immediately after `mkdtempSync`, before the copies).

### WR-04: Example reads `process.env` for instance overrides (convention: process.env only in credentials.js)

**File:** `examples/pain-point-sweep.mjs:48, 50`
**Issue:** `DISCOURSE_INSTANCE` and `MASTODON_INSTANCE` are read from `process.env`
directly. Project convention (CLAUDE.md / .claude/CLAUDE.md) is "never read
`process.env` outside `shared/credentials.js`." These are non-secret instance URLs and
this is a standalone example rather than a server, so the intent of the rule (keep
credential reads centralized) is not really breached — but per the phase review
directive to flag any `process.env` read outside `credentials.js` as at least Warning,
it is called out here.
**Fix:** If keeping the env override, add a one-line comment noting these are
non-secret example overrides deliberately exempt from the credentials.js rule; or drop
the env fallbacks and rely on argv[3]/argv[4] only (already supported on lines 48/50).

## Info

### IN-01: Sweep example mutates frozen-contract items with a `_source` field

**File:** `examples/pain-point-sweep.mjs:144-146`
**Issue:** `item._source = e.source` adds a field to normalized contract items. The
inline comment correctly notes this is display-only, inert to `mergeRank`, and never
touches tool output — so the frozen contract is not violated (this is example glue, not
a server return). Noting only because it writes onto the otherwise-frozen item shape.
**Fix:** Acceptable as-is for an example; alternatively pair items with their source in
a wrapper tuple instead of mutating the item.

### IN-02: Manifest-consistency negative control exercises only one assertion branch

**File:** `test/manifest-consistency.test.js:84-91`
**Issue:** The negative control proves the `user_config.<field>` existence assertion
bites (line 57), but there is no control proving the two branches that actually catch
an *over-declared credential* fire: `credSource.includes("$ENVNAME")` (line 61) and
`assert.ok(accessor, ...)` (line 65). Those asserts clearly would throw, but the review
directive specifically asked whether over-declaration is caught non-vacuously — a
dedicated control (e.g. a manifest env `REDDIT_CLIENT_SECRET` wired to a declared
user_config field, expected to throw on the missing accessor) would lock that in.
**Fix:** Add a second negative control asserting `assertEnvConsistency` throws for an
env name with a valid user_config field but no `ACCESSOR` entry.

### IN-03: Test can't detect a `user_config` field that is over-declared but never wired into `env`

**File:** `test/manifest-consistency.test.js:48-71`
**Issue:** `assertEnvConsistency` iterates `server.mcp_config.env` only. A dead
`user_config` field with no corresponding `env` mapping (declared but doing nothing)
passes silently. The scaffold-era over-declaration is caught only because such creds
also appear in `env`. A stray user_config-only field would not be flagged.
**Fix:** Optionally also assert every `user_config` field is referenced by some `env`
entry, so dead credential declarations are surfaced too.

### IN-04: Minor: `serverSource.includes(envName)` loosening and unreachable final tally

**File:** `test/manifest-consistency.test.js:67`, `scripts/build-mcpb.mjs:182-184`
**Issue:** (a) The `|| serverSource.includes(envName)` fallback (line 67) can pass a
server that merely mentions the env name in a comment without reading the accessor,
weakening the "actually read by the server" guarantee. (b) The
`built.length !== SERVERS.length` check (build script lines 182-184) is effectively
dead — any per-server failure throws inside the loop before this runs; it is harmless
defensive code.
**Fix:** (a) Consider dropping the `|| includes(envName)` branch if servers never read
the raw env name. (b) Leave the tally as a cheap invariant or remove it.

---

_Reviewed: 2026-07-16T11:31:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
