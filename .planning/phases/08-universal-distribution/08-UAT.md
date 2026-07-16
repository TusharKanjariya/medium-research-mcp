---
status: testing
phase: 08-universal-distribution
source: [08-VERIFICATION.md]
started: 2026-07-16T12:13:28Z
updated: 2026-07-16T12:13:28Z
---

## Current Test

number: 1
name: Claude Desktop keychain→env injection for the two credentialed bundles (D-04)
expected: |
  Installing dist/medium-research-librariesio.mcpb and dist/medium-research-producthunt.mcpb
  in Claude Desktop, entering a real API key/token when prompted (masked on input), and calling
  one tool from each returns a normalized result — proving the OS-keychain `sensitive` user_config
  value reached the server as its env var (LIBRARIESIO_KEY / PRODUCTHUNT_TOKEN).
awaiting: user response

## Tests

### 1. Credentialed keychain→env delivery (Claude Desktop)
expected: Install dist/medium-research-librariesio.mcpb + dist/medium-research-producthunt.mcpb in Claude Desktop; when prompted, enter a real Libraries.io key / Product Hunt Developer Token (confirm the field is masked); call one tool from each (e.g. librariesio_search, producthunt list). A normal normalized result returns — the keychain-stored secret was injected as LIBRARIESIO_KEY / PRODUCTHUNT_TOKEN. (Server-side path already verified this session; only the live Desktop keychain UI remains.)
result: [pending]

### 2. Required-credential failure UX on the live Desktop/plugin path
expected: Reinstall a credentialed bundle WITHOUT entering the key, then call its tool. A clear "set LIBRARIESIO_KEY" / "set PRODUCTHUNT_TOKEN" error is surfaced (ideally naming the user_config field) — not a crash and not a silent keyless call.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
