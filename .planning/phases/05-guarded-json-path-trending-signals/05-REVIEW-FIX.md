---
phase: 05-guarded-json-path-trending-signals
fixed_at: 2026-07-10T00:00:00Z
review_path: .planning/phases/05-guarded-json-path-trending-signals/05-REVIEW.md
iteration: 1
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 5: Code Review Fix Report

**Fixed at:** 2026-07-10T00:00:00Z
**Source review:** .planning/phases/05-guarded-json-path-trending-signals/05-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 3 (all WARNING — the 3 INFO findings IN-01/IN-02/IN-03 were intentionally left for a later pass)
- Fixed: 3
- Skipped: 0
- Full suite after fixes: **298 pass / 0 fail** (was 291; +7 new tests)

## Fixed Issues

### WR-01: `seThrottle` performed an unbounded, uncancellable real sleep

**Files modified:** `servers/stackexchange/server.js`, `test/stackexchange.test.js`
**Commit:** f8e8c39 (shared with WR-02 — same two files, interwoven regions)
**Applied fix:** Added a module constant `MAX_BACKOFF_MS = 30_000` and clamped the
honored wait to `Math.min(raw.backoff * 1000, MAX_BACKOFF_MS)`. A pathological or
stale-served `backoff` can no longer hang the MCP tool call — the wait now has a
30-second ceiling. The `quota_remaining === 0` error path and the normal
sleep-before-follow-up behavior are unchanged.
**Tests added:** clamp caps a `backoff: 100_000` at `30_000ms`; a small in-range
`backoff: 5` is honored exactly (`5000ms`) so legitimate waits are not shortened.

### WR-02: throttle was wired to the single-fetch caller, not the real double-fetch path

**Files modified:** `servers/stackexchange/server.js`, `test/stackexchange.test.js`
**Commit:** f8e8c39 (shared with WR-01)
**Applied fix:** Extracted the `so_get_question` question→answers logic into an
exported, dependency-injectable `fetchQuestionDetail({ id, site }, { get, sleep })`
helper and inserted `await seThrottle(raw, { sleep })` BETWEEN the question fetch and
the answers fetch — the genuine sequential path a self-inflicted throttle/ban can hit.
The `so_get_question` tool handler now delegates to this helper; its external behavior
(envelope shape, not-found guard) is unchanged. `so_unanswered`'s existing
single-fetch `seThrottle` call was left as-is (best-effort quota surfacing).
**Tests added:** the double-fetch path sleeps `2000ms` on a synthesized first-response
`backoff: 2` BETWEEN the two fetches (injected `get`/`sleep` spies); no sleep when the
first response carries no backoff; the CR-01 not-found guard still fires (and does not
sleep) when the question is absent.

### WR-03: a malformed redirect `Location` was misclassified as a retryable network error

**Files modified:** `shared/http_client.js`, `test/http_client.test.js`
**Commit:** 96e0521
**Applied fix:** In `fetchTextManual`, wrapped `new URL(loc, url)` in a try/catch. A
malformed `Location` (e.g. `http://` with no host) previously threw a raw `TypeError`
that both `getJson` (untrustedHost) and `getText` classified as `isNetwork` → retryable
(3 wasted retries + possible stale serve on the untrusted SSRF path). The parse now
throws a plain `Error` (`rss: invalid redirect Location [...]`), which is NOT a
`TypeError`/`RetryableError`/`AbortError` — so it is terminal, not retried, and not
served from stale, the same fail-closed disposition as an `assertSafeUrl` rejection.
**Tests added:** `getJson untrustedHost` and `getText` each treat a malformed redirect
`Location` (`http://`) as terminal — asserted `fetchImpl.calls === 1`, `sleep.waited ===
[]`, error message matches `/invalid redirect Location/i`, error is NOT a `TypeError`,
and a seeded stale entry is NOT served.

## Notes

- **Commit granularity:** WR-01 and WR-02 modify the same two files
  (`servers/stackexchange/server.js` and `test/stackexchange.test.js`) in interwoven
  regions, so they share a single atomic commit (f8e8c39); whole-file staging cannot
  cleanly separate them. WR-03 touches different files and is its own commit (96e0521).
- **Contract untouched:** No envelope/item field was added, renamed, or dropped; no new
  `process.env` reads; all HTTP still flows through `shared/http_client.js`. WR-01/WR-02
  keep the throttle signals out of the frozen envelope (verified by the existing OQ-1
  contract test).
- **Out of scope (not fixed this pass):** IN-01 (`rss:` error prefix on non-RSS tools),
  IN-02 (`raw?.hits`/`raw?.items` optional-chaining consistency), IN-03 (`devto_top` vs
  `devto_tag` `query` convention).

---

_Fixed: 2026-07-10T00:00:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
</content>
</invoke>
