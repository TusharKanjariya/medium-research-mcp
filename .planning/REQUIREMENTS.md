# Requirements — Milestone v1.2 One-Shot Install

Defined: 2026-07-20. Scope: distribution and installation only — no new sources,
no contract changes. Prior milestone requirements live in PROJECT.md § Validated.

## v1.2 Requirements

### Distribution (PKG)

- [x] **PKG-04**: User can configure any server on any machine with
      `npx -y medium-research-<source>` — the package is published to npm
      (publish flow follows INSTALL.md's manual release checklist; version bump,
      `--ignore-scripts` install verification, files whitelist intact)

- [x] **PKG-05**: User can install without the npm registry via
      `npx github:<owner>/medium-research-mcp` — the GitHub path is verified
      working and documented alongside npm

### Installer (INST)

- [x] **INST-01**: User can add all 11 servers to their MCP client in one
      command — `npx medium-research-mcp install` detects the client
      (Claude Desktop, OpenCode, Codex, Cursor), backs up the existing config,
      merges all 11 entries non-destructively (never clobbers unrelated
      servers), and prompts for the 2 required keys (LIBRARIESIO_KEY,
      PRODUCTHUNT_TOKEN) with skip allowed

### Aggregator (AGG)

- [x] **AGG-01**: User can add ONE config entry — a `medium-research-all` bin
      exposes every source's tools from a single process; tool names and the
      output contract are unchanged; the 11 single-purpose servers remain the
      primary shape and `.mcpb` bundles are unaffected

### Docs (DOC)

- [x] **DOC-02**: User can follow INSTALL.md for all four install paths
      (npm, GitHub, one-shot installer, aggregator); the temp
      `docs/claude_desktop_config.all-servers.json` local-path file is retired

## Future Requirements

- Auto-update notification for installed configs (out of v1.2 — no daemon)
- `.mcpb` aggregator bundle (single keychain-credentialed bundle) — revisit
  after AGG-01 proves the aggregate shape

## Out of Scope

- Publishing individual per-source npm packages — one package with 11 bins
  stays; per-source packages multiply release overhead for zero UX gain

- Windows installer executables / MSI — npx is the floor, everything runs on
  the Node runtime Claude Desktop already needs

- Remote/hosted server variants — local stdio only, per the v1.0 premise

## Traceability

| REQ | Phase | Status |
|-----|-------|--------|
| PKG-04 | Phase 10 | Complete |
| PKG-05 | Phase 10 | Complete |
| INST-01 | Phase 9 | Complete |
| AGG-01 | Phase 9 | Complete |
| DOC-02 | Phase 10 | Complete |
