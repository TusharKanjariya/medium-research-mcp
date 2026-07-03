---
phase: 04-rss-multiplier-output-proof
reviewed: 2026-07-03T00:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - shared/http_client.js
  - shared/credentials.js
  - servers/rss/server.js
  - shared/rank.js
  - examples/uniform-run.mjs
findings:
  critical: 1
  warning: 3
  info: 2
  total: 6
status: issues_found
---

# Phase 4: Code Review Report

**Reviewed:** 2026-07-03
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

Reviewed the RSS multiplier + output-proof slice with extra scrutiny on the SSRF
guard (`assertSafeUrl` / `getText` / `fetchTextManual`) in `shared/http_client.js`,
the RSS 2.0 / Atom / YouTube field maps in `servers/rss/server.js`, and the
branch-free `mergeRank` in `shared/rank.js`.

The SSRF guard is well-engineered on the axes the phase called out: the scheme
allowlist correctly rejects `file:`/`data:`/`ftp:`/`gopher:`; the private/loopback
denylist uses `net.BlockList` (no hand-rolled CIDR math); `dns.lookup({all:true})`
checks **every** resolved address; IPv4-mapped-IPv6 is canonicalized in both dotted
(`::ffff:169.254.169.254`) and WHATWG-hex (`::ffff:a9fe:a9fe`) forms; and redirects
are re-validated on **every** hop via a bounded `redirect:"manual"` loop
(`MAX_REDIRECTS=5`, no infinite loop, fails closed on a 30x→internal). I verified
these by exercising `assertSafeUrl` directly — decimal/hex IPv4 (`2130706433`,
`0x7f000001`), the metadata IP in mapped forms, and `::1` are all correctly BLOCKED.

Two denylist gaps remain, however, and one is a real bypass of the "block this-host"
control (**CR-01**). Verified with the injectable lookup path: `http://[::]/` (the
IPv6 unspecified address, the direct analog of the explicitly-blocked `0.0.0.0/8`)
is **ALLOWED** and on POSIX systems `connect()` to `[::]` reaches loopback-bound
services. NAT64 (`64:ff9b::/96`) is also uncovered (**WR-03**).

Separately, the RSS field maps let a non-string slip into the `author` contract
field, which fails the SDK's `outputSchema` validation and **hard-errors** the tool
on an odd feed — a violation of the project's never-hard-error rule (**WR-01**).

Confirmed clean: no `fetch(` outside `http_client.js`; no `process.env` outside
`credentials.js` (only tests touch it, which is fine); the fast-xml-parser@4.5.7
`processEntities` DoS bounds (`maxExpandedLength`/`maxExpansionDepth`/
`maxTotalExpansions`/`maxEntitySize`) are **real** options the library enforces
(confirmed against `node_modules/fast-xml-parser/src/xmlparser/OrderedObjParser.js`);
`mergeRank`'s nulls-last comparator is total and stable and reads only `score`; the
output contract (`score`/`num_comments` both null, dual `structuredContent`+`content`
via `toolResult`) is intact for the well-formed case.

## Critical Issues

### CR-01: SSRF denylist omits IPv6 unspecified `::` — reaches loopback services

**File:** `shared/http_client.js:88-92` (DENY BlockList, IPv6 section)
**Issue:** The IPv4 side explicitly blocks `0.0.0.0/8` ("this host", line 77), but
the IPv6 denylist blocks only `::1`, `fc00::/7`, `fe80::/10`, and `ff00::/8`. The
IPv6 unspecified address `::` (`in6addr_any`) is **not** in any block. I verified
`assertSafeUrl("http://[::]/")` returns ALLOWED. On Linux/macOS a `connect()` to
`::` is routed to loopback (the IPv6 analog of connecting to `0.0.0.0`), so this is
a real bypass to any localhost-bound internal service — exactly what the denylist
exists to prevent. Because the untrusted `rss_fetch(url)` host flows straight into
`assertSafeUrl`, an attacker-supplied `http://[::]:PORT/` reaches local services.
**Fix:** Add the unspecified address (and, defensively, its dotted form is already
covered by `0.0.0.0/8`):
```js
// IPv6
DENY.addAddress("::", "ipv6");   // unspecified — routes to loopback on connect
DENY.addAddress("::1", "ipv6");  // loopback
DENY.addSubnet("fc00::", 7, "ipv6");
DENY.addSubnet("fe80::", 10, "ipv6");
DENY.addSubnet("ff00::", 8, "ipv6");
```

## Warnings

### WR-01: RSS `dc:creator` / Atom author `name` bypass string coercion — object in `author` hard-errors the tool

**File:** `servers/rss/server.js:142` (`mapRssItem`), `servers/rss/server.js:171` (`mapAtomEntry`)
**Issue:** `text` is safe because `normalizeItem` runs it through `stripHtml` →
`String(...)` (contract.js:87,121). But `author` is passed through un-coerced:
`author: item["dc:creator"] ?? textOf(item.author) ?? null` and
`author: entry.author?.name ?? null`. When a `<dc:creator>` (or an Atom `<name>`)
element carries an attribute, fast-xml-parser yields an object
(`{ "#text": "Jane", "@_foo": "bar" }`), not a string. That object lands in `author`,
and since `itemShape.author = z.string().nullable()`, the SDK's `outputSchema`
validation on `structuredContent` **rejects** it and throws — the whole `rss_fetch`
call hard-errors on an odd-but-valid feed, violating the project rule that a tool
"never hard-errors on odd feeds" (CLAUDE.md / Pitfall 4). Verified:
`ItemSchema.safeParse` on such an item returns `success: false`
("expected string, received object"). Note `item["content:encoded"]` and
`entry["media:group"]["media:description"]` are also un-wrapped but land in `text`,
which `String()`-coerces downstream — so only `author` is exposed.
**Fix:** Route author through `textOf` (which already collapses `#text`):
```js
// mapRssItem
author: textOf(item["dc:creator"]) ?? textOf(item.author) ?? null,
// mapAtomEntry
author: textOf(entry.author?.name) ?? null,
```

### WR-02: TOCTOU / DNS-rebinding residual is not documented in-file and not mitigated by IP pinning

**File:** `shared/http_client.js:148-213` (`assertSafeUrl` + `fetchTextManual`)
**Issue:** `assertSafeUrl` resolves the host via `dns.lookup` and validates the
addresses, but then `fetchWithTimeout(fetchImpl, url, ...)` performs an **independent**
DNS resolution inside undici when it connects. The address that was checked is not
pinned to the address that is connected — a resolve-check-then-connect (TOCTOU) gap
that a DNS-rebinding attacker (short-TTL record returning a public IP on the first
lookup and a private IP on the connect) can exploit to defeat the denylist. The
per-hop comment (line 190) documents *redirect*-based rebinding, but the more
fundamental check-vs-connect gap for the initial (and every) host is not documented
anywhere in the file. The phase brief explicitly asked that this be
"understood/documented, not a silent hole." As written it is a silent residual.
**Fix:** At minimum, document the limitation in the `assertSafeUrl` docblock. To
actually close it, pin the validated address by passing a custom `lookup` to a
per-request undici dispatcher/agent so the socket connects to the exact IP that
passed the denylist (or re-check the peer IP post-connect).

### WR-03: SSRF denylist omits NAT64 (`64:ff9b::/96`) and SIIT-mapped v4 forms

**File:** `shared/http_client.js:88-118` (IPv6 DENY + `canonicalizeMappedV4`)
**Issue:** `canonicalizeMappedV4` only recognizes the `::ffff:` prefix. IPv6 forms
that embed an IPv4 address by other well-known mechanisms are neither canonicalized
nor listed in DENY. Verified ALLOWED: `http://[64:ff9b::a9fe:a9fe]/` (NAT64
well-known prefix → 169.254.169.254), `http://[64:ff9b::7f00:1]/` (→ 127.0.0.1), and
`http://[::ffff:0:a9fe:a9fe]/` (SIIT/IPv4-translatable form). In an IPv6-only or
NAT64-enabled cloud/CGN environment (increasingly common) a NAT64 gateway will
translate these to the embedded — private/metadata — IPv4, bypassing the guard.
Practical exploitability requires NAT64 infrastructure, hence Warning not Critical,
but it is the same defense class the code already implements for `::ffff:`.
**Fix:** Add `DENY.addSubnet("64:ff9b::", 96, "ipv6")` (NAT64 well-known prefix),
and extend `canonicalizeMappedV4` to also fold the `::ffff:0:HHHH:HHHH` SIIT form.

## Info

### IN-01: RDF/RSS-1.0 date field is `dc:date`, not `pubDate` — `created_utc` always null for RDF feeds

**File:** `servers/rss/server.js:145,190-196`
**Issue:** `mapRssItem` reads only `item.pubDate`, but RDF (RSS 1.0,
`rdf:RDF>item`) feeds carry the timestamp in `<dc:date>` (ISO-8601), not `<pubDate>`.
So every item from an RDF feed gets `created_utc: null` even when a valid date is
present — a silent data-quality loss (no crash; contract still holds).
**Fix:** In `mapRssItem`, fall back: `created_utc: toIso(item.pubDate ?? item["dc:date"])`.

### IN-02: Demo depends on the SDK-internal `_registeredTools`

**File:** `examples/uniform-run.mjs:51`
**Issue:** `server._registeredTools?.[tool]` reaches into a private McpServer field;
an SDK minor bump could rename it and silently break the demo (the `if (!registered)`
guard turns it into a thrown "tool not registered" for every source). Acceptable for
a manual, non-CI smoke, but worth a note.
**Fix:** Prefer a public accessor if the SDK exposes one, or pin the SDK version the
demo is known to work against in a comment.

---

_Reviewed: 2026-07-03_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
