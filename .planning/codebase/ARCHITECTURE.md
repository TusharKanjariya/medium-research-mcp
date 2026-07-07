<!-- refreshed: 2026-07-07 -->
# Architecture

**Analysis Date:** 2026-07-07

## System Overview

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                    Claude Desktop (MCP client, stdio)                    │
├──────────┬──────────┬──────────┬──────────┬──────────┬──────────────────┤
│  hn      │ stackex. │ lobsters │  devto   │  lemmy   │ github / rss /   │
│`servers/ │`servers/ │`servers/ │`servers/ │`servers/ │ librariesio /    │
│ hn/`     │ stackex- │ lobsters/│ devto/`  │ lemmy/`  │ producthunt      │
│          │ change/` │`         │          │          │ (`servers/*/`)   │
└────┬─────┴────┬─────┴────┬─────┴────┬─────┴────┬─────┴───────┬──────────┘
     │          │          │          │          │             │
     ▼          ▼          ▼          ▼          ▼             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Shared modules (`shared/`)                        │
│  contract.js (output contract + envelopes + toolResult)                 │
│  http_client.js (getJson/postJson/getText: cache+retry+stale+SSRF)      │
│  credentials.js (ONLY process.env reader)   auth.js (token exchange)    │
│  cache.js (TTL + stale retention)           rank.js (branch-free merge) │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │ native fetch (via http_client only)
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  External public APIs: Algolia HN, Stack Exchange, Lobsters, Lemmy,      │
│  Dev.to (Forem), GitHub REST, Libraries.io, Product Hunt GraphQL,        │
│  arbitrary RSS/Atom feeds                                                │
└─────────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Source servers (x9) | One MCP server per source: tool registration + source-specific field mapping only | `servers/<source>/server.js` |
| Output contract | Item/envelope Zod schemas, `normalizeItem`, `stripHtml`, `buildListEnvelope`, `buildDetailEnvelope`, `toolResult` | `shared/contract.js` |
| HTTP client | ONLY fetch path: `getJson`, `postJson`, `getText`; cache + retry/backoff + stale fallback + SSRF guard (`assertSafeUrl`) | `shared/http_client.js` |
| TTL cache | In-memory cache with stale retention (`getFresh`/`getStale`/`set`) | `shared/cache.js` |
| Credentials | ONLY `process.env` reader; `ENV_VAR` map; required vs optional credential helpers | `shared/credentials.js` |
| Auth token exchange | Reddit OAuth2 password grant + Lemmy 0.19 login → cached tokens (`cachedToken`, `redditToken`, `lemmyJwt`) | `shared/auth.js` |
| Merge/rank | Branch-free multi-source `mergeRank` + `filterByMinScore` over contract fields | `shared/rank.js` |
| Live demo | Manual smoke pulling 6 keyless sources through `mergeRank` | `examples/uniform-run.mjs` |
| Packaging scaffold | `.mcpb` manifest (packaging deferred to v2; documentation-only today) | `servers/<source>/manifest.json` |

## Pattern Overview

**Overall:** Hub-and-spoke plugin suite — many thin, single-purpose MCP servers (spokes) sharing a small set of mandatory core modules (hub). Each server is an independent stdio process; there is no inter-server communication.

**Key Characteristics:**
- **Uniform output contract is the load-bearing invariant.** Every list tool returns `{ source, query, count, results[] }`; every detail tool returns `{ source, item: { …, comments[] } }`. Item shape: `id, type, title, author, score, num_comments, created_utc, url, permalink, tags, text`. `score` and `num_comments` may be `null` but must NEVER be renamed or dropped (`shared/contract.js:45-57`).
- **Adding a source reduces to pure field-mapping.** Servers contain only URL construction and `map*()`/`normalize*()` helpers; everything reusable (defaulting, HTML stripping, envelope assembly, dual-content return, cache/retry/stale) is imported from `shared/`.
- **Single fetch chokepoint.** No server calls `fetch()` directly for tool traffic; all HTTP goes through `shared/http_client.js` so caching, retries, stale fallback, and SSRF controls apply everywhere. (The only direct `fetchImpl` calls are the token exchanges inside `shared/auth.js`, which are injectable and password-carrying by design.)
- **Single `process.env` chokepoint.** `shared/credentials.js` is the only module in the repo that reads `process.env` (grep-verifiable).

## Layers

**Server layer (`servers/*/server.js`):**
- Purpose: MCP wiring + source-specific field mapping
- Location: `servers/hn/`, `servers/stackexchange/`, `servers/lobsters/`, `servers/devto/`, `servers/lemmy/`, `servers/github/`, `servers/librariesio/`, `servers/producthunt/`, `servers/rss/`
- Contains: `McpServer` instantiation, `server.registerTool(...)` blocks, exported `mapX()` helpers, fixed API base-URL constants
- Depends on: `shared/contract.js`, `shared/http_client.js`, and (where credentialed) `shared/credentials.js` / `shared/auth.js`
- Used by: Claude Desktop over stdio; tests import the module without connecting a transport

**Shared core (`shared/`):**
- Purpose: everything that must be identical across sources
- Location: `shared/contract.js`, `shared/http_client.js`, `shared/cache.js`, `shared/credentials.js`, `shared/auth.js`, `shared/rank.js`
- Contains: schemas/factories, HTTP resilience + SSRF guard, TTL cache, credential resolution, token exchange, merge/rank
- Depends on: `zod`, Node built-ins (`node:crypto`, `node:net`, `node:dns/promises`); `http_client.js` depends on `cache.js` and `credentials.js`; `auth.js` depends on `credentials.js`
- Used by: every server; `rank.js` is also the reference implementation for the consuming `medium-blog-pro` skill

**Consumer layer (external):**
- Purpose: the `medium-blog-pro` skill merges envelopes from many servers with zero per-source logic — the property proven by `shared/rank.js` and `examples/uniform-run.mjs`

## Data Flow

### Primary Request Path (list tool, e.g. `hn_search`)

1. Claude Desktop invokes a registered tool over stdio; SDK validates input against the raw Zod `inputSchema` (`servers/hn/server.js:150-172`)
2. Handler builds the source URL and calls `getJson(url)` (`servers/hn/server.js:162`)
3. `getJson` serves a fresh cache hit, else fetches with timeout, retrying transient failures (500/502/503/504, network, timeout, non-JSON) with 500/1000/2000ms backoff; 4xx never retries; exhausted transient retries fall back to a stale cache entry (`shared/http_client.js:253-333`)
4. Handler maps raw hits via the server's `map*()` helper (pure field mapping, e.g. `mapHnHit`, `servers/hn/server.js:74`)
5. `buildListEnvelope()` runs every item through `normalizeItem()` (defaulting, id stringification, `stripHtml`) and assembles `{ source, query, count, results }` (`shared/contract.js:125-128`)
6. `toolResult(envelope)` returns `{ content: [{type:"text", text: JSON.stringify(envelope)}], structuredContent: envelope }`; SDK validates `structuredContent` against `listEnvelopeShape` (`shared/contract.js:148-153`)

### Detail Path (e.g. `hn_get_item`)

1. Handler fetches the detail endpoint via `getJson`
2. `map*Item()` returns `{ item, comments }` — comments flattened to top-level `{ id, author, text }` only
3. `buildDetailEnvelope()` normalizes the item and strips HTML from comment text (`shared/contract.js:130-142`)
4. `toolResult()` emits the dual return

### RSS / Untrusted-URL Path (`rss_fetch`)

1. Handler receives an untrusted feed URL as tool input (`servers/rss/server.js:216`)
2. `getText(url)` runs `assertSafeUrl` — scheme allowlist (http/https), optional `RSS_ALLOWED_HOSTS` operator allowlist, DNS-resolved private/loopback/link-local/CGNAT denylist via `node:net` BlockList — on the initial host AND on every redirect hop (`redirect: "manual"`, max 5 hops) (`shared/http_client.js:173-238, 469-546`)
3. Body parsed with a hardened `fast-xml-parser` instance (entity-expansion caps) (`servers/rss/server.js:59-68`)
4. RSS 2.0 / RDF / Atom entries map to contract items with `type: "article"`, `score`/`num_comments` both `null`

### Authenticated Paths

- **Required creds (Libraries.io, Product Hunt):** `librariesIoParams()` / `productHuntHeaders()` throw `Missing credential: set <ENV_VAR>` when unset — the server still starts; the error surfaces at call time (`shared/credentials.js:67-72`)
- **Optional creds (Stack Exchange, GitHub, Lemmy, Reddit):** helpers return `{}`/`undefined` when unset so the server degrades to keyless/anonymous access (`shared/credentials.js:55-64, 104-123`)
- **Token exchange (Reddit, Lemmy):** `cachedToken(key, ttl, exchange)` caches `{ token, expires }` only — passwords never enter any cache (`shared/auth.js:33-39`)
- **GraphQL (Product Hunt):** the ONE POST server; uses `postJson` (body-hashed cache key) plus a `requirePhOk()` guard because GraphQL returns HTTP 200 with an `errors` array (`servers/producthunt/server.js`)

**State Management:**
- All state is in-memory and per-process: module-level `Map` in `shared/cache.js` (unbounded, never evicted — stale retention is deliberate) and `tokenCache` in `shared/auth.js`. Everything resets on process restart. No database, no files.

## Key Abstractions

**Contract item / envelopes:**
- Purpose: the single normalized shape every source maps onto
- Examples: `itemShape`, `listEnvelopeShape`, `detailEnvelopeShape` in `shared/contract.js`
- Pattern: raw Zod SHAPES (plain objects of fields) are passed to `registerTool` for input/output schemas; compiled `z.object` versions (`ItemSchema`, `ListEnvelopeSchema`, `DetailEnvelopeSchema`) exist for runtime `.parse()` in tests. The `TYPE` enum (`shared/contract.js:28-41`) is APPEND-ONLY — new item types go at the end.

**`map*()` field-mapping helpers:**
- Purpose: the ONLY source-specific logic in each server; pure functions from a raw API payload to a pre-normalize contract item
- Examples: `mapHnHit`/`mapHnItem` (`servers/hn/server.js`), `mapAtomEntry` (`servers/rss/server.js`), `phAuthor` + post mapper (`servers/producthunt/server.js`)
- Pattern: exported for unit testing against captured fixtures in `test/fixtures/`

**Envelope factories + `toolResult`:**
- Purpose: make output-contract drift structurally impossible — `content` and `structuredContent` are assembled in exactly one place
- Examples: `buildListEnvelope`, `buildDetailEnvelope`, `toolResult` in `shared/contract.js`

**Resilient fetch (`getJson` / `postJson` / `getText`):**
- Purpose: uniform cache/retry/stale/SSRF behavior; `fetchImpl`, `sleep`, and `lookup` are injectable for offline tests
- Examples: `shared/http_client.js`

**`cachedToken`:**
- Purpose: one username/password→token path shared by Reddit and Lemmy
- Examples: `shared/auth.js:33`

## Entry Points

**Each server binary:**
- Location: `servers/<source>/server.js` (run as `node servers/<source>/server.js`)
- Triggers: spawned by Claude Desktop (per `manifest.json` `mcp_config`) or manually / via MCP Inspector
- Responsibilities: registers tools, then connects `StdioServerTransport` ONLY when run directly — the `import.meta.url === pathToFileURL(process.argv[1]).href` guard (`servers/hn/server.js:195-200`) lets tests import the module without starting a transport

**Tool inventory (per server):**

| Server | Tools |
|--------|-------|
| `servers/hn/` | `hn_front_page`, `hn_search`, `hn_get_item` |
| `servers/stackexchange/` | `so_hot_questions`, `so_search`, `so_get_question` |
| `servers/lobsters/` | `lobsters_hottest`, `lobsters_tag`, `lobsters_get`, `lobsters_search` |
| `servers/devto/` | `devto_top`, `devto_tag`, `devto_search`, `devto_get` |
| `servers/lemmy/` | `lemmy_hot`, `lemmy_search`, `lemmy_post` |
| `servers/github/` | `gh_trending_repos`, `gh_search_issues`, `gh_get_item` |
| `servers/librariesio/` | `librariesio_search`, `librariesio_get` |
| `servers/producthunt/` | `producthunt_launches`, `producthunt_get` |
| `servers/rss/` | `rss_fetch` (deliberate single-tool deviation — a feed has no search/detail) |

**Manual demo:**
- Location: `examples/uniform-run.mjs` — live multi-source merge; NOT part of `npm test`

**Tests:**
- Location: `test/*.test.js`, run by `node --test` (`npm test`)

## Architectural Constraints

- **Threading:** single-threaded Node event loop per server process; no workers. Each server is an isolated process — caches are NOT shared across servers.
- **Global state:** module-level singletons by design — `store` Map in `shared/cache.js:15`, `tokenCache` in `shared/auth.js:21`, `DENY` BlockList and one `XMLParser` instance in `servers/rss/server.js:59`. Cache memory is unbounded (accepted; entries are overwritten, never evicted).
- **Circular imports:** none. Dependency direction is strictly `servers/* → shared/*`; within `shared/`, `http_client → cache + credentials`, `auth → credentials`.
- **SDK version coupling:** `registerTool` at `@modelcontextprotocol/sdk` 1.29.0 takes RAW Zod shapes for `inputSchema`/`outputSchema`, NOT `z.object(...)` — passing a compiled schema breaks registration.
- **Fixed outbound hosts:** every API base URL is a module constant; untrusted tool input never selects a host, EXCEPT `rss_fetch(url)` which is why the SSRF guard lives in `getText`. `LEMMY_INSTANCE` is operator-set env, never a tool param.
- **Accepted residual risk:** DNS-rebinding TOCTOU between `assertSafeUrl` check and undici's own connect-time resolution is documented and accepted for a local single-user tool (`shared/http_client.js:158-166`).

## Anti-Patterns

### Calling `fetch()` directly in a server

**What happens:** a handler fetches an API with native `fetch` instead of `getJson`/`postJson`/`getText`.
**Why it's wrong:** loses caching, retry/backoff, stale fallback, URL redaction in errors, and (for text) the SSRF guard — the resilience contract silently breaks for that one source.
**Do this instead:** import from `shared/http_client.js`; POST/GraphQL sources use `postJson` (see `servers/producthunt/server.js:39`).

### Reading `process.env` outside `shared/credentials.js`

**What happens:** a server reads an env var (or hardcodes a key) directly.
**Why it's wrong:** breaks the single-source-of-truth `ENV_VAR` map, the required-vs-optional degradation policy, and the never-log-a-secret guarantee.
**Do this instead:** add the variable to `ENV_VAR` and expose a helper in `shared/credentials.js` (query-param fragment or header fragment pattern, `shared/credentials.js:55-72`).

### Re-implementing normalization or the tool return per server

**What happens:** a server builds its own envelope object or its own `content`/`structuredContent` pair, or strips HTML locally.
**Why it's wrong:** the two return channels (and the item defaults) can drift between sources — the exact failure the suite exists to prevent.
**Do this instead:** map fields only, then `buildListEnvelope`/`buildDetailEnvelope` + `toolResult` from `shared/contract.js`.

### Putting a secret in a cache key or error message

**What happens:** a credential carried as a query param (e.g. Stack Exchange `key=`) ends up in the `getJson` cache key or a thrown error.
**Why it's wrong:** tool errors surface back through MCP results; cache keys are logical identifiers.
**Do this instead:** pass a secret-free `cacheKey` to `getJson` (see `servers/librariesio/server.js:96-107`); error text already goes through `redactUrl` (`shared/http_client.js:41`).

## Error Handling

**Strategy:** never hard-error a tool call when a stale cache entry or keyless fallback exists; fail loudly only for missing REQUIRED credentials and definitive 4xx responses.

**Patterns:**
- Transient failures (5xx {500,502,503,504}, network `TypeError`, `AbortError` timeout, non-JSON body) → retry 3x with 500/1000/2000ms backoff → stale cache fallback → throw with redacted URL (`shared/http_client.js`)
- Strict no-4xx-retry (including 429/408); 4xx also never serves stale (a 404 is a definitive answer)
- Missing required credential → `Missing credential: set <ENV_VAR>` thrown at call time (`shared/credentials.js:45-49`); missing optional credential → silent keyless degradation
- SSRF rejection → plain `Error`, never retried, never served from stale (fail closed)
- GraphQL 200-with-errors → explicit `requirePhOk()` guard before reading `data` (`servers/producthunt/server.js`)

## Cross-Cutting Concerns

**Logging:** none in servers/shared (stdio transport — stdout belongs to the protocol). `examples/uniform-run.mjs` uses `console.log` (it is a standalone demo, not a server).
**Validation:** Zod at the MCP boundary — SDK validates tool input against `inputSchema` and every `structuredContent` return against `outputSchema` (the raw shapes from `shared/contract.js`).
**Authentication:** centralized in `shared/credentials.js` (resolution + required/optional policy) and `shared/auth.js` (password→token exchange with token-only caching). Secrets ride only in headers/POST bodies, marked `"sensitive": true` in `manifest.json` `user_config`.

---

*Architecture analysis: 2026-07-07*
