# Codebase Structure

**Analysis Date:** 2026-07-07

## Directory Layout

```
medium-research-mcp/
├── package.json            # Single root package (type: module, private); deps: MCP SDK, zod, fast-xml-parser
├── package-lock.json
├── .env.example            # Documented env vars for local dev (real .env is gitignored)
├── .gitignore              # node_modules/, .env, *.mcpb, OS noise
├── CLAUDE.md               # Project instructions (output contract, add-a-server recipe, don'ts)
├── .claude/                # Claude Code config (CLAUDE.md, settings.local.json)
├── docs/                   # Design docs
│   ├── PRD.md
│   ├── ARCHITECTURE.md     # The authoritative design spec (§4 contract, §8 resilience)
│   ├── ROADMAP.md
│   └── server-spec-template.md   # Template for specifying a new source server
├── shared/                 # Mandatory core modules (every server imports these)
│   ├── contract.js         # Output contract: schemas, normalizeItem, stripHtml, envelopes, toolResult
│   ├── http_client.js      # ONLY fetch path: getJson/postJson/getText + cache/retry/stale + SSRF guard
│   ├── cache.js            # In-memory TTL cache with stale retention
│   ├── credentials.js      # ONLY process.env reader; ENV_VAR map; required/optional helpers
│   ├── auth.js             # Reddit OAuth2 + Lemmy login → cached tokens
│   └── rank.js             # Branch-free multi-source mergeRank / filterByMinScore
├── servers/                # One directory per source server (independent stdio process)
│   ├── hn/                 # Hacker News — the reference/template server
│   │   ├── server.js       # McpServer + registerTool blocks + map*() helpers
│   │   └── manifest.json   # .mcpb manifest scaffold (packing deferred to v2)
│   ├── stackexchange/      # Same two-file shape in every server dir
│   ├── lobsters/
│   ├── devto/
│   ├── lemmy/
│   ├── github/
│   ├── librariesio/        # REQUIRED key (LIBRARIESIO_KEY)
│   ├── producthunt/        # REQUIRED token (PRODUCTHUNT_TOKEN); the one GraphQL/POST server
│   └── rss/                # Generic RSS/Atom fetcher; single rss_fetch tool; SSRF-guarded
├── test/                   # node --test suite (offline, fixture-driven)
│   ├── <module>.test.js    # One test file per shared module and per server
│   ├── uniform-run.test.js # OUT-02 proof: branch-free merge across recorded fixtures
│   └── fixtures/           # REAL captured API payloads (JSON/XML), one set per source
├── examples/
│   └── uniform-run.mjs     # Manual LIVE multi-source merge demo (not run by npm test)
└── .planning/              # GSD planning artifacts (phases, milestones, codebase docs)
```

## Directory Purposes

**`shared/`:**
- Purpose: everything that must behave identically across all sources — the "hub"
- Contains: 6 flat ES modules, no subdirectories, no index/barrel file
- Key files: `shared/contract.js` (the load-bearing output contract), `shared/http_client.js` (the only HTTP path), `shared/credentials.js` (the only `process.env` reader)

**`servers/<source>/`:**
- Purpose: one self-contained MCP server per source; contains ONLY MCP wiring + source-specific field mapping
- Contains: exactly two files each — `server.js` and `manifest.json`. There is no per-server `package.json`; all servers share the root dependency tree and import shared modules via relative paths (`../../shared/*.js`)
- Key files: `servers/hn/server.js` is the canonical template every new server copies (REST/GET); `servers/producthunt/server.js` is the POST/GraphQL variant; `servers/rss/server.js` is the untrusted-URL/XML variant

**`test/`:**
- Purpose: offline unit tests — field-mapping helpers validated against captured fixtures, registration smokes, shared-module behavior (retry timing via injectable `sleep`, SSRF via injectable `lookup`)
- Contains: one `.test.js` per shared module and per server, plus `test/fixtures/`
- Key files: `test/http_client.test.js` (largest, covers retry/stale/SSRF), `test/contract.test.js`, `test/uniform-run.test.js`

**`test/fixtures/`:**
- Purpose: real API payloads captured once, named `<source>-<shape>.json` (e.g. `hn-story.json`, `github-issues.json`, `producthunt-post-detail.json`) or `rss-<format>.xml` (`rss-atom.xml`, `rss-rss2.xml`, `rss-reddit.xml`, `rss-youtube.xml`)

**`docs/`:**
- Purpose: the authoritative design documents; `docs/ARCHITECTURE.md` §4 (contract) and §8 (resilience) are cited throughout code comments; `docs/server-spec-template.md` is the starting spec for a new source

**`examples/`:**
- Purpose: manual, network-hitting smoke scripts; deliberately outside `test/` so `node --test` never discovers them

**`.planning/`:**
- Purpose: GSD workflow artifacts (phases 01–04, milestones, research, this codebase map)
- Generated: by GSD commands
- Committed: Yes

## Key File Locations

**Entry Points:**
- `servers/<source>/server.js`: each is an executable stdio MCP server (`node servers/hn/server.js`); connects a transport only when run directly

**Configuration:**
- `package.json`: single root manifest; `"type": "module"`, Node >=18, `npm test` → `node --test`
- `.env.example`: documents every env var (`STACKEXCHANGE_KEY`, `GITHUB_TOKEN`, `LIBRARIESIO_KEY`, `PRODUCTHUNT_TOKEN`, `REDDIT_*`, `LEMMY_*`, `MCP_USER_AGENT`, `RSS_ALLOWED_HOSTS`)
- `servers/<source>/manifest.json`: `.mcpb` manifest scaffold; credentials declared under `user_config` with `"sensitive": true` and injected into `mcp_config.env` via `${user_config.<field>}`

**Core Logic:**
- `shared/contract.js`: output contract — start here before touching any output shape
- `shared/http_client.js`: all HTTP, resilience policy, SSRF guard (`assertSafeUrl`)
- `shared/credentials.js`: `ENV_VAR` map — the single source of truth for variable names

**Testing:**
- `test/<name>.test.js` + `test/fixtures/`: run everything with `npm test`

## Naming Conventions

**Files:**
- All lowercase; shared modules use `snake_case.js` (`http_client.js`); servers are always exactly `server.js` inside a lowercase source directory; tests are `<subject>.test.js`; fixtures are `<source>-<shape>.json`/`.xml`

**Directories:**
- `servers/<source>/` uses the flat lowercase source name (`stackexchange`, `librariesio`, `producthunt` — no hyphens)

**Tools:**
- `<prefix>_<verb/noun>` with a short per-source prefix: `hn_*`, `so_*` (Stack Exchange), `lobsters_*`, `devto_*`, `lemmy_*`, `gh_*` (GitHub), `librariesio_*`, `producthunt_*`, `rss_*`
- Canonical trio per source: a hot/top list tool, a `*_search` tool, and a `*_get`/detail tool; deviate only when the source genuinely lacks an operation (RSS has only `rss_fetch`)

**Code identifiers:**
- camelCase functions; exported per-source mappers named `map<Source><Shape>` (`mapHnHit`, `mapHnItem`); module constants UPPER_SNAKE (`ALGOLIA`, `SOURCE`, `PH_GRAPHQL`, `BACKOFF_MS`); every server defines `const SOURCE = "<name>"` used in envelopes

## Where to Add New Code

**New source server:**
- Copy `servers/hn/` → `servers/<source>/` (or `servers/producthunt/` for a GraphQL/POST source, `servers/rss/` for a text/XML source)
- Implementation: `servers/<source>/server.js` — swap endpoints, write `map*()` helpers onto the contract item shape, register tools with raw Zod shapes and `outputSchema: listEnvelopeShape` / `detailEnvelopeShape`, return `toolResult(envelope)`
- Manifest: `servers/<source>/manifest.json` mirroring `servers/hn/manifest.json` (mark credentials `"sensitive": true`)
- Tests: `test/<source>.test.js` + captured payloads in `test/fixtures/<source>-*.json`
- New credential: add to `ENV_VAR` + a helper in `shared/credentials.js` (never read `process.env` in the server); document it in `.env.example`
- New item `type`: APPEND to the `TYPE` array in `shared/contract.js` — never reorder or remove

**New shared behavior:**
- Only if every server needs it: add to the relevant `shared/*.js` module; do NOT add a second cache, fetch path, or env reader

**New tool on an existing server:**
- Add a `server.registerTool(...)` block in that server's `server.js`, following the existing prefix convention

**Utilities:**
- Consumer-facing, contract-only helpers (like merge/rank) go in `shared/rank.js` or a sibling `shared/` module; demo scripts go in `examples/`

## Special Directories

**`node_modules/`:**
- Purpose: root-level dependency tree shared by all servers
- Generated: Yes (`npm install`)
- Committed: No

**`.planning/`:**
- Purpose: GSD planning state (phases, milestones, codebase docs, research)
- Generated: by GSD commands
- Committed: Yes

**`*.mcpb` artifacts:**
- Purpose: packaged MCP bundles (packing deferred to v2 — `manifest.json` files are scaffolds; no `build-mcpb.sh` scripts exist yet despite CLAUDE.md mentioning them)
- Generated: Yes (future)
- Committed: No (gitignored)

---

*Structure analysis: 2026-07-07*
