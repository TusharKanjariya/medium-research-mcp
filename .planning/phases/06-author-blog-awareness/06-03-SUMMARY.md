---
phase: 06-author-blog-awareness
plan: 03
subsystem: api
tags: [rss, substack, archive, mcp, zod, ssrf, graceful-degrade]

# Dependency graph
requires:
  - phase: 06-02
    provides: "resolveAuthorFeed/markPreviewOnly/normalizeFeed + non-brittle registration smoke — reused unchanged"
  - phase: 05
    provides: "getJson untrustedHost:true guarded path (assertSafeUrl SSRF denylist + content-type gate) — the archive call rides it (SEC-01)"
provides:
  - "rss_substack_archive(publication) — full Substack archive enriched with reactions->score, comments->num_comments; graceful RSS-window fallback"
  - "mapSubstackArchiveItem(post) — pure archive-post normalizer onto the frozen contract item"
  - "resolveSubstackPublication(publication) — bare slug / host / full URL -> <pub>.substack.com host (pure)"
  - "fetchSubstackArchive(publication, {getJsonImpl,getTextImpl,jsonOpts,textOpts}) — injectable archive-with-fallback seam"
  - "docs/AUTHOR-BLOG-RECIPES.md — cadence + series/follow-up recipes on normal tool output, honest-window first"
affects: [phase-7, phase-8, medium-blog-pro]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Guarded-JSON enrichment with graceful RSS-window fallback: getJson(untrustedHost:true) archive -> on ANY throw, getText(feed); never hard-errors (D-10)"
    - "SSRF is re-thrown on BOTH the archive and fallback paths (both ride assertSafeUrl) — never swallowed into a fake success envelope"
    - "Archive-with-fallback logic factored into an exported injectable seam (fetchSubstackArchive) so success + fallback + SSRF drive offline"
    - "Registration smoke finalized to the exact four rss tools (from the 06-02 non-brittle present-with-outputSchema form)"

key-files:
  created:
    - test/fixtures/substack-archive.json
    - test/fixtures/substack-archive-loginhtml.html
    - test/fixtures/rss-substack-feed.xml
    - docs/AUTHOR-BLOG-RECIPES.md
  modified:
    - servers/rss/server.js
    - test/rss.test.js

key-decisions:
  - "reactions (reaction_count) -> score and comments (comment_count) -> num_comments via ?? so a legitimate 0 survives and only true absence -> null (D-09)"
  - "resolveSubstackPublication treats a bare token as a Substack pub slug (<slug>.substack.com) — unlike resolveAuthorFeed's ambiguous-reject, because publication input is explicitly a Substack pub; a private/loopback host is rejected by assertSafeUrl on the guarded path, not fabricated-away"
  - "fetchSubstackArchive spreads jsonOpts AFTER untrustedHost:true so a test can inject fetchImpl/lookup/cacheKey but cannot silently drop the SSRF guard"
  - "The catch is bodyless (does not inspect the error) and re-enters getText, which re-runs assertSafeUrl — so a blocked host throws on both paths rather than degrading into a fake envelope"

requirements-completed: [ABLOG-03, ABLOG-05]

coverage:
  - id: D1
    description: "mapSubstackArchiveItem fills score/num_comments from archive reactions/comments; null (not 0) when absent; envelope contract-valid"
    requirement: ABLOG-03
    verification:
      - kind: unit
        ref: "test/rss.test.js#mapSubstackArchiveItem fills score from reactions and num_comments from comments (D-09)"
        status: pass
      - kind: unit
        ref: "test/rss.test.js#mapSubstackArchiveItem yields null (not 0) score/num_comments when absent"
        status: pass
      - kind: unit
        ref: "test/rss.test.js#a ListEnvelope over the mapped archive parses against the contract and preserves count"
        status: pass
    human_judgment: false
  - id: D2
    description: "rss_substack_archive: JSON-200 archive success fills engagement; HTML-200 content-type gate -> RSS-window fallback, never hard-errors (D-10)"
    requirement: ABLOG-03
    verification:
      - kind: unit
        ref: "test/rss.test.js#rss_substack_archive success: archive JSON-200 fills score/num_comments (D-09)"
        status: pass
      - kind: unit
        ref: "test/rss.test.js#rss_substack_archive fallback: an HTML-200 archive degrades to the RSS window, no hard-error (D-10)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The archive getJson passes untrustedHost:true; a private/loopback/metadata publication host is rejected on the guarded path AND on the fallback (D-08)"
    requirement: ABLOG-03
    verification:
      - kind: unit
        ref: "test/rss.test.js#rss_substack_archive SSRF: a private/loopback/metadata publication host is rejected on the guarded path (D-08)"
        status: pass
      - kind: unit
        ref: "test/rss.test.js#rss_substack_archive: a private-host publication throws on BOTH paths (never a fake envelope)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Exactly four rss tools registered (rss_fetch, rss_author_posts, rss_tag_posts, rss_substack_archive), each with an outputSchema"
    requirement: ABLOG-03
    verification:
      - kind: unit
        ref: "test/rss.test.js#rss server registers EXACTLY the four writer-aware tools, each with an outputSchema"
        status: pass
    human_judgment: false
  - id: D5
    description: "docs/AUTHOR-BLOG-RECIPES.md leads with the ~10/~20 window + teaser honesty caveat; cadence (created_utc) + series (title+teaser) recipes on normal output only; names all three tools"
    requirement: ABLOG-05
    verification:
      - kind: manual
        ref: "docs/AUTHOR-BLOG-RECIPES.md — honesty caveat is the first content section; both recipes present; boundaries stated"
        status: pass
    human_judgment: false
  - id: D6
    description: "Live check against a PAYWALLED Substack — archive enrichment fills score/comments; forcing an archive failure yields the RSS window"
    verification: []
    human_judgment: true
    rationale: "Offline fixtures synthesize the archive JSON + login-HTML failure; the research 'Looks Done But Isn't' checklist requires confirming enrichment + fallback against a real paywalled Substack, which needs live network."

# Metrics
duration: 16min
completed: 2026-07-14
status: complete
---

# Phase 6 Plan 03: Substack Archive Enrichment + Author-Blog Recipes Summary

**`rss_substack_archive(publication)` lists a Substack publication's full archive on the Phase 5 guarded JSON path — filling `score` from reactions and `num_comments` from comments on the frozen contract — and degrades to the `<pub>.substack.com/feed` RSS window on ANY archive failure without ever hard-erroring, while a private/loopback publication host is rejected on both paths; the writer-aware surface is completed by `docs/AUTHOR-BLOG-RECIPES.md`, which leads with the ~10 Medium / ~20 Substack window honesty caveat before its cadence and series/follow-up recipes.**

## Performance

- **Duration:** ~16 min
- **Tasks:** 3 (Tasks 1 & 2 TDD: RED -> GREEN; Task 3 doc)
- **Files:** 6 (2 modified, 4 created)

## Accomplishments
- Added and exported `mapSubstackArchiveItem(post)` — the one enrichment the RSS window cannot do: `reaction_count -> score`, `comment_count -> num_comments` via `??` (a legitimate 0 survives; absence -> null), `type: "article"`, `post_date -> created_utc` (via `toIso`), `canonical_url -> url/permalink`, `publishedBylines[0].name -> author`, `postTags[].name -> tags[]`, `subtitle ?? description -> text`. Confirmed archive JSON keys documented in a code comment (D-09).
- Added `resolveSubstackPublication(publication)` (pure) — accepts a bare slug, a `<pub>.substack.com` host, or a full Substack URL and returns the host; a bare token is treated as a Substack pub slug (`<slug>.substack.com`), leaving SSRF safety to the guarded fetch rather than host-fabrication guessing.
- Added `fetchSubstackArchive(publication, opts)` (exported, injectable) — `getJson(archiveUrl, { untrustedHost: true })` then map through `mapSubstackArchiveItem`; on ANY throw, fall back to `getText(<pub>/feed) -> parseFeed -> normalizeFeed -> markPreviewOnly` and return that envelope. `untrustedHost:true` is spread-protected so a test cannot drop it. The bodyless catch re-enters `getText`, which re-runs `assertSafeUrl`, so a blocked host throws on both paths (D-08/09/10).
- Registered `rss_substack_archive` (`{ publication }` inputSchema + `listEnvelopeShape` outputSchema); the handler delegates to `fetchSubstackArchive`. Description states the archive-vs-RSS-window tradeoff, the unofficial/graceful-fallback behavior, and points to `docs/AUTHOR-BLOG-RECIPES.md` (D-12).
- Wrote `docs/AUTHOR-BLOG-RECIPES.md` (ABLOG-05): leads with the ~10 Medium / ~20 Substack window + teaser-quality (`preview-only`) honesty caveat (D-13), then a posting-cadence recipe (`created_utc` only) and a series/follow-up recipe (`title` primary + teaser secondary), plus explicit no-scraping / no-cookie-workaround / no-new-field boundaries. Names all three writer-aware tools.
- Finalized the registration smoke to assert EXACTLY the four rss tools (`rss_author_posts`, `rss_fetch`, `rss_substack_archive`, `rss_tag_posts`), each with an outputSchema (retiring the 06-02 non-brittle present-with-outputSchema placeholder).
- Full suite green: 335/335 (`npm test`); rss suite 51/51 including archive success, HTML-200 -> RSS fallback, SSRF reject (privateLookup + literal 127.0.0.1 / 169.254.169.254), both-path SSRF reject, and the exactly-four smoke.

## Task Commits

1. **Task 1: mapSubstackArchiveItem normalizer** — `4653303` (test) -> `bf50664` (feat)
2. **Task 2: register rss_substack_archive (guarded getJson + RSS fallback) + SSRF + finalize smoke** — `2934839` (test) -> `d134610` (feat)
3. **Task 3: docs/AUTHOR-BLOG-RECIPES.md** — `17cd567`

Plan metadata committed separately with SUMMARY.md + STATE.md + ROADMAP.md + REQUIREMENTS.md.

## Files Created/Modified
- `servers/rss/server.js` — added `getJson` import; `mapSubstackArchiveItem`, `resolveSubstackPublication`, `fetchSubstackArchive`; registered `rss_substack_archive`.
- `test/rss.test.js` — Task 1 archive-normalizer units; Task 2 success / HTML-200-fallback / SSRF-reject / both-path-SSRF / registration tests; finalized exactly-four smoke; added a JSON/raw-body fixture loader.
- `test/fixtures/substack-archive.json` — archive success body (one post with reactions+comments, one without).
- `test/fixtures/substack-archive-loginhtml.html` — the login-interstitial failure body fed to the content-type gate.
- `test/fixtures/rss-substack-feed.xml` — the `<pub>.substack.com/feed` RSS fallback window.
- `docs/AUTHOR-BLOG-RECIPES.md` — the recipes doc (ABLOG-05).

## Decisions Made
- **Archive JSON key names confirmed and locked to the contract mapping:** `reaction_count -> score`, `comment_count -> num_comments`, `post_date -> created_utc`, `canonical_url -> url/permalink`, `publishedBylines[0].name -> author`, `postTags[].name -> tags[]`, `subtitle ?? description -> text`. The mapping is locked; key names documented in a code comment (planner's "Claude's Discretion").
- **Bare-token handling diverges intentionally from `resolveAuthorFeed`:** for a *publication* argument a bare token is unambiguously a Substack pub slug, so `resolveSubstackPublication` appends `.substack.com` rather than throwing. Host safety is enforced by `assertSafeUrl` on the guarded fetch, not by refusing to build a host.
- **SSRF is never swallowed:** the graceful-degrade catch is bodyless and re-enters `getText`, which re-validates the same host — so a private/loopback/metadata publication ends in a thrown `/blocked address/` error on both the archive and the fallback path, not a fake envelope (threat T-06-06 mitigated and confirmed by test).
- **Injectable seam over a handler fetchImpl:** mirroring the lemmy SEC-01 note and 06-02's `filterAuthorPosts` extraction, the archive-with-fallback logic lives in exported `fetchSubstackArchive` so success + fallback + SSRF are driven offline with no live network; the registered handler is a thin delegate.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Login-HTML failure fixture uses a `.html` extension, not `.json`**
- **Found during:** Task 2
- **Issue:** The plan frontmatter listed `test/fixtures/substack-archive-loginhtml.json`, but the fixture holds a raw HTML login page (it is fed to the content-type gate as a `text/html` body and is never JSON-parsed). A `.json` file containing `<!doctype html>` is misleading and could trip JSON tooling/linters.
- **Fix:** Created `test/fixtures/substack-archive-loginhtml.html` and loaded it via a `rawFixture()` reader. The plan action text itself says the file is "not JSON-shaped … an HTML body"; the `.html` extension makes that honest.
- **Files:** test/fixtures/substack-archive-loginhtml.html
- **Committed in:** `2934839`

**2. [Test authoring] Retired the 06-02 non-brittle smoke rather than leaving two overlapping registration tests**
- **Found during:** Task 2
- **Issue:** 06-02 left a loop-based "present-with-outputSchema" smoke as a placeholder for 06-03 to finalize. Keeping both it and the new exactly-four assertion would be redundant.
- **Fix:** Removed the placeholder loop test and left the single finalized exactly-four assertion (the plan's explicit instruction). No coverage lost — the exact-four test subsumes it.
- **Committed in:** `2934839`

**Total deviations:** 1 auto-fixed (Rule 3, fixture extension) + 1 test-authoring cleanup. No scope creep; no shared-module changes (`shared/http_client.js` / `shared/contract.js` untouched — the archive rides the existing SEC-01 guarded path and frozen contract).

## Issues Encountered
None beyond the deviations. No package installs (zero new runtime dependencies — the archive is a keyless JSON GET through the existing `getJson`). No `process.env` reads; no secrets.

## Known Stubs
None. `rss_substack_archive` is fully wired to the live `getJson`/`getText` pipeline; fixtures drive the offline tests only.

## Threat Flags
None. The one new externally-facing surface (`publication -> getJson(untrustedHost:true)`) is the reuse SEC-01 was built for and is confirmed rejected for private/loopback/metadata hosts on both paths (T-06-06 mitigated). No new endpoints, auth paths, or schema changes beyond the planned archive host.

## User Setup Required
None — the Substack archive endpoint is keyless.

## Next Phase Readiness
- Phase 6 (Author-Blog Awareness) is code-complete: `rss_author_posts`, `rss_tag_posts`, and `rss_substack_archive` ship in `servers/rss`, plus `docs/AUTHOR-BLOG-RECIPES.md`. Ready for phase verification.
- One deferred live check (coverage D6, human_judgment): confirm archive enrichment fills `score`/`num_comments` against a real paywalled Substack and that forcing an archive failure yields the RSS window — on the research "Looks Done But Isn't" list.

## Self-Check: PASSED
- Files created: `servers/rss/server.js`, `test/rss.test.js`, `test/fixtures/substack-archive.json`, `test/fixtures/substack-archive-loginhtml.html`, `test/fixtures/rss-substack-feed.xml`, `docs/AUTHOR-BLOG-RECIPES.md` — all FOUND on disk.
- Commits: `4653303`, `bf50664`, `2934839`, `d134610`, `17cd567` all present in `git log`.
- Tests: `npm test` 335/335 pass; `node --test test/rss.test.js` 51/51 pass.

---
*Phase: 06-author-blog-awareness*
*Completed: 2026-07-14*
