---
phase: 08-universal-distribution
plan: 02
subsystem: infra
tags: [mcpb, manifest, packaging, credentials, node-test]

requires:
  - phase: 02-08 (all source servers)
    provides: 11 servers/*/manifest.json scaffolds + shared/credentials.js ENV_VAR map
provides:
  - 11 manifests retargeted to Option-A staged path servers/<name>/server.js at v1.1.0
  - hn manifest credential over-declaration removed (user_config {}, no env block)
  - test/manifest-consistency.test.js — the D-05 manifest⇄credentials contract gate
affects: [08-01 build-mcpb staging, 08-03 keychain smoke, PKG-01, PKG-02]

tech-stack:
  added: []
  patterns:
    - "D-05 consistency test: manifest env ref ⇒ ENV_VAR (read from credentials.js source) AND read by that server; direction-safe (REDDIT_* maps to no server)"

key-files:
  created:
    - test/manifest-consistency.test.js
  modified:
    - servers/hn/manifest.json
    - servers/stackexchange/manifest.json
    - servers/lobsters/manifest.json
    - servers/lemmy/manifest.json
    - servers/devto/manifest.json
    - servers/github/manifest.json
    - servers/librariesio/manifest.json
    - servers/producthunt/manifest.json
    - servers/rss/manifest.json
    - servers/discourse/manifest.json
    - servers/mastodon/manifest.json

key-decisions:
  - "manifest_version stays 0.3 (RESEARCH-verified current MCPB spec) — not bumped"
  - "Consistency test asserts manifest_version + env-consistency ONLY, not entry_point — keeps the RED isolated to hn's over-declaration (all 11 still had old entry_point pre-cleanup)"
  - "import-match keyed by ENVNAME→accessor map; an env with no known accessor (hn's REDDIT_CLIENT_SECRET) fails as over-declared"

patterns-established:
  - "ENV var names are read from shared/credentials.js source text (single source of truth), never re-listed in the test"

requirements-completed: [PKG-01]

coverage:
  - id: D1
    description: "D-05 manifest⇄credentials consistency test — every manifest env ref maps to an ENV_VAR and is read by its server; non-vacuous negative control"
    requirement: PKG-01
    verification:
      - kind: unit
        ref: "test/manifest-consistency.test.js"
        status: pass
    human_judgment: false
  - id: D2
    description: "11 manifests staging-ready: v1.1.0, manifest_version 0.3, entry_point/args → servers/<name>/server.js; hn user_config {} + no env; credentialed fields keep sensitive:true"
    requirement: PKG-01
    verification:
      - kind: unit
        ref: "test/manifest-consistency.test.js (manifest_version + env consistency)"
        status: pass
      - kind: other
        ref: "node -e structural check (version/manifest_version/entry_point/args/hn-empty/lib+ph sensitive+required) prints OK"
        status: pass
    human_judgment: false

duration: 9min
completed: 2026-07-16
status: complete
---

# Phase 8 Plan 02: Manifest Retarget + D-05 Consistency Test Summary

**All 11 `.mcpb` manifests retargeted to the Option-A staged path (`servers/<name>/server.js`) at v1.1.0 with hn's credential over-declaration removed, locked by a new manifest⇄credentials consistency test.**

## Performance

- **Duration:** ~9 min
- **Completed:** 2026-07-16
- **Tasks:** 2 (TDD: RED test → GREEN cleanup)
- **Files modified:** 12 (1 created, 11 manifests)

## Accomplishments
- New `test/manifest-consistency.test.js` (D-05): asserts every manifest `server.mcp_config.env` ref resolves to a `${user_config.<field>}`, that ENVNAME is an ENV_VAR present in `shared/credentials.js` source, and that the owning `server.js` actually reads it — with a non-vacuous negative control.
- All 11 manifests bumped `1.0.0 → 1.1.0`; `manifest_version` deliberately kept at `"0.3"`.
- `entry_point` and `mcp_config.args` retargeted from `server.js` → `servers/<name>/server.js` so `../../shared` resolves from the staged layout (PKG-01 part A).
- hn manifest cleaned: `user_config` → `{}`, `env` block removed (it reads no credentials — dropped the over-declared `reddit_client_secret` + `librariesio_key`).
- Credentialed manifests (github, stackexchange, librariesio, producthunt, lemmy) keep `sensitive:true`; librariesio/producthunt keep their required sensitive field.
- Trimmed the now-false "packing deferred to v2" sentence from every description.
- Full suite green: 430/430.

## Task Commits

1. **Task 1: D-05 consistency test (RED)** - `9801315` (test)
2. **Task 2: retarget + clean all 11 manifests (GREEN)** - `b73f721` (feat)

_TDD: RED commit failed only on hn's over-declaration; GREEN commit turned it and the full suite green._

## Files Created/Modified
- `test/manifest-consistency.test.js` - D-05 consistency gate (created)
- `servers/hn/manifest.json` - user_config {} + env removed, retargeted, v1.1.0
- `servers/{stackexchange,lobsters,lemmy,devto,github,librariesio,producthunt,rss,discourse,mastodon}/manifest.json` - retargeted, v1.1.0, description trimmed

## Decisions Made
- The consistency test intentionally checks `manifest_version` + env-consistency only, NOT `entry_point`. Asserting the retargeted entry_point would have made all 11 fail RED, contradicting the plan's "RED fails only on hn" requirement. The plan's separate `node -e` structural check covers entry_point/args.
- import-match is driven by an ENVNAME→accessor map; an env with no known accessor is treated as over-declared (this is what bites hn's `REDDIT_CLIENT_SECRET`).

## Deviations from Plan

None - plan executed exactly as written. hn's description was rewritten (not just sentence-trimmed) because removing the credential fields made its "the fields below illustrate the pattern" text stale; this is contract-neutral and within the plan's "trim description" discretion.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 11 manifests are staging-ready for the build-mcpb script (08-01) and the keychain smoke (08-03).
- The D-05 gate now fails on any future manifest⇄credentials drift.

---
*Phase: 08-universal-distribution*
*Completed: 2026-07-16*
