---
phase: 09-aggregator-one-shot-installer
plan: 02
subsystem: installer
tags: [cli, installer, mcp, stdlib, readline, toml, json-merge, backup]

# Dependency graph
requires:
  - phase: 09-aggregator-one-shot-installer
    plan: 01
    provides: "medium-research-all aggregator bin — the single MCP process the installer registers by default"
provides:
  - "bin/install.js — npx medium-research-mcp install: detect 4 clients, backup-first, non-destructive merge, skippable key prompts"
  - "medium-research-mcp bin (name === package → PKG-05 default-bin fix)"
  - "pure exported merge/build/escape/detect helpers unit-tested against tmpdir fixtures"
affects: [10-publish]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Generate-and-splice TOML: never parse arbitrary user TOML — idempotent remove-then-append of only our own [mcp_servers.medium-research-*] tables, anchored on line-start [ so unrelated tables survive"
    - "Non-destructive JSON merge: set-only-our-keys on the container object (mcpServers/mcp), never replace the container; parse-or-abort leaves a bad file byte-unchanged"
    - "Backup-first (timestamped copyFileSync) before every write; write is the last step so Ctrl+C before confirm leaves configs untouched"
    - "Pure + exported helpers (platform/home injectable) so every merge/build/escape/detect path is tmpdir-testable without touching a real client config"

key-files:
  created:
    - bin/install.js
    - test/installer.test.js
  modified:
    - package.json

key-decisions:
  - "Zero new runtime deps: node:readline/promises + fs/path/os only. Rejected inquirer (prompt lib) and @iarna/toml (parser) per research §Alternatives — we generate our own TOML, never parse user TOML."
  - "process.env.APPDATA read in the installer is OS path discovery, NOT a credential read — permitted by the constraints callout (CLAUDE.md's process.env ban is about secrets in servers). Keys flow only through interactive prompts into the config env/environment block."
  - "Default writes the single medium-research-all aggregator entry with both keys on one env block; --separate writes 11 entries with keys only on librariesio/producthunt (research §Open Questions #2)."
  - "Non-TTY guard requires --client and never prompts; --client validated against the 4-value allowlist, unknown flags rejected (T-09B-04/05)."

requirements-completed: [INST-01]

coverage:
  - id: D1
    description: "Installer detects Claude/Cursor/Codex/OpenCode by probing each client's config directory"
    requirement: "INST-01"
    verification:
      - kind: unit
        ref: "test/installer.test.js#detectClients returns exactly the clients whose config dir exists"
        status: pass
    human_judgment: false
  - id: D2
    description: "Writes correct per-client format: JSON (env) for Claude/Cursor, JSON (environment, array command) for OpenCode, TOML for Codex; cmd /c on win32"
    requirement: "INST-01"
    verification:
      - kind: unit
        ref: "test/installer.test.js#stdioEntry / opencodeEntry / tomlBlock / OpenCode merge"
        status: pass
      - kind: manual
        ref: "smoke test: --client=cursor and --client=codex --separate write valid configs with win32 cmd /c wrapper"
        status: pass
    human_judgment: false
  - id: D3
    description: "Backs up config (timestamped) before any write; merges non-destructively — unrelated JSON entries and sandwiched TOML tables survive; parse failure aborts"
    requirement: "INST-01"
    verification:
      - kind: unit
        ref: "test/installer.test.js#mergeJson preserves an unrelated server entry / spliceTomlTable sandwich survival / parse-failure leaves file unchanged / backupConfig"
        status: pass
    human_judgment: false
  - id: D4
    description: "Prompts for LIBRARIESIO_KEY / PRODUCTHUNT_TOKEN, each skippable; a skipped key is omitted (server stays keyless/fail-loud); plaintext warning printed"
    requirement: "INST-01"
    verification:
      - kind: unit
        ref: "test/installer.test.js#envFor keeps only provided keys / aggregatorEntries / separateEntries key placement"
        status: pass
    human_judgment: false
  - id: D5
    description: "Default = single aggregator entry; --separate = 11 entries; non-TTY without --client exits cleanly without prompting"
    requirement: "INST-01"
    verification:
      - kind: unit
        ref: "test/installer.test.js#parseArgs validation / non-TTY install without --client exits non-zero and writes nothing"
        status: pass
    human_judgment: false
  - id: D6
    description: "Secret containing a quote/backslash is escaped (JSON via JSON.stringify, TOML via escapeTomlString); control chars/newlines rejected so the config cannot be corrupted"
    requirement: "INST-01"
    verification:
      - kind: unit
        ref: "test/installer.test.js#escapeTomlString escapes backslash and quote, rejects control chars"
        status: pass
    human_judgment: false

# Metrics
duration: ~30min
completed: 2026-07-23
status: complete
---

# Phase 9 Plan 02: One-Shot Installer (`npx medium-research-mcp install`) Summary

**A stdlib-only install wizard (`bin/install.js`) that detects the user's MCP client(s) among Claude Desktop, Cursor, Codex CLI, and OpenCode, backs up the config, and non-destructively merges the `medium-research-all` aggregator entry (or the 11 `--separate` entries) — with skippable, plaintext-warned prompts for the two required keys. Zero new runtime dependencies.**

## Performance

- **Duration:** ~30 min
- **Completed:** 2026-07-23
- **Tasks:** 3
- **Files:** 3 (2 created, 1 modified)

## Accomplishments
- Built `bin/install.js` — the `npx medium-research-mcp install` CLI plus a set of pure, exported helpers (`backupConfig`, `mergeJson`, `stdioEntry`, `opencodeEntry`, `envFor`, `escapeTomlString`, `tomlBlock`, `spliceTomlTable`, `mergeToml`, `detectClients`, `clientDescriptors`, `aggregatorEntries`, `separateEntries`, `aggregator/separateTomlTables`, `parseArgs`, `writeToClient`).
- Backup-first, non-destructive merge for all four client formats: JSON `env` (Claude/Cursor), JSON `environment` + array `command` + `type:"local"`/`enabled:true` (OpenCode), and generated-and-spliced TOML tables (Codex). `cmd /c npx` on win32, bare `npx` elsewhere.
- Idempotent TOML splice that removes-then-appends only our own `[mcp_servers.medium-research-*]` tables, anchored on the next line-start `[` so unrelated (even sandwiching) user tables survive and re-runs never duplicate.
- Interactive wizard (detect → pick clients → skippable `LIBRARIESIO_KEY`/`PRODUCTHUNT_TOKEN` prompts → plaintext-vs-`.mcpb`-keychain warning → confirm → write-last) and a flag-driven CI path (`--separate`, `--client=<...>`, `--yes`) with a non-TTY guard that requires `--client` and never hangs.
- Registered the `medium-research-mcp` bin (name === package name, which is also the PKG-05 default-bin the roadmap flagged) and added `bin/` to the `files` whitelist so the installer ships in the tarball.
- `test/installer.test.js`: 20 tmpdir/unit tests covering non-destructive JSON merge, backup, idempotence, parse-failure abort, platform shape, OpenCode shape, TOML sandwich-survival + idempotence, escaping + control-char rejection, detection, entry-set key placement, flag validation, and a spawned non-TTY guard.

## Task Commits

1. **Task 1 (tracer, TDD): Installer core — backup + non-destructive JSON merge, proven on Claude Desktop** — `c2ff8cf` (feat)
2. **Task 2 (TDD): Cursor/OpenCode/Codex-TOML writers + client detection** — `14e58f3` (feat)
3. **Task 3: Interactive wizard, skippable key prompts, CLI flags** — `14e63f9` (feat)

## Files Created/Modified
- `bin/install.js` (created) — the installer CLI + pure exported merge/build/escape/detect helpers.
- `test/installer.test.js` (created) — 20 tmpdir-fixture unit tests + one spawned non-TTY guard test.
- `package.json` (modified) — added `medium-research-mcp` bin (default-bin fix) and `bin/` to the `files` whitelist; no `dependencies` change.

## Decisions Made
- **Stdlib only, verified.** `git diff package.json` shows no `dependencies` change; the whole installer is `node:readline/promises` + `fs`/`path`/`os`. No inquirer, no TOML parser.
- **Generate-and-splice, never parse.** The installer only ever knows/adds *its own* named tables, so a TOML parser is unnecessary; the regex splice is anchored on line-start `[` and unit-tested against a sandwiched-tables fixture (the one careful bit research flagged).
- **Keys never touch `process.env`.** Reading `process.env.APPDATA` is OS path discovery (permitted by the constraints callout); credential values arrive only via interactive prompts and are written into the client config's `env`/`environment` block, escaped.

## Deviations from Plan

None — plan executed as written. (Task-1 test assertion for the backup filename was tightened to allow the millisecond-bearing ISO stamp, which is a test detail, not a plan deviation.)

## Known Stubs
None — the installer is fully wired: every writer, detector, and entry-builder is implemented and exercised end-to-end (both unit tests and a live `--client` smoke test that produced valid Cursor JSON and Codex TOML).

## Issues Encountered
None beyond the trivial test-regex tightening noted above.

## User Setup Required
None to build. To *use* the installer: `npx medium-research-mcp install` (interactive) or `npx medium-research-mcp install --client=<claude|cursor|codex|opencode> [--separate] [--yes]` (CI). Keys are optional and skippable; a skipped key leaves that server keyless with its existing fail-loud "set X" behavior.

## Next Phase Readiness
- INST-01 satisfied. Success criteria 2 (detect 4 clients + write each format), 3 (backup + non-destructive merge), and 4 (skippable key prompts → keyless fail-loud preserved) are met.
- Phase 10 gate: `npm pack --dry-run` should confirm `bin/install.js` ships (the `bin/` whitelist entry is in place) and that `medium-research-mcp` resolves as the default bin for `npx github:...`.

## Self-Check: PASSED

- FOUND: bin/install.js
- FOUND: test/installer.test.js
- FOUND commit c2ff8cf (Task 1)
- FOUND commit 14e58f3 (Task 2)
- FOUND commit 14e63f9 (Task 3)
- npm test: 461 pass, 0 fail (441 prior + 20 installer)

---
*Phase: 09-aggregator-one-shot-installer*
*Completed: 2026-07-23*
