# Phase 6: Author-Blog Awareness - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-14
**Phase:** 6-Author-Blog Awareness
**Areas discussed:** Tool surface, Author parameterization, Preview/paywall signal, Phase scope (Substack archive + recipes home)

---

## Tool surface

| Option | Description | Selected |
|--------|-------------|----------|
| 3 focused tools | `rss_author_posts` + `rss_tag_posts` + `rss_substack_archive` alongside `rss_fetch`; single-responsibility, more surface to document | ✓ |
| 1 polymorphic tool | One `rss_author_posts` with mode/platform enum covering author+tag+archive; fewer tools, denser schema, risks param-inference | |
| 2 tools | `rss_author_posts` (tag folded via optional param) + `rss_substack_archive` | |

**User's choice:** 3 focused tools
**Notes:** Relaxes the current "single-tool rss server" comment. Clarity over dense polymorphism, consistent with Phase 5's explicit-tool preference (D-14/D-15). → CONTEXT D-01.

---

## Author parameterization

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit platform + handle | `platform` enum (medium/substack/feed_url) + handle; matches Phase 5's explicit-enum discipline | |
| Single smart field | One `author` string; server infers platform from shape (@user, subdomain, URL) | ✓ |

**User's choice:** Single smart field
**Notes:** Deliberate departure from Phase 5's "never infer" (D-15) — the three author shapes are mutually distinguishable, so inference doesn't guess intent. Inference table + ambiguous-token reject locked in CONTEXT D-02/D-03. `rss_tag_posts` needs no platform param because Medium is the only keyless tag feed (D-11).

---

## Preview / paywall truncation signal

| Option | Description | Selected |
|--------|-------------|----------|
| Tag marker | `preview-only` entry in `tags[]`; structured, machine-readable, keeps `text` clean | ✓ |
| Inline text note | `[preview only]` appended to `text`; human-obvious but pollutes citable content | |
| Both | Tag marker + inline note; belt-and-suspenders | |

**User's choice:** Tag marker (`preview-only` in `tags[]`)
**Notes:** Contract stays frozen — `tags` is an existing field. → CONTEXT D-06/D-07.

---

## Phase scope (Substack archive + recipes home)

| Option | Description | Selected |
|--------|-------------|----------|
| Ship Substack archive | Implement `rss_substack_archive` via `/api/v1/archive`, degrade to RSS window on failure (AC criterion 3) | ✓ |
| Recipes in tool descriptions | ABLOG-05 recipes embedded in tool descriptions (like `rss_fetch`'s RECIPE blocks) | ✓ |
| Recipes in a docs/ file | ABLOG-05 recipes as standalone `docs/` file, tool descriptions stay lean | ✓ |

**User's choice:** All three — ship archive, recipes in BOTH descriptions and a docs/ file
**Notes:** Archive is a listed acceptance criterion, so in-scope (CONTEXT D-08/D-09/D-10). Recipes go in both places: concise pointers in descriptions + full worked recipes in `docs/AUTHOR-BLOG-RECIPES.md` (CONTEXT D-12/D-13).

---

## Claude's Discretion

- Preview-detection heuristics (D-07) refinable by planner; the `preview-only` tag string is fixed.
- Substack archive JSON field-name mapping confirmed at implementation via live probe; the contract mapping (reactions→`score`, comments→`num_comments`) is locked (D-09).
- Ambiguous-bare-token error wording (D-03) and exact `docs/` filename (D-12) finalized by planner.
- Medium 403 handling: the identified UA already exists in `getText`; only the 403→clear-error mapping and an optional `1.0→1.1` version bump are new (D-14).

## Deferred Ideas

- Non-Medium tag feeds (no keyless endpoint) — `rss_tag_posts` Medium-only in v1.1.
- Semantic/embedding dedup index — v2+ anti-feature; v1.1 stays title+teaser heuristic.
- Medium/Substack stats scraping & post publishing — no keyless API; v2+.
- Cookie/subscription workarounds for full paywalled bodies — out of scope, against keyless premise.
