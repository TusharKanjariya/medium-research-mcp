---
phase: 07-universal-sources-parameterization-audit
verified: 2026-07-14T00:00:00Z
status: passed
human_verification_resolved: 2026-07-14T09:45:00Z (both live smokes passed — see 07-UAT.md)
score: 5/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Live Discourse multi-instance smoke: call discourse_latest/discourse_top/discourse_topic against ≥3 public instances from 07-RESEARCH §Multi-instance smoke lists; then call discourse_latest against one login-required / Cloudflare-fronted (HTML/403) instance."
    expected: "The 3 public instances return 200 JSON normalized envelopes (type 'topic', score=like_count, num_comments=reply_count, permalink `${base}/t/<slug>/<id>`). The login-required instance yields the D-11 tool-level error ('requires login or is not publicly accessible'), never a JSON.parse crash or contract violation."
    why_human: "Requires live network to real forums whose access policies drift; un-fixture-able. The state transitions are already proven offline with injected 403/HTML-200 responses (test/discourse.test.js), but real-instance confirmation cannot be automated."
  - test: "Live Mastodon multi-instance smoke: call mastodon_public against ≥3 anon-OK instances; call it against a locked-down instance (e.g. mastodon.social public timeline → 422); call mastodon_trending_tags/links against a trends-enabled instance and against a trends-disabled one."
    expected: "Anon-OK instances return 200 JSON status envelopes. The locked-down instance yields the D-11 'disallows anonymous reads' tool-level error (not a crash). Trends-enabled returns items; trends-disabled returns an empty envelope (count:0), never an error. Note lockdown is per-endpoint (mastodon.social's hashtag+trends are anon-OK while its public timeline is 422)."
    why_human: "Requires live network to real Mastodon instances whose per-endpoint policies drift; un-fixture-able. The 401/422→error and 404/[]→empty transitions are proven offline with injected responses (test/mastodon.test.js), but real-instance confirmation cannot be automated."
---

# Phase 7: Universal Sources & Parameterization Audit — Verification Report

**Phase Goal:** Agents can research any public Discourse forum or Mastodon instance chosen at call time, and no account/instance/feed is hardcoded anywhere in the suite.
**Verified:** 2026-07-14T00:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Discourse server points at any public instance URL (tool param) → latest/top/topic in the normalized contract; no host literal | ✓ VERIFIED | `servers/discourse/server.js`: three tools registered (`discourse_latest`, `discourse_top`, `discourse_topic`), `instance: z.string()` param, `base = normalizeInstance(instance)`, no forum-host literal in file. `mapDiscourseTopic` → type "topic", score=`like_count`, num_comments=`reply_count`, permalink `${base}/t/${slug}/${id}`. test/discourse.test.js green. |
| 2 | Mastodon public + hashtag timelines from any instance keylessly, instance + hashtag as params, in the contract | ✓ VERIFIED | `servers/mastodon/server.js`: `mastodon_public(instance, limit?)`, `mastodon_hashtag(instance, tag, limit?)`, no credential imports; `mapMastodonStatus` → type "status", score=favourites+reblogs, num_comments=replies_count, author=account.acct, reblog unwrapping. Tests green. |
| 3 | Mastodon trending tags/links; trends-disabled instance returns empty gracefully, never an error (D-10) | ✓ VERIFIED | `mastodon_trending_tags`/`mastodon_trending_links` registered; `fetchTrends()` catches `/HTTP 404/`→`[]`, a 200 `[]`→count:0. Tests "D-10: trends 404 collapses to empty envelope (no throw)" and "trends 200 empty array yields count:0" pass. |
| 4 | Login-required Discourse / locked-down Mastodon (401/422) yields a clear tool-level error, not a crash/contract violation | ✓ VERIFIED | `mapDiscourseError` maps `/HTTP 40[13]/` + content-type-gate login message → named-instance error; `mapMastodonError` maps `/HTTP (401\|422)/` → lockdown error; WR-02 `mapTimelineStatuses` maps non-array body → same lockdown error (no raw TypeError). Guarded-path 403/422 tests pass. |
| 5 | Parameterization audit passes + non-vacuous; Lemmy instance param overrides env; Bearer host-gated | ✓ VERIFIED | `test/parameterization-audit.test.js` scans `servers/*/server.js` (incl. discourse/mastodon/lemmy/rss ≥9), allowlist of fixed platform bases + suffixes; negative controls flag a planted `someforum.example.com` host and `@someuser` handle. Lemmy `base = normalizeInstance(instance ?? lemmyInstance())`; `resolveLemmyHeaders` gates Bearer via `authInstanceMatches` (host compare, fail-closed). All 7 audit tests + Lemmy host-gate tests pass. |

**Score:** 5/5 truths verified (0 present, behavior-unverified)

### Load-Bearing Invariants

| Invariant | Status | Evidence |
|-----------|--------|----------|
| Every Discourse/Mastodon/Lemmy user-host fetch uses `getJson(url,{untrustedHost:true})`; private/link-local hosts rejected | ✓ VERIFIED | All getJson calls in the three servers carry `untrustedHost: true` (read confirmed). SSRF-reject tests (private IP / loopback / 169.254.169.254 → `/blocked address/`) pass for discourse, mastodon, lemmy. |
| Frozen contract: TYPE gained exactly "topic"+"status", append-only | ✓ VERIFIED | `shared/contract.js` TYPE ends `…"launch", "topic", "status"` — prior twelve unchanged. No renamed/dropped fields. Discourse→topic/like_count/reply_count; Mastodon status→status/favourites+reblogs/replies_count; trending link→article; trending tag→topic. contract.test.js green. |
| No `process.env` outside credentials.js; no direct `fetch()` in servers | ✓ VERIFIED | Grep: only `process.env` hit in servers/ is a comment stating rss reads NO process.env. No `fetch(` calls in servers/ (all route through getJson). |
| Parameterization audit is non-vacuous | ✓ VERIFIED | Negative-control tests plant a hardcoded host and an `@handle` and assert each is flagged; a stripComments unit test pins the https:// preservation invariant. All pass. |
| WR-03 cross-origin credential stripping (defense-in-depth) | ✓ VERIFIED | `shared/http_client.js` `fetchTextManual` tracks `currentInit`; on cross-origin redirect strips `authorization`/`cookie` via `stripSensitiveHeaders` + `sameOrigin` (fail-closed). `SENSITIVE_CROSS_ORIGIN_HEADERS = {authorization, cookie}`. http_client tests green. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `servers/discourse/server.js` | 3 tools + normalizeInstance + maps + D-11 | ✓ VERIFIED | 323 lines; WR-01 CATEGORY_TOKEN validation present; guarded fetch. |
| `servers/mastodon/server.js` | 4 tools + normalizeInstance + maps + D-10/D-11 | ✓ VERIFIED | 382 lines; WR-02 mapTimelineStatuses non-array guard present. |
| `servers/lemmy/server.js` | instance override + host-gated Bearer | ✓ VERIFIED | resolveLemmyHeaders/authInstanceMatches; instance param on all 3 tools. |
| `servers/discourse/manifest.json` | keyless scaffold, no user_config | ✓ VERIFIED (present) | Not source-critical; not re-read (registration + audit pass imply integrity). |
| `servers/mastodon/manifest.json` | keyless scaffold | ✓ VERIFIED (present) | Same as above. |
| `shared/contract.js` | TYPE append | ✓ VERIFIED | topic+status appended. |
| `test/parameterization-audit.test.js` | non-vacuous SEC-02 scan | ✓ VERIFIED | Allowlist + negative controls. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Phase-7 test files (contract, discourse, mastodon, lemmy, audit) | `node --test test/{those}.test.js` | 112 pass / 0 fail | ✓ PASS |
| Full workspace suite | `node --test` | 418 pass / 0 fail | ✓ PASS |
| No direct fetch in servers | grep `\bfetch\(` under servers/ | no matches | ✓ PASS |
| No process.env outside credentials.js | grep under servers/ | 1 comment-only match | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SRC-10 | 07-02 | Research any public Discourse forum by instance URL — latest/top/topic | ✓ SATISFIED | discourse server + tests |
| SRC-11 | 07-03 | Research any Mastodon instance public + hashtag timelines, keyless | ✓ SATISFIED | mastodon server + tests |
| SRC-13 | 07-03 | Trending tags/links; empty results when trends disabled | ✓ SATISFIED | fetchTrends D-10 + tests |
| SEC-02 | 07-01, 07-04 | No hardcoded accounts/instances/feeds — parameterization audit | ✓ SATISFIED | audit test non-vacuous + Lemmy param |

No orphaned requirements: REQUIREMENTS.md maps SRC-10/11/13 + SEC-02 to Phase 7, all claimed by plans. (SEC-01 is Phase 5; its untrustedHost invariant is re-exercised here and holds.)

### Anti-Patterns Found

None. No unreferenced TBD/FIXME/XXX markers in phase-modified files. Empty-return patterns (`return []`) are the intended D-10 trends-disabled path and the `?? []` defensive defaults, not stubs — each is overwritten/validated by real data flow or contract-legal.

### Human Verification Required

Two live multi-instance smoke tests were deliberately deferred by the planners as `<human-check>` items (harvested from 07-02 and 07-03 PLANs). They are un-fixture-able (live network to real instances whose access policies drift). The underlying state transitions (login/lockdown → error, trends-disabled → empty) are already proven offline via injected-response tests, so these are supplementary real-network confirmations, not automatable gaps.

1. **Live Discourse multi-instance smoke** — ≥3 public instances return normalized envelopes; one login-required instance yields the D-11 error, not a crash.
2. **Live Mastodon multi-instance smoke** — ≥3 anon-OK instances return statuses; a locked-down instance (422) yields the D-11 error; trends-enabled returns items, trends-disabled returns count:0.

### Gaps Summary

No gaps. All 5 ROADMAP success criteria are observably true in code, all 5 load-bearing invariants hold, all 4 requirement IDs are satisfied, and the full 418-test suite is green. The 3 code-review warnings (WR-01 category validation, WR-02 non-array timeline guard, WR-03 cross-origin auth stripping) are all present and wired in the codebase with regression tests. Status is `human_needed` solely because of the two deferred live-network smoke tests — automated verification is complete and clean.

---

_Verified: 2026-07-14T00:00:00Z_
_Verifier: Claude (gsd-verifier)_
