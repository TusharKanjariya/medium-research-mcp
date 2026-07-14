---
phase: 06-author-blog-awareness
verified: 2026-07-14T00:00:00Z
status: passed
score: 5/5 must-haves verified
human_verification_resolved: 2026-07-14T08:00:00Z (both items passed live — see 06-UAT.md)
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Call rss_author_posts against a REAL paid Medium author and a paywalled Substack publication over live network"
    expected: "Member-only / paywalled items carry the literal `preview-only` tag in tags[]; free items do not; text stays teaser-quality and is never mutated"
    why_human: "Requires real network access and real paid/member-only content; the preview heuristic (markers like 'Continue reading on Medium' / 'Read more' / 'member-only') can only be validated against genuine paywalled bodies, which cannot be fabricated offline. Fixture-level behavior is fully tested (test/rss.test.js (k)/(l))."
  - test: "Call rss_substack_archive against a live Substack publication whose archive endpoint is up"
    expected: "score is filled from real reaction_count and num_comments from real comment_count; when the endpoint is down/login-gated it silently degrades to the ~20-item /feed RSS window with null engagement and never hard-errors"
    why_human: "Requires a live, currently-reachable unofficial archive endpoint returning real engagement JSON; the enrichment mapping and every failure/degrade path are proven offline (test/rss.test.js (n)/(o)), but live archive schema drift can only be observed against the real endpoint."
---

# Phase 6: Author-Blog Awareness Verification Report

**Phase Goal:** Any agent can read a chosen author's Medium/Substack/raw-feed posts in the normalized contract — author always a tool parameter — with honest coverage windows and documented dedup/cadence recipes.
**Verified:** 2026-07-14
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Fetch an author's posts by author param (Medium `@user` / Substack / raw feed URL) → normalized items, HTML-stripped text + tags | ✓ VERIFIED | `rss_author_posts` registered (server.js:556) with `author` param; `resolveAuthorFeed` (242-287) resolves @handle→`medium.com/feed/@user`, `*.substack.com`→`/feed`, other http(s)→raw, bare token→throws. Handler pipeline getText→parseFeed→normalizeFeed→markPreviewOnly→filter (593-600). HTML-strip + tags[] via `buildListEnvelope`/`normalizeItem`. Tests (j)/(k) resolveAuthorFeed + preview all green. |
| 2 | Honest, visible coverage window: `count` + per-item `created_utc`, tool descriptions state feed caps + paywall truncation | ✓ VERIFIED | `count` emitted by `buildListEnvelope`; per-item `created_utc` mapped (mapRssItem:155, mapAtomEntry:195). Descriptions explicitly state "~10 most recent" (Medium) and "~20" (Substack) + paywall/preview-only (server.js:570-578, 615-619, 644-652). |
| 3 | List a Substack archive with reactions→`score`/comments→`num_comments`; degrade to RSS window on failure without hard-erroring (incl. WR-03 non-array bodies) | ✓ VERIFIED | `rss_substack_archive` (634) + `mapSubstackArchiveItem` (389): `reaction_count`→score, `comment_count`→num_comments with `??` (0 survives). D-10 try/catch degrades to `<pub>.substack.com/feed` (495-503). WR-03 fix: non-array OR empty body throws→routes to fallback (488-492). Tests (o) drive HTML-200, non-array, empty-array all degrading; never a throw. |
| 4 | Fetch posts by tag (Medium `feed/tag/<tag>`), tag as tool parameter | ✓ VERIFIED | `rss_tag_posts` registered (603) with `tag` param; `resolveTagFeed` builds `medium.com/feed/tag/<encoded>` (361-363). Description states Medium-only, no `platform` param (D-11). |
| 5 | Documented recipes for posting-cadence + series/follow-up detection using only normal tool output | ✓ VERIFIED | `docs/AUTHOR-BLOG-RECIPES.md` present: Recipe 1 (cadence, `created_utc` only), Recipe 2 (series/follow-up, title-first + teaser). Leads with the ~10/~20 window honesty caveat + `preview-only` teaser caveat. "Boundaries" section forbids scraping/new fields. |

**Score:** 5/5 truths verified (0 present, behavior-unverified)

### Load-Bearing Invariants

| Invariant | Status | Evidence |
|-----------|--------|----------|
| FROZEN contract — no new/renamed fields; `preview-only` rides `tags[]`; reactions→score, comments→num_comments | ✓ VERIFIED | contract.js ItemSchema = exactly the 11 fields (46-56). `markPreviewOnly` appends `PREVIEW_TAG="preview-only"` to tags, never mutates text (305-319). No new keys in any mapper. |
| SSRF — `rss_substack_archive` uses `getJson(url,{untrustedHost:true})`, rejects private/link-local hosts | ✓ VERIFIED | `fetchSubstackArchive` spreads `...jsonOpts` first, `untrustedHost:true` last so it cannot be overridden (479-482, WR-02 fix). Fallback getText re-runs assertSafeUrl. Tests (o): 127.0.0.1 / 169.254.169.254 → `blocked address` on both paths; hostile `untrustedHost:false` still rejects. |
| Fetch chokepoint — no direct `fetch()` in the server | ✓ VERIFIED | grep: the only `fetch(` matches are `rss_fetch` tool name + doc-comment strings; server imports/uses only `getText`/`getJson` from shared/http_client.js. |
| Medium 403 → clear terminal error in getText, host-gated, boundary-safe, strict no-4xx-retry | ✓ VERIFIED | `isMediumHost` boundary-safe suffix match (http_client.js:54-57, rejects `notmedium.com`); 403+Medium branch surfaces honest error, still terminal (`transientFailure=false; break`), redactUrl strips query (581-593). Non-Medium 403 keeps generic `HTTP 403` message (594). |
| RSS server registers EXACTLY four tools, each with outputSchema | ✓ VERIFIED | 4 `server.registerTool` calls (514/556/603/634): rss_fetch, rss_author_posts, rss_tag_posts, rss_substack_archive. `outputSchema: listEnvelopeShape` count = 4. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `servers/rss/server.js` | 4 tools + resolveAuthorFeed/markPreviewOnly/resolveTagFeed/mapSubstackArchiveItem/fetchSubstackArchive | ✓ VERIFIED | All exported + wired; 32KB implementation. |
| `shared/http_client.js` | host-gated Medium-403 branch + userAgent | ✓ VERIFIED | isMediumHost + 403 branch (581); UA default injected (550). |
| `docs/AUTHOR-BLOG-RECIPES.md` | cadence + series recipes | ✓ VERIFIED | Present, both recipes + honesty caveats. |
| test fixtures | Medium author/member-only/tag, Substack paywall/feed/archive | ✓ VERIFIED | rss-medium-author.xml, rss-medium-memberonly.xml, rss-medium-tag.xml, rss-substack-paywall.xml, rss-substack-feed.xml, substack-archive.json, substack-archive-loginhtml.html present. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full suite (single run) | `npm test` | tests 341 / pass 341 / fail 0 | ✓ PASS |
| Archive degrade (non-array/empty/HTML-200) | rss.test.js (o) | all degrade to RSS window, no throw | ✓ PASS |
| Archive SSRF on both paths | rss.test.js (o) | 127.0.0.1 & 169.254.169.254 → blocked | ✓ PASS |
| preview-only marking (Medium member-only + Substack paywall fixtures) | rss.test.js (k)/(l) | tagged on paid, absent on free | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| ABLOG-01 | 06-01, 06-02 | Author posts by param, normalized, HTML-stripped + tags | ✓ SATISFIED | rss_author_posts + resolveAuthorFeed |
| ABLOG-02 | 06-02 | Partial-window honesty: count + created_utc + described caps | ✓ SATISFIED | count/created_utc + tool descriptions |
| ABLOG-03 | 06-03 | Substack archive, score/num_comments, degrade on failure | ✓ SATISFIED | rss_substack_archive + WR-03 fallback |
| ABLOG-04 | 06-02 | Posts by tag (Medium feed/tag), tag as param | ✓ SATISFIED | rss_tag_posts + resolveTagFeed |
| ABLOG-05 | 06-03 | Documented cadence + series recipes | ✓ SATISFIED | docs/AUTHOR-BLOG-RECIPES.md |

All 5 phase requirement IDs accounted for. REQUIREMENTS.md marks ABLOG-01..05 Complete (traceability table lines 119-123). No orphaned requirements for Phase 6.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | none | — | No unreferenced TBD/FIXME/XXX in phase-modified files. `return null`/empty-return patterns are legitimate null-defaulting per contract, not stubs. INFO items IN-01/02/03 from review left out of scope (documented, non-blocking). |

### Human Verification Required

Two live-network validations that cannot be exercised offline (real network + real paid content required). Both underlying code paths are fully unit-tested against fixtures — these confirm live-source behavior only:

1. **Live preview-only against real paywalled content** — call `rss_author_posts` on a real paid Medium author and paywalled Substack; confirm `preview-only` tags appear on gated items and text stays teaser-quality.
2. **Live Substack archive enrichment** — call `rss_substack_archive` on a publication with a reachable archive endpoint; confirm real reaction/comment counts fill score/num_comments and that a down endpoint degrades to the RSS window without erroring.

### Gaps Summary

No gaps. All 5 ROADMAP success criteria and all 5 load-bearing invariants are verified in `servers/rss/server.js` / `shared/http_client.js` / `docs/AUTHOR-BLOG-RECIPES.md`, backed by a green 341-test suite (0 fail). Code review found 0 critical / 4 warning; all 4 warnings fixed (WR-01..04, commits c73f5e1/f539167/cab42af/d013bec) and each carries a regression test. Status is `human_needed` solely because two live-network judgment checks were deliberately deferred by the executors — they require real paid content and a live archive endpoint, not automatable and not code gaps.

---

_Verified: 2026-07-14_
_Verifier: Claude (gsd-verifier)_
