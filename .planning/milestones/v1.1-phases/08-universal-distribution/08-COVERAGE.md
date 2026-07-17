# Phase 08 — API Coverage Matrix

**Context:** Phase 08 (`universal-distribution`) is a **packaging/distribution** phase —
one npx-runnable npm package, 11 `.mcpb` bundles, client-connector docs, and a live
pain-point example sweep. It introduces **no new external data-API integration**: the
11 developer-source HTTP APIs (Hacker News, Stack Exchange, Lobsters, Lemmy, Dev.to,
GitHub, Libraries.io, Product Hunt, RSS, Discourse, Mastodon) were each wired in
phases 01–07 and are unchanged here.

The `verify:pre` api-coverage gate fired on a false positive: the detector matched the
`wiring` + `endpoints` tokens on `08-04-PLAN.md:74`, a `<files_to_read>` line describing
a **research-doc section** ("per-source wiring: exact helper names, endpoints"), not a new
integration. This matrix records that decision explicitly so the gate is satisfied honestly
rather than bypassed.

The surface enumerated below is the **distribution surface** this phase actually owns.

| capability | decision | reason |
|---|---|---|
| npx/npm bin distribution (11 medium-research-<source> bins) | INTEGRATE | |
| .mcpb bundle packaging (@anthropic-ai/mcpb 2.1.2) | INTEGRATE | |
| Claude Desktop keychain to env injection (sensitive user_config) | INTEGRATE | |
| manifest to credentials consistency contract (D-05) | INTEGRATE | |
| manual client-connector docs (Cursor, Windsurf, generic MCP) | INTEGRATE | |
| pain-point example sweep against live source APIs | INTEGRATE | |
| npm registry publish + version tag | OPT-OUT | D-06: publishing is the user's manual release gate, intentionally not automated this phase |
| data-source HTTP APIs (HN, Stack Exchange, GitHub, and 8 more) | OPT-OUT | integrated and covered in phases 01-07; unchanged here — this phase is distribution-only and adds no new data-API surface |
