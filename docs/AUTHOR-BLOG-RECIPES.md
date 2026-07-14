# Author-Blog Recipes

Worked recipes for the writer-aware RSS tools — `rss_author_posts`,
`rss_tag_posts`, and `rss_substack_archive`. Every recipe here operates on
**normal tool output only** (the frozen contract item: `created_utc`, `title`,
`text`, `tags`, `score`, `num_comments`). No new tool logic, no scraping, no
cookie or subscription workarounds.

---

## ⚠️ Read this first — the honesty caveat

**These recipes see a WINDOW, not a lifetime.** Any conclusion you draw about a
writer's cadence, streak, or series is bounded by what the feed actually returns:

- **`rss_author_posts` (Medium):** at most the **~10 most recent** posts.
- **`rss_author_posts` (Substack):** at most the **~20 most recent** posts.
- **`rss_tag_posts` (Medium, tag feed):** at most the **~10 most recent** tagged
  posts — a recency sample, NOT the full corpus for that tag.
- **`rss_substack_archive`:** the publication's **full archive** when the
  unofficial archive endpoint responds — but it **falls back to the ~20-item RSS
  window** on any failure, in which case `score`/`num_comments` are `null`. So even
  here, treat "full history" as best-effort, not guaranteed.

**Never read a windowed feed as lifetime history.** A Medium feed showing 10 posts
over two months does NOT mean the author "slowed down" or "only wrote 10 posts" —
it means the feed only carries 10. Always ground a cadence claim in the actual
`count` and the `created_utc` range you received, and say so out loud (e.g.
"across the 10 posts currently in the feed…").

**Text is teaser-quality.** Paywalled Substack posts and Medium member-only
stories return an **abstract/teaser**, not the full body. Such items carry the
literal tag **`preview-only`** in `tags[]`. Treat their `text` as a lead-in only
— it is not the article, and dedup/clustering on it is inherently weaker.

---

## Recipe 1 — Posting cadence

**Goal:** describe how often a writer publishes, honestly bounded to the window.

**Inputs used:** `created_utc` only.

**Steps:**

1. Call `rss_author_posts(author)` (or `rss_substack_archive(publication)` for a
   Substack writer's fuller history).
2. Keep items with a non-null `created_utc`; drop nulls (an unparseable feed date
   normalizes to `null` — it is not a "post with no date", just an unknown one).
3. Sort ascending by `created_utc`.
4. Compute inter-post gaps (difference between consecutive timestamps). The
   median gap is a more robust "typical cadence" than the mean (one long hiatus
   skews the mean).
5. Report the cadence **with the window stated**: "Across the N posts in the feed
   (oldest `created_utc` → newest `created_utc`), the median gap is ~X days."

**Honesty rules for this recipe:**

- A windowed feed **cannot show a slowdown or a lifetime rate.** If the oldest
  item in a 10-post Medium feed is only three weeks old, you are looking at three
  weeks of a prolific writer — not their career. Do not extrapolate.
- For a Substack writer where history matters, prefer **`rss_substack_archive`**
  — it reaches older posts than the ~20-item RSS window (when the archive endpoint
  is up). If it fell back to the RSS window, the same ~20-item caveat applies.
- If `count` is small (e.g. 1–2 dated items), report the gap as *insufficient
  data*, not a cadence.

---

## Recipe 2 — Series / follow-up detection

**Goal:** spot multi-part series and follow-up posts within the returned set.

**Inputs used:** `title` (primary signal) + `text` teaser (secondary). Optionally
`tags`.

**Steps:**

1. Call `rss_author_posts(author)`, `rss_tag_posts(tag)`, or
   `rss_substack_archive(publication)`.
2. Cluster candidates by `title` similarity first — series are usually explicit in
   the title:
   - Numbered parts: "Part 1", "Part 2", "(1/3)", "#2".
   - Shared prefixes/suffixes: "Building X: …", "… — a deep dive".
   - "Follow-up", "Revisited", "Update", "continued".
3. Use the `text` teaser only as a **weak tiebreaker** (shared vocabulary,
   back-references like "in my last post"). Because paid bodies are truncated,
   **titles carry most of the signal** — do not rely on `text` similarity for
   items tagged `preview-only`.
4. Order each detected cluster by `created_utc` to establish part order and
   identify the latest follow-up.

**Honesty rules for this recipe:**

- **Titles carry most of the signal**; teaser text is truncated for paid content,
  so a "no follow-up found" result may just mean the earlier parts are outside the
  window or their bodies were teasers.
- A series can straddle the window boundary — parts you cannot see are not
  evidence of absence. Say "within the returned N posts" when reporting a series.
- Do not treat `preview-only` items' teaser overlap as strong evidence; weight the
  title match higher for them.

---

## Boundaries (what these recipes will NOT do)

- **No scraping.** Only the keyless feed/archive endpoints the tools already call.
- **No cookie / subscription / paywall workarounds.** Paywalled bodies stay
  teaser-quality and stay tagged `preview-only`; that is by design.
- **No new contract fields.** Recipes read only `created_utc`, `title`, `text`,
  `tags` (including `preview-only`), `score`, and `num_comments`. `score` and
  `num_comments` are populated only by `rss_substack_archive` on the archive path
  (reactions → `score`, comments → `num_comments`); on every RSS-window result
  they are `null`, which is contract-legal — do not treat `null` as `0`.
- **No vector dedup index.** Series detection here is a lightweight
  title-first heuristic over the returned set, not a persistent similarity store.
