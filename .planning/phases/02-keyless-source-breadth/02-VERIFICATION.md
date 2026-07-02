---
phase: 02-keyless-source-breadth
verified: 2026-07-02T00:00:00Z
status: passed
score: 4/4 must-haves verified
behavior_unverified: 0
overrides_applied: 1
override_note: "2026-07-02 orchestrator override (user-directed): phase marked passed with the single OPTIONAL human item (live Lemmy authenticated read) DEFERRED. The account created for the check (programming.dev) is stuck on admin 'Registration approval pending' — an external gate with an indeterminate wait, outside project control. The Lemmy auth path is proven offline (unit-tested login POST shape + Bearer-when-token/empty-when-null wiring) and the live 401 confirms the request reaches a real login endpoint and is handled cleanly. Re-run /gsd-verify-work 2 once an approved instance account exists to tick the live confirmation."
re_verification:
  previous_status: human_needed
  previous_score: 4/5
  scope_change: "SRC-04 (Hashnode) DROPPED 2026-07-02 — upstream retired free/keyless GraphQL (Pro required as of 2026-05-13), conflicting with the keyless/non-commercial constraint. Server + tests removed; ROADMAP success criteria renumbered (now 4). postJson() shared helper retained as generic infra (no server caller — intentional)."
  gaps_closed:
    - "SC4/SRC-04 Hashnode live-origin field-name confirmation — removed from scope entirely; the sole behavior-unverified truth is gone with the source."
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Set LEMMY_INSTANCE=https://programming.dev + LEMMY_USERNAME + LEMMY_PASSWORD for a real account, then call lemmy_hot."
    expected: "The read carries Authorization: Bearer <jwt> (auth.js lemmyJwt -> POST /api/v3/user/login exchange), returns contract-shaped posts, and degrades to anonymous with no error when creds are absent."
    why_human: "The auth-wire decision is proven offline (Bearer-when-token / empty-when-null, unit-tested), but a live authenticated read exercising the username/password exchange against a real instance requires real credentials + network. Optional confirmation — not a code defect."
---

# Phase 2: Keyless Source Breadth Verification Report (Re-verification)

**Phase Goal:** Fan out across the keyless (and optional-auth) sources, proving that adding a source is a mechanical copy of the Phase 1 pattern and that the contract holds across very different payloads.
**Verified:** 2026-07-02
**Status:** passed (orchestrator override — optional live Lemmy check deferred; blocked by external registration-approval gate, auth proven offline)
**Re-verification:** Yes — after SRC-04 (Hashnode) scope removal

## Scope Change

SRC-04 (Hashnode) was **dropped** on 2026-07-02: Hashnode retired free/keyless GraphQL access (Pro plan required for all queries as of 2026-05-13), breaking the "public, keyless" premise and conflicting with the project's keyless/non-commercial constraint. The Hashnode server and its tests were removed; ROADMAP success criteria were renumbered (5 → 4). This closes the single behavior-unverified item from the prior verification (the Hashnode live-origin field-name check) by removing it from scope rather than resolving it.

The absent `servers/hashnode/` directory is an intentional, documented removal — **not** a gap. REQUIREMENTS.md marks SRC-04 `Dropped (upstream paywalled 2026-05-13)`; ROADMAP marks it dropped in the Phase 2 requirements and criteria. The `shared/http_client.js` `postJson()` helper is retained as generic HTTP infra and now has no server caller — intentional, not a defect.

## Goal Achievement

### Observable Truths (renumbered ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Stack Exchange (`so_hot_questions`, `so_search`, `so_get_question`) work network-wide via `site`; use `STACKEXCHANGE_KEY` when present, keyless otherwise. | ✓ VERIFIED | `servers/stackexchange/server.js`: 3 tools register with outputSchema; `site` param (default `stackoverflow`) is a URLSearchParams passthrough; `seUrl()` spreads `stackExchangeParams()` (emits `key` ONLY when set) and keeps a secret-free `cacheKey`. Tests pass: `seUrl emits no key param when STACKEXCHANGE_KEY is unset (keyless degrade, CRED-04)`, `sends the API key in the request URL but NEVER in the cache key (WR-01)`, `registers exactly so_get_question, so_hot_questions, so_search`, `each tool declares an outputSchema`. |
| 2 | Lobsters (`lobsters_hottest`/`_tag`/`_get`) and Dev.to (`devto_*`) return contract-shaped results with no auth. | ✓ VERIFIED | `servers/lobsters/server.js` (4 tools) + `servers/devto/server.js` (4 tools). Neither imports `credentials.js`/`auth.js` (grep = 0). Both feed `map*()` into `buildListEnvelope`/`buildDetailEnvelope` (lobsters 5 list + 3 detail refs; devto 5 + 3). Tool names match ROADMAP exactly. |
| 3 | Lemmy (`lemmy_hot`/`_search`/`_post`) work on public reads and auto-authenticate when `LEMMY_*` is set, exercising the auth.js username/password path end-to-end. | ✓ VERIFIED | `servers/lemmy/server.js`: anonymous reads via `lemmyInstance()` default (programming.dev); every read calls `lemmyAuthHeaders()` → `bearerHeaders(await lemmyJwt())` and passes `{ headers }` into `getJson`. Auth chain `lemmyAuthHeaders`→`bearerHeaders`→`lemmyJwt` (auth.js POST `/api/v3/user/login`)→`lemmyCreds` (all 3 env vars required). `bearerHeaders(jwt)` returns `{ Authorization: Bearer … }`, `bearerHeaders(null)` returns `{}` (anonymous, no error) — unit-tested offline. Live authenticated read is an OPTIONAL human confirmation (see below). |
| 4 | All FOUR servers (Stack Exchange, Lobsters, Lemmy, Dev.to) pass the Universal Server Bar. | ✓ VERIFIED | All 4 register their exact ROADMAP tool names, each with an `outputSchema`; zero direct `fetch(` and zero `process.env` in server source (grep = 0/0); all HTTP via `getJson` (SE 8, lobsters 7, lemmy 8, devto 10 refs); envelopes via shared `buildListEnvelope`/`buildDetailEnvelope`; keyless/anonymous degradation proven (SE keyless test; lobsters/devto credential-free; lemmy anonymous default). |

**Score:** 4/4 truths verified (0 behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `servers/stackexchange/server.js` | SE server, 3 tools | ✓ VERIFIED | Wired, keyless-degrading, secret-free cache key. |
| `servers/lobsters/server.js` | Lobsters, 4 tools | ✓ VERIFIED | No credential imports; contract factories. |
| `servers/lemmy/server.js` | Lemmy, 3 tools + auth wire | ✓ VERIFIED | Conditional Bearer via getJson headers; anon default. |
| `servers/devto/server.js` | Dev.to, 4 tools | ✓ VERIFIED | No credential imports; Forem REST; contract factories. |
| `servers/hashnode/server.js` | (dropped) | ✓ REMOVED | Intentional scope removal; no residue in servers/shared/test. |
| `shared/http_client.js` `postJson()` | POST helper | ✓ VERIFIED (orphan by design) | Defined; no server caller after Hashnode removal — retained as generic infra per scope-change note. |
| `shared/auth.js` `lemmyJwt()` | username/password token exchange | ✓ VERIFIED | Reads `lemmyCreds()`; POSTs `/api/v3/user/login`. |
| `shared/credentials.js` `lemmyInstance()` | LEMMY_INSTANCE \|\| default | ✓ VERIFIED | Defaults programming.dev; reads only via `get()`. |

### Key Link Verification

| From | To | Via | Status |
|------|----|----|--------|
| lemmy/server.js | shared/auth.js `lemmyJwt` | `lemmyAuthHeaders`→`bearerHeaders`→`Bearer` on getJson headers | ✓ WIRED |
| lemmy/server.js | credentials.js `lemmyInstance` | `${base}/api/v3/...` | ✓ WIRED |
| all 4 map*() | contract.js factories | `buildListEnvelope`/`buildDetailEnvelope` | ✓ WIRED |
| stackexchange/server.js | credentials.js `stackExchangeParams` | `key` param only when set; omitted from cache key | ✓ WIRED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full offline suite | `node --test` | 140 pass / 0 fail (Hashnode's ~16 tests cleanly removed) | ✓ PASS |
| No direct fetch / process.env | grep server source | 0 / 0 across all 4 servers | ✓ PASS |
| SE keyless degrade | unit test | `seUrl` emits no `key` when unset | ✓ PASS |
| Lemmy auth-wire decision | unit test | Bearer-when-token / {} when null | ✓ PASS |
| No Hashnode residue | grep -i hashnode servers/ shared/ test/ | NONE | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
|-------------|-------------|--------|----------|
| SRC-01 (Stack Exchange) | 02-01 | ✓ SATISFIED | 3 tools, site param, optional key, tests pass. |
| SRC-02 (Lobsters) | 02-02 | ✓ SATISFIED | 4 tools, no auth, contract factories. |
| SRC-03 (Lemmy) | 02-02 | ✓ SATISFIED | 3 tools, anon reads + offline-proven auth wire. |
| SRC-04 (Hashnode) | 02-03 | ⊘ DROPPED | Intentional removal (upstream paywalled). Out of scope. |
| SRC-05 (Dev.to) | 02-03 | ✓ SATISFIED | 4 tools, Forem REST, no auth. |

All in-scope requirement IDs (SRC-01, -02, -03, -05) satisfied. SRC-04 correctly recorded as Dropped in both REQUIREMENTS.md and ROADMAP.md — no orphaned or contradictory traceability.

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| — | — | — | None. Prior `lemmy_username sensitive:false` warning is RESOLVED — manifest now sets `lemmy_username` and `lemmy_password` both `sensitive: true` (the `sensitive: false` entry is `lemmy_instance`, correctly not a secret). No TBD/FIXME/XXX debt markers in any of the 4 servers. |

### Human Verification Required

1. **Lemmy live authenticated read (SC3 / SRC-03, optional)** — with real `LEMMY_INSTANCE`+`LEMMY_USERNAME`+`LEMMY_PASSWORD`, confirm `lemmy_hot` attaches `Authorization: Bearer <jwt>` and returns contract-shaped posts; absent creds degrade to anonymous with no error. Offline wiring (Bearer-when-token / {} when null, and the `/api/v3/user/login` exchange path) is proven by unit tests; the live end-to-end exchange needs real credentials + network. Not a code defect — an external-service confirmation.

### Gaps Summary

No blocking gaps. With Hashnode dropped, all four remaining servers (Stack Exchange, Lobsters, Lemmy, Dev.to) exist, register their exact ROADMAP tool names each with an `outputSchema`, route all HTTP through the shared `getJson` (zero direct `fetch`, zero `process.env` outside credentials.js), assemble output via the shared contract factories, and degrade to keyless/anonymous. The full offline suite passes 140/140. The phase goal — mechanical copy-a-folder breadth with the contract holding across SE query params, Lobsters/Dev.to REST, and Lemmy federated + auth — is achieved in code across the (renumbered) four success criteria.

The single prior behavior-unverified item (Hashnode live-origin field-name check) is closed by the scope removal. One OPTIONAL human confirmation remains: the Lemmy live authenticated read, which depends on real credentials and a live instance and cannot be exercised offline. Because Step 8 produced this human item, overall status is `human_needed` — but every automated check passes and the goal is met in code. Note: REQUIREMENTS.md traceability is now consistent (SRC-01/-02/-03/-05 Complete, SRC-04 Dropped).

---

_Verified: 2026-07-02_
_Verifier: Claude (gsd-verifier)_
