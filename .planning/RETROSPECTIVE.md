# Retrospective: medium-research-mcp

Living retrospective across milestones. Newest milestone first.

## Milestone: v1.0 — MVP

**Shipped:** 2026-07-03
**Phases:** 4 | **Plans:** 12 | **Tasks:** 23 | **Timeline:** 3 days (2026-07-01 → 2026-07-03)

### What Was Built

Nine single-purpose MCP servers under one normalized output contract, plus the proof that the contract holds:

- **Foundation (P1):** TTL stale-retaining cache, a resilient `getJson()`/`postJson()` HTTP client (retry/backoff, never-retry-4xx, stale fallback), the Zod output-contract module (raw shapes + factories + single `toolResult` seam), env-only `credentials.js`, and `auth.js` token exchange — proven by the Hacker News reference server.
- **Keyless breadth (P2):** Stack Exchange (network-wide via `site`), Lobsters, Lemmy (auth path), Dev.to. (Hashnode built then dropped — upstream retired free GraphQL.)
- **Keyed sources (P3):** GitHub (trending repos + issue pain-point mining, optional PAT), Libraries.io + Product Hunt (required-credential pair; PH is the one GraphQL server).
- **RSS multiplier + output proof (P4):** SSRF-hardened `getText()` chokepoint, `rss_fetch` (RSS 2.0 + Atom 1.0 + subreddit `.rss` + YouTube recipes), and `mergeRank` — a branch-free 5+-source merge proven offline and demoed live across 6 sources.

**254 tests, 0 fail.** Runtime deps kept to `sdk` + `zod` + `fast-xml-parser@4`.

### What Worked

- **The contract-first design paid off literally at ship time:** OUT-02's `mergeRank` merged 6 real sources through one code path with zero `if (source===…)` — the thesis wasn't asserted, it was *executed* (live demo merged 60 items).
- **"Adding a source = field-mapping" held across wildly different APIs** — REST, GraphQL, federated, Search API, XML feeds — each server stayed near-pure `map*()` over shared infra.
- **Research-before-plan caught real blockers early:** the `TYPE`-enum gap (P3) and the `fast-xml-parser` v4-vs-v5 supply-chain trap (P4) were found in research, not in production.
- **Adversarial code review earned its cost on the security-critical phase:** it found a genuine Critical SSRF bypass (IPv6 `::` reaching loopback) that all unit tests had passed — fixed before completion.
- **Live smokes run in-session** (Libraries.io/Product Hunt in P3; the keyless uniform-run in P4) turned "human_needed" deferrals into verified-passed without waiting.

### What Was Inefficient

- **Traceability churn:** an executor prematurely marked SRC-09 complete after only the dependency install (P4); needed a manual correction. Requirement completion should be gated on the deliverable, not any plan touching the REQ id.
- **Discuss-phase questions repeatedly timed out** (user intermittently away) — resolved by capturing recommended defaults, but a couple of decisions (YouTube scope) needed a later correction round once the user weighed in.
- **Worktree isolation degraded every phase** (`origin/HEAD` unresolved), forcing sequential execution — fine at this scale but left parallelism on the table.

### Patterns Established

- **Shared chokepoint for cross-cutting concerns:** SSRF validation lives on `getText`, not per-server, so every future text source inherits it (`assertSafeUrl`).
- **Secret-free cache keys:** query-param credentials (SE `key`, Libraries.io `api_key`) split into an authed URL + a redacted `cacheKey` (`seUrl`/`libUrl`).
- **Blocking-human supply-chain gate** before any new dependency install (`--ignore-scripts` + `npm ls` tree verification).
- **Deferred live smokes → UAT convention:** credential-gated live checks land as `human_needed`, persisted to `*-UAT.md`, closed via `/gsd-verify-work` — not treated as failures.
- **Drop-don't-degrade:** a source that goes paid or breaks the keyless premise is dropped cleanly (Hashnode), never bent around the contract.

### Key Lessons

- The value of a uniform-output contract is only *proven* by a branch-free multi-source consumer — build that proof as an executable test, not a claim (OUT-02).
- A new third-party dependency is a security decision, not a convenience — gate it, pin it, and check the tree, especially on a repo with a prior malicious-package incident.
- Security controls need adversarial review even at 100% green tests: the `::` bypass shows unit tests confirm what you thought of, not what you didn't.

### Cost Observations

- Model mix: Opus throughout (orchestrator + all subagents).
- Sessions: ~1 continuous build session across 3 calendar days.
- Notable: research→plan→execute→review→verify per phase kept rework low; the only real rework was the YouTube-scope correction and the SRC-09 traceability fix.

## Cross-Milestone Trends

*(Populated as more milestones ship.)*

| Milestone | Phases | Plans | Tests | Deps added | Notable |
|-----------|--------|-------|-------|-----------|---------|
| v1.0 MVP | 4 | 12 | 254 | fast-xml-parser@4 | Contract proven live; 1 Critical SSRF caught in review |
