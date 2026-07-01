# Architecture — medium-research-mcp

Companion to PRD.md. Captures the technical decisions so each GSD phase builds
consistently.

## 1. Stack decision

**Research servers → Node. YouTube→blog wrapper → Python.**

- Node for the research servers because Claude Desktop ships a Node runtime, so a
  Node `.mcpb` needs **no external runtime** on the target machine (a Python
  bundle requires Python on PATH). Node 18+ also has global `fetch`, so the HTTP
  layer has no dependency. It also matches the reference implementation
  (reddit-mcp-buddy).
- Python only for the YouTube→blog wrapper, because it wraps an existing
  Tesseract OCR script; rewriting OCR in Node would be pointless, and that server
  is local-only (not distributed), so the bundling advantage doesn't apply.

This trades away "one stack everywhere," but the cost is low: each server is an
independent process with a tiny shared surface (cache, http, credentials, auth),
and the YouTube server was always going to be structurally different (async job
pattern). The **output contract** (§4) — not the language — is what keeps the
suite uniform.

## 2. Repo layout

```
medium-research-mcp/                 # Node — the research servers
  servers/
    hn/
      server.js                      # tool definitions + source mapping
      manifest.json                  # .mcpb manifest (node)
      build-mcpb.sh                  # stage + bundle + pack
    <source>/ ...                    # one folder per source, same shape
  shared/
    cache.js                         # in-memory ~15 min TTL cache, stale fallback
    http_client.js                   # fetch + retry/backoff + cache + stale fallback
    credentials.js                   # env-only credential access (single source of truth)
    auth.js                          # username/password -> token exchange (Reddit, Lemmy)
  docs/                              # PRD, ARCHITECTURE, ROADMAP, server-spec-template
  .env.example
  package.json                       # type: module; deps: @modelcontextprotocol/sdk, zod
  CLAUDE.md

youtube-blog-mcp/                    # Python — separate, local-only
  server.py                          # async job pattern (start_job / check_status)
```

## 3. MCP layer

- **Node:** `@modelcontextprotocol/sdk` (`^1.29`), `McpServer` + `registerTool`
  with Zod `inputSchema`/`outputSchema`, returning both a JSON-text `content`
  block and `structuredContent`. stdio transport via `StdioServerTransport`. The
  deprecated `server.tool()` / `setRequestHandler` styles are not used.
- **Python (YouTube only):** the `mcp` package, `FastMCP`, stdio.

## 4. Output contract (the linchpin)

Every list tool returns:

```jsonc
{
  "source": "hackernews",      // stable source id
  "query": "vector database",  // or null (e.g. front page)
  "count": 12,
  "results": [ /* items */ ]
}
```

Every item:

```jsonc
{
  "id": "40123",
  "type": "story",             // story | ask | show | question | article | repo | comment | post
  "title": "…",
  "author": "…",
  "score": 342,                // NORMALIZED engagement (see §5)
  "num_comments": 88,          // or null
  "created_utc": "2026-06-15T09:12:00Z",
  "url": "https://…",          // external link, or null
  "permalink": "https://…",    // canonical discussion/page
  "tags": ["…"],
  "text": "…"                  // body/excerpt, or null
}
```

Detail tools return `{ "source", "item": { …item, "comments": [ { id, author, text } ] } }`.

**Rule:** every server conforms to this exactly. `score` and `num_comments` may be
null but must never be renamed. This is what lets `medium-blog-pro` rank, filter,
and cite across sources with no per-source code.

## 5. Per-source matrix

| Source | `score` means | `num_comments` means | API | Auth |
|---|---|---|---|---|
| Hacker News | points | comments | Algolia HN Search | none |
| Stack Exchange (all sites) | votes | answers | Stack Exchange API (`site=`) | optional key |
| Lobsters | upvotes | comments | `*.json` page endpoints | none |
| Lemmy | score | comments | `/api/v3` REST | optional (login) |
| Hashnode | reactions | responses | public GraphQL | none |
| Dev.to | reactions | comments | dev.to API | none |
| GitHub repos | stars | (n/a) | GitHub Search API | optional PAT |
| GitHub issues/discussions | reactions | comments | GitHub API | optional PAT |
| Libraries.io | dependents/rank | (n/a) | Libraries.io API | required key |
| Product Hunt | votes | comments | GraphQL v2 | required token |
| RSS/Atom | null | null | feed URLs | none |

## 6. Credentials & auth

- **Source of truth:** `shared/credentials.js` maps logical names → env var names
  (`ENV_VAR`) and reads values from `process.env` only. Per-service helpers
  (`stackExchangeParams()`, `githubHeaders()`, `librariesIoParams()`,
  `productHuntHeaders()`) return request fragments; servers never touch env.
- **Username/password:** `shared/auth.js` exchanges credentials for a token once
  and caches it — Reddit OAuth2 password grant (needs id+secret+username+password;
  authenticated calls go to `oauth.reddit.com`; 2FA appends `:TOTP` to the
  password) and Lemmy `/api/v3/user/login` (username+password only). Passwords are
  never logged, persisted, or sent per request.
- **`.mcpb` bundles:** declare a `user_config` field per credential, mapped into
  `mcp_config.env` as `${user_config.<field>}`; mark every secret
  `"sensitive": true` so Claude Desktop stores it in the OS keychain.
- **Known gotcha:** `${user_config.*}` env refs are solid in Claude Desktop but
  newer/rough in the Claude Code plugin path (can silently fail to spawn) — if a
  bundled server doesn't appear, check `claude mcp list`.
- **Hygiene:** use a dedicated scripting account, not a primary one; prefer
  app-passwords/PATs over raw passwords where the platform offers them.

## 7. Packaging

- **Dev / folder mode:** register via `claude_desktop_config.json` (or
  `claude mcp add`), with secrets in the `env` block. Editable in place. Use this
  while building.
- **`.mcpb` bundle:** `npm i -g @anthropic-ai/mcpb`, then per-server
  `build-mcpb.sh` stages the dir (preserving layout so relative imports resolve),
  runs `npm install --omit=dev` into the bundle, and `mcpb pack`. Node bundles
  carry `node_modules`; the target needs no runtime. Use `mcpb init` to
  (re)generate a canonical manifest.

## 8. Resilience

- Cache GET responses ~15 min (in-memory; resets on server restart — accepted).
- Retry transient/5xx with exponential backoff (0.5s, 1s, 2s); never retry 4xx.
- On total failure, serve a stale cache entry rather than erroring the tool call.
- Missing **required** credential → a clear, actionable error naming the env var.
