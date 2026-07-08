// servers/rss/server.js — generic RSS/Atom feed fetcher (SRC-09, YT-01).
//
// Copied from the Dev.to reference server (servers/devto/server.js): same
// McpServer + registerTool shape and direct-run transport guard. The only
// source-specific logic is XML parsing (fast-xml-parser@4) and the RSS 2.0 /
// Atom 1.0 field maps. Everything reusable — HTML stripping, envelope assembly,
// the dual content/structuredContent return, caching/retry/stale, AND the SSRF
// guard — lives in the shared modules and is imported here.
//
// D-04: a SINGLE `rss_fetch(url, limit?)` list tool — a DELIBERATE deviation from
// the `*_hot`/`*_search`/`*_get` trio every other server ships. RSS has exactly
// ONE operation (fetch a feed): items carry their own content so there is no
// per-item detail endpoint (no `*_get`), and the feed URL IS the query so there
// is no corpus to search (no `*_search`).
//
// Fetch path (CLAUDE.md / D-07): this server calls ONLY getText — never fetch()
// directly, never getJson/postJson. getText carries the SSRF validation
// (scheme allowlist + private-range denylist + per-redirect re-validation,
// 04-01) so the untrusted feed URL from tool input cannot reach an internal
// host. This server reads NO process.env (RSS_ALLOWED_HOSTS lives in
// credentials.js and is consumed inside getText).
//
// Item mapping (D-05, ARCHITECTURE §5): type "article"; score AND num_comments
// BOTH null for every RSS/Atom item (a uniform RSS row); title/author/
// created_utc/url/permalink/tags/text from the feed entry. Handles both RSS 2.0
// (rss>channel>item), RDF (rdf:RDF>item), and Atom 1.0 (feed>entry).
//
// YouTube (YT-01, D-15) needs ZERO youtube-specific code: youtube.com/feeds/
// videos.xml is an Atom feed, so mapAtomEntry handles it — it just PREFERS
// media:group>media:description for `text` (richer than <summary>) when present.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { XMLParser } from "fast-xml-parser";
import { getText } from "../../shared/http_client.js";
import {
  buildListEnvelope,
  listEnvelopeShape,
  toolResult,
} from "../../shared/contract.js";

const SOURCE = "rss";
const DEFAULT_LIMIT = 20;

// One module-level parser (Pitfall 2 + Pitfall 7 discipline):
//   - ignoreAttributes:false so Atom <link href rel> attributes and yt:videoId
//     are readable (attribute keys carry the "@_" prefix).
//   - namespace prefixes KEPT (removeNSPrefix NOT set) so content:encoded,
//     dc:creator, media:group>media:description, yt:videoId stay addressable.
//   - processEntities is tuned rather than left at the default: fast-xml-parser
//     does NOT expand custom DTD entities (the billion-laughs vector is neutral
//     at the source), and its default maxTotalExpansions:1000 counts even
//     PREDEFINED entities (&amp;/&lt;/…, one char each — not a bomb) cumulatively
//     across the document, so a large legitimate code-heavy feed trips it. We
//     raise that ceiling but keep maxExpandedLength as the real DoS output bound
//     and a tight maxExpansionDepth (T-04-09).
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  processEntities: {
    maxEntitySize: 10_000,
    maxExpansionDepth: 3, // nested-entity depth cap (billion-laughs guard)
    maxExpandedLength: 5_000_000, // ~5 MB total expanded-output ceiling (DoS bound)
    maxTotalExpansions: 1_000_000, // predefined entities are 1:1 chars — high ceiling avoids false-positives
  },
});

/** Parse raw feed XML into a JS object (fast-xml-parser@4). */
export function parseFeed(xml) {
  return parser.parse(xml);
}

// --- small field helpers -------------------------------------------------

// A value may be a plain string OR an object carrying { "#text": ... } (CDATA /
// element with attributes). Collapse both to the string (or null).
function textOf(v) {
  if (v == null) return null;
  if (typeof v === "object") return v["#text"] ?? null;
  return v;
}

// RSS <category> may be a string, an array of strings, or objects with a #text
// body (when the element carries a domain attribute). Normalize all to a plain
// string array so the contract's `tags: string[]` always holds.
function rssTags(category) {
  return [].concat(category ?? [])
    .map((c) => (c && typeof c === "object" ? c["#text"] : c))
    .filter((t) => t != null && t !== "")
    .map(String);
}

// Atom <category term="..."> carries the tag in the `term` attribute (prefixed
// "@_term"); some feeds put a bare string. Normalize both.
function atomTags(category) {
  return [].concat(category ?? [])
    .map((c) => (c && typeof c === "object" ? (c["@_term"] ?? c["#text"]) : c))
    .filter((t) => t != null && t !== "")
    .map(String);
}

// RSS pubDate (RFC-822) and Atom updated/published (ISO-8601) both parse via the
// native Date; an unparseable/junk date yields NaN -> null (never throws — a
// single bad feed date must not fail the whole tool call, Pitfall 4).
function toIso(raw) {
  if (raw == null) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Atom <link> is one object for a single link but an ARRAY for many, and each
 * carries the href in the "@_href" attribute. Pick the rel="alternate" link
 * (the human-facing page — e.g. a YouTube watch URL) or fall back to the first,
 * and return its href. RSS <link> is a bare string — handled too. (Pitfall 3.)
 */
export function pickAlternate(link) {
  const links = [].concat(link ?? []);
  const alt = links.find((l) => l && l["@_rel"] === "alternate") ?? links[0];
  if (alt == null) return null;
  if (typeof alt === "string") return alt;
  return alt["@_href"] ?? null;
}

/**
 * Map one RSS 2.0 (or RDF) <item> onto a raw contract item (pre-normalize). Fed
 * through buildListEnvelope -> normalizeItem downstream, which HTML-strips text
 * and applies null-defaulting, so this is pure field mapping. score AND
 * num_comments are BOTH null (D-05 / ARCHITECTURE §5 — the uniform RSS row).
 * text prefers the full content:encoded body over the short description.
 */
export function mapRssItem(item) {
  const link = textOf(item.link);
  return {
    id: String(
      textOf(item.guid) ?? link ?? textOf(item.title) ?? "",
    ),
    type: "article",
    title: textOf(item.title) ?? "",
    // WR-01: coerce through textOf — a <dc:creator>/<author> carrying an XML
    // attribute parses to an object, which would fail author:z.string().nullable()
    // and hard-error the tool. textOf collapses it to its #text string or null.
    author: textOf(item["dc:creator"]) ?? textOf(item.author) ?? null,
    score: null, // D-05
    num_comments: null, // D-05
    created_utc: toIso(item.pubDate),
    url: link,
    permalink: link,
    tags: rssTags(item.category),
    // WR-01 (same object-collapse as author above): a <content:encoded> carrying
    // an XML attribute parses to an object, which would stringify to
    // "[object Object]" downstream. textOf collapses it to its #text string
    // (or null, letting description take over).
    text: textOf(item["content:encoded"]) ?? textOf(item.description) ?? null,
  };
}

/**
 * Map one Atom 1.0 <entry> onto a raw contract item. link[rel=alternate].href
 * -> url/permalink; author.name -> author; updated ?? published -> created_utc.
 * text PREFERS media:group>media:description when present (YouTube's richer body,
 * D-14/D-15) so the YouTube recipe needs ZERO host-specific branching, then
 * falls back to <summary> then <content>. score/num_comments null (D-05).
 */
export function mapAtomEntry(entry) {
  const href = pickAlternate(entry.link);
  const text =
    entry["media:group"]?.["media:description"] ??
    textOf(entry.summary) ??
    textOf(entry.content) ??
    null;
  return {
    id: String(entry.id ?? href ?? textOf(entry.title) ?? ""),
    type: "article",
    title: textOf(entry.title) ?? "",
    // WR-01: coerce through textOf — an Atom <name> with an attribute parses to an
    // object; textOf yields its #text string (or null) so author is never a non-string.
    author: textOf(entry.author?.name) ?? null, // channel name for a YouTube feed
    score: null, // D-05
    num_comments: null, // D-05
    created_utc: toIso(entry.updated ?? entry.published),
    url: href,
    permalink: href,
    tags: atomTags(entry.category),
    text,
  };
}

/**
 * Detect the feed dialect from the parsed root and map every entry through the
 * matching field map. RSS 2.0 = rss>channel>item; RDF (RSS 1.0) = rdf:RDF>item;
 * Atom 1.0 = feed>entry. A single <item>/<entry> parses to a lone object, so
 * `[].concat(...)` guarantees an array (Pitfall 5). A non-feed document (e.g. an
 * HTML 200 block/consent page) has none of these roots -> throw a clear error
 * rather than emit a junk item (Pitfall 6 / T-04-10).
 */
export function normalizeFeed(parsed, feedUrl) {
  if (parsed?.rss?.channel) {
    return [].concat(parsed.rss.channel.item ?? []).map(mapRssItem);
  }
  if (parsed?.["rdf:RDF"]) {
    return [].concat(parsed["rdf:RDF"].item ?? []).map(mapRssItem);
  }
  if (parsed?.feed) {
    return [].concat(parsed.feed.entry ?? []).map(mapAtomEntry);
  }
  throw new Error(`rss: ${feedUrl} is not a valid RSS/Atom feed`);
}

// --- MCP wiring (identical shape to the Dev.to template) -----------------
//
// registerTool takes RAW Zod shapes (Pitfall 7). The handler fetches ONLY via
// getText (SSRF-guarded, never fetch directly), parses + normalizes, slices to
// `limit`, and returns the shared list envelope through toolResult().

export const server = new McpServer({ name: "rss", version: "1.0.0" });

server.registerTool(
  "rss_fetch",
  {
    title: "Fetch any RSS 2.0 / Atom 1.0 feed",
    description:
      "Fetch any RSS 2.0 or Atom 1.0 feed URL (newsletters, dev blogs, and the " +
      "recipes below) and return the normalized list envelope — each entry as a " +
      'contract item with type "article" and BOTH score and num_comments null ' +
      "(RSS carries no engagement metric). `limit` caps the number of items " +
      "(default 20).\n\n" +
      "SINGLE-TOOL DESIGN (deliberate): unlike the other sources this server " +
      "exposes ONLY rss_fetch — no *_get (feed items already carry their content; " +
      "there is no per-item detail endpoint) and no *_search (the feed URL itself " +
      "is the query; there is no server-side corpus to search).\n\n" +
      "RECIPE — subreddit (read-only Reddit): " +
      'rss_fetch("https://www.reddit.com/r/<sub>/.rss") ' +
      '(or ".../.rss?sort=top") returns a subreddit\'s posts as normalized items.\n\n' +
      "RECIPE — YouTube channel / playlist (surfaces video links + a short " +
      'description each): rss_fetch("https://www.youtube.com/feeds/videos.xml?' +
      'channel_id=<UC…>") or "…?playlist_id=<PL…>". Each recent video maps to an ' +
      "item whose url is the watch link, author is the channel, and text is the " +
      "video description. LIMITATION: YouTube feeds are per-channel / per-playlist " +
      "only — there is NO keyword search (YouTube retired the search feed; " +
      "site-wide search needs the paid Data API, out of scope). Supply the " +
      "channel/playlist ID: for a youtube.com/@handle, view-source the channel " +
      'page and copy the "externalId":"UC…" value as the channel_id.',
    inputSchema: {
      url: z.string().url(),
      limit: z.number().int().min(1).max(50).optional(),
    },
    outputSchema: listEnvelopeShape,
  },
  async ({ url, limit = DEFAULT_LIMIT }) => {
    const xml = await getText(url);
    const results = normalizeFeed(parseFeed(xml), url).slice(0, limit);
    const env = buildListEnvelope({ source: SOURCE, query: url, results });
    return toolResult(env);
  },
);

// Connect over stdio only when run directly (`node servers/rss/server.js`), so
// importing this module for tests does NOT start a live transport.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await server.connect(new StdioServerTransport());
}
