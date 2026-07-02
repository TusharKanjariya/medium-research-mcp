---
phase: 02-keyless-source-breadth
plan: 01
subsystem: source-servers
tags: [stackexchange, mcp-server, keyless, output-contract]
requires:
  - shared/contract.js
  - shared/http_client.js
  - shared/credentials.js (stackExchangeParams)
provides:
  - servers/stackexchange/server.js (so_hot_questions, so_search, so_get_question)
  - mapSeQuestion, mapSeDetail (exported field-map helpers)
  - servers/stackexchange/manifest.json (sensitive stackexchange_key scaffold)
affects:
  - test/ (new stackexchange suite + fixtures)
tech-stack:
  added: []
  patterns:
    - copy-the-HN-folder source-server pattern proven on the most parameterized keyless source
    - filter=withbody on every SE call; text = body_markdown ?? body (HTML stripped downstream)
    - epoch-seconds -> ISO conversion via new Date(s*1000).toISOString()
key-files:
  created:
    - servers/stackexchange/server.js
    - servers/stackexchange/manifest.json
    - test/stackexchange.test.js
    - test/fixtures/stackexchange-list.json
    - test/fixtures/stackexchange-detail.json
    - test/fixtures/stackexchange-answers.json
  modified: []
decisions:
  - "Map text from `body_markdown ?? body`: the built-in `withbody` filter returns rendered HTML `body`, NOT `body_markdown` (RESEARCH Assumption A1 corrected against live API). The shared normalizeItem strips HTML downstream, so `text` lands as clean plain text either way — no custom filter hash needed."
metrics:
  duration: ~1 min execution (fixtures + 2 tasks)
  completed: 2026-07-02
  tasks: 2
  files: 6
  tests: 12 new (76 total, all pass)
status: complete
---

# Phase 02 Plan 01: Stack Exchange Source Server Summary

Delivered the Stack Exchange source server (SRC-01) — a network-wide SE API 2.3 wrapper exposing `so_hot_questions`, `so_search`, `so_get_question`, mechanically copied from the Phase 1 HN template, with optional `STACKEXCHANGE_KEY` degrading to keyless and `filter=withbody` guaranteeing populated `text`.

## What was built

- **`servers/stackexchange/server.js`** — three fixed D-02 tools over `https://api.stackexchange.com/2.3`. `site` defaults to `stackoverflow` and is a free passthrough (D-03); `sort` defaults to `hot`, overridable to votes/week/month/activity (D-07). All HTTP goes through `getJson`; the optional key is attached only when present via `stackExchangeParams()` (D-04/CRED-04). Exported field-map helpers `mapSeQuestion` and `mapSeDetail`.
- **`servers/stackexchange/manifest.json`** — `.mcpb` scaffold with a single `stackexchange_key` user_config field (`sensitive: true`, `required: false`) wired into `mcp_config.env`. No `build-mcpb.sh` (PKG-01 deferred, mirroring HN).
- **`test/stackexchange.test.js` + 3 fixtures** — 12 offline `node:test` units over real `filter=withbody` payloads: field map, epoch-seconds->ISO (Pitfall 3), body-present `text` (A1), HTML strip, answers->comments[], both envelopes parse the contract schema, registration smoke.

## Verification

- `node --test test/stackexchange.test.js` → 12/12 pass; full suite `node --test` → 76/76 pass (no regression).
- Non-comment source contains no `fetch(` and no `process.env`; `filter=withbody` present on every SE call.
- Three tools register with the fixed D-02 names, each declaring an `outputSchema`.
- Universal Server Bar (docs/server-spec-template.md): tools register/callable, `map*()` unit-tested against real payloads, both envelopes parse (ARCHITECTURE §4), all HTTP via `getJson`, optional key degrades to keyless.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `text` mapped from `body`, not `body_markdown`**
- **Found during:** Fixture capture (before Task 1).
- **Issue:** RESEARCH Assumption A1 and the plan `<behavior>` block specified `text = body_markdown ?? null`, but the live SE 2.3 built-in `withbody` filter returns the rendered HTML field `body`, not `body_markdown` (verified: `has body: true, has body_markdown: false`). Following the plan literally would have left `text` silently null on every item — the exact failure Pitfall 2 warns against.
- **Fix:** Map `text: q.body_markdown ?? q.body ?? null` (and the same for answers). `body_markdown` is preferred if a future custom filter supplies it; otherwise `body` is used. Since the shared `normalizeItem` runs `stripHtml()` on `text`, the HTML `body` is cleaned to plain text downstream — no custom filter hash required, and the "text populated" must-have holds.
- **Files modified:** servers/stackexchange/server.js
- **Commit:** 5db5565

## Known Stubs

None.

## Threat Flags

None — the plan's `<threat_model>` covers all security-relevant surface (URL encoding of `id`, `site`/`q` as URLSearchParams values on the fixed host, key read only via credentials.js and marked sensitive).

## Self-Check: PASSED

- Files exist: servers/stackexchange/server.js, servers/stackexchange/manifest.json, test/stackexchange.test.js, test/fixtures/stackexchange-{list,detail,answers}.json — all FOUND.
- Commits exist: 5db5565 (feat), 1e0bc82 (test) — both FOUND in git log.
