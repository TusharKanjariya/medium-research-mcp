---
phase: 05-guarded-json-path-trending-signals
plan: 03
subsystem: api
tags: [stackexchange, no-answers, trending, view_count, throttle, backoff, mcp, zod]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "SE reference server (seUrl, mapSeQuestion, buildListEnvelope, toolResult, getJson chokepoint)"
provides:
  - "so_unanswered MCP tool — high-view zero-answer SE questions per required tag, view_count-ranked (unmet-need mining)"
  - "exported mapSeUnanswered(q) — mapSeQuestion with score overridden to view_count (D-08)"
  - "exported async seThrottle(raw, { sleep }) — honors SE backoff (sleep-within) + throws set-STACKEXCHANGE_KEY on quota_remaining=0 (D-10)"
affects: [consumer mergeRank ordering, future SE trending tools]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Client-side re-rank of a single-page window by an engagement field the API cannot sort on (view_count) before .map()"
    - "Behavioral throttle honoring via an injectable-sleep helper — throttle state never enters the frozen envelope (OQ-1)"
    - "Single-fetch window (pagesize=min(limit*2,100), no paging) so the common case never needs a follow-up backoff sleep"

key-files:
  created:
    - test/fixtures/stackexchange-noanswers.json
    - test/fixtures/stackexchange-noanswers-backoff.json
    - test/fixtures/stackexchange-noanswers-quota-zero.json
  modified:
    - servers/stackexchange/server.js
    - test/stackexchange.test.js

key-decisions:
  - "OQ-1 resolved: throttle state rides the error + behavioral paths ONLY — no backoff/quota_remaining field is ever added to the frozen {source,query,count,results} envelope"
  - "score := view_count for this tool only (D-08); num_comments stays answer_count (=0 for no-answers, contract-legal); type stays 'question'"
  - "SE has no server-side view sort (sort=views is rejected — Pitfall 2), so fetch with sort=activity and re-rank by view_count desc client-side, then slice to limit"
  - "tag is REQUIRED (D-09) — a no-answers mine is only meaningful per tag"
  - "Single-page window (OQ-2) keeps the tool single-fetch; a present backoff is honored (one sleep) but the common path issues no follow-up request"

patterns-established:
  - "Pattern: one-field-override mapper (mapSeUnanswered reuses mapSeQuestion, overrides only score) instead of a parallel mapper"
  - "Pattern: exported async throttle helper with injected sleep for offline, real-time-free backoff assertions (mirrors http_client sleepSpy)"

requirements-completed: [TREND-02]

coverage:
  - id: D1
    description: "so_unanswered mines /questions/no-answers for a REQUIRED tag, ranks by view_count desc client-side, fills score with view_count"
    requirement: "TREND-02"
    verification:
      - kind: unit
        ref: "test/stackexchange.test.js#view_count re-rank reorders the fetched window strictly descending"
        status: pass
      - kind: unit
        ref: "test/stackexchange.test.js#mapSeUnanswered overrides score with view_count, keeps the rest of the item map"
        status: pass
    human_judgment: false
  - id: D2
    description: "quota_remaining=0 throws the set-STACKEXCHANGE_KEY guidance via seThrottle (D-10)"
    requirement: "TREND-02"
    verification:
      - kind: unit
        ref: "test/stackexchange.test.js#seThrottle throws the set-STACKEXCHANGE_KEY guidance when quota_remaining is 0"
        status: pass
    human_judgment: false
  - id: D3
    description: "a present backoff is honored by sleeping backoff*1000 ms via the injected sleep before any follow-up request (D-10)"
    requirement: "TREND-02"
    verification:
      - kind: unit
        ref: "test/stackexchange.test.js#seThrottle honors a present backoff by sleeping backoff*1000 ms"
        status: pass
      - kind: unit
        ref: "test/stackexchange.test.js#seThrottle does NOT sleep for a normal response with no backoff"
        status: pass
    human_judgment: false
  - id: D4
    description: "the list envelope stays frozen — no backoff/quota_remaining field is ever added (OQ-1)"
    requirement: "TREND-02"
    verification:
      - kind: unit
        ref: "test/stackexchange.test.js#a list envelope built from mapSeUnanswered parses against the frozen contract"
        status: pass
    human_judgment: false

metrics:
  duration_seconds: 259
  completed: 2026-07-10
  tasks_completed: 3
  files_changed: 5

status: complete
---

# Phase 5 Plan 3: Stack Exchange High-View No-Answers Mining Summary

Added `so_unanswered`, a Stack Exchange tool that mines the `/questions/no-answers` set for a required tag and ranks it by `view_count` descending — a high-view zero-answer question is the purest unmet-need signal for a blog topic (TREND-02). The frozen output contract is untouched: throttle state is surfaced behaviorally (backoff sleep) and via the error path (quota exhaustion), never as an envelope field (OQ-1 resolved).

## What was built

- **`mapSeUnanswered(q)`** (exported) — `{ ...mapSeQuestion(q), score: q.view_count ?? null }`. Reuses the existing question mapper and overrides exactly one field: `score` becomes `view_count` (D-08). `num_comments` stays `answer_count` (0 for the no-answers set — contract-legal), `type` stays `"question"`.
- **`seThrottle(raw, { sleep })`** (exported, async) — honors SE's throttle signals without touching the envelope (D-10, OQ-1): throws a clear `set STACKEXCHANGE_KEY` error when `quota_remaining === 0`; `await sleep(backoff * 1000)` when a positive `backoff` field is present, before any follow-up request. Default sleeper is a local `realSleep`; injectable for tests.
- **`so_unanswered` tool** — required `tag` (D-09), optional `site` (defaults `stackoverflow`) and `limit` (1–50, default 20). Fetches a single page via `seUrl("/questions/no-answers", { site, tagged, sort: "activity", order: "desc", pagesize: min(limit*2,100) })` (fixed host, no `untrustedHost`), calls `seThrottle(raw)`, then re-ranks `raw.items` by `view_count` desc client-side, slices to `limit`, and maps via `mapSeUnanswered`. `sort=views` is deliberately NOT sent (SE rejects it — Pitfall 2).
- **Three synthesized fixtures** — `stackexchange-noanswers.json` (4 items, out-of-order view_counts 900/12000/300/5400, `answer_count: 0`, bodies present), plus `-backoff.json` (`"backoff": 3`) and `-quota-zero.json` (`"quota_remaining": 0`). Backoff and quota-zero never appear in live captures, so they are hand-synthesized (Pitfall 1).
- **Tests** — view_count re-rank ordering (proves fetched order is NOT preserved and the head is the max-view item), `mapSeUnanswered` field map, `seThrottle` quota-zero error + backoff sleep-within (asserted via an injected `sleepSpy` recording a single 3000ms wait) + no-backoff no-sleep, envelope contract conformance (no leaked throttle fields), and registration/required-tag smoke.

## How to verify

- `node --test test/stackexchange.test.js` → 27 pass, 0 fail (re-rank + throttle + registration all green).
- `node --check servers/stackexchange/server.js` → exits 0.
- The list envelope built from `mapSeUnanswered` parses against `ListEnvelopeSchema` with no `backoff`/`quota_remaining` key (OQ-1 honored).

## Deviations from Plan

**1. [Rule 3 - Blocking] Updated the existing "registers exactly three tools" assertion in Task 2**
- **Found during:** Task 2
- **Issue:** Registering the 4th tool (`so_unanswered`) broke the pre-existing `deepEqual` registration-smoke test that asserted exactly `[so_get_question, so_hot_questions, so_search]`. This is a direct, unavoidable consequence of adding the tool.
- **Fix:** Updated that one assertion to include `so_unanswered` so Task 2's `<verify>` (`node --test test/stackexchange.test.js`) stayed green; the dedicated new-tool tests were then added in Task 3 as planned.
- **Files modified:** test/stackexchange.test.js
- **Commit:** ddd25df

## Notes

- `node --test test/` (whole-directory form) reports a spurious failure on this Node version because it resolves `test/` as a module path rather than a directory. Every test file passes individually (0 failures across all 15 files). The plan's per-file verify command is the source of truth and is green.
- Fixtures were written with LF; Git's autocrlf emitted the usual "LF will be replaced by CRLF" warnings on commit — cosmetic, no content impact.

## Self-Check: PASSED
- FOUND: servers/stackexchange/server.js (mapSeUnanswered, seThrottle, so_unanswered)
- FOUND: test/fixtures/stackexchange-noanswers.json, -backoff.json, -quota-zero.json
- FOUND: test/stackexchange.test.js (new tests)
- FOUND commit 765bc9e (fixtures), ddd25df (server), 2c002b2 (tests)
