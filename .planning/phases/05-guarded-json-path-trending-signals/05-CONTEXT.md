# Phase 5: Guarded JSON Path & Trending Signals - Context

**Gathered:** 2026-07-10
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers two things on the settled v1.0 architecture:

1. **A guarded JSON path (SEC-01)** — the single gating dependency for the rest of
   v1.1. Extend the v1.0 SSRF guard (today only on `getText`/RSS) to cover JSON
   requests whose host comes from untrusted tool input, so future
   instance-parameterized servers (Discourse, Mastodon in Phase 7, Lemmy's
   parameterization move) ride a guarded path. Lemmy's existing
   instance-parameterized calls move onto this same guarded path.
2. **Three additive trending / pain-point tools** on existing servers, all keyless
   JSON GETs through the shared client, all conforming to the frozen output
   contract (new signals expressed through endpoint selection + server-side
   ordering, never new item fields):
   - HN rising (TREND-03)
   - Stack Exchange high-view unanswered mining (TREND-02)
   - Dev.to top-of-window + rising (TREND-01)

**Not in this phase:** the Discourse/Mastodon servers themselves (Phase 7), author-blog
tools (Phase 6), `.mcpb`/npm packaging (Phase 8). No new runtime dependencies —
everything is keyless JSON through `shared/http_client.js`.

</domain>

<decisions>
## Implementation Decisions

### Guard design & security posture (SEC-01)
- **D-01:** Expose the guard as an **opt-in flag on the existing function**:
  `getJson(url, { untrustedHost: true })`. One function, one retry/cache/stale code
  path. Fixed-host servers (HN, Dev.to, Stack Exchange) call `getJson(url)` unchanged
  and pay zero DNS-resolution cost; only user-supplied-host callers pass the flag.
  Do NOT add a separate `getJsonFromUserHost()` wrapper (would duplicate the already-
  triplicated retry loop or just be renaming) and do NOT guard every call (needless
  DNS on fixed hosts; risks breaking offline tests that inject `fetchImpl` without a
  `lookup`).
- **D-02:** **Reuse the RSS `getText` guard exactly — do not fork a second guard
  implementation.** Same `assertSafeUrl`, same `node:net` BlockList (RFC1918, CGNAT,
  loopback, link-local incl. `169.254.169.254`, IPv6 ULA/link-local, NAT64,
  IPv4-mapped canonicalization), same per-hop redirect re-validation
  (`redirect: "manual"`, max 5 hops), same http+https scheme allowlist, same optional
  operator allowlist knob.
- **D-03:** **Add a content-type / JSON-safety check before `JSON.parse`.** A
  login-required Discourse or locked-down Mastodon instance can return HTTP 200 with
  an HTML login page; without this check `JSON.parse` crashes. Instead produce a clear
  tool-level "login required / not JSON" error. (This is guard groundwork here; it
  directly satisfies a Phase 7 success criterion.)
- **D-04:** **Reject credentials-in-URL** (`user@host`) on the guarded path.
- **D-05:** **Allow non-default ports** — do NOT force https-only and do NOT reject
  custom ports. Self-hosted forums legitimately run on custom ports; the IP denylist
  (not the port or scheme) is what actually stops the SSRF threat. This keeps the
  guarded path consistent with the RSS guard's existing posture rather than diverging.
- **D-06:** **SEC-03 (DNS-rebinding TOCTOU residual, T-04-06) stays deferred to v2+.**
  Re-affirm the accepted risk in this phase's threat-model pass. Rationale unchanged:
  local, single-user tool — the only "attacker" is the LLM driving it. IP-pinning via
  an undici custom-lookup dispatcher is NOT implemented this phase. (The guarded-JSON
  refactor still deserves an explicit threat-model note since it touches the v1.0 SSRF
  chokepoint — see Planner note below.)

### Stack Exchange mining (TREND-02)
- **D-07:** Mine the **`no-answers`** set (`/questions/no-answers` — questions with
  literally zero answers), NOT `unanswered` (SE's noisier "no accepted answer + low
  score" heuristic). A high-view zero-answer question is the purest unmet-need signal
  for a blog topic.
- **D-08:** **Rank by `view_count` client-side** — SE has no server-side view sort, so
  the server fetches the tagged no-answer window and orders by `view_count` descending
  before returning. `view_count` fills the contract `score` field.
- **D-09:** **Tag is required**; `site` defaults to `stackoverflow` and is overridable
  via the existing `site` param the suite already supports (matches
  `so_search`/`so_hot_questions`). Unbounded site-wide no-answer mining is noise.
- **D-10:** **`backoff` handling: sleep-within + record-in-output.** Inside a
  multi-fetch tool call, sleep the `backoff` seconds before any follow-up SE request.
  Always surface `backoff` and `quota_remaining` in the envelope so the agent sees
  throttle state. This prevents a self-inflicted throttle violation (which IP-bans ALL
  SE tools) WITHOUT changing the strict no-429-retry policy. When `quota_remaining`
  hits 0, surface the existing "set STACKEXCHANGE_KEY" guidance in the error.

### HN rising (TREND-03)
- **D-11:** Approximate rising with **`search_by_date` + `numericFilters`** (Algolia
  has no rising endpoint), then **re-sort server-side by points/hour velocity**
  (points ÷ age-in-hours) so genuine fast-climbers surface first — not raw points
  (favors older-in-window) and not raw date order (would silently reorder merged
  `mergeRank` results). Document in the tool description that this is an approximation,
  not HN's real front-page algorithm.
- **D-12:** **Defaults: 24h window / ≥10 points**, both agent-overridable params. A
  full day catches cross-timezone climbers; a floor of 10 filters noise without hiding
  early risers.
- **D-13:** **Optional keyword/query param.** `hn_rising(query?)` — with a keyword,
  `search_by_date` is scoped to matching stories ("rising about rust"); without it,
  site-wide rising. Keeps HN consistent with the tag-scoped SE/Dev.to trending tools.

### Dev.to trending (TREND-01)
- **D-14:** **Extend the existing `devto_top` tool** with new params rather than adding
  a 5th tool — top-of-window is what `devto_top` is for; fewer tools to document across
  MCP clients.
- **D-15:** Use an **explicit `mode` enum (`top` | `rising`)** plus `days` (used only
  in `top` mode) and an optional `tag`. Zod enforces `days` as an integer number of
  days (document "7 = top of week, 30 = top of month") and **rejects invalid Dev.to
  API combinations** (`rising` + `days`, and the forbidden `state`/`username` pairs
  from research Pitfall 6). Explicit mode is unambiguous and self-documenting for the
  calling agent; do not infer mode from which params are present.

### Claude's Discretion
- The exact guard posture details (D-02..D-05) were delegated by the user ("you decide
  what is simple and best") — the planner may refine wording/thresholds but the
  substance (reuse RSS guard, content-type check, reject creds-in-URL, allow ports) is
  locked.
- SE tag param naming, Dev.to `mode` vs `sort` field name, and exact `numericFilters`
  string construction for HN are left to the planner/researcher, provided the
  documented semantics above hold.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone research (already written for v1.1 — read first)
- `.planning/research/SUMMARY.md` — v1.1 approach; the guarded-JSON-path gating
  dependency, Phase 1 (this phase) scope, and the "zero new runtime deps" verdict
- `.planning/research/PITFALLS.md` §Pitfall 3 — SSRF gap on user-supplied instance
  URLs reaching `getJson` (the reason SEC-01 exists)
- `.planning/research/PITFALLS.md` §Pitfall 5 — login redirect returns HTML-200
  (the reason for the content-type/JSON-safety check, D-03)
- `.planning/research/PITFALLS.md` §Pitfall 6 — SE `backoff`/quota, Dev.to `top` is
  integer days (not `"week"`), HN has no rising endpoint (D-07..D-15 all derive here)

### SSRF guard + HTTP client (the code being extended)
- `shared/http_client.js` — `assertSafeUrl`, `fetchTextManual`, the triplicated
  `getJson`/`postJson`/`getText` retry/stale loops; SEC-01 extends the guard here
- `.planning/codebase/ARCHITECTURE.md` §"RSS / Untrusted-URL Path", §"Architectural
  Constraints", §Anti-Patterns — how the current guard and fetch chokepoint work
- `.planning/codebase/CONCERNS.md` §"TOCTOU / DNS-rebinding residual" (SEC-03/T-04-06
  context) and §"Triplicated retry/stale loop" (extract a shared retry core is the
  safe way to add `untrustedHost` without forking policy three times)

### Contract + servers being extended
- `shared/contract.js` — frozen item schema (`score` fills `view_count`/points; do not
  add fields), append-only `TYPE` enum, envelope factories + `toolResult`
- `servers/hn/server.js` — `mapHnHit`, Algolia base URL; add `hn_rising` here
- `servers/stackexchange/server.js` — existing `site` param, `so_get_question` double
  fetch (the backoff sleep-within case); add the no-answers mining tool here
- `servers/devto/server.js` — existing `devto_top`; extend with `mode`/`days`/`tag`
- `servers/lemmy/server.js` — instance-parameterized calls to move onto the guarded
  JSON path (`untrustedHost: true`)

### Requirements / roadmap
- `.planning/REQUIREMENTS.md` — SEC-01, TREND-01, TREND-02, TREND-03 (verbatim ACs)
- `.planning/ROADMAP.md` §"Phase 5" — the four success criteria this phase must satisfy

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`assertSafeUrl` + BlockList + `fetchTextManual` (`shared/http_client.js`)** — the
  entire SSRF mechanism already exists for `getText`; SEC-01 is about routing JSON
  through it via an `untrustedHost` flag, not writing a new guard.
- **`buildListEnvelope` / `normalizeItem` / `toolResult` (`shared/contract.js`)** — all
  three trending tools map fields then use these; no envelope hand-rolling.
- **Existing `site` param (Stack Exchange)** and **`devto_top` tool** — extend, don't
  rebuild.
- **`mergeRank` (`shared/rank.js`)** — trending tool ordering must not break branch-free
  merges; this is why HN re-sorts server-side (D-11) rather than passing date order.

### Established Patterns
- **Single fetch chokepoint** — everything through `shared/http_client.js`; the guard
  extension keeps this invariant (all three verbs stay one policy — see the "extract a
  shared retry core" note in CONCERNS.md so `untrustedHost` isn't bolted onto three
  copies).
- **Fixed hosts are module constants; only untrusted input selects a host** — HN/SE/
  Dev.to trending tools keep their fixed API base URLs and call `getJson(url)` with NO
  flag; only Lemmy (and future Discourse/Mastodon) pass `untrustedHost: true`.
- **`TYPE` enum is append-only; `score`/`num_comments` never renamed** — trending
  signals ride existing fields (`score` = views/points), no schema change.

### Integration Points
- `shared/http_client.js` `getJson` signature gains an options object — the one
  shared change other v1.1 phases (7's servers, Lemmy move) depend on. Land it first.
- Offline tests inject `fetchImpl`/`sleep`/`lookup`; the guard extension must keep the
  injectable-lookup + redirect-hop test seams (research Phase 1 note).

</code_context>

<specifics>
## Specific Ideas

- **SE `backoff` never appears in offline fixtures** (it only shows under live load) —
  the plan must **synthesize a fixture** carrying `"backoff": N` and a `quota_remaining: 0`
  fixture to test D-10 (research PITFALLS.md verification checklist).
- **SSRF acceptance test:** instance params resolving to `127.0.0.1` and
  `169.254.169.254` must be rejected on the JSON path (mirror the RSS guard tests).
- **HN "rising" ordering is a documented approximation** — the tool description must
  state points/hour velocity ordering explicitly so a consumer never assumes it's HN's
  real front-page algorithm.
- **Dev.to `top` unit is integer DAYS**, easy to misread as `"week"` — Zod type +
  description must make this unambiguous.

</specifics>

<deferred>
## Deferred Ideas

- **SEC-03 — IP-pinning custom-lookup dispatcher** to close the DNS-rebinding TOCTOU
  residual (T-04-06). Reconsidered during this phase's threat model (per roadmap) and
  **re-deferred to v2+** — accepted risk for a local single-user tool. Do not implement
  this phase.
- **Extract a shared `attemptWithRetry` core** to de-triplicate `getJson`/`postJson`/
  `getText` (CONCERNS.md tech debt). Not required by any phase-5 requirement, but if the
  planner finds adding `untrustedHost` to three copies too error-prone, this is the
  clean way to do it — treat as an enabling refactor, not new scope.

**Planner note (threat model):** the guarded-JSON refactor touches the v1.0 SSRF
chokepoint — the plan should include an explicit (brief) threat-model pass documenting
that SEC-03 was reconsidered and re-accepted, per the roadmap's Phase-5 instruction.

</deferred>

---

*Phase: 5-Guarded JSON Path & Trending Signals*
*Context gathered: 2026-07-10*
