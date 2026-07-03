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
  server,
} from "../servers/rss/server.js";
import { buildListEnvelope, ListEnvelopeSchema } from "../shared/contract.js";

const fixture = (name) =>
  readFileSync(
    fileURLToPath(new URL(`./fixtures/${name}.xml`, import.meta.url)),
    "utf8",
  );

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

test("rss server registers exactly ['rss_fetch']", () => {
  const names = Object.keys(server._registeredTools ?? {}).sort();
  assert.deepEqual(names, ["rss_fetch"]);
});

test("rss_fetch declares an outputSchema (contract validation on return)", () => {
  assert.ok(server._registeredTools.rss_fetch.outputSchema, "rss_fetch has an outputSchema");
});
