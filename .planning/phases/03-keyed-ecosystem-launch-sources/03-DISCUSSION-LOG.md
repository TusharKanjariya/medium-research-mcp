# Phase 3: Keyed Ecosystem & Launch Sources - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-02
**Phase:** 3-Keyed Ecosystem & Launch Sources
**Areas discussed:** GitHub tool surface, 'Trending'/'rising' meaning, Filtering surface, Pain-point mining query

---

> **Session note:** The area-selection question timed out (user away from
> keyboard). Per the "proceed on best judgment" fallback and the project's
> "YOLO but ask on sensitive" guidance — this phase is a mechanical copy of the
> proven pattern and every choice is a reversible planner-actionable default —
> Claude captured recommended defaults for all four gray areas instead of
> blocking. No option was interactively selected by the user; the "Selected"
> column below marks Claude's recommended default, tagged `[REC]`.

## GitHub tool surface

| Option | Description | Selected |
|--------|-------------|----------|
| Split by entity: `gh_trending_repos` / `gh_search_issues` / `gh_get_item` | Uniform, predictable names; repo vs issue explicit via tool + `type` | ✓ [REC] |
| Overload the `*_hot`/`*_search`/`*_get` trio across both entities | Fits the convention literally but forces the consumer to guess entity type | |
| Include GitHub Discussions (GraphQL) in v1 alongside issues | Fuller roadmap coverage but leaves the `getJson()` path for GraphQL | |

**User's choice:** (timeout) — Claude default: split by entity (D-01); issues-first, Discussions deferred to a stretch goal (D-02).
**Notes:** Narrows ROADMAP criterion 1's "issues/discussions" to issues-first for v1; flagged in CONTEXT.md. Discussions may be added by the planner via `postJson()` if cheap.

---

## 'Trending' / 'rising' meaning

| Option | Description | Selected |
|--------|-------------|----------|
| GitHub: Search `sort=stars` windowed to recent activity (default 7d) | Emulates trending on the supported Search API; `since` override | ✓ [REC] |
| Libraries.io: default most-depended (`dependents_count`), `sort` override for rising | Stablest momentum signal; maps directly to `score` | ✓ [REC] |
| Product Hunt: default today, `period` override for this-week | Matches Phase 2 D-07 native-trending | ✓ [REC] |

**User's choice:** (timeout) — Claude defaults D-03/D-04/D-05.
**Notes:** No source has a clean native trending feed; each default picks the most defensible momentum signal with a param to override.

---

## Filtering surface

| Option | Description | Selected |
|--------|-------------|----------|
| Free passthrough (Libraries.io `platform` default `npm`; PH `topic` optional) | Mirrors Stack Exchange `site` (Phase 2 D-03); no whitelist to maintain | ✓ [REC] |
| Curated whitelist of platforms/topics | Safer inputs but ongoing maintenance and drift | |

**User's choice:** (timeout) — Claude defaults D-06/D-07 (free passthrough).
**Notes:** Upstream APIs validate platform/topic and error on unknown values.

---

## Pain-point mining query

| Option | Description | Selected |
|--------|-------------|----------|
| Global issue search + optional `labels`/`repo` scope, sort by reactions, reactions→`score` | High-signal frustration mining across GitHub | ✓ [REC] |
| Scope strictly per-repo/org (require a repo) | Narrower, misses cross-ecosystem pain points | |
| Skip reaction counts (leave `score` null) | Simpler but loses the core pain-point signal | |

**User's choice:** (timeout) — Claude defaults D-08/D-09.
**Notes:** Reaction-count fetch mechanism (accept header vs `reactions` field) left as a researcher/planner detail; flagged so `score` isn't silently null.

---

## Claude's Discretion

- Exact `normalize*`/field-map names, URL/query builders, GitHub Search qualifier
  strings and trending-window arithmetic, Libraries.io endpoint + `sort` enums,
  Product Hunt GraphQL query strings + pagination, reaction-count fetch mechanism,
  and page sizes — all planner/executor calls within the ARCHITECTURE §4/§5 contract.
- Per-source `type` enum mapping (repo/issue/package/launch).

## Deferred Ideas

- GitHub Discussions via GraphQL (deferred from D-02).
- Unofficial GitHub trending page / third-party trending APIs (rejected for Search API).
- Libraries.io per-package detail enrichment (dependents list, SourceRank breakdown).
- Product Hunt collections / makers / deep comment threads.
