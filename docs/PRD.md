# PRD — medium-research-mcp

**Owner:** Tushar Kanjariya · **Status:** Active · **Last updated:** 2026-06-16

## 1. Problem

I write technical posts on Medium and need a reliable way to find trending,
high-signal blog topics across the developer community — recurring pain points,
hot discussions, "what just launched," and what's already ranking on a topic so
I can write the better version.

My previous approach (a single Reddit MCP) broke against two of Reddit's gates:

- **App creation requires karma** — a low-karma account can't register the
  developer app needed for OAuth credentials.
- **Subreddit access requires joining** — the MCP couldn't read communities the
  account hadn't joined.

I need to remove that single point of failure and pull research from many
sources that don't impose community-join or karma gates to read public content.

## 2. Solution

A suite of small, single-purpose **MCP servers**, each wrapping one source's
public API, callable directly from Claude Desktop. Every server emits the
**same normalized JSON shape**, so my blogging skill (`medium-blog-pro`)
consumes any source identically in its Phase 0 research step — pulling from 5+
sources in one pass instead of manual searching.

## 3. Goals

- Replace the single Reddit dependency with a multi-source research pipeline.
- Every source readable with **no community-join and no karma gate**; prefer
  no-auth, fall back to free keys/tokens where required.
- **Uniform structured output** across all sources so the consuming skill needs
  zero source-specific logic.
- Adding a new source is **mostly mechanical** — copy the pattern, map fields to
  the shared schema.
- Packageable as one-click `.mcpb` bundles with credentials stored in the OS
  keychain.

## 4. Non-goals

- Not a general-purpose Reddit/social client — read-only topic research only.
- Not writing the posts. These are **research tools**; drafting is the skill's job
  (the one exception is the YouTube→blog wrapper, which produces draft material).
- Not scraping sites that lack a usable API (e.g. Quora, Indie Hackers).
- Not real-time/streaming. Cached research bursts are sufficient.

## 5. Users

- **Primary user:** me (single operator), via Claude Desktop / Claude Code.
- **Programmatic consumer:** the `medium-blog-pro` skill, which calls these tools
  and reads their JSON output.

## 6. Functional requirements

1. Each server exposes a small set of tools: a "trending/front" list, a search,
   and a detail/comments fetch (where the source supports it).
2. All list tools return the envelope `{ source, query, count, results[] }`;
   detail tools return `{ source, item }`. See ARCHITECTURE.md §4 for the schema.
3. **Credentials are never hardcoded** — read only from environment variables via
   `shared/credentials.js`; in `.mcpb` bundles they come from `user_config`
   (sensitive → keychain).
4. **Graceful degradation:** where an API has a keyless tier (Stack Exchange,
   GitHub, Reddit reads), run keyless when no credential is present; where it
   doesn't (Libraries.io, Product Hunt), fail with a clear "set X" message.
5. **Caching + resilience:** ~15-minute in-memory TTL cache, retry with backoff,
   and stale-cache fallback so a tool call never hard-errors on a transient blip.
6. **Username/password auth** supported for sources that use it (Reddit password
   grant, Lemmy login), exchanged once for a cached token — never sent per call.

## 7. Sources (prioritized)

Built: **Hacker News**. Planned, roughly in priority order: **Stack Exchange
network** (Stack Overflow + Server Fault, Super User, DBA, Security, …),
**Lobsters**, **Lemmy** (Reddit replacement), **Dev.to**,
**GitHub** (trending repos + issues/discussions), **Libraries.io**,
**Product Hunt**, a **generic RSS/Atom fetcher** (unlocks many newsletters/blogs
at once), and the **YouTube→blog** wrapper. See ROADMAP.md for sequencing and
ARCHITECTURE.md §5 for the per-source API/auth matrix.

## 8. Success criteria

- A single Phase 0 research run pulls from **5+ sources** and returns a uniform
  list the skill can rank and filter with no per-source branches.
- A new source server can be added by copying an existing one and changing only
  the endpoint + field mapping.
- No credential ever appears in code or on disk in plaintext.

## 9. Constraints & risks

- Free/low-cost API tiers only; respect each source's rate limits.
- **Personal/non-commercial use** — Product Hunt's API is non-commercial by
  default; revisit if posts are ever monetized.
- API instability: Lemmy's `/api/v3` is explicitly unstable; Reddit's gates may
  tighten further. Mitigated by multi-source design (no single dependency).
- Reddit's password grant still needs a script app's id/secret, so it does **not**
  bypass the original karma gate — Lemmy is the true no-app replacement.
