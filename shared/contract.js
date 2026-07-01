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
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
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
