# Roadmap: medium-research-mcp

## Milestones

- ✅ **v1.0 MVP** — Phases 1–4 (shipped 2026-07-03) — full detail: [`milestones/v1.0-ROADMAP.md`](milestones/v1.0-ROADMAP.md)
- ✅ **v1.1 Writer-Aware, Universal Research** — Phases 5–8 (shipped 2026-07-17) — full detail: [`milestones/v1.1-ROADMAP.md`](milestones/v1.1-ROADMAP.md)

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

## Future / Deferred (v2+)

Not part of the v1.1 milestone. Tracked for a later milestone (start via `/gsd-new-milestone`).

- **SRC-12 — Bluesky (AT Protocol)**: public feed reads; revisit if fediverse coverage
  proves valuable.

- **SEC-03 — SSRF hardening follow-up**: optional undici IP-pinning custom-lookup
  dispatcher to close the accepted DNS-rebinding TOCTOU residual (T-04-06) if the tool
  ever runs multi-tenant. Reconsider during SEC-01's threat-model pass.

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation & Credential Infrastructure | v1.0 | 3/3 | Complete | 2026-07-01 |
| 2. Keyless Source Breadth | v1.0 | 3/3 | Complete | 2026-07-02 |
| 3. Keyed Ecosystem & Launch Sources | v1.0 | 2/2 | Complete | 2026-07-02 |
| 4. RSS Multiplier & Output Proof | v1.0 | 4/4 | Complete | 2026-07-03 |
| 5. Guarded JSON Path & Trending Signals | v1.1 | 4/4 | Complete    | 2026-07-10 |
| 6. Author-Blog Awareness | v1.1 | 3/3 | Complete    | 2026-07-14 |
| 7. Universal Sources & Parameterization Audit | v1.1 | 4/4 | Complete    | 2026-07-14 |
| 8. Universal Distribution | v1.1 | 4/4 | Complete    | 2026-07-17 |

---
*Roadmap updated: 2026-07-17 — v1.1 shipped and archived (all 4 phases verified, 17/17 requirements). Next milestone via `/gsd-new-milestone`.*
