// shared/contract.js — THE output contract (D-01/D-02, FOUND-03/05, OUT-01/03).
//
// This module is the linchpin of the whole suite: uniform output across 10+
// source servers must be structurally impossible to drift. Every server imports
// these helpers, so adding a source reduces to pure field-mapping into
// normalizeItem(). Do NOT re-implement any of this per server.
//
// Two forms of each schema are exported:
//   - a RAW SHAPE (plain object of Zod fields, e.g. itemShape / listEnvelopeShape)
//     — pass THIS to registerTool as inputSchema/outputSchema. At SDK 1.29.0,
//     registerTool expects a raw shape, NOT z.object(...) (RESEARCH Pitfall 1).
//   - a compiled z.object schema (ItemSchema / ListEnvelopeSchema / ...) for
//     runtime .parse()/validation.
//
// score and num_comments may be null but must NEVER be renamed or dropped
// (CLAUDE.md "DO NOT BREAK"). Nullable fields keep the SDK's structuredContent
// validation from rejecting legitimate nulls (Pitfall 3).

import { z } from "zod";

// Contract item type enum (ARCHITECTURE §4).
//
// APPEND-ONLY: itemShape.type = z.enum(TYPE) and toolResult() validates every
// structuredContent return against it, so removing/reordering a value would
// break existing servers' output validation. New source types are added at the
// END. Phase 3 appended issue (GitHub issues), package (Libraries.io) and launch
// (Product Hunt) — the original nine stay put as the leading prefix.
export const TYPE = [
  "story",
  "ask",
  "show",
  "question",
  "article",
  "repo",
  "comment",
  "post",
  "job",
  "issue", // GitHub issues (Phase 3, SRC-06)
  "package", // Libraries.io packages (Phase 3, SRC-07)
  "launch", // Product Hunt launches (Phase 3, SRC-08)
  "topic", // Discourse topics + Mastodon trending tags (Phase 7, SRC-10/SRC-11, D-05/D-09)
  "status", // Mastodon timeline statuses (Phase 7, SRC-11, D-09)
];

// --- item ----------------------------------------------------------------
// RAW SHAPE — pass to registerTool as inputSchema/outputSchema.
export const itemShape = {
  id: z.string(),
  type: z.enum(TYPE),
  title: z.string(),
  author: z.string().nullable(),
  score: z.number().nullable(), // NEVER rename/drop
  num_comments: z.number().nullable(), // NEVER rename/drop
  created_utc: z.string().nullable(), // ISO-8601
  url: z.string().nullable(),
  permalink: z.string().nullable(),
  tags: z.array(z.string()),
  text: z.string().nullable(),
};
export const ItemSchema = z.object(itemShape);

const CommentSchema = z.object({
  id: z.string(),
  author: z.string().nullable(),
  text: z.string().nullable(),
});

// --- list envelope -------------------------------------------------------
export const listEnvelopeShape = {
  source: z.string(),
  query: z.string().nullable(),
  count: z.number(),
  results: z.array(ItemSchema),
};
export const ListEnvelopeSchema = z.object(listEnvelopeShape);

// --- detail envelope -----------------------------------------------------
export const detailEnvelopeShape = {
  source: z.string(),
  item: ItemSchema.extend({ comments: z.array(CommentSchema) }),
};
export const DetailEnvelopeSchema = z.object(detailEnvelopeShape);

// --- HTML stripping (OUT-03, D-02) --------------------------------------
// Centralized so trimming/decoding is applied identically everywhere. Returns
// null when the result is empty so blank/tag-only text normalizes to null.

// Decode one numeric character reference. fromCodePoint (NOT fromCharCode —
// which truncates astral code points like emoji to surrogate halves), guarded
// so an out-of-range reference (> 0x10FFFF) is left as-is instead of throwing:
// a RangeError here would hard-error every tool call whose source text carries
// a malformed entity, violating the never-hard-error resilience rule.
function decodeCodePoint(match, cp) {
  return Number.isInteger(cp) && cp >= 0 && cp <= 0x10ffff
    ? String.fromCodePoint(cp)
    : match;
}

export function stripHtml(html) {
  if (html == null) return null;
  const out = String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<\/(p|div|br|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (m, n) => decodeCodePoint(m, Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => decodeCodePoint(m, parseInt(h, 16)))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return out || null;
}

// --- factories -----------------------------------------------------------
// Fill every contract field, defaulting absent fields to null (tags to []),
// coerce id to a string, and strip HTML from text. NEVER drop/rename
// score/num_comments (D-02). `??` preserves a legitimate 0.
export function normalizeItem(p) {
  return {
    id: String(p.id),
    type: p.type,
    title: p.title ?? "",
    author: p.author ?? null,
    score: p.score ?? null,
    num_comments: p.num_comments ?? null,
    created_utc: p.created_utc ?? null,
    url: p.url ?? null,
    permalink: p.permalink ?? null,
    tags: p.tags ?? [],
    text: p.text != null ? stripHtml(p.text) : null,
  };
}

export function buildListEnvelope({ source, query = null, results }) {
  const items = results.map(normalizeItem);
  return { source, query, count: items.length, results: items };
}

export function buildDetailEnvelope({ source, item, comments = [] }) {
  return {
    source,
    item: {
      ...normalizeItem(item),
      comments: comments.map((c) => ({
        id: String(c.id),
        author: c.author ?? null,
        text: c.text != null ? stripHtml(c.text) : null,
      })),
    },
  };
}

// THE single place content[] and structuredContent are assembled together
// (FOUND-05). Every tool handler returns toolResult(envelope) so the two can
// never drift. The SDK validates structuredContent against the tool's
// outputSchema (the raw shape above) on every return.
export function toolResult(envelope) {
  return {
    content: [{ type: "text", text: JSON.stringify(envelope) }],
    structuredContent: envelope,
  };
}
