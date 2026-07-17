---
phase: 08
slug: universal-distribution
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-07-17
---

# Phase 08 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Register authored at plan time (all 4 PLAN.md files carry a `<threat_model>`);
> verified at ASVS L1 (grep-depth), block-on = high. Distribution phase — no new
> data-API surface; the frozen SSRF/credential guards (SEC-01, CRED-04) apply unchanged.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| repo → npm registry tarball | `files` whitelist decides exactly what bytes get published | Source (public); must exclude .env / .planning / test |
| published package → client `node` | npx spawns `node servers/<name>/server.js`; shebang + isEntry() guard gate connect | Process spawn (no secrets at rest) |
| `.mcpb` user_config → OS keychain → server env | `sensitive:true` fields go to keychain and inject as env at spawn; non-sensitive fields land in plaintext host config | Credentials (secret) |
| manifest env declaration → server credential read | Manifest promises which secrets a server needs; a mismatch leaks an unused ref or starves a needed one | Credential references |
| lockfile → vendored node_modules in bundle | Whatever `npm ci` installs (and any postinstall) ships inside every `.mcpb` | Dependency code (supply chain) |
| build stage temp dir → `dist/` artifact | Anything left in the stage would be packed unless excluded | Build artifacts |
| docs → user's client config file | Copied snippets decide whether secrets land in plaintext client config vs keychain | Credentials (secret) |
| example script → live third-party APIs | Sweep fetches user-host instances (Discourse/Mastodon) over guarded getJson | Outbound requests (SSRF surface) |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-08-01 | Information disclosure | `files` whitelist in package.json | high | mitigate | `files` = servers/, shared/, docs/INSTALL.md, README.md only — no .env/.planning/test; `npm pack --dry-run` confirms (08-01-SUMMARY) | closed |
| T-08-02 | Elevation of privilege | bin shebang / entry guard | low | accept | Inert `#!/usr/bin/env node`; isEntry() only gates stdio connect, no new surface; frozen tool set | closed |
| T-08-03 | Information disclosure | credentialed user_config fields | high | mitigate | librariesio/producthunt/github/stackexchange + lemmy user/password all `sensitive:true` (keychain, masked); lemmy_instance (public URL) correctly not sensitive; D-05 test enforces | closed |
| T-08-04 | Tampering | vendored production node_modules | high | mitigate | `npm ci --omit=dev --ignore-scripts` from pinned lockfile — deterministic, dev-dep-free, no dependency postinstall runs into a bundle (scripts/build-mcpb.mjs verified) | closed |
| T-08-05 | Information disclosure | bundle contents | high | mitigate | `.mcpbignore` excludes test/, *.md, .planning/, .env, .env.*; Option-A stage copies only manifest + node_modules + shared/ + one server.js; secrets are keychain-only | closed |
| T-08-07 | Information disclosure | hn over-declared env refs | medium | mitigate | hn user_config {} + env block removed (reads no credentials); D-05 test enforces manifest env ⇒ imported-by-server (08-02-SUMMARY) | closed |
| T-08-08 | Denial of service | broken bundle shipped | medium | mitigate | Every stage gated by `mcpb validate` + a real MCP-initialize spawn test before pack; unresolvable ../../shared aborts the stage (scripts/build-mcpb.mjs verified) | closed |
| T-08-09 | Information disclosure | plaintext env blocks in client config | medium | mitigate | Docs steer Claude Desktop users to the `.mcpb` keychain path, mark client `env` blocks as plaintext-on-disk, use placeholder secrets only (08-04-SUMMARY) | closed |
| T-08-10 | Spoofing / SSRF | example fetches user-host instances | low | accept | Example calls `getJson(…, { untrustedHost: true })`; frozen SSRF guard (SEC-01) applies unchanged; instances are public constants, never tool input | closed |
| T-08-SC | Tampering (supply chain) | `@anthropic-ai/mcpb` tool + helper reuse | high | mitigate | Pinned exactly 2.1.2 in devDependencies ONLY (absent from runtime deps); invoked from local `node_modules/.bin/mcpb`, never global/npx-latest; verified Anthropic maintainers | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above high count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-08-01 | T-08-02 | Shebang is inert and isEntry() only gates the stdio connect — adds no new privilege surface; frozen tool set unchanged | RedlioDesigns | 2026-07-17 |
| AR-08-02 | T-08-10 | Example fetches only public example-constant instances through the frozen SSRF guard with `untrustedHost:true`; host is never tool input | RedlioDesigns | 2026-07-17 |
| AR-08-03 | T-08-SC (low variants) | ENV_VAR single-source (no second copy to drift) and example helper reuse add no new dependency or network/merge logic | RedlioDesigns | 2026-07-17 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-17 | 10 | 10 | 0 | gsd-secure-phase (orchestrator, ASVS L1) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-07-17
