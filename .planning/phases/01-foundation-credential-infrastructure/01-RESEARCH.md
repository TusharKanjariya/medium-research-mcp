# Phase 1: Foundation & Credential Infrastructure - Research

**Researched:** 2026-07-01
**Domain:** Node ESM MCP servers (`@modelcontextprotocol/sdk`), Zod schema contracts, resilient HTTP, credential/token infrastructure
**Confidence:** HIGH

## Summary

This phase builds the reusable spine every later source server copies: a TTL cache
with stale retention, a dependency-free `getJson()` (retry/backoff + stale fallback),
a **shared output-contract module** (Zod schemas + `normalizeItem()` /
`buildListEnvelope()` / `buildDetailEnvelope()` factories with centralized HTML
stripping), the Hacker News reference server, and credential + token-auth plumbing
(`credentials.js`, `auth.js`, `.env.example`, `.mcpb` `user_config`).

The single most important verified finding: **at the pinned SDK version `1.29.0`,
`registerTool`'s `inputSchema`/`outputSchema` take a RAW Zod shape object** (e.g.
`{ bmi: z.number() }`) **— not `z.object({...})`** — and when `outputSchema` is set
the handler returns **both** `content: [{ type:"text", text: JSON.stringify(x) }]`
**and** `structuredContent: x`. This directly satisfies FOUND-05 and the CLAUDE.md
"emit both" contract. `docs/ARCHITECTURE.md` §3 is accurate on intent but does not
specify the raw-shape detail, and the SDK's `main`-branch README describes an
**unreleased v2 API** (`z.object`, "Standard Schema") that does NOT apply to 1.29.0 —
see Pitfall 2.

**Primary recommendation:** Pin `@modelcontextprotocol/sdk@^1.29.0` and `zod@^4.4`
(SDK peerDep is `zod: ^3.25 || ^4.0`). Build one `shared/contract.js` that exports
Zod object schemas AND their raw shapes, plus a `toolResult(envelope)` helper that is
the ONLY place `content` + `structuredContent` are assembled — making divergence
structurally impossible. Everything else (retry, cache, HTML strip, validation) lives
in shared modules so adding a source is pure field-mapping into `normalizeItem()`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Tool registration / JSON-RPC framing / stdio | MCP SDK (`McpServer`) | — | SDK owns protocol; never hand-roll transport `[VERIFIED: SDK 1.29.0 docs]` |
| Output-contract enforcement | `shared/contract.js` (Zod) | SDK `outputSchema` validation | One schema, reused as `outputSchema`; SDK validates `structuredContent` on return `[VERIFIED: SDK 1.29.0 docs]` |
| HTTP + resilience (cache/retry/stale) | `shared/http_client.js` | `shared/cache.js` | Servers never call `fetch` (CLAUDE.md); retry/stale centralized `[CITED: ARCHITECTURE §8]` |
| Credential resolution (env→value) | `shared/credentials.js` | — | Single `process.env` reader (CLAUDE.md) `[CITED: ARCHITECTURE §6]` |
| Username/password → cached token | `shared/auth.js` | `credentials.js` | Reddit grant + Lemmy login share one cached-token path `[CITED: ARCHITECTURE §6]` |
| Source field mapping (HN) | `servers/hn/server.js` | `contract.normalizeItem` | Per-source glue only; all shared behavior imported `[CITED: CONTEXT D-01]` |
| Secret storage at rest | `.mcpb` `user_config` (OS keychain) | `.env` (dev) | `"sensitive": true` → keychain `[VERIFIED: mcpb MANIFEST spec]` |

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Contract enforced by a **shared module** exporting Zod schemas (item +
  list/detail envelopes) AND factories `normalizeItem(partial)`,
  `buildListEnvelope({ source, query, results })`,
  `buildDetailEnvelope({ source, item })`. The same Zod schema is reused as each
  tool's `registerTool` `outputSchema`. Adding a source = pure field-mapping into
  `normalizeItem()`.
- **D-02:** `normalizeItem()` fills every contract field, defaulting absent fields to
  `null` (never dropping/renaming `score` or `num_comments`), and strips HTML from
  `text` (OUT-03). HTML-stripping lives in the shared module.
- **D-03:** Reddit reads keyless by default via `www.reddit.com/r/<sub>/.json` (no
  login, no app).
- **D-04:** `auth.js` ALSO supports an **optional** Reddit OAuth2 password grant,
  activated only when username + password + `client_id` + `client_secret` are all
  present; otherwise degrade to keyless. Docs must warn the grant still needs a
  karma-gated script app. 2FA appends `:TOTP`; authed calls go to
  `oauth.reddit.com`.
- **D-05:** `auth.js` keeps Lemmy username/password login (`/api/v3/user/login`).
  Both providers exchange creds once for a **cached token** via one shared code path;
  passwords never logged, persisted, or sent per request.
- **D-06:** Tests use Node built-in `node:test` + `node:assert` (`node --test`). No
  vitest/jest.
- **D-07:** Single root `package.json` (`type: module`; deps
  `@modelcontextprotocol/sdk`, `zod`); servers import `../../shared/...`. No npm
  workspaces.

### Claude's Discretion
- Internal file/function names inside `shared/` beyond the public `getJson`,
  `normalizeItem`, `buildListEnvelope`, `buildDetailEnvelope`, `credentials.js`
  per-service helpers; retry jitter; cache-key derivation — planner/executor's call
  provided ARCHITECTURE §4/§6/§8 hold.
- HN `type` mapping (story/ask/show/job → the contract `type` enum) left to
  implementation, following ARCHITECTURE §4's enum.

### Deferred Ideas (OUT OF SCOPE)
- Dedicated Reddit reader **source server** with tools (only `auth.js` Reddit grant
  lands in Phase 1; keyless `.json` reads are a later SRC requirement).
- Per-server `package.json` / npm workspaces.
- vitest/framework tests.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FOUND-01 | `cache.js` in-memory ~15-min TTL cache with stale retention | Cache design in "HTTP client + cache"; never-delete-on-expiry pattern |
| FOUND-02 | `http_client.js` `getJson()` cache + retry/backoff (0.5/1/2s, never 4xx) + stale fallback; no direct `fetch` | `getJson()` signature + retry loop; `AbortController` timeout |
| FOUND-03 | Normalized contract defined + enforced (list/detail envelopes, item schema; `score`/`num_comments` nullable, never renamed) | `contract.js` Zod schemas + raw-shape reuse as `outputSchema` |
| FOUND-04 | HN server exposes `hn_front_page`, `hn_search`, `hn_get_item`, proves pattern | Algolia endpoint + field map; tool list |
| FOUND-05 | Every tool returns an object → SDK emits both `structuredContent` and JSON-text `content` | Verified handler return shape; `toolResult()` helper |
| CRED-01 | `credentials.js` single `process.env` reader; per-service helpers | `ENV_VAR` map + helper fragments pattern |
| CRED-02 | `auth.js` username/password → cached token (Reddit grant, Lemmy login); passwords never logged/persisted/per-request | Shared `cachedToken()` path; Reddit + Lemmy exchange details |
| CRED-03 | `.env.example` documents all vars; `.mcpb` `user_config` → `mcp_config.env` with `"sensitive": true` | mcpb manifest schema + `${user_config.*}` injection |
| CRED-04 | Required creds (Libraries.io, Product Hunt) fail with clear "set X"; keyless sources degrade | `requireCred()` vs optional-helper split |
| OUT-01 | Every server conforms to contract, verified vs ARCHITECTURE §4 | `outputSchema` = contract schema → SDK validates each return |
| OUT-03 | Output trimmed, LLM-readable, HTML stripped from text | `stripHtml()` in `contract.js`, applied in `normalizeItem()` |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | `^1.29.0` (latest; pub 2026-06-04) | `McpServer` + `registerTool` + `StdioServerTransport` | Official MCP SDK; `registerTool` is the current (non-deprecated) API `[VERIFIED: npm registry]` |
| `zod` | `^4.4` (latest 4.4.3) | Input/output schemas + runtime validation | SDK peerDep `zod: ^3.25 \|\| ^4.0`; also the contract validator `[VERIFIED: npm registry]` |
| Node.js | `>=18` (recommend `20 LTS`+; global `fetch`, `AbortController`) | Runtime | ARCHITECTURE §1: Claude Desktop ships Node; native `fetch` = zero HTTP dep `[CITED: ARCHITECTURE §1]` |
| `node:test` + `node:assert` | built-in | Unit tests (`node --test`) | D-06 locked; zero external test dep `[VERIFIED: node docs]` |

### Supporting (Node built-ins — no install)
| Built-in | Purpose | When to Use |
|----------|---------|-------------|
| `Buffer.from(x).toString("base64")` | Reddit Basic-auth `client_id:secret` | `auth.js` — do NOT add a base64 dep |
| `AbortController` + `setTimeout` | Per-request timeout for `fetch` | `getJson()` — `fetch` has no default timeout |
| `import.meta.url` + `node:url` `fileURLToPath` | Path resolution in ESM | Only if a file needs its own dir (no `__dirname` in ESM) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Regex `stripHtml()` | `striptags` (zero-dep) or `html-to-text` | Regex handles HN's limited HTML (`<p>`,`<a>`,`<pre>`,entities) fine; a lib adds a dep for marginal correctness. Stay dependency-free per suite ethos. |
| `zod@^4.4` | `zod@^3.25` | Both accepted by SDK peerDep. Zod 4 is latest & recommended; if a `zod-to-json-schema` quirk appears at build, `3.25.x` is the safe fallback. `[ASSUMED]` — no quirk observed, verify at install |
| Native `fetch` | `undici` / `node-fetch` | Native `fetch` is global on Node 18+; adding a client is pure overhead. |

**Installation:**
```bash
npm install @modelcontextprotocol/sdk@^1.29.0 zod@^4.4
```

**Version verification (run at plan/execute time — training data may drift):**
```bash
npm view @modelcontextprotocol/sdk version   # expect 1.29.0 (pub 2026-06-04)
npm view zod version                         # expect 4.4.3
npm view @modelcontextprotocol/sdk peerDependencies   # zod: ^3.25 || ^4.0
```

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `@modelcontextprotocol/sdk` | npm | pub 2026-03-30 (this ver), project est. 2024 | ~40.9M/wk | github.com/modelcontextprotocol/typescript-sdk | OK | Approved |
| `zod` | npm | pub 2026-05-04 (this ver), project est. 2020 | ~209.7M/wk | github.com/colinhacks/zod | OK | Approved |

- No `postinstall` scripts on either package (checked via legitimacy seam signals).
- **Packages removed due to [SLOP] verdict:** none
- **Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
Claude Desktop / medium-blog-pro skill
        │  (MCP tool call over stdio: hn_search / hn_front_page / hn_get_item)
        ▼
┌──────────────────────────────────────────────────────────────┐
│ servers/hn/server.js   (McpServer + StdioServerTransport)      │
│   registerTool(name, {title,description,inputSchema,           │
│                       outputSchema: <contract raw shape>}, h)  │
│                                                                │
│   handler h(input):                                            │
│     1. build source URL ──────────────┐                        │
│     2. raw = getJson(url, {headers})   │                       │
│     3. items = raw.hits.map(mapHnHit) ─┼── field mapping ONLY  │
│     4. env = buildListEnvelope({...})  │                       │
│     5. return toolResult(env) ─────────┘                       │
└───────┬───────────────────────┬───────────────────────────────┘
        │ getJson()             │ normalizeItem / build*Envelope / toolResult
        ▼                       ▼
┌───────────────────┐   ┌──────────────────────────────────────┐
│ shared/http_client│   │ shared/contract.js                    │
│   cache lookup ───┼──►│  ItemSchema / ListEnvelopeSchema /    │
│   fetch+timeout   │   │  DetailEnvelopeSchema (Zod)           │
│   retry 0.5/1/2s  │   │  normalizeItem() → defaults+stripHtml │
│   5xx/net only    │   │  buildListEnvelope/buildDetailEnvelope│
│   stale fallback ◄┼─┐ │  toolResult() → {content,structured}  │
└─────────┬─────────┘ │ └──────────────────────────────────────┘
          ▼           │
   ┌──────────────┐   │ (on total failure)
   │ shared/cache │───┘  getStale(key) returns expired-but-present entry
   │  Map TTL +   │
   │  stale keep  │
   └──────────────┘

  Credentialed sources (Phase 2+, plumbing built now):
   shared/credentials.js  (ONLY process.env reader) → helper fragments
   shared/auth.js         (username/password → cachedToken; Reddit grant, Lemmy jwt)
```

The HN handler traces input→output through 5 steps; everything reusable is a shared
import. Adding a source = write step 1 (URL) + step 3 (`mapHit`); steps 2/4/5 are identical.

### Recommended Project Structure
```
medium-research-mcp/
├── package.json            # type: module; deps sdk + zod; "test": "node --test"
├── .env.example            # every ENV_VAR documented
├── shared/
│   ├── cache.js            # Map TTL cache + stale retention
│   ├── http_client.js      # getJson(): cache + retry + timeout + stale fallback
│   ├── contract.js         # Zod schemas + shapes + normalizeItem/build*/toolResult/stripHtml
│   ├── credentials.js      # ENV_VAR map (single process.env reader) + per-service helpers
│   └── auth.js             # cachedToken() + redditToken() + lemmyJwt()
├── servers/
│   └── hn/
│       ├── server.js       # 3 tools + mapHnHit/mapHnItem (field mapping only)
│       ├── manifest.json   # .mcpb manifest (documented this phase)
│       └── build-mcpb.sh   # stage + npm install --omit=dev + mcpb pack (later phase)
└── test/                   # or *.test.js beside modules; node --test discovers both
    ├── contract.test.js    # normalizeItem defaults + HTML strip + envelope shape
    ├── http_client.test.js # retry/no-retry-4xx/stale fallback (mock fetch)
    └── hn.test.js          # mapHnHit against captured Algolia payloads
```

### Pattern 1: One contract module exposing both schema AND raw shape
**What:** `registerTool` needs a **raw Zod shape** for `outputSchema`; runtime code
needs a `z.object` to `.parse()`. Export both from the same source so they cannot drift.
**When to use:** Every server, every tool.
**Example:**
```javascript
// shared/contract.js — Source: SDK 1.29.0 docs/server.md (raw-shape outputSchema)
import { z } from "zod";

export const TYPE = ["story","ask","show","question","article","repo","comment","post","job"];

// Raw shape — pass THIS to registerTool as inputSchema/outputSchema.
export const itemShape = {
  id:           z.string(),
  type:         z.enum(TYPE),
  title:        z.string(),
  author:       z.string().nullable(),
  score:        z.number().nullable(),      // NEVER rename/drop
  num_comments: z.number().nullable(),      // NEVER rename/drop
  created_utc:  z.string().nullable(),      // ISO-8601
  url:          z.string().nullable(),
  permalink:    z.string().nullable(),
  tags:         z.array(z.string()),
  text:         z.string().nullable(),
};
export const ItemSchema = z.object(itemShape);

const CommentSchema = z.object({
  id: z.string(), author: z.string().nullable(), text: z.string().nullable(),
});

export const listEnvelopeShape = {                 // registerTool outputSchema for list tools
  source:  z.string(),
  query:   z.string().nullable(),
  count:   z.number(),
  results: z.array(ItemSchema),
};
export const ListEnvelopeSchema = z.object(listEnvelopeShape);

export const detailEnvelopeShape = {               // registerTool outputSchema for detail tools
  source: z.string(),
  item:   ItemSchema.extend({ comments: z.array(CommentSchema) }),
};
export const DetailEnvelopeSchema = z.object(detailEnvelopeShape);
```
> Note: `z.object(...).shape` also returns the raw shape, so an alternative is to
> export only the objects and pass `ListEnvelopeSchema.shape`. Exporting the shape
> explicitly (above) is clearer. Either is `[VERIFIED: SDK 1.29.0 docs]`-compatible.

### Pattern 2: `normalizeItem()` + envelope factories + the single `toolResult()` seam
**What:** All defaulting, HTML stripping, and the `content`/`structuredContent`
assembly happen in exactly one place.
**Example:**
```javascript
// shared/contract.js (continued)
export function stripHtml(html) {
  if (html == null) return null;
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<\/(p|div|br|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\n{3,}/g, "\n\n").trim() || null;
}

export function normalizeItem(p) {
  return {
    id:           String(p.id),
    type:         p.type,
    title:        p.title ?? "",
    author:       p.author ?? null,
    score:        p.score ?? null,
    num_comments: p.num_comments ?? null,
    created_utc:  p.created_utc ?? null,
    url:          p.url ?? null,
    permalink:    p.permalink ?? null,
    tags:         p.tags ?? [],
    text:         p.text != null ? stripHtml(p.text) : null,
  };
}

export function buildListEnvelope({ source, query = null, results }) {
  const items = results.map(normalizeItem);
  return { source, query, count: items.length, results: items };
}
export function buildDetailEnvelope({ source, item, comments = [] }) {
  return {
    source,
    item: {
      ...normalizeItem(item),
      comments: comments.map((c) => ({
        id: String(c.id), author: c.author ?? null,
        text: c.text != null ? stripHtml(c.text) : null,
      })),
    },
  };
}

// THE single place content + structuredContent are built together (satisfies FOUND-05).
export function toolResult(envelope) {
  return {
    content: [{ type: "text", text: JSON.stringify(envelope) }],
    structuredContent: envelope,
  };
}
```
> The SDK validates `structuredContent` against the tool's `outputSchema` on every
> return, so the contract is enforced automatically — no manual `.parse()` needed in
> handlers. (Optionally `.parse()` inside the factories in tests for early failure.)

### Pattern 3: HN server wiring (proves the pattern end-to-end)
```javascript
// servers/hn/server.js — Source: SDK 1.29.0 docs/server.md
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getJson } from "../../shared/http_client.js";
import { buildListEnvelope, buildDetailEnvelope, listEnvelopeShape,
         detailEnvelopeShape, toolResult } from "../../shared/contract.js";

const ALGOLIA = "https://hn.algolia.com/api/v1";
const server = new McpServer({ name: "hn", version: "1.0.0" });

server.registerTool("hn_search",
  { title: "Hacker News search", description: "Search HN stories by relevance",
    inputSchema: { query: z.string(), limit: z.number().int().min(1).max(50).optional() },
    outputSchema: listEnvelopeShape },        // <-- RAW SHAPE, not z.object()
  async ({ query, limit = 20 }) => {
    const raw = await getJson(
      `${ALGOLIA}/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=${limit}`);
    const env = buildListEnvelope({ source: "hackernews", query,
      results: raw.hits.map(mapHnHit) });
    return toolResult(env);
  });
// hn_front_page: tags=front_page, query=null.  hn_get_item: /items/:id → buildDetailEnvelope.

await server.connect(new StdioServerTransport());
```

### Anti-Patterns to Avoid
- **Passing `z.object({...})` to `inputSchema`/`outputSchema`** — 1.29.0 expects a raw
  shape; wrapping breaks tool registration. (Pass the shape or `Schema.shape`.)
- **Building `content` and `structuredContent` separately in each handler** — they
  drift. Always go through `toolResult(env)`.
- **Calling `fetch` in a server** — bypasses cache/retry/stale (CLAUDE.md). Always `getJson()`.
- **Reading `process.env` outside `credentials.js`** — breaks the single-source-of-truth rule.
- **Deleting cache entries on expiry** — kills the stale-fallback guarantee (§8).
- **Following the SDK `main` README** — it documents an unreleased v2 API (see Pitfall 2).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON-RPC / stdio framing | Custom transport | `McpServer` + `StdioServerTransport` | Protocol correctness, lifecycle, capability negotiation |
| Tool JSON-Schema generation | Hand-written JSON schema | Zod raw shape → SDK converts | SDK derives JSON Schema from your Zod shape automatically |
| Runtime output validation | Manual `if (typeof …)` checks | Zod + `outputSchema` | SDK validates `structuredContent` on every return |
| HTTP retry/backoff/cache | Per-server loops | `shared/http_client.getJson()` | One tested path; §8 semantics identical everywhere |
| HTML→text | Per-server regex | `shared/contract.stripHtml()` | OUT-03 applied identically; one place to fix edge cases |
| Basic-auth base64 | A base64 npm package | `Buffer.from(...).toString("base64")` | Node built-in |
| Token caching | Per-provider ad-hoc | `shared/auth.cachedToken()` | Reddit + Lemmy share one path (D-05) |

**Key insight:** In this suite the schema *is* the enforcement and the SDK *is* the
validator — hand-rolling either re-introduces exactly the per-source drift the whole
project exists to prevent.

## HTTP client + cache (FOUND-01 / FOUND-02)

**`getJson()` recommended signature:**
```javascript
// shared/http_client.js
export async function getJson(url, {
  headers = {},
  ttlMs   = 15 * 60 * 1000,   // ~15 min (FOUND-01)
  timeoutMs = 10_000,
  cacheKey = url,             // derive to include logical identity, NEVER the secret
} = {}) { /* … */ }
```

**Retry policy (faithful to §8):**
- Backoff steps `[500, 1000, 2000]` ms (3 retries after the initial try).
- Retry on: network/`TypeError`, `AbortError` (timeout), and 5xx `{500,502,503,504}`.
- **Never retry 4xx.** ARCHITECTURE §8 says "never retry 4xx" verbatim; `429`/`408`
  are technically 4xx. Recommended default: honor §8 literally (do NOT retry 429).
  `[ASSUMED]` refinement worth surfacing to the user: optionally treat `429`/`408` as
  retryable honoring `Retry-After` — flag as a discretion decision, not silent.
- On exhausting retries: return `getStale(cacheKey)` if present, else throw a clear error.

**Cache design (stale retention):**
```javascript
// shared/cache.js
const store = new Map();                    // key -> { value, expires }
export function getFresh(key) {
  const e = store.get(key);
  return e && e.expires > Date.now() ? e.value : undefined;
}
export function getStale(key) {             // returns even if expired
  const e = store.get(key);
  return e ? e.value : undefined;
}
export function set(key, value, ttlMs) {
  store.set(key, { value, expires: Date.now() + ttlMs });   // never auto-delete on expiry
}
```
- **Stale retention = never delete on expiry; only overwrite on a successful refresh.**
- `cacheKey` derivation (discretion, D-01 area): default to the full URL; for authed
  requests namespace by a stable identity flag (e.g. `authed:true|site:stackoverflow`)
  so anonymous and authed responses don't collide — **never put a token in the key.**
- Memory is unbounded and resets on restart (accepted per §8). Optional soft cap
  (e.g. drop oldest beyond N entries) is a reasonable discretion add.
- Guard `res.json()` in a try/catch: some sources (e.g. blocked Reddit) return HTML on
  error — a JSON-parse failure should fall through to retry/stale, not crash the tool.

## Hacker News source (FOUND-04) — VERIFIED against live API

**Base:** `https://hn.algolia.com/api/v1` — **no auth**, generous rate limit
(~10k req/hr/IP `[ASSUMED]`; confirm in Algolia HN docs). Native full-text search.

**Endpoints (all live-verified 2026-07-01):**
| Tool | Endpoint | Notes |
|------|----------|-------|
| `hn_front_page` | `/search?tags=front_page&hitsPerPage=N` | `query=null` in envelope |
| `hn_search` | `/search?query=<q>&tags=story&hitsPerPage=N` | relevance-ranked |
| (variant) | `/search_by_date?query=<q>&tags=story` | date-ranked; same shape |
| `hn_get_item` | `/items/:id` | returns nested comment tree for detail |

**Search-hit → contract item field map** `[VERIFIED: live Algolia response]`:
| Contract field | Algolia field | Notes |
|----------------|---------------|-------|
| `id` | `objectID` | stringify |
| `type` | derive from `_tags` | see type map below |
| `title` | `title` | `""` for comments (title is null) |
| `author` | `author` | |
| `score` | `points` | **null for `job` stories** (verified) |
| `num_comments` | `num_comments` | **null for `job` stories** (verified) |
| `created_utc` | `created_at` (already ISO-8601) | or `new Date(created_at_i*1000).toISOString()` |
| `url` | `url` | null for Ask/text posts |
| `permalink` | `https://news.ycombinator.com/item?id=${objectID}` | construct |
| `tags` | filter `_tags` | drop internal `author_*`/`story_*`; keep `story`/`front_page`/`ask_hn`/`show_hn` |
| `text` | `story_text` (Ask) / `comment_text` | HTML → `stripHtml()` |

**Type map (`_tags` contains):** `ask_hn`→`ask`, `show_hn`→`show`, `job` (top-level
tag)→`job`, `comment`→`comment`, `poll`/`pollopt`→`story` (no poll enum; fallback),
else `story`. `[VERIFIED: live _tags samples]` for ask/show/job/story/comment.

**Detail (`/items/:id`) shape** `[VERIFIED: live response]`: returns
`{ id, title, author, points, url, text, type, created_at_i, children:[…] }` where
each child is `{ id, author, text, type, created_at_i, children:[…] }` (a full nested
tree). For `buildDetailEnvelope`, flatten the **top-level** `children` to
`comments: [{ id, author, text }]` (strip HTML on `text`); `points`/`title` are null on
comment nodes. Map the root node's `type`/`points`/`url` onto the item.

## Credentials & auth (CRED-01..04)

**`credentials.js` — the ONLY `process.env` reader:**
```javascript
// shared/credentials.js
const ENV_VAR = {                       // logical name -> env var (single source of truth)
  stackExchangeKey:  "STACKEXCHANGE_KEY",
  githubToken:       "GITHUB_TOKEN",
  librariesIoKey:    "LIBRARIESIO_KEY",
  productHuntToken:  "PRODUCTHUNT_TOKEN",
  redditClientId:    "REDDIT_CLIENT_ID",
  redditClientSecret:"REDDIT_CLIENT_SECRET",
  redditUsername:    "REDDIT_USERNAME",
  redditPassword:    "REDDIT_PASSWORD",
  lemmyInstance:     "LEMMY_INSTANCE",
  lemmyUsername:     "LEMMY_USERNAME",
  lemmyPassword:     "LEMMY_PASSWORD",
  userAgent:         "MCP_USER_AGENT",
};
const get = (name) => process.env[ENV_VAR[name]] || undefined;   // only env access in repo
export function requireCred(name) {                              // CRED-04 hard sources
  const v = get(name);
  if (!v) throw new Error(`Missing credential: set ${ENV_VAR[name]}`);
  return v;
}
// Per-service helper fragments (CRED-01) — most consumed in Phase 2/3, defined now:
export const stackExchangeParams = () => { const k = get("stackExchangeKey"); return k ? { key: k } : {}; };
export const githubHeaders       = () => { const t = get("githubToken");      return t ? { Authorization: `Bearer ${t}` } : {}; };
export const librariesIoParams   = () => ({ api_key: requireCred("librariesIoKey") });     // required
export const productHuntHeaders  = () => ({ Authorization: `Bearer ${requireCred("productHuntToken")}` }); // required
export const userAgent = () => get("userAgent") || "medium-research-mcp/1.0 (+https://github.com/…)";
export function redditCreds() {   // returns undefined unless ALL four present → keyless otherwise (D-04)
  const id = get("redditClientId"), secret = get("redditClientSecret"),
        user = get("redditUsername"), pass = get("redditPassword");
  return (id && secret && user && pass) ? { id, secret, user, pass } : undefined;
}
export function lemmyCreds() {
  const instance = get("lemmyInstance"), user = get("lemmyUsername"), pass = get("lemmyPassword");
  return (instance && user && pass) ? { instance, user, pass } : undefined;
}
```

**`auth.js` — one cached-token path, two providers (CRED-02):**
```javascript
// shared/auth.js
import { redditCreds, lemmyCreds, userAgent } from "./credentials.js";
const tokenCache = new Map();  // "reddit:<user>" | "lemmy:<instance>:<user>" -> { token, expires }

async function cachedToken(key, ttlMs, exchange) {   // shared path (D-05)
  const e = tokenCache.get(key);
  if (e && e.expires > Date.now()) return e.token;   // cache stores TOKEN only, never password
  const { token, expiresInMs } = await exchange();
  tokenCache.set(key, { token, expires: Date.now() + (expiresInMs ?? ttlMs) });
  return token;
}

export async function redditToken() {                // null → caller uses keyless .json (D-03/D-04)
  const c = redditCreds();
  if (!c) return null;
  return cachedToken(`reddit:${c.user}`, 55 * 60_000, async () => {
    const basic = Buffer.from(`${c.id}:${c.secret}`).toString("base64");  // built-in
    const body = new URLSearchParams({ grant_type: "password", username: c.user, password: c.pass });
    const res = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`,
                 "Content-Type": "application/x-www-form-urlencoded",
                 "User-Agent": userAgent() },        // Reddit REQUIRES a real UA
      body });
    if (!res.ok) throw new Error(`Reddit auth failed: ${res.status}`);
    const j = await res.json();                       // { access_token, expires_in }
    return { token: j.access_token, expiresInMs: (j.expires_in ?? 3600) * 1000 };
  });
}

export async function lemmyJwt() {
  const c = lemmyCreds();
  if (!c) return null;
  return cachedToken(`lemmy:${c.instance}:${c.user}`, 24 * 3600_000, async () => {
    const res = await fetch(`${c.instance}/api/v3/user/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username_or_email: c.user, password: c.pass }) });
    if (!res.ok) throw new Error(`Lemmy login failed: ${res.status}`);
    const j = await res.json();                       // { jwt }
    return { token: j.jwt };                           // used as Authorization: Bearer <jwt>
  });
}
```
**Security invariants (CRED-02):** password strings live only inside the `exchange()`
closure and the outgoing request body; the cache holds the **token** only; nothing
logs the password. Reddit token TTL ~55 min (token valid 1h `[CITED: reddit oauth wiki]`);
authenticated Reddit calls target `oauth.reddit.com` (Phase 2). 2FA: append `:TOTP` to
the password before the grant.

**Auth facts verified this session:**
- Reddit: POST `https://www.reddit.com/api/v1/access_token`, `client_id:secret` via
  HTTP Basic, body `grant_type=password&username=&password=`, **User-Agent required**,
  token valid 1 hour. `[CITED: reddit-archive OAuth2 wiki]`
- Lemmy 0.19+: JWT passed as `Authorization: Bearer <jwt>` header — the old `auth`
  URL/body param was **removed** in 0.19. Login is POST `/api/v3/user/login`
  → `{ jwt }`. `[CITED: join-lemmy.org / Lemmy 0.19 breaking changes]`
- Reddit keyless reads: GET `https://www.reddit.com/r/<sub>/.json` (or `/hot.json`),
  **User-Agent header required** or Reddit returns 429/403. No token. `[CITED: reddit wiki]`

## .mcpb packaging (documentation only this phase — CRED-03)

Current spec is the `mcpb` manifest (`manifest_version: "0.3"`, formerly "DXT").
`[VERIFIED: anthropics/mcpb MANIFEST spec]`

```json
{
  "manifest_version": "0.3",
  "name": "medium-research-hn",
  "version": "1.0.0",
  "description": "Hacker News research (normalized MCP output)",
  "author": { "name": "Tushar Kanjariya" },
  "user_config": {
    "reddit_client_secret": {
      "type": "string", "title": "Reddit client secret",
      "description": "Optional — enables authenticated Reddit reads",
      "sensitive": true, "required": false
    }
  },
  "server": {
    "type": "node",
    "entry_point": "server/server.js",
    "mcp_config": {
      "command": "node",
      "args": ["${__dirname}/server/server.js"],
      "env": { "REDDIT_CLIENT_SECRET": "${user_config.reddit_client_secret}" }
    }
  }
}
```
- `"sensitive": true` (string types) → host masks input and stores the value in the
  **OS keychain**; injected into `mcp_config.env` via `${user_config.<field>}` at spawn.
- `${__dirname}` resolves the bundle dir (relative imports resolve because the bundle
  preserves layout). Node bundles carry `node_modules`; target needs no runtime.
- **Known gotcha (surface in docs):** `${user_config.*}` env refs are solid in Claude
  Desktop but rough on the Claude Code plugin path (server can silently fail to spawn);
  if a bundled server doesn't appear, check `claude mcp list`. `[CITED: ARCHITECTURE §6]`
- `.env.example` must list every `ENV_VAR` value above with a one-line comment (which
  are required vs keyless-optional).

## Common Pitfalls

### Pitfall 1: Wrapping schemas in `z.object()` for `registerTool`
**What goes wrong:** Tool fails to register / schema errors.
**Why:** 1.29.0 `inputSchema`/`outputSchema` expect a **raw Zod shape** (`{k: z.x()}`).
**How to avoid:** Export raw shapes (`listEnvelopeShape`) and pass those, or pass
`Schema.shape`. `[VERIFIED: SDK 1.29.0 docs/server.md]`
**Warning sign:** Type/registration error mentioning shape vs ZodObject.

### Pitfall 2: Following the SDK `main`-branch README (unreleased v2)
**What goes wrong:** You write `inputSchema: z.object(...)`, `z.object` outputs, and
"Standard Schema (Valibot/ArkType)" wiring that doesn't exist in 1.29.0.
**Why:** The GitHub `main` README documents an in-progress v2 API; npm `latest` is 1.29.0.
**How to avoid:** Pin research/impl to the **v1.29.0 tag** docs (`docs/server.md`), not
`main`. Re-verify with `npm view @modelcontextprotocol/sdk version` before coding.
**Warning sign:** Docs mention "Standard Schema" or `z.object` in `registerTool`.

### Pitfall 3: `structuredContent` fails SDK output validation on `null`
**What goes wrong:** SDK rejects a return where e.g. `score` is `null` but schema isn't nullable.
**Why:** SDK validates `structuredContent` against `outputSchema` every call.
**How to avoid:** `score`/`num_comments`/`url`/`text`/etc. are `.nullable()`;
`normalizeItem()` defaults absent fields to `null` and coerces `id` to string.
**Warning sign:** Runtime validation error naming a contract field.

### Pitfall 4: `fetch` hangs — no default timeout
**What goes wrong:** A stalled source hangs the tool call indefinitely.
**Why:** Native `fetch` has no timeout.
**How to avoid:** `AbortController` + `setTimeout(() => ctl.abort(), timeoutMs)` in
`getJson()`; treat `AbortError` as retryable, then stale-fallback.

### Pitfall 5: ESM import ergonomics (and Windows dev)
**What goes wrong:** `ERR_MODULE_NOT_FOUND`; `__dirname is not defined`.
**Why:** `type: module` requires **explicit `.js` extensions** on relative imports;
`__dirname`/`require` don't exist in ESM.
**How to avoid:** Always `import … from "../../shared/contract.js"`; use
`fileURLToPath(import.meta.url)` if a dir is needed. Import specifiers use forward
slashes on Windows too. `build-mcpb.sh` is bash → needs Git Bash/WSL on Windows (present
on this machine: bash 5.3).

### Pitfall 6: Non-JSON error bodies crash `getJson`
**What goes wrong:** `res.json()` throws on an HTML error/block page (e.g. Reddit).
**Why:** Error responses aren't always JSON.
**How to avoid:** Wrap `res.json()`; on parse failure, treat as a failed attempt
(retry/stale), not an uncaught throw.

### Pitfall 7: Cache key leaking auth state
**What goes wrong:** An authed response is served to an anonymous caller (or vice versa).
**Why:** `cacheKey` defaulted to bare URL across auth modes.
**How to avoid:** Namespace the key by logical identity (authed flag / site / instance);
**never** include the token itself in the key.

## Validation Architecture

> `workflow.nyquist_validation` is `false`, so full Nyquist mapping is out of scope.
> Included as a lightweight guide because D-06 mandates tests and the `normalize*`
> helpers are the load-bearing correctness surface.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` + `node:assert` (built-in) `[VERIFIED: node docs]` |
| Config file | none — add `"test": "node --test"` to root `package.json` |
| Quick run | `node --test test/contract.test.js` |
| Full suite | `node --test` (discovers `*.test.js` / `test/`) |

### What to test (highest value first)
| Behavior | Type | Command |
|----------|------|---------|
| `normalizeItem` defaults absent fields to `null`; never drops `score`/`num_comments` | unit | `node --test test/contract.test.js` |
| `stripHtml` removes tags + decodes entities on captured HN `text` | unit | `node --test test/contract.test.js` |
| `mapHnHit` maps a captured Algolia payload → exact contract shape (incl. `job` → null score) | unit | `node --test test/hn.test.js` |
| `buildListEnvelope`/`buildDetailEnvelope` output `.parse()` cleanly against Zod schema | unit | `node --test test/contract.test.js` |
| `getJson` retries 5xx, does NOT retry 4xx, serves stale on total failure (mock `fetch`) | unit | `node --test test/http_client.test.js` |
| HN tools register (smoke — construct `McpServer`, assert tool list) | smoke | `node --test test/hn.test.js` |

**Fixtures:** capture one real Algolia payload per tag type (story/ask/show/job/comment
tree) into `test/fixtures/` so tests run offline and pin the field map.

## Security Domain

> `security_enforcement: true`, ASVS L1. Focus: credential handling (the phase's main
> attack surface). Data fetching is read-only against public APIs.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Reddit password grant / Lemmy login in `auth.js`; token cached, never re-sent password |
| V3 Session Management | partial | In-memory cached tokens; reset on restart; TTL-bounded |
| V5 Input Validation | yes | Zod `inputSchema` on every tool; `encodeURIComponent` on query params |
| V6 Cryptography | minimal | Only base64 for Basic auth (encoding, not crypto) — no hand-rolled crypto |
| V7 Error/Logging | yes | Passwords never logged; errors name only the env var, never the value |
| V8 Data Protection | yes | Secrets read only via `credentials.js`; `.mcpb` `sensitive:true` → OS keychain; never on disk in plaintext (`.env` is dev-only, gitignored) |
| V14 Configuration | yes | Single `ENV_VAR` map; required vs optional creds explicit; `.env.example` documents all |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Credential in code / logs / cache key | Information Disclosure | `credentials.js` sole reader; token-only cache; UA/logs never include secrets |
| Secret persisted plaintext in `.mcpb` | Information Disclosure | `"sensitive": true` → OS keychain; `${user_config.*}` injected at spawn |
| Query/param injection into source URLs | Tampering | `encodeURIComponent` / `URLSearchParams`; Zod-validated inputs |
| Unvalidated tool output reaching the skill | Tampering | SDK validates `structuredContent` against `outputSchema` every call |
| DoS via hung upstream | Denial of Service | `AbortController` timeout + bounded retries + stale fallback |
| `.env` committed to git | Information Disclosure | `.gitignore` `.env`; only `.env.example` (no values) is committed |

**Action for the planner:** add a task ensuring `.gitignore` excludes `.env` and that
no default/sample secret value ships in `.env.example` (names + comments only).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `server.tool(name, schema, handler)` | `server.registerTool(name, {title,description,inputSchema,outputSchema}, handler)` | SDK ≥ ~1.10 | Use `registerTool`; `tool()`/`setRequestHandler` deprecated for this use |
| Text-only tool results | `structuredContent` + `outputSchema` (SDK validates) | SDK ~2025 | Enables the typed contract; requires nullable schemas |
| "SDK needs Zod 3 only" | Zod `^3.25 \|\| ^4.0` both supported | SDK ≥1.25/1.29 | Zod 4 recommended; old "must be Zod 3" guidance is stale |
| Lemmy `auth` URL/body param | `Authorization: Bearer <jwt>` header | Lemmy 0.19 | `auth.js` returns jwt for header use (Phase 2 servers) |
| DXT bundles | `.mcpb` (`manifest_version` 0.3, `mcpb` CLI) | 2025 rename | Use `mcpb pack`; `user_config` + `sensitive` keychain unchanged |

**Deprecated/outdated:**
- SDK `main`-branch README (v2 preview) — do not use for 1.29.0 work.
- `docs/ARCHITECTURE.md` §3 says "Zod inputSchema/outputSchema" without noting the
  **raw-shape** requirement — accurate in spirit, incomplete in detail (see Pitfall 1).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Zod `^4.4` has no `zod-to-json-schema` quirk with SDK 1.29 | Standard Stack | Low — fallback `zod@^3.25` (both in peerDep); verify at `npm install` + tool register |
| A2 | Algolia HN rate limit ~10k req/hr/IP | HN source | Low — cache + backoff absorb it; confirm in Algolia HN docs if throttled |
| A3 | Retry 429/408 default = NO (literal §8 "never retry 4xx") | HTTP client | Low — surfaced as an explicit discretion decision for the planner/user |
| A4 | Reddit token TTL ~1h (cache at 55m) | Auth | Low — re-auth on 401; TTL is a cache hint only |
| A5 | Default `MCP_USER_AGENT` fallback string is acceptable to Reddit | Credentials | Low — Reddit only requires a non-blank, unique-ish UA |

**If a claim above is load-bearing for a locked decision, confirm before executing.**

## Open Questions

1. **Retry on 429/408?**
   - Known: §8 says "never retry 4xx"; 429/408 are 4xx but are the sensible exceptions.
   - Unclear: whether the user wants strict §8 or a `Retry-After`-aware refinement.
   - Recommendation: default strict (no 429 retry); planner adds a one-line note so it's
     a conscious choice, not silent.
2. **Bundled Node version in the target Claude Desktop.**
   - Known: dev machine is Node 25; global `fetch`/`AbortController` present. SDK/`fetch`
     need Node ≥18.
   - Unclear: exact Node the target Claude Desktop ships.
   - Recommendation: target the Node 18 API baseline (no Node ≥20-only APIs); document
     `engines: { node: ">=18" }` in `package.json`.
3. **`tags` curation for HN.**
   - Known: `_tags` includes internal `author_*`/`story_*` noise.
   - Recommendation (discretion): filter to human-meaningful tags
     (`story`/`front_page`/`ask_hn`/`show_hn`), or `[]` — planner's call per D-01.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js (≥18 for global `fetch`) | Everything | ✓ | v25.9.0 (dev) | — |
| npm | Install sdk + zod | ✓ | 11.12.1 | — |
| global `fetch` + `AbortController` | `getJson()`, `auth.js` | ✓ | present (Node 25) | — |
| Git Bash / WSL | `build-mcpb.sh` (later phase) | ✓ | bash 5.3 | run bundling on any POSIX shell |
| `@anthropic-ai/mcpb` (`mcpb` CLI) | `.mcpb` pack (later phase, not now) | ✗ (not installed) | — | `npm i -g @anthropic-ai/mcpb` when packaging |
| Internet → `hn.algolia.com` | HN server runtime | ✓ | — | cache/stale fallback |

**Missing dependencies with no fallback:** none for Phase 1.
**Missing dependencies with fallback:** `mcpb` CLI — only needed for actual `.mcpb`
packing, which is a later phase; Phase 1 only documents `manifest.json`.

## Sources

### Primary (HIGH confidence)
- `@modelcontextprotocol/sdk` **v1.29.0** `docs/server.md` (git tag) — verbatim
  `registerTool` w/ `outputSchema`, raw-shape schemas, handler returning
  `content` + `structuredContent`, `McpServer`/`StdioServerTransport` imports.
- npm registry — `@modelcontextprotocol/sdk@1.29.0`, `zod@4.4.3`, SDK peerDep
  `zod: ^3.25 || ^4.0`, no `postinstall`.
- Live Algolia HN API (`/search`, `/search?tags=front_page`, `/search?tags=ask_hn|job`,
  `/items/:id`) — field shapes, `_tags` values, `job` null score/comments.
- `anthropics/mcpb` MANIFEST spec — `user_config` types, `sensitive` keychain,
  `${user_config.*}` env injection.

### Secondary (MEDIUM confidence)
- reddit-archive OAuth2 wiki (`/api/v1/access_token`, Basic auth, password grant, UA, 1h token).
- join-lemmy.org / Lemmy 0.19 breaking-changes threads (`Authorization: Bearer` jwt).

### Tertiary (LOW confidence)
- Algolia HN per-IP rate-limit figure (~10k/hr) — treat as approximate.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions/peerDeps verified on npm; API verified at v1.29.0 tag.
- Architecture / contract module: HIGH — raw-shape + dual-return verified against SDK docs.
- HN source: HIGH — endpoints + field map verified against live responses.
- Credentials/auth: MEDIUM-HIGH — patterns per ARCHITECTURE §6; endpoints cited to source docs.
- `.mcpb`: HIGH — manifest schema verified against the mcpb spec.

**Research date:** 2026-07-01
**Valid until:** ~2026-07-31 (SDK moves fast; re-verify `npm view @modelcontextprotocol/sdk version` and the v2 status before executing).
