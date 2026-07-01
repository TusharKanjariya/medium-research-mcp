# Phase 1: Foundation & Credential Infrastructure - Context

**Gathered:** 2026-07-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver the shared plumbing every later source server copies: the TTL cache, the
`getJson()` HTTP client (retry/backoff + stale fallback), and a **shared
output-contract module**; the Hacker News reference server that proves the
contract end-to-end; and the credential + token-auth infrastructure
(`credentials.js`, `auth.js`, `.env.example`, `.mcpb` `user_config` pattern).

This phase clarifies HOW to build the foundation. Adding the other source
servers (Stack Exchange, Lobsters, etc.) is Phase 2+; a dedicated Reddit reader
server is deferred (see Deferred Ideas).
</domain>

<decisions>
## Implementation Decisions

### Output-contract enforcement
- **D-01:** The normalized contract is enforced by a **shared module**, not
  per-server convention. It exports the Zod schemas for the item and the
  list/detail envelopes AND factory helpers — `normalizeItem(partial)` and
  `buildListEnvelope({ source, query, results })` / `buildDetailEnvelope({ source, item })`.
  Every server imports these; the same Zod schema is reused as each tool's
  `registerTool` `outputSchema`. Rationale: uniform output is the core value —
  the contract must be structurally impossible to drift as 10+ servers are added,
  and adding a source should reduce to pure field-mapping into `normalizeItem()`.
- **D-02:** `normalizeItem()` fills every contract field, defaulting absent
  fields to `null` (never dropping/renaming `score` or `num_comments`), and
  strips HTML from `text` (OUT-03). HTML-stripping lives in the shared module so
  it is applied identically everywhere.

### Reddit / auth path
- **D-03:** Reddit reads are **keyless by default** — public subreddit content
  via `www.reddit.com/r/<sub>/.json` requires no login and no app registration
  (this sidesteps the karma/join gate that motivated the whole project).
- **D-04:** `auth.js` ALSO supports an **optional** Reddit OAuth2 password grant
  for restricted content / higher rate limits, activated only when the user
  supplies BOTH a username/password AND a registered script app's
  `client_id`/`client_secret`. When those are absent, Reddit silently degrades to
  keyless reads. **Important caveat (surface to the user in docs):** the password
  grant still needs a karma-gated script app — username/password alone is not
  sufficient for Reddit's API. 2FA appends `:TOTP` to the password; authenticated
  calls go to `oauth.reddit.com`.
- **D-05:** `auth.js` keeps the **Lemmy** username/password login
  (`/api/v3/user/login`, username+password only, no app needed). Both Reddit and
  Lemmy exchange credentials once for a **cached token**; passwords are never
  logged, persisted, or sent per request. The token-exchange abstraction is
  written so both providers share one code path.

### Test harness
- **D-06:** Unit tests use Node's built-in **`node:test` + `node:assert`**
  (run via `node --test`), zero external dependencies. This is the test pattern
  for `normalize*()` helpers now and for every later server. Rationale: matches
  the no-external-runtime ethos of the suite; no vitest/jest.

### Package structure
- **D-07:** **Single root `package.json`** (`type: module`; deps
  `@modelcontextprotocol/sdk`, `zod`). Servers live in `servers/<source>/` and
  import shared modules via relative paths (`../../shared/...`). Per-server
  `package.json` / npm workspaces are NOT used now. Rationale: matches
  ARCHITECTURE §2; simplest for development. Per-server `.mcpb` bundling (v2 /
  PKG-01) is handled later by `build-mcpb.sh` staging the server dir + running
  `npm install --omit=dev` into the bundle, so independent packaging does not
  require workspaces upfront.

### Claude's Discretion
- Exact internal file/function names within `shared/` (beyond the public
  `getJson`, `normalizeItem`, `buildListEnvelope`, `buildDetailEnvelope`,
  `credentials.js` per-service helpers), retry jitter, and cache key derivation
  are the planner's/executor's call, provided ARCHITECTURE §4/§6/§8 hold.
- HN `type` mapping (story / ask / show / job → the contract `type` enum) is left
  to implementation, following ARCHITECTURE §4's enum.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Output contract (linchpin — D-01/D-02)
- `docs/ARCHITECTURE.md` §4 — exact list/detail envelopes and the item schema
  (`id, type, title, author, score, num_comments, created_utc, url, permalink, tags, text`);
  `score`/`num_comments` may be null but never renamed.
- `docs/ARCHITECTURE.md` §5 — per-source `score`/`num_comments` meaning (for HN:
  points / comments; Algolia HN Search API, no auth).

### Resilience & MCP layer
- `docs/ARCHITECTURE.md` §3 — `McpServer` + `registerTool` with Zod
  input/output schemas, stdio transport; return both `structuredContent` and
  JSON-text `content`. Deprecated `server.tool()`/`setRequestHandler` not used.
- `docs/ARCHITECTURE.md` §8 — cache ~15 min, retry backoff 0.5s/1s/2s, never
  retry 4xx, stale-cache fallback on total failure.

### Credentials & auth (D-03/D-04/D-05)
- `docs/ARCHITECTURE.md` §6 — `credentials.js` as single source of truth for env
  var names, per-service helpers, `.mcpb` `user_config` with `"sensitive": true`
  (keychain); Reddit password grant + Lemmy login details and the
  `${user_config.*}` Claude Code gotcha.
- `docs/PRD.md` §6, §9 — functional requirements 3/4/6 and the constraint that
  the Reddit grant still needs a karma-gated script app.

### Project / process
- `CLAUDE.md` — the "DO NOT BREAK" output contract, "how to add a new server"
  steps, and the "don't reinvent shared modules / never read process.env in a
  server" rules.
- `docs/server-spec-template.md` — the per-server spec + acceptance checklist the
  HN server should satisfy.
- `.planning/REQUIREMENTS.md` — FOUND-01..05, CRED-01..04, OUT-01, OUT-03
  (the Phase 1 requirement set).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None yet — this is a greenfield foundation. No `servers/`, `shared/`, or
  `package.json` exists. Everything in this phase is net-new and becomes the
  template every later phase copies.

### Established Patterns
- The design docs (`docs/ARCHITECTURE.md`, `CLAUDE.md`) are the de-facto
  patterns: shared `cache.js`/`http_client.js`/`credentials.js`/`auth.js`,
  one folder per source under `servers/`, native `fetch`, stdio MCP.

### Integration Points
- Downstream consumer is the `medium-blog-pro` skill (separate), which reads the
  contract JSON. Phase 1 must make the HN server's output consumable by it with
  zero source-specific logic.

</code_context>

<specifics>
## Specific Ideas

- The shared output-contract module is the make-or-break asset: the user
  explicitly wants adding a source to be "pure field-mapping." Build it as a
  reusable factory, not copy-paste boilerplate.
- Reddit: user wants a login *option* to access subreddits; implemented as
  keyless-first with optional password-grant (see D-03/D-04). Documentation must
  be honest that Reddit auth needs a script app, unlike Lemmy.

</specifics>

<deferred>
## Deferred Ideas

- **Dedicated Reddit reader server** (keyless subreddit `.json`, optional
  authenticated reads) — the `auth.js` Reddit grant lands in Phase 1, but a
  full Reddit *source server* with tools is a later-phase addition. Currently
  read-only subreddit coverage is planned via the RSS fetcher's `.rss` recipe
  (Phase 4); a richer `.json`-based Reddit server could be added as a new SRC
  requirement if the keyless reads prove valuable. Note for roadmap backlog.
- **Per-server `package.json` / npm workspaces** — reconsider if/when `.mcpb`
  distribution (PKG-01, v2) makes independent per-server installs worth the
  boilerplate.
- **vitest/framework tests** — only if `node:test` proves limiting.

</deferred>

---

*Phase: 1-Foundation & Credential Infrastructure*
*Context gathered: 2026-07-01*
