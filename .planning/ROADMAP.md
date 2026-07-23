# Roadmap: medium-research-mcp

## Milestones

- ✅ **v1.0 MVP** — Phases 1–4 (shipped 2026-07-03) — full detail: [`milestones/v1.0-ROADMAP.md`](milestones/v1.0-ROADMAP.md)
- ✅ **v1.1 Writer-Aware, Universal Research** — Phases 5–8 (shipped 2026-07-17) — full detail: [`milestones/v1.1-ROADMAP.md`](milestones/v1.1-ROADMAP.md)
- 🚧 **v1.2 One-Shot Install** — Phases 9–10 (in progress) — anyone gets all 11 servers into any MCP client with one command

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1–4) — SHIPPED 2026-07-03</summary>

Nine MCP servers under one normalized output contract + a live multi-source uniform-run proof. See [`milestones/v1.0-ROADMAP.md`](milestones/v1.0-ROADMAP.md) for full phase details, success criteria, and plan breakdown.

- [x] **Phase 1: Foundation & Credential Infrastructure** (3/3 plans) — completed 2026-07-01 — shared TTL cache + `getJson`/`postJson` client (retry/stale) + normalized output contract + HN reference server + env-only credentials/`auth.js`
- [x] **Phase 2: Keyless Source Breadth** (3/3 plans) — completed 2026-07-02 — Stack Exchange, Lobsters, Lemmy, Dev.to (Hashnode built then dropped — upstream paywalled)
- [x] **Phase 3: Keyed Ecosystem & Launch Sources** (2/2 plans) — completed 2026-07-02 — GitHub (optional PAT), Libraries.io + Product Hunt (required-credential pair)
- [x] **Phase 4: RSS Multiplier & Output Proof** (4/4 plans) — completed 2026-07-03 — SSRF-hardened RSS/Atom fetcher (subreddit `.rss` + YouTube recipes) + branch-free 5+-source uniform-run proof (Python YouTube OCR wrapper dropped — user runs own script)

</details>

<details>
<summary>✅ v1.1 Writer-Aware, Universal Research (Phases 5–8) — SHIPPED 2026-07-17</summary>

Upgraded the suite from 9 to 11 normalized-contract servers, made it writer-aware, parameterized every target, and shipped it as an npm package + 11 one-click `.mcpb` bundles. See [`milestones/v1.1-ROADMAP.md`](milestones/v1.1-ROADMAP.md) for full phase goals, success criteria, and plan breakdown.

- [x] **Phase 5: Guarded JSON Path & Trending Signals** (4/4 plans) — completed 2026-07-10 — SEC-01 guarded `getJson` path + `hn_rising` / `so_unanswered` / `devto_top` trending tools (SEC-01, TREND-01..03)
- [x] **Phase 6: Author-Blog Awareness** (3/3 plans) — completed 2026-07-14 — writer-aware `servers/rss` (Medium/Substack author + tag feeds, Substack archive enrichment, preview-only tagging, honest windows) (ABLOG-01..05)
- [x] **Phase 7: Universal Sources & Parameterization Audit** (4/4 plans) — completed 2026-07-14 — keyless Discourse + Mastodon (instance-as-parameter, trends), Lemmy parameterized, no-hardcoded-targets audit (SRC-10/11/13, SEC-02)
- [x] **Phase 8: Universal Distribution** (4/4 plans) — completed 2026-07-17 — one npx npm package (11 bins) + 11 keychain-credentialed `.mcpb` bundles (validate + spawn-test gated), per-client INSTALL docs, cross-source pain-point sweep (PKG-01..03, DOC-01)

</details>

### v1.2 One-Shot Install (Phases 9–10)

- [x] **Phase 9: Aggregator & One-Shot Installer** - The package gains the `medium-research-all` aggregator server and the `npx medium-research-mcp install` command, so everything v1.2 distributes exists before publish (completed 2026-07-23)
- [ ] **Phase 10: Publish & Install-Path Docs** - Package published to npm, GitHub install path verified, INSTALL.md rewritten around all four install paths (human-gated publish checkpoint)

## Phase Details

### Phase 9: Aggregator & One-Shot Installer

**Goal**: One config entry or one command gets a user every source — the aggregator server and installer live inside the existing package, using only Node stdlib + existing shared modules
**Depends on**: Phase 8 (published package shape: 11 bins, files whitelist, `.mcpb` bundles — all unchanged by this phase)
**Requirements**: AGG-01, INST-01
**Success Criteria** (what must be TRUE):

  1. A user who adds ONE config entry (`medium-research-all`) sees every source's tools in their MCP client, with tool names and the output contract identical to the 11 single-purpose servers
  2. A user runs `npx medium-research-mcp install` and it detects their MCP client(s) among Claude Desktop, OpenCode, Codex, and Cursor — including each client's config format (JSON vs TOML, `env` vs `environment`, Windows `cmd /c` wrapper)
  3. The installer backs up the existing config file before writing and merges all 11 server entries without removing or altering any unrelated server entry already in the config
  4. The installer prompts for the 2 required keys (LIBRARIESIO_KEY, PRODUCTHUNT_TOKEN) and each prompt can be skipped — skipping leaves those servers configured keyless with their existing fail-loudly behavior
  5. The 11 single-purpose bins and `.mcpb` bundles behave exactly as before — the full existing test suite still passes with zero contract changes

**Plans**: 2/2 plans executed

- [x] 09-01-PLAN.md — Aggregator (AGG-01): `registerTools` seam + `medium-research-all` server exposing the full 37-tool union (wave 1)
- [x] 09-02-PLAN.md — Installer (INST-01): `npx medium-research-mcp install` — detect 4 clients, backup + non-destructive merge, skippable key prompts (wave 2)

### Phase 10: Publish & Install-Path Docs

**Goal**: Anyone on any machine can install via npm or GitHub with the documented commands — no clone, no local-path hacks
**Depends on**: Phase 9 (aggregator + installer must be in the tarball; publishing before them forces a second release)
**Requirements**: PKG-04, PKG-05, DOC-02
**Checkpoint**: `npm publish` is human-gated (npm login + INSTALL.md manual release checklist: version bump, `npm pack --dry-run` tarball inspection, `--ignore-scripts` install verification, files whitelist intact). Execution pauses for the operator — do not automate.
**Success Criteria** (what must be TRUE):

  1. On a machine with no clone of this repo, `npx -y medium-research-<source>` starts any of the 11 servers from the public npm registry
  2. A user without npm-registry access runs the documented `npx github:<owner>/medium-research-mcp` command and gets a working install path (verified live, not just documented)
  3. The published tarball contains the aggregator and installer (verified via `npm pack --dry-run` before publish) so no second release is needed
  4. A user can follow INSTALL.md end-to-end for each of the four install paths (npm, GitHub, one-shot installer, aggregator), and the temp `docs/claude_desktop_config.all-servers.json` local-path file is gone

**Plans**: TBD

## Future / Deferred (v2+)

Not part of the v1.2 milestone. Tracked for a later milestone (start via `/gsd-new-milestone`).

- **SRC-12 — Bluesky (AT Protocol)**: public feed reads; revisit if fediverse coverage
  proves valuable.

- **SEC-03 — SSRF hardening follow-up**: optional undici IP-pinning custom-lookup
  dispatcher to close the accepted DNS-rebinding TOCTOU residual (T-04-06) if the tool
  ever runs multi-tenant. Reconsider during SEC-01's threat-model pass.

- **`.mcpb` aggregator bundle**: single keychain-credentialed bundle — revisit after
  AGG-01 proves the aggregate shape.

- **Auto-update notification for installed configs**: out of v1.2 — no daemon.

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation & Credential Infrastructure | v1.0 | 3/3 | Complete | 2026-07-01 |
| 2. Keyless Source Breadth | v1.0 | 3/3 | Complete | 2026-07-02 |
| 3. Keyed Ecosystem & Launch Sources | v1.0 | 2/2 | Complete | 2026-07-02 |
| 4. RSS Multiplier & Output Proof | v1.0 | 4/4 | Complete | 2026-07-03 |
| 5. Guarded JSON Path & Trending Signals | v1.1 | 4/4 | Complete | 2026-07-10 |
| 6. Author-Blog Awareness | v1.1 | 3/3 | Complete | 2026-07-14 |
| 7. Universal Sources & Parameterization Audit | v1.1 | 4/4 | Complete | 2026-07-14 |
| 8. Universal Distribution | v1.1 | 4/4 | Complete | 2026-07-17 |
| 9. Aggregator & One-Shot Installer | v1.2 | 2/2 | Complete    | 2026-07-23 |
| 10. Publish & Install-Path Docs | v1.2 | 0/? | Not started | - |

---
*Roadmap updated: 2026-07-21 — v1.2 One-Shot Install roadmap created (Phases 9–10, 5/5 requirements mapped). Next: `/gsd-plan-phase 9`.*
