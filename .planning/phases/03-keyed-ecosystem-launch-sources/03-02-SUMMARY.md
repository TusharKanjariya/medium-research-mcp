---
phase: 03-keyed-ecosystem-launch-sources
plan: 02
subsystem: source-servers
tags: [librariesio, producthunt, source-server, required-credential, graphql, secret-free-cachekey, package, launch]
requires:
  - shared/contract.js (buildListEnvelope, buildDetailEnvelope, toolResult, TYPE package/launch)
  - shared/http_client.js (getJson, postJson)
  - shared/credentials.js (librariesIoParams, productHuntHeaders — both throw when unset)
  - "TYPE enum values package + launch (from 03-01 Task 1)"
provides:
  - "servers/librariesio/server.js: mapLibProject, requireLibProject, libUrl (secret-free cacheKey split), server"
  - "tools: librariesio_search, librariesio_get"
  - "servers/producthunt/server.js: mapPhPost, mapPhDetail, requirePhOk (GraphQL-errors guard), requirePhPost, server"
  - "tools: producthunt_launches, producthunt_get"
affects:
  - "Phase 4 (5+-source uniform-run proof) — Libraries.io + Product Hunt are now two of the seven servers"
tech-stack:
  added: []
  patterns:
    - "Query-param required key with secret-free cacheKey split (libUrl mirrors seUrl — Pitfall 3, T-03-04)"
    - "Required-credential-in-header/param throws BEFORE any request (librariesIoParams/productHuntHeaders — criterion 4)"
    - "GraphQL over postJson() with an explicit 200-with-errors guard (requirePhOk — Pitfall 4, T-03-07)"
    - "Single-entity-type servers (package / launch); num_comments null for packages"
    - "Null-safe score/num_comments preserving a legitimate 0 (?? not ||)"
key-files:
  created:
    - servers/librariesio/server.js
    - servers/librariesio/manifest.json
    - test/libraries.test.js
    - test/fixtures/libraries-search.json
    - test/fixtures/libraries-project.json
    - servers/producthunt/server.js
    - servers/producthunt/manifest.json
    - test/producthunt.test.js
    - test/fixtures/producthunt-posts.json
    - test/fixtures/producthunt-post-detail.json
  modified: []
decisions:
  - "score always maps dependents_count for Libraries.io (D-04) regardless of the request sort — uniform momentum signal, not sort-dependent"
  - "librariesio_search keeps query OPTIONAL (primary A2 branch: attempt broad most-depended); q param omitted entirely when absent so URLSearchParams never emits a literal q=undefined"
  - "Product Hunt query field set kept minimal (no description) — PH bills by query complexity; tagline is the only text field the mapper reads"
  - "libUrl builds authedQs AFTER publicQs, so librariesIoParams() throws before the URL is returned (required-cred fails loudly before any request)"
metrics:
  duration_min: 4
  tasks: 2
  files: 10
  tests_added: 33
  tests_total: 198
completed: 2026-07-02
status: complete
requirements: [SRC-07, SRC-08]
---

# Phase 03 Plan 02: Libraries.io + Product Hunt (Required-Credential Pair) Summary

The two required-credential source servers on the uniform contract: **Libraries.io**
(SRC-07 — most-depended packages, `dependents_count`->score, REST via `getJson()`)
and **Product Hunt** (SRC-08 — today/this-week launches, votes->score,
comments->num_comments, the one GraphQL server via `postJson()`). Both prove the
phase's core obligation (criterion 4): a missing required credential fails loudly
with a clear "set X" error, verified by a unit test — in contrast to GitHub's
optional PAT that degrades to anonymous.

## What Was Built

### Task 1 — Libraries.io server (`librariesio_search`, `librariesio_get`)
Copied the Stack Exchange template. Field map (`mapLibProject`):
- `dependents_count`->score (D-04, uniform regardless of request sort),
  `num_comments` null (n/a for packages), type `package`, id = composite
  `${platform}/${name}` (no numeric id), author null, `keywords`->tags,
  `latest_release_published_at` (already ISO-8601)->created_utc,
  `package_manager_url`->permalink with a `repository_url`/`homepage` url fallback.
- `libUrl(path, params)` is a DIRECT mirror of `seUrl`: the authed URL folds in the
  `api_key` from `librariesIoParams()`; the `cacheKey` deliberately OMITS `api_key`
  (and the literal `api_key=`), so the required key never enters the cache key or,
  via `http_client`'s `redactUrl`, a thrown error (Pitfall 3, WR-01, **T-03-04 —
  the phase's one `high` threat**). Because `librariesIoParams()` throws when the key
  is unset, calling `libUrl` with no key throws the clear `set LIBRARIESIO_KEY` error
  **before any request is built** (D-10, criterion 4).
- `librariesio_search({ query?, platform?, sort?, limit? })` -> `GET /search` with
  `platforms` (default npm, D-06 free passthrough), `sort` (z.enum of the 7 CITED
  valid values, default `dependents_count`), `per_page`; `q` included only when
  provided. `librariesio_get({ platform, name })` -> `GET /{platform}/{name}` with
  `encodeURIComponent`'d path segments, `comments: []`.
- `manifest.json`: required sensitive `librariesio_key`; no `build-mcpb.sh` (PKG-01/v2).

### Task 2 — Product Hunt server (`producthunt_launches`, `producthunt_get`)
The one GraphQL server. Field map (`mapPhPost`):
- `votesCount`->score, `commentsCount`->num_comments (D-05/D-07), type `launch`,
  `name`->title, `user.name ?? user.username`->author, `topics.edges[].node.slug`
  ->tags, `createdAt`->created_utc, `website`->url, `url`->permalink,
  `tagline`->text.
- Each handler POSTs a `{ query, variables }` body through `postJson(PH_GRAPHQL,
  { body, headers: productHuntHeaders() })` — the token rides ONLY in the
  Authorization header (never URL/cacheKey/logs, T-03-05), and `productHuntHeaders()`
  throws `set PRODUCTHUNT_TOKEN` before the call when unset (D-10, criterion 4).
- `requirePhOk(raw)` is called immediately after every `postJson`: a non-empty
  `raw.errors` array throws a clear error (joining the GraphQL messages) so a
  GraphQL 200-with-errors can never masquerade as a silent empty list (Pitfall 4,
  T-03-07). `raw.data?.posts?.edges ?? []` is read defensively only after the guard.
- `producthunt_launches({ period?, topic?, limit? })` -> `posts(order: VOTES,
  postedAfter: <startOfPeriodIso>, topic: <slug|null>, first: <limit>)`; period
  today (default, start of today UTC) | week (now − 7d). `producthunt_get({ id })`
  -> `post(id:){ ...fields comments(first:20){...} }` mapped to a detail envelope
  with top-level comments -> `comments[]`; `requirePhPost` guards a null post.
- `manifest.json`: required sensitive `producthunt_token`; no `build-mcpb.sh`.

## Live-Smoke Outcomes (three RESEARCH-flagged items)

**None of the three flagged live smokes could be run in this execution environment:
neither `LIBRARIESIO_KEY` nor `PRODUCTHUNT_TOKEN` is set here (verified at start), and
all are required-credential calls.** This is expected — the build/test path is fully
offline over fixtures (RESEARCH §Environment Availability). Each flagged item has a
documented in-plan fallback and is coded against the CITED primary branch:

1. **Libraries.io empty-`q` behavior (OQ2 / A2).** Coded the PRIMARY branch: `query`
   is optional and `q` is omitted when absent (broad most-depended list). **Unverified
   live** (no key). Documented fallback if the live API rejects an empty `q`: make
   `query` required — keyword-scoped most-depended still satisfies SRC-07, and the
   `sort`/`platform`/mapper surface is unchanged. Flip is a one-line schema change
   (`z.string().optional()` -> `z.string()`) plus always including `q`.
2. **Product Hunt `PostsOrder` member `VOTES` + `postedAfter` arg name (OQ4 / A1).**
   Coded the CITED names (`order: VOTES`, `postedAfter: DateTime`). **Unverified live**
   (no token). Documented fallback: if the live schema differs, adjust only the query
   string (variable names/enum member) — `mapPhPost` is unaffected because it reads
   response fields, not query arguments. `requirePhOk` would surface any such argument
   mismatch as a clear GraphQL error rather than a silent empty list, so a wrong arg
   name fails loudly during the phase Inspector gate.
3. **GitHub reactions inline (OQ1)** — not in this plan; resolved to the primary branch
   in 03-01.

The offline fixture tests fully cover both servers' field maps, envelope conformance,
the secret-free cacheKey, the GraphQL-errors guard, and the criterion-4 throws, so the
suite is green regardless of the live environment.

## Verification

- `node --test test/libraries.test.js` — **15/15** (map, dependents->score, keywords
  ->tags, url fallback, 0-preserving, HTML strip, list/detail envelopes, not-found
  guard, api_key-never-in-cacheKey, `set LIBRARIESIO_KEY` throw, registration +
  outputSchema, no-fetch/no-env).
- `node --test test/producthunt.test.js` — **18/18** (map, votes/comments->score/
  num_comments, slugs->tags, username fallback, 0-preserving, HTML strip, list/detail
  envelopes with comments[], `requirePhOk` GraphQL-errors throw, not-found guard,
  `set PRODUCTHUNT_TOKEN` throw, registration + outputSchema, no-fetch/no-env).
- `npm test` (full suite) — **198/198 green** (was 165 after 03-01; +15 +18), no
  regression across shared + seven servers.
- grep: `fetch(` = 0 and `process.env` = 0 in BOTH new servers; no `build-mcpb.sh` in
  either server dir.

## Deviations from Plan

None — plan executed exactly as written. Two within-discretion executor calls
(documented in frontmatter `decisions`): Libraries.io `score` maps `dependents_count`
uniformly (not sort-dependent), and the Product Hunt GraphQL selection omits the
unused `description` field to keep query complexity minimal (the mapper reads
`tagline` for `text`). Neither changes the contract or any acceptance criterion.

## Known Stubs

None. Both servers return live-mappable data over the real endpoints; the offline
tests exercise the field maps against captured-shape fixtures. The two required keys
having no fallback at runtime is the intended CRED-04 behavior (criterion-4 proof),
not a stub.

## Threat Flags

None beyond the plan's `<threat_model>`. Both hosts (`libraries.io/api`,
`api.producthunt.com/v2/api/graphql`) are fixed module constants (SSRF-safe, T-03-06);
the Libraries.io `api_key` is secret-free in the cacheKey (T-03-04) and redacted from
errors; the Product Hunt token lives only in the Authorization header (T-03-05); the
GraphQL-errors guard is in place (T-03-07). No package installs this phase (T-03-SC).

## For Downstream Plans

- All three Phase 3 servers now satisfy criterion 4 (required-credential proof for
  Libraries.io + Product Hunt; optional-PAT degrade for GitHub).
- Phase 4's 5+-source uniform-run proof can include `librariesio` and `producthunt`
  — both emit the uniform envelope and validate against the contract.
- **Phase Inspector gate (deferred to `/gsd-verify-work`):** with keys/token set,
  confirm the two live smokes above (Libraries.io empty-`q`; Product Hunt
  `VOTES`/`postedAfter`). `npm run inspect:librariesio` / `inspect:producthunt`
  scripts are not added (no `inspect:*` scripts exist in package.json yet — the CLI
  entry is `node servers/<name>/server.js`); adding the inspect script family is a
  packaging concern, not a criterion-4 blocker.

## Self-Check: PASSED

All 10 created files present on disk; both task commits (4a2ec01, b8d7cbb) present in
git history. Full suite 198/198 green.
