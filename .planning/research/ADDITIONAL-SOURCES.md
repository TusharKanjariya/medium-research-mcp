# Additional Candidate Sources

**Scope of this note:** The existing `docs/ARCHITECTURE.md` §5 already contains a
full stack decision and per-source API/auth matrix, so no general ecosystem
research was run. This note only answers the narrow question you asked: *are
there additional developer-community sources — beyond the ones already
planned — with usable public/keyless APIs that would surface more blog-topic
signal?* Yes, a few. They are recommended as **v2 / later-phase** additions, not
v1 scope.

## Recommended additions (verified keyless public APIs)

| Source | Signal for blogging | Endpoint | Auth | Notes |
|---|---|---|---|---|
| **Discourse (generic)** | Many dev communities run Discourse (Rust, Swift, Elixir, Docker, Meta/JS ecosystems). A single generic fetcher unlocks all of them — a *multiplier* like the RSS fetcher. | `GET /latest.json`, `/categories.json`, `/c/<slug>.json` on any public instance | none for public categories | `score` = topic like/activity count; `num_comments` = posts_count − 1. Rate-limit politely per instance. |
| **Mastodon (fediverse)** | Dev discussion moved here after X closed its free API; hashtag timelines (`#rustlang`, `#webdev`) carry real practitioner signal. | `GET /api/v1/timelines/tag/:hashtag`, `/api/v1/timelines/public` | none if instance allows unauthenticated public reads | 300 req / 5 min public ceiling; pace ≥ 250 ms/instance. `score` = favourites+reblogs; `num_comments` = replies_count. |
| **Reddit (read-only, via RSS)** | Recovers the original Reddit signal you lost — *without* the karma/join gate — by reading public subreddit RSS instead of the OAuth app path. | `https://www.reddit.com/r/<sub>/.rss` (and `/top/.rss`) | none | **No new server needed** — folds into the generic RSS/Atom fetcher (Phase 5). Best ROI of the three. |

## Considered, lower priority

- **Bluesky (AT Protocol)** — public `app.bsky.feed.*` reads are keyless-ish but
  the feed model is more involved; revisit if fediverse coverage proves valuable.
- **GitLab** — trending/issues API exists but overlaps heavily with the planned
  GitHub server; low marginal signal.
- **Excluded (no usable API), per PRD non-goals:** Quora, Indie Hackers, Tildes.

## Implication for the roadmap

1. The **generic RSS/Atom fetcher already planned** should explicitly include
   **subreddit `.rss`** as a documented recipe — it recovers Reddit read-only
   coverage for near-zero extra code and directly addresses the PRD's origin
   problem.
2. **Discourse** and **Mastodon** are the two highest-value *new* servers beyond
   the current list; slot them as v2 (after the v1 sources land), each a
   mechanical copy of the established pattern.

---
*Focused source scan: 2026-07-01. Sources: Discourse API docs (`/latest.json`,
docs.discourse.org); Mastodon timelines API (docs.joinmastodon.org/methods/timelines).*
