# Phase 5: Guarded JSON Path & Trending Signals - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-10
**Phase:** 5-Guarded JSON Path & Trending Signals
**Areas discussed:** Guard design & security posture, Stack Exchange mining behavior, HN rising semantics & defaults, Dev.to tool surface

---

## Guard design & security posture

### Q1 — How to expose the guarded JSON path

| Option | Description | Selected |
|--------|-------------|----------|
| Opt-in flag | `getJson(url, { untrustedHost: true })` — one function, one code path, fixed hosts pay zero DNS cost | ✓ |
| Separate wrapper function | `getJsonFromUserHost(url)` — explicit/greppable but duplicates retry loop or just renames | |
| Guard everything | Every call runs `assertSafeUrl` — fail-safe but DNS on every fixed-host call, risks offline tests | |

**User's choice:** Opt-in flag

### Q2 — SEC-03 (DNS-rebinding TOCTOU residual T-04-06)

| Option | Description | Selected |
|--------|-------------|----------|
| Keep deferred | Re-affirm accepted risk in threat model; IP-pinning stays v2+ | ✓ |
| Close it now | Implement undici custom-lookup IP-pinning dispatcher | |
| Partial hardening | Cheaper mitigation (re-resolve before fetch, or JSON-path allowlist) | |

**User's choice:** Keep deferred

### Q3 — Guard posture on user-supplied instance URLs

| Option | Description | Selected |
|--------|-------------|----------|
| Match RSS guard exactly | Reuse getText posture: http+https, BlockList, redirect re-validation, allowlist | ✓ (baseline) |
| Content-type / JSON-safety check | Verify JSON before parse; clean login-required error for HTML-200 | ✓ (added) |
| https-only for instances | Stricter than RSS; rejects rare plain-http test instances | |
| Reject creds-in-URL / non-default ports | Refuse user@host and custom ports | ✓ creds-in-URL only |

**User's choice:** "I have no idea about that. You decide what is the simple and best." → Claude decided: reuse RSS guard exactly + content-type/JSON-safety check + reject creds-in-URL + **allow** non-default ports (IP denylist is the real SSRF control, not the port). No forked guard implementation.
**Notes:** User delegated the posture details; substance locked in CONTEXT.md D-02..D-05.

---

## Stack Exchange mining behavior

### Q1 — Which question set to mine

| Option | Description | Selected |
|--------|-------------|----------|
| no-answers | Zero-answer questions — purest unmet-need signal, ranked by view_count | ✓ |
| unanswered | SE heuristic (no accepted answer + low score) — broader, noisier | |
| Expose both via a param | mode param — max flexibility, doubles surface | |

**User's choice:** no-answers

### Q2 — API `backoff` handling

| Option | Description | Selected |
|--------|-------------|----------|
| Sleep within, record in output | Sleep backoff before follow-up fetch; surface backoff + quota_remaining | ✓ |
| Record + warn only, never sleep | Expose fields, never block; agent paces itself | |
| Refuse follow-up if backoff active | Hard-error next call — safest vs bans but against no-hard-error principle | |

**User's choice:** Sleep within, record in output

### Q3 — Tag requirement + target site

| Option | Description | Selected |
|--------|-------------|----------|
| Tag required, site defaults to SO | Tag required; site overridable via existing param | ✓ |
| Tag optional | Site-wide no-answer window without tag — noisier, more quota | |
| You decide | Simplest ergonomic default | |

**User's choice:** Tag required, site defaults to SO

---

## HN rising semantics & defaults

### Q1 — Result ordering

| Option | Description | Selected |
|--------|-------------|----------|
| Re-sort by points/hour velocity | Sort candidates by points ÷ age — closest to "rising" | ✓ |
| Re-sort by raw points | Absolute points desc — favors older-in-window | |
| Pass date order through | Native newest-first, documented — can reorder mergeRank results | |

**User's choice:** Re-sort by points/hour velocity

### Q2 — Default window / min-points

| Option | Description | Selected |
|--------|-------------|----------|
| 24h / 10 points | Full day catches cross-timezone climbers; low floor filters noise | ✓ |
| 12h / 20 points | Tighter/fresher; can come back empty on quiet days | |
| 48h / 5 points | Wider net; noisier, leans "recent" | |

**User's choice:** 24h / 10 points

### Q3 — Optional query/keyword param

| Option | Description | Selected |
|--------|-------------|----------|
| Optional query param | hn_rising(query?) — keyword-scoped or site-wide; consistent with SE/Dev.to | ✓ |
| Site-wide only | Always global rising window — simpler, can't answer niche | |

**User's choice:** Optional query param

---

## Dev.to tool surface

### Q1 — Shape of the trending capability

| Option | Description | Selected |
|--------|-------------|----------|
| Extend devto_top with params | Add top(days) + rising + tag to existing tool — fewer tools | ✓ |
| Add separate devto_trending tool | Cleaner separation but a 5th tool, overlaps devto_top | |
| You decide | Simplest surface satisfying TREND-01 | |

**User's choice:** Extend devto_top with params

### Q2 — Selecting between top-of-window and rising modes

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit mode param | mode enum (top|rising) + days + tag; Zod rejects invalid combos | ✓ |
| Infer from params | days→top, rising:true→rising; allows contradictory inputs | |
| You decide | Clearest schema without invalid API combos | |

**User's choice:** Explicit mode param

---

## Claude's Discretion

- **Guard posture (D-02..D-05):** user delegated "you decide what is simple and best." Claude locked: reuse RSS guard exactly, add content-type/JSON-safety check, reject creds-in-URL, allow non-default ports.
- Minor naming (SE tag param, Dev.to `mode` field name, HN `numericFilters` string construction) left to planner/researcher provided documented semantics hold.

## Deferred Ideas

- **SEC-03 IP-pinning dispatcher** — reconsidered per roadmap, re-deferred to v2+ (accepted risk, local single-user tool).
- **Extract shared `attemptWithRetry` retry core** — enabling refactor if adding `untrustedHost` to three copies proves error-prone; not new scope.
