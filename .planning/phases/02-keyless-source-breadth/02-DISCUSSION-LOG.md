# Phase 2: Keyless Source Breadth - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-02
**Phase:** 2-Keyless Source Breadth
**Areas discussed:** Search on no-search sources, Stack Exchange site & naming, Lemmy default instance, 'Trending' definition per source

---

## Search on sources without native full-text search

| Option | Description | Selected |
|--------|-------------|----------|
| Client-side filter | Fetch a recent/top page, substring-filter title+tags+text; caveat = only the fetched window | ✓ |
| Tag-only search | `*_search` maps to a tag endpoint; no free-text | |
| Omit where unsupported | Only expose search on SE/Hashnode; skip Dev.to/Lobsters | |

**User's choice:** Client-side filter
**Notes:** Keeps a uniform tool surface — every source gets a working `*_search`. Window limitation to be stated in the tool description.

---

## Stack Exchange site & tool surface

| Option | Description | Selected |
|--------|-------------|----------|
| Default SO, free passthrough | Default `site=stackoverflow`; forward any site string; SE API validates | ✓ |
| Default SO, validated whitelist | Restrict `site` to a curated list, reject others locally | |
| Require explicit site | No default; caller must pass `site` every call | |

**User's choice:** Default SO, free passthrough
**Notes:** Tool names remain `so_hot_questions`/`so_search`/`so_get_question` (fixed by ROADMAP success criteria). Optional `STACKEXCHANGE_KEY` via existing helper, keyless otherwise.

---

## Lemmy default instance & scope

| Option | Description | Selected |
|--------|-------------|----------|
| programming.dev, federated 'All' | Dev-focused instance, listing type All; overridable via LEMMY_INSTANCE | ✓ |
| lemmy.world, federated 'All' | Largest general instance; higher volume, noisier for dev topics | |
| programming.dev, Local only | Tightest dev signal, less breadth | |

**User's choice:** programming.dev, federated 'All'
**Notes:** Lemmy is the phase's end-to-end exercise of the `auth.js` username/password path; auto-auth when `LEMMY_*` present, anonymous reads otherwise.

---

## 'Trending' / hot semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Native per-source, overridable | Each uses its API's native trending with optional sort/time params | ✓ |
| Recency-weighted everywhere | Default all to newest / past week | |
| Engagement-weighted everywhere | Default all to highest score/votes | |

**User's choice:** Native per-source, overridable
**Notes:** SE hot/votes, Dev.to top-of-week, Hashnode trending, Lobsters hottest — least-surprising per-source defaults.

---

## Claude's Discretion

- Exact field-map function names, URL/query builders, SE `filter` id for body text, Hashnode GraphQL query strings, Dev.to search page size, Lemmy sort enum values.
- Per-source `type` enum mapping following ARCHITECTURE §4/§5.

## Deferred Ideas

- Full-corpus / paginated search for client-side-filtered sources (if the fetched-window cap proves too narrow).
- Dedicated Reddit `.json` source server (still deferred; RSS `.rss` recipe covers read-only Reddit in Phase 4).
- Additional Stack Exchange convenience tools (site discovery, tag browsing) beyond the three roadmap-fixed tools.
