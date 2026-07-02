---
status: testing
phase: 02-keyless-source-breadth
source: [02-VERIFICATION.md]
started: 2026-07-02T00:00:00Z
updated: 2026-07-02T00:00:00Z
---

## Current Test

number: 1
name: Hashnode live-origin field confirmation (SC4 / SRC-04)
expected: |
  A live call to `hashnode_trending` (and `hashnode_get` on a real post id) against
  `https://gql.hashnode.com/public` returns contract-shaped results with `score`
  populated from the post's reaction count and `num_comments` from its response count,
  and trending-by-tag filters correctly on `tags[].slug`. This confirms the GraphQL
  field names (`reactionCount` / `responseCount` / `tags[].slug`) that offline fixtures
  were schema-derived for, because the origin returned Cloudflare 522 during execution.
awaiting: user response

## Tests

### 1. Hashnode live-origin field confirmation (SC4 / SRC-04)
expected: Live `hashnode_trending` + `hashnode_get` against `gql.hashnode.com/public` return contract items with reactions→`score` and responses→`num_comments`; trending-by-tag matches on `tags[].slug`. Confirms the field names the offline fixtures assumed (RESEARCH Assumption A2).
result: [pending]

### 2. Lemmy live authenticated read (SC3 / SRC-03, optional)
expected: With real `LEMMY_INSTANCE` + `LEMMY_USERNAME` + `LEMMY_PASSWORD` set, `lemmy_hot`/`lemmy_search`/`lemmy_post` perform an authenticated read — `lemmyJwt()` exchanges the username/password for a JWT and reads carry `Authorization: Bearer <jwt>`. The auth wire is proven offline (bearerHeaders(token)→`Bearer …`, bearerHeaders(null)→`{}`); this item confirms the real username/password→JWT exchange end-to-end. (Anonymous reads already work with no credentials.)
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
