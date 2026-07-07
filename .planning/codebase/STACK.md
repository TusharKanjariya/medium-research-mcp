# Technology Stack

**Analysis Date:** 2026-07-07

## Languages

**Primary:**
- JavaScript (ES modules, `"type": "module"`) - Everything in the repo: all 9 MCP servers (`servers/*/server.js`), shared modules (`shared/*.js`), tests (`test/*.test.js`), and the live demo (`examples/uniform-run.mjs`). No TypeScript; types are conveyed via JSDoc annotations and Zod schemas.

**Secondary:**
- Python - Not in this repo. The YouTube→blog wrapper lives in a separate repository (per `CLAUDE.md`); nothing Python exists here.

## Runtime

**Environment:**
- Node.js `>=18` (declared in `package.json` `engines`); development machine runs Node 24.18.0. Node 18+ is required for native `fetch` (undici), `node:test`, `AbortController`, and `node:net` `BlockList` — all used by `shared/http_client.js`.
- Runtime target: Claude Desktop's bundled Node runtime — each server is a stdio MCP process spawned as `node servers/<name>/server.js` (see `mcp_config` in each `servers/*/manifest.json`).

**Package Manager:**
- npm
- Lockfile: present (`package-lock.json`, committed)

## Frameworks

**Core:**
- `@modelcontextprotocol/sdk` ^1.29.0 (locked 1.29.0) - MCP server framework. Every server uses `McpServer` + `StdioServerTransport` from `@modelcontextprotocol/sdk/server/mcp.js` and `.../stdio.js`. Note: at SDK 1.29.0, `registerTool` expects RAW Zod shapes (plain objects of Zod fields), NOT `z.object(...)` — see `shared/contract.js` header comment.
- `zod` ^4.4 (locked 4.4.3) - Input/output schema validation. `shared/contract.js` exports both raw shapes (`itemShape`, `listEnvelopeShape`, `detailEnvelopeShape`) for `registerTool` and compiled `z.object` schemas (`ItemSchema`, etc.) for runtime `.parse()`.

**Testing:**
- `node --test` (Node built-in test runner) - No external test framework. `npm test` runs `node --test`, which discovers `test/*.test.js`. Recorded fixtures live in `test/fixtures/`. HTTP/auth tests inject `fetchImpl`, `sleep`, and `lookup` so nothing touches the real network.

**Build/Dev:**
- None. No bundler, no transpiler, no linter/formatter config detected (no `.eslintrc*`, `.prettierrc*`, `tsconfig.json`). Servers run directly from source.
- MCP Inspector (`npm run inspect:hn` per `CLAUDE.md`) - referenced for manual server inspection, though the root `package.json` currently declares only the `test` script.
- `.mcpb` packaging via `@anthropic-ai/mcpb` (global install) - referenced in `CLAUDE.md`; per every `servers/*/manifest.json` description, actual `.mcpb` packing is deferred to v2 (PKG-01) and manifests are documentation/scaffold only. No `build-mcpb.sh` scripts exist in the repo yet.

## Key Dependencies

**Critical:**
- `@modelcontextprotocol/sdk` 1.29.0 - The only way tools are exposed; the dual `content` + `structuredContent` return contract (`toolResult()` in `shared/contract.js`) is built around its behavior.
- `zod` 4.4.3 - Enforces the "DO NOT BREAK" output contract; `toolResult()` validates every `structuredContent` payload against the envelope schemas before returning.
- `fast-xml-parser` 4.5.7 - Used ONLY by the RSS server (`servers/rss/server.js`) to parse RSS 2.0 / RDF / Atom 1.0 feeds, with tuned entity-expansion limits (billion-laughs / DoS guards).

**Infrastructure (Node built-ins, zero extra deps):**
- Native `fetch` (undici) - All HTTP, always via `shared/http_client.js` (`getJson`/`postJson`/`getText`); direct `fetch` in servers is forbidden.
- `node:net` (`BlockList`, `isIP`) + `node:dns/promises` - SSRF private-range denylist and DNS resolution checks in `shared/http_client.js`.
- `node:crypto` (`createHash`) - POST cache keys (`url + sha1(body)`).
- `Buffer` - HTTP Basic encoding for Reddit OAuth in `shared/auth.js`.

## Configuration

**Environment:**
- All configuration is environment variables, read EXCLUSIVELY through `shared/credentials.js` (the `ENV_VAR` map is the single source of truth; the only `process.env` access in the repo). Empty string is treated as unset.
- Required (fail loudly with "Missing credential: set X" at call time): `LIBRARIESIO_KEY`, `PRODUCTHUNT_TOKEN`.
- Optional (degrade to keyless/anonymous): `STACKEXCHANGE_KEY`, `GITHUB_TOKEN`, `REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET`/`REDDIT_USERNAME`/`REDDIT_PASSWORD` (all four or none), `LEMMY_INSTANCE` (defaults to `https://programming.dev`)/`LEMMY_USERNAME`/`LEMMY_PASSWORD`.
- Hardening/behavior knobs: `MCP_USER_AGENT` (defaults to `medium-research-mcp/1.0 (+https://github.com/TusharRedlioDesigns/medium-research-mcp)`), `RSS_ALLOWED_HOSTS` (comma-separated hostname lock-down for the RSS fetcher; unset = any public host minus the private-range denylist).
- `.env.example` file present at repo root documenting these variables (existence noted only).

**Build:**
- `package.json` (root, single workspace-less package covering all servers) - `type: module`, `engines.node >= 18`, `scripts.test = "node --test"`.
- `servers/*/manifest.json` (mcpb `manifest_version: "0.3"`) - per-server Claude Desktop packaging descriptors; secrets declared as `user_config` fields with `"sensitive": true` and injected into `mcp_config.env` via `${user_config.<field>}` at spawn.

## Platform Requirements

**Development:**
- Node.js 18+ (24.x in use) and npm. No OS-specific requirements; developed on Windows (Git Bash available). No network needed for tests (fixtures + injectable fetch); `examples/uniform-run.mjs` is a manual live-network smoke, deliberately excluded from `npm test`.

**Production:**
- Local, single-user stdio MCP servers spawned by Claude Desktop (or `claude mcp` on the Claude Code plugin path — noted as rough in `servers/hn/manifest.json`). No hosting, no server deployment, no containers. Cache is in-memory (~15-min TTL, unbounded, reset on process restart — `shared/cache.js`).

---

*Stack analysis: 2026-07-07*
