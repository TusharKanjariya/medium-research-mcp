# Phase 5: Guarded JSON Path & Trending Signals - Research

**Researched:** 2026-07-10
**Domain:** SSRF guard extension (getText → getJson) + three additive keyless JSON trending tools on shipped Node MCP servers
**Confidence:** HIGH (all four endpoints live-probed 2026-07-10; all code paths read from source; zero new dependencies)

## Summary

This phase is purely additive on a settled v1.0 architecture. It delivers one shared-infra change — an opt-in `untrustedHost` flag on `getJson()` that routes user-supplied-host JSON requests through the *existing* `assertSafeUrl` + per-hop-redirect SSRF guard already proven on `getText()` — and three additive `registerTool` blocks (HN rising, SE high-view no-answers mining, Dev.to top/rising) that are pure field-map + URL-construction work over the frozen output contract. No new runtime dependencies; every endpoint is a keyless JSON GET through `shared/http_client.js`.

All four endpoints were live-verified on 2026-07-10 (see Code Examples for exact captured shapes). The three highest-value planner facts confirmed by probing: (1) SE `/questions/no-answers` returns `view_count`, `answer_count`, `score`, `tags`, `owner`, `link`, `creation_date` **by default with no special filter** — the existing `seUrl()` `filter=withbody` only adds `body`; (2) SE rejects `sort=views` with `bad_parameter` — proving there is **no server-side view sort**, so the client-side re-rank (D-08) is mandatory, not optional; (3) HN Algolia `search_by_date` + `numericFilters=points>N,created_at_i>epoch` returns date-ordered story hits whose shape `mapHnHit` already maps unchanged.

**Primary recommendation:** Thread `untrustedHost` + injectable `lookup` into **`getJson` only** (not all three verbs — Lemmy/Discourse/Mastodon are all GET; postJson is fixed-host Product Hunt; getText is already guarded), reusing `fetchTextManual` verbatim. The "triplicated retry loop" tech debt does **not** force an extraction here because only one verb needs the flag. Then add the three tools as isolated field-map + `seUrl`/`devtoTopUrl`/`risingUrl` helper pairs so every new behavior is deterministically unit-testable offline.

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Guard design & security posture (SEC-01)**
- **D-01:** Expose the guard as an **opt-in flag on the existing function**: `getJson(url, { untrustedHost: true })`. One function, one retry/cache/stale code path. Fixed-host servers (HN, Dev.to, Stack Exchange) call `getJson(url)` unchanged and pay zero DNS-resolution cost; only user-supplied-host callers pass the flag. Do NOT add a separate `getJsonFromUserHost()` wrapper and do NOT guard every call.
- **D-02:** **Reuse the RSS `getText` guard exactly — do not fork a second guard implementation.** Same `assertSafeUrl`, same `node:net` BlockList, same per-hop redirect re-validation (`redirect:"manual"`, max 5 hops), same http+https scheme allowlist, same optional operator allowlist knob.
- **D-03:** **Add a content-type / JSON-safety check before `JSON.parse`.** A login-required Discourse or locked-down Mastodon instance can return HTTP 200 with an HTML login page; produce a clear tool-level "login required / not JSON" error instead of a `JSON.parse` crash. (Groundwork here; satisfies a Phase 7 success criterion.)
- **D-04:** **Reject credentials-in-URL** (`user@host`) on the guarded path.
- **D-05:** **Allow non-default ports** — do NOT force https-only, do NOT reject custom ports. The IP denylist is what stops the SSRF threat; keep consistent with the RSS guard's posture.
- **D-06:** **SEC-03 (DNS-rebinding TOCTOU residual, T-04-06) stays deferred to v2+.** Re-affirm the accepted risk in this phase's threat-model pass. IP-pinning via a custom-lookup undici dispatcher is NOT implemented this phase.

**Stack Exchange mining (TREND-02)**
- **D-07:** Mine the **`no-answers`** set (`/questions/no-answers`), NOT `unanswered`.
- **D-08:** **Rank by `view_count` client-side** — SE has no server-side view sort; fetch the tagged no-answer window and order by `view_count` descending before returning. `view_count` fills the contract `score` field.
- **D-09:** **Tag is required**; `site` defaults to `stackoverflow`, overridable via the existing `site` param.
- **D-10:** **`backoff` handling: sleep-within + record-in-output.** Inside a multi-fetch call, sleep the `backoff` seconds before any follow-up SE request. Always surface `backoff` and `quota_remaining` so the agent sees throttle state. When `quota_remaining` hits 0, surface the "set STACKEXCHANGE_KEY" guidance in the error. *(See Open Question OQ-1 — surfacing in the frozen envelope conflicts with the output contract; needs a resolution.)*

**HN rising (TREND-03)**
- **D-11:** Approximate rising with **`search_by_date` + `numericFilters`**, then **re-sort server-side by points/hour velocity** (points ÷ age-in-hours). Document that this is an approximation, not HN's real front-page algorithm.
- **D-12:** **Defaults: 24h window / ≥10 points**, both agent-overridable.
- **D-13:** **Optional keyword/query param.** `hn_rising(query?)`.

**Dev.to trending (TREND-01)**
- **D-14:** **Extend the existing `devto_top` tool** with new params rather than adding a 5th tool.
- **D-15:** Use an **explicit `mode` enum (`top` | `rising`)** plus `days` (used only in `top` mode) and an optional `tag`. Zod enforces `days` as integer days and **rejects invalid Dev.to API combinations** (`rising` + `days`). *(See Pitfall 4 — raw-shape registration can't express cross-field refine; the forbidden-combo rejection lives in the handler/helper.)*

### Claude's Discretion
- Guard posture details (D-02..D-05) delegated — planner may refine wording/thresholds but the substance is locked.
- SE tag param naming, Dev.to `mode` vs `sort` field name, and exact `numericFilters` string construction are left to the planner/researcher provided documented semantics hold.

### Deferred Ideas (OUT OF SCOPE)
- **SEC-03 — IP-pinning custom-lookup dispatcher** (DNS-rebinding TOCTOU residual T-04-06). Re-deferred to v2+. Do not implement.
- **Extract a shared `attemptWithRetry` core** to de-triplicate the three verbs. Not required by any phase-5 requirement (only `getJson` needs the flag — see Architecture note). Treat as an optional enabling refactor, not new scope.
- Discourse/Mastodon servers (Phase 7), author-blog tools (Phase 6), `.mcpb`/npm packaging (Phase 8).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SEC-01 | All user-supplied-host JSON requests route through the shared SSRF guard; Lemmy's instance-parameterized calls move onto the same path | `assertSafeUrl` + `fetchTextManual` already implement the full guard (`shared/http_client.js:173-238`); thread `untrustedHost`+`lookup` into `getJson` (`:253`), add content-type + creds-in-URL checks; add `untrustedHost:true` to Lemmy's 3 `getJson` calls (`servers/lemmy/server.js:157,191,219-223`) |
| TREND-01 | Dev.to top-of-window + rising, combinable with a tag | Live-verified `?top=<days>&tag=<t>` and `?state=rising&tag=<t>` both return the normal article array `mapDevtoArticle` maps unchanged; extend `devto_top` (`servers/devto/server.js:140`) with `mode`/`days`/`tag` |
| TREND-02 | Mine high-view unanswered SE questions per tag, ranked by view_count, honoring backoff | Live-verified `/questions/no-answers?site&tagged&sort&order&pagesize` returns `view_count`/`answer_count`/`score` by default; `sort=views` rejected → client re-rank required; `quota_remaining`/`quota_max` at top level; add tool to `servers/stackexchange/server.js` |
| TREND-03 | Rising HN stories with tunable hours / min-points | Live-verified `search_by_date?query?&tags=story&numericFilters=points>N,created_at_i>epoch`; velocity re-sort deterministic via injectable clock; add `hn_rising` to `servers/hn/server.js` reusing `mapHnHit` |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| SSRF host validation | Shared HTTP chokepoint (`shared/http_client.js`) | — | Single fetch chokepoint; no server may bypass it (CLAUDE.md invariant) |
| DNS resolution + denylist check | Shared (`assertSafeUrl`, `node:net` BlockList) | — | Already centralized; reuse verbatim (D-02) |
| Content-type / JSON-safety gate | Shared (`getJson` untrustedHost path) | — | Groundwork for Phase 7 login-page instances (D-03) |
| Endpoint selection (which trending URL) | Per-server handler + pure URL helper | — | Source-specific; keep as testable `seUrl`/`devtoTopUrl`/`risingUrl` helpers |
| Field mapping → contract item | Per-server `map*` function | Shared `normalizeItem` | Established pattern; servers do field-map only |
| Server-side ordering (velocity / view rank) | Per-server pure helper | — | Deterministic, injectable-clock, offline-testable |
| Cross-source merge/rank | Shared `mergeRank` (consumer-side) | — | Reads only `score`; trending signal must land in `score` to be rank-visible |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | ^1.29.0 (installed) | MCP server + `registerTool` (raw-shape) | Already the suite's backbone; no bump |
| `zod` | ^4.4 (installed) | Input/output schemas | Already used everywhere; raw-shape registration |
| Node built-ins (`node:net`, `node:dns/promises`, `node:crypto`) | Node >=18 | BlockList SSRF denylist, injectable DNS lookup | Guard already built on these |

### Supporting
No supporting libraries. This phase adds **zero dependencies** (confirmed by milestone SUMMARY.md "zero new runtime dependencies" verdict and by the fact that every new endpoint is a keyless JSON GET through the existing client).

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `untrustedHost` flag on `getJson` | separate `getJsonFromUserHost()` wrapper | Rejected by D-01 — duplicates the retry loop or is mere renaming |
| Reuse `assertSafeUrl` verbatim | fork a JSON-specific guard | Rejected by D-02 — forking risks policy drift (the exact CONCERNS.md warning) |
| Extract shared `attemptWithRetry` core | thread flag minimally into `getJson` | Extraction not needed — only ONE verb needs the flag this phase (see Architecture Patterns) |

**Installation:** none — `npm ci` reproduces the audited tree; no `package.json` change.

**Version verification:** `@modelcontextprotocol/sdk@1.29.0`, `zod@4.4.x`, `fast-xml-parser@4.5.7` are the installed/audited versions (package.json + CONCERNS.md supply-chain note). Do NOT bump the SDK — raw-shape `registerTool` is version-sensitive (CONCERNS.md "MCP SDK raw-shape coupling").

## Package Legitimacy Audit

> No external packages are installed in this phase. All code uses already-vendored dependencies and Node built-ins. Package Legitimacy Gate: **N/A (zero new packages)**.

## Architecture Patterns

### System Architecture Diagram

```
   MCP tool call (LLM-driven)
            │
            ▼
  ┌───────────────────────┐        FIXED-HOST tools (HN/SE/Dev.to trending)
  │  server handler        │ ─────────────────────────────────────────────┐
  │  (registerTool)        │        getJson(url)   ← no flag, no DNS cost   │
  └───────────────────────┘                                                 │
            │  untrusted host (Lemmy; Phase 7 Discourse/Mastodon)           │
            ▼                                                                │
   getJson(url, { untrustedHost:true, lookup })                             │
            │                                                                │
            ▼                                                                │
  ┌───────────────────────────────────────────┐                            │
  │ assertSafeUrl(initial host)                │  scheme allowlist          │
  │  + creds-in-URL reject (D-04)              │  RSS_ALLOWED_HOSTS knob    │
  │  + DNS lookup → BlockList denylist (D-02)  │  ← injectable `lookup`     │
  └───────────────────────────────────────────┘                            │
            │ pass                                                           │
            ▼                                                                │
  fetchTextManual: redirect:"manual", re-validate every Location (≤5 hops)  │
            │                                                                │
            ▼                                                                │
  ┌───────────────────────────────────────────┐                            │
  │ content-type gate (D-03): html/non-json    │                            │
  │  → terminal "login required / not JSON"    │                            │
  └───────────────────────────────────────────┘                            │
            │ json ok                                                        │
            ▼                                                                ▼
      response.json()  ───────────►  retry/backoff/stale core (SHARED, unchanged)
            │                                                                │
            ▼                                                                ▼
     map*() field map ──► buildListEnvelope → normalizeItem ──► toolResult(envelope)
                                (server-side velocity/view re-sort applied to raw hits
                                 BEFORE mapping, or to mapped items by score, per tool)
```

### Component Responsibilities
| File | Change | Responsibility |
|------|--------|----------------|
| `shared/http_client.js` | MODIFY `getJson` (`:253-333`); MODIFY `assertSafeUrl` (`:173`) for D-04 | Thread `untrustedHost`+`lookup`; route through `fetchTextManual`; content-type gate; creds-in-URL reject |
| `servers/hn/server.js` | ADD `hn_rising` + pure `risingUrl`/`rankByVelocity` helpers | Endpoint selection, velocity re-sort; reuse `mapHnHit` unchanged |
| `servers/stackexchange/server.js` | ADD no-answers tool + `mapSeUnanswered` + throttle helper | `view_count`→score mapper, client view re-rank, quota-zero guard |
| `servers/devto/server.js` | EXTEND `devto_top` (`:140`) + `devtoTopUrl` helper | `mode`/`days`/`tag` params, forbidden-combo guard; reuse `mapDevtoArticle` |
| `servers/lemmy/server.js` | ADD `untrustedHost:true` to 3 `getJson` calls (`:157,191,219-223`) | Move instance-parameterized calls onto guarded path |

### Recommended Project Structure
No new directories. All changes are edits to existing files, matching the "copy-the-template" convention. New pure helpers live inside the server module they belong to and are `export`ed for unit tests (mirrors existing `seUrl`, `mapHnHit`, `bearerHeaders` exports).

### Pattern 1: Opt-in guard threaded into getJson only (D-01/D-02)
**What:** Add `untrustedHost` + `lookup` to `getJson` opts. When `untrustedHost` is true, replace the bare `fetchWithTimeout` call inside the attempt loop with `fetchTextManual(fetchImpl, url, { headers }, timeoutMs, lookup)` (already exists, `:219`), then apply the content-type gate before `response.json()`. When false, behavior is byte-for-byte unchanged.
**When to use:** Lemmy's three calls this phase; Discourse/Mastodon in Phase 7.
**Example:**
```js
// shared/http_client.js — getJson attempt loop, untrustedHost branch (sketch)
// Source: existing fetchTextManual (:219) + getText (:490) patterns, reused verbatim
const response = untrustedHost
  ? await fetchTextManual(fetchImpl, url, { headers }, timeoutMs, lookup)
  : await fetchWithTimeout(fetchImpl, url, { headers }, timeoutMs);

if (response.ok) {
  if (untrustedHost) {
    const ct = response.headers.get("content-type") ?? "";
    // D-03: POSITIVE HTML signal only — a login-required forum returns an HTML page
    // with a 200. Do NOT reject merely-non-JSON (a text/plain body carrying valid JSON
    // must still fall through to JSON.parse). Matches 05-PATTERNS.md:58.
    if (/html/i.test(ct)) {
      // terminal, NOT retryable, NOT served stale (like an assertSafeUrl reject)
      lastError = new Error(`getJson: HTML response (login required?) from ${redactUrl(url)}`);
      transientFailure = false;
      break;
    }
  }
  let value;
  try { value = await response.json(); } catch { throw new RetryableError(...); }
  set(cacheKey, value, ttlMs);
  return value;
}
```
An `assertSafeUrl` rejection thrown inside `fetchTextManual` is a plain `Error` → not `RetryableError`/`TypeError`/`AbortError` → the existing `if (!isRetryable) break` path (`:313`) fails closed exactly as `getText` does (proven by `getText`'s SSRF tests). No new classification logic.

### Pattern 2: Pure URL + ordering helpers for deterministic offline tests
**What:** Every new tool factors its endpoint construction and any server-side ordering into exported pure functions, mirroring `seUrl()`.
**When to use:** All three tools.
**Example:**
```js
// servers/hn/server.js (sketch) — deterministic, clock injected
export function risingNumericFilters({ hours = 24, minPoints = 10, nowSeconds }) {
  const cutoff = nowSeconds - hours * 3600;
  return `points>${minPoints},created_at_i>${cutoff}`;
}
export function rankByVelocity(hits, nowSeconds) {
  const vel = (h) => (h.points ?? 0) / Math.max((nowSeconds - h.created_at_i) / 3600, 1 / 60);
  return [...hits].sort((a, b) => vel(b) - vel(a)); // divide-by-zero guarded by the 1/60h floor
}
// handler wires the real clock: const now = Math.floor(Date.now()/1000);
```

### Pattern 3: view_count→score override mapper (D-08)
**What:** The no-answers tool needs `score = view_count` (not votes). Reuse `mapSeQuestion` and override one field.
**Example:**
```js
// servers/stackexchange/server.js (sketch)
export function mapSeUnanswered(q) {
  return { ...mapSeQuestion(q), score: q.view_count ?? null }; // views ARE the engagement signal here
}
// num_comments stays answer_count (always 0 for no-answers) — expected, contract-legal.
```

### Anti-Patterns to Avoid
- **Adding `backoff`/`quota_remaining` as new envelope fields** — breaks the frozen `{source,query,count,results}` contract (the project's CORE VALUE). See OQ-1.
- **Adding a new `TYPE` enum value** — none of the three tools needs one; reuse `"story"` / `"question"` / `"article"`.
- **Cross-field Zod `.refine()` in `inputSchema`** — `registerTool` takes a RAW shape (flat field object), not `z.object(...)`; a refine can't be attached. Guard forbidden combos in the handler/helper (Pitfall 4).
- **Threading `untrustedHost` into `postJson`/`getText`** — unnecessary; only `getJson` receives user hosts this phase. Do not touch the other two verbs (avoids the triplication trap).
- **Re-sorting by raw date order for HN** — silently reorders merged `mergeRank` output; re-sort by velocity server-side (D-11).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Private-IP / metadata denylist | Custom CIDR/bitmask math | Existing `node:net` `BlockList` in `assertSafeUrl` | Hand-rolled CIDR is a classic SSRF-bypass source; the existing denylist already covers RFC1918/CGNAT/loopback/link-local/ULA/NAT64/IPv4-mapped |
| Redirect SSRF re-validation | New manual-redirect loop | Existing `fetchTextManual` (`:219`) | Already does `redirect:"manual"` + per-hop `assertSafeUrl`, max 5 hops |
| Retry/backoff/stale for new tools | Per-tool fetch logic | `getJson()` unchanged | CLAUDE.md invariant: never call `fetch` directly |
| Envelope assembly | Manual object build | `buildListEnvelope`/`normalizeItem`/`toolResult` | Contract cannot drift by construction |
| Cross-source ranking | Per-tool sort | `mergeRank` (consumer reads `score`) | Trending signal lands in `score`; consumer merges branch-free |

**Key insight:** The entire SSRF mechanism already exists and is battle-tested by the `getText` suite (16+ SSRF cases in `test/http_client.test.js`). SEC-01 is a *routing* change (make JSON ride the existing guard), not a new guard.

## Runtime State Inventory

> This is an additive code phase, not a rename/migration. No stored data, live-service config, OS-registered state, secrets, or build artifacts carry a renamed string.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — the 15-min TTL cache is in-memory, cleared on restart; new cache keys (new URLs) coexist with old | None |
| Live service config | None — no external service stores a phase string | None |
| OS-registered state | None | None |
| Secrets/env vars | No new env vars. `STACKEXCHANGE_KEY` (optional, already in `ENV_VAR`) is the quota mitigation; no new key names | None |
| Build artifacts | None — no compiled output; `npm ci` reproduces deps | None |

**Nothing found in any category — verified by reading `shared/credentials.js` (`ENV_VAR` unchanged) and the additive-only nature of the diff.**

## Common Pitfalls

### Pitfall 1: SE `backoff`/`quota_remaining` never appear in offline captures
**What goes wrong:** Fixtures captured under normal load carry **no** `backoff` field (verified: my 2026-07-10 probe returned `backoff: undefined`) and `quota_remaining: 299`. Tests for D-10 pass against fixtures that can never exercise the throttle path.
**Why it happens:** `backoff` only appears under sustained load; `quota_remaining: 0` only at quota exhaustion.
**How to avoid:** **Synthesize** two fixtures by hand: one no-answers response with `"backoff": 3` added at top level, and one with `"quota_remaining": 0`. Assert the quota-zero fixture triggers the "set STACKEXCHANGE_KEY" error and (if the tool pages) that `backoff` is slept before a follow-up request via the injected `sleep`.
**Warning signs:** A "backoff handled" test that never constructs a response containing `backoff`.

### Pitfall 2: SE `sort=views` looks plausible but is rejected
**What goes wrong:** Assuming a server-side view sort exists and passing `sort=views` → HTTP 200 with `error_id: 400, error_name: bad_parameter` (verified live). getJson would surface this as a hard 400.
**Why it happens:** SE has `view_count` on items but no `views` sort on `/questions/no-answers`.
**How to avoid:** Fetch with a **valid** sort (`activity`, `votes`, or `creation`) to fill the window, then re-rank by `view_count` descending client-side (D-08). Recommend `sort=activity` or `votes` + `pagesize` up to 100 in one fetch.
**Warning signs:** `bad_parameter` / `error_message: sort` in dev logs.

### Pitfall 3: HN `search_by_date` returns newest-first, not hottest-first
**What goes wrong:** `search_by_date` is date-ordered. Returning it as-is silently reorders any downstream `mergeRank` and misrepresents "rising."
**Why it happens:** Algolia has no rising endpoint (D-11).
**How to avoid:** Re-sort by points/hour velocity server-side before mapping; document the approximation in the tool description. Guard the divide-by-zero on very-fresh posts (age floor).
**Warning signs:** "rising" results ordered newest-first; a fresh 2-point post outranking a climbing 200-point post.

### Pitfall 4: Cross-field Zod validation is impossible in raw-shape registration
**What goes wrong:** D-15 asks Zod to reject `rising` + `days`. But `registerTool` takes a **raw field shape** (`{ mode: z.enum(...), days: z.number()... }`), not `z.object(...)`, so `.refine()`/`.superRefine()` can't be attached (CONCERNS.md "MCP SDK raw-shape coupling"). A refined `z.object` passed to `registerTool` diverges from the established convention and risks the documented SDK expectation.
**Why it happens:** Per-field Zod validates each field independently; cross-field constraints need the compiled object.
**How to avoid:** Enforce the forbidden combo in the **handler** (or an exported pure `devtoTopUrl({mode,days,tag})` helper that throws) *before* any fetch, and unit-test it directly. Per-field Zod still enforces `mode` enum and `days` integer range.
**Warning signs:** A test expecting `inputSchema.parse({mode:"rising", days:7})` to throw at the schema layer.

### Pitfall 5: `untrustedHost` on Lemmy adds DNS cost + can block an internal operator instance
**What goes wrong:** Adding `untrustedHost:true` to Lemmy's `getJson` calls makes every Lemmy request resolve DNS and run the denylist against the operator-set `LEMMY_INSTANCE`. An operator who deliberately pointed `LEMMY_INSTANCE` at an internal/loopback host would now be blocked.
**Why it happens:** The guard checks all hosts, including trusted operator-set ones.
**How to avoid:** Accept it — it is belt-and-suspenders and per D-01 Lemmy moves onto the guarded path. Note in the plan that Lemmy tests driving the handler must now inject `lookup` (existing Lemmy tests are map/registration-only and are unaffected — verified in `test/lemmy.test.js`).
**Warning signs:** A Lemmy handler test that drives `getJson` without a `lookup` stub failing with a real DNS attempt.

### Pitfall 6: content-type gate can regress quirky-but-valid JSON APIs
**What goes wrong:** If the content-type gate rejects anything not containing `json`, an API returning `text/plain` with a valid JSON body would be wrongly rejected.
**Why it happens:** Not every JSON endpoint sets `application/json`.
**How to avoid:** Gate only on a **positive HTML signal** or empty-body-with-html — i.e., reject when content-type contains `html` (login pages), else fall through to `JSON.parse` (whose existing failure path already handles genuine non-JSON). Only apply the gate on the `untrustedHost` path. Lemmy (this phase's only caller) returns proper `application/json`, so no regression.
**Warning signs:** A fixed-host tool suddenly erroring "not JSON" — means the gate leaked outside the `untrustedHost` branch.

## Code Examples

Verified live 2026-07-10 (captured shapes, secrets never involved — all keyless):

### SE high-view no-answers (TREND-02)
```
GET https://api.stackexchange.com/2.3/questions/no-answers
    ?site=stackoverflow&tagged=<tag>&sort=activity&order=desc&pagesize=<n>
    &filter=withbody   (added by existing seUrl(); optional key folded in)
```
Top-level keys (verified): `items`, `has_more`, `quota_max`, `quota_remaining`
(`backoff` ABSENT under normal load — synthesize for tests).
Item keys (verified, NO extra filter needed for these): `tags`, `owner`, `is_answered`,
`view_count`, `answer_count`, `score`, `last_activity_date`, `creation_date`, `question_id`,
`content_license`, `link`, `title`. `body` present only because `filter=withbody` is sent.
- `sort=views` → `error_id:400 error_name:bad_parameter` (NO server-side view sort).
- Contract map (via `mapSeUnanswered`): `question_id`→id, `"question"`→type, `title`→title,
  `owner.display_name`→author, **`view_count`→score (D-08)**, `answer_count`→num_comments (=0),
  `creation_date`(epoch s → ISO)→created_utc, `link`→url & permalink, `tags`→tags,
  `body`(stripped)→text.

### Dev.to top / rising (TREND-01)
```
GET https://dev.to/api/articles?top=<days>&tag=<tag>&per_page=<n>      (mode=top)
GET https://dev.to/api/articles?state=rising&tag=<tag>&per_page=<n>    (mode=rising)
Header: Accept: application/vnd.forem.api-v1+json   (existing FOREM_HEADERS)
```
Both verified to return the standard article array with `tag` honored (item0 `tag_list`
included the requested tag). Reuse `mapDevtoArticle` unchanged: `public_reactions_count`→score,
`comments_count`→num_comments, `published_at`→created_utc, `tag_list`→tags, `"article"`→type.
Forbidden combo to reject in handler: `mode:"rising"` + `days` (D-15).

### HN rising (TREND-03)
```
GET https://hn.algolia.com/api/v1/search_by_date
    ?query=<optional>&tags=story&numericFilters=points>10,created_at_i><epoch>&hitsPerPage=<n>
```
Verified: returns date-ordered hits with `points`, `created_at_i`, `created_at`, `num_comments`,
`objectID`, `author`, `url`, `_tags`, `title`. `mapHnHit` maps these unchanged (type resolves to
`"story"`). Re-sort by velocity server-side (Pattern 2). `numericFilters` ANDs comma-separated
comparisons; `points>N` and `created_at_i>cutoff` both confirmed working (with and without `query`).

### Guarded getJson test seam (SEC-01)
```js
// New tests mirror test/http_client.test.js getText SSRF cases, but call getJson with untrustedHost.
// Needs a res()-with-headers helper (existing res() lacks .headers):
function jsonRes(status, data, { ct = "application/json", location } = {}) {
  return { ok: status>=200&&status<300, status,
    headers: { get: k => k.toLowerCase()==="content-type" ? ct
      : k.toLowerCase()==="location" ? (location ?? null) : null },
    async json(){ return data; } };
}
// Reuse existing injected resolvers: privateLookup (10.0.0.5), the 127.0.0.1 / 169.254.169.254
// IP-literal cases (noLookup), and the 302→internal redirect case — all already in the test file.
await assert.rejects(() => getJson("http://169.254.169.254/x",
  { fetchImpl, sleep, lookup: noLookup, untrustedHost: true, cacheKey: "json:meta" }), /blocked address/);
```

## State of the Art

| Old Approach (v1.0) | Current (this phase) | When Changed | Impact |
|--------------|------------------|--------------|--------|
| SSRF guard only on `getText`/RSS | `untrustedHost` opt-in on `getJson` | Phase 5 | JSON sources with user hosts (Lemmy now, Discourse/Mastodon Phase 7) ride the same guard |
| Lemmy `getJson(url,{headers})` unguarded | `getJson(url,{headers,untrustedHost:true})` | Phase 5 | Instance host validated + redirect-checked |
| SE tools: `score`=votes | no-answers tool: `score`=view_count | Phase 5 | Views are the engagement signal for unmet-need mining (D-08) |

**Deprecated/outdated:** none — nothing is removed; the `TYPE` enum and item schema are untouched.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `filter=withbody` (already sent by `seUrl`) does not suppress the default `view_count`/`answer_count`/`score` fields on `/questions/no-answers` | Code Examples (SE) | LOW — verified live the *default* response carries them; `withbody` only adds `body`. Re-confirm the combined `no-answers`+`withbody` response at execution if a field turns null |
| A2 | Dev.to `state=rising` needs no `top`/`days` and ignores/refuses `days` when rising | Pitfall 4 / D-15 | LOW — verified `state=rising` alone works; the exact API error on `rising`+`top` was not probed (we reject it in-handler regardless, so behavior is defined by us) |
| A3 | Adding creds-in-URL rejection (D-04) to `assertSafeUrl` is acceptable for the existing `getText`/RSS callers too | Architecture / D-04 | LOW — `user:pass@host` RSS feeds are nonsensical and SSRF-relevant; tightening is safe, but it is a (tiny) behavior change to a shared function |
| A4 | HN velocity divide-by-zero floor (min age ~1/60 h) is an acceptable heuristic | Pattern 2 | LOW — cosmetic ordering only; planner may tune |

**These are LOW-risk; A1 is the only one worth a quick live re-confirm during execution (it is offline-fixture-testable thereafter).**

## Open Questions

1. **OQ-1 (must resolve before planning the SE tool): D-10 "surface `backoff`/`quota_remaining` in the envelope" vs the frozen output contract.**
   - What we know: The list envelope is frozen as `{source, query, count, results}` (CLAUDE.md "DO NOT BREAK"; it is the project's stated CORE VALUE). `toolResult` validates `structuredContent` against `listEnvelopeShape`, which has no room for `backoff`/`quota_remaining`. Adding top-level fields would break OUT-01 uniformity.
   - What's unclear: How to "surface throttle state" without a contract field.
   - Recommendation: **Do not add envelope fields.** Satisfy D-10 as: (a) **error path** — when `quota_remaining === 0`, throw the "set STACKEXCHANGE_KEY" error (explicit in D-10); (b) **behavioral** — if the tool makes any in-invocation follow-up SE request (e.g. a second page), sleep `backoff` seconds first via the injected `sleep`; (c) if the tool is single-fetch (recommended — one `pagesize<=100` page covers the window), `backoff` is read but there is nothing to delay. This preserves the contract while meeting TREND-02's "honors the API backoff field." Route the quota/backoff read through a small exported `seThrottle(raw,{sleep})` helper for unit tests. **Confirm with the user in discuss/plan that error-path + behavioral honoring (no envelope field) is the accepted interpretation of D-10.**

2. **OQ-2 (low): SE window size for a meaningful view-ranked result.**
   - What we know: `pagesize` max is 100; the tool's `limit` is capped at 50 by the existing convention.
   - What's unclear: Whether one page (sorted by activity/votes) yields a rich enough set to re-rank by views, or whether a 2-page fetch (triggering the backoff-sleep path) is worth it.
   - Recommendation: **Single page, `pagesize = min(limit*2, 100)`** to give the client-side view re-rank some headroom, then slice to `limit`. Keeps it single-fetch (no backoff delay needed) and simplest. Revisit only if results feel thin in UAT.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node built-ins (`node:net`,`node:dns/promises`) | SSRF guard | ✓ | Node >=18 | — |
| `@modelcontextprotocol/sdk` | tool registration | ✓ | 1.29.0 (installed) | — |
| `zod` | schemas | ✓ | 4.4.x (installed) | — |
| Network egress to `api.stackexchange.com`, `dev.to`, `hn.algolia.com` | live smoke only | ✓ (probed 2026-07-10) | — | Offline fixtures cover all unit tests |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none — all offline unit tests run without network via injected `fetchImpl`/`sleep`/`lookup`.

## Security Domain

> `security_enforcement` is enabled (this phase IS a security requirement, SEC-01). Brief threat-model pass required per the roadmap's Phase-5 instruction.

### Threat-model pass (SEC-01 + SEC-03 re-affirmation)
- **T-04 SSRF (Tampering/Info-disclosure):** user/LLM-supplied host → internal/metadata service. **Mitigated** by routing `getJson` untrustedHost calls through the existing `assertSafeUrl` denylist + per-hop redirect re-validation (D-02). Adds D-03 content-type gate (defense against 200-HTML login pages) and D-04 creds-in-URL rejection.
- **T-04-06 DNS-rebinding TOCTOU residual (accepted):** `assertSafeUrl` resolves-and-checks, but the subsequent fetch resolves independently inside undici; a short-TTL rebind between check and connect is not fully closed. **Re-affirmed as accepted risk** for a local, single-user tool (the only "attacker" is the LLM driving it). IP-pinning (SEC-03) stays deferred to v2+ (D-06). Documented in `shared/http_client.js:155-166`.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | yes | Zod per-field schemas; handler-level forbidden-combo guards; `encodeURIComponent`/`URLSearchParams` for all user input into URLs |
| V10/V12 SSRF & Comms (Server-Side Request Forgery) | yes | `assertSafeUrl` + `node:net` BlockList denylist + per-hop redirect re-validation + scheme allowlist + content-type gate |
| V7 Error Handling & Logging | yes | `redactUrl` strips query strings from error text (no secret/`key=` leak); already covered, reused |
| V6 Cryptography | no | No crypto introduced (cache keys use existing sha1 for POST only, not this phase) |
| V2 Auth / V3 Session | no | Keyless GETs; optional `STACKEXCHANGE_KEY` via existing `credentials.js` |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SSRF to `169.254.169.254` / `127.0.0.1` via instance/host param | Information Disclosure | `assertSafeUrl` denylist (IP-literal + DNS-resolved + IPv4-mapped/NAT64) |
| Redirect-to-internal (302 → metadata) | Tampering | `fetchTextManual` per-hop re-validation, `redirect:"manual"` |
| 200-HTML login page → `JSON.parse` crash / info leak | Denial of Service | D-03 content-type gate → clear terminal error |
| Credentials-in-URL (`user:pass@host`) exfil/confusion | Info Disclosure | D-04 reject in `assertSafeUrl` |
| Quota exhaustion → cascade hard-errors (no-4xx-retry) | DoS (self-inflicted) | Quota-zero guard → "set STACKEXCHANGE_KEY"; single-fetch window; 15-min cache |

## Sources

### Primary (HIGH confidence)
- **Live API probes 2026-07-10** (this session): `api.stackexchange.com/2.3/questions/no-answers` (default fields, `quota_*`, `backoff` absence, `sort=views` rejection), `dev.to/api/articles?top=/state=rising` (tag combinability, item shape), `hn.algolia.com/api/v1/search_by_date` (`numericFilters` syntax, hit shape, `query` combinability)
- **Codebase (read from source this session):** `shared/http_client.js`, `shared/contract.js`, `shared/credentials.js`, `shared/rank.js`, `servers/{hn,stackexchange,devto,lemmy}/server.js`, `test/{http_client,stackexchange,hn,devto,lemmy}.test.js`, `package.json`
- **`.planning/codebase/CONCERNS.md`** — triplicated retry loop, raw-shape coupling, TOCTOU residual, no-4xx-retry fragility

### Secondary (MEDIUM confidence)
- `.planning/research/SUMMARY.md`, `.planning/research/PITFALLS.md` (§Pitfalls 3, 5, 6) — milestone-level endpoint verification 2026-07-08 and pitfall catalogue
- `.planning/phases/05-.../05-CONTEXT.md` — locked decisions D-01..D-15

### Tertiary (LOW confidence)
- Exact Forem API error on `state=rising`+`top` combination (not probed; we reject in-handler regardless — A2)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new deps; all installed versions verified against package.json + CONCERNS supply-chain note
- Architecture (guard threading): HIGH — `assertSafeUrl`/`fetchTextManual`/`getText` read from source; only routing changes
- Endpoints/contract mapping: HIGH — all four endpoints live-probed this session with captured field shapes
- Pitfalls: HIGH — the two subtle ones (SE `sort=views` rejection, `backoff` absence in captures) confirmed by direct probe
- OQ-1 (D-10 vs contract): flagged as MEDIUM — needs a user/planner decision, not more research

**Research date:** 2026-07-10
**Valid until:** 2026-08-09 (stable APIs; re-confirm A1 SE `no-answers`+`withbody` field presence at execution — a one-line live check)
