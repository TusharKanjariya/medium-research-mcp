---
phase: 02-keyless-source-breadth
plan: 03
subsystem: api
tags: [mcp, graphql, hashnode, devto, forem, postJson, http-client, node-crypto, zod]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: shared/http_client.js getJson (cache/retry/stale), shared/contract.js envelope factories, servers/hn reference template
  - phase: 02-keyless-source-breadth (02-01/02-02)
    provides: Stack Exchange, Lobsters, Lemmy source servers proving the copy-the-HN-template pattern
provides:
  - "shared/http_client.js postJson() — POST + JSON body path reusing getJson's cache/retry/stale machinery with a body-aware (url+sha1(body)) cache key"
  - "servers/hashnode/ — Hashnode public GraphQL source server (SRC-04) over postJson"
  - "servers/devto/ — Dev.to Forem REST source server (SRC-05) over getJson"
affects: [phase-03, phase-04, any future GraphQL source, rss-source]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "postJson(): shared POST path that every future GraphQL source inherits (cache/retry/stale, no direct fetch)"
    - "Body-aware cache key url+sha1(JSON.stringify(body)) via node:crypto (no new dependency)"
    - "Detail-body override: mapXNode reused by mapXDetail which overrides text with the full body (brief/description -> markdown)"
    - "toTags() normalizer for a field that is an array on one endpoint and a delimited string on another"

key-files:
  created:
    - servers/hashnode/server.js
    - servers/hashnode/manifest.json
    - servers/devto/server.js
    - servers/devto/manifest.json
    - test/hashnode.test.js
    - test/devto.test.js
    - test/fixtures/hashnode-list.json
    - test/fixtures/hashnode-detail.json
    - test/fixtures/devto-list.json
    - test/fixtures/devto-detail.json
    - test/fixtures/devto-comments.json
  modified:
    - shared/http_client.js
    - test/http_client.test.js

key-decisions:
  - "Hashnode live endpoint corrected to https://gql.hashnode.com/public — the documented root now serves a Vercel web app; /public is the Cloudflare-fronted GraphQL origin"
  - "Hashnode fixtures built from the RESEARCH-cited GraphQL schema because the live origin returned a persistent Cloudflare 522 during execution (field names reactionCount/responseCount/tags[].slug asserted per A2)"
  - "postJson cache key folds the body via sha1 so two GraphQL queries to the same URL never collide; key stays a non-secret logical key (both sources are keyless)"
  - "Dev.to tag_list is an array on the list endpoint but a comma-separated string on the detail endpoint — toTags() normalizes both so the contract tags:string[] always holds"
  - "hashnode_trending accepts an optional tag slug and client-side-filters the featured feed on tags[].slug (FeedFilter.tags needs ObjectIds, Pitfall 5) — keeps the tool set at exactly three"

patterns-established:
  - "Shared POST path: GraphQL sources route through postJson, never fetch, preserving cache/retry/stale + the no-direct-fetch rule"
  - "GraphQL safety: query strings are fixed module constants; user input (id) flows only through variables, never string-concatenation"

requirements-completed: [SRC-04, SRC-05]

coverage:
  - id: D1
    description: "postJson() POST+JSON path reusing getJson's cache/retry/stale machinery with a body-aware url+sha1(body) cache key"
    requirement: SRC-04
    verification:
      - kind: unit
        ref: "test/http_client.test.js#postJson() issues a POST with a JSON string body and Content-Type application/json"
        status: pass
      - kind: unit
        ref: "test/http_client.test.js#two postJson() calls to the same URL with DIFFERENT bodies do not collide (both fetch)"
        status: pass
      - kind: unit
        ref: "test/http_client.test.js#postJson() serves a stale entry on total failure instead of throwing"
        status: pass
    human_judgment: false
  - id: D2
    description: "Hashnode GraphQL source server (SRC-04): trending (FEATURED feed + tag-slug filter), D-01 search, article detail; reactionCount->score, responseCount->num_comments"
    requirement: SRC-04
    verification:
      - kind: unit
        ref: "test/hashnode.test.js#mapHashnodeNode maps a feed node onto the exact contract fields"
        status: pass
      - kind: unit
        ref: "test/hashnode.test.js#hashnode server registers exactly hashnode_get, hashnode_search, hashnode_trending"
        status: pass
      - kind: other
        ref: "node -e guard: no fetch(/process.env, uses postJson, no query string-interpolation"
        status: pass
    human_judgment: true
    rationale: "Field maps are proven offline against fixtures, but the fixtures were built from the RESEARCH-cited schema (the live Hashnode origin was down with a Cloudflare 522). A human should confirm one live hashnode_trending/hashnode_get call against gql.hashnode.com/public once the origin is reachable, verifying the /public endpoint and the reactionCount/responseCount field names (A2)."
  - id: D3
    description: "Dev.to Forem REST source server (SRC-05): top-of-week, by-tag, D-01 search, article detail; public_reactions_count->score, comments_count->num_comments"
    requirement: SRC-05
    verification:
      - kind: unit
        ref: "test/devto.test.js#mapDevtoArticle maps a list article onto the exact contract fields"
        status: pass
      - kind: unit
        ref: "test/devto.test.js#mapDevtoDetail drops nested children (only the top level becomes comments)"
        status: pass
      - kind: unit
        ref: "test/devto.test.js#devto server registers exactly devto_get, devto_search, devto_tag, devto_top"
        status: pass
    human_judgment: false

# Metrics
duration: 25min
completed: 2026-07-02
status: complete
---

# Phase 02 Plan 03: Hashnode + Dev.to Source Servers Summary

**Shared `postJson()` GraphQL POST path (body-aware cache) plus two keyless content-platform servers — Hashnode over GraphQL and Dev.to over Forem REST — both conforming to the normalized output contract.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-02
- **Completed:** 2026-07-02
- **Tasks:** 3
- **Files modified:** 13 (11 created, 2 modified)

## Accomplishments
- Landed `postJson()` in the shared HTTP client — the POST path every future GraphQL source inherits — reusing getJson's cache/retry/stale loop with a body-aware `url+sha1(body)` cache key so distinct GraphQL queries to one URL never collide.
- Built the Hashnode server (SRC-04) entirely on `postJson` (never `fetch`): FEATURED-feed trending with an optional client-side tag-slug filter, a D-01 client-side search over the feed window, and single-article detail, with user input confined to GraphQL `variables`.
- Built the Dev.to server (SRC-05) on `getJson` with the Forem versioned Accept header: top-of-week, by-tag, D-01 search, and article detail with top-level comments (nested children dropped).
- Full suite: **137 tests pass** (103 baseline + 34 new), no regression.

## Task Commits

Each task was committed atomically:

1. **Task 1: postJson() shared POST path** - `24c79c8` (feat)
2. **Task 2: Hashnode GraphQL source server** - `63d81b3` (feat)
3. **Task 3: Dev.to Forem source server** - `8860d52` (feat)

## Files Created/Modified
- `shared/http_client.js` - Generalized `fetchWithTimeout` to an init object; added exported `postJson()` (POST + JSON body, shared cache/retry/stale, `url+sha1(body)` key via node:crypto).
- `test/http_client.test.js` - Added 7 postJson cases (cache hit, distinct-body no-collision, POST init shape, header merge, 5xx-retry, 4xx-no-retry, stale fallback).
- `servers/hashnode/server.js` - Hashnode GraphQL server; `mapHashnodeNode`/`mapHashnodeDetail`; three tools (trending/search/get) via postJson.
- `servers/hashnode/manifest.json` - Keyless `.mcpb` scaffold (empty user_config).
- `test/hashnode.test.js` - 14 offline field-map + registration units.
- `test/fixtures/hashnode-{list,detail}.json` - GraphQL feed/post payloads (built from the cited schema; see deviations).
- `servers/devto/server.js` - Dev.to Forem server; `mapDevtoArticle`/`mapDevtoDetail` + `toTags()`; four tools (top/tag/search/get) via getJson with the Forem Accept header.
- `servers/devto/manifest.json` - Keyless `.mcpb` scaffold (empty user_config).
- `test/devto.test.js` - 13 offline field-map + registration units.
- `test/fixtures/devto-{list,detail,comments}.json` - Real Forem payloads captured live.

## Decisions Made
- **Hashnode endpoint correction:** `https://gql.hashnode.com` (documented root) now returns a Vercel Next.js app shell for POST; probing revealed `https://gql.hashnode.com/public` as the Cloudflare-fronted GraphQL origin. The server uses `/public`. A control GraphQL API (trevorblades) confirmed POST GraphQL works from this environment, isolating the issue to the Hashnode endpoint, not the network.
- **postJson cache key** folds the request body via sha1 (node:crypto, no new dependency); the key remains a non-secret logical key (both sources keyless), preserving the cache-key hygiene invariant.
- **Dev.to `tag_list` shape divergence** (array on list, comma-string on detail) is normalized by `toTags()` so `tags: string[]` always holds — a correctness requirement for the detail envelope to parse.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected the Hashnode GraphQL endpoint to `/public`**
- **Found during:** Task 2 (Hashnode server) — live fixture capture attempt
- **Issue:** The plan/RESEARCH endpoint `https://gql.hashnode.com` now serves a Vercel HTML app shell for POST (server header `Vercel`), so a GraphQL client pointed at the root would break. Probing found `https://gql.hashnode.com/public` routing to a real (Cloudflare-fronted) GraphQL origin.
- **Fix:** Set `const HASHNODE = "https://gql.hashnode.com/public"` and documented the correction in the server header comment.
- **Files modified:** servers/hashnode/server.js
- **Verification:** A control GraphQL API returned valid JSON via POST from the same environment; only Hashnode root returned HTML. `/public` returned a Cloudflare 522 (origin timeout), confirming a real backend behind that path.
- **Committed in:** 63d81b3

**2. [Rule 2 - Missing Critical] `toTags()` normalizes Dev.to `tag_list`**
- **Found during:** Task 3 (Dev.to server) — live fixture inspection
- **Issue:** Dev.to returns `tag_list` as an array on `/articles` but as a comma-separated string on `/articles/{id}`. Mapping the raw value straight to `tags` would put a string where the contract requires `string[]`, failing detail-envelope validation.
- **Fix:** Added `toTags(a)` that returns the array as-is, splits a delimited string, falls back to `a.tags`, else `[]`.
- **Files modified:** servers/devto/server.js
- **Verification:** `test/devto.test.js` asserts the detail `tag_list` string normalizes to `["aie","gemma","ai"]`; detail envelope parses against the schema.
- **Committed in:** 8860d52

---

**Total deviations:** 2 auto-fixed (1 bug, 1 missing critical)
**Impact on plan:** Both were necessary for correctness against the live APIs; no scope creep. Tool sets, field maps, and contract conformance match the plan exactly.

## Issues Encountered
- **Hashnode origin outage:** `gql.hashnode.com/public` returned a persistent Cloudflare 522 (origin unreachable) throughout execution, so a fresh live capture was impossible. Hashnode fixtures were built from the RESEARCH-cited feed/post schema (Assumption A2: `reactionCount`/`responseCount`). This is flagged for human verification (coverage D2) — one live call once the origin is reachable will confirm the `/public` endpoint and the count-field names. Dev.to fixtures were captured live and are ground truth.

## Known Stubs
None — both servers are fully wired to their live APIs. Hashnode fixtures are schema-accurate placeholders for offline tests only (the server code hits the live endpoint at runtime); no runtime stub or hardcoded data path exists.

## User Setup Required
None — both servers are keyless (empty `user_config`); no external configuration required.

## Next Phase Readiness
- `postJson()` is available for any future GraphQL source (e.g. further content platforms in later phases).
- Five of the phase's source servers (SE, Lobsters, Lemmy, Hashnode, Dev.to) now share the contract; Phase 02 keyless-source-breadth deliverables SC-2 (Dev.to) and SC-4 (Hashnode) are met.
- **Residual verification:** confirm one live Hashnode call against `gql.hashnode.com/public` when the origin recovers (validates the endpoint + A2 field names).

---
*Phase: 02-keyless-source-breadth*
*Completed: 2026-07-02*

## Self-Check: PASSED

All 14 claimed files exist on disk; all 3 task commits (24c79c8, 63d81b3, 8860d52) present in git history. Full suite: 137 tests pass, 0 fail.
