# Phase 7: Universal Sources & Parameterization Audit - Pattern Map

**Mapped:** 2026-07-14
**Files analyzed:** 11 (5 NEW server/manifest, 2 MODIFY shared/server, 4 NEW/analog tests)
**Analogs found:** 11 / 11 (every file has a concrete in-repo analog)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `servers/discourse/server.js` (NEW) | server (source) | request-response (keyless JSON, untrusted host) | `servers/hn/server.js` (tool/normalize shape) + `servers/lemmy/server.js` (guarded untrustedHost getJson) | exact (hybrid) |
| `servers/mastodon/server.js` (NEW) | server (source) | request-response (keyless JSON, untrusted host) | `servers/hn/server.js` + `servers/lemmy/server.js` | exact (hybrid) |
| `servers/discourse/manifest.json` (NEW) | config | — | `servers/hn/manifest.json` | role-match (keyless → no `user_config`) |
| `servers/mastodon/manifest.json` (NEW) | config | — | `servers/hn/manifest.json` | role-match (keyless → no `user_config`) |
| `servers/lemmy/server.js` (MODIFY) | server (source) | request-response | itself + `normalizeInstance` pattern (RESEARCH §Code Examples) | self |
| `shared/contract.js` (MODIFY) | shared/contract | — | `TYPE` array line 28–41 (append-only) | self |
| `shared/credentials.js` (reference only) | shared/credentials | — | `lemmyInstance()` line 95–96 | reference |
| `shared/http_client.js` (reference only) | shared/transport | — | `getJson(url,{untrustedHost:true})` line 302, gate line 340–348 | reference |
| `test/parameterization-audit.test.js` (NEW) | test (static scan) | file-I/O + transform | `test/uniform-run.test.js` §(d) structural source scan (line 180–207) | role-match (source-text assertion) |
| `test/discourse.test.js` (NEW) | test | file-I/O (fixtures) + request-response (guarded getJson) | `test/lemmy.test.js` | exact |
| `test/mastodon.test.js` (NEW) | test | file-I/O (fixtures) + request-response (guarded getJson) | `test/lemmy.test.js` | exact |

**Key insight for the planner:** the two new servers are NOT pure HN copies. They take the HN *structure* (imports, `registerTool` raw-shape wiring, `map*` helpers, direct-run guard, `buildListEnvelope`/`toolResult` chain) but the *fetch call site* comes from Lemmy (`getJson(url, { untrustedHost: true })`). Copying bare HN `getJson(url)` reintroduces the SSRF hole (RESEARCH Anti-patterns / Pitfall 5).

---

## Pattern Assignments

### `servers/discourse/server.js` (NEW — server, request-response)

**Analogs:** `servers/hn/server.js` (shape), `servers/lemmy/server.js` (guarded fetch + instance base).

**Imports pattern** — copy from `servers/lemmy/server.js:29-42` (identical to HN plus nothing credential-related; Discourse is keyless so DROP the `lemmyInstance`/`lemmyJwt` imports):
```js
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { getJson } from "../../shared/http_client.js";
import {
  buildListEnvelope,
  buildDetailEnvelope,
  listEnvelopeShape,
  detailEnvelopeShape,
  toolResult,
} from "../../shared/contract.js";
```

**Instance normalization (D-13)** — NEW helper, not in any server today; source is RESEARCH §Code Examples (put it near the top like `permalink` in `hn/server.js:66`):
```js
function normalizeInstance(instance) {
  const raw = String(instance ?? "").trim();
  if (!raw) throw new Error("instance is required (e.g. https://meta.discourse.org)");
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withScheme.replace(/\/+$/, "");
}
```

**Field-map helpers** — mirror `mapHnHit` (`hn/server.js:74-88`) / `mapHnItem` (`hn/server.js:125-145`) in structure (pure field mapping, no derived text, `String(id)`, `?? null`, `tags ?? []`). Use the exact Discourse field names from RESEARCH §Discourse Field Maps: `mapDiscourseTopic(topic, usersById, base)` → `score: topic.like_count`, `num_comments: topic.reply_count`, `type: "topic"`, `permalink: \`${base}/t/${topic.slug}/${topic.id}\``. Detail helper returns `{ item, comments }` exactly like `mapHnItem` (`hn/server.js:125`), comments = `post_stream.posts[]` excluding index 0.

**Guarded fetch call site (D-14)** — copy the Lemmy call shape (`lemmy/server.js:157-160`), NOT the bare HN one (`hn/server.js:168`):
```js
const base = normalizeInstance(instance);
const raw = await getJson(`${base}/latest.json`, { untrustedHost: true });
```

**registerTool + envelope + toolResult chain** — copy `hn/server.js:157-177` verbatim in shape (raw zod shape as `inputSchema`, `listEnvelopeShape`/`detailEnvelopeShape` as `outputSchema`, handler ends `return toolResult(env)`):
```js
export const server = new McpServer({ name: "discourse", version: "1.0.0" });

server.registerTool(
  "discourse_latest",
  {
    title: "...",
    description: "... most recent page only ...", // D-03 doc note
    inputSchema: { instance: z.string(), category: z.string().optional(), limit: z.number().int().min(1).max(50).optional() },
    outputSchema: listEnvelopeShape,
  },
  async ({ instance, category, limit = 20 }) => {
    const base = normalizeInstance(instance);
    const path = category ? `/c/${category}/l/latest.json` : `/latest.json`; // D-02 Option 1: category = "slug/id"
    const raw = await getJson(`${base}${path}`, { untrustedHost: true });
    const usersById = new Map((raw.users ?? []).map((u) => [u.id, u.username]));
    const results = (raw.topic_list?.topics ?? []).slice(0, limit).map((t) => mapDiscourseTopic(t, usersById, base));
    const env = buildListEnvelope({ source: SOURCE, query: null, results });
    return toolResult(env);
  },
);
```
`period` is a zod enum on `discourse_top` (D-04): `z.enum(["daily","weekly","monthly","quarterly","yearly","all"])`.

**D-11 per-instance error mapping** — NEW wrap; the caught-error message from `getJson` is `getJson: HTTP <status> from <url>` (`http_client.js:369`) or `getJson: non-JSON response (login required?) from <url>` (`http_client.js:344`). Match on the string (getJson exposes no `err.status` — RESEARCH Pitfall 3):
```js
} catch (err) {
  if (/HTTP 40[13]/.test(err.message) || /non-JSON response \(login required/.test(err.message)) {
    throw new Error(`Discourse instance ${base} requires login or is not publicly accessible; only public instances are supported.`);
  }
  throw err;
}
```

**Direct-run transport guard** — copy `hn/server.js:264-271` verbatim.

---

### `servers/mastodon/server.js` (NEW — server, request-response)

**Analogs:** same set. Structure identical to Discourse above; differences are the four tools (D-06), the `limit` clamp, and the two special dispositions.

- **Imports / normalizeInstance / registerTool / toolResult / direct-run guard:** identical pattern to Discourse (and HN `hn/server.js`).
- **`limit` clamp (D-08):** zod `z.number().int().min(1).max(40).optional()` — RESEARCH confirms server clamps at 40; the zod max rejects `>40` before fetch with a readable message.
- **`mapMastodonStatus` (RESEARCH §Mastodon Field Maps):** `type: "status"`, `title: ""`, `author: status.account.acct`, `score: (favourites_count ?? 0) + (reblogs_count ?? 0)`, `num_comments: status.replies_count`, `tags: (status.tags ?? []).map(t => t.name)`. When `status.reblog` is non-null, map from `status.reblog` (Pitfall 4). Same `String(id)`/`?? null` discipline as `mapHnHit` (`hn/server.js:74`).
- **`mapTrendingTag`** → `type: "topic"`, `title: \`#${tag.name}\``, `score: sum(history.map(h => Number(h.uses)))`. **`mapTrendingLink`** → `type: "article"`.
- **D-11 lockdown mapping** — match `/HTTP (401|422)/` on the caught `getJson` error (`http_client.js:369` embeds status; the mastodon.social 422 is a terminal 4xx, no retry/stale — `http_client.js:367-371`):
```js
} catch (err) {
  if (/HTTP (401|422)/.test(err.message)) {
    throw new Error(`Instance ${base} disallows anonymous reads — try another instance (this tool is keyless).`);
  }
  throw err;
}
```
- **D-10 trends-disabled → empty envelope** — `[]`/200 needs no handling (yields `count:0`); catch only 404:
```js
let arr = [];
try {
  arr = await getJson(`${base}/api/v1/trends/tags`, { untrustedHost: true });
} catch (err) {
  if (!/HTTP 404/.test(err.message)) throw err;
}
const env = buildListEnvelope({ source: SOURCE, query: null, results: (arr ?? []).map(mapTrendingTag) });
```
- **D-12** — put the federation-sparsity sentence in the `mastodon_hashtag` `description`.

---

### `servers/discourse/manifest.json` + `servers/mastodon/manifest.json` (NEW — config)

**Analog:** `servers/hn/manifest.json` (structure) but these are **keyless** — no credentials, so omit `user_config` and the `mcp_config.env` credential refs (CLAUDE.md step 6: `user_config` `"sensitive": true` only for credentials; there are none here). Keep:
```json
{
  "manifest_version": "0.3",
  "name": "medium-research-discourse",
  "version": "1.0.0",
  "description": "... keyless; instance is a per-call tool parameter ...",
  "author": { "name": "Tushar Kanjariya" },
  "server": {
    "type": "node",
    "entry_point": "server.js",
    "mcp_config": { "command": "node", "args": ["${__dirname}/server.js"] }
  }
}
```
Note the `.mcpb` packing itself is deferred to v2 (CLAUDE.md); these are documentation/scaffold.

---

### `servers/lemmy/server.js` (MODIFY — add instance param, D-15)

**Analog:** self. RESEARCH corrects CONTEXT: **Lemmy already passes `untrustedHost: true`** (`lemmy/server.js:159, 195, 227, 231`) — the guard flag work is DONE. Remaining work is the instance tool param overriding the `lemmyInstance()` default.

**Current base resolution** (three handlers, `lemmy/server.js:150, 186, 221`):
```js
const base = lemmyInstance();   // → override with: normalizeInstance(instance ?? lemmyInstance())
```
`lemmyInstance()` supplies the default (`credentials.js:95-96`: `get("lemmyInstance") || "https://programming.dev"`).

**Change per tool:**
1. Add `instance: z.string().optional()` to each `inputSchema` (alongside existing `limit`/`sort`/`query`/`id`).
2. Resolve `const base = normalizeInstance(instance ?? lemmyInstance());` (reuse the same `normalizeInstance` helper — consider exporting it from a shared spot, or duplicate; planner decides).
3. **Auth security sub-decision (RESEARCH Runtime State note + Open Q3):** only attach the Bearer header when the effective `base` equals `lemmyCreds().instance` (the env host the JWT was minted for). When a tool-param `instance` differs from `LEMMY_INSTANCE`, send anonymous — do NOT replay the env-instance token to an arbitrary host. Today `lemmyAuthHeaders()` (`lemmy/server.js:108`) is unconditional; gate it on host match.

The existing `untrustedHost: true` on all four `getJson` calls already covers SSRF for the now-user-supplied host — no fetch-flag change needed.

---

### `shared/contract.js` (MODIFY — append TYPE values, D-05/D-09)

**Analog:** self, `TYPE` array `contract.js:28-41` (append-only, documented as such at `contract.js:22-27`). Current tail:
```js
  "issue", // GitHub issues (Phase 3, SRC-06)
  "package", // Libraries.io packages (Phase 3, SRC-07)
  "launch", // Product Hunt launches (Phase 3, SRC-08)
];
```
**Change:** append two values at the END (never reorder — `toolResult`/`ItemSchema` validate against it):
```js
  "topic",  // Discourse topics + Mastodon trending tags (Phase 7, SRC-10/SRC-11)
  "status", // Mastodon timeline statuses (Phase 7, SRC-11)
```
`article` already exists (used by Mastodon trending links, D-09) — no new value needed for links.

---

### `test/parameterization-audit.test.js` (NEW — static source scan, D-16)

**Closest analog:** `test/uniform-run.test.js` §(d) (`uniform-run.test.js:180-207`) — the one existing test that asserts over **source text** (`fn.toString()` + regex). This audit is the same idea applied to *file* source rather than a function. There is no existing test that `readFileSync`s a `server.js` and greps it — so mirror the `node:test` + `readFileSync` + regex-assert structure below.

**Structure to mirror** (from uniform-run §(d), generalized to files):
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readdirSync } from "node:fs";

const ALLOWED_HOSTS = new Set([
  "hn.algolia.com","news.ycombinator.com","api.stackexchange.com","dev.to",
  "medium.com","lobste.rs","libraries.io","api.producthunt.com","api.github.com",
  "www.youtube.com","www.reddit.com","programming.dev", // Lemmy env-overridable default
]);
const ALLOWED_SUFFIXES = [".substack.com", ".medium.com"];
```
**Scan scope (D-16):** `servers/*/server.js` (+ the rss `resolve*` helpers live in `servers/rss/server.js`). Do NOT scan `shared/` (RESEARCH §Scan scope — `isMediumHost`/DENY lists are security infra, not targets).

**Two implementation options (RESEARCH §SEC-02):**
- Option 1 (recommended): strip `//…` and `/*…*/` comments, then extract `https?:\/\/([a-z0-9.-]+)` hostnames and assert each ∈ `ALLOWED_HOSTS` or ends with an `ALLOWED_SUFFIXES` entry; also assert no literal `@handle` remains in stripped code.
- Option 2 (simpler): raw host-only allowlist scan, no comment strip — passes today because every currently-mentioned host is allowlisted; fails when a non-allowlisted host literal is added (e.g. a hardcoded `meta.discourse.org` in the new discourse server), which is exactly the SEC-02 threat.

**Host-literal inventory to seed the allowlist** (RESEARCH §SEC-02, live-grepped 2026-07-14 — all currently allowlisted):
| Server | Host literals | discourse/mastodon must contain: |
|--------|--------------|-------------------|
| hn | `hn.algolia.com`, `news.ycombinator.com` | — |
| stackexchange | `api.stackexchange.com` | — |
| lemmy | `programming.dev` (env-default + comment) | — |
| lobsters | `lobste.rs` | — |
| rss | `medium.com`, `pub.substack.com`, `www.reddit.com`, `www.youtube.com` | — |
| github | `api.github.com` | — |
| producthunt | `api.producthunt.com` | — |
| devto | `dev.to` | — |
| **discourse / mastodon (NEW)** | **NONE** (base is `${normalizeInstance(instance)}` — a variable) | the pass condition: no host literal at all |

The test **must pass** with discourse/mastodon present *because they contain no forum host literal* — that is the SEC-02 property being enforced.

---

### `test/discourse.test.js` + `test/mastodon.test.js` (NEW — tests)

**Analog:** `test/lemmy.test.js` (whole file) — the exact template for an offline source-server test with a guarded-path SSRF section.

Copy these sections from `lemmy.test.js`:
- **Fixture loader** (`lemmy.test.js:38-44`) — `readFileSync` from `./fixtures/<name>.json`.
- **Field-map units** (`lemmy.test.js:52-72`) — assert `map*` produces exact contract fields, `String(id)`, null-when-omitted score/comments.
- **HTML-strip-through-contract** (`lemmy.test.js:74-88`) — assert `text` is stripped via `buildListEnvelope`.
- **Contract conformance** (`lemmy.test.js:146-162`) — `ListEnvelopeSchema.parse(env)` / `DetailEnvelopeSchema.parse(env)` doesNotThrow; `env.count` matches.
- **Registration smoke** (`lemmy.test.js:166-178`) — `server._registeredTools` keys equal the expected tool names (3 for discourse, 4 for mastodon); each has an `outputSchema`.
- **SEC-01 guarded-path tests** (`lemmy.test.js:201-244`) — THE critical analog for the SSRF acceptance test (RESEARCH §Pitfall 5, Specific Ideas). Copy the `jsonRes` shim (`lemmy.test.js:202-209`), `publicLookup`/`privateLookup` (`lemmy.test.js:210-211`), and both tests: (a) public IP → valid envelope on guarded path; (b) private IP (`10.0.0.5` / test `127.0.0.1`,`169.254.169.254`) → `assert.rejects(..., /blocked address/)`. Drive `getJson` directly with `{ fetchImpl, sleep, lookup, untrustedHost: true, cacheKey }` — the handler wraps its own opts so there is no handler seam (documented `lemmy.test.js:196-200`).

**Mastodon-specific added tests** (from RESEARCH §Specifics):
- `limit > 40` rejected by zod (D-08) — assert the readable rejection.
- D-11 lockdown: a `jsonRes(422, {...})` → the handler maps to the "disallows anonymous reads" message.
- D-10 trends-disabled: `jsonRes(200, [])` → `count:0`; a 404 → `count:0`, no throw.

**Discourse-specific added tests:**
- D-11 login: content-type-gate HTML-200 (`jsonRes(200, {}, "text/html")`) and `HTTP 403` → the "requires login" message.
- Author resolution: `users[]` map → OP username, fallback to `last_poster_username`.

---

## Shared Patterns

### Guarded untrusted-host fetch (SEC-01 / D-14)
**Source:** `servers/lemmy/server.js:157-160` (verified already on guarded path); gate at `shared/http_client.js:340-348`.
**Apply to:** every `getJson` call in `servers/discourse/server.js` and `servers/mastodon/server.js`, and the (already-flagged) Lemmy calls.
```js
const raw = await getJson(`${base}/…`, { untrustedHost: true });
```
Never copy the bare HN form `getJson(`${ALGOLIA}/…`)` (`hn/server.js:168`) for an instance-parameterized host.

### Envelope assembly + dual content return (OUT-01/05)
**Source:** `shared/contract.js` — `buildListEnvelope` (`contract.js:137`), `buildDetailEnvelope` (`contract.js:142`), `toolResult` (`contract.js:160`).
**Apply to:** every handler in both new servers. Never hand-roll the envelope; `normalizeItem` does the `String(id)`/`?? null`/`stripHtml` uniformly.

### Instance normalization (D-13)
**Source:** RESEARCH §Code Examples (NEW — no in-repo analog; closest is the `permalink` const in `hn/server.js:66` for placement).
**Apply to:** discourse, mastodon, and the reparameterized Lemmy. Default scheme to `https`, strip trailing slash, no bare-name guessing.

### getJson error-message matching for tool-level UX (D-11)
**Source:** error strings at `shared/http_client.js:344` (content-type gate) and `:369` (`HTTP <status>`); `getJson` throws a plain `Error` with NO `.status` (RESEARCH Pitfall 3).
**Apply to:** discourse (`/HTTP 40[13]/`, `/non-JSON response \(login required/`) and mastodon (`/HTTP (401|422)/`, `/HTTP 404/` for trends). Match the message string; do not read `err.status`.

### registerTool raw-shape wiring
**Source:** `servers/hn/server.js:157-177` (and identical `lemmy/server.js:133-168`).
**Apply to:** all new tools. Pass RAW zod shapes (`{ instance: z.string(), … }`), NOT `z.object(...)`, as `inputSchema`; use `listEnvelopeShape`/`detailEnvelopeShape` as `outputSchema` (contract validates `structuredContent` on return).

### Direct-run transport guard
**Source:** `servers/hn/server.js:264-271` (identical `lemmy/server.js:243-250`).
**Apply to:** both new servers verbatim — so importing for tests does not start a live stdio transport.

---

## No Analog Found

None. Every file has a concrete in-repo analog. Two things have NO direct code precedent and come from RESEARCH instead:
- `normalizeInstance()` — new helper; RESEARCH §Code Examples is the authority (placement analog = `hn/server.js:66`).
- The file-source-scanning audit test — closest is the function-source-scanning `uniform-run.test.js:180-207`; adapt `fn.toString()` → `readFileSync` of `server.js`.

## Metadata

**Analog search scope:** `servers/{hn,lemmy}/server.js`, `servers/hn/manifest.json`, `shared/{contract,credentials,http_client}.js`, `test/{lemmy,uniform-run}.test.js`; `test/*.js` inventory (15 files).
**Files scanned:** 9 read in full/targeted + directory listings.
**Pattern extraction date:** 2026-07-14
</content>
</invoke>
