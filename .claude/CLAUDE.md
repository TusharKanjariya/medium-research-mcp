<!-- GSD:project-start source:PROJECT.md -->

## Project

**medium-research-mcp**

A suite of small, single-purpose **MCP servers** (Node) that each wrap one
developer-community source's public API — Hacker News, Stack Exchange, Lobsters,
Lemmy, Hashnode, Dev.to, GitHub, Libraries.io, Product Hunt, and a generic
RSS/Atom fetcher — plus a separate Python YouTube→blog wrapper. Every server
emits the **same normalized JSON shape** so the `medium-blog-pro` skill can pull
blog-topic research from many sources in one pass with zero per-source logic.

**Core Value:** **Uniform normalized output across every source.** If everything else fails,
the one thing that must hold is the output contract — `{ source, query, count,
results[] }` for lists and `{ source, item }` for details, with a fixed item
schema — because that is what lets the consuming skill rank, filter, and cite
across sources without a single source-specific branch.

### Constraints

- **Tech stack**: Research servers are Node (`type: module`, `@modelcontextprotocol/sdk`
  + `zod`, stdio, native `fetch`) — Claude Desktop ships a Node runtime so a Node
  `.mcpb` needs no external runtime. YouTube wrapper is Python (wraps an existing
  Tesseract OCR script; local-only).

- **Output contract**: every server conforms exactly to ARCHITECTURE §4; `score`
  and `num_comments` may be `null` but must never be renamed or dropped.

- **Security**: credentials never hardcoded, never read from `process.env`
  outside `shared/credentials.js`; `.mcpb` secrets marked `sensitive` (keychain).

- **Dependencies**: free/keyless API tiers preferred; where a key is required
  (Libraries.io, Product Hunt) fail with a clear "set X" error; where keyless
  tiers exist (Stack Exchange, GitHub, Reddit reads) degrade gracefully.

- **Compliance**: personal/non-commercial use (Product Hunt API is non-commercial
  by default); respect each source's rate limits.

- **Resilience**: ~15-min in-memory TTL cache, retry with backoff, stale-cache
  fallback — a tool call never hard-errors on a transient blip.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:STACK.md -->

## Technology Stack

Technology stack not yet documented. Will populate after codebase mapping or first phase.
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
