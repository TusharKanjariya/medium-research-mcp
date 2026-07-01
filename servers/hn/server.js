// servers/hn/server.js — Hacker News reference server (FOUND-04, OUT-01).
//
// This is the TEMPLATE every later source server copies. It proves the shared
// contract end-to-end: adding a source reduces to writing the field map
// (mapHnHit / mapHnItem) + URL construction. Everything reusable — defaulting,
// HTML stripping, envelope assembly, the dual content/structuredContent return,
// caching/retry/stale — lives in the shared modules and is imported here.
//
// Source: Algolia HN Search API (https://hn.algolia.com/api/v1), no auth.
// Field map verified against live responses (see 01-RESEARCH.md):
//   objectID->id, points->score, num_comments->num_comments, author->author,
//   created_at->created_utc, url->url, _tags->type, story_text/comment_text->text.
// Job stories carry null points/num_comments -> null score/num_comments.

// --- HN-only field mapping (the ONLY HN-specific logic) ------------------

// _tags values worth surfacing to the reader; internal author_*/story_* noise
// is dropped (01-RESEARCH Open Question 3, planner discretion).
const MEANINGFUL_TAGS = new Set(["story", "front_page", "ask_hn", "show_hn"]);

// Derive the contract `type` enum (ARCHITECTURE §4) from a search hit's _tags.
// ask_hn->ask, show_hn->show, job->job, comment->comment, poll/pollopt/else->story.
function hnHitType(tags = []) {
  const t = new Set(tags);
  if (t.has("ask_hn")) return "ask";
  if (t.has("show_hn")) return "show";
  if (t.has("job")) return "job";
  if (t.has("comment")) return "comment";
  return "story"; // poll/pollopt and anything else fall back to story
}

// Derive the contract `type` from a /items/:id detail node's own `type` field
// (the detail endpoint has no _tags). Ask/Show detail nodes report type "story".
function hnDetailType(type) {
  if (type === "comment") return "comment";
  if (type === "job") return "job";
  return "story"; // story / poll / pollopt / unknown -> story
}

// created_utc: search hits carry an ISO-8601 `created_at`; detail nodes carry an
// epoch `created_at_i`. Prefer the ISO string, else derive from the epoch.
function toIso(source) {
  if (source.created_at != null) return source.created_at;
  if (source.created_at_i != null) {
    return new Date(source.created_at_i * 1000).toISOString();
  }
  return null;
}

const permalink = (id) => `https://news.ycombinator.com/item?id=${id}`;

/**
 * Map one Algolia /search hit onto a raw contract item (pre-normalize). The
 * returned object is fed through buildListEnvelope -> normalizeItem, which
 * applies defaulting and HTML-stripping — so this function is pure field
 * mapping and constructs no derived text.
 */
export function mapHnHit(hit) {
  return {
    id: String(hit.objectID),
    type: hnHitType(hit._tags),
    title: hit.title ?? "",
    author: hit.author ?? null,
    score: hit.points ?? null, // null for job stories (verified)
    num_comments: hit.num_comments ?? null, // null for job stories (verified)
    created_utc: toIso(hit),
    url: hit.url ?? null,
    permalink: permalink(hit.objectID),
    tags: (hit._tags ?? []).filter((t) => MEANINGFUL_TAGS.has(t)),
    text: hit.story_text ?? hit.comment_text ?? null,
  };
}

/**
 * Map one Algolia /items/:id detail node onto { item, comments }. Only the
 * TOP-LEVEL children become comments (the nested reply tree is intentionally
 * flattened away); text stripping happens downstream in buildDetailEnvelope.
 */
export function mapHnItem(detail) {
  const item = {
    id: String(detail.id),
    type: hnDetailType(detail.type),
    title: detail.title ?? "",
    author: detail.author ?? null,
    score: detail.points ?? null,
    num_comments: detail.num_comments ?? null,
    created_utc: toIso(detail),
    url: detail.url ?? null,
    permalink: permalink(detail.id),
    tags: [],
    text: detail.text ?? null,
  };
  const comments = (detail.children ?? []).map((c) => ({
    id: String(c.id),
    author: c.author ?? null,
    text: c.text ?? null,
  }));
  return { item, comments };
}
