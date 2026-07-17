---
phase: 05-guarded-json-path-trending-signals
reviewed: 2026-07-10T00:00:00Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - shared/http_client.js
  - servers/lemmy/server.js
  - servers/hn/server.js
  - servers/stackexchange/server.js
  - servers/devto/server.js
  - test/http_client.test.js
  - test/lemmy.test.js
  - test/hn.test.js
  - test/stackexchange.test.js
  - test/devto.test.js
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 5: Code Review Report

**Reviewed:** 2026-07-10T00:00:00Z
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

Reviewed the Phase 5 diff (base `f710b35`): the opt-in `untrustedHost` SSRF branch
in `getJson`, the `assertSafeUrl` credentials-in-URL rejection, Lemmy's move onto
the guarded path, and the three trending tools (`hn_rising`, SE `so_unanswered` +
`seThrottle`, extended `devto_top` + `devtoTopUrl`).

**The security-critical work is sound.** The `untrustedHost` branch reuses the
exact `fetchTextManual` → `assertSafeUrl` chokepoint that `getText` uses — no
forked guard — so the denylist, per-hop redirect re-validation, and credentials
rejection all apply uniformly. The content-type gate correctly fires on a
POSITIVE HTML signal only (does not over-reject `text/plain`-carrying JSON), fails
closed (terminal, not retried, not served from stale), and IP-literal blocked
hosts short-circuit before any DNS or fetch. Error text is redacted via
`redactUrl` and the SE cache key omits the API key (verified in `seUrl`). No
output-contract drift: `mapSeUnanswered` overrides `score` in place, `hn_rising`
keeps velocity as an ordering-only signal, and no envelope/item fields were
added, renamed, or dropped. The documented TOCTOU/DNS-rebinding residual and the
non-default-port allowance are accepted design decisions, not findings.

No BLOCKER-class defects were found. Three WARNING-level robustness gaps and three
INFO items remain.

## Warnings

### WR-01: `seThrottle` performs an unbounded, uncancellable real sleep

**File:** `servers/stackexchange/server.js:132-134` (called at `:323`)
**Issue:** `seThrottle` does `await sleep(raw.backoff * 1000)` with no upper
bound. In `so_unanswered` the default `realSleep` (a bare `setTimeout`) is used,
and this sleep runs AFTER `getJson` returns, so it is not covered by any
`AbortController`/`timeoutMs`. A response carrying a large `backoff` value (or a
stale-served payload whose old `backoff` field survives) hangs the MCP tool call
for `backoff` seconds with no ceiling and no cancellation — contrary to the
project's "a tool call never hard-errors / stays responsive" resilience posture.
While `api.stackexchange.com` is a trusted fixed host and normally emits small
backoffs, the code trusts an arbitrary response field to gate wall-clock time.
**Fix:** Clamp the wait, e.g.
```js
const MAX_BACKOFF_MS = 30_000;
if (typeof raw?.backoff === "number" && raw.backoff > 0) {
  await sleep(Math.min(raw.backoff * 1000, MAX_BACKOFF_MS));
}
```

### WR-02: `seThrottle` honors backoff only where there is NO follow-up request; the real follow-up path (`so_get_question`) is unthrottled

**File:** `servers/stackexchange/server.js:284` (second fetch in `so_get_question`)
**Issue:** `seThrottle`'s own contract states the wait must be honored "BEFORE any
follow-up SE request." The only caller is `so_unanswered`, which issues a SINGLE
fetch and never follows up — so the honored wait is effectively a no-op cost. The
one tool that DOES issue a sequential second SE request, `so_get_question` (fetch
question at `:276`, then fetch answers at `:284`), never calls `seThrottle`
between the two. If SE returns `backoff` on the first call, the immediate second
call can trip the very self-inflicted throttle/ban `seThrottle` exists to prevent.
The mechanism is wired to the wrong caller.
**Fix:** Call `await seThrottle(raw)` between the two `getJson` calls in
`so_get_question` (after the question fetch, before the answers fetch), and treat
`so_unanswered`'s single-fetch throttle as best-effort quota surfacing.

### WR-03: A malformed redirect `Location` is misclassified as a retryable network error

**File:** `shared/http_client.js:240`
**Issue:** In `fetchTextManual`, `new URL(loc, url)` is OUTSIDE `assertSafeUrl`'s
try/catch. A malformed `Location` header (e.g. `http://` with no host) throws a
raw `TypeError`, which both `getJson` (untrustedHost path) and `getText` classify
as `isNetwork = err instanceof TypeError` → retryable. The result is 3 wasted
backoff retries and, if a stale cache entry exists, a stale value served for what
is actually a malformed-response terminal condition. This is exactly the
untrusted-server scenario (`untrustedHost` / RSS), where a hostile upstream can
emit a garbage `Location`. It does not bypass the SSRF guard (it fails closed
eventually), but the error class is wrong and triggers needless retries/stale.
**Fix:** Wrap the redirect-target parse and surface a terminal (non-retryable)
error:
```js
let next;
try {
  next = new URL(loc, url).href;
} catch {
  throw new Error(`rss: invalid redirect Location [${redactUrl(url)}]`);
}
url = (await assertSafeUrl(next, { lookup })).href;
```

## Info

### IN-01: `assertSafeUrl` errors hardcode an `rss:` prefix now surfaced through non-RSS tools

**File:** `shared/http_client.js:178,186,191,199,204,213,245`
**Issue:** Every `assertSafeUrl`/`fetchTextManual` error is prefixed `rss:`. Now
that Lemmy (and any future `untrustedHost` getJson caller) rides this path, a
blocked Lemmy instance surfaces `rss: host X resolves to a blocked address`
through `lemmy_hot`/`lemmy_search`/`lemmy_post` — a misleading source label in a
tool result the LLM/consumer reads.
**Fix:** Use a neutral prefix (e.g. `ssrf:` or no source prefix) so the message is
not tied to the RSS server.

### IN-02: `hn_rising` / SE handlers assume `raw` is a non-null object

**File:** `servers/hn/server.js:235` and `servers/stackexchange/server.js:218,253,324`
**Issue:** `raw.hits ?? []` / `raw.items ?? []` dereference `raw` directly. If
`getJson` ever returns a JSON `null` or a non-object body (`raw.hits` on `null`
throws a `TypeError`), the handler crashes rather than returning an empty
envelope. Lemmy (`raw?.posts`) and Dev.to (`raw ?? []`) already use the safer
null-tolerant form. Low likelihood against the real Algolia/SE APIs, but the
inconsistency is a latent crash path introduced/extended in this phase.
**Fix:** Use optional chaining consistently: `(raw?.hits ?? [])`,
`(raw?.items ?? [])`.

### IN-03: `devto_top` sets `query: tag` while `devto_tag` sets `query: null` for the same conceptual tag filter

**File:** `servers/devto/server.js:195` vs `:223`
**Issue:** Both tools filter by a Dev.to tag, but `devto_top` reports the tag as
the envelope `query` while `devto_tag` reports `query: null`. Both are
contract-legal (query is `string | null`), but the inconsistency makes the
`query` field mean different things across two adjacent tools in the same server,
which can confuse the consuming skill's citation/ranking.
**Fix:** Pick one convention (e.g. always echo the tag as `query`, or always
`null` for tag-list tools) and apply it to both.

---

_Reviewed: 2026-07-10T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
