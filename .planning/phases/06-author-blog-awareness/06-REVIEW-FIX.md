---
phase: 06-author-blog-awareness
fixed_at: 2026-07-14T00:00:00Z
review_path: .planning/phases/06-author-blog-awareness/06-REVIEW.md
iteration: 1
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
---

# Phase 6: Code Review Fix Report

**Fixed at:** 2026-07-14
**Source review:** `.planning/phases/06-author-blog-awareness/06-REVIEW.md`
**Iteration:** 1
**Executor:** sequential, main tree (master), normal commits with hooks

**Summary:**
- Findings in scope: 4 (all four WARNINGs; the 3 INFO items IN-01/02/03 were out of scope and left unaddressed)
- Fixed: 4
- Skipped: 0
- Tests: 335 → 341 (6 focused tests added, all green; `npm test` and `node --test test/rss.test.js` both pass)

## Fixed Issues

### WR-01: `media:group>media:description` bypasses the `textOf` coercion

**Files modified:** `servers/rss/server.js`, `test/rss.test.js`
**Commit:** `c73f5e1`
**Applied fix:** Wrapped the `entry["media:group"]?.["media:description"]` access in
`mapAtomEntry` with `textOf(...)`, mirroring the sibling `entry.summary` /
`entry.content` accesses. An attribute-carrying `<media:description>` now collapses
to its `#text` string (or falls through to summary/content) instead of shipping a
raw object that stringifies to `"[object Object]"` downstream. Added two tests: an
object-valued `media:description` collapses to its string (and the envelope still
validates + contains no `"[object Object]"`), and an attribute-only object falls
back to `<summary>`.

### WR-02: `untrustedHost: true` overridable by `jsonOpts` spread

**Files modified:** `servers/rss/server.js`, `test/rss.test.js`
**Commit:** `f539167`
**Applied fix:** Reordered the `getJsonImpl` options object in `fetchSubstackArchive`
so `...jsonOpts` is spread FIRST and `untrustedHost: true` is applied LAST — the
mandatory SSRF flag now wins last-write-wins and cannot be silently dropped by any
caller/test. Corrected the inline comment (it previously claimed the opposite,
backwards behavior). Added a test proving a hostile `jsonOpts: { untrustedHost:
false }` against a private-resolving host still rejects with `blocked address` and
never reaches a fake envelope.

### WR-03: non-array archive 200 returns an empty envelope instead of degrading

**Files modified:** `servers/rss/server.js`, `test/rss.test.js`
**Commit:** `cab42af`
**Applied fix:** Inside the `try` of `fetchSubstackArchive`, a non-array OR empty
archive body now throws `unexpected archive shape (non-array or empty body)`, so it
lands in the existing `catch` and degrades to the `<pub>.substack.com/feed` RSS
window (D-10) rather than returning a misleading `count: 0` envelope for an active
publication. Verified the SSRF-on-both-paths guarantee is preserved (the getText
fallback still re-runs `assertSafeUrl`). Added two tests driving the real fallback:
a non-array (`{ posts: [], error }`) 200 and an empty-array 200 both degrade to a
non-empty RSS-window envelope with null engagement, never a throw.

### WR-04: `filterAuthorPosts` query matches un-stripped HTML markup

**Files modified:** `servers/rss/server.js`, `test/rss.test.js`
**Commit:** `d013bec`
**Applied fix:** Imported `stripHtml` from `shared/contract.js` and updated the
`query` branch of `filterAuthorPosts` to test the HTML-stripped text (the visible
text the caller ultimately receives) rather than the raw `it.text`. Title matching
and case-insensitivity (D-04) are unchanged; the envelope shape is untouched. Added
a test proving markup-only tokens (`span`, `href`, `https`, `img`, `class`, `<p>`)
no longer match, while visible prose and the title still do. The existing
title-substring query test remains green.

## Notes

- **Scope:** Info findings IN-01 (archive success path skips `markPreviewOnly`),
  IN-02 (`entry.id` not coerced via `textOf`), and IN-03 (degenerate empty
  tag/pub URLs) were explicitly out of scope for this pass and were not modified.
- **Contract:** No item fields added, renamed, or dropped; all tools continue to
  return the standard list envelope via `buildListEnvelope` + `toolResult`.
- **Fetch chokepoint:** unchanged — archive stays on `getJson({ untrustedHost: true })`,
  feeds on `getText`; no direct `fetch()` introduced.

---

_Fixed: 2026-07-14_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
