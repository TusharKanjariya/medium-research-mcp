---
phase: 06-author-blog-awareness
plan: 02
subsystem: api
tags: [rss, atom, medium, substack, mcp, zod, fast-xml-parser, ssrf]

# Dependency graph
requires:
  - phase: 06-01
    provides: "getText Medium-403 host-gated terminal mapping + UA 1.1 — rss_author_posts/rss_tag_posts inherit it unchanged"
  - phase: 04
    provides: "getText assertSafeUrl SSRF guard (scheme allowlist + private-range denylist + per-hop redirect re-validation) that the raw-URL author branch rides"
provides:
  - "rss_author_posts(author, query?, published_before?) — writer's Medium/Substack/raw-feed window in the frozen contract"
  - "rss_tag_posts(tag) — Medium-only tag feed in the frozen contract"
  - "resolveAuthorFeed(author) — pure platform-inference helper (throws on ambiguous bare token, never guesses a host)"
  - "resolveTagFeed(tag) — pure Medium tag-feed URL builder (URL-encoded segment)"
  - "markPreviewOnly(item) — appends literal preview-only to tags[] on paywalled/member-only bodies; text left clean"
  - "filterAuthorPosts(results, {query, published_before}) — pure post-normalize narrowing"
affects: [06-03, phase-7, medium-blog-pro]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Smart single-parameter platform inference by string shape (deliberate, bounded departure from the never-infer posture — ambiguous input throws)"
    - "Writer/preview signals ride EXISTING contract fields (preview state -> tags[]); zero schema change"
    - "Non-brittle registration smoke (present-with-outputSchema) so later plans extend the tool set without rewriting the assertion"

key-files:
  created:
    - test/fixtures/rss-medium-author.xml
    - test/fixtures/rss-medium-memberonly.xml
    - test/fixtures/rss-substack-paywall.xml
    - test/fixtures/rss-medium-tag.xml
  modified:
    - servers/rss/server.js
    - test/rss.test.js

key-decisions:
  - "resolveAuthorFeed infers platform by author shape and THROWS on an ambiguous bare token — never synthesizes a host (T-06-03 SSRF/typo footgun)"
  - "Substack branch resolves ONLY a real <pub>.substack.com host; a string that merely mentions substack.com in a path falls through to the ambiguous throw"
  - "preview/paywall state rides tags[] as the literal preview-only (markPreviewOnly), never a new field, text never mutated — contract frozen (D-06/D-07)"
  - "query/published_before narrow AFTER normalize (fixed platform window, D-04); split into a pure filterAuthorPosts helper for offline testability"
  - "rss_tag_posts is Medium-only (D-11) — no platform param, tag URL-encoded into medium.com/feed/tag/<tag>"

patterns-established:
  - "Platform-by-shape inference with an explicit ambiguous-reject (no host guessing) as the SSRF-safe default"
  - "Preview truncation surfaced via an existing array field rather than a new contract field"

requirements-completed: [ABLOG-01, ABLOG-02, ABLOG-04]

coverage:
  - id: D1
    description: "resolveAuthorFeed maps @handle/*.substack.com/raw-http to feed URLs and throws (no host guess) on an ambiguous bare token"
    requirement: ABLOG-01
    verification:
      - kind: unit
        ref: "test/rss.test.js#resolveAuthorFeed: an ambiguous bare token throws and never guesses a host (D-03/T-06-03)"
        status: pass
    human_judgment: false
  - id: D2
    description: "rss_author_posts returns a contract-valid ListEnvelope; query/published_before narrow after normalize"
    requirement: ABLOG-01
    verification:
      - kind: unit
        ref: "test/rss.test.js#rss_author_posts pipeline over a Medium author feed yields a contract-valid envelope"
        status: pass
      - kind: unit
        ref: "test/rss.test.js#rss_author_posts query narrows by title/teaser substring (case-insensitive)"
        status: pass
      - kind: unit
        ref: "test/rss.test.js#rss_author_posts published_before drops items at/after the cutoff"
        status: pass
    human_judgment: false
  - id: D3
    description: "Paywalled Substack + Medium member-only items carry preview-only in tags[]; free items do not; honest-window caps stated in descriptions"
    requirement: ABLOG-02
    verification:
      - kind: unit
        ref: "test/rss.test.js#rss_author_posts marks a paywalled Substack 'Read more' item preview-only; free item is not"
        status: pass
      - kind: unit
        ref: "test/rss.test.js#rss_author_posts description states the ~10/~20 window caps and paywall truncation"
        status: pass
    human_judgment: false
  - id: D4
    description: "rss_tag_posts (Medium-only) builds a URL-encoded tag feed and yields a contract-valid envelope; SINGLE-TOOL note corrected"
    requirement: ABLOG-04
    verification:
      - kind: unit
        ref: "test/rss.test.js#rss_tag_posts pipeline over a Medium tag feed yields a contract-valid envelope"
        status: pass
      - kind: unit
        ref: "test/rss.test.js#rss_fetch description no longer claims the server exposes only rss_fetch (D-01)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Live check against a PAID Medium author and a PAYWALLED Substack — preview-only appears, no [object Object], CDATA rides textOf"
    verification: []
    human_judgment: true
    rationale: "Offline fixtures synthesize the truncation markers; the research 'Looks Done But Isn't' checklist requires confirming the heuristic fires on real paid content, which needs live network + a paid account."

# Metrics
duration: 7min
completed: 2026-07-14
status: complete
---

# Phase 6 Plan 02: Writer-Aware RSS (author + tag tools) Summary

**`servers/rss` is now writer-aware — `rss_author_posts` and `rss_tag_posts` read a chosen author's Medium/Substack/raw-feed and Medium-tag windows in the frozen contract, inferring platform by the author string's shape, rejecting ambiguous tokens without guessing a host, and flagging paywalled/member-only bodies with a `preview-only` tag while keeping `text` clean.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-07-14T06:37:53Z
- **Completed:** 2026-07-14T06:44:40Z
- **Tasks:** 3 (all TDD: RED → GREEN)
- **Files modified:** 6 (2 modified, 4 fixtures created)

## Accomplishments
- Added `resolveAuthorFeed(author)`: `@handle` → `medium.com/feed/@user`, `*.substack.com` (bare or full URL) → `<pub>.substack.com/feed`, other `http(s)://` → raw URL verbatim; a bare token throws naming the three accepted forms and NEVER fabricates a host (T-06-03).
- Added `markPreviewOnly(item)`: appends the literal `preview-only` to `tags[]` on a Substack "Read more" teaser or a Medium member-only/abstract-only body (detected over a tag-stripped copy of `text`), append-once, `text` never modified — contract stays frozen (D-06/D-07).
- Registered `rss_author_posts(author, query?, published_before?)` reusing the shipped `getText → parseFeed → normalizeFeed → markPreviewOnly → filterAuthorPosts` chain; description states the ~10 Medium / ~20 Substack caps and paywall teaser truncation (D-05).
- Registered `rss_tag_posts(tag)` (Medium-only, D-11) with the tag URL-encoded into `medium.com/feed/tag/<tag>`; description says Medium-only.
- Corrected both SINGLE-TOOL DESIGN statements (file header comment + `rss_fetch` description) so neither claims the server exposes only `rss_fetch` (D-01); `rss_fetch` stays the generic single-feed fetcher.
- Full suite green: 325/325 (`npm test`); rss suite 41/41 including the inference table + ambiguous reject, paywalled-Substack + Medium member-only → `preview-only`, and contract-valid author/tag envelopes.

## Task Commits

Each task was committed atomically (TDD: test → feat):

1. **Task 1: resolveAuthorFeed + markPreviewOnly (pure helpers)** — `7002fd3` (test) → `a1c165f` (feat)
2. **Task 2: register rss_author_posts + fixtures** — `b6131b3` (test) → `82ea8a9` (feat)
3. **Task 3: register rss_tag_posts + SINGLE-TOOL note + smoke** — `3c14da6` (test) → `e1fc432` (feat)

**Plan metadata:** committed with SUMMARY.md + STATE.md + ROADMAP.md + REQUIREMENTS.md.

## Files Created/Modified
- `servers/rss/server.js` — added `resolveAuthorFeed`, `markPreviewOnly`/`PREVIEW_TAG`, `filterAuthorPosts`, `resolveTagFeed`; registered `rss_author_posts` and `rss_tag_posts`; reworded the two SINGLE-TOOL notes.
- `test/rss.test.js` — inference table (incl. ambiguous reject), preview-marker detection, author pipeline (query/published_before/preview), tag pipeline + URL-encoding, SINGLE-TOOL correction, non-brittle registration smoke.
- `test/fixtures/rss-medium-author.xml` — Medium `/feed/@user` sample (rust + go items, distinct pubDates for the filters).
- `test/fixtures/rss-medium-memberonly.xml` — a Medium member-only item ("Continue reading on Medium ») + a free item.
- `test/fixtures/rss-substack-paywall.xml` — a Substack paid item ending in "Read more" + a free item.
- `test/fixtures/rss-medium-tag.xml` — a Medium `/feed/tag/<tag>` sample.

## Decisions Made
- Substack host resolution accepts ONLY a real `<pub>.substack.com` host (via `URL().hostname` for full URLs, first path segment for bare hosts); a string that merely mentions `substack.com` in a path falls through to the ambiguous throw — closing the host-fabrication footgun beyond the literal D-03 wording.
- `filterAuthorPosts` was extracted as an exported pure helper (not inlined in the handler) so `query`/`published_before` are testable offline without a network fetchImpl seam (mirrors the lemmy SEC-01 note).
- `published_before` compares via `Date.parse` (not raw ISO string compare) and silently ignores an unparseable cutoff rather than erroring.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Converted the brittle exact-set registration smoke early (Task 2, not Task 3)**
- **Found during:** Task 2 (register rss_author_posts)
- **Issue:** The pre-existing `registers exactly ['rss_fetch']` deepEqual smoke went red the moment Task 2 added a second tool, which would have left Task 2's commit with a failing suite.
- **Fix:** Rewrote it in Task 2 to the sanctioned non-brittle "present-with-outputSchema" form (per the plan's critical rule that 06-03 finalizes the exact set), then extended it to include `rss_tag_posts` in Task 3. No hardcoded 3-tool deepEqual was introduced.
- **Files modified:** test/rss.test.js
- **Verification:** `node --test test/rss.test.js` green at each commit.
- **Committed in:** `82ea8a9` (Task 2), extended in `e1fc432` (Task 3)

**2. [Test authoring] inputSchema assertion reads `.shape`**
- **Found during:** Task 2
- **Issue:** The MCP SDK compiles the raw Zod shape passed to `registerTool` into a `ZodObject`, so `Object.keys(tool.inputSchema)` returns Zod internals, not the field names.
- **Fix:** Assert over `tool.inputSchema.shape` keys. Not a plan deviation — a correction to the new test's own access path.
- **Committed in:** `82ea8a9`

---

**Total deviations:** 1 auto-fixed (Rule 3) + 1 test-authoring correction.
**Impact on plan:** No scope creep. The registration-smoke rewrite is exactly the non-brittle form the plan mandated; it merely happened one task earlier to keep every commit green.

## Issues Encountered
None beyond the deviations above. No package installs, no shared-module touches (`shared/http_client.js` / `shared/credentials.js` untouched per the context note — the tools inherit 06-01's Medium-403 hardening via `getText`).

## Known Stubs
None. Both tools are fully wired to the live `getText` pipeline; fixtures drive the offline tests only.

## User Setup Required
None - no external service configuration required (keyless Medium/Substack feeds).

## Next Phase Readiness
- Wave 2 (06-03) can proceed: it adds `rss_substack_archive` (guarded JSON + RSS fallback) and `docs/AUTHOR-BLOG-RECIPES.md`, and finalizes the registration smoke to the exact four tools. `markPreviewOnly` and the `getText → parseFeed → normalizeFeed` chain are ready to reuse.
- One deferred live check (coverage D5, human_judgment): verify `preview-only` fires against a real PAID Medium author and a PAYWALLED Substack — on the research "Looks Done But Isn't" list.

## Self-Check: PASSED
- Files created: all 4 fixtures FOUND on disk.
- Commits: `7002fd3`, `a1c165f`, `b6131b3`, `82ea8a9`, `3c14da6`, `e1fc432` all present in `git log`.
- Tests: `npm test` 325/325 pass; `node --test test/rss.test.js` 41/41 pass.

---
*Phase: 06-author-blog-awareness*
*Completed: 2026-07-14*
