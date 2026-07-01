# Server spec — <SOURCE>

Fill this in at the start of each server's GSD phase (the Plan step). Keep it
short; it's the contract the Execute and Verify steps work against.

## Source
- **Name / id:** <e.g. Lobsters / "lobsters">
- **Why it matters for blogging:** <what signal it gives>
- **Docs:** <API docs URL>

## API
- **Base URL(s):** <…>
- **Key endpoints:** <list / search / detail>
- **Search support:** <native full-text? tag-only? client-side filter?>
- **Rate limits:** <keyless vs keyed>

## Auth
- **Required / optional / none:** <…>
- **Env vars:** <e.g. NONE, or SOURCE_API_KEY>
- **Helper:** <shared/credentials.js fn, or shared/auth.js, or none>
- **Degrades keyless?:** <yes/no — if no, fail with a clear message>

## Tools
| Tool | Purpose | Inputs |
|---|---|---|
| `<src>_trending` | front/hot list | `limit` |
| `<src>_search` | search | `query`, … |
| `<src>_get` | detail + comments | `id` |

## Field mapping (source → normalized item)
| Normalized | Source field |
|---|---|
| `score` | <points/votes/stars/reactions> |
| `num_comments` | <comments/answers, or null> |
| `title` | <…> |
| `author` | <…> |
| `url` | <external link> |
| `permalink` | <canonical page> |
| `created_utc` | <iso8601 field> |
| `tags` | <tags/flair/language> |
| `text` | <body/excerpt, or null> |
| `type` | <story/question/article/repo/post> |

## Acceptance criteria
- [ ] Tools register; visible via MCP Inspector.
- [ ] `normalize*()` helpers unit-tested against mock payloads.
- [ ] Output matches the contract (ARCHITECTURE.md §4) exactly.
- [ ] Fetches go through `getJson()`; no direct `fetch`, no `process.env` reads.
- [ ] Auth behavior correct (keyless fallback or clear required-cred error).
- [ ] `manifest.json` + `build-mcpb.sh` present; secrets marked `sensitive`.
