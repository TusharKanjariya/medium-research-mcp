# Phase 5: Guarded JSON Path & Trending Signals - Pattern Map

**Mapped:** 2026-07-10
**Files analyzed:** 10 (5 source/shared modifies + 5 test/fixture additions)
**Analogs found:** 10 / 10 (every change extends an in-repo pattern — no greenfield files)

> **Frozen-contract reminder for the planner (applies to ALL tools below):**
> Every list tool returns exactly `{ source, query, count, results: [item] }`; every
> detail tool returns `{ source, item: { …item, comments: [...] } }`. The item schema is
> `id, type, title, author, score, num_comments, created_utc, url, permalink, tags, text`.
> **Never add `backoff`/`quota_remaining`/velocity/any new envelope or item field** (OQ-1 resolved:
> throttle state rides the error path + behavioral sleep, never the envelope). The `TYPE` enum
> (`shared/contract.js:28-41`) is **append-only** and **no new type is needed** this phase —
> HN rising = `"story"`, SE no-answers = `"question"`, Dev.to top/rising = `"article"` (all already exist).

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `shared/http_client.js` (MODIFY `getJson` + `assertSafeUrl`) | shared http utility | request-response (SSRF-guarded) | `getText` guarded path IN SAME FILE (`:469-546`, `fetchTextManual` `:219-238`) | exact (same file, same mechanism) |
| `servers/hn/server.js` (ADD `hn_rising` + helpers) | server / tool registration | request-response (fixed host) | `hn_search` (`:150-172`) + `mapHnHit` (`:74-88`) | exact |
| `servers/stackexchange/server.js` (ADD no-answers tool + `mapSeUnanswered` + throttle) | server / tool registration | request-response, client re-rank + multi-fetch backoff | `so_hot_questions` (`:149-180`) + `so_get_question` double-fetch (`:217-247`) + `seUrl` (`:118-129`) | exact |
| `servers/devto/server.js` (EXTEND `devto_top`) | server / tool registration | request-response (fixed host) | existing `devto_top` (`:140-166`) + `toTags`/`mapDevtoArticle` (`:60-93`) | exact (in-place extend) |
| `servers/lemmy/server.js` (route 3 calls to guarded path) | server / tool registration | request-response (untrusted host) | existing lemmy `getJson` call sites (`:157,191,219-223`) | exact |
| `test/http_client.test.js` (ADD guarded-getJson SSRF cases) | test | request-response | `getText` SSRF cases (`:444-717`) + injected resolvers (`:421-429`) | exact |
| `test/hn.test.js` / `test/stackexchange.test.js` / `test/devto.test.js` (ADD tool tests) | test | field-map + registration smoke | `test/stackexchange.test.js` structure (`:14-70`) | exact |
| `test/fixtures/stackexchange-noanswers.json` + synthetic backoff/quota-zero fixtures | fixture | data | `test/fixtures/stackexchange-list.json` | role-match (must hand-synthesize `backoff`/`quota_remaining:0`) |

---

## Pattern Assignments

### `shared/http_client.js` — `getJson({ untrustedHost, lookup })` (shared utility, SSRF-guarded request-response)

**Analog:** `getText` (`:469-546`) — already threads `lookup` and routes through `fetchTextManual`. This is the exact pattern to replicate inside `getJson`.

**Guarded fetch swap** — the ONLY change to the attempt loop. `getText` already does this (`:490-499`); mirror it behind the `untrustedHost` flag so the non-flag path stays byte-for-byte unchanged (`getJson:276-281` today):
```js
// getText's guarded fetch (:493-499) — the pattern to conditionalize in getJson:
const response = await fetchTextManual(
  fetchImpl, url, { headers: mergedHeaders }, timeoutMs, lookup,
);
// getJson today (:276-281) — unchanged when untrustedHost is false:
const response = untrustedHost
  ? await fetchTextManual(fetchImpl, url, { headers }, timeoutMs, lookup)
  : await fetchWithTimeout(fetchImpl, url, { headers }, timeoutMs);
```

**Fail-closed classification is already correct** — an `assertSafeUrl` rejection is a plain `Error`, so it hits the existing `if (!isRetryable) { transientFailure = false; break; }` path (`:313-316`) exactly as `getText` documents at `:525-528`. **No new error-classification code.** Verified by the getText SSRF tests (`test/http_client.test.js:681-717`).

**Content-type gate (D-03)** — insert after `response.ok` (`:283`), ONLY on the `untrustedHost` branch. Gate on a **positive HTML signal** (Pitfall 6), terminal + non-retryable + not-stale (like an SSRF reject):
```js
if (response.ok) {
  if (untrustedHost) {
    const ct = response.headers.get("content-type") ?? "";
    if (/html/i.test(ct)) {
      lastError = new Error(`getJson: non-JSON response (login required?) from ${redactUrl(url)}`);
      transientFailure = false;   // terminal, mirrors :304
      break;
    }
  }
  // existing :284-293 JSON.parse + set() + return unchanged
}
```
Note: `res()` test helper (`test/http_client.test.js:10-19`) has **no `.headers`** — the plan must add a `jsonRes()` helper with a `headers.get()` shim (research §"Guarded getJson test seam", 05-RESEARCH:326-331). `textRes` (`:586-597`) already models the `headers.get` shape to copy.

**Creds-in-URL reject (D-04)** — add to `assertSafeUrl` (`:173-210`), right after the `new URL` parse (`:176`) and before/with the scheme check (`:181`). Reject when `u.username || u.password`. This tightens the shared function for `getText`/RSS callers too (Assumption A3 — accepted, low risk).

**Options plumbing** — add `untrustedHost = false` and `lookup = dnsLookup` to the `getJson` destructure (`:254-261`), mirroring `getText`'s destructure (`:470-478`) which already lists `lookup = dnsLookup`. Import `dnsLookup` is already present (`:22`).

**Do NOT** thread the flag into `postJson`/`getText` (anti-pattern, 05-RESEARCH:213). Only `getJson` receives user hosts this phase.

---

### `servers/hn/server.js` — `hn_rising` (server / tool registration, fixed-host request-response)

**Analog:** `hn_search` (`:150-172`) for the registerTool block; `mapHnHit` (`:74-88`) reused **unchanged**.

**Registration + handler** — copy `hn_search` verbatim, swap the URL and add a server-side velocity re-sort before mapping:
```js
// hn_search (:161-171) — the exact shape to copy:
async ({ query, limit = 20 }) => {
  const raw = await getJson(
    `${ALGOLIA}/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=${limit}`,
  );
  const env = buildListEnvelope({
    source: SOURCE,
    query,
    results: (raw.hits ?? []).map(mapHnHit),
  });
  return toolResult(env);
}
```
For `hn_rising`: endpoint `${ALGOLIA}/search_by_date`, `tags=story`, `numericFilters=points>${minPoints},created_at_i>${cutoff}`, optional `query`. Re-sort `raw.hits` by points/hour velocity BEFORE `.map(mapHnHit)` (Pitfall 3 — never return date order). Factor into exported pure helpers `risingNumericFilters({hours,minPoints,nowSeconds})` and `rankByVelocity(hits, nowSeconds)` (05-RESEARCH Pattern 2, `:187-195`), mirroring the existing exported-helper convention (`export function mapHnHit`). Inject the clock: `const now = Math.floor(Date.now()/1000)`.

**Input schema** — `query: z.string().optional()`, `hours` + `minPoints` as `z.number().int()...optional()` (defaults 24 / 10, D-12). Follow `hn_search`'s `limit: z.number().int().min(1).max(50).optional()` (`:157`).

**Contract map (via `mapHnHit`, unchanged):** `objectID`→id, `_tags`→`type` (resolves `"story"`), `title`→title, `author`→author, `points`→**score**, `num_comments`→num_comments, `created_at`(ISO)→created_utc, `url`→url, `permalink(objectID)`→permalink, filtered `_tags`→tags, `story_text`→text. **Velocity is an ordering only — it never enters the item.** Document the approximation in the tool `description` (05-CONTEXT specifics).

---

### `servers/stackexchange/server.js` — no-answers mining tool + `mapSeUnanswered` + throttle (server / tool registration, client re-rank + multi-fetch)

**Analog:** `so_hot_questions` (`:149-180`) for the registration + `site` param + `seUrl`; `so_get_question` (`:217-247`) for the multi-fetch sleep-within case; `mapSeQuestion` (`:62-76`) for the base map.

**`seUrl` reuse (`:118-129`)** — already returns `{ url, cacheKey }` with the secret-free cache key and folds in `filter=withbody` + optional key. Call it with path `/questions/no-answers`:
```js
// so_hot_questions handler (:165-172) — the exact pattern to copy:
async ({ limit = 20, site = "stackoverflow", sort = "hot" }) => {
  const { url, cacheKey } = seUrl("/questions", {
    site, sort, order: "desc", pagesize: String(limit),
  });
  const raw = await getJson(url, { cacheKey });
  const env = buildListEnvelope({
    source: SOURCE, query: null,
    results: (raw.items ?? []).map(mapSeQuestion),
  });
  return toolResult(env);
}
```
For no-answers: `seUrl("/questions/no-answers", { site, tagged: <tag>, sort: "activity", order: "desc", pagesize: String(Math.min(limit*2, 100)) })` (OQ-2: single page, `sort=views` is rejected by SE — Pitfall 2 — so use `activity`/`votes`). Then **client re-rank by `view_count` desc**, slice to `limit`, `.map(mapSeUnanswered)`.

**`mapSeUnanswered` (D-08)** — reuse `mapSeQuestion` and override one field (05-RESEARCH Pattern 3, `:203-206`):
```js
export function mapSeUnanswered(q) {
  return { ...mapSeQuestion(q), score: q.view_count ?? null };
}
```

**Input schema** — `tag: z.string()` (REQUIRED, D-09; NOT optional — like `so_search`'s `query: z.string()` at `:192`), `site: z.string().optional()`, `limit` bounded like `:159`.

**Backoff / quota (D-10, OQ-1 resolved — NO envelope field):** Prefer single-fetch so no follow-up sleep is needed. Route the throttle read through a small exported `seThrottle(raw, { sleep })` helper (unit-tested). When `raw.quota_remaining === 0`, throw the "set STACKEXCHANGE_KEY" error (mirror the actionable-error style of `requireSeQuestion` `:87-94`). The sleep-within precedent is `so_get_question`'s second fetch (`:237-242`) — if the tool ever does a follow-up SE request, `await sleep(raw.backoff * 1000)` first.

**Contract map (via `mapSeUnanswered`):** `question_id`→id, `"question"`→type, `title`→title, `owner.display_name`→author, **`view_count`→score** (override), `answer_count`→num_comments (=0, contract-legal), `creation_date`(epoch s→ISO via `toIso` `:50-53`)→created_utc, `link`→url & permalink, `tags`→tags, `body_markdown ?? body`(stripped)→text.

---

### `servers/devto/server.js` — extend `devto_top` with `mode`/`days`/`tag` (server / tool registration, fixed-host)

**Analog:** the existing `devto_top` block (`:140-166`) — extended in place (D-14, do NOT add a 5th tool); `toTags`/`mapDevtoArticle` (`:60-93`) reused unchanged. `devto_tag` (`:168-194`) shows the `tag` + `encodeURIComponent` + `top=` URL pattern to fold in.

**Current handler to extend (`:154-165`):**
```js
async ({ limit = 20, days = TOP_DAYS }) => {
  const raw = await getJson(
    `${DEVTO}/articles?top=${days}&per_page=${limit}`,
    { headers: FOREM_HEADERS },
  );
  const env = buildListEnvelope({
    source: SOURCE, query: null,
    results: (raw ?? []).map(mapDevtoArticle),
  });
  return toolResult(env);
}
```

**Add params** — `mode: z.enum(["top","rising"]).optional()` (default `"top"`), `days: z.number().int().min(1).max(365).optional()` (already present `:150`; document "integer DAYS: 7=week, 30=month" — Pitfall/specifics), `tag: z.string().optional()`.

**Forbidden-combo guard (D-15, Pitfall 4)** — `registerTool` takes a RAW shape so `.refine()` is impossible. Factor URL building into an exported pure `devtoTopUrl({ mode, days, tag, limit })` that **throws** on `mode==="rising" && days != null` (and the forbidden `state`/`username` combos), and unit-test it directly. Handler calls it before fetch. `top` mode → `?top=<days>&tag=<t>&per_page=<n>`; `rising` mode → `?state=rising&tag=<t>&per_page=<n>` (05-RESEARCH Code Examples `:302-310`). Keep `{ headers: FOREM_HEADERS }` on every call (`:48`).

**Contract map (via `mapDevtoArticle`, unchanged):** `id`→id, `"article"`→type, `title`→title, `user.username`→author, `public_reactions_count`→**score**, `comments_count`→num_comments, `published_at`(ISO)→created_utc, `url`→url & permalink, `tag_list`(array/string via `toTags`)→tags, `description`→text.

---

### `servers/lemmy/server.js` — route 3 `getJson` calls onto the guarded path (server / tool registration, untrusted host)

**Analog:** the three existing lemmy call sites — `lemmy_hot` (`:157`), `lemmy_search` (`:191`), `lemmy_post` (`:219-223`). Minimal change: add `untrustedHost: true` (and thread an injectable `lookup` for tests) to each `getJson` opts object.

```js
// today (:157):
const raw = await getJson(`${base}/api/v3/post/list?${qs}`, { headers });
// after SEC-01:
const raw = await getJson(`${base}/api/v3/post/list?${qs}`, { headers, untrustedHost: true });
```
The `base` comes from `lemmyInstance()` (operator env, `:150,183,215`) — an operator who points `LEMMY_INSTANCE` at loopback is now blocked (Pitfall 5, accepted). Existing lemmy tests are map/registration-only and unaffected; any NEW handler-driving test must inject a `lookup` stub (Pitfall 5, 05-RESEARCH:268-272). No field-map or envelope change.

---

## Shared Patterns

### SSRF guard reuse (D-02) — the single mechanism, do not fork
**Source:** `shared/http_client.js` — `assertSafeUrl` (`:173-210`), `fetchTextManual` (`:219-238`), `BlockList DENY` (`:75-94`), `canonicalizeMappedV4` (`:110-130`).
**Apply to:** `getJson` untrustedHost path (this phase) → Lemmy now, Discourse/Mastodon (Phase 7).
Reuse verbatim; the only additions are the `getJson` routing branch, the D-03 content-type gate, and the D-04 creds-in-URL reject inside `assertSafeUrl`.

### Envelope assembly (never hand-roll)
**Source:** `shared/contract.js` — `buildListEnvelope` (`:137-140`), `buildDetailEnvelope` (`:142-154`), `normalizeItem` (`:121-135`), `toolResult` (`:160-165`).
**Apply to:** all three trending tools. Map fields → `buildListEnvelope({ source, query, results })` → `toolResult(env)`. `normalizeItem` handles defaulting + `stripHtml` + id-stringify, so `map*` stays pure field mapping.

### Exported pure helper convention (offline unit-testability)
**Source:** `mapHnHit` (hn `:74`), `seUrl` (se `:118`), `bearerHeaders` (lemmy `:99`), `toTags` (devto `:60`) — all `export`ed and driven directly by tests.
**Apply to:** new `risingNumericFilters`/`rankByVelocity`, `mapSeUnanswered`/`seThrottle`, `devtoTopUrl`. Each `export`ed and unit-tested without the network.

### registerTool raw-shape (SDK 1.29.0) — no `z.object`, no cross-field `.refine()`
**Source:** every `registerTool` block; `inputSchema` is a flat field object (`hn:132-135`, `se:158-162`). `outputSchema: listEnvelopeShape` / `detailEnvelopeShape` from `shared/contract.js`.
**Apply to:** all new/extended tools. Cross-field constraints (Dev.to forbidden combos, required SE tag semantics) live in the handler/helper, never the schema (Pitfall 4).

### Secret-free cache key + redacted errors (WR-01)
**Source:** `seUrl` (`:118-129`) builds an authed `url` but a key-free `cacheKey`; `redactUrl` (`:41-48`) strips query strings from error text.
**Apply to:** the SE no-answers tool (reuse `seUrl` as-is). New guarded-path errors already ride `redactUrl`.

### Test structure (fixture-pinned field map + registration smoke + injected fetch/lookup)
**Source:** `test/stackexchange.test.js` (`:14-70`) for fixture load + `map*` assertions + registration smoke; `test/http_client.test.js` for injected `fetchImpl`/`sleep`/`lookup` (`:24-44`, `:421-429`), the `textRes` headers shim (`:586-597`), and SSRF cases (`:444-717`).
**Apply to:** new getJson SSRF tests (reuse `noLookup`/`privateLookup`/`mappedMetadataLookup` `:421-429` + a new `jsonRes` with `headers.get`), and hn/se/devto tool tests.

---

## No Analog Found

None. Every file in scope extends an existing pattern in the repo.

**One partial gap the planner must synthesize (not an analog gap — a data gap):**

| Artifact | Role | Data Flow | Reason |
|----------|------|-----------|--------|
| `test/fixtures/stackexchange-noanswers.json` + `backoff`/`quota_remaining:0` variants | fixture | data | `backoff` never appears in live captures under normal load and `quota_remaining:0` only at exhaustion (Pitfall 1). Hand-synthesize by adding `"backoff": 3` and `"quota_remaining": 0` at top level of a captured no-answers response to exercise D-10. |

---

## Metadata

**Analog search scope:** `shared/http_client.js`, `shared/contract.js`, `servers/{hn,stackexchange,devto,lemmy}/server.js`, `test/{http_client,stackexchange}.test.js`, `test/fixtures/`.
**Files scanned:** 8 source/test files read in full + fixtures directory listing.
**Pattern extraction date:** 2026-07-10
</content>
</invoke>
