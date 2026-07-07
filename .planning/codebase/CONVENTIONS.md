# Coding Conventions

**Analysis Date:** 2026-07-07

## Naming Patterns

**Files:**
- All lowercase. Shared modules use snake_case where multiword: `shared/http_client.js`. Single-word otherwise: `shared/cache.js`, `shared/contract.js`, `shared/credentials.js`, `shared/auth.js`, `shared/rank.js`.
- Every source server is `servers/<source>/server.js` with a sibling `manifest.json` (e.g. `servers/hn/server.js`, `servers/producthunt/server.js`). Directory name is the short lowercase source name (`hn`, `devto`, `stackexchange`, `librariesio`).
- Tests are `test/<module-or-source>.test.js` — one test file per server or shared module (e.g. `test/hn.test.js`, `test/http_client.test.js`).
- Fixtures are `test/fixtures/<source>-<kind>.<ext>` (e.g. `hn-story.json`, `rss-atom.xml`).

**Functions:**
- camelCase throughout. Source-specific field mappers follow `map<Source><Entity>()` and are **exported for testing**: `mapHnHit`, `mapHnItem` (`servers/hn/server.js`), `mapSeQuestion` (`servers/stackexchange/server.js`), `mapPhPost` (`servers/producthunt/server.js`), `mapGhRepo`, `mapDevtoArticle`, `mapLobstersStory`.
- Shared envelope factories: `buildListEnvelope`, `buildDetailEnvelope`, `normalizeItem`, `toolResult`, `stripHtml` (`shared/contract.js`).
- Credential helpers are named by service + shape they return: `githubHeaders()`, `stackExchangeParams()`, `productHuntHeaders()`, `redditCreds()`, `rssAllowedHosts()` (`shared/credentials.js`).
- Small private helpers get short source-prefixed names: `hnHitType`, `hnDetailType`, `phAuthor`, `toIso`.

**Variables:**
- Module-level constants: UPPER_SNAKE_CASE — `ALGOLIA`, `SOURCE`, `BACKOFF_MS`, `RETRYABLE_5XX`, `DEFAULT_TTL_MS`, `MAX_REDIRECTS`, `MEANINGFUL_TAGS`, `PH_GRAPHQL`.
- Locals and parameters: camelCase. Contract JSON fields are snake_case by design (`num_comments`, `created_utc`) and must never be renamed.
- Time constants use numeric-separator style: `10_000`, `15 * 60 * 1000` with an inline comment.

**Types:**
- No TypeScript. Types are documented via JSDoc `@param`/`@returns` annotations on exported functions (see `shared/http_client.js`, `shared/credentials.js`). Zod schemas serve as runtime types: `ItemSchema`, `ListEnvelopeSchema`, `DetailEnvelopeSchema` in `shared/contract.js`, plus raw-shape variants (`itemShape`, `listEnvelopeShape`, `detailEnvelopeShape`) passed to `registerTool` (SDK 1.29.0 requires raw shapes, not `z.object(...)`).

## Code Style

**Formatting:**
- No Prettier/ESLint/Biome config exists — style is maintained by convention. Match the existing style exactly:
  - Double quotes for strings; template literals for interpolation.
  - Semicolons always; trailing commas in multiline literals and argument lists.
  - 2-space indentation; ~80-column soft wrap.
  - Arrow functions for one-liner helpers (`const permalink = (id) => \`...\``); `function` declarations for anything with a body or that is exported and documented.
- Heavy, deliberate commenting: every file opens with a banner comment explaining its role and citing requirement/decision IDs (e.g. `FOUND-02`, `D-01`, `OUT-01`, `CRED-04`, ARCHITECTURE §-references). Section dividers use `// --- section name ----------` rules. Preserve this style when editing.

**Linting:**
- Not detected. `package.json` has only `"test": "node --test"`.

## Import Organization

**Order (as practiced in every server, e.g. `servers/hn/server.js`):**
1. MCP SDK imports (`@modelcontextprotocol/sdk/server/mcp.js`, `.../stdio.js`)
2. Node built-ins with the `node:` prefix (`node:url`, `node:crypto`, `node:net`, `node:dns/promises`)
3. Third-party (`zod`)
4. Shared modules via relative paths (`../../shared/http_client.js`, `../../shared/contract.js`, `../../shared/credentials.js`)

**Path Aliases:**
- None. Pure ESM (`"type": "module"`) with explicit relative paths including the `.js` extension. Node built-ins always use the `node:` prefix.

## Error Handling

**Patterns:**
- **Never hard-error a tool call when a fallback exists.** HTTP resilience lives entirely in `shared/http_client.js` (`getJson`/`postJson`/`getText`): in-TTL cache hit first; retry only transient failures (network `TypeError`, `AbortError` timeout, non-JSON body, 5xx {500,502,503,504}) with backoff `[500, 1000, 2000]`ms; strict no-4xx-retry (including 429/408); on exhausted retries serve a stale cache entry; otherwise throw.
- **Internal error taxonomy:** a private `class RetryableError extends Error {}` marks retryable attempts inside `shared/http_client.js`; everything else breaks the loop immediately.
- **Secret-safe errors:** all thrown HTTP errors pass the URL through `redactUrl()` (origin + path only) so query-string credentials never leak into MCP tool results. Credential errors name only the ENV_VAR: `throw new Error(\`Missing credential: set ${ENV_VAR[name]}\`)` in `shared/credentials.js` `requireCred()`.
- **Required vs optional credentials:** required (Libraries.io, Product Hunt) throw a clear "set X" error via `requireCred()`; optional (Stack Exchange, GitHub, Reddit, Lemmy) return `{}`/`undefined` and degrade to keyless mode.
- **Fail closed on security checks:** an `assertSafeUrl` SSRF rejection is a plain `Error` — never retried, never served from stale.
- **API-specific soft-error guards:** GraphQL 200-with-errors is caught by an explicit post-fetch check (`requirePhOk(raw)` in `servers/producthunt/server.js`) before reading `raw.data?.posts?.edges ?? []` — never let a silent empty list masquerade as "no results".
- Prefer `??` over `||` when defaulting so a legitimate `0` survives (`score: node.votesCount ?? null`); `||` is used deliberately when blank strings should also fall through (`url: node.website || null`).

## Logging

**Framework:** None. Servers are stdio MCP transports — **do not write to stdout**; no `console.log` calls exist in `shared/` or `servers/`. Errors surface exclusively through thrown Errors returned as tool-call failures.

**Patterns:**
- Never log or echo a credential value; error text names only env-var names and redacted URLs.

## Comments

**When to Comment:**
- File-top banner explaining the module's role, the design decisions it implements (with IDs like `D-02`, `FOUND-05`, `WR-04`), and any accepted residual risks (see the TOCTOU/DNS-rebinding note in `shared/http_client.js`).
- Inline comments explain **why**, cite verified upstream behavior ("null for job stories (verified)"), and flag invariants in CAPS ("NEVER rename/drop", "APPEND-ONLY" on the `TYPE` enum in `shared/contract.js`).

**JSDoc/TSDoc:**
- Full JSDoc (`@param`, `@returns`, option-object fields) on every exported function in `shared/` and on exported `map*` helpers in servers. Private one-liner helpers get a plain `//` comment instead.

## Function Design

**Size:** Small and single-purpose. Field mappers are pure functions with no I/O; tool handlers are ~10-line async closures that fetch → map → build envelope → `toolResult()`.

**Parameters:**
- Options objects with destructured defaults for anything beyond 1–2 args: `getJson(url, opts = {})` destructures `{ headers = {}, ttlMs = DEFAULT_TTL_MS, timeoutMs = DEFAULT_TIMEOUT_MS, cacheKey = url, fetchImpl = fetch, sleep = realSleep }`.
- **Injectable dependencies for testability**: `fetchImpl`, `sleep`, and `lookup` (DNS) are always parameters with real defaults — this is the project's seam for offline unit tests. Follow it for any new I/O code.
- Tool handlers destructure validated input with defaults: `async ({ query, limit = 20 }) => ...`.

**Return Values:**
- Mappers return plain objects shaped for `normalizeItem()` (pre-normalize); missing fields become `null` (tags `[]`), ids are `String(...)`-coerced.
- Every tool handler returns `toolResult(envelope)` from `shared/contract.js` so `content` (JSON text) and `structuredContent` never drift.

## Module Design

**Exports:**
- Named exports only; no default exports anywhere.
- Servers export their `map*` helpers and the `server` instance for tests, and guard the transport connect so importing never starts stdio:
  ```js
  if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await server.connect(new StdioServerTransport());
  }
  ```
  (`servers/hn/server.js:195-200` — every server ends with this guard.)

**Barrel Files:**
- None. Import directly from the specific shared module.

**Hard module boundaries (enforced conventions):**
- `process.env` is read **only** inside `shared/credentials.js` (`const get = (name) => process.env[ENV_VAR[name]] || undefined` — grep-verifiable invariant).
- `fetch` is called **only** inside `shared/http_client.js`; servers use `getJson`/`postJson`/`getText`.
- Envelope/normalization logic lives **only** in `shared/contract.js`; servers do pure field mapping.
- Outbound hosts are fixed module constants (`ALGOLIA`, `PH_GRAPHQL`) — never derived from tool input (SSRF invariant); the sole exception, `rss_fetch(url)`, is validated by `assertSafeUrl` in `shared/http_client.js`.
- Cache keys are logical and secret-free; secrets ride only in headers.

---

*Convention analysis: 2026-07-07*
