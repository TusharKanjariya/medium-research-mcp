---
status: testing
phase: 09-aggregator-one-shot-installer
source: [09-VERIFICATION.md]
started: "2026-07-23T05:50:55Z"
updated: "2026-07-23T05:50:55Z"
---

## Current Test

number: 1
name: Interactive one-shot installer smoke (`npx medium-research-mcp install`)
expected: |
  Wizard lists detected clients, prints the plaintext-vs-.mcpb-keychain warning,
  writes a timestamped .bak-* backup, merges the medium-research-all entry
  non-destructively, and the skipped key (LIBRARIESIO_KEY) is absent while the
  provided key (PRODUCTHUNT_TOKEN) is present in the written env block.
awaiting: user response

## Tests

### 1. Interactive installer wizard (real TTY)
expected: |
  Run `npx medium-research-mcp install` interactively against a machine with at
  least one of Claude Desktop / Cursor / Codex / OpenCode installed. Walk the wizard:
  pick a client, press Enter to skip LIBRARIESIO_KEY, paste a value for
  PRODUCTHUNT_TOKEN, confirm. Expect: detected clients listed; plaintext-vs-.mcpb
  keychain warning shown; timestamped .bak-* backup written; medium-research-all
  entry merged non-destructively; skipped key omitted, provided key present.
result: [pending]

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
