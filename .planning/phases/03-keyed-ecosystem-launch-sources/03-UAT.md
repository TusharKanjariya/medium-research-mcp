---
status: testing
phase: 03-keyed-ecosystem-launch-sources
source: [03-VERIFICATION.md]
started: 2026-07-02
updated: 2026-07-02
---

## Current Test

number: 1
name: Libraries.io empty-query most-depended list (live API)
expected: |
  With LIBRARIESIO_KEY set, call librariesio_search with NO query (broad
  most-depended list) against the live API. The live Libraries.io /search
  accepts an empty q and returns a most-depended package list (OQ2/A2 primary
  branch). If it rejects an empty q, apply the documented one-line fallback
  (make query required).
awaiting: user response

## Tests

### 1. Libraries.io empty-query most-depended list (live API)
expected: With LIBRARIESIO_KEY set, call librariesio_search with NO query against the live API — it accepts an empty q and returns a most-depended package list (OQ2/A2 primary branch). If it rejects an empty q, apply the documented one-line fallback (make query required). Offline fixtures cover the map + envelope but cannot exercise the live empty-q contract.
result: [pending]

### 2. Product Hunt GraphQL args resolve against the live schema (live API)
expected: With PRODUCTHUNT_TOKEN set, call producthunt_launches (period today) against the live PH v2 GraphQL endpoint — the query args `order: VOTES`, `postedAfter`, and `topic` resolve against the live schema and return launches (OQ4/A1/IN-02). A wrong arg/enum name surfaces loudly via requirePhOk (a clean GraphQL error, not a silent empty list); adjust only the query string per the documented fallback if so.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
