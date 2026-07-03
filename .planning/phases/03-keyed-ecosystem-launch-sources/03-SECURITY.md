---
phase: 3
slug: keyed-ecosystem-launch-sources
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-07-03
---

# Phase 3 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Register authored at plan time (both 03-01 and 03-02 carry `<threat_model>` blocks).
> Verified at ASVS L1 (grep-depth) — every mitigation is present in the implementation
> and covered by a unit test. Block threshold: `high`.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Claude Desktop tool input → server handler | Untrusted query / language / labels / owner / repo / number / platform / sort / topic / period / id cross here | Untrusted tool arguments |
| server → api.github.com / libraries.io / api.producthunt.com | Outbound requests to FIXED module-constant hosts (`GH`, `LIB`, `PH_GRAPHQL`) | Public read requests |
| GITHUB_TOKEN (header) / LIBRARIESIO_KEY (query param) / PRODUCTHUNT_TOKEN (header) → request | Credentials enter only via `githubHeaders()` / `librariesIoParams()` / `productHuntHeaders()` | Secrets (never logged) |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-03-01 | Information Disclosure | githubHeaders() PAT | low | mitigate | PAT rides only in the `Authorization` header via `ghHeaders()` (server.js:59); `redactUrl` strips the query from every thrown error (http_client.js:38, used in all getJson/postJson error paths); never in URL/cacheKey/logs | closed |
| T-03-02 | Tampering/Info Disclosure (SSRF) | GitHub outbound host | medium | mitigate | `GH = "https://api.github.com"` module constant (server.js:48); tool input fills only the `q` string / encoded path segments, never the host | closed |
| T-03-03 | Tampering | passthrough qualifiers in `q` | low | mitigate | `encodeURIComponent` on composed `q` + owner/repo/number path segments; GitHub validates qualifiers server-side; `is:issue` filters PRs (list) and `requireGhIssueNotPr` rejects PRs on the detail path (WR-03) | closed |
| T-03-04 | Information Disclosure | Libraries.io api_key (query param) | high | mitigate | `libUrl` builds a SECRET-FREE cacheKey (`servers/librariesio/server.js:110`), api_key rides only in the authed URL; `redactUrl` strips it from errors; **unit test asserts api_key never in cacheKey** (`test/libraries.test.js:152`) | closed |
| T-03-05 | Elevation/Repudiation | required-cred bypass (unauth API call) | medium | mitigate | `librariesIoParams()` / `productHuntHeaders()` throw `Missing credential: set X` BEFORE any request when the env var is unset; unit-tested throws (`test/libraries.test.js:176`, `test/producthunt.test.js`) | closed |
| T-03-06 | Tampering/Info Disclosure (SSRF) | Libraries.io / Product Hunt outbound host | medium | mitigate | `LIB` and `PH_GRAPHQL` are module constants (librariesio:46, producthunt:51); platform/topic/sort are query/GraphQL VALUES sent to the fixed host, never host selectors; path segments `encodeURIComponent`-encoded (librariesio:196) | closed |
| T-03-07 | Correctness/DoS-ish | GraphQL 200-with-errors treated as success | low | mitigate | `requirePhOk(raw)` checks `raw.errors` and throws before reading `raw.data` on every postJson (producthunt.js:116, 200, 234); unit-tested | closed |
| T-03-SC | Tampering | npm installs (supply chain) | low | accept | No package installs this phase (RESEARCH Package Legitimacy Audit — zero new deps); no supply-chain surface to gate | closed (accepted) |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above `high` count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

**Cross-cutting invariants verified (grep):** no direct `fetch(` and no `process.env` in any of `servers/github`, `servers/librariesio`, `servers/producthunt` — all HTTP flows through `shared/http_client.js` and all credentials through `shared/credentials.js`. Full test suite: 203/203 green.

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-03-01 | T-03-SC | Zero new dependencies added this phase (RESEARCH Package Legitimacy Audit); no supply-chain surface exists to gate | project owner | 2026-07-03 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-03 | 8 | 8 | 0 | /gsd-secure-phase (L1 grep-depth, register authored at plan time) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-07-03
