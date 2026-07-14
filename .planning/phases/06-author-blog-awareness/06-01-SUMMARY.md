---
phase: 06-author-blog-awareness
plan: 01
subsystem: shared-http
tags: [medium, http_client, credentials, error-mapping, security]
requires: []
provides:
  - "getText host-gated Medium-403 clear terminal error (D-14)"
  - "userAgent() default bumped to medium-research-mcp/1.1"
affects:
  - shared/http_client.js
  - shared/credentials.js
tech-stack:
  added: []
  patterns:
    - "Host-gated error mapping inside the strict no-4xx-retry terminal branch"
    - "Boundary-safe hostname suffix match (exact or .medium.com sub-domain)"
key-files:
  created: []
  modified:
    - shared/http_client.js
    - shared/credentials.js
    - test/http_client.test.js
    - test/credentials.test.js
decisions:
  - "Medium 403 is host-gated and terminal — no retry, no stale — to avoid behaving like the bot the identified UA declares (T-06-02)"
  - "Used a boundary-safe host match (host === medium.com || endsWith .medium.com) rather than a raw endsWith('medium.com') so notmedium.com is not misclassified"
metrics:
  duration: ~15m
  completed: 2026-07-14
  tasks: 2
  files: 4
status: complete
---

# Phase 6 Plan 01: Medium-403 Fetch Hardening Summary

Host-gated a Medium `403` in `getText` to an honest "Medium is blocking automated
fetches" terminal error (no retry, no stale) and bumped the identified feed-reader
User-Agent from `medium-research-mcp/1.0` to `1.1` (D-14), so the 06-02 Medium
author/tag feed tools build on a robust, non-misleading fetch path.

## What was built

- **`shared/http_client.js`** — a host-gated `403` special case inside `getText`'s
  existing non-retryable 4xx terminal branch. When `status === 403` and the URL's
  host is a Medium host, `lastError` becomes a clear message naming Medium
  bot-blocking and suggesting another network; otherwise the verbatim
  `getText: HTTP 403 from <origin+path>` message is retained. Both paths keep
  `transientFailure = false` and `break` (terminal — no retry, no stale). Added a
  small `isMediumHost(url)` helper (boundary-safe suffix match, cannot throw on a
  malformed URL). `RETRYABLE_5XX`, the transient-failure gating, and the UA merge
  at line 537 were left untouched.
- **`shared/credentials.js`** — `userAgent()` default string version token bumped
  `1.0` -> `1.1`; the `get("userAgent") ||` env-override path and the repo-URL
  suffix are unchanged.
- **`test/http_client.test.js`** — six offline cases: Medium-403 mapping, no-retry
  (fetch called once), no query-string leak, `.medium.com` sub-domain mapping,
  non-Medium 403 keeps the generic message, `notmedium.com` boundary check, and
  no-stale-on-Medium-403.
- **`test/credentials.test.js`** — one case asserting the default UA contains
  `medium-research-mcp/1.1` and the repo URL.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Map Medium 403 to clear terminal error; bump UA to 1.1 | 221ad27 | shared/http_client.js, shared/credentials.js, test/credentials.test.js |
| 2 | Offline tests — mapping, no-retry, no-stale, host-gating | 853ff8b | test/http_client.test.js |

## Verification

- `node --test test/credentials.test.js` — 23 pass.
- `node --test test/http_client.test.js` — 63 pass (10 getText cases incl. 6 new).
- `npm test` (full suite) — 305 pass, 0 fail. No existing UA assertion pinned `1.0`.

## Deviations from Plan

None functionally. One intentional strengthening: the plan text described the host
gate as "hostname ends with `medium.com`"; the implementation uses a boundary-safe
match (`host === "medium.com" || host.endsWith(".medium.com")`) so a look-alike host
like `notmedium.com` is not misclassified as Medium. This is a security-correct
reading of the same intent (Rule 2 — correctness), covered by a dedicated test.

## Security / Threat Register

- **T-06-01 (info disclosure):** `redactUrl(url)` retained on the new Medium-403
  message — origin+path only. Asserted by a test that passes a `?token=SECRET` query
  and confirms neither `?` nor `SECRET` appear in the thrown message.
- **T-06-02 (self-inflicted IP ban):** the Medium-403 branch adds no retry loop and
  serves no stale — `transientFailure = false; break`. `RETRYABLE_5XX` untouched.
  Asserted by call-count (fetch runs exactly once) and a no-stale-on-403 test.

## Known Stubs

None.

## Self-Check: PASSED
