---
phase: 02-keyless-source-breadth
plan: 02
subsystem: source-servers
tags: [lobsters, lemmy, mcp-server, keyless, optional-auth, output-contract]
requires:
  - shared/contract.js
  - shared/http_client.js
  - shared/credentials.js (lemmyInstance)
  - shared/auth.js (lemmyJwt)
provides:
  - shared/credentials.js::lemmyInstance() (LEMMY_INSTANCE || https://programming.dev)
  - servers/lobsters/server.js (lobsters_hottest, lobsters_tag, lobsters_get, lobsters_search)
  - mapLobstersStory, mapLobstersDetail (exported field-map helpers)
  - servers/lemmy/server.js (lemmy_hot, lemmy_search, lemmy_post)
  - mapLemmyPost, mapLemmyDetail, bearerHeaders, lemmyAuthHeaders (exported helpers)
  - servers/lobsters/manifest.json (no user_config), servers/lemmy/manifest.json (optional LEMMY_* scaffold)
affects:
  - test/ (new lobsters + lemmy suites + 4 fixtures; +2 credentials cases)
tech-stack:
  added: []
  patterns:
    - copy-the-HN-folder source-server pattern proven on a plain-string author source (Lobsters) and an auth-wired source (Lemmy)
    - D-01 client-side substring search over the hottest window where the source has no full-text API (Lobsters)
    - conditional Authorization Bearer header via getJson's headers option — token when lemmyJwt() resolves, {} (anonymous) when null
    - lemmyInstance() defaulted-optional cred helper mirroring userAgent(); operator-set env is the ONLY outbound-host source (SSRF mitigation)
key-files:
  created:
    - servers/lobsters/server.js
    - servers/lobsters/manifest.json
    - servers/lemmy/server.js
    - servers/lemmy/manifest.json
    - test/lobsters.test.js
    - test/lemmy.test.js
    - test/fixtures/lobsters-list.json
    - test/fixtures/lobsters-detail.json
    - test/fixtures/lemmy-list.json
    - test/fixtures/lemmy-detail.json
  modified:
    - shared/credentials.js (lemmyInstance helper)
    - test/credentials.test.js (lemmyInstance default/override cases)
decisions:
  - "Lemmy authenticated reads require LEMMY_INSTANCE set explicitly (even to the default https://programming.dev) alongside LEMMY_USERNAME/LEMMY_PASSWORD, because lemmyCreds() only returns creds when all three are set; username/password alone degrade to anonymous reads with no error. Documented in both the manifest user_config field descriptions and all three lemmy tool descriptions, and asserted by tests."
  - "Lobsters author maps from the plain-string submitter_user (Pitfall 6 — the live API no longer nests it as {username})."
  - "Lemmy permalink maps from post.ap_id (the federation URL is the canonical cross-instance permalink); Lemmy posts carry no tags so tags is always []."
metrics:
  duration: ~15 min (continuation session; Task 3 + finalization)
  completed: 2026-07-02
  tasks: 3
  files: 12
  tests: 27 new across the plan (14 lemmy + 11 lobsters + 2 credentials; 103 total, all pass)
status: complete
---

# Phase 02 Plan 02: Lobsters + Lemmy Source Servers Summary

Delivered two source servers (SRC-02 Lobsters, SRC-03 Lemmy) plus the `lemmyInstance()` shared-cred prerequisite. Lobsters runs fully keyless with a D-01 client-side search over the hottest window; Lemmy reads the federated network anonymously on `programming.dev` (D-05) and auto-attaches an `Authorization: Bearer <jwt>` when `LEMMY_*` creds are present (D-06 — the phase's end-to-end auth exercise), degrading to anonymous with no hard error when they are not.

## What was built

- **`lemmyInstance()` in `shared/credentials.js`** (Task 1, commit `5326baf`) — a defaulted-optional helper mirroring `userAgent()`: returns `LEMMY_INSTANCE || "https://programming.dev"` (full base URL incl. scheme, no trailing slash) via the single `get()` accessor, so no server reads `process.env`. Operator-set env is the ONLY outbound-host source (SSRF mitigation T-02-02-SSRF). Two `test/credentials.test.js` cases (default + override).
- **`servers/lobsters/server.js` + manifest + tests** (Task 2, commit `f7db4ec`) — four tools over `https://lobste.rs` .json endpoints, no auth: `lobsters_hottest` (native trending D-07), `lobsters_tag`, `lobsters_get` (detail with comments), and `lobsters_search` (D-01 case-insensitive substring filter over the hottest window). `author` maps from the plain-string `submitter_user` (Pitfall 6). Empty `user_config`. 11 offline units over captured fixtures.
- **`servers/lemmy/server.js` + manifest + tests** (Task 3, commit `d6aad9c`) — three tools over the configured instance's Lemmy API v3: `lemmy_hot` (`/post/list?type_=All&sort=Hot`), `lemmy_search` (`/search?type_=Posts&listing_type=All`), `lemmy_post` (`/post` + `/comment/list`). `mapLemmyPost`/`mapLemmyDetail` map PostView/CommentView onto the contract (title from `name`, permalink from `ap_id`, `tags: []`). The conditional Bearer wire lives in exported pure helpers `bearerHeaders()` / `lemmyAuthHeaders()` and passes `{ headers }` to `getJson`. Manifest `user_config` scaffolds optional `LEMMY_INSTANCE` (non-sensitive) + `LEMMY_USERNAME`/`LEMMY_PASSWORD` (`sensitive: true`). 14 offline units (field maps, auth-wire decision, registration, tool-description + manifest auth-note assertions).

## Verification

- `node --test test/lemmy.test.js` → 14/14 pass; `node --test test/lobsters.test.js` → 11/11 pass; `node --test test/credentials.test.js` includes the two `lemmyInstance` cases.
- Full suite `node --test` → **103/103 pass**, no regression.
- Neither server's non-comment source contains `fetch(` or `process.env`; the Lemmy source wires `lemmyJwt()` → conditional `Bearer` header (guard `node -e` checks pass).
- Both servers pass the Universal Server Bar: tools register/callable each with an `outputSchema`, `map*()` unit-tested against real payloads, both envelopes parse the contract schemas (ARCHITECTURE §4), all HTTP via `getJson`, keyless/anonymous behavior correct.

## Deviations from Plan

None — plan executed as written. The two captured Lemmy fixtures (`test/fixtures/lemmy-{list,detail}.json`), left untracked by a prior interrupted session, were validated as well-formed Lemmy API v3 payloads (`{posts:[PostView]}` and `{post_view, comments:[CommentView]}`) and reused as specified rather than re-captured.

## Known Stubs

None.

## Threat Flags

None — the plan's `<threat_model>` covers all security-relevant surface: `encodeURIComponent` on the Lobsters `tag`/`id` and Lemmy `id` path/query segments and `URLSearchParams` for query values (T-02-02-URL); the Lemmy outbound host comes only from `lemmyInstance()` operator env, never a tool param (T-02-02-SSRF); the password is read only via `lemmyCreds()`, exchanged in-memory by `auth.js`, never logged, and marked `sensitive` in the manifest (T-02-02-CRED); missing creds degrade to anonymous with no hard error (T-02-02-AUTHFAIL); `limit` bounded `.min(1).max(50)` (T-02-02-DOS).

## Self-Check: PASSED

- Files exist: servers/lemmy/server.js, servers/lemmy/manifest.json, test/lemmy.test.js, test/fixtures/lemmy-{list,detail}.json, servers/lobsters/server.js, servers/lobsters/manifest.json, test/lobsters.test.js, test/fixtures/lobsters-{list,detail}.json — all FOUND.
- Commits exist: 5326baf (lemmyInstance), f7db4ec (Lobsters), d6aad9c (Lemmy) — all FOUND in git log.
