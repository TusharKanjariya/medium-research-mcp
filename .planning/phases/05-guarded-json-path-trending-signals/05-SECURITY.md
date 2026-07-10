---
phase: 05
slug: guarded-json-path-trending-signals
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-07-10
---

# Phase 05 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Verified 2026-07-10 (State B — built from the four PLAN.md `<threat_model>` blocks;
> plan-time register, ASVS L1, block-on high). Mitigations confirmed present in code by
> L1 grep-verification, corroborated by the phase VERIFICATION.md (19/19) and 05-REVIEW.md.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| LLM/tool input → `getJson` host (untrustedHost path) | An instance host supplied via tool input (Lemmy now; Discourse/Mastodon in Phase 7) crosses into an outbound HTTP request on the shared chokepoint | Untrusted hostname/URL |
| Redirect `Location` → next hop | A 3xx `Location` from an upstream can point the next hop at an internal address | Untrusted redirect target |
| operator env (`LEMMY_INSTANCE`) → `getJson` host | An operator-set instance host is now also validated (belt-and-suspenders) | Semi-trusted hostname |
| LLM/tool input (query/tag/site/mode/days) → fixed-host trending URLs | User input populates query-string params only; hosts are module constants (`ALGOLIA`, `SE`, `DEVTO`), never user-supplied | Query-string values |
| SE quota/backoff state → tool behavior | Mishandling the upstream throttle signal can self-inflict an IP ban across ALL SE tools | Throttle/quota metadata |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-05-01 | Information Disclosure | `getJson` untrustedHost path (host resolving to 127.0.0.1 / 169.254.169.254) | high | mitigate | untrustedHost `getJson` routed through the existing `assertSafeUrl` `node:net` BlockList (loopback/RFC1918/CGNAT/link-local incl. 169.254.169.254/ULA/NAT64/IPv4-mapped), reused verbatim (`shared/http_client.js:303-304, :173`); IP-literal + DNS-resolved private targets rejected before any body read. Tests: `test/http_client.test.js` cases 1–3 | closed |
| T-05-02 | Tampering | `fetchTextManual` redirect follow on the JSON path | high | mitigate | Per-hop `assertSafeUrl` re-validation on every `Location` with `redirect:"manual"`, `MAX_REDIRECTS=5` (`shared/http_client.js:227-240`); a 302→169.254.169.254 is rejected, target never fetched. Tests: case 6 | closed |
| T-05-03 | Denial of Service | `getJson` content-type gate (200-HTML login page → `JSON.parse`) | medium | mitigate | Positive-HTML content-type gate before `JSON.parse` → terminal "login required / not JSON" error, non-retryable, not-stale (`shared/http_client.js:308-317`, `/html/i`). Tests: case 4 | closed |
| T-05-04 | Information Disclosure | `assertSafeUrl` (credentials-in-URL) | medium | mitigate | Reject `user:pass@host` (`u.username || u.password`) with a redacted error (`shared/http_client.js:181-186`). Tests: case 7 | closed |
| T-05-05 | Tampering | `assertSafeUrl` check-vs-connect gap (DNS-rebinding TOCTOU residual, formerly T-04-06) | low | accept | Re-accepted per D-06 + roadmap: local, single-user, personal-use tool — the only "attacker" is the LLM driving it. IP-pinning (SEC-03) deferred to v2+; documented at `shared/http_client.js:144-166`. Below block-on threshold (non-blocking) | closed |
| T-05-21 | Tampering | `hn_rising` URL construction (query-param injection) | low | mitigate | `encodeURIComponent(query)` + numeric-only Zod-validated `numericFilters`; fixed host constant `ALGOLIA` — no user-supplied host, no SSRF surface (`servers/hn/server.js`) | closed |
| T-05-31 | Denial of Service (self-inflicted) | SE quota exhaustion / `backoff` violation | medium | mitigate | Single-page window (`pagesize = min(limit*2,100)`, no paging); `seThrottle` honors `backoff` (sleep before any follow-up) and throws a set-`STACKEXCHANGE_KEY` error at `quota_remaining === 0` (`servers/stackexchange/server.js:126-127`); 15-min TTL cache dampens repeats; strict no-4xx-retry unchanged | closed |
| T-05-32 | Tampering | `so_unanswered` URL construction (tag/site injection) | low | mitigate | User input via `seUrl` → `URLSearchParams` (encodes values); fixed host constant `SE`; API key never enters cache key or error text (`redactUrl`, reused) | closed |
| T-05-41 | Tampering | `devtoTopUrl` construction (tag injection / invalid combo) | low | mitigate | `encodeURIComponent(tag)`; Zod validates `mode` enum + integer `days`; forbidden `rising`+`days` combo throws in the helper before any fetch (D-15); fixed host constant `DEVTO` (`servers/devto/server.js`) | closed |
| T-05-SC | Tampering | npm/dependency supply chain | low | accept | Zero new runtime dependencies this phase; `npm ci` reproduces the audited tree; no install step. No `[ASSUMED]`/`[SUS]`/`[SLOP]` packages — Package Legitimacy Gate N/A. Below block-on threshold (non-blocking) | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above `security_block_on` (high) count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-05-01 | T-05-05 | DNS-rebinding TOCTOU between `assertSafeUrl` check and undici connect. Local single-user personal-use tool; the only "attacker" is the LLM driving it. IP-pinning custom-lookup dispatcher tracked as SEC-03 (v2+). Documented at `shared/http_client.js:144-166` | Operator (per D-06 + roadmap Phase-5 instruction) | 2026-07-10 |
| AR-05-02 | T-05-SC | Zero new runtime dependencies introduced this phase; committed `package-lock.json` + `npm ci` reproduce the audited tree | Operator | 2026-07-10 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-10 | 10 | 10 | 0 | gsd-secure-phase (State B, ASVS L1, L1 grep-verification) |

**Notes:**
- Both high-severity threats (T-05-01 SSRF-to-internal, T-05-02 redirect-to-internal) are mitigated by reused, battle-tested v1.0 controls (`assertSafeUrl` + per-hop redirect re-validation) and verified present in code + covered by tests. Nothing blocks at ASVS L1 / block-on high.
- **Non-blocking robustness note (from 05-REVIEW.md, WR-03):** a malformed redirect `Location` at `shared/http_client.js:240` (`new URL(loc, url)` outside the guard's try/catch) throws a raw `TypeError` currently misclassified as a retryable network error. This is a robustness/wasted-retry issue, NOT an SSRF bypass — a malformed `Location` cannot resolve to and reach an internal host; `assertSafeUrl` still gates every valid redirect target. Tracked as an advisory code-review fix (`/gsd-code-review 5 --fix`), not an open threat.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-07-10
