---
status: testing
phase: 02-keyless-source-breadth
source: [02-VERIFICATION.md]
started: 2026-07-02T00:00:00Z
updated: 2026-07-02T00:00:00Z
---

## Current Test

number: 1
name: Lemmy live authenticated read (SC3 / SRC-03, optional)
expected: |
  With real LEMMY_INSTANCE + LEMMY_USERNAME + LEMMY_PASSWORD set, lemmy_hot /
  lemmy_search / lemmy_post perform an authenticated read — lemmyJwt() exchanges the
  username/password for a JWT and reads carry Authorization: Bearer <jwt>. The auth
  wire is proven offline (bearerHeaders(token)->"Bearer …", bearerHeaders(null)->{});
  this item confirms the real username/password->JWT exchange end-to-end. Anonymous
  reads already work with no credentials.
awaiting: user response

## Tests

### 1. Lemmy live authenticated read (SC3 / SRC-03, optional)
expected: With real `LEMMY_INSTANCE` + `LEMMY_USERNAME` + `LEMMY_PASSWORD` set, `lemmy_hot`/`lemmy_search`/`lemmy_post` perform an authenticated read — `lemmyJwt()` exchanges the username/password for a JWT and reads carry `Authorization: Bearer <jwt>`. The auth wire is proven offline; this confirms the real username/password→JWT exchange end-to-end. (Anonymous reads already work with no credentials.)
result: [pending]

## Gaps

### Hashnode live-origin (SC4 / SRC-04) — VOIDED
The original UAT item #1 (Hashnode live-origin field confirmation) is void: **SRC-04 was dropped 2026-07-02**. Hashnode retired free/keyless GraphQL access (Pro plan required for all queries as of 2026-05-13), so the public-keyless premise no longer holds. The Hashnode server was removed from the codebase. No live check is needed.

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0
