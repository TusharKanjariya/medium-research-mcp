# medium-research-mcp

A suite of small, single-purpose **MCP servers** (Node) that each wrap one
developer-community source's public API — Hacker News, Stack Exchange, Lobsters,
Lemmy, Dev.to, GitHub, Libraries.io, Product Hunt, a generic RSS/Atom fetcher, any
public Discourse forum, and any public Mastodon instance. Every server emits the
**same normalized JSON shape** so a consumer can rank, filter, and cite blog-topic
research across sources with zero per-source logic.

Ships as one npm package (`medium-research-mcp`) exposing 11 `medium-research-<source>`
executables — add only the sources you want; each runs as an isolated stdio process.

## Install

See **[docs/INSTALL.md](docs/INSTALL.md)** for per-client setup (Claude Desktop, Cursor,
Codex, OpenCode, and the Claude Code plugin path), per-OS spawn config, credential env
blocks, the Windows `npx` and shell-env caveats, and the maintainer release checklist.

## Cross-source sweep

```bash
node examples/pain-point-sweep.mjs rust     # or: npm run example:sweep -- rust
```

One tag queried across Stack Exchange + Discourse + Mastodon + Dev.to, merged into one
ranked list via the shared `mergeRank`, degrading gracefully when a source is
unavailable. See [`examples/pain-point-sweep.mjs`](examples/pain-point-sweep.mjs).

## The output contract

Every list tool returns `{ source, query, count, results: [item] }`; every detail tool
returns `{ source, item: { …item, comments: [...] } }`. Item shape: `id, type, title,
author, score, num_comments, created_utc, url, permalink, tags, text`. `score` and
`num_comments` may be `null` but are never renamed or dropped. Full detail lives in
`docs/PRD.md` and `docs/ARCHITECTURE.md`.
