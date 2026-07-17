# Phase 7: Universal Sources & Parameterization Audit - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-14
**Phase:** 7-Universal Sources & Parameterization Audit
**Areas discussed:** Discourse tool surface, Mastodon tool surface, Instance parameterization + Lemmy env, SEC-02 audit deliverable

---

## Discourse tool surface

| Option | Description | Selected |
|--------|-------------|----------|
| 3 tools (exactly SRC-10) | `discourse_latest` + `discourse_top(period)` + `discourse_topic(id)`, category folded as optional param | ✓ |
| 4 tools (+ search) | Add `discourse_search(query)` (research listed it; per-instance /search quirks) | |

**User's choice:** 3 tools (exactly SRC-10)
**Notes:** Smallest surface matching the AC; search deferred. → CONTEXT D-01/D-02. Single-page + limit, no deep pagination (D-03).

---

## Mastodon tool surface

| Option | Description | Selected |
|--------|-------------|----------|
| 4 tools | `mastodon_public` + `mastodon_hashtag` + `mastodon_trending_tags` + `mastodon_trending_links` | ✓ |
| 3 tools (merged trends) | timelines + one `mastodon_trends(type: tags\|links)` | |
| 2 tools (merged all) | `mastodon_timeline(scope)` + `mastodon_trends(type)` | |

**User's choice:** 4 tools (separate single-responsibility)
**Notes:** Clearest for the calling agent; matches the explicit-tool preference. → CONTEXT D-06/D-07. limit clamped at 40 (D-08); trends-disabled → empty envelope (D-10).

---

## Instance parameterization + Lemmy env

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit URL + keep Lemmy env as optional default | Instance = explicit URL param; Lemmy keeps LEMMY_INSTANCE as an overridable default only | ✓ |
| Explicit URL + drop Lemmy env entirely | Instance always required everywhere incl. Lemmy | |
| Smart field (bare host) + keep Lemmy env | Accept bare host/URL and normalize | |

**User's choice:** Explicit URL + keep Lemmy env as optional default
**Notes:** Satisfies SEC-02 "env as optional default only" (D-13). Security consequence captured (D-15): making Lemmy's instance a tool parameter changes its threat model, so Lemmy's `getJson` must switch to `untrustedHost:true` (it is env-only/unguarded today).

---

## SEC-02 audit deliverable

| Option | Description | Selected |
|--------|-------------|----------|
| Automated test | `test/parameterization-audit.test.js` scans servers/ for hardcoded hosts/handles/feeds, allowlisting fixed platform API bases | ✓ |
| Documented checklist | docs/ audit doc (human evidence, can drift) | |
| Both | Test + docs summary | |

**User's choice:** Automated test
**Notes:** Regression-proof enforcement. → CONTEXT D-16. Key nuance locked: a fixed platform host is allowed; a user-specific account/instance/feed must be a parameter.

---

## Claude's Discretion

- Exact `score`/`num_comments` source fields for Discourse topics + Mastodon statuses/trends (confirm live in research; mapping intent locked, field names not).
- Trending-tag type ("topic" guidance) vs trending-link type ("article"); Discourse category route shape; the audit-test allowlist regex.

## Deferred Ideas

- `discourse_search`; deep Discourse pagination; authenticated/tokened reads; Bluesky (v2+); SEC-03 DNS-rebinding residual (accepted, not reopened).
