# Phase 9: Aggregator & One-Shot Installer - Context

**Gathered:** 2026-07-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver two additions **inside the existing `medium-research-mcp` package**, using
only Node stdlib + existing shared modules + the already-present
`@modelcontextprotocol/sdk`:

1. **AGG-01** — a `medium-research-all` aggregator bin exposing every source's
   tools from one process, so a client needs exactly ONE config entry.
2. **INST-01** — a `medium-research-mcp install` command that adds the servers to
   an MCP client in one shot (detect client, back up config, non-destructive
   merge, prompt for required keys).

Out of scope (belongs to Phase 10): npm publish, GitHub install-path verification,
INSTALL.md rewrite. This phase only makes the code exist in the tarball.
</domain>

<decisions>
## Implementation Decisions

### Aggregator tool surface (AGG-01)
- **D-01:** Expose **all ~44 tools from all 11 sources, unfiltered** — full parity
  with running every single-purpose server. Tool prefixes (`hn_`, `so_`, `gh_`,
  `devto_`, `lobsters_`, `lemmy_`, `librariesio_`, `producthunt_`, `rss_`,
  `discourse_`, `mastodon_`) already guarantee no name collisions, so the merge is
  a straight union. The client handles list length; no curation, no per-source
  gating in the default aggregator surface.
- **D-02:** Keyed sources (Libraries.io, Product Hunt) are mounted **unconditionally**
  even when their keys are absent — their tools keep the existing fail-loud
  "set X" behavior at call time (frozen credential contract). The aggregator does
  NOT silently drop keyed tools when keys are missing.

### Installer UX (INST-01)
- **D-03:** **Interactive wizard by default.** Flow: detect installed clients →
  show what was found → ask which client(s) to install to → prompt for the 2 keys
  (skippable) → show/confirm the change → write. Non-interactive flags
  (e.g. `--client=`, `--yes`) exist for CI/scripted use but interactive is the
  default when no flags are given.
- **D-04:** Installer targets the 4 documented clients: **Claude Desktop, Cursor,
  Codex CLI, OpenCode** — each with its own config format (JSON vs TOML, `env` vs
  `environment`, Windows `cmd /c` wrapper). Detection + format handling comes from
  the existing per-client sections in `docs/INSTALL.md` (authoritative source).

### Key handling (INST-01)
- **D-05:** **Prompt, write plaintext, warn.** Prompt for each required key
  (LIBRARIESIO_KEY, PRODUCTHUNT_TOKEN), each skippable; write the value into the
  config's `env`/`environment` block; print a one-line notice that client-config
  keys are plaintext and the `.mcpb` keychain path is the secure alternative.
  Skipping a key leaves that server configured keyless with its existing
  fail-loud behavior. This is the accepted trade-off for the all-at-once goal.

### Install shape (INST-01)
- **D-06:** **Aggregator entry by default; 11 separate via flag.** `install` writes
  the single `medium-research-all` entry (the point of the milestone).
  `install --separate` writes all 11 individual entries instead. Both paths are
  non-destructive merges — never remove or alter unrelated server entries already
  in the target config; back up the config file before writing.

### Claude's Discretion
- HOW the aggregator merges 11 `McpServer` instances into one process. The
  servers currently each construct a private `McpServer` and gate
  `server.connect()` on `isEntry(import.meta.url)`. The likely clean approach is a
  small refactor exposing a per-server `registerTools(server)` (or reusing the
  exported `server` registries) so one aggregator `McpServer` mounts all tools —
  but the exact seam is the planner/researcher's call, provided: output contract
  frozen, no tool renames, the 11 bins and `.mcpb` bundles keep working unchanged,
  and no new runtime dependency is added.
- Installer config-file discovery paths per OS, backup naming, and the exact
  prompt/confirm rendering.
- Whether the installer post-write spawn-tests each server (nice-to-have, not
  required by INST-01).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Install targets & config formats (authoritative)
- `docs/INSTALL.md` — per-client config format for all 4 targets: Claude Desktop
  (`claude_desktop_config.json`, §54), Cursor (`~/.cursor/mcp.json`, §100), Codex
  CLI (`~/.codex/config.toml`, §135), OpenCode (`opencode.json`, §164); the two
  universal rules (§29), credentials reference (§217), and the manual publish
  checklist (§272). This file is the source of truth for detection + merge shapes.

### Contract & credential constraints (frozen)
- `CLAUDE.md` — output contract (DO NOT BREAK section), shared-module rules, "never
  read process.env outside credentials.js".
- `.claude/CLAUDE.md` — same constraints, project value statement.
- `shared/credentials.js` — `ENV_VAR` map = single source of truth for the env var
  names the installer prompts for and the aggregator relies on.
- `shared/main.js` — `isEntry(import.meta.url)` entry guard each server gates
  `connect()` on; the aggregator must not trip the 11 servers' own guards.

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` — AGG-01, INST-01 acceptance wording.
- `.planning/ROADMAP.md` §"Phase 9" — goal + 5 success criteria.

### Reference for the merge
- `servers/hn/server.js` — canonical single-server shape (exported `server`,
  `registerTool` blocks, `isEntry`-gated `connect`) the aggregator refactor keys off.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`shared/credentials.js` `ENV_VAR` map** — enumerate this for the installer's
  key prompts and to know which servers need which env vars; never hardcode names.
- **`docs/INSTALL.md` per-client blocks** — already encode every client's exact
  config JSON/TOML shape incl. the Windows `cmd /c` wrapper; the installer's
  writers mirror these rather than inventing formats.
- **`package.json` `bin` map** — the 11 existing bins; add `medium-research-all`
  and `medium-research-mcp` (installer) as two new bins. Note: no bin currently
  matches the package name, which PKG-05 (`npx github:...`) needs — adding the
  `medium-research-mcp` installer bin doubles as the default-bin fix.
- **`scripts/build-mcpb.mjs`** — existing packaging script; reference for how bins
  and the files whitelist are treated (the aggregator/installer must land in the
  `files` array so they ship in the tarball).

### Established Patterns
- Every server exports `server` (an `McpServer`) and gates
  `server.connect(new StdioServerTransport())` on `isEntry(import.meta.url)` — so
  importing a server module for its registry must NOT auto-connect. This is the
  central constraint the aggregator's merge design must respect.
- Distinct tool-name prefixes per source → union merge is collision-free (D-01).
- All HTTP via `shared/http_client.js`; credentials only via
  `shared/credentials.js` — the aggregator inherits both unchanged.

### Integration Points
- New bins wire into `package.json` `bin` + `files`; the `.mcpb` build
  (`scripts/build-mcpb.mjs`) and the 11 existing bins must be verified unaffected.
- Installer reads/writes external client config files on the user's machine
  (Claude Desktop / Cursor / Codex / OpenCode) — the only new outbound file-write
  surface; backup-before-write is mandatory (D-06).
</code_context>

<specifics>
## Specific Ideas

- The temp `docs/claude_desktop_config.all-servers.json` (created this session as a
  stopgap) is what the installer automates and Phase 10 retires. It also serves as
  a concrete reference for the Claude Desktop entry shape the installer emits.
- "One command, everything installed" is the felt goal — the wizard should make the
  common path (Claude Desktop + aggregator + optionally paste 2 keys) feel like one
  short interaction.
</specifics>

<deferred>
## Deferred Ideas

- **`.mcpb` aggregator bundle** — a single keychain-credentialed bundle for the
  aggregator. Deferred (already in ROADMAP Future/Deferred); revisit after AGG-01
  proves the aggregate shape.
- **Auto-update notification for installed configs** — out of v1.2, no daemon.
- **Installer post-write spawn-test / health check** — nice-to-have; planner may
  include a light version but INST-01 doesn't require it.

None of these expand Phase 9 scope — discussion stayed within the phase boundary.
</deferred>

---

*Phase: 9-Aggregator & One-Shot Installer*
*Context gathered: 2026-07-20*
