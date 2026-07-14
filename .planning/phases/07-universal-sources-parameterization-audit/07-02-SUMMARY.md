---
phase: 07-universal-sources-parameterization-audit
plan: 02
subsystem: discourse-server
tags: [discourse, keyless, instance-param, ssrf, content-type-gate, D-11, SEC-02, SRC-10]
requires:
  - shared/contract.js TYPE value "topic" (appended in 07-01)
  - shared/http_client.js getJson({untrustedHost:true}) SSRF guard + content-type gate (Phase 5)
  - servers/lemmy/server.js guarded fetch call shape (analog)
  - servers/hn/server.js registerTool/map/envelope structure (template)
provides:
  - servers/discourse/server.js — discourse_latest / discourse_top / discourse_topic (keyless)
  - normalizeInstance / mapDiscourseTopic / mapDiscourseDetail / mapDiscourseError exports
  - servers/discourse/manifest.json (keyless scaffold, no user_config)
  - test/discourse.test.js + 3 fixtures (field maps, D-11, SSRF, contract conformance)
affects:
  - 07-04 (SEC-02 parameterization audit) — discourse/server.js is host-literal-free (pass condition)
tech-stack:
  added: []
  patterns:
    - "hn structure + lemmy guarded getJson({untrustedHost:true}) fetch call site"
    - "normalizeInstance (scheme-default https, trailing-slash strip, no host guessing, host-literal-free error)"
    - "D-11 message-string matching (no err.status): /HTTP 40[13]/ and content-type-gate login page -> clear tool error"
    - "category = combined slug/id token -> /c/<slug>/<id>/l/{latest,top}.json (Option 1)"
    - "author resolution via users[] Map with last_poster_username fallback"
    - "SSRF acceptance test via injected lookup on getJson({untrustedHost:true})"
key-files:
  created:
    - servers/discourse/server.js
    - servers/discourse/manifest.json
    - test/discourse.test.js
    - test/fixtures/discourse-latest.json
    - test/fixtures/discourse-topic.json
    - test/fixtures/discourse-login-html.json
  modified: []
decisions:
  - "D-02 Option 1: category is the combined \"slug/id\" token interpolated as /c/<slug>/<id>/l/{latest,top}.json (slug-only routes 301 -> HTML); no /categories.json resolve fetch"
  - "score=like_count, num_comments=reply_count, type=\"topic\"; Discourse's internal post.score is never surfaced"
  - "D-11 wording \"requires login or is not publicly accessible\" as a superset covering both login_required (403 JSON) and Cloudflare-fronted (403 HTML) / HTML-200 gate cases"
  - "Exported mapDiscourseError so the D-11 mapping is unit-testable offline (the handler wraps its own getJson opts — no inject seam at the tool boundary)"
  - "normalizeInstance error carries NO https:// URL literal at all (stricter than Lemmy's placeholder) to keep the 07-04 host-literal scan trivially clean"
metrics:
  tasks_completed: 3
  files_modified: 6
  tests_added: 27
  full_suite: "380 pass / 0 fail"
  completed: 2026-07-14
status: complete
---

# Phase 7 Plan 02: Keyless Discourse Server Summary

Built the keyless Discourse server (SRC-10): three tools — `discourse_latest`, `discourse_top` (by period), `discourse_topic` — that research any public Discourse forum by an untrusted `instance` URL parameter, in the normalized contract, over the Phase 5 guarded JSON path, with clear per-instance login-failure UX (D-11) and no forum-host literal anywhere (SEC-02).

## What was built

- **`servers/discourse/server.js`** — HN structural template (imports, `McpServer`, raw-shape `registerTool` wiring, `buildListEnvelope`/`toolResult` chain, direct-run transport guard) with the Lemmy guarded fetch call site: **every** `getJson` passes `{ untrustedHost: true }`. Exports `normalizeInstance`, `mapDiscourseTopic`, `mapDiscourseDetail`, `mapDiscourseError`, and `server`.
  - `mapDiscourseTopic(topic, usersById, base)` → `id: String(id)`, `type: "topic"`, `score: like_count`, `num_comments: reply_count`, `created_utc: created_at`, `permalink: ${base}/t/${slug}/${id}`, `tags: tags ?? []`, `text: excerpt`, author resolved from a `Map<user_id, username>` built from the response `users[]` (OP poster → users map → `last_poster_username` → null).
  - `mapDiscourseDetail(raw, base)` → item from top-level fields (author = `details.created_by.username`, text = `post_stream.posts[0].cooked`); comments = `post_stream.posts[]` excluding index 0 → `{id, author, text}`. Discourse's internal `post.score` is deliberately ignored.
  - Three tools: `discourse_latest(instance, category?, limit?)`, `discourse_top(instance, period, category?, limit?)`, `discourse_topic(instance, id)`. `period` is a six-value zod enum (`daily|weekly|monthly|quarterly|yearly|all`); `limit` is int 1..50 (default 20) with client-side slice (single page, no deep pagination — D-03). `category` is the combined `"slug/id"` token interpolated as `/c/<slug>/<id>/l/{latest,top}.json` (D-02 Option 1).
  - `mapDiscourseError(err, base)` maps `/HTTP 40[13]/` or the content-type-gate `non-JSON response (login required?)` message to a clear tool-level error naming the instance; every other error propagates unchanged. Matches the message string because `getJson` exposes no `err.status`.
- **`servers/discourse/manifest.json`** — keyless scaffold mirroring `servers/hn/manifest.json` shape with `user_config` and `mcp_config.env` omitted; description states the instance is a per-call parameter and contains no forum host.
- **`test/discourse.test.js` + 3 fixtures** — 27 offline tests: field-map units (incl. author fallback and post.score suppression), HTML-strip-through-contract, contract-schema conformance, registration smoke, period-enum check, `mapDiscourseError` D-11 mapping, guarded-path HTTP 403 + HTML-200 terminal-error (no JSON.parse crash), SSRF rejection (private/loopback/metadata), and a SEC-02 assertion that `server.js` is host-literal-free.

## How to verify

- `node --test test/discourse.test.js` → 27 pass.
- Full suite: `node --test` → 380 pass / 0 fail.
- Registration: `node -e "import('./servers/discourse/server.js').then(m=>console.log(Object.keys(m.server._registeredTools).sort()))"` → `discourse_latest, discourse_top, discourse_topic`.

## Deviations from Plan

**1. [Rule 3 - Testability seam] Exported `mapDiscourseError`**
- **Found during:** Task 3.
- **Issue:** The D-11 mapping lives inside each handler's `catch`, and the handlers build their own `getJson` opts, so there is no injection seam to exercise the exact tool-level login message offline (the plan's Task 3 note calls this out).
- **Fix:** Added `export` to `mapDiscourseError` so the D-11 message mapping is unit-tested directly, alongside the getJson-layer terminal-error tests. No behavior change.
- **Files modified:** servers/discourse/server.js.
- **Commit:** 37f4edb.

**2. [Plan discretion] `normalizeInstance` error carries no URL literal**
- Lemmy's analog error embeds a placeholder host (`https://your.lemmy.instance`). For Discourse the message is `"instance is required (a public Discourse forum base URL)"` — no `https://` literal at all — so the 07-04 host-literal scan of `server.js` finds zero hosts (verified: the SEC-02 test asserts an empty host list).

## Deferred / Manual Items

- **Live multi-instance smoke** (Task 1 human-check): un-fixture-able and instance access drifts. Call `discourse_latest` against ≥3 public instances from 07-RESEARCH (`meta.discourse.org`, `discuss.python.org`, `users.rust-lang.org`, …) and one login-required/HTML instance (`community.monday.com`, `connect.mozilla.org`) to confirm 200-JSON normalized output and the D-11 error (not a crash). Re-probe at run time — Discourse instance policies drift.

## Known Stubs

None. All three tools are fully wired to live Discourse endpoints over the guarded path; there are no hardcoded/empty data sources.

## Self-Check: PASSED

- Created files exist: servers/discourse/server.js, servers/discourse/manifest.json, test/discourse.test.js, test/fixtures/discourse-{latest,topic,login-html}.json — all present.
- Commits exist: 5417621 (server), ce6adb2 (manifest), 37f4edb (tests) — all in `git log`.
