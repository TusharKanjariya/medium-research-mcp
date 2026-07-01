---
phase: 01-foundation-credential-infrastructure
plan: 03
subsystem: credentials-auth
status: complete
tags: [credentials, auth, security, mcpb, node-test]
requires: [01-01]
provides:
  - shared/credentials.js
  - shared/auth.js
  - .env.example
  - servers/hn/manifest.json
affects: [phase-2-source-servers, phase-3-source-servers]
tech-stack:
  added: []
  patterns:
    - single-process.env-reader (ENV_VAR map as source of truth)
    - required-vs-optional credential split (requireCred vs degrading helpers)
    - one shared cachedToken() path for Reddit + Lemmy
    - token-only in-memory cache (password never persisted)
    - .mcpb user_config sensitive:true -> ${user_config.*} keychain injection
key-files:
  created:
    - shared/credentials.js
    - shared/auth.js
    - .env.example
    - servers/hn/manifest.json
    - test/credentials.test.js
    - test/auth.test.js
  modified: []
decisions:
  - "credentials.js is the sole process.env reader; ENV_VAR is the single source of truth for variable names"
  - "required creds (Libraries.io, Product Hunt) throw a clear 'set X' error; optional creds degrade to {}/undefined"
  - "Reddit grant resolves only when all four vars present (keyless otherwise); Lemmy needs instance+username+password"
  - "token cache holds { token, expires } only — password confined to exchange closure + request body"
  - "fetch injected into auth exchanges so node:test runs fully offline"
metrics:
  tasks: 3
  files_created: 6
  tests: 24
  completed: 2026-07-01
requirements: [CRED-01, CRED-02, CRED-03, CRED-04]
---

# Phase 1 Plan 03: Credentials + Auth Infrastructure Summary

Centralized secret handling for the whole server suite: `credentials.js` is the only
module that reads `process.env`, `auth.js` exchanges a username/password for a cached
token via one shared path (optional Reddit OAuth2 password grant + Lemmy 0.19 login)
with the password never logged/persisted/cached, and the `.env.example` + `.mcpb`
`user_config` keychain pattern are documented.

## What was built

- **shared/credentials.js** — `ENV_VAR` map (logical name → env var) as the single
  source of truth, and a private `get()` that is the only `process.env` access in the
  repo. Exports `requireCred` (throws `Missing credential: set <ENV_VAR>` for required
  sources), degrading fragments `stackExchangeParams`/`githubHeaders` (`{}` when unset),
  required fragments `librariesIoParams`/`productHuntHeaders` (throw when unset),
  `userAgent` (non-blank default), and `redditCreds`/`lemmyCreds` (resolve only when
  complete, else `undefined` to degrade to keyless).
- **shared/auth.js** — module-scoped `tokenCache` holding `{ token, expires }` only.
  `cachedToken(key, ttlMs, exchange)` is the single path both providers share.
  `redditToken()` runs the OAuth2 password grant (HTTP Basic via `Buffer`, real
  User-Agent, ~55 min TTL); `lemmyJwt()` runs the Lemmy login (~24h, returns jwt for a
  Bearer header). Both return `null` when creds are absent. `fetch` is injectable.
- **.env.example** — every ENV_VAR documented with required/optional comments and NO
  values, including the D-04 honesty caveat that the Reddit grant needs a script app.
- **servers/hn/manifest.json** — `manifest_version` 0.3 with `user_config` fields marked
  `"sensitive": true` mapped into `mcp_config.env` via `${user_config.*}`, plus the
  Claude Code plugin spawn gotcha noted in the description.

## Tasks

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 | credentials.js single process.env reader + helpers (TDD) | ffe265c |
| 2 | auth.js shared cached-token path (Reddit + Lemmy) (TDD) | 5e047af |
| 3 | .env.example + hn manifest.json keychain pattern | 45dc9dc |

## Verification

- `node --test` — 64/64 pass (24 new: 16 credentials + 8 auth); runs fully offline.
- `grep -rn "process.env" shared servers --include=*.js | grep -v credentials.js` —
  empty (single-reader rule holds; T-03-01 mitigated).
- `git check-ignore .env` — returns `.env`; only `.env.example` is tracked (T-03-04).
- Manifest verify command prints `manifest OK`.
- Password-absence assertions: tests confirm the password never appears in the cache
  entry (`{ token, expires }` only) nor in error messages (T-03-02 mitigated).

## Threat model coverage

| Threat ID | Disposition | Evidence |
| --------- | ----------- | -------- |
| T-03-01 (scattered process.env) | mitigated | grep confirms credentials.js is sole reader |
| T-03-02 (password leak) | mitigated | token-only cache; tests assert password absent from cache + errors |
| T-03-03 (plaintext secret in bundle) | mitigated | manifest user_config `sensitive:true` → keychain, `${user_config.*}` injection |
| T-03-04 (.env committed) | mitigated | .gitignore excludes .env; .env.example has names+comments only |
| T-03-05 (silent missing required cred) | mitigated | requireCred throws clear "set X"; optional sources degrade |
| T-03-SC (npm installs) | accepted | no new packages — Buffer/fetch/URLSearchParams built-ins only |

## Deviations from Plan

None — plan executed exactly as written. Both TDD tasks followed RED (failing test) →
GREEN (implementation); each task committed atomically.

## Known Stubs

The per-service helpers `stackExchangeParams`, `githubHeaders`, `librariesIoParams`,
`productHuntHeaders`, `redditToken`, and `lemmyJwt` are intentionally scaffolded now and
consumed by the source servers built in Phase 2/3 — this is the documented plan intent
(CRED-01 "defined now, consumed later"), not an unresolved stub.

## Self-Check: PASSED

- Files exist: shared/credentials.js, shared/auth.js, .env.example,
  servers/hn/manifest.json, test/credentials.test.js, test/auth.test.js — all present.
- Commits exist: ffe265c, 5e047af, 45dc9dc — all in git log.
