---
phase: 4
slug: rss-multiplier-output-proof
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on (high) severity
threats_open: 0
asvs_level: 1
created: 2026-07-03
---

# Phase 4 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Register authored at plan time (04-01..04-04 carry `<threat_model>` blocks).
> Verified at ASVS L1 (grep + behavioral) after the code-review pass — every
> mitigation is present in source and covered by a unit test. Block threshold: `high`.
> **This is the project's highest-risk phase: the RSS fetcher is the first server
> whose outbound host comes from untrusted tool input (SSRF), and the first to add
> a third-party runtime dependency.**

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Claude Desktop tool input → `rss_fetch` handler | The feed **URL** is untrusted tool input — the first time input selects the outbound host | Arbitrary URL |
| `rss_fetch` → `getText` (shared HTTP chokepoint) | The server performs NO direct fetch; every request flows through `getText`/`assertSafeUrl` | Validated URL |
| `getText` → arbitrary internet host | Outbound GET after SSRF validation + per-hop redirect re-validation | Public feed bytes |
| `RSS_ALLOWED_HOSTS` env → allowlist | Optional operator lock-down, read only via `rssAllowedHosts()` | Config (no secret) |
| npm registry → `node_modules` | New dependency `fast-xml-parser@^4.5.7` (+ `strnum@1.x`) | Third-party code |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-04-01 | Information Disclosure | getText → cloud metadata `169.254.169.254` | high | mitigate | `net.BlockList` `169.254.0.0/16` + resolve-and-classify every IP (`dns.lookup {all:true}`); rejects dotted + hex-mapped forms (verified) | closed |
| T-04-02 | Info Disclosure / Elevation | getText → loopback/RFC1918/CGNAT/ULA internal scan | high | mitigate | BlockList `127/8`,`10/8`,`172.16/12`,`192.168/16`,`100.64/10`,`::1`,`fc00::/7`, **and `::` (unspecified — CR-01 fix)** | closed |
| T-04-03 | Tampering / Info Disclosure | `file:`/`gopher:`/`data:`/`ftp:` scheme abuse | high | mitigate | Scheme allowlist: http/https only (verified rejects `file://`) | closed |
| T-04-04 | Information Disclosure | Public feed 302 → internal IP (redirect-to-internal) | high | mitigate | `redirect:"manual"` loop re-validating `assertSafeUrl` on every hop; bounded redirect count, fails closed | closed |
| T-04-05 | Information Disclosure | IPv4-mapped-IPv6 / alternate IP encoding bypass | medium | mitigate | Canonicalize `::ffff:` (dotted + WHATWG hex) + SIIT `::ffff:0:h:h` (WR-03 fix); `net.isIP`/BlockList, never string-compare | closed |
| T-04-06 | Information Disclosure | DNS rebinding (public→internal between validate and connect, TOCTOU) | low | **accept** | Documented residual (in-file "ACCEPTED RESIDUAL" block, WR-02); acceptable for a local single-user tool; IP-pinning noted as future hardening | closed (accepted) |
| T-04-07 | Denial of Service | Huge/slow body from an arbitrary host | medium | mitigate | Inherited per-attempt timeout; `rss_fetch` `limit` item cap | closed |
| T-04-08 | Information Disclosure | Credential/host leak in error text | low | mitigate | `redactUrl` (origin+path only) in all getText/assertSafeUrl errors | closed |
| T-04-09 | Denial of Service | XML entity expansion / "billion laughs" | medium | mitigate | fast-xml-parser resolves no external/DTD entities (verified `&lol9;` stays literal); `maxExpandedLength` (5 MB) + `maxExpansionDepth` (3) bounds; `limit` cap; fetch timeout | closed |
| T-04-10 | Tampering / Info Disclosure | Non-feed HTML (200) dereferenced as a feed | medium | mitigate | `normalizeFeed` root-detection guard throws a clear error rather than emitting junk | closed |
| T-04-11 | Information Disclosure | SSRF via the feed URL / redirect | high | transfer | Fully handled by `getText`/`assertSafeUrl` (04-01); `rss_fetch` does no direct fetch and cannot bypass it (grep-verified) | closed |
| T-04-12 | Tampering | Stored-XSS-ish HTML surfaced in `text`/`author` | low | mitigate | `stripHtml` via `normalizeItem`; author fields string-coerced via `textOf` (WR-01 fix — also prevents hard-error) | closed |
| T-04-SC | Tampering | `npm install fast-xml-parser` (supply chain) | high | mitigate | Blocking-human checkpoint (operator-confirmed via `npm view`) + `--ignore-scripts` + `npm ls` tree verification: exactly `4.5.7 → strnum@1.1.2`, no postinstall | closed |
| T-04-SC-2 | Tampering | Version drift to `fast-xml-parser@^5` (6+ new low-download sub-packages) | medium | mitigate | Pinned `^4.5.7` (legacy dist-tag); resolved tree verified as v4 | closed |

*Severity: critical > high > medium > low — only open threats at or above `high` count toward threats_open.*
*Disposition: mitigate · accept · transfer.*

**Behavioral verification (post code-review-fix):** `assertSafeUrl` REJECTS `http://[::]/`, `http://[64:ff9b::7f00:1]/` (NAT64), `http://169.254.169.254/`, `http://[::ffff:a9fe:a9fe]/`, `file:///…`, `http://127.0.0.1/`; ALLOWS legit reddit `.rss` + YouTube feeds. No `fetch(`/`process.env` in the RSS server (getText-only). Full suite 254/254 green. Dependency tree `fast-xml-parser@4.5.7 → strnum@1.1.2` only.

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-04-01 | T-04-06 | DNS-rebinding TOCTOU (resolve-check-then-connect) is not fully closed without IP pinning; acceptable for a local, single-user, personal-use MCP tool. Documented in-file; IP-pinning dispatcher noted as future hardening. | project owner | 2026-07-03 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-03 | 14 | 14 | 0 | /gsd-secure-phase (L1 + behavioral; register at plan time; post code-review-fix) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-07-03
