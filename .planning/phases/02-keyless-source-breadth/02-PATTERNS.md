# Phase 2: Keyless Source Breadth - Pattern Map

**Mapped:** 2026-07-02
**Files analyzed:** 24 (2 shared-module edits + 5 servers + 5 manifests + 5 test files + 5 fixture pairs + 2 shared-test edits)
**Analogs found:** 24 / 24 (this phase is a mechanical replication of the Phase 1 HN template — every new file has an exact in-repo analog)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `shared/http_client.js` (add `postJson`) | utility (HTTP) | request-response | `getJson()` in same file (`shared/http_client.js:55-116`) | exact (sibling fn) |
| `shared/credentials.js` (add `lemmyInstance`) | config (cred resolver) | transform | `stackExchangeParams()` / `userAgent()` (`shared/credentials.js:54-57, 78-80`) | exact (sibling fn) |
| `servers/stackexchange/server.js` | controller (MCP server) | request-response + CRUD-read | `servers/hn/server.js` | exact |
| `servers/lobsters/server.js` | controller (MCP server) | request-response + CRUD-read | `servers/hn/server.js` | exact |
| `servers/lemmy/server.js` | controller (MCP server) | request-response + auth | `servers/hn/server.js` + `shared/auth.js` `lemmyJwt()` | exact + auth-wire |
| `servers/hashnode/server.js` | controller (MCP server) | request-response (GraphQL POST) | `servers/hn/server.js` + new `postJson()` | role-exact, verb-differs |
| `servers/devto/server.js` | controller (MCP server) | request-response + client-side filter | `servers/hn/server.js` | exact |
| `servers/<name>/manifest.json` (×5) | config (mcpb scaffold) | n/a | `servers/hn/manifest.json` | exact |
| `test/<name>.test.js` (×5) | test | n/a | `test/hn.test.js` | exact |
| `test/fixtures/<source>-{list,detail}.json` (×5 pairs) | test fixture | file-I/O | `test/fixtures/hn-{story,job,item}.json` | exact |
| `test/http_client.test.js` (add `postJson` cases) | test | n/a | `test/http_client.test.js` (existing `getJson` cases) | exact |
| `test/credentials.test.js` (add `lemmyInstance` case) | test | n/a | `test/credentials.test.js:93-103` (`stackExchangeParams` cases) | exact |

**Sequencing note (from RESEARCH):** the two shared-module edits are blocking prerequisites — `lemmyInstance()` gates `servers/lemmy/`, and `postJson()` gates `servers/hashnode/`. Land both (with their tests) before the servers that depend on them. Plan split: 02-01 Stack Exchange (self-contained) · 02-02 Lobsters + Lemmy (needs `lemmyInstance()`) · 02-03 Hashnode + Dev.to (needs `postJson()`).

---

## Pattern Assignments

### `shared/http_client.js` — add `postJson()` (utility, request-response)

**Analog:** the existing `getJson()` in the same file — copy its cache→fetch→retry→stale skeleton verbatim and change only the HTTP verb + cache-key derivation.

**Reuse the exact same module constants** (`shared/http_client.js:22-30`): `BACKOFF_MS`, `RETRYABLE_5XX`, `DEFAULT_TTL_MS`, `DEFAULT_TIMEOUT_MS`, `realSleep`, `class RetryableError`, and `fetchWithTimeout`. Do NOT duplicate these — `postJson` shares them.

**`fetchWithTimeout` needs a POST-capable variant.** The current helper (`shared/http_client.js:32-40`) hardcodes `{ headers, signal }`. For POST, pass `method`/`body` too. Recommended: extend the init object rather than fork the function:
```javascript
// current (GET-only) — shared/http_client.js:32-40
async function fetchWithTimeout(fetchImpl, url, headers, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
// generalize init so postJson can add method/body without a second copy:
//   fetchImpl(url, { ...init, signal: controller.signal })
```

**Retry/stale loop to copy verbatim** (`shared/http_client.js:68-115`): the `for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++)` body — `response.ok` → `response.json()` (catch → `RetryableError`) → `set(cacheKey, value, ttlMs)`; `RETRYABLE_5XX` → retry; any 4xx → `break`; catch-block `isTimeout`/`isNetwork`/`RetryableError` classification; final `getStale(cacheKey)` fallback then `throw lastError`.

**The ONLY differences from `getJson`:**
1. Signature `postJson(url, { body, headers = {}, ttlMs, timeoutMs, cacheKey, fetchImpl, sleep } = {})`.
2. Send the request as POST: `fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal })`.
3. **Cache key must fold in the body** (RESEARCH A5 / Gap 1): default `cacheKey = url + ":" + <stable hash of JSON.stringify(body)>` so two different GraphQL queries to the same `gql.hashnode.com` URL do not collide. Use a Node built-in for the hash — `import { createHash } from "node:crypto"; createHash("sha1").update(JSON.stringify(body)).digest("hex")` — no new dependency (mirrors the "use Node built-ins" rule, cf. `Buffer` use in `shared/auth.js:60`).

**Cache-key secret hygiene** (`shared/cache.js:8`, `shared/http_client.js:51`): the cache key is a logical key and must NEVER contain a secret. Hashnode is keyless so `url+hash(body)` is safe; keep this invariant.

---

### `shared/credentials.js` — add `lemmyInstance()` (config, transform)

**Analog:** `stackExchangeParams()` (`shared/credentials.js:54-57`) and `userAgent()` (`shared/credentials.js:78-80`) — both read one env var via the private `get()` and apply a fallback.

**`LEMMY_INSTANCE` is already registered** in the `ENV_VAR` map (`shared/credentials.js:27`) — no map edit needed; just add the exported helper. Use the single `get()` accessor (`shared/credentials.js:35`) — never touch `process.env` directly.

**Pattern to copy** (defaulted optional, like `userAgent` at `shared/credentials.js:78-80`):
```javascript
/**
 * Lemmy instance base URL for anonymous reads (D-05). Full URL incl. scheme so
 * callers interpolate `${lemmyInstance()}/api/v3/...` exactly as auth.js does
 * (see shared/auth.js:93). Defaults to programming.dev (dev-topic relevance).
 */
export const lemmyInstance = () => get("lemmyInstance") || "https://programming.dev";
```

**Scheme convention is load-bearing** (`shared/auth.js:92-93`): `lemmyJwt()` builds `` `${c.instance}/api/v3/user/login` ``, so the returned value MUST include the `https://` scheme and no trailing slash. The default `"https://programming.dev"` matches. Document that `LEMMY_INSTANCE` is operator-set (not a tool param) — SSRF mitigation from RESEARCH Security Domain.

---

### `servers/stackexchange/server.js` (controller, request-response)

**Analog:** `servers/hn/server.js` (copy structure verbatim).

**Imports block to copy** (`servers/hn/server.js:15-26`):
```javascript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { getJson } from "../../shared/http_client.js";
import {
  buildListEnvelope, buildDetailEnvelope,
  listEnvelopeShape, detailEnvelopeShape, toolResult,
} from "../../shared/contract.js";
```
Add `import { stackExchangeParams } from "../../shared/credentials.js";` for the optional key.

**Constants** — mirror `servers/hn/server.js:28-29`: `const SE = "https://api.stackexchange.com/2.3"; const SOURCE = "stackexchange";`

**Field-map helper** — analog is `mapHnHit` (`servers/hn/server.js:74-88`); pure field mapping, no derived text (normalize/strip happens downstream). SE specifics (RESEARCH SRC-01 table):
- `id: String(q.question_id)`, `type: "question"`, `author: q.owner?.display_name ?? null`
- `score: q.score ?? null` (votes), `num_comments: q.answer_count ?? null` (answers)
- **`created_utc`: epoch SECONDS** → `new Date(q.creation_date * 1000).toISOString()` (RESEARCH Pitfall 3 — HN's `toIso` at `servers/hn/server.js:58-64` is the analog for the seconds→ISO conversion via `created_at_i`)
- `url`/`permalink: q.link`, `tags: q.tags ?? []`, `text: q.body_markdown ?? null`

**Detail helper** — analog `mapHnItem` (`servers/hn/server.js:95-115`), returns `{ item, comments }`. SE maps **answers → `comments[]`** (`answer_id`→id, `owner.display_name`→author, `body_markdown`→text). Flatten top level only (CONTEXT carried-forward decision).

**Tool wiring** — copy the three `server.registerTool(...)` blocks (`servers/hn/server.js:127-191`) exactly; change names to `so_hot_questions` / `so_search` / `so_get_question` (D-02, names fixed). Handler body pattern (`servers/hn/server.js:137-147`):
```javascript
async ({ limit = 20, site = "stackoverflow", sort = "hot" }) => {
  const params = new URLSearchParams({
    site, sort, order: "desc", pagesize: String(limit), filter: "withbody",
    ...stackExchangeParams(),   // {key} or {} — D-04, CRED-04
  });
  const raw = await getJson(`${SE}/questions?${params}`);
  const env = buildListEnvelope({ source: SOURCE, query: null, results: (raw.items ?? []).map(mapSeQuestion) });
  return toolResult(env);
}
```
**`filter=withbody` is mandatory** on every question/answer/detail call (D-04, RESEARCH Pitfall 2) or `text` normalizes to null silently. `site` is a free passthrough default `stackoverflow` (D-03). Response wrapper is `{ items: [...] }` (not `hits`).

**Input schema shapes** — raw Zod, never `z.object(...)` (RESEARCH Pitfall 7). Mirror `servers/hn/server.js:132-135, 155-159, 180-182`: `limit: z.number().int().min(1).max(50).optional()`, `query: z.string()`, `id: z.union([z.string(), z.number()])`, plus `site: z.string().optional()` and `sort: z.enum([...]).optional()`. `outputSchema: listEnvelopeShape` / `detailEnvelopeShape`.

**Direct-run guard** — copy verbatim (`servers/hn/server.js:195-200`).

**`encodeURIComponent`** every interpolated `site`/`query`/`id` (RESEARCH Pitfall 8; `URLSearchParams` handles query params, but path segments like `/questions/${id}` need explicit encoding as in `servers/hn/server.js:186`).

---

### `servers/lobsters/server.js` (controller, request-response)

**Analog:** `servers/hn/server.js` (verbatim structure). No auth, no credentials import.

**Constants:** `const LOBSTERS = "https://lobste.rs"; const SOURCE = "lobsters";`

**Field map** (analog `mapHnHit`, `servers/hn/server.js:74-88`) — Lobsters specifics (RESEARCH SRC-02, VERIFIED live):
- `id: s.short_id` (already string), `type: "story"`, **`author: s.submitter_user`** (plain STRING now — NOT `.username`; RESEARCH Pitfall 6)
- `score: s.score ?? null` (upvotes), `num_comments: s.comment_count ?? null`
- `created_utc: s.created_at` (ISO already — no conversion), `url: s.url ?? null`, `permalink: s.comments_url ?? s.short_id_url`
- `tags: s.tags ?? []`, `text: s.description_plain ?? s.description ?? null`

**Detail** (analog `mapHnItem`) — `/s/{short_id}.json` carries `comments[]`; flatten top level: `short_id`→id, `commenting_user`→author, `comment_plain ?? comment`→text.

**Tools:** `lobsters_hottest` → `GET /hottest.json`; `lobsters_tag` → `GET /t/${encodeURIComponent(tag)}.json`; `lobsters_get` → `GET /s/${encodeURIComponent(id)}.json`. **Optional `lobsters_search`** (D-01 uniform surface, RESEARCH Open Q3) → client-side filter over `/hottest.json` — see Shared Pattern "Client-side search window" below.

---

### `servers/lemmy/server.js` (controller, request-response + auth)

**Analog:** `servers/hn/server.js` for structure + `shared/auth.js` `lemmyJwt()` (`shared/auth.js:89-102`) for the auth wire + new `lemmyInstance()` for the base URL.

**Imports add:** `import { lemmyInstance } from "../../shared/credentials.js"; import { lemmyJwt } from "../../shared/auth.js";`

**Base URL from helper (D-05):** `const base = lemmyInstance();` then `` `${base}/api/v3/...` `` — same interpolation `auth.js` uses (`shared/auth.js:93`). `const SOURCE = "lemmy";`

**Auth-header wiring (D-06) — the phase's end-to-end auth exercise:**
```javascript
// lemmyJwt() returns the cached jwt when LEMMY_* creds are present, else null
// (shared/auth.js:89-91). Add the Bearer header only when non-null; absent => anonymous.
const jwt = await lemmyJwt();
const headers = jwt ? { Authorization: `Bearer ${jwt}` } : {};
const raw = await getJson(`${base}/api/v3/post/list?type_=All&sort=Hot&limit=${limit}`, { headers });
```
`getJson`'s `headers` option (`shared/http_client.js:57`) is the exact seam for this — no new HTTP code.

**Field map** (analog `mapHnHit`) — Lemmy `PostView` (RESEARCH SRC-03):
- `id: String(pv.post.id)`, `type: "post"`, `title: pv.post.name` (Lemmy names the title `name`), `author: pv.creator?.name ?? null`
- `score: pv.counts?.score ?? null`, `num_comments: pv.counts?.comments ?? null`
- `created_utc: pv.post.published` (ISO already), `url: pv.post.url ?? null`, `permalink: pv.post.ap_id`
- `tags: []` (Lemmy has no post tags; planner discretion), `text: pv.post.body ?? null`

**Tools:** `lemmy_hot` → `/post/list?type_=All&sort=Hot&limit=` (D-05 federated `All`); `lemmy_search` → `/search?q=&type_=Posts&listing_type=All` (native, response `{ posts: [PostView] }`); `lemmy_post` → `/post?id=` (`{ post_view }`) + `/comment/list?post_id=&max_depth=1&sort=Hot` (`{ comments: [CommentView] }`) → `comments[]` (`comment.id`→id, `creator.name`→author, `comment.content`→text).

---

### `servers/hashnode/server.js` (controller, GraphQL POST)

**Analog:** `servers/hn/server.js` for structure + new `postJson()` for transport. **Uses `postJson`, NOT `getJson`** (GraphQL is POST-only — RESEARCH Gap 1 / Pitfall 1). Never call `fetch` directly.

**Imports:** `import { postJson } from "../../shared/http_client.js";` (plus the usual contract imports). `const HASHNODE = "https://gql.hashnode.com"; const SOURCE = "hashnode";`

**GraphQL call pattern (never string-concat user input — RESEARCH anti-pattern / Security V5):**
```javascript
const FEED_QUERY = `query Feed($first: Int!, $filter: FeedFilter) { feed(first:$first, filter:$filter){ edges{ node{ id title brief url publishedAt reactionCount responseCount author{name username} tags{name slug id} } } } }`;
const raw = await postJson(HASHNODE, {
  body: { query: FEED_QUERY, variables: { first: limit, filter: { type: "FEATURED" } } },
});
const nodes = (raw.data?.feed?.edges ?? []).map((e) => e.node);
```

**Field map** (analog `mapHnHit`) — Hashnode `Post`/feed node (RESEARCH SRC-04; A2 confirm `reactionCount`/`responseCount` at Execute):
- `id: node.id`, `type: "article"`, `author: node.author?.name ?? node.author?.username ?? null`
- `score: node.reactionCount ?? null` (reactions), `num_comments: node.responseCount ?? null` (responses)
- `created_utc: node.publishedAt` (ISO), `url`/`permalink: node.url`, `tags: (node.tags ?? []).map(t => t.slug)`
- `text: node.brief` (list) / `node.content?.markdown` (detail)

**Detail** — `post(id: ID!)` query; `comments.edges[].node` → `comments[]` (top level only). **Search** — no global native search; use D-01 client-side filter over the `feed` window (RESEARCH correction + Open Q1). **Trending-by-tag** — `FeedFilter.tags` needs ObjectIds not slugs; client-side-filter the featured feed on `tags[].slug` (RESEARCH Pitfall 5 / Open Q2).

---

### `servers/devto/server.js` (controller, request-response + client-side filter)

**Analog:** `servers/hn/server.js` (verbatim). No auth.

**Constants:** `const DEVTO = "https://dev.to/api"; const SOURCE = "devto";` Send the Forem header via `getJson`'s `headers` opt: `getJson(url, { headers: { Accept: "application/vnd.forem.api-v1+json" } })` (RESEARCH SRC-05).

**Field map** (analog `mapHnHit`) — Dev.to article (RESEARCH SRC-05):
- `id: String(a.id)`, `type: "article"`, `author: a.user?.username ?? a.user?.name ?? null`
- `score: a.public_reactions_count ?? null`, `num_comments: a.comments_count ?? null`
- `created_utc: a.published_at` (ISO), `url`/`permalink: a.url`, `tags: a.tag_list ?? []`
- **`text: a.description` (list) / `a.body_markdown` (detail)** — list objects OMIT body (RESEARCH SRC-05 "List vs detail")

**Tools:** trending → `/articles?top=7&per_page=`; by-tag → `&tag=`; detail → `/articles/${id}` (full body); comments → `/comments?a_id=${id}` (`id_code`→id, `user.username`→author, `body_html`→text, flatten top level, drop `children`). **`devto_search`** → D-01 client-side filter over `/articles?top=7&per_page=<window>` (no native search).

---

### `servers/<name>/manifest.json` (×5) (config scaffold)

**Analog:** `servers/hn/manifest.json` (verbatim shape). Change `name` to `medium-research-<source>` and `description`. **No `build-mcpb.sh`** — HN omits it; packaging (PKG-01) is deferred to v2 (RESEARCH "Recommended Project Structure"). Keep the `server.type: "node"` / `entry_point` / `mcp_config` block (`servers/hn/manifest.json:25-36`). Stack Exchange is the only Phase-2 server with an optional credential: add a `user_config` field `stackexchange_key` with `"sensitive": true, "required": false` and wire `STACKEXCHANGE_KEY: "${user_config.stackexchange_key}"` into `mcp_config.env`, mirroring the pattern documented at `servers/hn/manifest.json:9-24, 31-35`. Lobsters/Hashnode/Dev.to need no `user_config`; Lemmy's creds are optional operator env (may document `LEMMY_*` fields the same way).

---

### `test/<name>.test.js` (×5) (test)

**Analog:** `test/hn.test.js` (verbatim structure). Two offline concerns (`test/hn.test.js:1-10`):
1. **Field-map units** over real captured fixtures — assert exact contract fields (see `test/hn.test.js:39-149`), including a **null-`score`/`num_comments`** case per source where the source can omit the datum (analog `test/hn.test.js:81-87`).
2. **Registration smoke** — `Object.keys(server._registeredTools).sort()` equals the three tool names (`test/hn.test.js:173-178`); each declares an `outputSchema` (`test/hn.test.js:180-187`).

**Fixture loader to copy** (`test/hn.test.js:25-31`): `readFileSync(fileURLToPath(new URL(\`./fixtures/${name}.json\`, import.meta.url)))`. **Contract-conformance assertion** (`test/hn.test.js:153-169`): build the envelope and `assert.doesNotThrow(() => ListEnvelopeSchema.parse(env))` / `DetailEnvelopeSchema.parse(env)` — this is the OUT-01 guarantee per source.

**HTML-strip-through-contract check** (`test/hn.test.js:89-106, 139-149`): map raw text with markup, build the envelope, assert no tags remain and entities decoded — proves the server does NOT hand-roll stripping.

**Client-side-search sources** (Dev.to, Lobsters, Hashnode) additionally need a unit asserting the substring filter matches within the window and returns contract items.

---

### `test/fixtures/<source>-{list,detail}.json` (×5 pairs) (fixture)

**Analog:** `test/fixtures/hn-story.json` / `hn-job.json` / `hn-item.json`. **Real payloads captured once** (`test/hn.test.js:9-10`) — capture live during Execute (SE, Lemmy, Hashnode, Dev.to field maps are MEDIUM-confidence; A1–A5 in RESEARCH must be pinned against a captured fixture). SE fixture MUST be captured with `filter=withbody` so a body-present assertion is possible (RESEARCH A1).

---

### `test/http_client.test.js` — add `postJson` cases (test)

**Analog:** the existing `getJson` cases in the same file. Reuse the `res()`/`fetchStub()`/`sleepSpy()` harness verbatim (`test/http_client.test.js:10-44`). Add: (a) a POST cache-hit test where a second identical `postJson` serves from cache and `fetchImpl.calls === 1` (analog `test/http_client.test.js:47-55`); (b) **two different bodies to the same URL do NOT collide** (distinct cache keys — validates the `url+hash(body)` design); (c) 5xx-retry + 4xx-no-retry parity (analog `test/http_client.test.js:58-154`); (d) assert the request init carries `method: "POST"` and a JSON body (inspect `init` as `test/auth.test.js:41-46` does).

---

### `test/credentials.test.js` — add `lemmyInstance` case (test)

**Analog:** `stackExchangeParams` cases (`test/credentials.test.js:93-103`) using the `withEnv` helper (`test/credentials.test.js:38-53`; `LEMMY_INSTANCE` is already in `ALL_VARS` at line 30). Two cases: default `"https://programming.dev"` when unset; the configured value when `LEMMY_INSTANCE` is set (analog `test/credentials.test.js:179-191` `userAgent`).

---

## Shared Patterns

### Contract assembly (apply to ALL five servers)
**Source:** `shared/contract.js` — `buildListEnvelope` (`:116-119`), `buildDetailEnvelope` (`:121-133`), `normalizeItem` (`:100-114`), `stripHtml` (`:76-94`), `toolResult` (`:139-144`), `listEnvelopeShape`/`detailEnvelopeShape` (`:58-71`).
**Rule:** each server is PURE field-mapping into a raw contract item; defaulting, `String(id)` coercion, and HTML stripping happen inside `normalizeItem`. Never re-implement any of it. `score`/`num_comments` set to `null` when absent — never renamed or dropped (`shared/contract.js:41-42`, CLAUDE.md "DO NOT BREAK").
```javascript
// every list handler ends with (analog servers/hn/server.js:141-146):
const env = buildListEnvelope({ source: SOURCE, query, results: rows.map(mapSource) });
return toolResult(env);
```

### HTTP path (apply to ALL five servers)
**Source:** `shared/http_client.js` — `getJson()` for GET sources (SE, Lobsters, Lemmy, Dev.to), new `postJson()` for Hashnode. **Never call `fetch` directly in a server** (CLAUDE.md; RESEARCH Pitfall 1). Custom headers (Dev.to Accept, Lemmy Bearer) go through the `headers` option (`shared/http_client.js:57`).

### `registerTool` raw-shape wiring (apply to ALL five servers)
**Source:** `servers/hn/server.js:127-191`. At SDK 1.29 pass RAW Zod shapes for `inputSchema` and `listEnvelopeShape`/`detailEnvelopeShape` for `outputSchema` — NEVER `z.object(...)` (RESEARCH Pitfall 7; `shared/contract.js:9-12`). Bound `limit` with `.min(1).max(50)` (DoS mitigation, RESEARCH Security Domain).

### Direct-run transport guard (apply to ALL five servers)
**Source:** `servers/hn/server.js:195-200`. Copy verbatim so importing the server for tests does NOT open a live stdio transport:
```javascript
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await server.connect(new StdioServerTransport());
}
```

### Client-side search window — D-01 (apply to Dev.to, Lobsters, Hashnode-global)
**Source:** RESEARCH Pattern 3 (no in-repo analog — HN has native search). Fetch a top/recent window, substring-match `title`+`tags`+`text`, then map. **State the window size in the tool description** so the consumer knows the limitation.
```javascript
const q = query.toLowerCase();
const hits = rows.filter((r) =>
  `${r.title} ${(r.tags ?? []).join(" ")} ${r.text ?? ""}`.toLowerCase().includes(q));
const env = buildListEnvelope({ source: SOURCE, query, results: hits.map(mapSource) });
```

### URL-segment encoding (apply to ALL five servers)
**Source:** `servers/hn/server.js:163, 186`. `encodeURIComponent` every interpolated user value — `site`, `tag`, `community`, `query`, `id` (RESEARCH Pitfall 8 / Security: injection into constructed URL). GraphQL user input goes via `variables`, never string-concatenated into the query (Hashnode).

### Credential resolution (apply to SE + Lemmy)
**Source:** `shared/credentials.js` — `stackExchangeParams()` (`:54-57`, optional key → `{key}` or `{}`), new `lemmyInstance()`, `lemmyCreds()` (`:102-107`, gates auth). Servers NEVER read `process.env` (CLAUDE.md; enforced by the single `get()` at `shared/credentials.js:35`). Optional creds degrade gracefully (SE keyless, Lemmy anonymous) — never hard-error (CRED-04).

### Lemmy auth wire (apply to Lemmy only)
**Source:** `shared/auth.js` `lemmyJwt()` (`:89-102`) — already implements the cached login exchange; the server only calls it and conditionally adds `Authorization: Bearer <jwt>`. `lemmyJwt()` returns `null` when creds absent → anonymous reads (D-06). Password never logged/cached (`shared/auth.js:8-11`).

---

## No Analog Found

No file in this phase lacks an in-repo analog. Two capabilities have no *behavioral* precedent (only structural analogs), flagged so the planner sequences them first:

| Capability | Nearest Analog | Gap |
|------------|----------------|-----|
| HTTP POST + cache (Hashnode) | `getJson()` (GET-only) `shared/http_client.js:55-116` | new verb + body-aware cache key; reuses the same retry/stale machinery |
| Anonymous Lemmy instance override | `stackExchangeParams()` / `userAgent()` `shared/credentials.js:54-80` | new helper reading `LEMMY_INSTANCE` (env var already mapped) with default |
| Client-side search filter (D-01) | none — HN uses native search | new per-handler substring filter (RESEARCH Pattern 3) for Dev.to / Lobsters / Hashnode-global |

## Metadata

**Analog search scope:** `servers/hn/`, `shared/` (all 5 modules), `test/` (all suites + fixtures)
**Files scanned:** 15 read in full (server, 5 shared modules, manifest, 4 test files, cache) + directory listings
**Pattern extraction date:** 2026-07-02
