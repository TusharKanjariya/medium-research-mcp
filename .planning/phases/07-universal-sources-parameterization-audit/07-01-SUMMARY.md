---
phase: 07-universal-sources-parameterization-audit
plan: 01
subsystem: shared-contract + lemmy-server
tags: [contract, type-enum, lemmy, instance-param, ssrf, bearer-host-gate, SEC-02]
requires:
  - shared/contract.js TYPE enum (append-only, Phase 3 tail)
  - servers/lemmy/server.js (guarded untrustedHost path, Phase 5)
  - shared/credentials.js lemmyInstance() + lemmyCreds()
provides:
  - contract TYPE values "topic" and "status" (unblocks Wave-2 Discourse/Mastodon)
  - Lemmy `instance` tool parameter (env is optional default)
  - host-gated Bearer (env token never replayed to a caller-chosen host)
  - exported seams normalizeInstance / authInstanceMatches / resolveLemmyHeaders
affects:
  - 07-02 (Discourse) — depends on "topic"
  - 07-03 (Mastodon) — depends on "topic"/"status"
  - 07-04 (SEC-02 parameterization audit) — Lemmy stays allowlist-clean
tech-stack:
  added: []
  patterns:
    - "append-only TYPE enum extension"
    - "normalizeInstance (scheme-default https, trailing-slash strip, no host guessing)"
    - "host-gated credential replay prevention (compare normalized hosts before attaching Bearer)"
    - "SSRF acceptance test via injected lookup on getJson({untrustedHost:true})"
key-files:
  created: []
  modified:
    - shared/contract.js
    - test/contract.test.js
    - servers/lemmy/server.js
    - test/lemmy.test.js
decisions:
  - "D-05/D-09: append \"topic\" (Discourse topics + Mastodon trending tags) and \"status\" (Mastodon statuses); Mastodon trending links reuse existing \"article\" — no new value"
  - "D-15/Open-Q3: send anonymous (drop env Bearer) when tool-param instance host != lemmyCreds().instance host; never replay LEMMY creds to a caller-chosen host"
  - "Kept lemmyAuthHeaders()/bearerHeaders() backward-compatible; added authInstanceMatches()/resolveLemmyHeaders() as the new host-gated seam so existing offline tests stayed green"
metrics:
  tasks_completed: 3
  files_modified: 4
  tests_added: 9
  full_suite: "353 pass / 0 fail"
  completed: 2026-07-14
status: complete
---

# Phase 7 Plan 01: Shared Foundation (TYPE append + Lemmy parameterization) Summary

Appended the two append-only contract TYPE values the Wave-2 servers need (`"topic"`, `"status"`) and turned Lemmy's instance into an optional per-call tool parameter with a host-gated Bearer so the env-minted LEMMY token is never replayed to a caller-chosen instance (SEC-02, D-15).

## What was built

- **`shared/contract.js`** — appended `"topic"` and `"status"` to the tail of the append-only `TYPE` enum, immediately after `"launch"`. The prior twelve values are unchanged in value and order. Mastodon trending links reuse the existing `"article"` type (D-09), so no value was added for links.
- **`servers/lemmy/server.js`** — parameterized the instance:
  - New exported `normalizeInstance(instance)` helper: trims, defaults a missing scheme to `https://`, strips trailing slashes, throws a readable host-literal-free error on empty input (D-13).
  - Added `instance: z.string().optional()` to `lemmy_hot`, `lemmy_search`, `lemmy_post`; each handler destructures `instance` and resolves `const base = normalizeInstance(instance ?? lemmyInstance())` — the tool param wins, the env value is the optional default only.
  - Host-gated Bearer (D-15): new exported `authInstanceMatches(base, {credsImpl})` (pure normalized-host compare against `lemmyCreds().instance`) and `resolveLemmyHeaders(base, opts)` (attaches the Bearer only on host match, else `{}`). The env JWT is never even resolved for a mismatched host. Every `getJson` call keeps its existing `untrustedHost: true` flag (SEC-01 guard unchanged).
  - Updated `AUTH_NOTE`/tool descriptions to document the `instance` override and the auth-only-on-matching-instance rule, preserving the `LEMMY_INSTANCE` mention the existing tests assert.
- **`test/contract.test.js`** — asserts `TYPE.includes("topic")` / `TYPE.includes("status")`, the append-only tail order (`["topic","status"]` after the prior twelve), and `ItemSchema` parsing of `topic`/`status` items.
- **`test/lemmy.test.js`** — added: `normalizeInstance` scheme-default/trailing-slash/empty-throw tests; `authInstanceMatches`/`resolveLemmyHeaders` host-match (Bearer) vs host-mismatch (anonymous, jwt never resolved) vs no-creds (anonymous) tests; generalized the SEC-01 guarded-path section for the user-supplied instance param with public-instance-OK plus private/loopback(127.0.0.1)/cloud-metadata(169.254.169.254) `/blocked address/` rejects.

## Design decision: keep the old auth seam, add a new gated one

The plan's Task 2 text described "making the auth-header resolution take the effective base and compare normalized hosts before calling `lemmyAuthHeaders()`". Rather than change `lemmyAuthHeaders()`'s signature (which the Phase-2 offline tests call as `lemmyAuthHeaders({ jwtImpl })`), the Bearer host-gate was implemented as a wrapper: `resolveLemmyHeaders(base)` calls `authInstanceMatches(base)` first and returns `{}` on mismatch, only calling the unchanged `lemmyAuthHeaders()` on a host match. This kept the existing `bearerHeaders`/`lemmyAuthHeaders` unit tests green while adding a cleanly injectable host-gated seam. This is a within-scope refinement of the plan's stated approach, not a deviation from its security intent (Bearer attached only when effective base host === `lemmyCreds().instance` host).

## Deviations from Plan

None — the plan executed as written. The wrapper-vs-signature-change note above is an implementation choice explicitly left to the executor ("Implement this by making the auth-header resolution take the effective base ... before calling lemmyAuthHeaders()"), and the acceptance criteria are all met.

## Known Stubs

None. No hardcoded empty values, placeholders, or unwired data paths were introduced.

## Threat surface

No new security surface beyond the plan's `<threat_model>`. T-07-03 (Bearer replay) is mitigated by `authInstanceMatches`/`resolveLemmyHeaders` + the host-mismatch test; T-07-01 (SSRF) is mitigated by the retained `untrustedHost: true` on all four calls + the private/loopback/metadata reject tests; T-07-05 (TYPE reorder) is mitigated by the append-only change + the additive tail-order test.

## Verification

- `node --test test/contract.test.js` → pass (24 tests).
- `node --test test/lemmy.test.js` → pass (25 tests; +9 added).
- `node --test` (full suite) → **353 pass / 0 fail** — the TYPE append and Lemmy changes regress no existing server test.

## For the next plan

- `"topic"` and `"status"` now validate in `structuredContent`; Wave-2 Discourse (07-02) and Mastodon (07-03) can map onto them directly.
- `normalizeInstance` exists in `servers/lemmy/server.js`; the new servers define their own copy per PATTERNS (no shared extraction was in scope here).
- SEC-02 audit (07-04): Lemmy source contains only the allowlisted `programming.dev` env default — no new non-allowlisted host literal was added.

## Self-Check: PASSED

- Files: `shared/contract.js`, `servers/lemmy/server.js`, `test/contract.test.js`, `test/lemmy.test.js` — all FOUND.
- Commits: `9da2062` (Task 1), `0298158` (Task 2), `8086c31` (Task 3) — all FOUND.
