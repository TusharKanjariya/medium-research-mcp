---
phase: 06-author-blog-awareness
reviewed: 2026-07-14T07:20:12Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - servers/rss/server.js
  - shared/http_client.js
  - shared/credentials.js
  - docs/AUTHOR-BLOG-RECIPES.md
  - test/rss.test.js
  - test/http_client.test.js
  - test/credentials.test.js
findings:
  critical: 0
  warning: 4
  info: 3
  total: 7
status: issues_found
---

# Phase 6: Code Review Report

**Reviewed:** 2026-07-14T07:20:12Z
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Phase 6 adds three writer-aware RSS tools (`rss_author_posts`, `rss_tag_posts`,
`rss_substack_archive`) plus the Substack archive enrichment and Medium-403 /
malformed-redirect hardening in the shared client. I reviewed against the six
project invariants in the phase context (frozen contract, SSRF discipline, fetch
chokepoint, Medium 403 gating, `process.env` isolation, platform inference).

The high-value invariants hold in the production call path: the archive fetch
does engage `getJson(url, { untrustedHost: true })`, the RSS-window fallback
re-runs `assertSafeUrl` so a private/loopback host throws on both paths (not a
fake envelope), the Medium-403 message is host-gated and boundary-safe
(`notmedium.com` correctly excluded), `RETRYABLE_5XX` is untouched, and
`process.env` is read only in `credentials.js`. Ambiguous bare author tokens
throw rather than fabricating a host. Tests cover these well.

No BLOCKERs found. Four WARNINGs: an uncoerced object-valued field that
reproduces the exact WR-01 `"[object Object]"` bug the phase fixed elsewhere; an
opts-spread ordering that lets the *mandatory* SSRF flag be overridden and whose
inline comment claims the opposite; a graceful-degrade gap where a
non-array archive 200 returns an empty envelope instead of falling back; and a
query filter that matches against un-stripped HTML markup.

## Warnings

### WR-01: `media:group>media:description` bypasses the `textOf` coercion — reproduces the `"[object Object]"` bug

**File:** `servers/rss/server.js:175-179` (`mapAtomEntry`)
**Issue:** Phase 6's WR-01 fixes explicitly route `author`, `content:encoded`,
and `dc:creator` through `textOf()` so an element carrying an XML attribute
(which fast-xml-parser materializes as `{ "#text": "...", "@_x": "..." }`)
collapses to its string body. But `media:group > media:description` — the very
field the YouTube path *prefers* for `text` — is taken raw:

```js
const text =
  entry["media:group"]?.["media:description"] ??   // NOT wrapped in textOf
  textOf(entry.summary) ??
  textOf(entry.content) ??
  null;
```

If a feed emits `<media:description type="plain">…</media:description>` (any
attribute at all), `media:description` parses to an object, `text` becomes that
object, and downstream `normalizeItem` → `stripHtml(String(obj))` yields the
literal string `"[object Object]"` — the exact garbage the sibling WR-01 fixes
were written to prevent. It passes `z.string()` validation, so it ships silently
rather than erroring. This is a parity gap, not a new class of bug.
**Fix:** Coerce identically to the other fields:
```js
const text =
  textOf(entry["media:group"]?.["media:description"]) ??
  textOf(entry.summary) ??
  textOf(entry.content) ??
  null;
```

### WR-02: `untrustedHost: true` can be overridden by `jsonOpts`; the inline comment asserts the opposite

**File:** `servers/rss/server.js:466-469` (`fetchSubstackArchive`)
**Issue:** The mandatory SSRF flag is placed **before** the spread:
```js
const posts = await getJsonImpl(archiveUrl, {
  untrustedHost: true,
  ...jsonOpts,          // last-write-wins: can set untrustedHost: false
});
```
Because object spread is last-write-wins, `jsonOpts.untrustedHost` (if present)
silently **overrides** the guard to `false`. The adjacent comment claims the
ordering is chosen "so a test … cannot silently drop the SSRF guard" — that is
backwards; the current order is exactly what *permits* dropping it. Not
user-exploitable today (the registered handler calls `fetchSubstackArchive(publication)`
with no `jsonOpts`, and no test passes `untrustedHost`), so the production path
stays guarded — but this defeats the stated defense-in-depth and a future
caller/maintainer relying on the false comment could disengage the guard on the
one path that fetches a user-supplied host.
**Fix:** Spread first so the guard cannot be overridden, and correct the comment:
```js
const posts = await getJsonImpl(archiveUrl, {
  ...jsonOpts,
  untrustedHost: true,   // MANDATORY — must win over any caller opts (D-08)
});
```

### WR-03: a non-array archive 200 returns an empty envelope instead of degrading to the RSS window (D-10 miss)

**File:** `servers/rss/server.js:470-471` (`fetchSubstackArchive`)
**Issue:** The success branch does `(Array.isArray(posts) ? posts : []).map(...)`.
If the undocumented archive endpoint ever responds `200` with a non-array shape
(e.g. it starts wrapping results as `{ posts: [...] }`, or returns an object
error stub with a JSON content-type that passes the HTML gate), `posts` is not
an array → `results = []` → a **successful, empty** `count: 0` envelope is
returned. This is precisely an "archive failure" per D-10's intent, yet it does
**not** trigger the `catch` → RSS-window fallback (no throw occurred). The user
gets a silent "0 posts" for a real, active publication instead of the ~20-item
feed window the tool promises to degrade to.
**Fix:** Treat a non-array (or empty) archive body as a failure that falls
through to the RSS window — e.g. `if (!Array.isArray(posts) || posts.length === 0) throw new Error("archive: unexpected shape")`
inside the `try`, or restructure so the fallback runs when the archive yields no
usable array.

### WR-04: `filterAuthorPosts` query matches against un-stripped HTML markup

**File:** `servers/rss/server.js:323-342` (`filterAuthorPosts`), called at `server.js:573-574`
**Issue:** In the `rss_author_posts` handler the pipeline is
`normalizeFeed(...).map(markPreviewOnly)` → `filterAuthorPosts(...)` →
`buildListEnvelope(...)`. HTML stripping happens inside `buildListEnvelope` /
`normalizeItem`, which runs **after** `filterAuthorPosts`. So the `query`
substring test runs over `it.text` while it still contains raw HTML (tags,
attributes, `href` URLs, `<img src>`, inline CSS). A query like `img`, `span`,
`https`, or `href` matches markup that never appears in the stripped `text` the
caller ultimately receives — producing "matches" the user cannot see and cannot
reproduce by reading the output. The result set is inconsistent with the visible
contract text.
**Fix:** Filter against stripped text. Either apply `stripHtml` to the field
under test inside `filterAuthorPosts`, or reorder so filtering runs on the
normalized envelope items (post-`buildListEnvelope`) rather than the raw mapped
items.

## Info

### IN-01: archive success path skips `markPreviewOnly`, dropping the paywall signal

**File:** `servers/rss/server.js:470-471` vs `478`
**Issue:** The RSS-window fallback maps through `.map(markPreviewOnly)`, but the
archive success path does not. Paywalled archive posts therefore never receive
the `preview-only` tag on the enriched path. In practice the archive maps `text`
from `subtitle` (a short teaser that won't contain the "Read more" / "member-only"
markers `markPreviewOnly` keys on), so the marker is effectively moot here — but
the two paths are asymmetric and a future body-carrying archive field would
silently lose the signal.
**Fix:** For consistency, run archive results through `markPreviewOnly` too, or
document why the archive path intentionally omits it.

### IN-02: `mapAtomEntry` uses `entry.id` without `textOf` coercion

**File:** `servers/rss/server.js:181`
**Issue:** `id: String(entry.id ?? href ?? textOf(entry.title) ?? "")`. Same
object-materialization risk as WR-01: an Atom `<id>` carrying an attribute parses
to an object and `String(obj)` yields `"[object Object]"` as the item id. Lower
likelihood than WR-01 (Atom `<id>` rarely carries attributes) and less harmful
(id, not body), but it's the same latent pattern the phase set out to eliminate.
**Fix:** `id: String(textOf(entry.id) ?? href ?? textOf(entry.title) ?? "")`.

### IN-03: empty `tag` / empty Substack pub produce degenerate URLs

**File:** `servers/rss/server.js:350-352` (`resolveTagFeed`), `269-271` (`resolveAuthorFeed`)
**Issue:** `resolveTagFeed("")` (or whitespace-only) yields
`https://medium.com/feed/tag/` — a valid-but-wrong URL that will 404 as a
terminal error rather than being rejected up front. Similarly a bare
`".substack.com"` token in `resolveAuthorFeed` satisfies `endsWith(".substack.com")`
and yields `https://.substack.com/feed` (empty publication label), which fails
later at DNS/fetch. Both fail closed downstream (no security impact — the SSRF
guard and terminal-error paths hold), but an early, clearer validation error
would be friendlier than a generic HTTP failure.
**Fix:** Reject an empty/blank tag in `resolveTagFeed`, and require a non-empty
label before `.substack.com` in the Substack branch.

---

_Reviewed: 2026-07-14T07:20:12Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
