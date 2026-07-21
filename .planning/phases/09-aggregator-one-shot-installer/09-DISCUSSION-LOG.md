# Phase 9: Aggregator & One-Shot Installer - Discussion Log

**Date:** 2026-07-20
**Mode:** discuss (default)

Human-reference audit trail. Not consumed by downstream agents (see CONTEXT.md for the canonical decisions).

## Areas Discussed

### 1. Aggregator tool surface
**Options presented:** All tools every source (recommended) / All tools but keyed sources opt-in / Curated core set
**Selected:** All tools, every source — unfiltered ~44-tool union.
**Notes:** Prefixes prevent collisions; full parity with the 11 servers; client handles list length. → D-01, D-02.

### 2. Installer UX
**Options presented:** Interactive wizard (recommended) / Flag-driven minimal prompts / Auto-detect and write confirm once
**Selected:** Interactive wizard — detect, show, ask which client, prompt keys (skippable), confirm, write; flags available for CI.
**Notes:** Best for first-time discoverability; 4 documented clients. → D-03, D-04.

### 3. Key handling
**Options presented:** Prompt/write-plaintext/warn (recommended) / Scaffold empty never write secrets / Prompt + env-var reference
**Selected:** Prompt, write plaintext, warn — matches the all-at-once goal; one-line notice about plaintext vs .mcpb keychain.
**Notes:** Accepted plaintext trade-off; skipping leaves keyless fail-loud behavior. → D-05.

### 4. Install shape
**Options presented:** Aggregator by default 11 via flag (recommended) / 11 separate by default aggregator via flag / Ask at runtime
**Selected:** Aggregator entry by default; `--separate` writes the 11. Non-destructive merge, backup before write.
**Notes:** The single-entry default is the point of the milestone. → D-06.

## Deferred Ideas
- `.mcpb` aggregator bundle (already in ROADMAP Future).
- Auto-update notification (out of v1.2).
- Installer post-write spawn-test (nice-to-have, planner's discretion).

## Claude's Discretion
- Aggregator merge mechanism (register-tools refactor vs registry reuse).
- Installer OS config-path discovery, backup naming, prompt rendering.
