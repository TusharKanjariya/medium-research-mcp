---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_phase: 02
current_phase_name: keyless-source-breadth
status: executing
stopped_at: Completed 02-02-PLAN.md (Lobsters + Lemmy servers)
last_updated: "2026-07-02T07:25:50.043Z"
last_activity: 2026-07-02
last_activity_desc: Completed Plan 02-02 (Lobsters + Lemmy servers)
progress:
  total_phases: 4
  completed_phases: 2
  total_plans: 6
  completed_plans: 6
  percent: 50
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-01)

**Core value:** Uniform normalized output across every source, so `medium-blog-pro` consumes any source with zero per-source logic.
**Current focus:** Phase 02 — keyless-source-breadth

## Current Position

Phase: 02 (keyless-source-breadth) — EXECUTING
Plan: 3 of 3
Status: 02-02 complete; 02-03 remaining
Last activity: 2026-07-02 — Completed Plan 02-02 (Lobsters + Lemmy servers)

Progress: [██████░░░░] 67% (2 of 3 plans)

## Performance Metrics

**Velocity:**

- Total plans completed: 3
- Average duration: — min
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1 | 3 | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*
| Phase 02 P01 | 1min | 2 tasks | 6 files |
| Phase 02 P02 | 15min | 3 tasks | 12 files |
| Phase 02 P03 | 25min | 3 tasks | 13 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Init: Node for research servers, Python only for the YouTube wrapper.
- Init: Normalized output contract is the linchpin — every server conforms exactly.
- Init: Coarse granularity, parallel execution (Phases 2 and 3 can run in parallel after Phase 1).
- [Phase ?]: SE text mapped from body_markdown ?? body: built-in withbody filter returns HTML body not body_markdown (A1 corrected); stripHtml cleans downstream
- [Phase 02 P02]: Lemmy authenticated reads require LEMMY_INSTANCE set explicitly (even to the default programming.dev) alongside LEMMY_USERNAME/LEMMY_PASSWORD — lemmyCreds() needs all three; username/password alone degrade to anonymous with no error. Documented in manifest + tool descriptions and asserted by tests.
- [Phase 02 P02]: Lobsters author = plain-string submitter_user (Pitfall 6); Lemmy permalink = post.ap_id (federation URL); Lemmy posts have no tags (tags: []).
- [Phase ?]: [Phase 02 P03]: Hashnode public GraphQL endpoint is gql.hashnode.com/public (root now serves a Vercel app); live origin was down (522) so fixtures built from cited schema, flagged for one live-call A2 verification. — SUPERSEDED 2026-07-02: SRC-04 (Hashnode) dropped and server removed; upstream retired free/keyless GraphQL access (Pro plan required as of 2026-05-13).
- [Phase ?]: [Phase 02 P03]: postJson() cache key = url+sha1(body) via node:crypto so distinct GraphQL queries to one URL never collide; key stays a non-secret logical key.
- [Phase ?]: [Phase 02 P03]: Dev.to tag_list is array on list, comma-string on detail; toTags() normalizes both so contract tags:string[] always holds.

### Pending Todos

None yet.

### Blockers/Concerns

None yet.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Sources | Discourse (SRC-10), Mastodon (SRC-11), Bluesky (SRC-12) | v2 — deferred | 2026-07-01 |
| Distribution | `.mcpb` bundles (PKG-01) | v2 — deferred | 2026-07-01 |

## Session Continuity

Last session: 2026-07-02T07:23:14.185Z
Stopped at: Completed 02-02-PLAN.md (Lobsters + Lemmy servers)
Resume file: .planning/phases/02-keyless-source-breadth/02-03-PLAN.md
