---
phase: 09-aggregator-one-shot-installer
verified: 2026-07-23T05:48:21Z
status: human_needed
score: 5/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Run `npx medium-research-mcp install` interactively (in a real TTY) against a machine with at least one of Claude Desktop / Cursor / Codex / OpenCode installed. Walk the wizard: pick a client, press Enter to skip LIBRARIESIO_KEY, paste a value for PRODUCTHUNT_TOKEN, confirm."
    expected: "Wizard lists detected clients, prints the plaintext-vs-.mcpb-keychain warning, writes a timestamped .bak-* backup, merges the medium-research-all entry non-destructively, and the skipped key is absent while the provided key is present in the written env block."
    why_human: "The readline interactive loop (prompt display, skip-on-empty, plaintext warning, confirm-before-write) is the headline UX and has no automated test — the plan deliberately deferred it, testing only the pure entry-builders/flag-parser it wraps. A real interactive smoke is the only way to confirm the end-to-end user flow before Phase 10 publish."
---

# Phase 9: Aggregator & One-Shot Installer Verification Report

**Phase Goal:** The package gains the `medium-research-all` aggregator server and the `npx medium-research-mcp install` command, so everything v1.2 distributes exists before publish.
**Verified:** 2026-07-23T05:48:21Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

All five ROADMAP success criteria and both plan must-have sets are met in the actual codebase. Automated verification is fully green; one interactive-UX smoke remains for a human before publish.

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | ONE config entry (`medium-research-all`) exposes every source's tools, names + contract identical to the 11 standalone servers | ✓ VERIFIED | `servers/aggregator/server.js` mounts all 11 via a `registerTools` loop; `test/aggregator.test.js` asserts the exact 37-tool union across all 11 prefixes (in-memory Client/InMemoryTransport round-trip) — passes. Tool blocks were relocated verbatim into `registerTools(server)`, no schema/name edits. |
| 2 | `install` detects clients (Claude, OpenCode, Codex, Cursor) incl. each format (JSON/TOML, env/environment, win32 `cmd /c`) | ✓ VERIFIED | `detectClients()`/`clientDescriptors()` probe each client dir; `stdioEntry`/`opencodeEntry`/`tomlBlock` emit the per-client shapes; `cmd /c` branch on win32. 20 installer unit tests pass. |
| 3 | Backs up config before writing; merges 11 (or aggregator) entries non-destructively, never altering unrelated entries | ✓ VERIFIED | `writeToClient` calls `backupConfig` (timestamped `copyFileSync`) before merge; `mergeJson` sets only named keys on the container; `spliceTomlTable` anchors on line-start `[`. Tests: unrelated `some-other-server` survives, sandwiched TOML tables survive + idempotent, parse-failure aborts unchanged. |
| 4 | Prompts for LIBRARIESIO_KEY / PRODUCTHUNT_TOKEN, each skippable; skip leaves server keyless/fail-loud | ✓ VERIFIED | Interactive prompts treat empty input as skip; `envFor` keeps only provided keys; keyed sources mounted unconditionally (D-02). Entry-builder + `envFor` tests confirm key placement/omission. (Interactive readline path itself → human smoke, below.) |
| 5 | 11 bins + `.mcpb` bundles unchanged; full suite passes, zero contract changes | ✓ VERIFIED | `npm test` = 461 pass / 0 fail. All 11 `isEntry` guards intact; each server calls `registerTools(server)` locally so standalone tool sets are unchanged. `scripts/build-mcpb.mjs` SERVERS array is the frozen 11 (aggregator absent → never bundled). Standalone hn bin spawn-over-stdio test passes. |

**Score:** 5/5 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `servers/aggregator/server.js` | One McpServer `medium-research-all` mounting all 11 | ✓ VERIFIED | Imports only `registerTools` named exports; single `isEntry`-gated `.connect()`; no per-source logic. |
| `registerTools(server)` in each of 11 `servers/*/server.js` | Named export + local call | ✓ VERIFIED | All 11 export it (grep) and call it locally after `export const server`. |
| `test/aggregator.test.js` | Union completeness + standalone regression | ✓ VERIFIED | 2 tests: exact 37-tool union, real-stdio hn bin handshake. Both pass. |
| `bin/install.js` | Stdlib-only installer + pure helpers | ✓ VERIFIED | `node:fs/path/os/readline` + `isEntry` only; backup, JSON/TOML merge, detect, entry-builders, flags, non-TTY guard all present. |
| `test/installer.test.js` | tmpdir-fixture unit tests | ✓ VERIFIED | 20 tests pass (merge, backup, splice, platform, escaping, detection, flags, non-TTY guard). |
| `package.json` bins + `files` | `medium-research-all`, `medium-research-mcp`, `bin/` | ✓ VERIFIED | Both bins present; `bin/` added to `files`; `dependencies` unchanged (git diff confirms only bins + files touched). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| aggregator | 11 servers | imports `registerTools` named export, never the instance; never `.connect()`s an import | ✓ WIRED | Exactly one `.connect()` in aggregator, under `isEntry`. |
| each server | own `server` | local `registerTools(server)` call | ✓ WIRED | All 11 confirmed (grep). |
| `writeToClient` | config file | `backupConfig` before merge; set-only-our-keys | ✓ WIRED | Backup precedes merge in all three format branches. |
| escaped secrets | JSON/TOML | `JSON.stringify` / `escapeTomlString` (reject control chars) | ✓ WIRED | TOML escapes `\`/`"`, throws on control/newline. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Aggregator serves full union | `node --test test/aggregator.test.js` | 37-tool union asserted, 2/2 pass | ✓ PASS |
| Standalone hn bin starts over stdio | (same, spawn test) | MCP initialize handshake completes | ✓ PASS |
| Installer helpers (merge/backup/splice/escape/detect) | `node --test test/installer.test.js` | 20/20 pass | ✓ PASS |
| Full suite, zero regressions | `npm test` | 461 pass / 0 fail | ✓ PASS |
| No new dependency | `git diff 0c7d385 HEAD -- package.json` | only `bin/` + 2 bins added | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| AGG-01 | 09-01 | `medium-research-all` bin exposes every source's tools; names + contract unchanged; 11 bins + `.mcpb` unaffected | ✓ SATISFIED | Aggregator + 37-tool union test; SERVERS array frozen; suite green. |
| INST-01 | 09-02 | `install` detects client, backs up, merges 11 non-destructively, prompts for 2 keys with skip | ✓ SATISFIED | Installer + 20 tests; non-destructive merge proven for JSON and TOML. |

No orphaned requirements — REQUIREMENTS.md maps only AGG-01 and INST-01 to Phase 9, both claimed and implemented.

### Anti-Patterns Found

One `ponytail:` comment in `bin/install.js:152` documenting the deliberate regex-splice-not-a-parser shortcut with an upgrade path — intentional, referenced, not a debt marker. No `TBD`/`FIXME`/`XXX`, no stubs, no hollow returns in phase files.

### Human Verification Required

**1. Interactive install wizard end-to-end**

**Test:** Run `npx medium-research-mcp install` in a real TTY on a machine with at least one target client installed. Pick a client, press Enter to skip LIBRARIESIO_KEY, paste a PRODUCTHUNT_TOKEN, confirm.
**Expected:** Detected clients listed, plaintext-vs-keychain warning printed, timestamped `.bak-*` backup written, `medium-research-all` merged non-destructively, skipped key absent / provided key present in the written env block.
**Why human:** The readline interactive loop is the headline UX and has no automated coverage (plan deferred it, testing only the pure helpers it wraps). Non-interactive `--client` path and all helpers are tested; only the live interactive flow needs a human smoke before Phase 10 publish.

### Gaps Summary

No gaps. Every artifact exists, is substantive, and is wired; both requirements satisfied; full suite green (461/0); no contract changes; `.mcpb` and the 11 standalone bins untouched. The single open item is a pre-publish human smoke of the interactive installer wizard — a user-flow-completion check grep cannot perform, not a code gap.

---

_Verified: 2026-07-23T05:48:21Z_
_Verifier: Claude (gsd-verifier)_
