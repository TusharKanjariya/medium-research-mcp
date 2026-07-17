---
phase: 05-guarded-json-path-trending-signals
plan: 01
subsystem: shared-http
tags: [ssrf, security, getJson, lemmy, SEC-01]
requires:
  - shared/http_client.js assertSafeUrl + fetchTextManual (v1.0 getText guard)
provides:
  - getJson opt-in untrustedHost SSRF guard (the SEC-01 gating dependency for v1.1)
  - getJson content-type gate (HTML-200 -> terminal non-JSON error)
  - assertSafeUrl credentials-in-URL rejection
  - Lemmy's 3 (4-call) getJson sites on the guarded path
affects:
  - Phase 7 Discourse/Mastodon servers (they ride this guarded getJson path)
tech-stack:
  added: []
  patterns:
    - "Opt-in untrustedHost flag reuses the getText fetchTextManual->assertSafeUrl guard verbatim (no forked guard, D-02)"
    - "Positive-HTML content-type gate before JSON.parse (D-03)"
key-files:
  created: []
  modified:
    - shared/http_client.js
    - test/http_client.test.js
    - servers/lemmy/server.js
    - test/lemmy.test.js
decisions:
  - "Gate on a POSITIVE HTML content-type (/html/i) only — text/plain carrying valid JSON still parses (D-03, Pitfall 6)"
  - "Non-default ports are allowed; only the resolved IP decides rejection (D-05)"
  - "Lemmy handler-driving tests exercise the guard at the getJson layer (no injection seam through the registered tool wrapper, Pitfall 5)"
  - "SEC-03 DNS-rebinding TOCTOU residual RE-ACCEPTED, not implemented this phase (D-06)"
metrics:
  duration: ~15 min
  completed: 2026-07-10
  tasks: 3
  files: 4
status: complete
---

# Phase 5 Plan 1: Guarded JSON Path (SEC-01) Summary

Extended the v1.0 SSRF guard (previously only on the getText/RSS path) to a guarded
JSON path: `getJson` gains an opt-in `{ untrustedHost: true }` option that routes the
fetch through the existing `assertSafeUrl` denylist + per-hop redirect re-validation
(reused verbatim, no forked guard), adds a positive-HTML content-type gate so a
login-required HTML-200 fails closed instead of crashing `JSON.parse`, rejects
credentials-in-URL, and moves Lemmy's instance-parameterized calls onto that path.

## What was built

- **`shared/http_client.js`** — `getJson(url, opts)` now accepts `untrustedHost`
  (default `false`) and `lookup` (default `dnsLookup`). When `untrustedHost` is true
  the attempt loop calls `fetchTextManual(...)` (the same guarded fetch `getText` uses)
  instead of `fetchWithTimeout(...)`; a content-type gate immediately after
  `response.ok` rejects an HTML content-type with a terminal, non-retryable, not-stale
  error. `assertSafeUrl` now rejects any URL carrying `user:pass@host` (D-04). The
  no-flag path is byte-for-byte unchanged and never resolves DNS (D-01).
- **`test/http_client.test.js`** — added a `jsonRes(status, data, { ct, location })`
  response shim (headers.get) and 8 guarded-getJson cases: IP-literal metadata block,
  IP-literal loopback block, DNS-resolved private block, HTML content-type gate
  (reject + no-retry + no-stale), JSON pass-through, 302→internal redirect block,
  creds-in-URL reject, and the opt-in no-flag regression.
- **`servers/lemmy/server.js`** — `lemmy_hot`, `lemmy_search`, and both `lemmy_post`
  calls (4 call sites) now pass `untrustedHost: true`.
- **`test/lemmy.test.js`** — added a guarded-path test (public instance builds a valid
  `ListEnvelopeSchema` envelope) and a negative case (private-resolving instance is
  rejected with `/blocked address/`), driven at the getJson layer per Pitfall 5.

## Verification

- `node --check shared/http_client.js` and `node --check servers/lemmy/server.js` exit 0.
- `node --test test/http_client.test.js test/lemmy.test.js` → 71 pass, 0 fail.
- Full suite `node --test` → 271 pass, 0 fail (the `assertSafeUrl` creds-in-URL
  tightening did not break any getText/RSS or other server tests).
- `grep -c "untrustedHost: true" servers/lemmy/server.js` → 4 (>= 3 required).

## must_haves coverage

- SC-1 / T-05-01: untrustedHost getJson to 127.0.0.1 / 169.254.169.254 / private-
  resolving host rejected before any body read — Task 2 cases 1-3. ✔
- D-03 / T-05-03: HTML-200 → terminal "login required / non-JSON" error, not retried,
  not stale — Task 2 case 4; JSON pass-through preserved — case 5. ✔
- D-04 / T-05-04: `user:pass@host` rejected — Task 2 case 7 + assertSafeUrl guard. ✔
- T-05-02: 302→169.254.169.254 rejected, target never fetched — Task 2 case 6. ✔
- D-01: no-flag callers unchanged, zero DNS — Task 2 case 8 + all 47 prior
  http_client tests still green. ✔
- SEC-01: Lemmy's 3 getJson sites on the guarded path — Task 3. ✔
- D-05: non-default ports not rejected on port grounds (only resolved IP) — inherited
  verbatim from assertSafeUrl; no port/scheme restriction added. ✔
- D-06 / SEC-03: DNS-rebinding TOCTOU residual RE-ACCEPTED, not implemented — no
  IP-pinning dispatcher added. ✔

## Output contract

FROZEN contract untouched: no envelope/item field added, no TYPE enum value added,
`score`/`num_comments` not renamed. Lemmy changes are purely request-routing.

## Deviations from Plan

None — plan executed exactly as written. No auto-fixes (Rules 1-4) were needed; all
acceptance criteria held on first verification.

## Known Stubs

None.

## Threat Flags

None — no new security surface beyond the planned `<threat_model>` (the change tightens
existing surface; the creds-in-URL reject also hardens the getText/RSS callers).

## Self-Check: PASSED

All 4 modified files and the SUMMARY exist on disk; all 3 task commits
(e52a90e, fef75ce, 31a8fb7) are present in git history.
