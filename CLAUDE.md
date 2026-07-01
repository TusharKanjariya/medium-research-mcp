# CLAUDE.md

Project context for Claude Code. Read this before working in the repo.
Full detail lives in `docs/PRD.md` and `docs/ARCHITECTURE.md`.

## What this is

A suite of MCP servers that pull blog-topic research from multiple developer
sources (Hacker News, Stack Exchange, Lobsters, Lemmy, Hashnode, Dev.to, GitHub,
Libraries.io, Product Hunt, RSS, …). Each server wraps one source's public API
and is called from Claude Desktop. The output feeds a separate skill,
`medium-blog-pro`, so **uniform output across sources is the whole point**.

## Stack

- Research servers: **Node** (`type: module`), `@modelcontextprotocol/sdk` +
  `zod`, stdio transport, native `fetch`.
- YouTube→blog wrapper only: Python (separate repo, async job pattern).

## The output contract — DO NOT BREAK

Every list tool returns `{ source, query, count, results: [item] }`; every detail
tool returns `{ source, item: { …item, comments: [...] } }`. Item shape:

```
id, type, title, author, score, num_comments, created_utc, url, permalink, tags, text
```

`score` is normalized engagement (points / votes / stars / reactions, by source);
`num_comments` is comments/answers. Either may be `null` but **must never be
renamed or dropped**. Return a `dict`/object so the SDK emits both
`structuredContent` and JSON-text `content`.

## How to add a new server

1. Copy `servers/hn/` to `servers/<source>/`.
2. Swap the API endpoints; write `normalize*()` helpers that map the source's
   fields onto the item schema above.
3. Register tools with `server.registerTool(name, { title, description,
   inputSchema, outputSchema }, handler)`. Return
   `{ content: [{ type:"text", text: JSON.stringify(envelope) }], structuredContent: envelope }`.
4. Fetch through `shared/http_client.js` `getJson()` — never call `fetch`
   directly (you'd lose caching, retries, and stale fallback).
5. If the source needs auth, use `shared/credentials.js` helpers (token/key) or
   `shared/auth.js` (username/password). **Never read `process.env` in a server;
   never hardcode a secret.**
6. Add `manifest.json` (+ `user_config` with `"sensitive": true` for any
   credential) and `build-mcpb.sh`, mirroring `servers/hn/`.
7. Unit-test the `normalize*()` helpers and confirm tools register.

## Use the shared modules — don't reinvent

- `shared/cache.js` — TTL cache. Don't add another cache.
- `shared/http_client.js` — all HTTP. Handles cache + retry + stale fallback.
- `shared/credentials.js` — all credential reads; `ENV_VAR` is the single source
  of truth for variable names.
- `shared/auth.js` — Reddit/Lemmy token exchange; tokens are cached, passwords
  used only in-memory.

## Conventions

- Tool output is trimmed and LLM-readable — only fields that matter, HTML
  stripped from text.
- Never hard-error a tool call when a stale cache entry or keyless fallback
  exists. Missing **required** credentials → a clear "set `X`" error.
- Optional creds (Stack Exchange key, GitHub PAT, Reddit) degrade to
  keyless/anonymous mode; required creds (Libraries.io, Product Hunt) do not.

## Commands

```bash
npm install
npm run inspect:hn                       # MCP Inspector against a server
node -e "..."                            # quick helper unit tests
cd servers/<name> && ./build-mcpb.sh     # build a .mcpb (needs: npm i -g @anthropic-ai/mcpb)
```

## Don't

- Don't break the output contract or rename schema fields.
- Don't hardcode credentials or read `process.env` outside `credentials.js`.
- Don't scrape sources without a usable API.
- Don't call `fetch` directly in a server — go through `getJson()`.
