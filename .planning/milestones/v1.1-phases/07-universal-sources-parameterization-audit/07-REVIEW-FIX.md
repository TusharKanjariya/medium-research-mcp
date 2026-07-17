---
phase: 07-universal-sources-parameterization-audit
fixed_at: 2026-07-14T00:00:00Z
review_path: .planning/phases/07-universal-sources-parameterization-audit/07-REVIEW.md
iteration: 1
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 7: Code Review Fix Report

**Fixed at:** 2026-07-14T00:00:00Z
**Source review:** .planning/phases/07-universal-sources-parameterization-audit/07-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 3 (the 3 Warnings; the 3 Info items IN-01/02/03 were out of scope)
- Fixed: 3
- Skipped: 0

**Test result:** full `node --test` suite green — **418 passed / 0 failed**
(baseline 412 + 6 new regression tests: 2 Discourse, 2 Mastodon, 2 http_client).

## Fixed Issues

### WR-01: Discourse `category` interpolated into the path without encoding or validation

**Files modified:** `servers/discourse/server.js`, `test/discourse.test.js`
**Commit:** e916d8a
**Applied fix:** Added a shared `CATEGORY_TOKEN` zod schema
(`z.string().regex(/^[a-z0-9-]+\/\d+$/i, …)`) and swapped both
`discourse_latest` and `discourse_top` from `category: z.string().optional()` to
`category: CATEGORY_TOKEN.optional()`. The MCP SDK validates the input schema
before the handler runs, so a `category` carrying `?`, `#`, `../`, or a stray `/`
is rejected up front with a clear `slug/id` message and never reaches the URL
builder. The legitimate `slug/id` form (the single `/` between slug and numeric
id) still passes — a blanket `encodeURIComponent` was deliberately avoided
because it would break that `/`. Two regression tests assert the malformed tokens
(`foo/bar?x=1`, `../../admin`, slug-only, trailing-slash, extra-segment,
fragment) are rejected and that `support/6` / `dev-help/123` / omitted are
accepted.

### WR-02: Mastodon handlers assume a JSON array — a non-array 200 body throws a raw `TypeError`

**Files modified:** `servers/mastodon/server.js`, `test/mastodon.test.js`
**Commit:** a44c6ce
**Applied fix:** Extracted the D-11 lockdown message into a private
`lockdownError(base)` helper (reused by `mapMastodonError`) and added an exported
`mapTimelineStatuses(arr, base)` that throws `lockdownError(base)` when the body
is not an array, otherwise maps via `mapMastodonStatus`. Both timeline handlers
(`mastodon_public`, `mastodon_hashtag`) now build results via
`mapTimelineStatuses(arr, base)` instead of `(arr ?? []).map(mapMastodonStatus)`.
Per the task, a non-array 200 body from a public timeline is treated as an
anonymous-access/lockdown signal and surfaces the SAME clear tool-level error as
the 401/422 path — never a raw `TypeError`. The trends tools were left as-is
(they keep their own D-10 empty-path handling). Two regression tests assert a
non-array body (`{error}`, `{}`, `null`, `"nope"`) yields the "disallows
anonymous reads" message (and is not a `TypeError`), and that an array body maps
normally.

### WR-03: Lemmy Bearer token is forwarded across cross-origin redirects

**Files modified:** `shared/http_client.js`, `test/http_client.test.js`
**Commit:** 9559f20
**Applied fix:** In `fetchTextManual` (the single shared fetch core all servers
funnel through) the per-hop `init` is now tracked in a mutable `currentInit`.
When a redirect target's origin (scheme/host/port) differs from the current hop's
origin, `currentInit` is replaced with a copy that has `Authorization` and
`Cookie` removed (via new `sameOrigin()` + `stripSensitiveHeaders()` helpers,
case-insensitive), mirroring browser fetch semantics. Same-origin redirects and
the non-redirect / malformed-redirect paths keep their existing behavior byte for
byte, and the injectable `fetchImpl`/`lookup` test seams are preserved. This
prevents a credentialed request (e.g. Lemmy's env Bearer) from being replayed to
a redirected cross-origin host — defense-in-depth complementing Phase 7's Lemmy
token host-gate. Two regression tests use the capturing fetch stub to assert the
second-hop request drops `Authorization`/`Cookie` on a cross-origin 302 (while
retaining a non-sensitive `X-Keep` header) and RETAINS `Authorization` on a
same-origin 302.

---

_Fixed: 2026-07-14T00:00:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
