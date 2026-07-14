---
phase: 07-universal-sources-parameterization-audit
plan: 04
subsystem: test/parameterization-audit
tags: [sec-02, audit, ssrf, parameterization, static-analysis, allowlist]
requires:
  - servers/*/server.js final sources (07-01 Lemmy param, 07-02 Discourse, 07-03 Mastodon all landed and host-literal-free)
provides:
  - test/parameterization-audit.test.js (SEC-02 static allowlist scan + non-vacuous negative controls)
affects:
  - SEC-02 requirement closed — the enforcement tripwire that fails the moment a hardcoded target is added to any server
tech_stack:
  added: []
  patterns:
    - "String-literal-preserving comment stripper: a char-scanner (code|line|block|sq|dq|tpl states) drops only real comments, because a naive //-strip would decapitate every https:// literal inside a string"
    - "Host-allowlist scan over comment-stripped source: ALLOWED_HOSTS platform bases + ALLOWED_SUFFIXES (.substack.com/.medium.com) + programming.dev default"
    - "URL-embedded @handle guard: flags a hardcoded account in a URL path (medium.com/feed/@user) that the host allowlist alone cannot catch"
    - "Non-vacuous negative control: the same checker functions are run over synthetic violations and asserted to flag them"
key_files:
  created:
    - test/parameterization-audit.test.js
  modified: []
decisions:
  - "SEC-02 @handle threat scoped to URL-embedded handles (account-in-feed-URL), not bare @tokens — because @modelcontextprotocol (imports), @_term/@_href (fast-xml-parser attr prefix), and @ev/@handle (rss error-message documentation) are all legitimate literals; a bare-token scan would false-positive against final source. The real hardcoded-account threat in this suite is an account embedded in a feed/profile URL, which THIS check catches."
  - "your.lemmy.instance allowlisted via a separate PLACEHOLDER_HOSTS set (not ALLOWED_HOSTS) — it is a non-routable documentation placeholder in the Lemmy normalizeInstance error message (`.instance` is not a real TLD), never a fetch target. Documented as an explicit exception, not a platform base."
  - "Comment stripping done with a proper state-machine char-scanner rather than regex — regex comment-stripping was rejected as fragile because it would mistake the // in every https:// string literal for a line comment (the exact fragility 07-RESEARCH warned about). A dedicated stripComments-preserves-URLs unit test pins this load-bearing invariant."
  - "Strings are PRESERVED (only comments stripped) for the host scan — a real hardcoded target lives in a string/template literal, so stripping strings would make the scan vacuous."
metrics:
  tasks_completed: 1
  files_created: 1
  files_modified: 0
  tests: 6 (audit), 412 (full suite) — all pass
  duration: 18min
  completed: 2026-07-14
status: complete
---

# Phase 7 Plan 04: SEC-02 Parameterization Audit Summary

A committed static source-scanning test (`test/parameterization-audit.test.js`) that enforces the suite's "no hardcoded targets — a target is always a tool parameter" property across every `servers/*/server.js`, with non-vacuous negative controls proving it fails the moment a hardcoded forum host or account-feed handle is introduced.

## What Was Built

A single `node:test` file (zero dependencies, zero network, `node:fs` only) implementing the SEC-02 audit (D-16):

- **Scan scope:** every `servers/*/server.js` discovered via `readdirSync` (the rss `resolve*` feed-URL helpers live inside `servers/rss/server.js`, so scanning that file covers them). `shared/` is NOT scanned — its `isMediumHost`/SSRF DENY lists are security infrastructure, not per-source targets. A dedicated scope test asserts the scan includes discourse/mastodon/lemmy/rss and that no scanned path is under `shared/`.
- **Allowlist:** `ALLOWED_HOSTS` = the 12 fixed platform bases (hn.algolia.com, news.ycombinator.com, api.stackexchange.com, dev.to, medium.com, lobste.rs, libraries.io, api.producthunt.com, api.github.com, www.youtube.com, www.reddit.com, programming.dev). `ALLOWED_SUFFIXES` = `.substack.com` / `.medium.com` (rss resolves user publications to these platform hosts — the subdomain is the user slug but the platform suffix is fixed). `PLACEHOLDER_HOSTS` = `your.lemmy.instance` (a non-routable documentation placeholder in Lemmy's error message).
- **Check 1 — host allowlist:** every `https?://<host>` literal in the comment-stripped source must be allowlisted; otherwise the host is reported and the test fails. This catches a hardcoded community instance / named-blog feed.
- **Check 2 — URL-embedded @handle:** no URL literal may embed a hardcoded account in its path (e.g. `https://medium.com/feed/@someuser`). The host `medium.com` is allowlisted, so check 1 cannot catch this — check 2 is that guard. The real suite builds every handle segment via `encodeURIComponent(user)` (`.../feed/@${…}`), so the char after the literal `@` is `$`, never a word char, and nothing is flagged.
- **Comment stripper:** a state-machine char-scanner (`code | line | block | sq | dq | tpl`) that drops only real comments while preserving string/template contents and honoring escapes. This is load-bearing — a naive `//.*$` regex would treat the `//` in every `https://` string literal as a line comment and blind the host scan. A dedicated unit test pins that `stripComments` keeps a `https://` string URL while removing a trailing line comment (and its host).

### Non-vacuous negative controls (the anti-vacuity guarantee)

Two negative-control tests run the **same** `findForbiddenHosts` / `findEmbeddedHandles` functions over synthetic violations:

- A hardcoded `https://someforum.example.com/latest.json` → flagged; a mixed snippet proves selectivity (`dev.to` allowed, only `someforum.example.com` reported); a host named only in a comment is NOT flagged (comments are stripped).
- A hardcoded `https://medium.com/feed/@someuser` → NOT flagged by check 1 (medium.com is allowlisted) but flagged by check 2; the parameterized form `@${encodeURIComponent(user)}` is NOT flagged.

## Verification

- `node --test test/parameterization-audit.test.js` → 6/6 pass against the real, final suite (all servers allowlist-clean).
- `node --test` (full suite via `npm test`) → 412/412 pass (6 new + 406 prior), no regressions.
- The audit confirms 07-01/02/03 are host-literal-free as claimed: discourse/mastodon/lemmy servers build their base from `${normalizeInstance(instance)}` and carry no forum/instance host literal.

## Deviations from Plan

None affecting behaviour or scope. Two interpretation notes made during execution and captured as decisions above:

- **[Rule 2 — audit-correctness] `@handle` check scoped to URL-embedded handles.** The plan/must-haves say "no literal @handle remains in scanned code." Taken literally against the final source, `@modelcontextprotocol` (import specifiers), `@_term`/`@_href`/`@_rel` (fast-xml-parser attribute prefix), and `@ev`/`@handle` (rss error-message documentation) are all legitimate literals — a blanket bare-`@` scan would false-positive and could never pass. The meaningful SEC-02 threat (a hardcoded *account* target) manifests as an account embedded in a feed/profile URL, which the URL-embedded check catches precisely while remaining green against real source. This is the correct reading of "no real @ usage is hardcoded — it's built via encodeURIComponent."
- **[Rule 3 — placeholder host] `your.lemmy.instance` allowlisted as a documented placeholder.** 07-01 introduced this non-routable example in Lemmy's `normalizeInstance` error string (`e.g. https://your.lemmy.instance`) after the 07-RESEARCH host inventory was taken. It is not a hardcoded target (it is never fetched; `.instance` is not a TLD), so it is admitted via an explicit, clearly-commented `PLACEHOLDER_HOSTS` set rather than by editing the server (per the no-source-edits directive). This does not weaken the guard against real forum/instance/account/feed literals.

No `server.js` was modified. The audit passes against the real suite, so no host-literal findings needed to be surfaced.

## Known Stubs

None. The test exercises real source files and real checker logic; the negative controls guarantee it is not a vacuous always-green test.

## Self-Check: PASSED

- File exists: `test/parameterization-audit.test.js` — present.
- Commit exists: `cafa434` (test) — present in git log.
- `node --test test/parameterization-audit.test.js` exits 0 (6 pass); full suite 412 pass.
