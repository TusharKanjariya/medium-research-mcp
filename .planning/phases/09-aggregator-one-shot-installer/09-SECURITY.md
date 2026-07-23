---
phase: 09
slug: aggregator-one-shot-installer
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-07-23
---

# Phase 09 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Audited by gsd-security-auditor (verify-mitigations mode; register authored at plan time). Verdict: **SECURED**, 10/10 closed.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| aggregator process ↔ imported server modules | 11 modules loaded into one process; each could wrongly seize the shared stdio transport | JSON-RPC frames over stdio |
| aggregator ↔ upstream source APIs | inherited unchanged from the 11 servers (HTTP via `shared/http_client` getJson; creds via `shared/credentials`) — no new outbound boundary | source API requests/responses |
| installer CLI ↔ user's client config files | the only new file-write surface — reads/rewrites Claude/Cursor/Codex/OpenCode configs on the user's machine | client MCP config JSON/TOML |
| interactive prompt ↔ secret keys | user-pasted API tokens flow through readline into a plaintext config `env`/`environment` block | API tokens (secret) |
| CLI argv ↔ installer | `--client` / `--separate` / `--yes` flags are untrusted input | command-line flags |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-09A-01 | DoS | double stdio transport from an imported server | high | mitigate | aggregator imports only `registerTools`; single `.connect()` gated on `isEntry(import.meta.url)` (`servers/aggregator/server.js:57-58`, `shared/main.js:23-33`); 12/12 servers connect only when entry | closed |
| T-09A-02 | Tampering | silent tool drop/rename during 11-file wrap | high | mitigate | body-verbatim wrap; `test/aggregator.test.js` asserts exact 37-tool union + every prefix + full suite green | closed |
| T-09A-03 | Spoofing | tool-name collision across sources | low | accept | distinct D-01 prefixes; SDK `registerTool` throws on real dup; no collision code added (`server.js:41-55`) | closed |
| T-09A-SC | Tampering | supply-chain / new dependency | low | accept | `git diff …^ HEAD -- package.json`: `dependencies` unchanged; zero new packages | closed |
| T-09B-01 | Tampering | config corruption / loss of unrelated entries during merge | high | mitigate | backup-first timestamped copyFileSync **before** write (`bin/install.js:303-321`); parse-or-abort + set-only-our-keys JSON merge (`:56-79`); remove-then-append-only-our-tables TOML splice (`:159-176`); tests confirm unrelated entry/table survives + idempotent | closed |
| T-09B-02 | Tampering | secret with `"`/`\`/newline breaking JSON/TOML | high | mitigate | JSON via `JSON.stringify`; TOML via `escapeTomlString` (escapes `\`/`"`, rejects control chars, `:125-132`); quote-bearing-key test passes | closed |
| T-09B-03 | Info Disclosure | API key written plaintext to on-disk config | medium | accept | D-05 accepted trade-off; `PLAINTEXT_WARNING` printed on interactive path (`:326-328`,`:383`); keychain path deferred to `.mcpb` | closed |
| T-09B-04 | EoP / Input Validation | malicious/typo `--client` or unknown flag steering a write | medium | mitigate | `--client` validated against 4-value `CLIENT_IDS` allowlist; unknown flags rejected (`:285-293`); writes only to detected descriptor paths, never caller-supplied | closed |
| T-09B-05 | DoS | prompt hang in non-TTY/CI context | low | mitigate | `!process.stdin.isTTY` without `--client`/`--yes` → prints guidance, `exitCode=1`, returns before any prompt (`:425-437`); spawned test confirms | closed |
| T-09B-SC | Tampering | supply-chain / new dependency | low | accept | `dependencies` unchanged; installer imports only `node:fs/path/os/readline/promises` + `shared/main.js`; zero new packages | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-09-01 | T-09A-03 | Tool-name collisions cannot occur — D-01 source prefixes are distinct; a real dup makes SDK `registerTool` throw loudly at startup. No collision-handling code is warranted. | Phase 09 plan (09-01) | 2026-07-23 |
| AR-09-02 | T-09A-SC / T-09B-SC | Zero new runtime dependencies is a v1.2 project constraint; a new `dependencies` entry is a scope violation rejected at review. Verified unchanged via git diff. | Phase 09 plan | 2026-07-23 |
| AR-09-03 | T-09B-03 | Plaintext API keys in client config are the accepted D-05 trade-off for the all-at-once install goal; the installer prints a plaintext-vs-`.mcpb`-keychain warning. OS-keychain storage remains the deferred `.mcpb` path. | Phase 09 plan (09-02, D-05) | 2026-07-23 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-23 | 10 | 10 | 0 | gsd-security-auditor (ASVS L1, verify-mitigations) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-07-23
