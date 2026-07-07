# Codebase Concerns

**Analysis Date:** 2026-07-07

## Tech Debt

**Triplicated retry/stale loop in the HTTP client:**
- Issue: `getJson()`, `postJson()`, and `getText()` each carry a near-identical ~60-line attempt loop (backoff steps, RETRYABLE_5XX classification, strict no-4xx-retry, `transientFailure` gating, stale fallback). The policy is implemented three times.
- Files: `shared/http_client.js` (lines 253-333, 358-440, 469-546)
- Impact: Any change to the resilience policy (e.g., adding a Retry-After exception for 429, changing backoff steps, adding a new retryable status) must be made in three places; a partial edit silently forks the policy between verbs.
- Fix approach: Extract a single `attemptWithRetry(makeRequest, { cacheKey, ttlMs, sleep })` core that all three verbs delegate to; the extensive existing tests in `test/http_client.test.js` (717 lines) make this a safe refactor.

**`.mcpb` packaging is scaffold-only; CLAUDE.md describes files that don't exist:**
- Issue: Every `servers/*/manifest.json` exists, but no `build-mcpb.sh` exists anywhere in the repo. `servers/hn/manifest.json` itself states "Actual .mcpb packing is deferred to v2 (PKG-01); this manifest is documentation/scaffold only." Yet `CLAUDE.md` instructs "Add `manifest.json` (+ user_config) and `build-mcpb.sh`, mirroring `servers/hn/`" and lists `cd servers/<name> && ./build-mcpb.sh` as a command.
- Files: `CLAUDE.md`, `servers/hn/manifest.json`, all `servers/*/manifest.json`
- Impact: A contributor (or Claude instance) following CLAUDE.md will look for a template script that doesn't exist; the documented build command fails.
- Fix approach: Either ship the v2 `build-mcpb.sh` scripts (PKG-01) or update CLAUDE.md to mark packaging as deferred.

**CLAUDE.md references a nonexistent `inspect:hn` npm script:**
- Issue: `CLAUDE.md` lists `npm run inspect:hn` as a command; `package.json` `scripts` contains only `"test": "node --test"`.
- Files: `CLAUDE.md`, `package.json`
- Impact: Documented workflow command errors immediately.
- Fix approach: Add `"inspect:hn": "npx @modelcontextprotocol/inspector node servers/hn/server.js"` (and siblings), or remove the reference.

**Latent unused Reddit OAuth path:**
- Issue: `redditToken()` in `shared/auth.js` (lines 55-79) and the four `REDDIT_*` entries in `shared/credentials.js` `ENV_VAR` are imported by no server. There is no `servers/reddit/`; Reddit reads happen via the RSS recipe (`rss_fetch("https://www.reddit.com/r/<sub>/.rss")`), and the v1.0 roadmap explicitly lists "Reddit OAuth app path" as out of scope ("Still karma-gated; Lemmy + subreddit `.rss` replace it").
- Files: `shared/auth.js`, `shared/credentials.js` (lines 23-26), `servers/hn/manifest.json` (documents `reddit_client_secret` in user_config)
- Impact: Dead-but-tested code (`test/auth.test.js` covers it offline) that maintains a password-grant flow against an endpoint no tool exercises; Reddit could change the grant and nothing would notice. Also a slightly wider credential surface than the product uses.
- Fix approach: Either remove `redditToken()` + the reddit ENV_VARs, or keep with an explicit "reserved for v2" marker; do not build on it without a live smoke.

**Regex-based HTML stripping:**
- Issue: `stripHtml()` in `shared/contract.js` (lines 85-103) strips HTML with regexes and hand-decodes a fixed set of entities. Adequate for the "LLM-readable text" goal, but named entities beyond the hardcoded list (`&mdash;`, `&hellip;`, `&eacute;`, ...) pass through literally, and malformed markup (unclosed `<style`, attribute values containing `>`) can leave residue.
- Files: `shared/contract.js`
- Impact: Cosmetic noise in `text` fields for entity-heavy sources; every server inherits it since normalization is centralized.
- Fix approach: If it becomes a quality problem, extend the entity map or swap in a small decoding table — keep it dependency-free per the project's philosophy.

## Known Bugs

**`stripHtml` mangles astral-plane numeric entities (emoji):**
- Symptoms: A numeric character reference above U+FFFF — e.g. `&#128512;` (grinning face) or `&#x1F680;` (rocket) — decodes to a garbage character instead of the emoji, because `String.fromCharCode` truncates code points > 0xFFFF.
- Files: `shared/contract.js` lines 98-99 (`String.fromCharCode(Number(n))` and `String.fromCharCode(parseInt(h, 16))`)
- Trigger: Any source item whose HTML body encodes an emoji or other supplementary-plane character as a numeric entity (common in RSS bodies and forum posts).
- Workaround: None needed for ranking/filtering (only `text` cosmetics affected). Fix is one-word: use `String.fromCodePoint` in both replacers.

**RSS `content:encoded` bypasses `textOf()` object-collapsing:**
- Symptoms: In `mapRssItem`, `text: item["content:encoded"] ?? textOf(item.description) ?? null` reads `content:encoded` raw, while every other text-bearing field goes through `textOf()`. If a feed's `content:encoded` element carries an XML attribute, fast-xml-parser yields an object (`{ "#text": ..., "@_...": ... }`), and `normalizeItem` → `stripHtml` → `String(html)` renders it as `"[object Object]"`.
- Files: `servers/rss/server.js` line 152
- Trigger: An RSS feed whose `content:encoded` element has attributes (rare but valid XML). The same class of bug was already fixed for `author` (commit 62fee1e, WR-01) — this field was missed.
- Workaround: `textOf(item["content:encoded"])` — one-line fix matching the WR-01 pattern.

## Security Considerations

**TOCTOU / DNS-rebinding residual in the SSRF guard (accepted, documented):**
- Risk: `assertSafeUrl()` resolves-and-checks a host, but the subsequent fetch performs its own independent DNS resolution inside undici; a short-TTL resolver returning a public IP at check time and an internal IP at connect time is not fully closed.
- Files: `shared/http_client.js` lines 155-166 (documented as WR-02 "ACCEPTED RESIDUAL")
- Current mitigation: Per-hop redirect re-validation (`fetchTextManual`), private-range BlockList denylist incl. IPv4-mapped/SIIT/NAT64 encodings, optional `RSS_ALLOWED_HOSTS` lock-down mode. Accepted as low risk for a local, single-user tool.
- Recommendations: If this ever runs multi-tenant or server-side, pin the validated IP via a custom `lookup` on a per-request undici dispatcher, or re-check the peer IP post-connect. Setting `RSS_ALLOWED_HOSTS` is the available hardening knob today.

**Unbounded cache growth is attacker-influenceable via `rss_fetch`:**
- Risk: `shared/cache.js` never evicts ("Memory is unbounded... accepted per §8"), and `rss_fetch(url)` accepts arbitrary URLs from tool input — each unique URL caches a response body up to ~5 MB of expanded XML forever (entries are only overwritten, never deleted).
- Files: `shared/cache.js` (line 13), `servers/rss/server.js`, `shared/http_client.js` `getText`
- Current mitigation: Local single-user context; the only "attacker" is the LLM driving the tool; `maxExpandedLength: 5_000_000` bounds each entry; process restarts clear it.
- Recommendations: If sessions get long or the tool is shared, add an LRU cap (max entries) to `shared/cache.js` — one change covers every server.

**Reddit/Lemmy passwords held as environment variables:**
- Risk: The password-grant design (Reddit) and Lemmy login require `REDDIT_PASSWORD` / `LEMMY_PASSWORD` in env; env vars are readable by any same-user process.
- Files: `shared/credentials.js`, `shared/auth.js`
- Current mitigation: Passwords live only in the exchange closure and request body; the token cache stores `{ token, expires }` only (asserted by `test/auth.test.js`); `.mcpb` `user_config` marks secrets `"sensitive": true` for OS-keychain storage once packaging ships. `.env.example` documents names only.
- Recommendations: Keep as-is for personal use; prefer the keyless RSS Reddit recipe (already the live path).

**Supply-chain exposure via caret ranges:**
- Risk: `fast-xml-parser: ^4.5.7`, `zod: ^4.4`, `@modelcontextprotocol/sdk: ^1.29.0` auto-adopt minor/patch releases on a fresh `npm install`. fast-xml-parser passed an explicit supply-chain gate (phase 04-02) at 4.5.7 specifically.
- Files: `package.json`, `package-lock.json`
- Current mitigation: `package-lock.json` is committed, so `npm ci` reproduces the audited tree.
- Recommendations: Use `npm ci` (not `npm install`) in any setup docs; re-run the audit before bumping fast-xml-parser.

## Performance Bottlenecks

**Sequential double fetch in Stack Exchange detail:**
- Problem: `so_get_question` fetches `/questions/{id}` and then `/questions/{id}/answers` serially.
- Files: `servers/stackexchange/server.js` lines 231-246
- Cause: The answers fetch doesn't depend on the question body, only on the id — but it awaits the question first (reasonable, since the not-found guard avoids a wasted answers call).
- Improvement path: `Promise.all` the two `getJson` calls if detail latency ever matters; low priority — both are cached for 15 min.

**No genuine bottlenecks otherwise:** All servers are thin I/O wrappers over a 15-min TTL cache; payloads are capped by `limit` (max 50) and PH `comments(first: 20)`. The design goal (cached research bursts, not real-time) is met.

## Fragile Areas

**Product Hunt GraphQL query shape is unverified-by-tests against the live schema:**
- Files: `servers/producthunt/server.js` (lines 190-194: `posts(order: VOTES, postedAfter: $after, topic: $topic, first: $n)`)
- Why fragile: The comment at line 188 admits the `PostsOrder`/`postedAfter` argument names were cited from docs "— confirm against the live PH GraphQL explorer". A silent PH schema change returns HTTP 200 `{ errors: [...] }`; `requirePhOk()` will surface it clearly, but only at call time.
- Safe modification: Keep `POST_FIELDS` minimal (PH bills by query complexity); always route through `requirePhOk` + `requirePhPost` after `postJson`.
- Test coverage: Offline fixtures only (`test/producthunt.test.js`); no scheduled live smoke.

**Contract `TYPE` enum is append-only by convention:**
- Files: `shared/contract.js` lines 28-41
- Why fragile: `toolResult()` output is validated against `z.enum(TYPE)` in every server; removing or reordering a value breaks all existing servers' output validation. The invariant is enforced only by a comment ("APPEND-ONLY").
- Safe modification: Add new types at the END of the array only; never rename/remove `score`/`num_comments` in `itemShape`.
- Test coverage: `test/contract.test.js` validates shapes; no test asserts the enum's ordering stability.

**Strict no-429-retry means rate-limited keyless mode hard-errors:**
- Files: `shared/http_client.js` (lines 11-13, 300-305 and twins)
- Why fragile: A 429 (and any 4xx) is terminal — no retry, no stale fallback (deliberate per ARCHITECTURE §8, WR-04). Anonymous GitHub search allows 10 req/min; keyless Stack Exchange has a small daily quota; a burst research run in keyless mode can turn later tool calls into hard errors even when a stale cache entry exists.
- Safe modification: The policy is intentional and documented — if it proves painful in practice, the change belongs in ONE extracted retry core (see Tech Debt), not patched per-verb. Setting `GITHUB_TOKEN`/`STACKEXCHANGE_KEY` is the intended mitigation.
- Test coverage: Good — `test/http_client.test.js` asserts 4xx is never retried and never served stale.

**MCP SDK raw-shape coupling:**
- Files: every `servers/*/server.js`, `shared/contract.js` (exports both raw shapes and compiled schemas)
- Why fragile: At SDK 1.29.0, `registerTool` expects a RAW Zod shape (plain object of fields), NOT `z.object(...)` — a documented pitfall repeated in every server. An SDK minor bump (caret range) that changes this expectation breaks every tool registration at once.
- Safe modification: Pass `itemShape`/`listEnvelopeShape`/`detailEnvelopeShape` (raw) to `registerTool`; use `ItemSchema` etc. only for runtime `.parse()`. Pin/verify the SDK version when bumping.
- Test coverage: Every `test/<source>.test.js` confirms tools register, which would catch a break.

**`.mcpb` user_config env injection on the Claude Code plugin path:**
- Files: `servers/hn/manifest.json` (KNOWN GOTCHA note)
- Why fragile: `${user_config.*}` env refs work in Claude Desktop but a bundled server "can silently fail to spawn" via the Claude Code plugin path.
- Safe modification: When PKG-01 lands, verify with `claude mcp list` after install.

## Scaling Limits

**In-memory TTL cache:**
- Current capacity: Unbounded `Map`; entries never deleted (stale retention is the feature), reset only on process restart.
- Limit: A very long-lived Claude Desktop session issuing many distinct queries (especially unique `rss_fetch` URLs) grows memory monotonically. Each server process has its own cache — no cross-server sharing.
- Scaling path: LRU entry cap in `shared/cache.js`; explicitly accepted as out of scope for v1 (`shared/cache.js` line 13, ARCHITECTURE §8).

**Keyless API quotas:**
- Current capacity: GitHub anonymous — 10 search req/min, 60 core/hr; Stack Exchange keyless — small daily quota; Product Hunt — complexity-budgeted (mitigated by the minimal `POST_FIELDS`).
- Limit: Multi-source research bursts in fully keyless mode can exhaust GitHub search in one run; combined with the strict no-429-retry policy, subsequent calls hard-error until the window resets or the 15-min cache absorbs repeats.
- Scaling path: Set optional `GITHUB_TOKEN` (5000/hr, 30 search/min) and `STACKEXCHANGE_KEY` (10k/day); both degrade gracefully by design.

## Dependencies at Risk

**`fast-xml-parser` (^4.5.7):**
- Risk: The one parsing dependency with a nontrivial security surface (entity expansion). Audited at 4.5.7 via the phase 04-02 supply-chain gate; the caret range accepts future 4.x minors unaudited on non-`ci` installs. v5 exists upstream — the `processEntities` options tuned in `servers/rss/server.js` (lines 59-68) are v4-specific.
- Impact: RSS server only (`servers/rss/server.js` is the sole importer).
- Migration plan: Stay on 4.x; if forced to 5.x, re-verify the entity-expansion limits API and re-run the billion-laughs guard tests in `test/rss.test.js`.

**`@modelcontextprotocol/sdk` (^1.29.0):**
- Risk: Young, fast-moving SDK; the raw-shape `registerTool` contract and dual `content`/`structuredContent` emission are version-sensitive behaviors the whole suite depends on.
- Impact: All nine servers.
- Migration plan: Bump deliberately; the per-server registration tests plus `test/contract.test.js` are the canary.

## Missing Critical Features

**No CI pipeline:**
- Problem: No `.github/workflows/` (no `.github/` directory at all). The 94-test suite (`node --test`) runs only when someone runs it locally.
- Blocks: Regression detection on commits; the strong offline test suite provides no guarantee unless invoked.

**No lint/format tooling:**
- Problem: No ESLint/Prettier/Biome config anywhere. Style consistency (currently excellent) is maintained purely by the copy-the-template convention.
- Blocks: Automated enforcement of the "never call fetch directly" / "never read process.env outside credentials.js" invariants — both are grep-verifiable and would make trivial custom lint rules or a CI grep gate.

**No `.mcpb` distribution (PKG-01, deferred to v2):**
- Problem: Servers are runnable only from a checkout with `npm install`; manifests exist but no packing scripts.
- Blocks: One-click install/sharing; the keychain-backed `sensitive` credential storage documented in `servers/hn/manifest.json`.

## Test Coverage Gaps

**No live-API drift detection:**
- What's not tested: All 94 tests are offline (injected `fetchImpl`, fixtures under `test/fixtures/`). Upstream API changes — Algolia HN response shape, SE `withbody` filter behavior, GitHub reactions GA, PH GraphQL schema, Lemmy 0.19 endpoints — surface only when a human runs `examples/uniform-run.mjs` (manual smoke, last exercised at phase 4 UAT 2026-07-03).
- Files: `test/*.test.js`, `examples/uniform-run.mjs`
- Risk: A source can silently break in production (Claude Desktop) with green tests. `requirePhOk`/`requireSeQuestion`/`requirePhPost` guards convert some drift into clear errors, but field-map drift (renamed upstream fields → all-null items) would pass schema validation silently.
- Priority: Medium — a periodically-run live smoke (even manual, documented) is the cheapest mitigation.

**`stripHtml` entity edge cases:**
- What's not tested: Astral-plane numeric entities (the `fromCharCode` bug above), named entities outside the hardcoded set, nested/malformed tags.
- Files: `test/contract.test.js`, `shared/contract.js`
- Risk: Cosmetic text corruption shipped to the consuming skill unnoticed.
- Priority: Low.

**RSS object-shaped `content:encoded`:**
- What's not tested: A feed whose `content:encoded` carries attributes (the `textOf` bypass above). `test/rss.test.js` (288 lines) covers the author variant (WR-01) but not this field.
- Files: `test/rss.test.js`, `servers/rss/server.js`
- Risk: `"[object Object]"` as an item's `text`.
- Priority: Low (fix + test together).

**Environment note (not a code defect):** `npm test` currently fails 11 of 13 test files in this checkout solely because `node_modules` is not installed (`ERR_MODULE_NOT_FOUND: zod`). The 83 passing tests are the dependency-free `shared/` ones. Run `npm ci` before trusting local test results.

---

*Concerns audit: 2026-07-07*
