# Requirements: medium-research-mcp

**Defined:** 2026-07-01
**Core Value:** Uniform normalized output across every source, so `medium-blog-pro` consumes any source with zero per-source logic.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Foundation

- [x] **FOUND-01**: Shared `cache.js` provides an in-memory ~15-min TTL cache with stale-entry retention
- [x] **FOUND-02**: Shared `http_client.js` `getJson()` performs all HTTP with cache + retry/backoff (0.5s/1s/2s, never on 4xx) + stale-cache fallback; servers never call `fetch` directly
- [x] **FOUND-03**: Normalized output contract is defined and enforced — lists return `{ source, query, count, results[] }`, details return `{ source, item }`, item schema per ARCHITECTURE §4; `score`/`num_comments` may be null but never renamed
- [x] **FOUND-04**: Hacker News reference server exposes `hn_front_page`, `hn_search`, `hn_get_item` and proves the pattern end-to-end
- [x] **FOUND-05**: Every tool returns an object so the SDK emits both `structuredContent` and JSON-text `content`

### Credentials & Auth

- [x] **CRED-01**: `credentials.js` is the single source of truth for env-var names, reads only from `process.env`, and exposes per-service helpers (`stackExchangeParams`, `githubHeaders`, `librariesIoParams`, `productHuntHeaders`)
- [x] **CRED-02**: `auth.js` exchanges username/password for a cached token (Reddit OAuth2 password grant, Lemmy `/api/v3/user/login`); passwords never logged, persisted, or sent per request
- [x] **CRED-03**: `.env.example` documents all variables; `.mcpb` `user_config` maps secrets into `mcp_config.env` with `"sensitive": true` (OS keychain)
- [x] **CRED-04**: Required-credential sources (Libraries.io, Product Hunt) fail with a clear "set X" error; keyless-capable sources (Stack Exchange, GitHub, Reddit reads) degrade to anonymous mode

### Source Servers

- [x] **SRC-01**: Stack Exchange server (`so_hot_questions`, `so_search`, `so_get_question`) generalized to the network via a `site` param; optional `STACKEXCHANGE_KEY`
- [x] **SRC-02**: Lobsters server (`lobsters_hottest`, `lobsters_tag`, `lobsters_get`), no auth
- [x] **SRC-03**: Lemmy server (`lemmy_hot`, `lemmy_search`, `lemmy_post`); auto-auth when `LEMMY_*` present — exercises the username/password path
- [~] **SRC-04**: ~~Hashnode server (trending by tag, search, article) via public GraphQL, no auth~~ — **DROPPED 2026-07-02**: Hashnode retired free/keyless GraphQL access (Pro plan required for all queries as of 2026-05-13), which breaks the public-keyless premise and conflicts with the project's keyless/non-commercial constraint. Server was built + offline-tested, then removed.
- [x] **SRC-05**: Dev.to server (trending by tag, search, article), no auth
- [x] **SRC-06**: GitHub server — trending repos (Search API) + issues/discussions pain-point mining; optional PAT
- [x] **SRC-07**: Libraries.io server (rising/most-depended packages); required key
- [x] **SRC-08**: Product Hunt server (today/this-week launches by topic); required token
- [ ] **SRC-09**: Generic RSS/Atom fetcher (any feed → newsletters, dev blogs, and read-only subreddit `.rss`); emits feed-items with `score`/`num_comments` null

### Output & Consumer

- [x] **OUT-01**: Every server conforms to the output contract exactly, verified against ARCHITECTURE §4
- [ ] **OUT-02**: A single research run pulls from 5+ sources and returns a uniform list the skill ranks/filters with no per-source branches
- [x] **OUT-03**: Tool output is trimmed and LLM-readable — only fields that matter, HTML stripped from text

### YouTube link surfacing

- [ ] **YT-01** *(re-scoped 2026-07-03 — Python OCR wrapper dropped)*: Surface YouTube video links, each with a short explanation, as contract-shaped items via the RSS fetcher's YouTube channel/playlist recipe (`youtube.com/feeds/videos.xml?channel_id=…` / `?playlist_id=…`). The user runs their own local Tesseract OCR→draft script **manually** on chosen links — OCR/draft generation and any Python/async-job wrapper are **out of scope**. Keyword YouTube search (Data API) is out of the keyless scope; the user supplies channel/playlist IDs.

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Additional Sources

- **SRC-10**: Discourse generic fetcher (`/latest.json` on any public instance) — multiplier across Rust/Swift/Elixir/Docker/etc. communities
- **SRC-11**: Mastodon server (public + hashtag timelines), no auth where the instance allows unauthenticated reads
- **SRC-12**: Bluesky (AT Protocol public feed reads) — revisit if fediverse coverage proves valuable

### Distribution

- **PKG-01**: `.mcpb` bundles built per server worth one-click installing/sharing (`build-mcpb.sh`, `npm install --omit=dev`, `mcpb pack`)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| General-purpose Reddit/social client (posting, account actions) | Read-only topic research only |
| Writing/drafting posts (except YouTube wrapper) | Drafting is the `medium-blog-pro` skill's job |
| Scraping sources without a usable API (Quora, Indie Hackers, Tildes) | Brittle; violates "mechanical to add" |
| Real-time / streaming | Cached research bursts are sufficient |
| Reddit OAuth app path | Still karma-gated; Lemmy + subreddit `.rss` replace it |

## Traceability

Which phases cover which requirements. Finalized during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUND-01 | Phase 1 | Complete |
| FOUND-02 | Phase 1 | Complete |
| FOUND-03 | Phase 1 | Complete |
| FOUND-04 | Phase 1 | Complete |
| FOUND-05 | Phase 1 | Complete |
| CRED-01 | Phase 1 | Complete |
| CRED-02 | Phase 1 | Complete |
| CRED-03 | Phase 1 | Complete |
| CRED-04 | Phase 1 | Complete |
| SRC-01 | Phase 2 | Complete |
| SRC-02 | Phase 2 | Complete |
| SRC-03 | Phase 2 | Complete |
| SRC-04 | Phase 2 | Dropped (upstream paywalled 2026-05-13) |
| SRC-05 | Phase 2 | Complete |
| SRC-06 | Phase 3 | Complete |
| SRC-07 | Phase 3 | Complete |
| SRC-08 | Phase 3 | Complete |
| SRC-09 | Phase 4 | Pending |
| OUT-01 | Phase 1 | Complete |
| OUT-02 | Phase 4 | Pending |
| OUT-03 | Phase 1 | Complete |
| YT-01 | Phase 4 | Pending |

**Coverage:**

- v1 requirements: 22 total
- Mapped to phases: 22
- Unmapped: 0 ✓

---
*Requirements defined: 2026-07-01*
*Last updated: 2026-07-01 after roadmap creation (traceability aligned to 4 coarse phases)*
