---
status: complete
phase: 03-keyed-ecosystem-launch-sources
source: [03-VERIFICATION.md]
started: 2026-07-02
updated: 2026-07-03
---

## Current Test

[testing complete]

## Tests

### 1. Libraries.io empty-query most-depended list (live API)
expected: With LIBRARIESIO_KEY set, call librariesio_search with NO query against the live API — it accepts an empty q and returns a most-depended package list (OQ2/A2 primary branch). If it rejects an empty q, apply the documented one-line fallback (make query required). Offline fixtures cover the map + envelope but cannot exercise the live empty-q contract.
result: pass
source: live-smoke
evidence: |
  Live call librariesio_search {limit:5}, no query, LIBRARIESIO_KEY set. Returned 5
  contract-shaped items — typescript (score 1,415,150), eslint, @types/node — sorted by
  dependents_count→score, type "package", num_comments null, url/permalink to npm, tags
  present. Empty `q` accepted by the live /search endpoint → OQ2/A2 primary branch confirmed,
  no fallback needed. libUrl kept the api_key out of the cache key.

### 2. Product Hunt GraphQL args resolve against the live schema (live API)
expected: With PRODUCTHUNT_TOKEN set, call producthunt_launches (period today) against the live PH v2 GraphQL endpoint — the query args order: VOTES, postedAfter, and topic resolve against the live schema and return launches (OQ4/A1/IN-02). A wrong arg/enum name surfaces loudly via requirePhOk (a clean GraphQL error, not a silent empty list); adjust only the query string per the documented fallback if so.
result: pass
source: live-smoke
evidence: |
  API Key+Secret exchanged for a bearer token via OAuth2 client_credentials
  (POST /v2/oauth/token). producthunt_launches ran with no GraphQL error (requirePhOk passed),
  so order: VOTES + postedAfter + topic all resolve against the live schema. period "week"
  returned 5 launches (Context.dev 628 votes / 126 comments, Fypro, Acti…) — votesCount→score,
  commentsCount→num_comments, type "launch"; topic passthrough "artificial-intelligence"
  filtered correctly. OQ4/A1/IN-02 confirmed, no query adjustment needed. (period "today"
  returned 0 only because it was early in the UTC day — not a defect.)

## Summary

total: 2
passed: 2
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

[none]
