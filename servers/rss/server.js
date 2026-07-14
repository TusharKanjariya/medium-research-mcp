// servers/rss/server.js — generic RSS/Atom feed fetcher (SRC-09, YT-01).
//
// Copied from the Dev.to reference server (servers/devto/server.js): same
// McpServer + registerTool shape and direct-run transport guard. The only
// source-specific logic is XML parsing (fast-xml-parser@4) and the RSS 2.0 /
// Atom 1.0 field maps. Everything reusable — HTML stripping, envelope assembly,
// the dual content/structuredContent return, caching/retry/stale, AND the SSRF
// guard — lives in the shared modules and is imported here.
//
// D-04/D-01: `rss_fetch(url, limit?)` is the GENERIC single-feed list tool — a
// DELIBERATE deviation from the `*_hot`/`*_search`/`*_get` trio every other server
// ships. Generic RSS has exactly ONE operation (fetch a feed): items carry their
// own content so there is no per-item detail endpoint (no `*_get`), and the feed
// URL IS the query so there is no corpus to search (no `*_search`).
//
// Phase 6 (D-01) adds FOCUSED writer-aware tools alongside rss_fetch —
// rss_author_posts (a writer's Medium/Substack/raw-feed window) and rss_tag_posts
// (Medium tag feed) — so the server is no longer single-tool. They reuse the SAME
// getText -> parseFeed -> normalizeFeed pipeline; rss_fetch stays the generic
// single-feed fetcher.
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
import { getText, getJson } from "../../shared/http_client.js";
import {
  buildListEnvelope,
  listEnvelopeShape,
  toolResult,
  stripHtml,
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
  // WR-01 parity: coerce through textOf like the summary/content siblings — a
  // <media:description type="…"> carrying any XML attribute parses to an object
  // ({ "#text": "…", "@_…": "…" }); un-coerced it lands in `text` and stringifies
  // to "[object Object]" downstream. textOf collapses it to its #text string (or
  // null, letting <summary>/<content> take over).
  const text =
    textOf(entry["media:group"]?.["media:description"]) ??
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

// --- author/tag inference + preview marker (Phase 6, ABLOG-01/02/04) ------

/**
 * Resolve a single smart `author` string to a feed URL by its SHAPE (D-02/D-03).
 * PURE — no fetch; the returned URL is fetched downstream by getText, whose
 * assertSafeUrl enforces the scheme allowlist + private-range denylist on every
 * hop, so the raw-URL branch is NOT specially trusted.
 *
 *   - leading `@`            -> Medium profile feed  https://medium.com/feed/@<user>
 *   - a `<pub>.substack.com` host (bare OR inside a full http(s):// URL)
 *                           -> Substack feed        https://<pub>.substack.com/feed
 *   - any other http(s)://  -> the raw feed URL, verbatim
 *   - a bare token (no @, no *.substack.com host, no scheme) -> THROW.
 *
 * The ambiguous case throws rather than guessing a host: synthesizing a host from
 * a bare name is an SSRF/typo footgun and breaks the keyless-explicit premise
 * (T-06-03). The error names the three accepted forms.
 */
export function resolveAuthorFeed(author) {
  const raw = typeof author === "string" ? author.trim() : "";
  const forms =
    "supply one of: an @handle (Medium, e.g. @ev), a *.substack.com " +
    "publication (e.g. pub.substack.com), or a full http(s):// feed URL";
  if (!raw) {
    throw new Error(`rss_author_posts: author is required — ${forms}.`);
  }

  // 1. Medium @handle -> profile feed (encode the user segment).
  if (raw.startsWith("@")) {
    const user = raw.slice(1);
    if (!user) {
      throw new Error(`rss_author_posts: "${raw}" is not a valid @handle — ${forms}.`);
    }
    return `https://medium.com/feed/@${encodeURIComponent(user)}`;
  }

  const hasScheme = /^https?:\/\//i.test(raw);

  // 2. Substack: extract the host, accept ONLY a real <pub>.substack.com host so
  //    a string that merely mentions "substack.com" in a path cannot fabricate a
  //    host. A full Substack URL and a bare pub host both collapse to /feed.
  let host = null;
  if (hasScheme) {
    try {
      host = new URL(raw).hostname.toLowerCase();
    } catch {
      host = null;
    }
  } else {
    host = raw.split("/")[0].toLowerCase();
  }
  if (host && host.endsWith(".substack.com")) {
    return `https://${host}/feed`;
  }

  // 3. Any other explicit http(s):// URL -> raw feed URL, verbatim (getText guards it).
  if (hasScheme) return raw;

  // 4. Ambiguous bare token -> throw; NEVER guess a host.
  throw new Error(
    `rss_author_posts: ambiguous author "${raw}" — a bare name cannot be ` +
      `resolved to a host; ${forms}.`,
  );
}

/** The literal tag appended to an item's tags[] when its body is a teaser/preview. */
export const PREVIEW_TAG = "preview-only";

/**
 * Detect a truncated / paywalled feed body and append the literal `preview-only`
 * to the item's tags[] (D-06/D-07). Machine-readable for the consuming skill and
 * keeps `text` clean — the contract stays frozen (`tags` is an existing field).
 *
 * Heuristics (tunable per CONTEXT "Claude's Discretion"; the MARKER + tags-append
 * contract are locked): a Substack paid post truncates its body with a trailing
 * "Read more" (or a "for paid/paying subscribers" notice); a Medium member-only
 * story ships an abstract that tails off with "Continue reading on Medium" or a
 * "member-only" marker. Detection runs over a tag-stripped copy of `text` so an
 * HTML-wrapped "<a>Read more</a>" still matches; `text` itself is never modified.
 * Appends at most once and never duplicates an existing `preview-only`.
 */
export function markPreviewOnly(item) {
  if (!item || typeof item !== "object") return item;
  const raw = typeof item.text === "string" ? item.text : "";
  const plain = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const tags = Array.isArray(item.tags) ? item.tags : [];
  const isPreview =
    /read more[\s.…»)>\]]*$/i.test(plain) ||
    /this post is for (?:paid|paying) subscribers/i.test(plain) ||
    /continue reading on medium/i.test(plain) ||
    /member[-\s]only/i.test(plain);
  if (isPreview && !tags.includes(PREVIEW_TAG)) {
    return { ...item, tags: [...tags, PREVIEW_TAG] };
  }
  return item;
}

/**
 * Post-fetch selection for rss_author_posts (D-04). Runs AFTER normalize — the
 * platform feed window is fixed by the source; these filters only NARROW what is
 * returned, never widen it. PURE.
 *   - query: keep items whose title OR text contains the keyword (case-insensitive).
 *   - published_before: keep items whose created_utc is non-null and strictly
 *     before the cutoff (compared as Date). An unparseable cutoff is ignored.
 */
export function filterAuthorPosts(results, { query, published_before } = {}) {
  let out = Array.isArray(results) ? results : [];
  if (query) {
    const q = String(query).toLowerCase();
    out = out.filter((it) => {
      const title = it.title ? String(it.title).toLowerCase() : "";
      // WR-04: match against the HTML-STRIPPED text the caller actually receives
      // (normalizeItem strips downstream in buildListEnvelope). Matching raw
      // markup would let a query like `img`, `span`, `href`, or `https` hit tags/
      // attributes/URLs that never appear in the visible `text`, producing
      // "matches" the user cannot see or reproduce. Case-insensitive per D-04.
      const text = it.text != null ? (stripHtml(it.text) ?? "").toLowerCase() : "";
      return title.includes(q) || text.includes(q);
    });
  }
  if (published_before) {
    const cutoff = Date.parse(published_before);
    if (!Number.isNaN(cutoff)) {
      out = out.filter(
        (it) => it.created_utc != null && Date.parse(it.created_utc) < cutoff,
      );
    }
  }
  return out;
}

/**
 * Build the Medium tag feed URL for a tag (D-11, ABLOG-04). Medium's
 * https://medium.com/feed/tag/<tag> is the only keyless public tag feed among the
 * supported platforms, so rss_tag_posts is Medium-only. The tag is URL-encoded in
 * the path segment so a multi-word/special-char tag never breaks the path. PURE.
 */
export function resolveTagFeed(tag) {
  return `https://medium.com/feed/tag/${encodeURIComponent(String(tag ?? "").trim())}`;
}

// --- Substack archive enrichment (Phase 6, ABLOG-03) ----------------------

/**
 * Map ONE post from a Substack publication archive (the unofficial
 * https://<pub>.substack.com/api/v1/archive JSON) onto a raw contract item
 * (pre-normalize). This is the ONE enrichment the RSS window cannot do (D-09):
 * the archive carries per-post reaction + comment counts, which fill the EXISTING
 * `score` / `num_comments` fields — no new item key, the contract stays frozen.
 *
 * CONFIRMED archive JSON keys (per a live probe of a public Substack archive; the
 * contract mapping reactions->score, comments->num_comments is LOCKED, the key
 * names are confirmed here):
 *   id            -> id (String; falls back to slug/canonical_url)
 *   title         -> title
 *   subtitle      -> text (else description)
 *   post_date     -> created_utc (ISO-8601, via toIso)
 *   canonical_url -> url + permalink
 *   reaction_count-> score        (numeric; ?? so a legitimate 0 survives, absence -> null)
 *   comment_count -> num_comments (numeric; same ?? rule)
 *   publishedBylines[0].name -> author
 *   postTags[].name          -> tags[]
 *
 * PURE — no fetch, no mutation of the input.
 */
export function mapSubstackArchiveItem(post) {
  const p = post ?? {};
  const bylines = Array.isArray(p.publishedBylines) ? p.publishedBylines : [];
  const tags = (Array.isArray(p.postTags) ? p.postTags : [])
    .map((t) => (t && typeof t === "object" ? t.name : t))
    .filter((t) => t != null && t !== "")
    .map(String);
  const url = p.canonical_url ?? null;
  return {
    id: String(p.id ?? p.slug ?? p.canonical_url ?? ""),
    type: "article",
    title: p.title ?? "",
    author: bylines[0]?.name ?? null,
    // `??` (NOT ||) so a real 0-count survives and only true absence -> null (D-09).
    score: p.reaction_count ?? null,
    num_comments: p.comment_count ?? null,
    created_utc: toIso(p.post_date),
    url,
    permalink: url,
    tags,
    text: p.subtitle ?? p.description ?? null,
  };
}

/**
 * Resolve a user-supplied `publication` to its `<pub>.substack.com` HOST (D-08).
 * Accepts a bare publication slug (`pub` -> `pub.substack.com`), a bare host
 * (`pub.substack.com`), or a full Substack URL (`https://pub.substack.com/...`).
 * Returns ONLY the host — the caller builds the archive/feed URLs from it. The
 * host is untrusted tool input, so downstream getJson/getText run it through the
 * shared assertSafeUrl SSRF guard (a private/loopback host is rejected there, NOT
 * fabricated-away here). PURE.
 */
export function resolveSubstackPublication(publication) {
  const raw = typeof publication === "string" ? publication.trim() : "";
  if (!raw) {
    throw new Error(
      "rss_substack_archive: publication is required — supply a Substack " +
        "publication slug (e.g. pub), a pub.substack.com host, or a full " +
        "https://pub.substack.com URL.",
    );
  }
  let host;
  if (/^https?:\/\//i.test(raw)) {
    try {
      host = new URL(raw).hostname.toLowerCase();
    } catch {
      throw new Error(`rss_substack_archive: invalid publication URL "${raw}".`);
    }
  } else {
    // bare slug or bare host — take the authority segment before any path.
    host = raw.split("/")[0].toLowerCase();
  }
  // A bare slug (no dot) is a Substack publication name -> <slug>.substack.com.
  if (!host.includes(".")) host = `${host}.substack.com`;
  return host;
}

/**
 * List a Substack publication's archive with graceful degrade (ABLOG-03, D-08/09/10).
 *
 * Primary: the unofficial `https://<pub>.substack.com/api/v1/archive` JSON on the
 * Phase-5 guarded path `getJson(url, { untrustedHost: true })` — the publication
 * host is user-supplied, so untrustedHost is MANDATORY (rides assertSafeUrl +
 * the content-type gate, D-08). Each archive post maps through
 * mapSubstackArchiveItem (reactions -> score, comments -> num_comments, D-09).
 *
 * Degrade (D-10 — the EXPECTED path, undocumented endpoint): on ANY archive
 * failure (endpoint gone, a login-HTML-200 caught by the content-type gate,
 * throttle, parse error) fall back to the `<pub>.substack.com/feed` RSS window
 * via getText and return THAT envelope. NEVER re-throw archive breakage.
 *
 * SSRF is NOT swallowed: the getText fallback ALSO rides assertSafeUrl, so a
 * blocked (private/loopback/metadata) publication host is rejected on BOTH paths
 * — the fallback re-throws it, ending in a thrown SSRF error, not a fake envelope.
 *
 * The impls/opts are injectable so the success + fallback + SSRF paths are driven
 * offline (the registered handler builds opts internally, mirroring lemmy SEC-01).
 */
export async function fetchSubstackArchive(
  publication,
  { getJsonImpl = getJson, getTextImpl = getText, jsonOpts = {}, textOpts = {} } = {},
) {
  const host = resolveSubstackPublication(publication);
  const archiveUrl = `https://${host}/api/v1/archive`;
  try {
    // untrustedHost is MANDATORY (D-08) — spread jsonOpts FIRST so a caller/test
    // may add fetchImpl/lookup/cacheKey, but untrustedHost:true is applied LAST
    // and therefore cannot be overridden (last-write-wins): the SSRF guard on the
    // one path that fetches a user-supplied host can never be silently dropped.
    const posts = await getJsonImpl(archiveUrl, {
      ...jsonOpts,
      untrustedHost: true,
    });
    // WR-03 (D-10): an unexpected archive shape — a non-array 200 body, or an
    // empty array — is an ARCHIVE FAILURE, not a valid "0 posts" answer for an
    // active publication. Throw so it lands in the catch below and degrades to
    // the RSS-window fallback (the same path as any other archive breakage),
    // rather than returning a silent, misleading count:0 envelope.
    if (!Array.isArray(posts) || posts.length === 0) {
      throw new Error(
        "rss_substack_archive: unexpected archive shape (non-array or empty body)",
      );
    }
    const results = posts.map(mapSubstackArchiveItem);
    return buildListEnvelope({ source: SOURCE, query: publication, results });
  } catch {
    // D-10 graceful degrade: the archive is undocumented — breakage is expected.
    // Fall back to the RSS window. getText re-runs assertSafeUrl, so a blocked
    // host still throws here (SSRF is never degraded into a fake envelope).
    const feedUrl = `https://${host}/feed`;
    const xml = await getTextImpl(feedUrl, { ...textOpts });
    const results = normalizeFeed(parseFeed(xml), feedUrl).map(markPreviewOnly);
    return buildListEnvelope({ source: SOURCE, query: publication, results });
  }
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
      "GENERIC-FEED TOOL: rss_fetch is the generic single-feed fetcher — no *_get " +
      "(feed items already carry their content; there is no per-item detail " +
      "endpoint) and no *_search (the feed URL itself is the query; there is no " +
      "server-side corpus to search). For a specific writer's posts use " +
      "rss_author_posts, and for a Medium tag feed use rss_tag_posts (this server " +
      "exposes those focused tools alongside rss_fetch).\n\n" +
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

server.registerTool(
  "rss_author_posts",
  {
    title: "Fetch a writer's recent posts (Medium / Substack / raw feed)",
    description:
      "Fetch a chosen author's recent posts as normalized contract items " +
      '(type "article", HTML-stripped text, tags[], created_utc). The `author` ' +
      "argument is a single smart field whose SHAPE selects the platform:\n\n" +
      "  • an @handle (e.g. @ev) -> the Medium profile feed\n" +
      "  • a *.substack.com publication (bare host like pub.substack.com OR a " +
      "full Substack URL) -> that publication's feed\n" +
      "  • any other http(s):// URL -> treated as a raw feed URL\n" +
      "A bare name (no @, no *.substack.com host, no scheme) is AMBIGUOUS and " +
      "returns an error — the server never guesses a host.\n\n" +
      "HONEST WINDOW (important): Medium feeds return at most the ~10 most recent " +
      "posts; Substack ~20. Older history is NOT reachable keylessly (except a " +
      "Substack publication's full archive via rss_substack_archive). Never read a " +
      "10-item Medium window as the author's full history — use `count` + each " +
      "item's `created_utc` to see exactly what was covered.\n\n" +
      "PAYWALL / PREVIEW: paywalled or member-only bodies are TEASER-quality, not " +
      'the full post. Such items carry the literal tag "preview-only" in tags[] ' +
      "(text is left clean); treat their text as a teaser in any dedup/cadence " +
      "recipe.\n\n" +
      "SELECTION: `query` keeps only items whose title/teaser contains the keyword " +
      "(case-insensitive); `published_before` (ISO date) keeps only items published " +
      "strictly before it. Both narrow the fixed platform window — they do not " +
      "widen it.\n\n" +
      "RECIPE — posting cadence: read created_utc across the returned items, but " +
      "remember the window caps above (see docs/AUTHOR-BLOG-RECIPES.md for the " +
      "cadence and series/follow-up recipes).",
    inputSchema: {
      author: z.string(),
      query: z.string().optional(),
      published_before: z.string().optional(),
    },
    outputSchema: listEnvelopeShape,
  },
  async ({ author, query, published_before }) => {
    const url = resolveAuthorFeed(author);
    const xml = await getText(url);
    const mapped = normalizeFeed(parseFeed(xml), url).map(markPreviewOnly);
    const results = filterAuthorPosts(mapped, { query, published_before });
    const env = buildListEnvelope({ source: SOURCE, query: author, results });
    return toolResult(env);
  },
);

server.registerTool(
  "rss_tag_posts",
  {
    title: "Fetch recent Medium posts for a tag",
    description:
      "Fetch recent Medium articles tagged `tag` as normalized contract items " +
      '(type "article", HTML-stripped text, tags[], created_utc), from ' +
      "https://medium.com/feed/tag/<tag>.\n\n" +
      "MEDIUM-ONLY (D-11): tag feeds are Medium-only in v1.1 — Substack and raw " +
      "feeds have no keyless public tag/keyword endpoint, so there is deliberately " +
      "no `platform` parameter. For a specific writer's posts use rss_author_posts; " +
      "for an arbitrary feed URL use rss_fetch.\n\n" +
      "HONEST WINDOW: a Medium tag feed returns at most the ~10 most recent tagged " +
      "posts — it is a recency sample, NOT the full corpus for that tag. Paywalled / " +
      'member-only items carry the literal tag "preview-only" in tags[] and their ' +
      "text is teaser-quality (see docs/AUTHOR-BLOG-RECIPES.md for cadence and " +
      "series/follow-up recipes).",
    inputSchema: {
      tag: z.string(),
    },
    outputSchema: listEnvelopeShape,
  },
  async ({ tag }) => {
    const url = resolveTagFeed(tag);
    const xml = await getText(url);
    const results = normalizeFeed(parseFeed(xml), url).map(markPreviewOnly);
    const env = buildListEnvelope({ source: SOURCE, query: tag, results });
    return toolResult(env);
  },
);

server.registerTool(
  "rss_substack_archive",
  {
    title: "List a Substack publication's full archive (with reaction + comment counts)",
    description:
      "List a Substack publication's FULL post archive as normalized contract " +
      'items (type "article"), enriched with per-post engagement the RSS window ' +
      "cannot provide: reaction counts fill `score` and comment counts fill " +
      "`num_comments`. The `publication` argument accepts a bare slug (e.g. " +
      "`platformer`), a `<pub>.substack.com` host, or a full Substack URL.\n\n" +
      "ARCHIVE vs WINDOW: unlike rss_author_posts (which returns only the ~20 most " +
      "recent Substack posts via the RSS feed), this reads the publication's full " +
      "archive endpoint, so it can surface older history with engagement metrics.\n\n" +
      "UNOFFICIAL + GRACEFUL FALLBACK: the archive endpoint is UNOFFICIAL and may " +
      "change or require sign-in. On ANY archive failure this tool automatically " +
      "falls back to the ~20-item RSS window (`<pub>.substack.com/feed`) and returns " +
      "that instead — it never hard-errors, but in the fallback case `score` and " +
      "`num_comments` are null (the RSS window carries no engagement). Paywalled / " +
      'member-only items carry the literal tag "preview-only" and teaser-quality text.\n\n' +
      "RECIPE — posting cadence & series/follow-up detection: see " +
      "docs/AUTHOR-BLOG-RECIPES.md. Prefer this tool over rss_author_posts when you " +
      "need a Substack author's fuller history or engagement signal — but read the " +
      "honesty caveat there (a feed/archive is still not guaranteed lifetime history).",
    inputSchema: {
      publication: z.string(),
    },
    outputSchema: listEnvelopeShape,
  },
  async ({ publication }) => {
    const env = await fetchSubstackArchive(publication);
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
