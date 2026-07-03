# Milestone v1.0 — Project Summary

**Generated:** 2026-07-03
**Purpose:** Team onboarding and project review
**Status:** ✅ Shipped & tagged `v1.0` (2026-07-03)

---

## 1. Project Overview

**medium-research-mcp** is a suite of nine small, single-purpose **MCP servers** (Node) that each wrap one developer-community source's public API and emit the **same normalized JSON shape**. A downstream skill (`medium-blog-pro`) calls them in one pass to gather blog-topic research across many sources **with zero per-source logic**.

- **Sources covered:** Hacker News, Stack Exchange (network-wide), Lobsters, Lemmy, Dev.to, GitHub, Libraries.io, Product Hunt, and a generic **RSS/Atom fetcher** (which also covers subreddit `.rss` and YouTube channel/playlist feeds via documented recipes).
- **Core value — the one thing that must hold:** the **output contract**. Lists return `{ source, query, count, results[] }`; details return `{ source, item }`; every item has a fixed schema (`id, type, title, author, score, num_comments, created_utc, url, permalink, tags, text`). `score`/`num_comments` may be `null` but are **never renamed or dropped**. This is what lets the consumer rank, filter, and cite across sources without a single source-specific branch.
- **Origin:** replaces a single Reddit MCP that broke on Reddit's gates (app creation needs karma; reading a subreddit required joining). The multi-source design removes that single point of failure; Reddit read coverage is recovered via the subreddit `.rss` recipe.

**All 4 phases complete and verified.** 21 of 22 v1 requirements met; 1 dropped (Hashnode, upstream paywalled).

## 2. Architecture & Technical Decisions

The whole system is **shared infrastructure + thin per-source field-maps**. Adding a source is meant to be a mechanical copy — and it stayed that way across REST, GraphQL, federated, Search-API, and XML sources.

**Shared modules (`shared/`):**
- `cache.js` — in-memory ~15-min TTL cache with stale-entry retention.
- `http_client.js` — **all** HTTP: `getJson()`, `postJson()` (GraphQL, body-aware cache key), and `getText()` (RSS/XML). Retry/backoff (0.5s/1s/2s), never-retry-4xx, stale fallback, `redactUrl` for error text. **The SSRF guard (`assertSafeUrl`) lives here** so every arbitrary-URL source inherits it.
- `contract.js` — the linchpin: Zod raw shapes + `buildListEnvelope`/`buildDetailEnvelope`/`normalizeItem`/`stripHtml` + a single `toolResult` seam that emits both `structuredContent` and JSON-text `content`.
- `credentials.js` — the **only** module that reads `process.env`; per-service header/param helpers; required-key throws a clear "set X", optional-key degrades to anonymous.
- `auth.js` — username/password → cached token (Reddit grant, Lemmy login).
- `rank.js` — `mergeRank`, the branch-free multi-source merge (added in Phase 4).

**Key decisions (with rationale):**
- **One server per source over shared modules** — *Why:* adding a source stays mechanical; uniformity enforced by the contract, not the language. *Phase:* 1.
- **Normalized output contract is the linchpin** — *Why:* lets the consumer use any source with no per-source code. *Phase:* 1. *Proven:* Phase 4 `mergeRank`.
- **HTTP only through `http_client`, env only through `credentials`** — *Why:* caching/retry/stale + secret hygiene centralized; grep-enforced. *Phase:* 1.
- **Secret-free cache keys** (`seUrl`/`libUrl`) — *Why:* query-param credentials (SE `key`, Libraries.io `api_key`) must never enter the cache key or logs. *Phase:* 2–3.
- **Free-passthrough params over local whitelists** (SE `site`, Libraries.io `platform`, PH `topic`) — *Why:* upstream validates; no whitelist to maintain. *Phase:* 2–3.
- **Drop, don't degrade** — Hashnode (SRC-04) retired free GraphQL → dropped cleanly rather than bending the keyless premise. *Phase:* 2.
- **SSRF guard on the shared `getText` chokepoint** — *Why:* the RSS fetcher is the first server whose outbound host comes from tool input; centralizing protects every future text source. *Phase:* 4.
- **One vetted runtime dependency behind a human gate** — `fast-xml-parser@^4.5.7` (legacy major, not ^5; `strnum@1.x` sole transitive), installed `--ignore-scripts` with the tree verified. *Phase:* 4.
- **Drop the Python YouTube OCR wrapper; surface YouTube links via the RSS recipe** — *Why:* the user owns the OCR script and runs it manually; avoids a second runtime + supply-chain surface. *Phase:* 4.

## 3. Phases Delivered

| Phase | Name | Status | One-Liner |
|-------|------|--------|-----------|
| 1 | Foundation & Credential Infrastructure | ✅ Complete | Shared cache/HTTP/contract/credentials/auth, proven by the HN reference server. |
| 2 | Keyless Source Breadth | ✅ Complete | Stack Exchange, Lobsters, Lemmy (auth path), Dev.to — the copy-a-folder pattern at breadth. |
| 3 | Keyed Ecosystem & Launch Sources | ✅ Complete | GitHub (optional PAT), Libraries.io + Product Hunt (required-credential pair). |
| 4 | RSS Multiplier & Output Proof | ✅ Complete | SSRF-hardened `rss_fetch` (+ subreddit/YouTube recipes) and the branch-free 5+-source uniform-run proof. |

## 4. Requirements Coverage

**21 of 22 v1 requirements met; 1 dropped.** (Full table: `.planning/milestones/v1.0-REQUIREMENTS.md`.)

- ✅ FOUND-01..05 — cache, `getJson` client, output contract, HN server, dual-return (Phase 1)
- ✅ CRED-01..04 — env-only credentials, `auth.js`, `.env.example`/`.mcpb` keychain, required-vs-optional behavior (Phase 1)
- ✅ SRC-01, 02, 03, 05 — Stack Exchange, Lobsters, Lemmy, Dev.to (Phase 2)
- ❌ SRC-04 — Hashnode: **dropped 2026-07-02**, upstream retired free/keyless GraphQL (Pro plan required); conflicts with the keyless premise. Built + offline-tested, then removed.
- ✅ SRC-06, 07, 08 — GitHub, Libraries.io, Product Hunt (Phase 3)
- ✅ SRC-09 — generic SSRF-hardened RSS/Atom fetcher (Phase 4)
- ✅ OUT-01, 02, 03 — contract conformance, the 5+-source uniform run, LLM-trimmed output (Phases 1 & 4)
- ✅ YT-01 *(re-scoped)* — YouTube link surfacing via the RSS YouTube recipe; OCR/draft is the user's own manual step (Phase 4)

**Verification:** every phase passed goal-backward verification; the OUT-02 uniform-run demo is the cross-phase E2E proof (merged 60 items from 6 live sources). **254 tests, 0 fail.**

## 5. Key Decisions Log

Aggregated from phase CONTEXT.md `<decisions>`:

- **P2 D-01** — every source exposes a working `*_search`; where the API lacks real search, client-side substring filter over a fetched window (documented limitation).
- **P2 D-03/D-04** — SE `site` free passthrough (default `stackoverflow`); optional `STACKEXCHANGE_KEY`.
- **P2 D-05/D-06** — Lemmy anonymous default `programming.dev`; auto-auth via `auth.js` when `LEMMY_*` set (the auth proof).
- **P3 D-01/D-02** — GitHub split by entity: `gh_trending_repos` / `gh_search_issues` / `gh_get_item`; issues-first (Discussions/GraphQL deferred).
- **P3 D-04/D-06** — Libraries.io default sort `dependents_count`; `platform` passthrough (default `npm`).
- **P3 D-09** — GitHub issue reactions → `score` from the search-list `reactions.total_count` (no N+1); null-safe.
- **P4 D-01/02/03** — RSS SSRF: http/https-only scheme allowlist + private-range/redirect denylist + optional `RSS_ALLOWED_HOSTS`.
- **P4 D-04** — RSS is a single `rss_fetch(url)` tool (no `*_get`/`*_search`); the feed URL is the query.
- **P4 D-08** — `fast-xml-parser@^4.5.7` + hand-written RSS 2.0 / Atom normalize layer.
- **P4 D-13/D-14/D-15** — Python OCR wrapper dropped; YouTube = RSS recipe surfacing links; user runs own OCR manually.

## 6. Tech Debt & Deferred Items

**Accepted / deferred (tracked in STATE.md + ROADMAP.md):**
- **Accepted security residual (T-04-06):** DNS-rebinding TOCTOU on `getText` (resolve-check-then-connect) — acceptable for a local single-user tool; IP-pinning (undici custom-lookup dispatcher) is the v2 follow-up.
- **Deferred live smoke:** Phase 2 Lemmy authenticated read — needs `LEMMY_*` creds; `02-UAT.md` deferred, 0 pending scenarios.
- **Known advisory not remediated:** GHSA-gh4j-gqv2-49f6 affects `fast-xml-parser` **XMLBuilder** (serialization) — this project only *parses*, and the only fix is the v5 breaking upgrade D-08 rejects. Revisit if a 4.5.x+ patch ships.
- **Info-level review findings (deferred):** RDF feeds don't read `dc:date` for `created_utc`; the live demo depends on the SDK-internal `_registeredTools`.

**Deferred scope (v2 — start with `/gsd-new-milestone`):** Discourse (SRC-10), Mastodon (SRC-11), Bluesky (SRC-12), `.mcpb` one-click packaging (PKG-01), the SSRF IP-pinning hardening.

**Lessons (from RETROSPECTIVE.md):** the contract's value is only *proven* by a branch-free multi-source consumer (build it as a test); a new dependency is a security decision (gate/pin/verify); security controls need adversarial review even at 100% green tests — code review caught a real Critical IPv6 `::` SSRF bypass that all unit tests had passed.

## 7. Getting Started

- **Install & test:** `npm install` then `npm test` (254 node:test units, 0 deps beyond `sdk`/`zod`/`fast-xml-parser@4`).
- **Inspect a server:** `npm run inspect:hn` (MCP Inspector; mirror for other servers).
- **Key directories:**
  - `shared/` — read first: `contract.js` (the output shape), `http_client.js` (all HTTP + the SSRF guard), `credentials.js` (the only env reader).
  - `servers/<source>/server.js` — one per source; each is `getJson/postJson/getText → map*() → buildEnvelope → toolResult`. Start with `servers/hn/server.js` (the reference), then `servers/stackexchange/server.js` (optional-key pattern) and `servers/rss/server.js` (the XML + SSRF path).
  - `shared/rank.js` + `examples/uniform-run.mjs` — the OUT-02 branch-free merge and its live demo (`node examples/uniform-run.mjs`).
  - `test/` — `*.test.js` + `test/fixtures/` (recorded payloads).
- **Docs:** `docs/ARCHITECTURE.md` (§4 contract, §5 per-source `score`/`num_comments`, §6 credentials, §8 resilience), `docs/server-spec-template.md` (Universal Server Bar), `CLAUDE.md` (the "how to add a server" + DO-NOT-BREAK rules).
- **Where to look first for "how do I add a source?"** — copy `servers/hn/`, swap endpoints, write `map*()`, register the tools, add fixtures + a test. Everything else is inherited.

---

## Stats

- **Timeline:** 2026-07-01 → 2026-07-03 (3 days)
- **Phases:** 4 / 4 complete
- **Plans / tasks:** 12 plans, 23 tasks
- **Commits:** 116 (tagged `v1.0`)
- **Files changed:** 133 (+24,608 / −1)
- **Code:** ~3,392 LOC source (9 servers + 6 shared modules + examples) · ~3,742 LOC tests across 15 files · **254 tests passing**
- **Runtime deps:** `@modelcontextprotocol/sdk`, `zod`, `fast-xml-parser@4` (`+strnum`)
- **Contributors:** TusharRedlioDesigns (with Claude Code)
