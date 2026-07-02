# Phase 3: Keyed Ecosystem & Launch Sources - Research

**Researched:** 2026-07-02
**Domain:** External REST/GraphQL API integration (GitHub, Libraries.io, Product Hunt) behind the existing normalized MCP output contract
**Confidence:** HIGH (patterns + shared modules verified in-repo; API shapes CITED against official docs, three load-bearing claims flagged for a one-call live smoke)

## Summary

Phase 3 adds three source servers — **GitHub** (optional PAT), **Libraries.io**
(required key), **Product Hunt** (required token) — each a mechanical copy of the
Phase 1/2 pattern: `getJson()`/`postJson()` → `map*()` field helpers →
`buildListEnvelope`/`buildDetailEnvelope` → `toolResult()`, with credentials
resolved through the already-implemented `githubHeaders()`, `librariesIoParams()`,
`productHuntHeaders()` helpers. No new npm dependencies; no new shared
infrastructure. GitHub and Libraries.io are REST via `getJson()`; Product Hunt is
the one GraphQL server, reusing the `postJson()` path added in Phase 2.

The live APIs **confirm** every CONTEXT.md default (D-01..D-11) except one gap that
is not an API contradiction but a **contract-module gap**: the `TYPE` enum in
`shared/contract.js` currently contains `["story","ask","show","question","article","repo","comment","post","job"]`
— it has `repo` and `post` but **not `issue`, `package`, or `launch`**, which
D-01/Claude's-Discretion assign to GitHub issues, Libraries.io packages, and
Product Hunt launches. Because `toolResult()` validates `structuredContent`
against `z.enum(TYPE)` on every return, a server emitting `type:"issue"` or
`type:"package"` will **fail SDK output validation at runtime**. This must be
fixed first (additive enum extension) and is a shared prerequisite both plans
depend on.

Two API findings resolve open CONTEXT questions cleanly: (1) GitHub issue
**reactions are GA** — the `reactions` object with `total_count` is returned
directly by `GET /search/issues` on modern API versions, no `squirrel-girl`
preview header and no per-issue second fetch needed, so D-09 (`reactions→score`)
is satisfiable from the list response. (2) Product Hunt's **developer token is
sufficient** (bearer, no OAuth flow) for read-only `posts` queries, so D-10's
required-token path is a straight `productHuntHeaders()` wire-up.

**Primary recommendation:** First extend `TYPE` in `shared/contract.js` with
`"issue"`, `"package"`, `"launch"` (and update the ARCHITECTURE §4 enum comment),
then copy `servers/stackexchange/server.js` three times — its optional-key +
free-passthrough-param + secret-free-cacheKey shape is the exact template for all
three (GitHub PAT, Libraries.io `platform`, and the query-param-key redaction
Libraries.io shares with Stack Exchange).

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** GitHub exposes three tools — `gh_trending_repos({ query?, language?, since? })`
  (Search repos, `stars`→`score`, `num_comments` null, `type:"repo"`),
  `gh_search_issues({ query, labels?, repo? })` (Search issues, reactions total→`score`,
  comment count→`num_comments`, `type:"issue"`), and `gh_get_item({ ... })`
  (detail for a repo or an issue; for an issue, top-level comments→`comments[]`;
  for a repo, `comments: []`).
- **D-02:** Issues cover the "issues/discussions" intent for v1; GitHub Discussions
  (GraphQL-only) are **deferred**, not dropped. REST Search issues keeps GitHub on
  the `getJson()` path. Discussions are a stretch goal, not a blocker on criterion 1.
- **D-03:** GitHub trending = Search API `sort=stars`, `order=desc`, windowed by a
  recent-activity qualifier (`created:>{today-7d}` or `pushed:>{today-7d}`);
  default window **7 days**, overridable via `since` (`day`/`week`/`month`).
- **D-04:** Libraries.io default sort = **most-depended** (`dependents_count`) →
  `score`. A `sort` param switches to `rank` / recently-updated. `num_comments` null.
- **D-05:** Product Hunt default = **today's** launches, `period` param switches to
  **this-week**; ordered by votes (`score`=votes, `num_comments`=comments).
- **D-06:** Libraries.io `platform` param is a **free passthrough** (default `npm`),
  validated server-side like Stack Exchange's `site`; no local whitelist.
- **D-07:** Product Hunt `topic` param is an optional passthrough (topic slug);
  absent → overall daily/weekly leaderboard.
- **D-08:** `gh_search_issues` uses Search issues with `is:issue` (open by default);
  query = free text + optional `labels` (`bug`, `help wanted`, `question`,
  `good first issue`; none default) + optional `repo`/`owner` scope (default global).
  Sort by reactions/interactions.
- **D-09:** `score` = issue **reaction total**. Exact mechanism was flagged as a
  researcher detail — **RESOLVED below** (reactions GA, returned in list response).
- **D-10:** Required creds resolve **lazily at tool-call time** via
  `librariesIoParams()` / `productHuntHeaders()` (throw `Missing credential: set
  LIBRARIESIO_KEY` / `set PRODUCTHUNT_TOKEN`). Server still registers/starts; error
  surfaces on the call. A unit test asserts the throw when the env var is unset.
  GitHub degrades to anonymous via `githubHeaders()` → `{}` (CRED-04).
- **D-11:** Two plans — **03-01 GitHub** (largest, two entity types), **03-02
  Libraries.io + Product Hunt** (required-key pair). Product Hunt = GraphQL via
  `postJson()`; Libraries.io + GitHub = REST via `getJson()`.

### Claude's Discretion

- Exact `map*`/field-map function names, URL/query builders, GitHub Search
  qualifier strings and trending time-window arithmetic, Libraries.io endpoint
  choice (search vs project) and `sort` enum values, Product Hunt GraphQL query
  strings and pagination, the reaction-count fetch mechanism (D-09), page sizes —
  all planner/executor calls, provided ARCHITECTURE §4 contract and §5
  `score`/`num_comments` meaning hold.
- Per-source `type` enum: GitHub repo→`repo`, GitHub issue→`issue`,
  Libraries.io→`package`, Product Hunt→`launch`/`post`.

### Deferred Ideas (OUT OF SCOPE)

- GitHub Discussions via GraphQL (deferred from D-02).
- GitHub trending via the unofficial trending page / third-party trending APIs
  (rejected in favor of Search API emulation, D-03).
- Libraries.io per-package detail enrichment (dependents list, SourceRank
  breakdown) beyond the contract item.
- Product Hunt collections / makers / comments-thread depth beyond today/this-week
  launch lists.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SRC-06 | GitHub server — trending repos (Search API) + issues/discussions pain-point mining; optional PAT | `GET /search/repositories` + `GET /search/issues` field maps (§Field Mapping); reactions GA resolves `reactions→score`; `githubHeaders()` optional-PAT degrade verified in `credentials.test.js` |
| SRC-07 | Libraries.io server (rising/most-depended packages); required key | `GET /api/search?sort=dependents_count&platforms=` + `GET /api/:platform/:name`; `librariesIoParams()` required-key throw; query-param-key redaction pattern from `seUrl` |
| SRC-08 | Product Hunt server (today/this-week launches by topic); required token | GraphQL `posts(order: VOTES, postedAfter:, topic:)` via `postJson()`; `productHuntHeaders()` bearer developer token; required-token throw |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| HTTP + caching + retry + stale fallback | `shared/http_client.js` (`getJson`/`postJson`) | — | ARCHITECTURE §8; servers never call `fetch` |
| Credential resolution (env → request fragment) | `shared/credentials.js` | — | CRED-01; only place `process.env` is read; helpers already exist |
| Output normalization + envelope + dual return | `shared/contract.js` | — | §4 contract linchpin; `normalizeItem`/`buildListEnvelope`/`buildDetailEnvelope`/`toolResult` |
| Type enum (`repo`/`issue`/`package`/`launch`) | `shared/contract.js` `TYPE` | — | **Must be extended (see Pitfall 1)** — validation gate for every `structuredContent` return |
| Source field mapping (API JSON → contract item) | per-server `map*()` helpers | — | The ONLY source-specific logic per server |
| GraphQL query construction (Product Hunt) | `servers/producthunt/server.js` | `postJson()` | GraphQL body assembled in server; POST + cache/retry inherited |
| Secret-free cache key (query-param keys) | per-server URL builder (`seUrl` pattern) | `http_client` `cacheKey` opt | Libraries.io `api_key` is a query param → must not enter cache key or error text |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | ^1.29.0 | `McpServer` + `registerTool` (raw Zod shapes) + `StdioServerTransport` | Already the project standard; every existing server uses it [VERIFIED: package.json] |
| `zod` | ^4.4 | Input/output schemas (raw shapes) | Already present; `contract.js` schemas built on it [VERIFIED: package.json] |

**No new dependencies.** All three servers reuse existing shared modules and the
two dependencies already in `package.json`. Native `fetch` (Node ≥18) is used
inside `http_client.js` only.

### Supporting (existing shared modules — reuse, do not reimplement)

| Module | Function(s) | Use in Phase 3 |
|--------|-------------|----------------|
| `shared/http_client.js` | `getJson(url, {headers, cacheKey})` | GitHub + Libraries.io REST |
| `shared/http_client.js` | `postJson(url, {body, headers})` | Product Hunt GraphQL POST |
| `shared/contract.js` | `buildListEnvelope`, `buildDetailEnvelope`, `normalizeItem`, `stripHtml`, `toolResult`, `listEnvelopeShape`, `detailEnvelopeShape`, `TYPE` | Every server |
| `shared/credentials.js` | `githubHeaders()`, `librariesIoParams()`, `productHuntHeaders()` | Auth fragments (already implemented + unit-scaffolded) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| REST `GET /search/issues` (D-02) | GitHub GraphQL Discussions/Search | Deferred — GraphQL adds a second code path; REST issues already surface abundant pain-point signal and stay on `getJson()` |
| Search-API trending emulation (D-03) | Unofficial trending page / third-party trending API | Rejected in CONTEXT — Search API is supported, keyless-capable, and stable |
| Libraries.io `/api/search` | Per-platform project listing endpoints | No clean "global top packages" list endpoint exists; keyword search sorted by `dependents_count` is the supported path (see Open Questions) |

**Installation:** none required (`npm install` already satisfies deps).

**Version verification:** `@modelcontextprotocol/sdk@^1.29.0` and `zod@^4.4` are
already declared and in use across five shipped servers [VERIFIED: package.json +
five servers/*/server.js import them]. No install step in this phase.

## Package Legitimacy Audit

> This phase installs **no external packages**. Both runtime dependencies are
> pre-existing and proven across Phases 1–2.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `@modelcontextprotocol/sdk` | npm | established | high (official Anthropic SDK) | github.com/modelcontextprotocol/typescript-sdk | OK (pre-existing) | Already installed — no action |
| `zod` | npm | 8+ yrs | ~30M+/wk | github.com/colinhacks/zod | OK (pre-existing) | Already installed — no action |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
Claude Desktop (MCP client)
        │  stdio (JSON-RPC)
        ▼
┌───────────────────────────────────────────────────────────────┐
│  servers/<source>/server.js  (one process per source)          │
│                                                                 │
│  registerTool(name, {inputSchema, outputSchema}, handler)       │
│        │                                                        │
│        ▼  handler({...args})                                    │
│  1. build URL / GraphQL body                                    │
│        │        └── credentials.js fragment (headers OR params) │
│        ▼                                                         │
│  2. getJson(url,{headers,cacheKey})  OR  postJson(url,{body,…}) │
│        │            (cache → retry/backoff → stale fallback)    │
│        ▼                                                         │
│  3. map*() field helpers  (source JSON → raw contract item)     │
│        │                                                         │
│        ▼                                                         │
│  4. buildListEnvelope / buildDetailEnvelope  (normalizeItem,    │
│        │                            stripHtml, defaulting)      │
│        ▼                                                         │
│  5. toolResult(env)  →  { content:[text], structuredContent }   │
│        │                    (SDK validates against outputSchema  │
│        ▼                     = z.enum(TYPE) etc.)                │
└────────┼────────────────────────────────────────────────────────┘
         ▼
   External API
   ├─ GitHub    REST  https://api.github.com/search/{repositories,issues}, /repos/{o}/{r}/issues/{n}[/comments]
   ├─ Libraries.io REST https://libraries.io/api/search , /api/{platform}/{name}
   └─ Product Hunt GraphQL POST https://api.producthunt.com/v2/api/graphql
```

Trace of the primary use case (pain-point mining): caller invokes
`gh_search_issues({query:"flaky tests", labels:["bug"]})` → handler builds
`q=flaky tests is:issue is:open label:bug&sort=reactions&order=desc` → `getJson`
with `githubHeaders()` → `mapGhIssue()` maps `reactions.total_count→score`,
`comments→num_comments` → `buildListEnvelope` → `toolResult` → uniform items the
`medium-blog-pro` skill ranks with zero source-specific code.

### Recommended Project Structure

```
servers/
├── github/
│   ├── server.js         # gh_trending_repos, gh_search_issues, gh_get_item
│   ├── manifest.json     # user_config.github_token (sensitive:true, required:false)
│   └── build-mcpb.sh     # (scaffold, mirrors servers/hn/)
├── libraries/            # or librariesio/
│   ├── server.js         # lib_search (+ maybe lib_trending), lib_get
│   ├── manifest.json     # user_config.librariesio_key (sensitive:true, required:true)
│   └── build-mcpb.sh
└── producthunt/
    ├── server.js         # ph_launches (today/week), ph_get (+ maybe ph_search by topic)
    ├── manifest.json     # user_config.producthunt_token (sensitive:true, required:true)
    └── build-mcpb.sh
test/
├── github.test.js        # map helpers + registration + reactions→score fixture
├── libraries.test.js     # map helpers + registration + missing-key throws
└── producthunt.test.js   # map helpers + registration + missing-token throws
```

### Pattern 1: Optional-key + free-passthrough param + secret-free cache key (copy from Stack Exchange)

**What:** `servers/stackexchange/server.js` is the closest analog to all three
servers — it already demonstrates (a) an optional key folded into the request but
**never** into the cache key, (b) a free-passthrough param (`site`) validated
server-side, and (c) `redactUrl` protection so a query-param key never leaks into
an error. GitHub reuses (a)+(b) (PAT is a header, `language`/`labels` passthrough);
**Libraries.io reuses all three** because its `api_key` is a **query param** exactly
like Stack Exchange's `key=`.

**When to use:** any server whose credential or a secret rides in the URL.

**Example (the `seUrl` shape to mirror for Libraries.io):**
```javascript
// Source: servers/stackexchange/server.js:118 (in-repo, verified)
export function libUrl(path, params) {
  const publicQs = new URLSearchParams({ ...params });                 // NO api_key
  const authedQs = new URLSearchParams({ ...params, ...librariesIoParams() }); // + api_key
  return {
    url: `${LIB}${path}?${authedQs.toString()}`,
    cacheKey: `${LIB}${path}?${publicQs.toString()}`,  // secret-free (http_client contract)
  };
}
// caller: const { url, cacheKey } = libUrl("/search", {...}); await getJson(url, { cacheKey });
```

### Pattern 2: GraphQL over `postJson()` (Product Hunt)

**What:** Product Hunt is the only GraphQL server. `postJson()` already handles
POST + cache (body-aware key via sha1) + retry + stale. The server assembles the
GraphQL `{ query, variables }` body and passes `productHuntHeaders()` (bearer) as
`headers`; `postJson` adds `Content-Type: application/json`.

**When to use:** the one GraphQL source in this phase.

**Example:**
```javascript
// Source: shared/http_client.js postJson() (in-repo) + Product Hunt v2 docs [CITED]
const body = {
  query: `query($after:DateTime,$topic:String,$n:Int!){
    posts(order:VOTES, postedAfter:$after, topic:$topic, first:$n){
      edges{ node{ id name tagline description votesCount commentsCount
                   url website createdAt
                   topics{ edges{ node{ slug } } }
                   user{ name username } } } } }`,
  variables: { after: startOfPeriodIso, topic: topic ?? null, n: limit },
};
const raw = await postJson(PH_GRAPHQL, { body, headers: productHuntHeaders() });
// GraphQL returns HTTP 200 even on query errors — check raw.errors (see Pitfall 4).
const nodes = (raw.data?.posts?.edges ?? []).map((e) => e.node);
```

### Anti-Patterns to Avoid

- **Emitting a `type` not in `TYPE`** — SDK output validation rejects it (Pitfall 1).
- **Putting `api_key` in the cache key or letting it reach error text** — reuse the
  `seUrl`/`redactUrl` pattern (Pitfall 3).
- **Treating a GraphQL HTTP 200 with an `errors` array as success** — check
  `raw.errors` and surface a clear message (Pitfall 4).
- **A second per-issue fetch just to get reaction counts** — unnecessary; reactions
  are in the search response (Pitfall 2 / D-09 resolved).
- **Reading `process.env` in a server or calling `fetch` directly** — forbidden by
  CLAUDE.md; use the helpers and `getJson`/`postJson`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP + cache + retry + stale | per-server fetch wrapper | `getJson()` / `postJson()` | Uniform resilience (§8); direct `fetch` forbidden |
| Credential env reads | `process.env.GITHUB_TOKEN` in server | `githubHeaders()`/`librariesIoParams()`/`productHuntHeaders()` | CRED-01 single source of truth; helpers already exist + tested |
| Output shaping | hand-built result objects | `buildListEnvelope`/`buildDetailEnvelope`/`toolResult` | Contract cannot drift; dual `content`+`structuredContent` guaranteed |
| HTML/entity stripping | per-server regex | `stripHtml()` (called inside `normalizeItem`) | GitHub issue bodies/PH descriptions cleaned identically (OUT-03) |
| Secret-free cache key | ad-hoc key strings | `seUrl`-style split (public vs authed) | Prevents `api_key` entering cache/errors (WR-01) |
| Base64 / date libs | new deps | Node built-ins (`Buffer`, `Date.toISOString`) | Zero-dep policy; APIs already return ISO-8601 (no epoch math this phase) |

**Key insight:** every "hard" part is already solved in `shared/`. A Phase 3 server
is ~150 lines of field mapping + URL/GraphQL construction and nothing else.

## Common Pitfalls

### Pitfall 1: `type` enum gap — `issue`/`package`/`launch` are NOT in `TYPE` (BLOCKER)
**What goes wrong:** `toolResult(env)` returns `structuredContent`, which the SDK
validates against the tool's `outputSchema`. `itemShape.type = z.enum(TYPE)` and
`TYPE = ["story","ask","show","question","article","repo","comment","post","job"]`
[VERIFIED: shared/contract.js:22-32]. A GitHub-issue item (`type:"issue"`) or a
Libraries.io item (`type:"package"`) will **throw a Zod validation error on every
call** because those values are not in the enum.
**Why it happens:** CONTEXT D-01 / Claude's-Discretion assign new `type` values the
contract module was never extended for; the ARCHITECTURE §4 jsonc comment lists
`repo` but also omits `issue`/`package`/`launch`.
**How to avoid:** As the **first task of the phase** (shared prerequisite for both
plans), extend the enum additively:
```javascript
export const TYPE = [ ...existing, "issue", "package", "launch" ];
```
and update the ARCHITECTURE §4 type comment to match. Product Hunt may use the
existing `post` value instead of `launch` if a smaller diff is preferred, but
`issue` and `package` have **no** existing substitute and must be added.
**Warning signs:** a tool call returns an SDK error mentioning `invalid enum value`
or the tool "runs but the result is rejected."
**Sequencing note:** if 03-01 and 03-02 run in parallel, both editing
`contract.js` risks a merge conflict. Do the enum edit once — either in a tiny
wave-0 task or in 03-01 with 03-02 depending on it.

### Pitfall 2: Expecting reactions to require a preview header or a second fetch
**What goes wrong:** wiring the deprecated `Accept: application/vnd.github.squirrel-girl-preview+json`
header, or fetching each issue individually to read reactions.
**Why it happens:** reactions were a 2016 preview; stale docs still reference the
preview media type.
**How to avoid:** Reactions are **GA**. `GET /search/issues` returns a `reactions`
object with `total_count` (and per-emoji counts) directly in each result item on
the standard `Accept: application/vnd.github+json` media type [CITED:
docs.github.com/en/rest/search + /rest/reactions]. Map `item.reactions.total_count
→ score`. No preview header, no per-issue call. **[Flagged for one live smoke:
confirm the `reactions` object is present in the search list payload for your
pinned `X-GitHub-Api-Version`.]**
**Warning signs:** `score` lands null on issues that visibly have reactions on GitHub.

### Pitfall 3: Libraries.io `api_key` is a query param (secret in URL)
**What goes wrong:** the key ends up in the cache key or in a thrown error string.
**Why it happens:** `librariesIoParams()` returns `{ api_key }`, appended to the
URL query — identical to Stack Exchange's `key=`.
**How to avoid:** reuse the `seUrl` split (public cacheKey without `api_key`, authed
URL with it); `http_client`'s `redactUrl` already strips the query from error text.
Add a unit test mirroring `stackexchange.test.js:202` ("key in URL, never in cache
key").
**Warning signs:** a cache key or MCP error message containing `api_key=`.

### Pitfall 4: GraphQL returns HTTP 200 on query errors
**What goes wrong:** Product Hunt (like all GraphQL) returns `200 { "errors":[...],
"data":null }` for a bad query/field — `postJson` won't throw, and `raw.data.posts`
is undefined, so the mapper silently yields an empty list.
**Why it happens:** GraphQL error semantics differ from REST status codes.
**How to avoid:** after `postJson`, check `if (raw.errors?.length) throw new
Error(...)` and defensively read `raw.data?.posts?.edges ?? []`. (An invalid/absent
token is different: absent → `productHuntHeaders()` throws before the call, D-10;
invalid → HTTP 401 → `postJson` throws a clear terminal 4xx error.)
**Warning signs:** `count: 0` on a query that should return launches.

### Pitfall 5: GitHub Search returns both issues AND pull requests
**What goes wrong:** `GET /search/issues` includes PRs unless filtered; PRs pollute
pain-point results and carry a `pull_request` key.
**How to avoid:** always include `is:issue` in `q` (D-08 already specifies this),
and/or skip items where `item.pull_request` is present.

### Pitfall 6: GitHub Search qualifiers live in `q`, not separate params
**What goes wrong:** sending `created`/`stars`/`language`/`label` as top-level query
params; GitHub ignores them.
**How to avoid:** compose them into the `q` string — e.g.
`q=<text> language:rust stars:>50 pushed:>2026-06-25`, then separate `sort=stars`
and `order=desc` params. `language:` and `label:` are `q` qualifiers; only `sort`,
`order`, `per_page`, `page` are real params. URL-encode the whole `q`.

### Pitfall 7: `registerTool` takes RAW Zod shapes, not `z.object(...)`
**What goes wrong:** wrapping `inputSchema`/`outputSchema` in `z.object()` breaks at
SDK 1.29 (documented Phase 1 pitfall).
**How to avoid:** pass the raw shape object (`listEnvelopeShape`,
`detailEnvelopeShape`, and inline input shapes) exactly as every existing server does.

## Runtime State Inventory

> Not a rename/refactor/migration phase — greenfield server additions. No stored
> data, live-service config, OS-registered state, or build artifacts carry a name
> that changes. **Nothing to migrate — verified: this phase only adds new files
> under `servers/<new>/` and additively extends `TYPE`.**

## Field Mapping (source JSON → normalized item)

The contract item is: `id, type, title, author, score, num_comments, created_utc,
url, permalink, tags, text` (+ `comments[]` on detail). All three APIs return ISO-8601
timestamps — **no epoch conversion** (unlike Stack Exchange).

### GitHub — trending repos (`GET /search/repositories`), `type:"repo"`
| Normalized | Source field | Notes |
|---|---|---|
| `id` | `String(id)` | numeric repo id |
| `type` | `"repo"` | literal (in existing enum) |
| `title` | `full_name` (or `name`) | `owner/repo` reads better |
| `author` | `owner.login` | |
| `score` | `stargazers_count` | §5 stars |
| `num_comments` | `null` | n/a for repos |
| `created_utc` | `created_at` (ISO) or `pushed_at` | already ISO-8601 |
| `url` | `homepage` ?? `html_url` | external; planner discretion |
| `permalink` | `html_url` | canonical repo page |
| `tags` | `[language].filter(Boolean).concat(topics ?? [])` | `topics` present in search response |
| `text` | `description` | stripHtml downstream |

**List call:** `GET https://api.github.com/search/repositories?q={q}&sort=stars&order=desc&per_page={limit}`
where `q` folds in optional `language:` and the recency qualifier
`created:>{today-Nd}` / `pushed:>{today-Nd}` (D-03; `since`→N days: day=1, week=7, month=30).

### GitHub — issues (`GET /search/issues`), `type:"issue"` (NEW enum value)
| Normalized | Source field | Notes |
|---|---|---|
| `id` | `String(number)` (or `id`) | `number` is what detail/comment URLs need |
| `type` | `"issue"` | **requires TYPE extension (Pitfall 1)** |
| `title` | `title` | |
| `author` | `user.login` | |
| `score` | `reactions.total_count` | **GA, in list response (D-09 resolved)** |
| `num_comments` | `comments` | integer count |
| `created_utc` | `created_at` (ISO) | |
| `url` | `html_url` | |
| `permalink` | `html_url` | |
| `tags` | `labels.map(l => l.name)` | |
| `text` | `body` | markdown; stripHtml safe |

**List call:** `GET https://api.github.com/search/issues?q={q}&sort=reactions&order=desc&per_page={limit}`
where `q` = `<free text> is:issue is:open` + optional `label:"good first issue"` +
optional `repo:owner/name`. Skip items with a `pull_request` key (Pitfall 5).

### GitHub — detail (`gh_get_item`)
- **Repo:** `GET /repos/{owner}/{repo}` → map as repo, `comments: []`.
- **Issue:** `GET /repos/{owner}/{repo}/issues/{number}` → map as issue, then
  `GET /repos/{owner}/{repo}/issues/{number}/comments` → each comment
  `{ id:String(id), author:user.login, text:body }` (top-level only, HN precedent).
- **Input disambiguation (planner call):** accept `{ owner, repo, number? }` — when
  `number` is present it's an issue, else a repo. (Alternatively an explicit
  `kind:"repo"|"issue"`.) Guard the not-found case like `requireSeQuestion`.

### Libraries.io — search (`GET /api/search`), `type:"package"` (NEW enum value)
| Normalized | Source field | Notes |
|---|---|---|
| `id` | `` `${platform}/${name}` `` | no numeric id; composite is stable |
| `type` | `"package"` | **requires TYPE extension (Pitfall 1)** |
| `title` | `name` | |
| `author` | `null` (or `repository_url` owner) | packages have no single author; null is fine |
| `score` | `dependents_count` (D-04 default) or `rank` | §5 dependents/rank |
| `num_comments` | `null` | n/a |
| `created_utc` | `latest_release_published_at` (ISO) | |
| `url` | `package_manager_url` ?? `repository_url` ?? `homepage` | |
| `permalink` | `package_manager_url` | canonical registry page |
| `tags` | `keywords ?? []` | array |
| `text` | `description` | |

**List call:** `GET https://libraries.io/api/search?q={query}&platforms={platform}&sort={sort}&per_page={limit}&api_key={KEY}`
Valid `sort`: `rank`, `stars`, `dependents_count` (default), `dependent_repos_count`,
`latest_release_published_at`, `contributions_count`, `created_at` [CITED:
libraries.io/api]. `platforms` default `npm` (D-06 passthrough). **Use the `libUrl`
secret-free-cacheKey split (Pitfall 3).**
**Detail call:** `GET https://libraries.io/api/{platform}/{name}?api_key={KEY}` →
same map; `comments: []`.

### Product Hunt — launches (GraphQL `posts`), `type:"launch"` (NEW enum value, or reuse `post`)
| Normalized | Source field | Notes |
|---|---|---|
| `id` | `String(node.id)` | |
| `type` | `"launch"` | **requires TYPE extension** (or use existing `"post"`) |
| `title` | `node.name` | |
| `author` | `node.user.name` ?? `node.user.username` | the hunter/maker |
| `score` | `node.votesCount` | §5 votes |
| `num_comments` | `node.commentsCount` | §5 comments |
| `created_utc` | `node.createdAt` (ISO) | |
| `url` | `node.website` | external product link |
| `permalink` | `node.url` | Product Hunt post page |
| `tags` | `node.topics.edges.map(e => e.node.slug)` | |
| `text` | `node.tagline` (or `node.description`) | |

**List query:** `posts(order: VOTES, postedAfter: {startOfPeriodIso}, topic: {slug|null}, first: {limit})`
— period: today = start of today UTC; this-week = now − 7d (D-05/D-07). Enum
`PostsOrder` includes `VOTES`, `RANKING`, `NEWEST`, `FEATURED_AT` [CITED: Product
Hunt v2 docs]. **[Flagged for one live check: confirm the exact `postedAfter`
argument name and `PostsOrder` member `VOTES` against the live schema/explorer.]**
**Detail query:** `post(id: {id}){ ...fields comments(first: N){ edges{ node{ id
body user{ name username } } } } }` → comments → `{ id, author, text:body }`.

## Code Examples

### GitHub trending repos handler (mirror of the HN/SE template)
```javascript
// Source: servers/hn/server.js + servers/stackexchange/server.js (in-repo) [VERIFIED]
//         GitHub Search API [CITED: docs.github.com/en/rest/search/search]
const GH = "https://api.github.com";
const GH_HEADERS_BASE = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };

server.registerTool("gh_trending_repos", {
  title: "GitHub trending repositories",
  description: "Recently-active repos ranked by stars (Search API). `since` = day/week/month.",
  inputSchema: {
    query: z.string().optional(),
    language: z.string().optional(),
    since: z.enum(["day", "week", "month"]).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  },
  outputSchema: listEnvelopeShape,
}, async ({ query, language, since = "week", limit = 20 }) => {
  const days = { day: 1, week: 7, month: 30 }[since];
  const cutoff = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const qualifiers = [query, language && `language:${language}`, `pushed:>${cutoff}`]
    .filter(Boolean).join(" ");
  const url = `${GH}/search/repositories?q=${encodeURIComponent(qualifiers)}`
    + `&sort=stars&order=desc&per_page=${limit}`;
  const raw = await getJson(url, { headers: { ...GH_HEADERS_BASE, ...githubHeaders() } });
  const env = buildListEnvelope({
    source: "github",
    query: query ?? null,
    results: (raw.items ?? []).map(mapGhRepo),
  });
  return toolResult(env);
});
```

### Libraries.io required-key throw test (proof obligation, criterion 4)
```javascript
// Source: test/credentials.test.js pattern (in-repo) [VERIFIED]
test("lib_search surfaces 'set LIBRARIESIO_KEY' when the key is unset", () => {
  const prev = process.env.LIBRARIESIO_KEY;
  delete process.env.LIBRARIESIO_KEY;
  try {
    assert.throws(() => libUrl("/search", { q: "react" }), /LIBRARIESIO_KEY/);
  } finally {
    if (prev !== undefined) process.env.LIBRARIESIO_KEY = prev;
  }
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| `Accept: …squirrel-girl-preview+json` for reactions | Reactions GA on `application/vnd.github+json`; `reactions` object in responses incl. `/search/issues` | preview 2016 → long since GA | D-09 needs no preview header, no extra fetch |
| Unversioned GitHub REST | `X-GitHub-Api-Version` header (stable `2022-11-28`; newer dated versions exist) | 2022-11-28 | Pin a version header for stability [CITED: docs.github.com] |
| Legacy `GET /search/issues` free-text only | GitHub added **issues advanced search** API support (changelog 2025-03-06); legacy issue-search behavior is being evolved | 2025-03-06 | REST `/search/issues` still works today; **verify no deprecation blocks your pinned version** (Open Question 3) |

**Deprecated/outdated:**
- `squirrel-girl` preview media type — do not use; reactions are GA.
- GitHub's unofficial trending page — no API; emulate via Search (D-03).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `PostsOrder` includes `VOTES` and the arg is `postedAfter` (DateTime) | Product Hunt field map | Query errors → empty list; fixable by consulting the live PH GraphQL explorer. LOW risk (widely documented) |
| A2 | Libraries.io `/api/search` accepts an **empty/broad `q`** for a pure "top by dependents" list without a keyword | Open Questions / Libraries.io | If `q` is required, the "trending" tool must take a mandatory keyword (still satisfies SRC-07 as keyword-scoped most-depended). Reframe, not a blocker |
| A3 | `X-GitHub-Api-Version: 2022-11-28` is a currently-accepted stable version | GitHub headers | If rejected, drop the header (defaults to latest) or use a newer dated version; trivial |
| A4 | Product Hunt developer token (bearer, no OAuth) authorizes read-only `posts`/`post` queries | Product Hunt auth | If OAuth is required for these fields, D-10 wiring is unchanged (still a bearer header) but token acquisition differs. LOW risk (CITED: PH docs say developer token, read-only) |

## Open Questions

1. **Does `reactions.total_count` appear in the `/search/issues` list payload for the
   pinned API version?** (D-09 load-bearing.) — **RESOLVED WITH CONTINGENCY (carried
   into 03-01 Task 2).**
   - What we know: reactions are GA; docs list `reactions` as a search sort and
     document the `reactions` object on issues.
   - What's unclear: whether it's inlined in the **search** list item vs only on the
     per-issue endpoint, for a given `X-GitHub-Api-Version`.
   - Resolution: 03-01 Task 2 now carries BOTH branches. Primary path = read
     `reactions.total_count` from the search LIST item (no per-issue second fetch). The
     documented fallback is now an explicit in-plan action + gating live-smoke check:
     if the smoke shows `reactions` absent from the search item, keep `sort=reactions`
     ordering and populate list `score` where present else leave `score: null`
     (contract-legal), sourcing issue reaction totals from the detail tool
     (`gh_get_item`) — with NO per-issue N+1 fetch added to the list path either way.
     The offline fixture test asserts both branches (`mapGhIssue` is null-safe when the
     `reactions` object is absent). No longer a planning risk.

2. **Libraries.io "most-depended" without a keyword.**
   - What we know: `/api/search?sort=dependents_count&platforms=npm` is the supported
     path; the website search works with empty keywords.
   - What's unclear: whether the **API** requires a non-empty `q`.
   - Recommendation: make `query` optional and try empty `q`; if the API 4xx's,
     require `query` (keyword-scoped most-depended still satisfies SRC-07). Confirm
     with one live call.

3. **Is legacy `GET /search/issues` scheduled for deprecation?** (2025-03-06 changelog
   introduced issues advanced search.)
   - Recommendation: verify the endpoint still serves the `q`+`sort=reactions` shape
     on the pinned version at Plan time; if deprecated, the fallback is GitHub GraphQL
     search (reuses `postJson()`), which is already the deferred Discussions path.

4. **Product Hunt exact `posts` argument/enum names** (A1) — confirm via the PH
   GraphQL explorer during Execute.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node runtime | all servers | ✓ | ≥18 (`engines` in package.json; global `fetch`) | — |
| `@modelcontextprotocol/sdk` | all servers | ✓ | ^1.29.0 (installed) | — |
| `zod` | all schemas | ✓ | ^4.4 (installed) | — |
| Network → api.github.com | GitHub server | required at runtime | — | cache/stale fallback (§8); offline tests use fixtures |
| Network → libraries.io | Libraries.io server | required at runtime | — | same |
| Network → api.producthunt.com | Product Hunt server | required at runtime | — | same |
| `GITHUB_TOKEN` | GitHub (optional) | operator-set | — | **degrades to anonymous** (10 req/min search, 60/hr core) via `githubHeaders()`→`{}` |
| `LIBRARIESIO_KEY` | Libraries.io (**required**) | operator-set | — | **none** — `librariesIoParams()` throws "set LIBRARIESIO_KEY" (D-10, by design) |
| `PRODUCTHUNT_TOKEN` | Product Hunt (**required**) | operator-set | — | **none** — `productHuntHeaders()` throws "set PRODUCTHUNT_TOKEN" (D-10, by design) |

**Missing dependencies with no fallback:** none for *building/testing* (all tests
are offline over fixtures). At *runtime*, the two required keys have no fallback —
that is the intended CRED-04 behavior and criterion-4 proof, not a defect.

**Rate limits (plan for them, don't hard-code retries beyond §8):**
- GitHub Search: **10 req/min unauth, 30 req/min authed**; core REST 60/hr unauth
  vs 5000/hr authed [CITED: docs.github.com]. Practical impact: anonymous mode is
  fine for interactive research bursts; the ~15-min cache absorbs repeats. 4xx
  (incl. 403 rate-limit/429) is **never retried** by `http_client` — a clear error
  surfaces, which is acceptable.
- Libraries.io: **60 req/min** with a key; 429 on excess [CITED: libraries.io/api].
- Product Hunt: **6250 complexity points / 15 min** (not a simple req count)
  [CITED: PH v2 docs]. Keep queried fields minimal.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` + `node:assert/strict` (built-in, zero-dep) |
| Config file | none — Node's built-in test runner |
| Quick run command | `node --test test/github.test.js` (single file) |
| Full suite command | `npm test` (= `node --test`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SRC-06 | `mapGhRepo` maps stars→score, null num_comments, type:"repo" | unit (fixture) | `node --test test/github.test.js` | ❌ Wave 0 |
| SRC-06 | `mapGhIssue` maps `reactions.total_count`→score, comments→num_comments, type:"issue" | unit (fixture) | `node --test test/github.test.js` | ❌ Wave 0 |
| SRC-06 | list/detail envelopes parse against `ListEnvelopeSchema`/`DetailEnvelopeSchema` | unit | `node --test test/github.test.js` | ❌ Wave 0 |
| SRC-06 | 3 tools register, each declares `outputSchema` | smoke | `node --test test/github.test.js` | ❌ Wave 0 |
| SRC-06 | `githubHeaders()` degrades to `{}` when unset | unit (exists) | `node --test test/credentials.test.js` | ✅ |
| SRC-07 | `mapLibProject` maps dependents_count→score, type:"package" | unit (fixture) | `node --test test/libraries.test.js` | ❌ Wave 0 |
| SRC-07 | `api_key` in URL but never in cache key | unit | `node --test test/libraries.test.js` | ❌ Wave 0 |
| SRC-07 | missing `LIBRARIESIO_KEY` throws "set LIBRARIESIO_KEY" (criterion 4) | unit | `node --test test/libraries.test.js` | ❌ Wave 0 (helper test ✅) |
| SRC-08 | `mapPhPost` maps votesCount→score, commentsCount→num_comments, type:"launch" | unit (fixture) | `node --test test/producthunt.test.js` | ❌ Wave 0 |
| SRC-08 | GraphQL `errors` array surfaces a clear error | unit | `node --test test/producthunt.test.js` | ❌ Wave 0 |
| SRC-08 | missing `PRODUCTHUNT_TOKEN` throws "set PRODUCTHUNT_TOKEN" (criterion 4) | unit | `node --test test/producthunt.test.js` | ❌ Wave 0 (helper test ✅) |
| (contract) | `TYPE` includes `issue`/`package`/`launch`; envelopes with these types parse | unit | `node --test test/contract.test.js` | extend existing |

### Sampling Rate
- **Per task commit:** `node --test test/<server>.test.js` (the file under edit).
- **Per wave merge:** `npm test` (full suite — all servers + shared).
- **Phase gate:** full suite green + MCP Inspector shows all three servers' tools
  callable before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `test/github.test.js` — covers SRC-06 (repo + issue map helpers, reactions→score
  fixture, registration). Needs `test/fixtures/github-repos.json`,
  `github-issues.json`, `github-issue-detail.json`, `github-issue-comments.json`.
- [ ] `test/libraries.test.js` — covers SRC-07 (map helper, key-not-in-cache-key,
  missing-key throw). Needs `test/fixtures/libraries-search.json`,
  `libraries-project.json`.
- [ ] `test/producthunt.test.js` — covers SRC-08 (map helper, GraphQL-errors guard,
  missing-token throw). Needs `test/fixtures/producthunt-posts.json`,
  `producthunt-post-detail.json`.
- [ ] Extend `test/contract.test.js` — assert `issue`/`package`/`launch` are valid
  `TYPE` values and that items using them parse against the schema.
- Framework install: none (built-in `node:test`).

## Security Domain

> `security_enforcement` not explicitly disabled → included.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Bearer PAT/token via header (GitHub/PH), API key via query (Libraries.io) — all through `credentials.js`; never hardcoded, never `process.env` in a server |
| V3 Session Management | no | Stateless; no sessions |
| V4 Access Control | no | Read-only public data |
| V5 Input Validation | yes | Zod `inputSchema` on every tool; free-passthrough params (`platform`, `topic`, `language`, `labels`) validated **server-side by the upstream API** (D-06/D-07); all interpolation URL-encoded |
| V6 Cryptography | no | No crypto authored (sha1 cache-key hashing is non-security, in shared `postJson`) |
| V7 Logging | yes | No credential is logged; `redactUrl` strips query strings (incl. Libraries.io `api_key`) from error text |
| V9 Communications | yes | HTTPS-only endpoints; hosts are hardcoded constants, never taken from tool input (SSRF-safe) |

### Known Threat Patterns for {Node MCP server + external API}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| API key leaks into cache key / error / logs | Information Disclosure | `seUrl`/`libUrl` secret-free cacheKey split + `redactUrl` (in-repo, proven) |
| SSRF via tool-controlled host | Tampering/Info Disclosure | Endpoint hosts are module constants; tool input only fills `q`/path segments (encoded) — never the host (same invariant as `lemmyInstance` note) |
| Injection via passthrough params | Tampering | `encodeURIComponent` on all interpolated values; GitHub qualifiers composed then encoded; upstream validates `platform`/`topic`/`label` |
| Required-cred bypass (unauth API call) | Elevation/Repudiation | `requireCred()` throws before any request; unit-tested (criterion 4) |
| GraphQL 200-with-errors treated as success | — (correctness/DoS-ish) | Explicit `raw.errors` check (Pitfall 4) |

## Sources

### Primary (HIGH confidence — verified in-repo)
- `shared/contract.js` — `TYPE` enum (the gap), `normalizeItem`, envelope factories,
  `toolResult`, raw shapes.
- `shared/http_client.js` — `getJson`/`postJson`, retry/stale/redactUrl, cacheKey contract.
- `shared/credentials.js` — `githubHeaders`/`librariesIoParams`/`productHuntHeaders` (already implemented).
- `servers/hn/server.js`, `servers/stackexchange/server.js`, `servers/devto/server.js` — templates (esp. `seUrl` secret-free key).
- `test/stackexchange.test.js`, `test/credentials.test.js` — test patterns incl. required-cred throw and key-not-in-cache-key.
- `package.json` — deps `@modelcontextprotocol/sdk@^1.29.0`, `zod@^4.4`; `test` = `node --test`.

### Secondary (MEDIUM confidence — official docs, CITED)
- docs.github.com/en/rest/search/search — `/search/repositories`, `/search/issues`, sort/order, rate limits, headers.
- docs.github.com/en/rest/reactions — reactions GA + `total_count`.
- github.blog/changelog/2025-03-06 — issues advanced search (deprecation watch, OQ3).
- libraries.io/api — `/api/search` sort values, `/api/:platform/:name`, 60 req/min.
- api.producthunt.com/v2/docs — GraphQL endpoint, developer token (read-only), `posts` query, 6250-complexity/15min limit.

### Tertiary (LOW confidence — flagged for live verification)
- Product Hunt exact `PostsOrder` members and `postedAfter` arg name (A1/OQ4).
- Presence of `reactions.total_count` inline in `/search/issues` list items for the pinned version (OQ1).
- Libraries.io empty-`q` behavior (A2/OQ2).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new deps; all shared modules verified in-repo.
- Architecture / patterns: HIGH — direct copy of three shipped servers.
- Field maps: MEDIUM-HIGH — CITED against official docs; three claims flagged for a one-call smoke.
- Pitfalls: HIGH — Pitfall 1 (TYPE gap) verified against `contract.js` source; others from proven in-repo patterns + official docs.

**Research date:** 2026-07-02
**Valid until:** ~2026-08-01 (30 days; GitHub issues-search evolution per OQ3 is the fastest-moving item — re-check that changelog if planning slips)
