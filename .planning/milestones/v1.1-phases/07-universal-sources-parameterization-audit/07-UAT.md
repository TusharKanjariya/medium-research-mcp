---
status: resolved
phase: 07-universal-sources-parameterization-audit
source: [07-VERIFICATION.md]
started: 2026-07-14T09:30:00Z
updated: 2026-07-14T09:45:00Z
---

## Current Test

number: 2
name: Mastodon live multi-instance smoke
expected: |
  Anon-OK instance returns public/hashtag timelines + trends; a locked-down
  instance yields a clear tool error (not a crash); per-endpoint lockdown handled.
awaiting: none — complete

## Tests

### 1. Discourse live multi-instance smoke
expected: Point the Discourse tools at ≥3 real instances incl. one login-required; public instances return latest/top/topic-detail in the contract; a login-required instance yields a clear tool-level error, not a crash.
result: passed
evidence: |
  Live 2026-07-14:
  - meta.discourse.org: discourse_latest → 3 topics (type:topic, score=like_count 435/0/8,
    num_comments=reply_count 5/0/0, created_utc); discourse_top(weekly) → 2; discourse_topic(1)
    → detail item + comments. Normalized contract, instance is a param.
  - community.monday.com (HTML-200 login page) AND connect.mozilla.org (403) → both mapped to
    the clear tool error "…requires login… only public instances are supported" via the Phase 5
    content-type gate — no JSON.parse crash. (Real handler names the instance in the message.)

### 2. Mastodon live multi-instance smoke
expected: Anon-OK instance returns public + hashtag timelines and trending tags/links in the contract; a locked-down (401/422) instance yields a clear tool error; trends-disabled returns empty, never error.
result: passed
evidence: |
  Live 2026-07-14:
  - fosstodon.org (anon-OK): mastodon_public → 3 statuses (type:status, score=favourites+reblogs,
    num_comments=replies_count); mastodon_hashtag(introduction) → 2 (score 4/2, num_comments 1/0);
    mastodon_trending_tags → 4 (type:topic, title "#name", score=Σuses 85/88/59/19);
    mastodon_trending_links → 2 (type:article, score 206/108).
  - mastodon.social (locked-down): public timeline → clear tool error "disallows anonymous reads —
    try another instance" (the research-corrected 422), NOT a crash; AND its trending_tags → OK
    count=3, confirming the per-endpoint lockdown live (public locked, trends open).
  - Trends-disabled → empty envelope (count:0, no throw) fully covered offline in test/mastodon.test.js.

## Summary

total: 2
passed: 2
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

None — both live multi-instance smokes passed against real public/locked-down Discourse and Mastodon instances; all 5 ROADMAP success criteria confirmed live in addition to the offline 5/5 must-haves and the 418-pass suite.
