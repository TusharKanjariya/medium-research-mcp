---
phase: 07-universal-sources-parameterization-audit
plan: 03
subsystem: servers/mastodon
tags: [mastodon, keyless, ssrf, instance-param, trends, fediverse]
requires:
  - shared/http_client.js getJson({ untrustedHost: true }) guarded path (Phase 5 SEC-01)
  - shared/contract.js TYPE values "status" + "topic" (Phase 7 07-01)
provides:
  - servers/mastodon/server.js (4 keyless tools + map* helpers + normalizeInstance + mapMastodonError)
  - servers/mastodon/manifest.json (keyless scaffold)
  - test/mastodon.test.js + 3 fixtures (offline field-map / SSRF / D-10 / D-11 coverage)
affects:
  - 07-04 SEC-02 parameterization audit (mastodon server.js must contain no host literal — satisfied)
tech_stack:
  added: []
  patterns:
    - "Guarded untrusted-host fetch: every getJson passes { untrustedHost: true } (copied Lemmy/Discourse call shape, not bare HN)"
    - "getJson error-message matching for tool-level UX (getJson exposes no err.status — match /HTTP (401|422)/ and /HTTP 404/)"
    - "Instance base is always ${normalizeInstance(instance)} — no host literal (SEC-02)"
key_files:
  created:
    - servers/mastodon/server.js
    - servers/mastodon/manifest.json
    - test/mastodon.test.js
    - test/fixtures/mastodon-timeline.json
    - test/fixtures/mastodon-trends-tags.json
    - test/fixtures/mastodon-trends-links.json
  modified: []
decisions:
  - "mapMastodonError exported (like 07-02 mapDiscourseError) for offline D-11 unit testing — the handler wraps its own getJson opts so there is no injection seam at the tool boundary"
  - "fetchTrends kept internal (not exported); D-10 404->empty behaviour is proven offline by replicating its /HTTP 404/ catch against getJson directly"
  - "score defaults to 0 (favourites ?? 0 + reblogs ?? 0), not null — matches the RESEARCH field map; contract permits a numeric 0"
metrics:
  tasks_completed: 3
  files_created: 6
  files_modified: 0
  tests: 26 (mastodon), 406 (full suite) — all pass
  duration: 14min
  completed: 2026-07-14
status: complete
---

# Phase 7 Plan 03: Keyless Mastodon Server Summary

Keyless Mastodon MCP server delivering public + hashtag timelines and trending tags + links from any instance over the Phase 5 guarded JSON path, with instance and hashtag as tool parameters, graceful trends-empty, and a clear per-endpoint lockdown UX.

## What Was Built

Four single-responsibility tools (D-06) in `servers/mastodon/server.js`, all keyless:

- `mastodon_public(instance, limit?)` → `/api/v1/timelines/public`
- `mastodon_hashtag(instance, tag, limit?)` → `/api/v1/timelines/tag/:tag` (description documents federation sparsity, D-12)
- `mastodon_trending_tags(instance)` → `/api/v1/trends/tags`
- `mastodon_trending_links(instance)` → `/api/v1/trends/links`

Field maps (07-RESEARCH authority): `mapMastodonStatus` (type `status`, score = `favourites_count + reblogs_count`, num_comments = `replies_count`, author = `account.acct`, tags = `tags[].name`, text = `content`) with **boost handling** — when `status.reblog` is non-null the mapper reads the reblog so a boost surfaces the original post rather than a blank wrapper (Pitfall 4). `mapTrendingTag` (type `topic`, title `#name`, score = summed string `history[].uses` via `Number`). `mapTrendingLink` (type `article`, author `author_name || provider_name`, text = card description).

- **limit clamp (D-08):** `z.number().int().min(1).max(40)` on both timeline tools — a `limit=100` is rejected by zod before any fetch (Mastodon silently server-clamps at 40, so this keeps the envelope count honest).
- **D-11 lockdown UX:** `mapMastodonError` maps a caught `/HTTP (401|422)/` to `Instance <base> disallows anonymous reads — try another instance (this tool is keyless).`; other errors propagate. Applied per tool call (lockdown is per-endpoint — mastodon.social's public timeline is 422 while its trends are anon-OK).
- **D-10 trends-disabled → empty:** internal `fetchTrends` catches only `/HTTP 404/` and returns `[]` (envelope `count:0`, no throw); a 200 `[]` yields `count:0` naturally; other errors propagate.
- **SSRF (SEC-01/D-14):** every `getJson` call passes `{ untrustedHost: true }` — no bare `getJson(url)`.
- **SEC-02:** the instance base is always `${normalizeInstance(instance)}` — verified: **zero** `http(s)://host` literals in `server.js` (satisfies the 07-04 audit).

`servers/mastodon/manifest.json` is a keyless scaffold mirroring the suite convention (no `user_config`, no `mcp_config.env`).

## Verification

- `node --test test/mastodon.test.js` → 26/26 pass.
- `node --test` (full suite) → 406/406 pass (no regressions).
- Registration check: exactly `mastodon_hashtag, mastodon_public, mastodon_trending_links, mastodon_trending_tags`, each with an `outputSchema`.
- SEC-02 host-literal scan of `server.js` → empty.

Offline test coverage: status field map + boost/reblog case + minimal-fields defaults; HTML-strip-through-contract; trending tag/link maps incl. string-`uses` summing and `provider_name` fallback; `ListEnvelopeSchema` conformance; 4-tool registration + outputSchema; D-08 limit>40 rejection with a readable message; D-11 401/422 mapping (unit + guarded-path 422 terminal); D-10 trends 200-`[]` and 404 → `count:0`; SEC-01 guarded-path SSRF reject (private/loopback/metadata); SEC-02 source scan.

### Deferred (manual live smoke)

Live multi-instance smoke is un-fixture-able and documented as a manual step (07-RESEARCH §Multi-instance smoke lists): call `mastodon_public` against ≥3 anon-OK instances (fosstodon.org, mstdn.social, mas.to, hachyderm.io, …) for 200 JSON; against a locked-down instance (mastodon.social public timeline → 422) to confirm the D-11 error; `mastodon_trending_tags` against a trends-enabled instance. Instance policy drifts (Mastodon lockdown is spreading) — re-probe at run time.

## Deviations from Plan

None affecting behaviour. Two structural notes:

- Task 1 is marked `tdd="true"` but the plan intentionally places the full offline test file in Task 3 (server-first ordering with an inline registration verify on Task 1). Executed in the plan's task order; the automated registration check on Task 1 passed before the comprehensive Task 3 suite landed.
- Added an exported `mapMastodonError` helper (not in the plan's named export list but consistent with 07-02's exported `mapDiscourseError`) so the D-11 mapping is unit-testable offline. Kept `fetchTrends` internal; its D-10 behaviour is proven by replicating the `/HTTP 404/` catch against `getJson` directly in the test.

## Known Stubs

None. All four tools are fully wired to live endpoints through the shared guarded fetch path; no placeholder data.

## Self-Check: PASSED

- Files exist: servers/mastodon/server.js, servers/mastodon/manifest.json, test/mastodon.test.js, test/fixtures/mastodon-{timeline,trends-tags,trends-links}.json — all present.
- Commits exist: 491fffc (server), e533bfa (manifest), 5115ad1 (tests+fixtures).
- `node --test test/mastodon.test.js` exits 0 (26 pass); full suite 406 pass.
