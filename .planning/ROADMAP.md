# Roadmap: medium-research-mcp

## Overview

Build a suite of single-purpose MCP servers that each wrap one developer-community
source and emit the **same normalized JSON shape**, so `medium-blog-pro` can pull
blog-topic research from many sources with zero per-source logic. The journey runs
foundation-first: prove the shared cache/HTTP layer, the output contract, and the
credential/auth infrastructure against a Hacker News reference server; then fan out
across keyless sources to validate the copy-a-folder pattern at breadth; then add the
keyed ecosystem/launch sources that exercise required-credential handling; and finally
land the generic RSS/Atom multiplier, prove a real 5+-source uniform run, and add the
structurally different Python YouTube→blog wrapper last. Sources within a phase are
largely independent and may be built in parallel.

## Universal Server Bar

Every source-server phase (2, 3, 4) must satisfy this bar for each server it adds,
in addition to the phase's own success criteria:

- Tools register and are callable in the MCP Inspector.
- `normalize*()` helpers are unit-tested against representative source payloads.
- Output matches the contract in ARCHITECTURE §4 exactly — lists return
  `{ source, query, count, results[] }`, details return `{ source, item }`, item schema
  intact; `score`/`num_comments` may be `null` but are never renamed or dropped.

- All HTTP goes through `shared/http_client.js` `getJson()` — no direct `fetch`, and no
  `process.env` reads outside `shared/credentials.js`.

- Keyless-fallback / required-credential behavior is correct: optional-key sources
  degrade to anonymous mode; required-key sources fail with a clear "set X" error.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

- [x] **Phase 1: Foundation & Credential Infrastructure** - Shared cache/HTTP layer, the output contract, the HN reference server, and env-only credential + token-auth infrastructure (completed 2026-07-01)
- [x] **Phase 2: Keyless Source Breadth** - Stack Exchange, Lobsters, Lemmy, and Dev.to servers, proving the copy-a-folder pattern at breadth (completed 2026-07-02; Hashnode dropped — upstream retired free GraphQL API)
- [x] **Phase 3: Keyed Ecosystem & Launch Sources** - GitHub, Libraries.io, and Product Hunt servers, exercising optional-PAT and required-credential paths (completed 2026-07-02)
- [ ] **Phase 4: RSS Multiplier & Output Proof** - SSRF-hardened generic RSS/Atom fetcher (incl. subreddit `.rss` + YouTube channel/playlist recipes) and a real 5+-source uniform run (Python YouTube→blog wrapper dropped 2026-07-03 — user runs own OCR script)

## Phase Details

### Phase 1: Foundation & Credential Infrastructure

**Goal**: Establish the shared plumbing and prove the normalized output contract end-to-end with a Hacker News reference server, plus the credential/auth infrastructure every later source copies.
**Depends on**: Nothing (first phase)
**Requirements**: FOUND-01, FOUND-02, FOUND-03, FOUND-04, FOUND-05, CRED-01, CRED-02, CRED-03, CRED-04, OUT-01, OUT-03
**Success Criteria** (what must be TRUE):

  1. Calling `hn_front_page`, `hn_search`, and `hn_get_item` in the MCP Inspector returns data in the exact contract shape (list envelope, detail `{ source, item }`), with both `structuredContent` and JSON-text `content` present.
  2. A transient/5xx failure is retried with backoff (0.5s/1s/2s), a repeated call inside the TTL window is served from cache, and a total failure falls back to a stale cache entry rather than hard-erroring; 4xx is never retried.
  3. `credentials.js` is the only place `process.env` is read, exposing per-service helpers; a missing required credential produces a clear "set X" error while optional-key sources run anonymously.
  4. `auth.js` exchanges username/password for a cached token (Reddit password grant, Lemmy login) with passwords never logged, persisted, or sent per request; `.env.example` and the `.mcpb` `user_config` (secrets marked `"sensitive": true`) are documented.
  5. Tool output is trimmed and LLM-readable — HTML stripped from `text`, only contract fields present.

**Plans**: 3 plans

Plans:
**Wave 1**

- [x] 01-01-PLAN.md — Project scaffold + shared `cache.js`/`http_client.js` `getJson()` (TTL cache, retry/backoff/stale) + output-contract module (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02-PLAN.md — Hacker News reference server (`hn_front_page`, `hn_search`, `hn_get_item`) with unit-tested field-mapping helpers (wave 2)
- [x] 01-03-PLAN.md — `credentials.js`, `auth.js`, `.env.example`, and the `.mcpb` `user_config`/keychain pattern (wave 2)

### Phase 2: Keyless Source Breadth

**Goal**: Fan out across the keyless (and optional-auth) sources, proving that adding a source is a mechanical copy of the Phase 1 pattern and that the contract holds across very different payloads.
**Depends on**: Phase 1
**Requirements**: SRC-01, SRC-02, SRC-03, SRC-05 (SRC-04 Hashnode **dropped** 2026-07-02 — upstream retired free GraphQL API)
**Success Criteria** (what must be TRUE):

  1. Stack Exchange tools (`so_hot_questions`, `so_search`, `so_get_question`) work across the network via a `site` param and use `STACKEXCHANGE_KEY` when present, keyless otherwise.
  2. Lobsters (`lobsters_hottest`, `lobsters_tag`, `lobsters_get`) and Dev.to servers return contract-shaped results with no auth.
  3. Lemmy tools (`lemmy_hot`, `lemmy_search`, `lemmy_post`) work on public reads and auto-authenticate when `LEMMY_*` is set, exercising the `auth.js` username/password path end-to-end.
  4. All four servers pass the Universal Server Bar.

  _(Original criterion 4 — Hashnode public GraphQL — dropped: Hashnode retired free/keyless GraphQL access, Pro plan required as of 2026-05-13, which conflicts with the project's keyless/non-commercial constraint.)_

**Plans**: 3/3 plans complete

Plans:
**Wave 1** *(all three plans are independent — disjoint files — and run in parallel)*

- [x] 02-01-PLAN.md — Stack Exchange server (network-wide via `site` D-03, optional `STACKEXCHANGE_KEY` D-04, `filter=withbody`) [SRC-01] (wave 1)
- [x] 02-02-PLAN.md — `lemmyInstance()` helper + Lobsters + Lemmy servers (Lemmy exercises the auth path D-06) [SRC-02, SRC-03] (wave 1)
- [x] 02-03-PLAN.md — `postJson()` shared POST path + Dev.to (Forem REST) server [SRC-05] (wave 1) — _Hashnode (GraphQL) built then dropped 2026-07-02 (upstream paywalled); `postJson()` retained as generic shared infra_

### Phase 3: Keyed Ecosystem & Launch Sources

**Goal**: Add the ecosystem-signal and launch sources that exercise optional-PAT and required-credential handling, surfacing pain-point and momentum signal for blog topics.
**Depends on**: Phase 1
**Requirements**: SRC-06, SRC-07, SRC-08
**Success Criteria** (what must be TRUE):

  1. GitHub server returns trending repos (Search API, stars→`score`) and issues/discussions for pain-point mining (reactions→`score`, comments→`num_comments`), using a PAT when present and running anonymously otherwise.
  2. Libraries.io server returns rising/most-depended packages and fails with a clear "set LIBRARIESIO_KEY" error when its required key is missing.
  3. Product Hunt server returns today/this-week launches by topic and fails with a clear "set X" error when its required token is missing.
  4. All three servers pass the Universal Server Bar, with required-credential error behavior explicitly verified.

**Plans**: 2/2 plans complete

Plans:
**Wave 1**

- [x] 03-01-PLAN.md — Extend shared `TYPE` enum (issue/package/launch, phase prerequisite) + GitHub server (`gh_trending_repos`, `gh_search_issues`, `gh_get_item`; optional PAT) [SRC-06] (wave 1)

**Wave 2** *(depends on 03-01 — shared `contract.js` TYPE extension must land first)*

- [x] 03-02-PLAN.md — Libraries.io (`librariesio_search`/`_get`, required key) + Product Hunt (`producthunt_launches`/`_get`, GraphQL, required token) — the required-credential pair [SRC-07, SRC-08] (wave 2)

### Phase 4: RSS Multiplier & Output Proof

**Goal**: Land the generic RSS/Atom fetcher (the biggest coverage-per-line multiplier, including the read-only subreddit `.rss` and YouTube channel/playlist recipes), and prove a real multi-source uniform research run.
**Depends on**: Phase 2, Phase 3
**Requirements**: SRC-09, OUT-02, YT-01
**Success Criteria** (what must be TRUE):

  1. The generic RSS/Atom fetcher ingests any feed URL — newsletters, dev blogs, and the subreddit `.rss` recipe — emitting contract-shaped feed items with `score`/`num_comments` null, and is SSRF-hardened (untrusted feed URL: http/https-only, private-range/redirect denylist).
  2. A single research run pulls from 5+ sources and returns one uniform list the consumer ranks/filters with zero per-source branches.
  3. YouTube video links are surfaced (each with a short explanation) via the RSS fetcher's YouTube channel/playlist recipe (`youtube.com/feeds/videos.xml?channel_id=…`) as contract-shaped items — the user runs their own local Tesseract OCR→draft script manually on chosen links (OCR/draft generation is out of scope; the Python wrapper is dropped, decision 2026-07-03).
  4. The RSS fetcher passes the Universal Server Bar.

**Plans**: 4 plans

Plans:
**Wave 1** *(disjoint files — run in parallel)*

- [ ] 04-01-PLAN.md — Shared `getText` + SSRF `assertSafeUrl` guard + `RSS_ALLOWED_HOSTS` (D-01/02/03/07) [SRC-09] (wave 1)
- [ ] 04-02-PLAN.md — `fast-xml-parser@^4.5.7` supply-chain gate (blocking-human checkpoint, D-08) [SRC-09] (wave 1)

**Wave 2** *(depends on 04-01 + 04-02)*

- [ ] 04-03-PLAN.md — `servers/rss/` RSS/Atom fetcher (`rss_fetch`) + subreddit `.rss` + YouTube channel/playlist recipes + fixtures + tests [SRC-09, YT-01] (wave 2)

**Wave 3** *(depends on 04-03)*

- [ ] 04-04-PLAN.md — OUT-02 5+-source uniform-run proof (`shared/rank.js` `mergeRank` + offline test + live demo) [OUT-02] (wave 3)

## Future / Deferred (v2)

Not part of the numbered v1 phases. Tracked for a later milestone.

- **SRC-10 — Discourse generic fetcher**: `/latest.json` on any public instance; a
  multiplier across Rust/Swift/Elixir/Docker communities. Mechanical copy of the pattern.

- **SRC-11 — Mastodon server**: public + hashtag timelines where the instance allows
  unauthenticated reads (favourites+reblogs→`score`, replies→`num_comments`).

- **SRC-12 — Bluesky (AT Protocol)**: public feed reads; revisit if fediverse coverage
  proves valuable.

- **PKG-01 — `.mcpb` distribution**: per-server `build-mcpb.sh` + `npm install --omit=dev`
  + `mcpb pack` bundles worth one-click installing/sharing.

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 (Phases 2 and 3 both depend only on
Phase 1 and may run in parallel; Phase 4 depends on both).

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation & Credential Infrastructure | 3/3 | Complete    | 2026-07-01 |
| 2. Keyless Source Breadth | 3/3 | Complete    | 2026-07-02 |
| 3. Keyed Ecosystem & Launch Sources | 2/2 | Complete    | 2026-07-02 |
| 4. RSS Multiplier & Output Proof | 0/4 | Not started | - |
