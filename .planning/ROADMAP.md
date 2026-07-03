# Roadmap: medium-research-mcp

## Milestones

- ✅ **v1.0 MVP** — Phases 1–4 (shipped 2026-07-03) — full detail: [`milestones/v1.0-ROADMAP.md`](milestones/v1.0-ROADMAP.md)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1–4) — SHIPPED 2026-07-03</summary>

Nine MCP servers under one normalized output contract + a live multi-source uniform-run proof. See [`milestones/v1.0-ROADMAP.md`](milestones/v1.0-ROADMAP.md) for full phase details, success criteria, and plan breakdown.

- [x] **Phase 1: Foundation & Credential Infrastructure** (3/3 plans) — completed 2026-07-01 — shared TTL cache + `getJson`/`postJson` client (retry/stale) + normalized output contract + HN reference server + env-only credentials/`auth.js`
- [x] **Phase 2: Keyless Source Breadth** (3/3 plans) — completed 2026-07-02 — Stack Exchange, Lobsters, Lemmy, Dev.to (Hashnode built then dropped — upstream paywalled)
- [x] **Phase 3: Keyed Ecosystem & Launch Sources** (2/2 plans) — completed 2026-07-02 — GitHub (optional PAT), Libraries.io + Product Hunt (required-credential pair)
- [x] **Phase 4: RSS Multiplier & Output Proof** (4/4 plans) — completed 2026-07-03 — SSRF-hardened RSS/Atom fetcher (subreddit `.rss` + YouTube recipes) + branch-free 5+-source uniform-run proof (Python YouTube OCR wrapper dropped — user runs own script)

</details>

## Future / Deferred (v2)

Not part of the shipped v1 milestone. Tracked for a later milestone (start via `/gsd-new-milestone`).

- **SRC-10 — Discourse generic fetcher**: `/latest.json` on any public instance; a
  multiplier across Rust/Swift/Elixir/Docker communities. Mechanical copy of the pattern.

- **SRC-11 — Mastodon server**: public + hashtag timelines where the instance allows
  unauthenticated reads (favourites+reblogs→`score`, replies→`num_comments`).

- **SRC-12 — Bluesky (AT Protocol)**: public feed reads; revisit if fediverse coverage
  proves valuable.

- **PKG-01 — `.mcpb` distribution**: per-server `build-mcpb.sh` + `npm install --omit=dev`
  + `mcpb pack` bundles worth one-click installing/sharing.

- **SSRF hardening follow-up**: optional undici IP-pinning custom-lookup dispatcher to close
  the accepted DNS-rebinding TOCTOU residual (T-04-06) if the tool ever runs multi-tenant.

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation & Credential Infrastructure | v1.0 | 3/3 | Complete | 2026-07-01 |
| 2. Keyless Source Breadth | v1.0 | 3/3 | Complete | 2026-07-02 |
| 3. Keyed Ecosystem & Launch Sources | v1.0 | 2/2 | Complete | 2026-07-02 |
| 4. RSS Multiplier & Output Proof | v1.0 | 4/4 | Complete | 2026-07-03 |
