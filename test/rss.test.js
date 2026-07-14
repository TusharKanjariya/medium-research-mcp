// test/rss.test.js — generic RSS/Atom fetcher (SRC-09, YT-01).
//
// Fully offline (fixtures pin the field maps; no live network). Fixtures are
// REAL captured feeds (test/fixtures/rss-*.xml — see 04-03 Task 1):
//   - rss-rss2.xml    : css-tricks.com/feed (RSS 2.0; content:encoded + dc:creator + categories)
//   - rss-atom.xml    : blog.rust-lang.org/feed.xml (Atom 1.0; link[rel=alternate], author.name)
//   - rss-youtube.xml : youtube.com/feeds/videos.xml (Atom; yt:videoId, media:group>media:description)
//   - rss-reddit.xml  : reddit.com/r/programming/.rss (Atom; the subreddit recipe)
//
// Concerns:
//   1. Field-mapping units — mapRssItem / mapAtomEntry over the real fixtures.
//   2. Recipes — YouTube (YT-01) watch URL + channel author + description text;
//      reddit (D-06) parses to schema-valid items.
//   3. Guards — non-feed HTML throws a clear error; single-item feed -> one item;
//      unparseable date -> null.
//   4. Contract — every envelope parses against ListEnvelopeSchema; score AND
//      num_comments are strictly null across every fixture.
//   5. Registration smoke — exactly ["rss_fetch"], with an outputSchema.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  parseFeed,
  normalizeFeed,
  mapRssItem,
  mapAtomEntry,
  pickAlternate,
  resolveAuthorFeed,
  markPreviewOnly,
  filterAuthorPosts,
  resolveTagFeed,
  mapSubstackArchiveItem,
  resolveSubstackPublication,
  fetchSubstackArchive,
  server,
} from "../servers/rss/server.js";
import { getJson } from "../shared/http_client.js";
import { buildListEnvelope, ListEnvelopeSchema } from "../shared/contract.js";

const fixture = (name) =>
  readFileSync(
    fileURLToPath(new URL(`./fixtures/${name}.xml`, import.meta.url)),
    "utf8",
  );

// JSON / raw-body fixture loader (Substack archive success body + login-HTML body).
const rawFixture = (name) =>
  readFileSync(
    fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)),
    "utf8",
  );
const jsonFixture = (name) => JSON.parse(rawFixture(name));

const rss2Parsed = parseFeed(fixture("rss-rss2"));
const atomParsed = parseFeed(fixture("rss-atom"));
const ytParsed = parseFeed(fixture("rss-youtube"));
const redditParsed = parseFeed(fixture("rss-reddit"));

const rss2Items = rss2Parsed.rss.channel.item;
const atomEntries = atomParsed.feed.entry;
const ytEntries = ytParsed.feed.entry;

// --- (a) RSS 2.0 field map (content:encoded / dc:creator / category) -----

test("mapRssItem maps a real RSS 2.0 item onto the exact contract fields", () => {
  const item = rss2Items[0];
  const m = mapRssItem(item);
  assert.equal(m.type, "article");
  assert.equal(typeof m.id, "string");
  assert.equal(m.author, item["dc:creator"]); // dc:creator -> author (namespaced)
  assert.equal(m.url, item.link);
  assert.equal(m.permalink, item.link);
  assert.ok(m.title.length > 0, "title present");
  assert.equal(m.created_utc, new Date(item.pubDate).toISOString()); // RFC-822 -> ISO
  assert.ok(Array.isArray(m.tags) && m.tags.length >= 1, "categories -> tags array");
  assert.equal(m.text, item["content:encoded"]); // prefers content:encoded over description
  assert.equal(m.score, null); // D-05
  assert.equal(m.num_comments, null); // D-05
});

test("mapRssItem prefers content:encoded but falls back to description", () => {
  const withEncoded = mapRssItem({
    title: "t",
    link: "http://x/1",
    "content:encoded": "FULL BODY",
    description: "short",
  });
  assert.equal(withEncoded.text, "FULL BODY");
  const noEncoded = mapRssItem({ title: "t", link: "http://x/2", description: "short" });
  assert.equal(noEncoded.text, "short");
});

test("mapRssItem author falls back dc:creator -> author -> null", () => {
  assert.equal(mapRssItem({ title: "t", author: "Plain Author" }).author, "Plain Author");
  assert.equal(mapRssItem({ title: "t" }).author, null);
});

// WR-01: a <dc:creator>/<author>/<name> carrying an XML attribute parses to an
// OBJECT ({ "#text": "...", "@_...": "..." }). Un-coerced it lands in author and
// fails author:z.string().nullable(), hard-erroring the whole tool on an odd feed
// (violates the never-hard-error rule). Author must be coerced to a string-or-null,
// and the built envelope must still validate against the contract schema.
test("mapRssItem coerces an object-valued dc:creator (attribute present) to a string (WR-01)", () => {
  const m = mapRssItem({
    title: "t",
    link: "http://x/1",
    "dc:creator": { "#text": "Jane Doe", "@_role": "author" },
  });
  assert.equal(typeof m.author, "string");
  assert.equal(m.author, "Jane Doe");
  const env = buildListEnvelope({ source: "rss", query: "q", results: [m] });
  assert.doesNotThrow(() => ListEnvelopeSchema.parse(env), "object author must not break the contract");
});

test("mapAtomEntry coerces an object-valued author.name (attribute present) to a string (WR-01)", () => {
  const m = mapAtomEntry({
    title: "t",
    link: { "@_rel": "alternate", "@_href": "http://x/1" },
    author: { name: { "#text": "Chan Nel", "@_lang": "en" } },
  });
  assert.equal(typeof m.author, "string");
  assert.equal(m.author, "Chan Nel");
  const env = buildListEnvelope({ source: "rss", query: "q", results: [m] });
  assert.doesNotThrow(() => ListEnvelopeSchema.parse(env), "object author must not break the contract");
});

test("rss_fetch does not hard-error on a feed whose author element carries an attribute (WR-01)", () => {
  // Full parse -> normalize -> envelope path (what rss_fetch runs) over an RSS 2.0
  // feed whose <dc:creator> carries an attribute — must yield a contract-valid item.
  const xml =
    `<?xml version="1.0"?>` +
    `<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>c</title>` +
    `<item><title>odd</title><link>http://x/odd</link>` +
    `<dc:creator role="author">Jane Doe</dc:creator></item></channel></rss>`;
  const items = normalizeFeed(parseFeed(xml), "http://x/feed");
  const env = buildListEnvelope({ source: "rss", query: "http://x/feed", results: items });
  assert.doesNotThrow(() => ListEnvelopeSchema.parse(env));
  assert.equal(typeof env.results[0].author, "string");
  assert.equal(env.results[0].author, "Jane Doe");
});

test("mapRssItem coerces an object-valued content:encoded (attribute present) to its #text string (WR-01)", () => {
  // A <content:encoded type="html"> element parses to an object; un-coerced it
  // lands in text and stringifies to "[object Object]" downstream.
  const m = mapRssItem({
    title: "t",
    link: "http://x/1",
    "content:encoded": { "#text": "<p>Full <b>body</b> &amp; more</p>", "@_type": "html" },
  });
  assert.equal(m.text, "<p>Full <b>body</b> &amp; more</p>");
});

test("mapRssItem falls back to description when content:encoded is an attribute-only object (WR-01)", () => {
  const m = mapRssItem({
    title: "t",
    link: "http://x/2",
    "content:encoded": { "@_type": "html" },
    description: "short desc",
  });
  assert.equal(m.text, "short desc");
});

test("envelope text over an object-valued content:encoded is a readable string, never '[object Object]' (WR-01)", () => {
  const m = mapRssItem({
    title: "t",
    link: "http://x/1",
    "content:encoded": { "#text": "<p>Full <b>body</b> &amp; more</p>", "@_type": "html" },
  });
  const env = buildListEnvelope({ source: "rss", query: "q", results: [m] });
  assert.doesNotThrow(() => ListEnvelopeSchema.parse(env));
  assert.equal(env.results[0].text, "Full body & more");
  assert.ok(!env.results[0].text.includes("[object Object]"));
});

// --- (b) Atom 1.0 field map (link[rel=alternate] / author.name / ISO date) --

test("mapAtomEntry maps a real Atom entry (link[rel=alternate], author.name, ISO date)", () => {
  const entry = atomEntries[0];
  const m = mapAtomEntry(entry);
  assert.equal(m.type, "article");
  assert.equal(m.author, entry.author.name); // author.name -> author
  assert.equal(m.url, pickAlternate(entry.link)); // rel=alternate href
  assert.equal(m.url, m.permalink);
  assert.ok(m.url.startsWith("http"), "alternate href is an absolute URL");
  assert.equal(m.created_utc, new Date(entry.updated ?? entry.published).toISOString());
  assert.equal(m.score, null);
  assert.equal(m.num_comments, null);
});

test("pickAlternate handles an array (rel=alternate), a lone object, and a bare string", () => {
  assert.equal(
    pickAlternate([
      { "@_rel": "self", "@_href": "http://feed/self" },
      { "@_rel": "alternate", "@_href": "http://page/alt" },
    ]),
    "http://page/alt",
  );
  // single object without rel -> its href (reddit shape)
  assert.equal(pickAlternate({ "@_href": "http://only/link" }), "http://only/link");
  // bare string (RSS-style) -> itself
  assert.equal(pickAlternate("http://plain/link"), "http://plain/link");
  assert.equal(pickAlternate(undefined), null);
});

// --- (c) YouTube recipe (YT-01): watch URL + channel author + description text --

test("YouTube feed maps to watch-URL url, channel author, and media:description text (YT-01)", () => {
  const items = normalizeFeed(ytParsed, "yt");
  assert.ok(items.length >= 1);
  const first = mapAtomEntry(ytEntries[0]);
  assert.match(first.url, /^https:\/\/www\.youtube\.com\/watch\?v=/); // watch link
  assert.equal(first.author, "Linus Tech Tips"); // channel name -> author
  // text comes from media:group>media:description (branch-free), not <summary>
  assert.equal(first.text, ytEntries[0]["media:group"]["media:description"]);
  // every video is a youtube.com link (watch or shorts), carries text, null metrics
  for (const it of items) {
    assert.match(it.url, /^https:\/\/www\.youtube\.com\//);
    assert.equal(it.author, "Linus Tech Tips");
    assert.ok(it.text && it.text.length > 0, "each video has description text");
    assert.equal(it.score, null);
    assert.equal(it.num_comments, null);
  }
});

test("mapAtomEntry prefers media:group>media:description then summary then content", () => {
  assert.equal(
    mapAtomEntry({ title: "t", "media:group": { "media:description": "YT DESC" }, summary: "s" }).text,
    "YT DESC",
  );
  assert.equal(mapAtomEntry({ title: "t", summary: "SUMMARY" }).text, "SUMMARY");
  assert.equal(mapAtomEntry({ title: "t", content: { "#text": "CONTENT" } }).text, "CONTENT");
});

// WR-01 parity: a <media:description> carrying an attribute parses to an object;
// un-coerced it lands in text and stringifies to "[object Object]" downstream.
// It must collapse to its #text string (or fall back), and the envelope must
// still validate against the contract schema.
test("mapAtomEntry coerces an object-valued media:description (attribute present) to its #text string (WR-01)", () => {
  const m = mapAtomEntry({
    title: "t",
    link: { "@_rel": "alternate", "@_href": "http://x/1" },
    "media:group": {
      "media:description": { "#text": "Real video description", "@_type": "plain" },
    },
    summary: "fallback summary",
  });
  assert.equal(typeof m.text, "string");
  assert.equal(m.text, "Real video description");
  const env = buildListEnvelope({ source: "rss", query: "q", results: [m] });
  assert.doesNotThrow(() => ListEnvelopeSchema.parse(env));
  assert.ok(!env.results[0].text.includes("[object Object]"));
});

test("mapAtomEntry falls back to summary when media:description is an attribute-only object (WR-01)", () => {
  const m = mapAtomEntry({
    title: "t",
    "media:group": { "media:description": { "@_type": "plain" } },
    summary: "fallback summary",
  });
  assert.equal(m.text, "fallback summary");
});

// --- (d) reddit subreddit recipe (D-06) ----------------------------------

test("reddit .rss parses via the subreddit recipe to schema-valid items (D-06)", () => {
  const items = normalizeFeed(redditParsed, "https://www.reddit.com/r/programming/.rss");
  assert.ok(items.length >= 1, "reddit feed yields items");
  const env = buildListEnvelope({
    source: "rss",
    query: "https://www.reddit.com/r/programming/.rss",
    results: items,
  });
  assert.doesNotThrow(() => ListEnvelopeSchema.parse(env));
  for (const it of items) {
    assert.equal(it.type, "article");
    assert.ok(it.url && it.url.includes("reddit.com"));
    assert.equal(it.score, null);
    assert.equal(it.num_comments, null);
  }
});

// --- (e) date handling: RFC-822 vs ISO, and an unparseable date -> null ---

test("dates: RFC-822 (RSS) and ISO-8601 (Atom) both parse; junk -> created_utc null", () => {
  assert.equal(
    mapRssItem({ title: "t", pubDate: "Wed, 02 Jul 2026 16:56:30 GMT" }).created_utc,
    new Date("Wed, 02 Jul 2026 16:56:30 GMT").toISOString(),
  );
  assert.equal(
    mapAtomEntry({ title: "t", updated: "2026-06-30T00:00:00+00:00" }).created_utc,
    "2026-06-30T00:00:00.000Z",
  );
  assert.equal(mapRssItem({ title: "t", pubDate: "not-a-date" }).created_utc, null);
  assert.equal(mapAtomEntry({ title: "t" }).created_utc, null); // absent date -> null
});

// --- (f) single-item feed -> one-element array (Pitfall 5) ----------------

test("a single-<item> RSS feed yields a one-element results array (not a crash)", () => {
  const one = parseFeed(
    `<?xml version="1.0"?><rss version="2.0"><channel><title>c</title>` +
      `<item><title>only</title><link>http://x/only</link></item></channel></rss>`,
  );
  const items = normalizeFeed(one, "http://x/feed");
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "only");
});

test("a single-<entry> Atom feed yields a one-element results array", () => {
  const one = parseFeed(
    `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>c</title>` +
      `<entry><title>solo</title><link rel="alternate" href="http://x/solo"/></entry></feed>`,
  );
  const items = normalizeFeed(one, "http://x/atom");
  assert.equal(items.length, 1);
  assert.equal(items[0].url, "http://x/solo");
});

// --- (g) non-feed HTML -> clear error (Pitfall 6 / T-04-10) ---------------

test("a non-feed HTML page throws a clear 'not a valid RSS/Atom feed' error", () => {
  const html = parseFeed(
    "<!doctype html><html><head><title>Login</title></head><body><h1>Hi</h1></body></html>",
  );
  assert.throws(
    () => normalizeFeed(html, "https://example.com/not-a-feed"),
    /is not a valid RSS\/Atom feed/,
  );
});

// --- (h) full-contract guard over every real fixture ---------------------

test("every fixture builds a ListEnvelope that parses against the contract schema", () => {
  const feeds = {
    "rss-rss2": rss2Parsed,
    "rss-atom": atomParsed,
    "rss-youtube": ytParsed,
    "rss-reddit": redditParsed,
  };
  for (const [name, parsed] of Object.entries(feeds)) {
    const results = normalizeFeed(parsed, name);
    const env = buildListEnvelope({ source: "rss", query: name, results });
    assert.doesNotThrow(() => ListEnvelopeSchema.parse(env), `${name} envelope is contract-valid`);
    assert.equal(env.count, results.length);
    // score AND num_comments strictly null for every RSS/Atom item (D-05).
    for (const it of env.results) {
      assert.strictEqual(it.score, null, `${name}: score null`);
      assert.strictEqual(it.num_comments, null, `${name}: num_comments null`);
      assert.equal(it.type, "article");
    }
  }
});

// --- (i) registration smoke ----------------------------------------------

// --- (m) rss_tag_posts (Medium-only, D-11) --------------------------------

const mediumTagParsed = parseFeed(fixture("rss-medium-tag"));

test("resolveTagFeed builds the Medium tag feed URL and URL-encodes the tag segment", () => {
  assert.equal(resolveTagFeed("rust"), "https://medium.com/feed/tag/rust");
  // a multi-word / special-char tag is encoded so the path never breaks.
  assert.equal(
    resolveTagFeed("machine learning"),
    "https://medium.com/feed/tag/machine%20learning",
  );
  assert.equal(resolveTagFeed("c#"), "https://medium.com/feed/tag/c%23");
});

test("rss_tag_posts pipeline over a Medium tag feed yields a contract-valid envelope", () => {
  const results = normalizeFeed(mediumTagParsed, resolveTagFeed("rust")).map(markPreviewOnly);
  const env = buildListEnvelope({ source: "rss", query: "rust", results });
  assert.doesNotThrow(() => ListEnvelopeSchema.parse(env));
  assert.ok(env.results.length >= 2);
  for (const it of env.results) {
    assert.equal(it.type, "article");
    assert.ok(it.url && it.url.includes("medium.com"));
  }
});

test("rss_tag_posts is registered { tag } + outputSchema and states Medium-only", () => {
  const tool = server._registeredTools.rss_tag_posts;
  assert.ok(tool, "rss_tag_posts is registered");
  assert.ok(tool.outputSchema, "has an outputSchema");
  assert.deepEqual(Object.keys(tool.inputSchema.shape).sort(), ["tag"]);
  assert.match(tool.description, /Medium-only|Medium only/i);
});

// The SINGLE-TOOL note must no longer claim the server exposes ONLY rss_fetch (D-01).
test("rss_fetch description no longer claims the server exposes only rss_fetch (D-01)", () => {
  const desc = server._registeredTools.rss_fetch.description;
  assert.doesNotMatch(desc, /exposes ONLY rss_fetch/i);
  assert.match(desc, /rss_author_posts|rss_tag_posts/);
});

// Registration smoke: FINALIZED to the exact four tools in the (o) block below
// (rss server registers EXACTLY the four writer-aware tools).

test("rss_fetch declares an outputSchema (contract validation on return)", () => {
  assert.ok(server._registeredTools.rss_fetch.outputSchema, "rss_fetch has an outputSchema");
});

// --- (j) resolveAuthorFeed platform inference (D-02/D-03) -----------------
//
// The `author` string's SHAPE selects the platform. Ambiguous bare tokens MUST
// throw — the server never synthesizes/guesses a host (T-06-03 SSRF/typo footgun).

test("resolveAuthorFeed: @handle -> Medium profile feed (trimmed)", () => {
  assert.equal(resolveAuthorFeed("@ev"), "https://medium.com/feed/@ev");
  assert.equal(resolveAuthorFeed("  @ev  "), "https://medium.com/feed/@ev");
});

test("resolveAuthorFeed: bare *.substack.com host -> the publication feed", () => {
  assert.equal(resolveAuthorFeed("pub.substack.com"), "https://pub.substack.com/feed");
});

test("resolveAuthorFeed: a full Substack URL -> the same publication feed", () => {
  assert.equal(
    resolveAuthorFeed("https://pub.substack.com/p/some-slug"),
    "https://pub.substack.com/feed",
  );
});

test("resolveAuthorFeed: any other http(s):// URL -> the raw feed URL, unchanged", () => {
  assert.equal(
    resolveAuthorFeed("https://example.com/feed.xml"),
    "https://example.com/feed.xml",
  );
});

test("resolveAuthorFeed: an ambiguous bare token throws and never guesses a host (D-03/T-06-03)", () => {
  // Error names the three accepted forms.
  assert.throws(() => resolveAuthorFeed("someuser"), /@handle|substack\.com|feed URL/i);
  assert.throws(() => resolveAuthorFeed(""), /author/i);
  // A bare host that is NOT a substack host (even though it mentions substack.com
  // in a path) must not resolve to a fabricated host.
  assert.throws(() => resolveAuthorFeed("evil.com/substack.com"), /@handle|substack\.com|feed URL/i);
  // Prove no return value leaks from the ambiguous path.
  let resolved = null;
  try {
    resolved = resolveAuthorFeed("someuser");
  } catch {
    /* expected */
  }
  assert.equal(resolved, null, "must not fabricate a host from a bare token");
});

// --- (k) preview-only marker detection (D-06/D-07) ------------------------
//
// Truncated/paywalled feed bodies get the literal `preview-only` appended to
// tags[] (never a new field, never a text edit); a full item is untouched.

test("markPreviewOnly: a Substack 'Read more' teaser gets preview-only in tags[]; text untouched", () => {
  const item = {
    title: "Paid",
    tags: ["essay"],
    text: "<p>Intro paragraph…</p><p><a href='https://x/p'>Read more</a></p>",
  };
  const out = markPreviewOnly(item);
  assert.ok(out.tags.includes("preview-only"));
  assert.equal(out.text, item.text, "text is never modified");
});

test("markPreviewOnly: a Medium member-only / abstract-only item gets preview-only", () => {
  const item = {
    title: "Members",
    tags: [],
    text: "<p>A short abstract…</p><p>Continue reading on Medium »</p>",
  };
  const out = markPreviewOnly(item);
  assert.ok(out.tags.includes("preview-only"));
});

test("markPreviewOnly: a normal full item is untouched (no preview-only)", () => {
  const item = { title: "Free", tags: ["news"], text: "<p>A complete public post body.</p>" };
  const out = markPreviewOnly(item);
  assert.deepEqual(out.tags, ["news"]);
});

test("markPreviewOnly: never appends preview-only twice", () => {
  const item = { title: "P", tags: ["preview-only"], text: "Read more" };
  const out = markPreviewOnly(item);
  assert.equal(out.tags.filter((t) => t === "preview-only").length, 1);
});

// --- (l) rss_author_posts: normalize + preview + query/published_before ----
//
// The registered handler has no fetchImpl seam (mirror the lemmy SEC-01 note),
// so drive the normalize -> preview -> filter pipeline directly on parsed
// fixtures. No network.

const mediumAuthorParsed = parseFeed(fixture("rss-medium-author"));
const mediumMemberOnlyParsed = parseFeed(fixture("rss-medium-memberonly"));
const substackPaywallParsed = parseFeed(fixture("rss-substack-paywall"));

const authorPipeline = (parsed, url, opts) =>
  filterAuthorPosts(
    normalizeFeed(parsed, url).map(markPreviewOnly),
    opts ?? {},
  );

test("rss_author_posts pipeline over a Medium author feed yields a contract-valid envelope", () => {
  const results = authorPipeline(mediumAuthorParsed, "https://medium.com/feed/@ada");
  const env = buildListEnvelope({ source: "rss", query: "@ada", results });
  assert.doesNotThrow(() => ListEnvelopeSchema.parse(env));
  assert.equal(env.source, "rss");
  assert.ok(env.results.length >= 2);
  for (const it of env.results) {
    assert.equal(it.type, "article");
    assert.ok(Array.isArray(it.tags));
    // HTML-stripped text (no residual tags from content:encoded).
    assert.ok(it.text == null || !/<[a-z][^>]*>/i.test(it.text), "text is HTML-stripped");
  }
});

test("rss_author_posts query narrows by title/teaser substring (case-insensitive)", () => {
  const results = authorPipeline(mediumAuthorParsed, "u", { query: "RUST" });
  assert.equal(results.length, 1);
  assert.match(results[0].title, /Rust/);
});

test("rss_author_posts query matches the HTML-stripped text, not raw markup (WR-04)", () => {
  // The query test must run over the STRIPPED text the caller receives. A query
  // that only appears inside markup (tag names, attributes, hrefs) must NOT match;
  // a query in the visible prose MUST match.
  const items = [
    {
      id: "1",
      type: "article",
      title: "Post about gardening",
      text: '<p class="span-wide"><a href="https://example.com/img">Tulips are lovely</a></p>',
      tags: [],
    },
  ];
  // markup-only tokens that never appear in stripped text -> no match.
  for (const q of ["span", "href", "https", "img", "class", "<p>"]) {
    assert.equal(
      filterAuthorPosts(items, { query: q }).length,
      0,
      `query "${q}" must not match HTML markup`,
    );
  }
  // visible prose -> matches (case-insensitive).
  assert.equal(filterAuthorPosts(items, { query: "tulips" }).length, 1);
  assert.equal(filterAuthorPosts(items, { query: "GARDENING" }).length, 1); // title still matches
});

test("rss_author_posts published_before drops items at/after the cutoff", () => {
  // Jul 02 and Jun 01 items; a Jun 15 cutoff keeps only the Jun 01 (Go) post.
  const results = authorPipeline(mediumAuthorParsed, "u", { published_before: "2026-06-15" });
  assert.equal(results.length, 1);
  assert.match(results[0].title, /Go/);
});

test("rss_author_posts marks a Medium member-only item preview-only; a free item is not", () => {
  const results = authorPipeline(mediumMemberOnlyParsed, "https://medium.com/feed/@grace");
  const member = results.find((r) => /members only/i.test(r.title));
  const free = results.find((r) => /compilers/i.test(r.title));
  assert.ok(member.tags.includes("preview-only"), "member-only item is preview-only");
  assert.ok(!free.tags.includes("preview-only"), "free item is not preview-only");
});

test("rss_author_posts marks a paywalled Substack 'Read more' item preview-only; free item is not", () => {
  const results = authorPipeline(substackPaywallParsed, "https://pub.substack.com/feed");
  const paid = results.find((r) => /paid/i.test(r.title));
  const free = results.find((r) => /free/i.test(r.title));
  assert.ok(paid.tags.includes("preview-only"), "paid teaser is preview-only");
  assert.ok(!free.tags.includes("preview-only"), "free post is not preview-only");
  // text stays clean — no injected marker field, contract frozen.
  assert.doesNotThrow(() =>
    ListEnvelopeSchema.parse(buildListEnvelope({ source: "rss", query: "sub", results })),
  );
});

test("rss_author_posts is registered with the three-field inputSchema + outputSchema", () => {
  const tool = server._registeredTools.rss_author_posts;
  assert.ok(tool, "rss_author_posts is registered");
  assert.ok(tool.outputSchema, "has an outputSchema");
  // The SDK compiles the raw shape into a ZodObject; read its .shape keys.
  const keys = Object.keys(tool.inputSchema.shape).sort();
  assert.deepEqual(keys, ["author", "published_before", "query"]);
});

test("rss_author_posts description states the ~10/~20 window caps and paywall truncation", () => {
  const desc = server._registeredTools.rss_author_posts.description;
  assert.match(desc, /~?\s*10/);
  assert.match(desc, /~?\s*20/);
  assert.match(desc, /paywall|teaser|preview/i);
});

// --- (n) mapSubstackArchiveItem: reactions -> score, comments -> num_comments --
//
// The one enrichment the RSS window cannot do (D-09): the Substack archive JSON
// carries per-post reaction + comment counts, which fill the EXISTING score /
// num_comments fields on the frozen contract. Absence -> null (never 0).

const archivePosts = jsonFixture("substack-archive.json");

test("mapSubstackArchiveItem fills score from reactions and num_comments from comments (D-09)", () => {
  const withEngagement = archivePosts[0]; // reaction_count 128, comment_count 17
  const m = mapSubstackArchiveItem(withEngagement);
  assert.equal(m.type, "article");
  assert.equal(typeof m.id, "string");
  assert.equal(m.title, withEngagement.title);
  assert.equal(m.author, "Ada Lovelace"); // publishedBylines[0].name
  assert.equal(m.score, 128); // reaction_count -> score (numeric)
  assert.equal(m.num_comments, 17); // comment_count -> num_comments (numeric)
  assert.equal(m.created_utc, new Date(withEngagement.post_date).toISOString());
  assert.equal(m.url, withEngagement.canonical_url);
  assert.equal(m.permalink, withEngagement.canonical_url);
  assert.deepEqual(m.tags, ["rust", "cli"]); // postTags[].name -> tags[]
  assert.equal(m.text, withEngagement.subtitle);
});

test("mapSubstackArchiveItem yields null (not 0) score/num_comments when absent", () => {
  const noEngagement = archivePosts[1]; // no reaction_count, no comment_count
  const m = mapSubstackArchiveItem(noEngagement);
  assert.strictEqual(m.score, null, "absent reactions -> null, never 0");
  assert.strictEqual(m.num_comments, null, "absent comments -> null, never 0");
  assert.deepEqual(m.tags, []); // empty postTags -> []
  assert.equal(m.type, "article");
  assert.equal(typeof m.id, "string");
});

test("mapSubstackArchiveItem preserves a legitimate 0 count (?? not truthiness)", () => {
  const m = mapSubstackArchiveItem({
    id: 9,
    title: "Zero",
    post_date: "2026-05-01T00:00:00.000Z",
    canonical_url: "https://pub.substack.com/p/zero",
    reaction_count: 0,
    comment_count: 0,
  });
  assert.strictEqual(m.score, 0, "0 reactions survives as 0");
  assert.strictEqual(m.num_comments, 0, "0 comments survives as 0");
});

test("a ListEnvelope over the mapped archive parses against the contract and preserves count", () => {
  const results = archivePosts.map(mapSubstackArchiveItem);
  const env = buildListEnvelope({ source: "rss", query: "pub", results });
  assert.doesNotThrow(() => ListEnvelopeSchema.parse(env));
  assert.equal(env.count, results.length);
  assert.equal(env.count, 2);
  // Enrichment rides EXISTING fields — no new item key.
  for (const it of env.results) {
    assert.equal(it.type, "article");
    assert.ok("score" in it && "num_comments" in it);
  }
});

// --- (o) rss_substack_archive: guarded getJson + graceful RSS fallback ------
//
// Mirror the lemmy SEC-01 pattern: the registered handler builds its getJson/
// getText opts internally, so the archive-with-fallback logic is factored into
// the exported, injectable `fetchSubstackArchive`. Success, HTML-200 ->
// content-type gate -> RSS-window fallback (the EXPECTED path, D-10), and SSRF
// reject on the user-supplied publication host are all driven offline.

// A JSON response shim exposing headers.get() for getJson's content-type gate.
const jsonRes = (status, data, ct = "application/json") => ({
  ok: status >= 200 && status < 300,
  status,
  headers: {
    get: (k) => (String(k).toLowerCase() === "content-type" ? ct : null),
  },
  async json() {
    return data;
  },
});
// A raw-text response shim for getText (feed fallback window). No redirects.
const textRes = (status, body, ct = "application/xml") => ({
  ok: status >= 200 && status < 300,
  status,
  headers: {
    get: (k) => {
      const key = String(k).toLowerCase();
      if (key === "content-type") return ct;
      return null; // no Location -> not a redirect
    },
  },
  async text() {
    return body;
  },
});
const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];
const privateLookup = async () => [{ address: "10.0.0.5", family: 4 }];

test("resolveSubstackPublication accepts a bare slug, a bare host, and a full URL", () => {
  assert.equal(resolveSubstackPublication("pub"), "pub.substack.com");
  assert.equal(resolveSubstackPublication("pub.substack.com"), "pub.substack.com");
  assert.equal(
    resolveSubstackPublication("https://pub.substack.com/archive"),
    "pub.substack.com",
  );
  assert.equal(resolveSubstackPublication("  PUB  "), "pub.substack.com"); // trimmed + lowercased
  assert.throws(() => resolveSubstackPublication(""), /publication/i);
});

test("rss_substack_archive success: archive JSON-200 fills score/num_comments (D-09)", async () => {
  const env = await fetchSubstackArchive("pub", {
    jsonOpts: {
      fetchImpl: async () => jsonRes(200, archivePosts),
      sleep: async () => {},
      lookup: publicLookup,
      cacheKey: "rss:archive-success",
    },
  });
  assert.doesNotThrow(() => ListEnvelopeSchema.parse(env));
  assert.equal(env.source, "rss");
  assert.equal(env.query, "pub");
  assert.equal(env.count, archivePosts.length);
  assert.equal(env.results[0].score, 128);
  assert.equal(env.results[0].num_comments, 17);
});

test("rss_substack_archive fallback: an HTML-200 archive degrades to the RSS window, no hard-error (D-10)", async () => {
  const loginHtml = rawFixture("substack-archive-loginhtml.html");
  const feedXml = fixture("rss-substack-feed");
  const env = await fetchSubstackArchive("pub", {
    // archive returns a text/html login page -> content-type gate rejects it.
    jsonOpts: {
      fetchImpl: async () => jsonRes(200, loginHtml, "text/html; charset=utf-8"),
      sleep: async () => {},
      lookup: publicLookup,
      cacheKey: "rss:archive-html200",
    },
    // fallback getText serves the RSS window.
    textOpts: {
      fetchImpl: async () => textRes(200, feedXml),
      sleep: async () => {},
      lookup: publicLookup,
      cacheKey: "rss:archive-fallback-feed",
    },
  });
  // The EXPECTED path: a contract-valid envelope from the feed window, never a throw.
  assert.doesNotThrow(() => ListEnvelopeSchema.parse(env));
  assert.ok(env.results.length >= 1, "fallback feed yields items");
  for (const it of env.results) {
    assert.equal(it.type, "article");
    // RSS-window items carry null engagement (the enrichment is archive-only).
    assert.strictEqual(it.score, null);
    assert.strictEqual(it.num_comments, null);
  }
});

test("rss_substack_archive: a non-array archive 200 degrades to the RSS window, not an empty envelope (WR-03)", async () => {
  // The undocumented archive returns a 200 with an UNEXPECTED (non-array) JSON
  // shape — e.g. { posts: [...] } or an error stub. This is an archive failure
  // per D-10 and must route to the RSS-window fallback, NOT yield count:0.
  const feedXml = fixture("rss-substack-feed");
  const env = await fetchSubstackArchive("pub", {
    jsonOpts: {
      fetchImpl: async () => jsonRes(200, { posts: [], error: "shape changed" }),
      sleep: async () => {},
      lookup: publicLookup,
      cacheKey: "rss:archive-nonarray-200",
    },
    textOpts: {
      fetchImpl: async () => textRes(200, feedXml),
      sleep: async () => {},
      lookup: publicLookup,
      cacheKey: "rss:archive-nonarray-fallback",
    },
  });
  // Degraded to the feed window — a contract-valid, NON-empty envelope, never a throw.
  assert.doesNotThrow(() => ListEnvelopeSchema.parse(env));
  assert.ok(env.results.length >= 1, "non-array archive falls back to the RSS window");
  for (const it of env.results) {
    assert.strictEqual(it.score, null, "RSS-window items carry null engagement");
    assert.strictEqual(it.num_comments, null);
  }
});

test("rss_substack_archive: an empty archive array degrades to the RSS window (WR-03)", async () => {
  const feedXml = fixture("rss-substack-feed");
  const env = await fetchSubstackArchive("pub", {
    jsonOpts: {
      fetchImpl: async () => jsonRes(200, []), // empty archive == failure per D-10
      sleep: async () => {},
      lookup: publicLookup,
      cacheKey: "rss:archive-empty-200",
    },
    textOpts: {
      fetchImpl: async () => textRes(200, feedXml),
      sleep: async () => {},
      lookup: publicLookup,
      cacheKey: "rss:archive-empty-fallback",
    },
  });
  assert.doesNotThrow(() => ListEnvelopeSchema.parse(env));
  assert.ok(env.results.length >= 1, "empty archive falls back to the RSS window");
});

test("rss_substack_archive SSRF: a private/loopback/metadata publication host is rejected on the guarded path (D-08)", async () => {
  // (i) a host that RESOLVES to a private IP (injected privateLookup).
  await assert.rejects(
    () =>
      getJson("https://internal.substack.test/api/v1/archive", {
        fetchImpl: async () => jsonRes(200, archivePosts), // must never be read
        sleep: async () => {},
        lookup: privateLookup,
        untrustedHost: true,
        cacheKey: "rss:archive-ssrf-private",
      }),
    /blocked address/,
  );
  // (ii) literal loopback + link-local metadata IPs reject with no DNS.
  for (const host of ["http://127.0.0.1", "http://169.254.169.254"]) {
    await assert.rejects(
      () =>
        getJson(`${host}/api/v1/archive`, {
          fetchImpl: async () => jsonRes(200, archivePosts),
          sleep: async () => {},
          lookup: publicLookup, // ignored — IP-literal is classified directly
          untrustedHost: true,
          cacheKey: `rss:archive-ssrf-${host}`,
        }),
      /blocked address/,
    );
  }
});

test("rss_substack_archive: a private-host publication throws on BOTH paths (never a fake envelope)", async () => {
  // Both the archive getJson AND the getText fallback ride assertSafeUrl, so a
  // blocked host ends in a thrown SSRF error, not a silently-degraded envelope.
  await assert.rejects(
    () =>
      fetchSubstackArchive("internal.substack.test", {
        jsonOpts: {
          fetchImpl: async () => jsonRes(200, archivePosts),
          sleep: async () => {},
          lookup: privateLookup,
          cacheKey: "rss:archive-both-private-json",
        },
        textOpts: {
          fetchImpl: async () => textRes(200, "<rss/>"),
          sleep: async () => {},
          lookup: privateLookup,
          cacheKey: "rss:archive-both-private-text",
        },
      }),
    /blocked address/,
  );
});

test("rss_substack_archive: a caller-supplied untrustedHost:false cannot override the mandatory SSRF guard (WR-02)", async () => {
  // The opts object applies untrustedHost:true LAST, so even a jsonOpts that
  // explicitly tries to disable the guard is overridden — the private host on
  // the archive path still rejects (it must never reach the fake envelope).
  await assert.rejects(
    () =>
      fetchSubstackArchive("internal.substack.test", {
        jsonOpts: {
          untrustedHost: false, // hostile/mistaken attempt to drop the guard
          fetchImpl: async () => jsonRes(200, archivePosts), // must never be read
          sleep: async () => {},
          lookup: privateLookup,
          cacheKey: "rss:archive-wr02-override-json",
        },
        textOpts: {
          fetchImpl: async () => textRes(200, "<rss/>"),
          sleep: async () => {},
          lookup: privateLookup,
          cacheKey: "rss:archive-wr02-override-text",
        },
      }),
    /blocked address/,
  );
});

test("rss_substack_archive is registered { publication } + outputSchema and documents the archive-vs-window tradeoff", () => {
  const tool = server._registeredTools.rss_substack_archive;
  assert.ok(tool, "rss_substack_archive is registered");
  assert.ok(tool.outputSchema, "has an outputSchema");
  assert.deepEqual(Object.keys(tool.inputSchema.shape).sort(), ["publication"]);
  // Description names the enrichment vs the RSS-window fallback + the recipes doc.
  assert.match(tool.description, /archive/i);
  assert.match(tool.description, /AUTHOR-BLOG-RECIPES\.md/);
});

// Finalized registration smoke: EXACTLY the four rss tools, each with an outputSchema.
test("rss server registers EXACTLY the four writer-aware tools, each with an outputSchema", () => {
  const tools = server._registeredTools ?? {};
  assert.deepEqual(
    Object.keys(tools).sort(),
    ["rss_author_posts", "rss_fetch", "rss_substack_archive", "rss_tag_posts"],
  );
  for (const name of Object.keys(tools)) {
    assert.ok(tools[name].outputSchema, `${name} declares an outputSchema`);
  }
});
