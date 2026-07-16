---
phase: 08-universal-distribution
verified: 2026-07-16T12:10:48Z
status: human_needed
score: 7/8 must-haves verified
behavior_unverified: 1
overrides_applied: 0
behavior_unverified_items:
  - truth: "A sensitive user_config secret reaches the running server as env via the OS keychain on a live Claude Desktop install (librariesio → LIBRARIESIO_KEY, producthunt → PRODUCTHUNT_TOKEN), and the no-key path errors naming the env var"
    test: "Install dist/medium-research-librariesio.mcpb and dist/medium-research-producthunt.mcpb in Claude Desktop (double-click or Settings → Extensions). Enter a real key when prompted (confirm the field is masked), call one tool (e.g. librariesio_search). Then reinstall with no key and call the tool again."
    expected: "With the key: a normal normalized result — proving the keychain-stored secret was injected as the env var. Without the key: a clear 'set LIBRARIESIO_KEY' / 'set PRODUCTHUNT_TOKEN' error, not a crash or silent empty list."
    why_human: "The keychain→env injection is host-specific Claude Desktop UI behavior that cannot be driven headlessly; grep/spawn checks cannot observe the OS keychain path. Server-side credential path (accessor throws/accepts) was verified live this session; only the live Desktop keychain UI remains. Explicitly deferred to phase UAT per user decision (08-03-SUMMARY 'Task 2 (D-04)')."
human_verification:
  - test: "Install dist/medium-research-librariesio.mcpb + dist/medium-research-producthunt.mcpb in Claude Desktop, enter a real API key/token when prompted (confirm masked), and call one tool from each"
    expected: "A normalized result returns — the OS-keychain sensitive user_config value reached the server as its env var (LIBRARIESIO_KEY / PRODUCTHUNT_TOKEN)"
    why_human: "Live Claude Desktop keychain→env injection is host UI behavior; cannot run headlessly. Server-side credential path already verified live; only the Desktop keychain half remains (D-04, user-deferred to UAT)"
  - test: "Reinstall a credentialed bundle without entering the key and call its tool"
    expected: "A clear 'set LIBRARIESIO_KEY' / 'set PRODUCTHUNT_TOKEN' error naming the env var — not a crash or a silent empty list"
    why_human: "Required-credential failure UX on the live plugin/Desktop path (Pitfall E) diverges by host and only surfaces on a real install"
---

# Phase 8: Universal Distribution Verification Report

**Phase Goal:** Any MCP-capable client on any OS can install and run every server — one-click `.mcpb` in Claude Desktop or `npx` from npm elsewhere — with working per-client docs and the cross-source research recipe.
**Verified:** 2026-07-16T12:10:48Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | ------- | ---------- | -------------- |
| 1 | `npx medium-research-<source>` runs any of 11 servers, Windows-safe (SC2/PKG-02) | ✓ VERIFIED | package.json has exactly 11 `medium-research-<source>` bins → `servers/<name>/server.js`; all 11 `server.js` start with `#!/usr/bin/env node` and call `isEntry(import.meta.url)`; no naive `import.meta.url === pathToFileURL` guard remains |
| 2 | npm tarball ships `servers/` AND `shared/`, excludes `test/` + `.planning/` (PKG-02) | ✓ VERIFIED | `npm pack --dry-run`: ships 11 server.js + 11 manifests + 7 shared modules (incl `shared/main.js`) + README + docs/INSTALL.md; no `test/` or `.planning/` entries; package size 70.9 kB |
| 3 | `shared/main.js` exports realpath-hardened `isEntry()`; guard is symlink-safe and non-throwing | ✓ VERIFIED | `isEntry()` realpaths `process.argv[1]` before comparing; false-positive check on a nonexistent path returns false; guards missing argv1 and realpath failure |
| 4 | All 11 manifests: v1.1.0, manifest_version 0.3, Option-A entry_point/args, sensitive creds; D-05 test green (PKG-01) | ✓ VERIFIED | All 11 manifests `version=1.1.0`, `mv=0.3`, `entry_point=servers/<name>/server.js`, args `${__dirname}/servers/<name>/server.js`; hn `user_config={}` no env; librariesio/producthunt/github/stackexchange/lemmy credentialed fields keep `sensitive:true`; `test/manifest-consistency.test.js` 12/12 pass |
| 5 | 11 `.mcpb` bundles built, validate + spawn-tested, in size band, gitignored (SC1/PKG-01) | ✓ VERIFIED | `dist/` holds 11 unique `medium-research-<source>.mcpb` at ~3.45 MB each (in 200 KB–20 MB band); `scripts/build-mcpb.mjs` (195 lines) stages Option A, gates each with `mcpb validate` + MCP-initialize spawn test + `npm ci --omit=dev --ignore-scripts` before `mcpb pack`; `dist/` gitignored, `git status --porcelain dist/` empty; build re-run this session exited 0 (verification notes) |
| 6 | Live Claude Desktop keychain→env injection for the 2 credentialed bundles (SC1/D-04) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Bundles present + spawn-tested + `sensitive:true` marked; server-side credential path verified live this session (librariesio/producthunt accessors accept real creds, throw `set X` without). Live Desktop keychain UI cannot run headlessly — user-deferred to UAT. See Human Verification. |
| 7 | `docs/INSTALL.md` per-client per-OS setup, env blocks, caveats, release checklist; README links it (SC3/PKG-03) | ✓ VERIFIED | INSTALL.md (12.1 kB) contains all of: cmd, /c, npx, -y, Claude Desktop, Cursor, Codex, OpenCode, plugin, LIBRARIESIO_KEY, PRODUCTHUNT_TOKEN, pain-point-sweep, npm publish, v1.1.0, mergeRank; GUI-env-not-inherited + cold-start + keychain notes present; README.md links it |
| 8 | Cross-source sweep runs end-to-end via `mergeRank`, degrades gracefully (SC4/DOC-01) | ✓ VERIFIED | Ran live: `node examples/pain-point-sweep.mjs rust` → SE=30 Discourse=50 Mastodon=40 Dev.to=40, 160 items merged, top-15 by descending score, exit 0. Bad-host edge (`…invalid.host.example` for Mastodon) → `[mastodon] skipped:` on stderr, mastodon=0, 120 items from 3 sources, exit 0 — contract intact. Reuses `mergeRank`+`buildListEnvelope`, no own sort logic |

**Score:** 7/8 truths verified (1 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | ----------- | ------ | ------- |
| `package.json` | 11 bins, files whitelist, v1.1.0, mcpb devDep only | ✓ VERIFIED | 11 bins, files=[servers/,shared/,docs/INSTALL.md,README.md], v1.1.0, private removed, `@anthropic-ai/mcpb@2.1.2` in devDependencies only (absent from dependencies), type:module |
| `shared/main.js` | realpath-hardened isEntry() | ✓ VERIFIED | exports isEntry(); wired into all 11 servers |
| `servers/*/server.js` (11) | shebang + isEntry guard | ✓ VERIFIED | 11/11 shebang line 1 + isEntry, 0 naive guards |
| `servers/*/manifest.json` (11) | v1.1.0, Option-A retarget, sensitive creds | ✓ VERIFIED | all 11 conform; D-05 test enforces manifest⇄credentials |
| `test/manifest-consistency.test.js` | D-05 gate, non-vacuous | ✓ VERIFIED | 12/12 pass; part of 430-test suite |
| `scripts/build-mcpb.mjs` | stage+validate+spawn+pack loop | ✓ VERIFIED | 195 lines, all four gates present |
| `.mcpbignore` | excludes test/, *.md, .planning/, .env* | ✓ VERIFIED | present with all excludes |
| `.gitignore` | dist/ entry | ✓ VERIFIED | `dist/` on line 9 |
| `dist/*.mcpb` (11) | built, in-band, gitignored | ✓ VERIFIED | 11 present ~3.45 MB, nothing tracked |
| `docs/INSTALL.md` | per-client per-OS + release checklist | ✓ VERIFIED | all content markers present |
| `examples/pain-point-sweep.mjs` | runnable cross-source sweep | ✓ VERIFIED | ran live, exit 0, graceful degradation confirmed |
| `README.md` | links INSTALL.md | ✓ VERIFIED | link present |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | --- | --- | ------ | ------- |
| each server.js | shared/main.js | `import { isEntry }` + `isEntry(import.meta.url)` gate | ✓ WIRED | 11/11 |
| manifest env ref | shared/credentials.js ENV_VAR + server import | D-05 consistency test | ✓ WIRED | 12/12 test pass |
| manifest entry_point | staged servers/<name>/server.js → node_modules + shared | Option-A depth mirror, spawn test | ✓ WIRED | 11 bundles spawn-tested, no ERR_MODULE_NOT_FOUND |
| pain-point-sweep.mjs | per-source helpers → buildListEnvelope → mergeRank | direct imports | ✓ WIRED | live run merged 160 items |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Full test suite | `npm test` | 430 pass / 0 fail | ✓ PASS |
| D-05 consistency test | `node --test test/manifest-consistency.test.js` | 12 pass / 0 fail | ✓ PASS |
| isEntry non-throwing + no false-positive | `import shared/main.js` | isEntry OK | ✓ PASS |
| Cross-source sweep end-to-end | `node examples/pain-point-sweep.mjs rust` | 160 items, exit 0 | ✓ PASS |
| Sweep graceful degradation | bad Mastodon host arg | mastodon skipped, 120 items, exit 0 | ✓ PASS |
| Tarball contents | `npm pack --dry-run` | servers/+shared/ ship, no test//.planning/ | ✓ PASS |

Note: `npm run build:mcpb` (full 11-bundle build) was not re-run in this verification pass — it runs `npm ci` + 11 spawn tests (minutes). Evidence relied on: 11 dist bundles present + in-band, the substantive 195-line script with all gates, and the executor's this-session build-exit-0 record. The bundle behavior it would prove (Option-A `../../shared` resolution) is covered by the spawn-test gate baked into the script and the negative control (missing shared/ → ERR_MODULE_NOT_FOUND) reported in 08-03-SUMMARY.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ---------- | ----------- | ------ | -------- |
| PKG-01 | 08-02, 08-03 | One-click `.mcpb` custom connector (staged shared/ + prod deps, sensitive creds) | ✓ SATISFIED (machine half); ? live keychain UI → human | 11 validated+spawn-tested bundles; sensitive:true manifests; D-05 test. Live Desktop keychain = UAT item |
| PKG-02 | 08-01 | Run any server from npm via `npx`, Windows shebang-safe | ✓ SATISFIED | 11 bins, shebangs, isEntry, tarball ships servers/+shared/ |
| PKG-03 | 08-04 | Per-client setup docs (Desktop, OpenCode, Codex, Cursor) + Windows cmd /c npx + env quirks | ✓ SATISFIED | INSTALL.md complete, all markers present |
| DOC-01 | 08-04 | Cross-source pain-point sweep (SE + Discourse + Mastodon + Dev.to via mergeRank) | ✓ SATISFIED | ran live end-to-end + graceful degradation |

All 4 requirement IDs from PLAN frontmatter (PKG-01, PKG-02, PKG-03, DOC-01) are accounted for and match REQUIREMENTS.md Phase 8 mapping. No orphaned requirements.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| (none) | — | No TBD/FIXME/XXX/HACK/PLACEHOLDER in any Phase 8 file | ℹ Info | Clean; 08-REVIEW.md was 0 critical / 4 warning, WR-01/02/03 fixed (commit 10eacdf), WR-04 accepted advisory |

### Human Verification Required

**1. Live Claude Desktop keychain → env injection (D-04, credentialed bundles)**

**Test:** Install `dist/medium-research-librariesio.mcpb` and `dist/medium-research-producthunt.mcpb` in Claude Desktop (double-click or Settings → Extensions). Enter a real Libraries.io key / Product Hunt developer token when prompted (confirm the field is masked). Call one tool from each (e.g. `librariesio_search`).
**Expected:** A normal normalized result — proving the OS-keychain-stored `sensitive` user_config value reached the running server as its env var (`LIBRARIESIO_KEY` / `PRODUCTHUNT_TOKEN`).
**Why human:** Keychain→env injection is host-specific Claude Desktop UI behavior; cannot be driven headlessly. The server-side credential path (accessor accepts real creds, throws `set X` without) was already verified live this session — only the live Desktop keychain half remains. User-deferred to phase UAT.

**2. Required-credential no-key failure UX**

**Test:** Reinstall a credentialed bundle without entering the key and call its tool.
**Expected:** A clear `set LIBRARIESIO_KEY` / `set PRODUCTHUNT_TOKEN` error naming the env var — not a crash or a silent empty list.
**Why human:** Failure UX on the live plugin/Desktop path (Pitfall E) diverges by host and only surfaces on a real install.

### Gaps Summary

No gaps. Every machine-checkable must-have for the phase goal is verified in the codebase:
- **npx path (PKG-02):** package identity, 11 bins, Windows-safe shebangs + realpath-hardened isEntry, and a tarball that ships `servers/`+`shared/` while excluding `test/`/`.planning/` — all confirmed directly.
- **`.mcpb` path (PKG-01):** 11 built, validated + spawn-tested, in-band, gitignored bundles from a supply-chain-hardened staging script; retargeted+consistency-locked manifests with `sensitive` credentials.
- **Docs (PKG-03):** a complete Windows-first per-client INSTALL guide with the required env/GUI-inheritance/cold-start caveats and a manual release checklist.
- **Recipe (DOC-01):** the cross-source sweep runs end-to-end live (160 items merged) and degrades gracefully when a source fails (verified by pointing a source at a bad host).

The single outstanding item is the **live Claude Desktop keychain→env UI test** (D-04) — a legitimately human-only check the user explicitly deferred to phase UAT. It is not a failure or a missing artifact: the bundles exist and are spawn-tested, credentials are marked `sensitive`, and the server-side credential path is verified. Per the phase's own decision (and the ordered status tree), the presence of this human-verification item makes the phase `human_needed`, not `passed` and not `gaps_found`.

---

_Verified: 2026-07-16T12:10:48Z_
_Verifier: Claude (gsd-verifier)_
