---
phase: 02-keyless-source-breadth
reviewed: 2026-07-02T00:00:00Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - servers/stackexchange/server.js
  - servers/lobsters/server.js
  - servers/lemmy/server.js
  - servers/hashnode/server.js
  - servers/devto/server.js
  - shared/credentials.js
  - shared/http_client.js
  - test/stackexchange.test.js
  - test/lobsters.test.js
  - test/lemmy.test.js
  - test/hashnode.test.js
  - test/devto.test.js
  - test/credentials.test.js
  - test/http_client.test.js
findings:
  critical: 1
  warning: 5
  info: 2
  total: 8
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-07-02T00:00:00Z
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

Five keyless source servers (Stack Exchange, Lobsters, Lemmy, Hashnode, Dev.to)
plus updates to `shared/credentials.js` and `shared/http_client.js`. The output
contract is respected everywhere: every list tool returns
`{ source, query, count, results[] }`, every detail tool returns
`{ source, item: {…, comments[]} }`, all field maps route through the shared
`normalizeItem`/`buildListEnvelope`/`buildDetailEnvelope` factories, and every
handler returns `toolResult()` (both `structuredContent` and JSON-text
`content`). No server calls `fetch` directly, and no server reads `process.env`
— both invariants hold. GraphQL (Hashnode) correctly passes user input only via
`variables`, never string-interpolated into the query body. SSRF surfaces are
sound: Lemmy's outbound host comes only from the operator-set `lemmyInstance()`,
and user params flow through `URLSearchParams`/`encodeURIComponent`.

However, the detail path has an inconsistent not-found story across the five
servers: Lemmy and Hashnode defensively guard a missing root object, but **Stack
Exchange does not and will throw an uncaught `TypeError` on a perfectly ordinary
"question id not found" response** (SE returns HTTP 200 with an empty `items`
array for missing ids). That is the one BLOCKER. The remaining findings concern
a credential-in-error-message leak on the SE path, a silently-ignored advertised
parameter, and not-found handling that returns a bogus placeholder item.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: `so_get_question` throws an uncaught TypeError when the question id is not found

**File:** `servers/stackexchange/server.js:201-209` (crash originates in `mapSeQuestion`, line 64)
**Issue:**
The Stack Exchange API returns **HTTP 200 with `{ "items": [] }`** for a question
id that does not exist (it does not 404). The handler passes the first element
straight into the mapper:

```js
const { item, comments } = mapSeDetail(raw.items?.[0], answers.items ?? []);
```

When `raw.items` is empty, `raw.items?.[0]` is `undefined`, and `mapSeDetail`
calls `mapSeQuestion(undefined)`, whose very first line dereferences the
argument:

```js
id: String(q.question_id),   // q is undefined -> TypeError: Cannot read properties of undefined
```

This crashes the tool with an uncaught `TypeError` on realistic user input (any
stale/typo'd id), violating the "a tool call never hard-errors" resilience
contract. Note the sibling servers already guard this: Lemmy uses
`pv?.post ?? {}` and Hashnode uses `raw?.data?.post ?? {}` — Stack Exchange is
the only detail path missing the guard.

**Fix:**
```js
async ({ id, site = "stackoverflow" }) => {
  const encId = encodeURIComponent(id);
  const raw = await getJson(seUrl(`/questions/${encId}`, { site }));
  const question = raw.items?.[0];
  if (!question) {
    throw new Error(`stackexchange: question ${id} not found on site ${site}`);
  }
  const answers = await getJson(
    seUrl(`/questions/${encId}/answers`, { site, sort: "votes", order: "desc" }),
  );
  const { item, comments } = mapSeDetail(question, answers.items ?? []);
  const env = buildDetailEnvelope({ source: SOURCE, item, comments });
  return toolResult(env);
}
```
(Prefer a clear "not found" error over a placeholder item; see WR-03.)

## Warnings

### WR-01: Stack Exchange API key is embedded in the request URL, leaking into error messages and the cache key

**File:** `servers/stackexchange/server.js:95-102` (with `shared/http_client.js:101` / `:68`)
**Issue:**
`seUrl()` folds `stackExchangeParams()` (which yields `{ key: <STACKEXCHANGE_KEY> }`)
into the query string:

```js
const qs = new URLSearchParams({ ...params, filter: "withbody", ...stackExchangeParams() });
return `${SE}${path}?${qs.toString()}`;   // -> ...&key=<SECRET>
```

Two invariant violations follow from the key living in the URL:
1. On any non-retryable failure, `getJson` throws
   `` new Error(`getJson: HTTP ${status} from ${url}`) `` (http_client.js:101),
   so the full URL — **including `key=<STACKEXCHANGE_KEY>`** — is echoed in the
   error surfaced back through the MCP tool result. CLAUDE.md and the phase
   security brief require that keys are "never logged or echoed in
   output/errors."
2. `getJson`'s default `cacheKey` is the URL itself (http_client.js:68), whose
   own doc states the cache key must "NEVER [be] a secret." The SE key becomes
   part of the cache key.

(The SE "key" is a low-sensitivity quota key by SE's own design, so real-world
blast radius is small — but this is a direct violation of the stated project
invariants and should not ship as-is.)

**Fix:** Keep the key out of the logged/keyed URL. Pass it separately and/or set
an explicit non-secret `cacheKey`. Minimal version — supply a sanitized cache
key that omits the key param:
```js
function seUrl(path, params) {
  const publicQs = new URLSearchParams({ ...params, filter: "withbody" });
  const authedQs = new URLSearchParams({ ...params, filter: "withbody", ...stackExchangeParams() });
  return {
    url: `${SE}${path}?${authedQs}`,
    cacheKey: `${SE}${path}?${publicQs}`, // no secret in the key or in logged errors
  };
}
// caller: const { url, cacheKey } = seUrl(...); await getJson(url, { cacheKey });
```
Additionally, consider stripping query strings from the URL in the http_client
error message (`new URL(url).origin + new URL(url).pathname`) as defense in depth.

### WR-02: `so_search` advertises a `sort` parameter it silently ignores

**File:** `servers/stackexchange/server.js:158-166`
**Issue:**
The `so_search` tool declares `sort: SORT.optional()` in its `inputSchema`, but
the handler never destructures or uses it:

```js
inputSchema: { query: z.string(), limit: ..., site: ..., sort: SORT.optional() },
...
async ({ query, limit = 20, site = "stackoverflow" }) => {   // <- no `sort`
  const raw = await getJson(seUrl("/search/advanced", {
    site, q: query, sort: "relevance", order: "desc", pagesize: String(limit),
  }));
```

A caller passing `sort` gets it silently discarded — the tool always uses
`relevance`. This is a misleading contract / dead input parameter. (Separately,
several `SORT` enum values — `hot`, `week`, `month` — are not valid sorts for
`/search/advanced`, so wiring `sort` through naively would break; the enum and
the endpoint's supported sorts should be reconciled.)

**Fix:** Either remove `sort` from `so_search`'s `inputSchema`, or honor it with
a search-endpoint-appropriate mapping/default:
```js
async ({ query, limit = 20, site = "stackoverflow", sort = "relevance" }) => {
  // validate sort against /search/advanced's supported set (relevance|votes|activity|creation)
  const raw = await getJson(seUrl("/search/advanced", { site, q: query, sort, order: "desc", pagesize: String(limit) }));
```

### WR-03: Detail tools return a bogus placeholder item on not-found instead of signaling absence

**File:** `servers/hashnode/server.js:227` (also `mapHashnodeDetail`, `:109-113`)
**Issue:**
`hashnode_get` guards the missing root with `?? {}`:

```js
const { item, comments } = mapHashnodeDetail(raw?.data?.post ?? {});
```

When the article does not exist (or GraphQL returns `data: null` with `errors`),
`mapHashnodeNode({})` produces `id: undefined`, which `normalizeItem` coerces to
the literal string `"undefined"`. The tool then returns a fully-formed but junk
detail envelope: `{ id: "undefined", type: "article", title: "", author: null,
score: null, …, comments: [] }`. This passes schema validation (so nothing
catches it) and misrepresents a not-found result as a real, empty article. The
same anti-pattern would apply to Stack Exchange once CR-01 is guarded — don't
"fix" CR-01 with `?? {}`.

**Fix:** Detect the missing root and throw a clear not-found error (or return a
documented empty sentinel), rather than mapping an empty object:
```js
const post = raw?.data?.post;
if (!post) throw new Error(`hashnode: article ${id} not found`);
const { item, comments } = mapHashnodeDetail(post);
```

### WR-04: `getJson`/`postJson` serve stale cache on non-retryable 4xx, masking gone/deleted resources indefinitely

**File:** `shared/http_client.js:100-123` (and `:196-219` for `postJson`)
**Issue:**
On a non-retryable status (any 4xx, incl. 404/400), the loop sets `lastError`
and `break`s, then unconditionally falls through to the stale check:

```js
lastError = new Error(`getJson: HTTP ${status} from ${url}`);
break;
...
const stale = getStale(cacheKey);
if (stale !== undefined) return stale;   // returns stale even for a 404
```

Because `shared/cache.js` never evicts entries (stale retained until process
restart, only overwritten by a successful refresh), a resource that was cached
successfully and later returns 404 (deleted) or 400 will be served from the
**stale cache forever**, with no upper bound on staleness. The stale-fallback is
intended for *transient* upstream failures (5xx/network/timeout), not for a
definitive client-error response that says the resource is gone. This can
silently surface deleted content as if live.

**Fix:** Scope the stale fallback to transient failures only. Track whether the
terminal failure was retryable (5xx/network/timeout) vs. a hard 4xx, and only
serve stale for the former:
```js
let servedByTransientFailure = false;
// ...on 4xx: lastError = ...; break;  (leave flag false)
// ...on retryable exhaustion / network / timeout: set servedByTransientFailure = true
if (servedByTransientFailure) {
  const stale = getStale(cacheKey);
  if (stale !== undefined) return stale;
}
throw lastError ?? new Error(`getJson: request to ${url} failed`);
```

### WR-05: `lobsters_get` and `devto_get` lack the not-found guard that CR-01 exposes

**File:** `servers/lobsters/server.js:151-155`, `servers/devto/server.js:230-239`
**Issue:**
Both detail handlers pass the fetched payload straight into a mapper that
dereferences it (`mapLobstersStory(s)` reads `s.short_id`/`s.title`;
`mapDevtoDetail(article, …)` reads `article.body_markdown`). Today these are
shielded because lobste.rs and Dev.to return HTTP 404 for a missing id (so
`getJson` throws before mapping). But the safety relies entirely on the upstream
choosing 404 over "200 + empty/odd body." Any deviation — an upstream that
returns `200 {}` , or a stale-cache hit of a malformed prior body — reintroduces
the CR-01 crash class. This is a latent defensive gap flagged for consistency
with the guards already present in Lemmy/Hashnode.

**Fix:** Add an explicit shape check before mapping, e.g.:
```js
const story = await getJson(`${LOBSTERS}/s/${encodeURIComponent(id)}.json`);
if (!story || story.short_id == null) throw new Error(`lobsters: story ${id} not found`);
```
and analogously guard `article?.id` in `devto_get`.

## Info

### IN-01: Comment typo — default SE site written as "stockoverflow"

**File:** `servers/stackexchange/server.js:11`
**Issue:** The header comment states the `site` param defaults to `"stockoverflow"`.
The code (lines 132, 166, 199) correctly defaults to `"stackoverflow"`. Comment
typo only — no runtime effect, but it can mislead a future maintainer.
**Fix:** Correct the comment to `"stackoverflow"`.

### IN-02: `lemmy_search` omits the `limit` parameter that every other list/search tool exposes

**File:** `servers/lemmy/server.js:176-181`
**Issue:** `lemmy_hot` and `lemmy_post`, and the search tools of the other four
servers, all accept a `limit`. `lemmy_search` does not, so callers cannot bound
result size and get Lemmy's default page size. Minor API inconsistency, not a
correctness bug.
**Fix:** Add `limit: z.number().int().min(1).max(50).optional()` and pass it as
`limit: String(limit)` in the `/search` query string.

---

_Reviewed: 2026-07-02T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
