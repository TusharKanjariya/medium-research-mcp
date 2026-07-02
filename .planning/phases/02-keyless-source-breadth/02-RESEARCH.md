# Phase 2: Keyless Source Breadth - Research

**Researched:** 2026-07-02
**Domain:** MCP source servers over 5 public developer-community APIs (Stack Exchange, Lobsters, Lemmy, Hashnode, Dev.to) — field-mapping onto a fixed output contract
**Confidence:** HIGH (contract/patterns), MEDIUM (per-API field maps, verified against docs + one live payload)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01 — Uniform `*_search` surface:** Every source exposes a working `*_search`. Where a source lacks real full-text search (Dev.to; Lobsters), `*_search` does **client-side filtering**: fetch a recent/top page via the list endpoint, then substring-match the query against `title` + `tags` + `text`, returning contract items. **Documented caveat:** matches only within the fetched window (state the window size in the tool description). Sources with native search use it directly.
- **D-02 — SE tool names fixed:** `so_hot_questions` / `so_search` / `so_get_question` (network-wide despite the `so_` prefix).
- **D-03 — SE `site` param:** defaults to `stackoverflow`, **free passthrough** — any site string forwarded to the SE API (it validates and errors on unknown sites). No local whitelist.
- **D-04 — SE key optional:** use `stackExchangeParams()`; include `STACKEXCHANGE_KEY` when present, run keyless otherwise (CRED-04). SE bodies require a `filter` to be returned — so `text` isn't silently empty.
- **D-05 — Lemmy instance:** anonymous reads default to `programming.dev`, listing type `All` (federated), overridable via `LEMMY_INSTANCE`.
- **D-06 — Lemmy auth:** when `LEMMY_*` present, auto-authenticate via `auth.js` `lemmyJwt()` and send `Authorization: Bearer <jwt>` on reads (the end-to-end auth exercise). Absent creds → anonymous reads (no hard error).
- **D-07 — Hot/trending semantics:** each source's hot/trending tool defaults to that API's native trending notion, with optional `sort`/time override. SE → hot (default)/votes; Dev.to → top of past week; Hashnode → trending feed; Lobsters → hottest.
- **Carried from Phase 1:** contract enforced by shared modules (pure field-mapping into `normalizeItem()`, reuse raw Zod shapes as `outputSchema`); **detail = top-level comments only** (SE answers→`comments[]` + answer count→`num_comments`; others flatten top level); `node:test`+`node:assert`; single root `package.json`; fetch only through `getJson()`; never read `process.env` outside `credentials.js`.

### Claude's Discretion
- Exact `normalize*`/field-map function names per server, URL/query builders, SE `filter` id to surface body text, Hashnode GraphQL query strings, Dev.to page size for the search window, Lemmy sort enum values — all planner/executor calls, provided the contract (ARCHITECTURE §4) and §5 per-source `score`/`num_comments` meaning hold.
- Per-source `type` enum mapping (SE→`question`, Lobsters→`story`, Dev.to/Hashnode→`article`, Lemmy→`post`).

### Deferred Ideas (OUT OF SCOPE)
- Full-corpus search / pagination cursors for client-side-filtered sources (revisit if the window proves too narrow).
- Dedicated Reddit `.json` source server (covered via RSS `.rss` in Phase 4).
- Additional Stack Exchange convenience tools (site discovery, tag browsing) beyond the three roadmap-fixed tools.
- Keyed sources (GitHub/Libraries.io/Product Hunt = Phase 3), RSS + YouTube (Phase 4).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SRC-01 | Stack Exchange server (`so_hot_questions`, `so_search`, `so_get_question`) network-wide via `site`, optional `STACKEXCHANGE_KEY` | SE API 2.3 endpoints + `filter=withbody` + `stackExchangeParams()` documented below |
| SRC-02 | Lobsters server (`lobsters_hottest`, `lobsters_tag`, `lobsters_get`), no auth | `.json` endpoints + field map (verified against live payload) below |
| SRC-03 | Lemmy server (`lemmy_hot`, `lemmy_search`, `lemmy_post`); auto-auth when `LEMMY_*` present | v3 endpoints + `lemmyJwt()` header wiring + **new `lemmyInstance()` helper needed** (see Gaps) |
| SRC-04 | Hashnode server (trending by tag, search, article) via public GraphQL, no auth | `gql.hashnode.com` `feed`/`post`/search queries below — **requires shared POST path (see Gaps)** |
| SRC-05 | Dev.to server (trending by tag, search, article), no auth | Forem v1 `/articles`, `/articles/{id}`, `/comments?a_id=` field map below |
</phase_requirements>

## Summary

This phase adds five source servers, each a mechanical copy of `servers/hn/server.js`: write a field-map + URL/query builder on top of the shared modules and let `buildListEnvelope`/`buildDetailEnvelope`/`normalizeItem`/`stripHtml`/`toolResult` do the rest. The contract is structurally enforced, so the real work is (a) getting each source's field map exactly right (§5 `score`/`num_comments` meanings) and (b) two shared-infrastructure gaps that block a clean copy for two of the five sources.

**Two blocking findings the planner MUST sequence first:**

1. **`getJson()` is GET-only — Hashnode needs POST.** `shared/http_client.js` issues only `GET` (no `method`/`body` option). Hashnode's GraphQL API is **POST-only**. Since CLAUDE.md forbids calling `fetch` directly in a server, Hashnode cannot be built until a shared POST path exists. Recommended: add `postJson(url, { body, headers })` to `shared/http_client.js` that reuses the same cache/retry/stale machinery, cache-keyed on `url + hash(body)`. This is a prerequisite task for the 02-03 (Hashnode) plan.

2. **Lemmy anonymous instance override has no helper.** The server can't read `process.env`, and `lemmyCreds()` returns the instance **only when username+password are also present**. For anonymous reads against a `LEMMY_INSTANCE` override (D-05), a new `lemmyInstance()` helper is needed in `credentials.js` returning `LEMMY_INSTANCE || "https://programming.dev"` (full URL incl. scheme — `auth.js` interpolates `${instance}/api/v3/...`).

A third correction: **Hashnode has no global full-text search.** Its native search (`searchPostsOfPublication`) is *publication-scoped*. CONTEXT.md D-01 assumed Hashnode "uses native search directly" — that only works within one publication. For a global `hashnode_search`, fall back to the D-01 client-side-filter approach over the `feed` window (recommended), or accept a `publication` host param.

**Primary recommendation:** Land the two shared-infra prerequisites (`postJson`, `lemmyInstance`) first, then build the five servers by pure field-mapping. Order the plan split as scoped: 02-01 Stack Exchange (self-contained), 02-02 Lobsters + Lemmy (Lemmy needs `lemmyInstance()`), 02-03 Hashnode + Dev.to (Hashnode needs `postJson`).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| HTTP GET + cache/retry/stale | `shared/http_client.js` `getJson()` | — | Single HTTP path (CLAUDE.md); already exists |
| HTTP POST (GraphQL) + cache | `shared/http_client.js` `postJson()` **(new)** | — | Hashnode is POST-only; must not bypass shared path |
| Credential/env resolution | `shared/credentials.js` | — | Only module allowed to read `process.env` |
| Username/password → cached jwt | `shared/auth.js` `lemmyJwt()` | `credentials.js` `lemmyCreds()` | Already built; Lemmy server just wires the header |
| Field map (source → item) | per-server `map*()` helpers | — | The ONLY per-source logic |
| Contract assembly / HTML strip | `shared/contract.js` factories | — | Structurally uniform; never re-implemented per server |
| Client-side search filter (D-01) | per-server handler (substring over fetched window) | `contract.js` normalize | Dev.to, Lobsters, Hashnode-global lack real search |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | ^1.29.0 | MCP server + `registerTool` (raw Zod shapes) | Already in root `package.json`; Phase 1 pattern |
| `zod` | ^4.4 | input/output schemas | Already in root `package.json` |

**No new dependencies.** All five servers reuse the two packages already installed. `Buffer`, `fetch`, `URLSearchParams`, `URL` are Node built-ins (Node ≥18). Do **not** add a GraphQL client, an HTTP client (axios/got), or an HTML-to-text library — the shared modules and native `fetch` cover everything.

### Supporting (shared modules — reuse, do not reimplement)
| Module | Purpose | When to Use |
|--------|---------|-------------|
| `shared/http_client.js` `getJson(url, {headers})` | all GET + cache/retry/stale | every list/detail fetch |
| `shared/http_client.js` `postJson()` **(to add)** | GraphQL POST + cache/retry/stale | Hashnode only |
| `shared/contract.js` | `buildListEnvelope`, `buildDetailEnvelope`, `normalizeItem`, `stripHtml`, `toolResult`, `listEnvelopeShape`, `detailEnvelopeShape` | every handler |
| `shared/credentials.js` | `stackExchangeParams()`, `lemmyCreds()`, `lemmyInstance()` **(to add)**, `userAgent()` | SE key, Lemmy instance/auth, outbound UA |
| `shared/auth.js` | `lemmyJwt()` cached login → jwt | Lemmy authenticated reads |

**Installation:** none — `npm install` already satisfied.

**Version verification:** `@modelcontextprotocol/sdk@^1.29.0` and `zod@^4.4` are pinned in the committed root `package.json` and proven by the passing Phase 1 test suite. `[VERIFIED: package.json + Phase 1 tests]`

## Package Legitimacy Audit

> No external packages are installed in this phase — all five servers reuse the two dependencies already vetted and installed in Phase 1.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `@modelcontextprotocol/sdk` | npm | established | high | github.com/modelcontextprotocol/typescript-sdk | OK (Phase 1) | Already installed |
| `zod` | npm | established | very high | github.com/colinhacks/zod | OK (Phase 1) | Already installed |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
Claude Desktop (stdio)
      │  tool call: {so_hot_questions | lobsters_tag | lemmy_search | hashnode_feed | devto_top | ...}
      ▼
servers/<source>/server.js  (registerTool handlers — RAW Zod shapes)
      │
      │ 1. build URL / GraphQL body   ── encodeURIComponent user params
      │ 2. resolve creds (optional)   ── credentials.js: stackExchangeParams() / lemmyInstance() / lemmyCreds()
      │        └── Lemmy auth path ──► auth.js lemmyJwt() ─► Authorization: Bearer <jwt>
      ▼
shared/http_client.js
   getJson(url,{headers})            ── GET sources (SE, Lobsters, Lemmy, Dev.to)
   postJson(url,{body,headers}) NEW  ── Hashnode GraphQL (POST-only)
      │  cache(15m) → fetch → retry(0.5/1/2s, no-4xx) → stale fallback
      ▼
   raw source JSON
      │
      ▼
per-server map*()  ── PURE field map onto raw contract item(s)
      │
      ▼
shared/contract.js
   buildListEnvelope / buildDetailEnvelope → normalizeItem (defaults + stripHtml)
   toolResult(envelope) → { content:[{type:text,...}], structuredContent }
      │
      ▼
   uniform { source, query, count, results[] } | { source, item{...,comments[]} }
```

Client-side-search sources (Dev.to, Lobsters, Hashnode-global) insert one step between fetch and map: fetch a list window, then `filter()` raw rows on `title`+`tags`+`text` substring before mapping.

### Recommended Project Structure
```
servers/
├── stackexchange/   server.js  manifest.json      # so_hot_questions/so_search/so_get_question
├── lobsters/        server.js  manifest.json      # lobsters_hottest/lobsters_tag/lobsters_get
├── lemmy/           server.js  manifest.json      # lemmy_hot/lemmy_search/lemmy_post
├── hashnode/        server.js  manifest.json      # trending/search/article
└── devto/           server.js  manifest.json      # trending/search/article
test/
├── stackexchange.test.js  lobsters.test.js  lemmy.test.js  hashnode.test.js  devto.test.js
└── fixtures/        <source>-list.json  <source>-detail.json   # real captured payloads
```
Follow the HN precedent exactly: one folder per source, `server.js` + `manifest.json` (scaffold). **No `build-mcpb.sh`** — HN omits it because packaging (PKG-01) is deferred to v2; match that.

### Pattern 1: Copy the HN handler shape verbatim
**What:** `getJson(url)` → `map*()` → `buildListEnvelope`/`buildDetailEnvelope` → `toolResult(env)`; `registerTool(name, { title, description, inputSchema: {rawZod}, outputSchema: listEnvelopeShape }, handler)`.
**When:** every tool on every server.
**Example (from `servers/hn/server.js`, the template):**
```javascript
// Source: servers/hn/server.js (verified reference)
server.registerTool("hn_search",
  { title: "...", description: "...",
    inputSchema: { query: z.string(), limit: z.number().int().min(1).max(50).optional() },
    outputSchema: listEnvelopeShape },
  async ({ query, limit = 20 }) => {
    const raw = await getJson(`${ALGOLIA}/search?query=${encodeURIComponent(query)}&hitsPerPage=${limit}`);
    const env = buildListEnvelope({ source: SOURCE, query, results: (raw.hits ?? []).map(mapHnHit) });
    return toolResult(env);
  });
```

### Pattern 2: Direct-run transport guard (required for testable imports)
```javascript
// Source: servers/hn/server.js — importing for tests must NOT open a live stdio transport
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await server.connect(new StdioServerTransport());
}
```

### Pattern 3: Client-side search window (D-01)
```javascript
// Dev.to / Lobsters / Hashnode-global: no real full-text search.
// Fetch a top/recent window, substring-match, then map. State the window in the description.
const rows = await getJson(`${API}/articles?top=7&per_page=${WINDOW}`); // WINDOW e.g. 100
const q = query.toLowerCase();
const hits = rows.filter(r =>
  `${r.title} ${(r.tag_list ?? []).join(" ")} ${r.description ?? ""}`.toLowerCase().includes(q));
const env = buildListEnvelope({ source: SOURCE, query, results: hits.map(mapDevtoRow) });
```

### Anti-Patterns to Avoid
- **Calling `fetch` directly** (e.g. for Hashnode POST) — forbidden by CLAUDE.md. Add `postJson()` to the shared client instead.
- **Reading `process.env` in a server** (e.g. for `LEMMY_INSTANCE`) — add a `credentials.js` helper.
- **String-interpolating user input into a GraphQL query** — use GraphQL `variables`, never concatenation.
- **Forgetting `encodeURIComponent`** on `site`, `tag`, `community`, `query`, `id` path/query segments.
- **Re-implementing HTML stripping / envelope shaping** per server — always route text through `normalizeItem`/`stripHtml`.
- **Renaming or dropping `score`/`num_comments`** — set them to `null` when a source lacks the datum, never omit.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTML → text | per-server regex | `stripHtml` (via `normalizeItem`) | centralized entity decoding/trim; contract guarantee |
| Envelope + null defaulting | manual object build | `buildListEnvelope`/`buildDetailEnvelope` | prevents contract drift (OUT-01) |
| Dual `content`+`structuredContent` | hand-assembled return | `toolResult(env)` | FOUND-05; can't drift |
| GraphQL POST + caching | raw `fetch` in Hashnode server | new shared `postJson()` | keeps cache/retry/stale + the no-direct-fetch rule |
| Lemmy login/token cache | new login code | `auth.js` `lemmyJwt()` | already built, password-safe (CRED-02) |
| base64 for any auth | npm base64 lib | `Buffer.from(x).toString("base64")` | Node built-in (auth.js precedent) |
| Env var name resolution | `process.env` in server | `credentials.js` helper | single source of truth (CRED-01) |

**Key insight:** In this suite, "adding a source" is *supposed* to be nothing but a field map. Any time a server reaches for `fetch`, `process.env`, or its own text/envelope logic, that's a signal the capability belongs in a shared module — fix it there so every future source inherits it.

## Per-Source API Reference

### SRC-01 · Stack Exchange (API 2.3) `[CITED: api.stackexchange.com/docs]`
- **Base:** `https://api.stackexchange.com/2.3`
- **Endpoints:**
  - `so_hot_questions` → `GET /questions?site={site}&sort=hot&order=desc&pagesize={n}&filter=withbody` (D-07: `sort` overridable to `votes`/`week`/`month`/`activity`).
  - `so_search` → `GET /search/advanced?site={site}&q={query}&sort=relevance&order=desc&pagesize={n}&filter=withbody` (native search — use directly).
  - `so_get_question` → `GET /questions/{id}?site={site}&filter=withbody` for the question, plus `GET /questions/{id}/answers?site={site}&sort=votes&order=desc&filter=withbody` for answers → `comments[]`.
- **`filter=withbody`** is the built-in filter that adds `body_markdown` to **both questions and answers**; the default filter omits body, so without it `text` is silently empty (D-04). `[CITED]`
- **Key attachment:** spread `stackExchangeParams()` (`{key}` or `{}`) into the query string — higher quota when present, keyless otherwise (CRED-04). Never send `key=` when absent.
- **Response wrapper:** `{ items: [...], has_more, quota_max, quota_remaining, backoff? }`. Responses are gzip-encoded; native `fetch` auto-decodes. Honor a `backoff` field only if you hit it (rare keyless) — out of scope to implement now.
- **Field map:**

| item | SE field | note |
|---|---|---|
| `id` | `question_id` (stringify) | |
| `type` | `"question"` (literal) | |
| `title` | `title` | |
| `author` | `owner.display_name` | may be null (deleted user) |
| `score` | `score` | = votes (§5) |
| `num_comments` | `answer_count` | = answers (§5) |
| `created_utc` | `creation_date` | **epoch SECONDS** → `new Date(s*1000).toISOString()` |
| `url` | `link` | canonical SE URL |
| `permalink` | `link` | same as url |
| `tags` | `tags` | array of strings |
| `text` | `body_markdown` | requires `filter=withbody` |
| comments[] | answers: `answer_id`→id, `owner.display_name`→author, `body_markdown`→text | |

### SRC-02 · Lobsters `[VERIFIED: live lobste.rs/hottest.json]`
- **Base:** `https://lobste.rs`
- **Endpoints:** `lobsters_hottest` → `GET /hottest.json`; `lobsters_tag` → `GET /t/{tag}.json`; `lobsters_get` → `GET /s/{short_id}.json` (detail carries a `comments` array). No auth.
- **Search:** no reliable full-text search → `*_search` (if added) uses D-01 client-side filter over `/hottest.json` (the roadmap-fixed tool set is hottest/tag/get, so a `_search` tool is optional here; if included, document the window).
- **Field map (top-level story object):**

| item | Lobsters field | note |
|---|---|---|
| `id` | `short_id` | string already |
| `type` | `"story"` | |
| `title` | `title` | |
| `author` | `submitter_user` | **plain username STRING** (schema changed from nested object — verified live) |
| `score` | `score` | = upvotes (§5) |
| `num_comments` | `comment_count` | = comments (§5) |
| `created_utc` | `created_at` | ISO-8601 already |
| `url` | `url` | external link (may be empty for text posts) |
| `permalink` | `comments_url` (or `short_id_url`) | canonical discussion |
| `tags` | `tags` | array of strings |
| `text` | `description_plain` (fallback `description`) | prefer plain; stripHtml handles `description` |
| comments[] | detail `comments[]`: `short_id`→id, `commenting_user`→author, `comment_plain`/`comment`→text | flatten top level |

### SRC-03 · Lemmy (API v3) `[CITED: mv-gh.github.io/lemmy_openapi_spec + join-lemmy.org]`
- **Base:** `{instance}/api/v3` where `instance` = `lemmyInstance()` (default `https://programming.dev`, D-05). v3 remains supported and backwards-compatible even under Lemmy 1.0/API v4. `[CITED: join-lemmy.org/news/2025-02-03]`
- **Endpoints:**
  - `lemmy_hot` → `GET /post/list?type_=All&sort=Hot&limit={n}` (D-05 `type_=All` federated; D-07 `sort` overridable: `Active`/`New`/`TopDay`/`TopWeek`/`MostComments`). Optional `&community_name={name}`.
  - `lemmy_search` → `GET /search?q={query}&type_=Posts&listing_type=All&sort={sort}` (native search — use directly). Response `{ posts: [PostView], comments, communities, users }`.
  - `lemmy_post` → `GET /post?id={id}` → `{ post_view: PostView }`, plus `GET /comment/list?post_id={id}&max_depth=1&sort=Hot` → `{ comments: [CommentView] }` for top-level comments.
- **Auth (D-06):** `const jwt = await lemmyJwt();` → if non-null add header `{ Authorization: `Bearer ${jwt}` }` to `getJson`; if null, anonymous. `lemmyJwt()` already returns `null` when creds absent.
- **Field map (`PostView`):**

| item | Lemmy field | note |
|---|---|---|
| `id` | `post.id` (stringify) | |
| `type` | `"post"` | |
| `title` | `post.name` | Lemmy calls the title `name` |
| `author` | `creator.name` | |
| `score` | `counts.score` | = score (§5) |
| `num_comments` | `counts.comments` | = comments (§5) |
| `created_utc` | `post.published` | ISO-8601 already |
| `url` | `post.url` | external link, nullable |
| `permalink` | `post.ap_id` | canonical federated URL |
| `tags` | `[]` (or `[community.name]`) | Lemmy has no post tags; planner discretion |
| `text` | `post.body` | markdown, nullable |
| comments[] | `CommentView`: `comment.id`→id, `creator.name`→author, `comment.content`→text | |

### SRC-04 · Hashnode (public GraphQL) `[CITED: gql.hashnode.com + hashnode-client queries.ts]`
- **Endpoint:** `https://gql.hashnode.com` — **POST only**, `Content-Type: application/json`, body `{ query, variables }`. **Requires shared `postJson()` (see Gaps).** No auth for public reads. This is the **modern** API — the old `storiesFeed(type: FEATURED)` v1 endpoint is deprecated; do not use it.
- **Trending (network-wide):** root `feed` query.
```graphql
query Feed($first: Int!, $after: String, $filter: FeedFilter) {
  feed(first: $first, after: $after, filter: $filter) {
    edges { node {
      id title brief slug url publishedAt readTimeInMinutes
      reactionCount responseCount
      author { name username }
      tags { name slug id }
    } }
    pageInfo { hasNextPage endCursor }
  }
}
```
`FeedFilter.type` ∈ `FEATURED` (trending, D-07 default) `| RECENT | ...`. **Gotcha:** `FeedFilter.tags` takes tag **ObjectIds `[ObjectId!]`, not slugs** — to trend by a tag *slug* you must resolve its id first, OR omit `tags` and client-side-filter the featured feed on `tags[].slug`. `[CITED]`
- **Single article:** root `post(id: ID!)`:
```graphql
query Post($id: ID!) {
  post(id: $id) {
    id title brief slug url publishedAt reactionCount responseCount replyCount
    content { markdown text }
    author { name username }
    tags { name slug id }
    comments(first: 20) { edges { node { id content { markdown text } author { name username } } } }
  }
}
```
- **Search — IMPORTANT correction:** Hashnode's native search is `searchPostsOfPublication(first, after, filter: { query, publicationId })` — **publication-scoped, no global full-text search exists.** CONTEXT.md D-01 assumed native global search; it does not exist. Recommended `hashnode_search`: D-01 client-side filter over the `feed` window (state the window), OR accept an optional `publication` host param to use native per-publication search. `[CITED]` — surface to discuss-phase.
- **Field map (`Post` / feed node):**

| item | Hashnode field | note |
|---|---|---|
| `id` | `id` | |
| `type` | `"article"` | |
| `title` | `title` | |
| `author` | `author.name` (or `author.username`) | |
| `score` | `reactionCount` | = reactions (§5) |
| `num_comments` | `responseCount` | = responses (§5) |
| `created_utc` | `publishedAt` | ISO-8601 already |
| `url` | `url` | canonical post URL |
| `permalink` | `url` | same |
| `tags` | `tags[].slug` (or `.name`) | array from objects |
| `text` | `brief` (list) / `content.markdown` (detail) | |
| comments[] | `comments.edges[].node`: `id`, `author.name`, `content.markdown` | top level only |

### SRC-05 · Dev.to (Forem API v1) `[CITED: developers.forem.com/api/v1]`
- **Base:** `https://dev.to/api`. Send header `Accept: application/vnd.forem.api-v1+json` (via `getJson`'s `headers` opt). No auth for reads.
- **Endpoints:**
  - trending → `GET /articles?top={days}&per_page={n}` (D-07: `top=7` = most popular last 7 days); by-tag → add `&tag={tag}`.
  - `*_search` → **no native search** → D-01 client-side filter over `/articles?top=7&per_page={window}` (state the window).
  - article detail → `GET /articles/{id}` (full body); comments → `GET /comments?a_id={id}` (tree; flatten top level).
- **List vs detail:** the `/articles` **list objects omit body** — list `text` = `description`; only `/articles/{id}` returns `body_markdown`/`body_html`.
- **Field map:**

| item | Dev.to field | note |
|---|---|---|
| `id` | `id` (stringify) | |
| `type` | `"article"` | |
| `title` | `title` | |
| `author` | `user.username` (or `user.name`) | |
| `score` | `public_reactions_count` | = reactions (§5); list also has `positive_reactions_count` |
| `num_comments` | `comments_count` | = comments (§5) |
| `created_utc` | `published_at` | RFC3339/ISO already |
| `url` | `url` | canonical |
| `permalink` | `url` | same |
| `tags` | `tag_list` | array of strings |
| `text` | `description` (list) / `body_markdown` (detail) | |
| comments[] | `/comments?a_id=`: `id_code`→id, `user.username`→author, `body_html`→text (stripHtml), `children` = nested (drop) | flatten top level |

## Common Pitfalls

### Pitfall 1: Hashnode built with a direct `fetch`
**What goes wrong:** GraphQL is POST-only; `getJson` is GET-only; a dev reaches for `fetch` and breaks the CLAUDE.md rule + loses cache/retry/stale.
**How to avoid:** add `postJson()` to `shared/http_client.js` **first**; build Hashnode on it.
**Warning sign:** `fetch(` appearing anywhere under `servers/`.

### Pitfall 2: SE `text` silently empty
**What goes wrong:** default SE filter omits `body_markdown`; `text` normalizes to `null` everywhere.
**How to avoid:** always append `filter=withbody` on question/answer/detail calls (D-04).

### Pitfall 3: SE timestamp off by 1000×
**What goes wrong:** `creation_date` is epoch **seconds**; treating it as ms yields year-1970 dates.
**How to avoid:** `new Date(creation_date * 1000).toISOString()`. (Lobsters/Lemmy/Dev.to/Hashnode already return ISO strings — no conversion.)

### Pitfall 4: Lemmy anonymous instance override impossible without a helper
**What goes wrong:** server can't read `LEMMY_INSTANCE`; `lemmyCreds()` returns instance only when user+pass present → override silently ignored for anonymous reads.
**How to avoid:** add `lemmyInstance()` to `credentials.js` (`LEMMY_INSTANCE || "https://programming.dev"`, full URL with scheme). Ensure the same scheme convention `auth.js` expects (`${instance}/api/v3/...`).

### Pitfall 5: Hashnode tag filter expects ObjectIds, not slugs
**What goes wrong:** passing a tag slug to `FeedFilter.tags` returns nothing.
**How to avoid:** omit `tags` and client-side-filter the featured feed on `tags[].slug`, or resolve the tag id first.

### Pitfall 6: Lobsters `submitter_user` treated as an object
**What goes wrong:** older docs show `submitter_user` as a nested `{username,...}` object; the live API now returns a **plain username string** — `submitter_user.username` is `undefined`.
**How to avoid:** map `author = story.submitter_user` directly (verified against live payload).

### Pitfall 7: `registerTool` given `z.object(...)` instead of a raw shape
**What goes wrong:** SDK 1.29 expects a raw Zod shape for `inputSchema`/`outputSchema`; passing `z.object(...)` breaks (Phase 1 Pitfall 1). Use `listEnvelopeShape`/`detailEnvelopeShape` and raw `{ query: z.string() }` shapes.

### Pitfall 8: Un-encoded path/query segments
**What goes wrong:** tags/sites/communities/queries with spaces or `/` corrupt the URL.
**How to avoid:** `encodeURIComponent` every interpolated user value (see HN template).

## Runtime State Inventory

> N/A — this is an additive (greenfield) phase creating five new server folders. No rename/refactor/migration; no stored data, live-service config, OS-registered state, secrets, or build artifacts carry an old identifier that must change. **None — verified by scope (new `servers/<source>/` directories only).**

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node ≥18 (global `fetch`, `Buffer`, `URL`) | all servers | ✓ | `engines.node >=18` (package.json) | — |
| `@modelcontextprotocol/sdk` ^1.29 | all servers | ✓ | installed | — |
| `zod` ^4.4 | all servers | ✓ | installed | — |
| Network → `api.stackexchange.com`, `lobste.rs`, `programming.dev`, `gql.hashnode.com`, `dev.to` | live tool calls | runtime | — | 15-min cache + stale fallback (§8); tests run offline on fixtures |
| `STACKEXCHANGE_KEY` | SE (optional) | optional | — | keyless mode (CRED-04) |
| `LEMMY_USERNAME`/`_PASSWORD`/`_INSTANCE` | Lemmy auth (optional) | optional | — | anonymous reads (D-06) |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** SE key → keyless; Lemmy creds → anonymous. Both are graceful by design.

*Unit tests must be offline (fixtures), matching HN — no network dependency in `npm test`.*

## Security Domain

> `security_enforcement: true`, `security_asvs_level: 1`.

### Applicable ASVS Categories (L1)

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (Lemmy) | reuse `auth.js` `lemmyJwt()` — password only in-memory, jwt cached, never logged (CRED-02) |
| V3 Session Management | no | stateless tool calls; jwt cache is in-process |
| V4 Access Control | no | read-only public data |
| V5 Input Validation | yes | zod on every tool input (`site`, `query`, `id`, `tag`, `limit` bounds); `encodeURIComponent` on URL segments; GraphQL `variables` (never string-concat) |
| V6 Cryptography | no (reuse only) | base64 via `Buffer` in `auth.js`; no new crypto — never hand-roll |
| V7 Error/Logging | yes | never log credentials or full jwt; errors name env vars only (existing convention) |
| V9 Communications | yes | all five endpoints are HTTPS |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Injection into constructed URL | Tampering | `encodeURIComponent` all interpolated params (SE `site`, Lobsters `tag`, Lemmy `community`, `query`, `id`) |
| GraphQL injection (Hashnode) | Tampering | pass user input via `variables`, never interpolate into the query string |
| SSRF via `LEMMY_INSTANCE` override | Tampering/Info-disclosure | instance is **operator-set env** (not a tool input); document that it must be a trusted full HTTPS URL; do not expose instance as a per-call tool parameter |
| Credential leak in logs | Info disclosure | reuse Phase 1 hygiene — passwords never logged/persisted; only ENV_VAR names in errors |
| Unbounded response size / DoS | DoS | `limit`/`per_page` zod bounds (HN uses `.min(1).max(50)`); 10s timeout + cache already in `getJson` |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `filter=withbody` returns `body_markdown` on both questions AND answers on API 2.3 | SRC-01 | `text`/answer text empty; mitigated by capturing a live fixture during Execute and asserting body present |
| A2 | Hashnode `Post` exposes `reactionCount` + `responseCount` (not `reactions`/`responses`) as the count scalars | SRC-04 | wrong `score`/`num_comments` map; verify against a live introspection/query when building |
| A3 | Lemmy `programming.dev` still serves `/api/v3` (v3 backwards-compat holds) | SRC-03 | Lemmy server 404s; if so, fall back to `/api/v4` path — but Nov-2025 notes confirm v3 compat |
| A4 | Dev.to `Accept: application/vnd.forem.api-v1+json` is accepted and list objects omit body | SRC-05 | over/under-fetching; low risk — documented behavior |
| A5 | A shared `postJson()` can reuse the existing cache/retry/stale flow with a `url+body` cache key | Gaps/Pitfall 1 | if cache semantics differ, Hashnode caching weaker — acceptable (still correct) |

**All A1–A5 should be confirmed with a captured live fixture at Execute time** (the HN precedent: fixtures are real payloads captured once). None block planning.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hashnode `storiesFeed(type: FEATURED)` v1 API | `gql.hashnode.com` `feed(filter: FeedFilter)` | Headless Hashnode migration | must use `feed`/`post` root queries; old query returns nothing |
| Lobsters `submitter_user` nested object | `submitter_user` plain username string | Lobsters JSON change | map `author = submitter_user` directly |
| Lemmy API v3 only | v3 + v4 (1.0), **v3 still supported** | Lemmy 1.0 (2025) | safe to stay on `/api/v3` (matches `auth.js`) |

**Deprecated/outdated:**
- Hashnode `storiesFeed` / `api.hashnode.com` (old GraphQL host) — replaced by `gql.hashnode.com`.
- Reddit OAuth app path — deferred (RSS `.rss` covers Reddit in Phase 4).

## Open Questions (RESOLVED)

1. **Hashnode global `hashnode_search` strategy** — native search is publication-scoped only.
   - Known: `feed` (global, filterable client-side) exists; `searchPostsOfPublication` needs a publication id.
   - Unclear: whether the consumer wants global-window filtering (D-01) or a `publication` param.
   - Recommendation: default to D-01 client-side filter over the featured `feed` window; note the limitation in the tool description. Surface to discuss-phase if a true global search is required.
   - **RESOLVED:** 02-03 uses the D-01 client-side feed-window filter over the featured `feed`; the tool description states the global-window limitation. No `publication` param added.
2. **Hashnode trending-by-tag** — `FeedFilter.tags` needs ObjectIds.
   - Recommendation: fetch featured `feed` and client-side-filter on `tags[].slug` for the tag tool; avoids a tag-id resolution round-trip.
   - **RESOLVED:** 02-03 client-side-filters on `tags[].slug`, avoiding ObjectId resolution (Pitfall 5); no tag-id round-trip.
3. **Whether to add optional `*_search` to Lobsters** — roadmap fixes only hottest/tag/get for Lobsters; D-01 mandates a uniform `_search` surface across sources.
   - Recommendation: include `lobsters_search` as a client-side filter over `/hottest.json` for surface uniformity, matching D-01's intent; confirm the roadmap tool set isn't strictly closed.
   - **RESOLVED:** 02-02 adds `lobsters_search` as a D-01 client-side filter over `/hottest.json` for surface uniformity.

## Sources

### Primary (HIGH confidence)
- `servers/hn/server.js`, `shared/contract.js`, `shared/http_client.js`, `shared/credentials.js`, `shared/auth.js`, `docs/ARCHITECTURE.md` §3–§8, `docs/server-spec-template.md`, `test/hn.test.js`, `servers/hn/manifest.json`, `package.json`, `.planning/config.json` — read directly this session.
- `https://lobste.rs/hottest.json` — live payload; verified `submitter_user` is a string and the story field set.

### Secondary (MEDIUM confidence — official docs via search)
- Forem API v1 — https://developers.forem.com/api/v1 (articles `top`/`tag`/`per_page`; `/articles/{id}` fields; `/comments?a_id=`; Accept header).
- Lemmy — https://mv-gh.github.io/lemmy_openapi_spec/ and https://join-lemmy.org/docs/contributors/04-api.html (post/list, search, post, comment/list; Bearer auth); https://join-lemmy.org/news/2025-02-03_-_Breaking_Changes_in_Lemmy_1.0 (v3 backwards-compat).
- Stack Exchange — https://api.stackexchange.com/docs (2.3 questions/search/advanced; `withbody` filter).
- Hashnode — https://apidocs.hashnode.com/ and hashnode-client `queries.ts` (POST-only `gql.hashnode.com`; `feed`/`post`/`searchPostsOfPublication`; `FeedFilter` tags=ObjectId).

### Tertiary (LOW confidence — confirm at Execute via live fixture)
- Exact Hashnode count-field names (`reactionCount`/`responseCount`) — A2.
- SE `withbody` covering answer bodies — A1.

## Metadata

**Confidence breakdown:**
- Standard stack / architecture / contract: HIGH — read the actual shared modules and HN template.
- Per-source field maps: MEDIUM — Lobsters VERIFIED live; SE/Lemmy/Dev.to/Hashnode from official docs, to be pinned with captured fixtures at Execute.
- Two blocking gaps (`postJson`, `lemmyInstance`): HIGH — derived directly from reading `http_client.js` (GET-only) and `credentials.js` (`lemmyCreds` all-or-nothing).

**Research date:** 2026-07-02
**Valid until:** ~2026-08-01 (public APIs are moderately stable; Hashnode GraphQL and Lemmy 1.0 rollout are the fastest-moving — re-verify if building later than this).
