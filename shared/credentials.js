// shared/credentials.js — the ONE and ONLY module that reads process.env (CRED-01;
// CLAUDE.md "never read process.env in a server"). Every server and auth.js resolves
// credentials through these helpers so variable names live in exactly one place and no
// secret is ever hardcoded.
//
// ENV_VAR is the single source of truth: logical name -> environment variable name.
// A private get(name) is the only place process.env is touched in the entire repo
// (grep-verifiable: `grep -rn "process.env" shared servers` should match only here).
//
// Split of responsibilities (ARCHITECTURE §6, CRED-04):
//   - REQUIRED sources (Libraries.io, Product Hunt) build on requireCred() and throw a
//     clear "set <ENV_VAR>" error when unset — fail loudly, never call an API unauthed.
//   - OPTIONAL sources (Stack Exchange, GitHub, Reddit, Lemmy) DEGRADE: they return {}
//     / undefined when unset so the caller falls back to keyless/anonymous access.
//
// Security: no credential value is ever logged here; errors name only the ENV_VAR.

const ENV_VAR = {
  stackExchangeKey: "STACKEXCHANGE_KEY",
  githubToken: "GITHUB_TOKEN",
  librariesIoKey: "LIBRARIESIO_KEY",
  productHuntToken: "PRODUCTHUNT_TOKEN",
  redditClientId: "REDDIT_CLIENT_ID",
  redditClientSecret: "REDDIT_CLIENT_SECRET",
  redditUsername: "REDDIT_USERNAME",
  redditPassword: "REDDIT_PASSWORD",
  lemmyInstance: "LEMMY_INSTANCE",
  lemmyUsername: "LEMMY_USERNAME",
  lemmyPassword: "LEMMY_PASSWORD",
  userAgent: "MCP_USER_AGENT",
  rssAllowedHosts: "RSS_ALLOWED_HOSTS",
};

// The single process.env access point in the repo. Treats empty string as absent so a
// blank env var never masquerades as a real credential.
const get = (name) => process.env[ENV_VAR[name]] || undefined;

/**
 * Resolve a REQUIRED credential or throw a clear, actionable error (CRED-04).
 * The message names the missing ENV_VAR (never the value) so operators know exactly
 * what to set.
 * @param {keyof typeof ENV_VAR} name logical credential name
 * @returns {string} the credential value
 */
export function requireCred(name) {
  const value = get(name);
  if (!value) throw new Error(`Missing credential: set ${ENV_VAR[name]}`);
  return value;
}

// --- Per-service request fragments (CRED-01) ---------------------------------
// Scaffolded now; most are consumed by the source servers built in Phase 2/3.

/** OPTIONAL: Stack Exchange API key as a query-param fragment; {} when unset. */
export const stackExchangeParams = () => {
  const key = get("stackExchangeKey");
  return key ? { key } : {};
};

/** OPTIONAL: GitHub PAT as an Authorization header fragment; {} when unset. */
export const githubHeaders = () => {
  const token = get("githubToken");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/** REQUIRED: Libraries.io API key as a query-param fragment; throws when unset. */
export const librariesIoParams = () => ({ api_key: requireCred("librariesIoKey") });

/** REQUIRED: Product Hunt token as an Authorization header; throws when unset. */
export const productHuntHeaders = () => ({
  Authorization: `Bearer ${requireCred("productHuntToken")}`,
});

/**
 * User-Agent string for outbound requests. Reddit REQUIRES a real, non-blank UA or it
 * returns 429/403, so this always resolves to a usable default when MCP_USER_AGENT is
 * unset.
 */
export const userAgent = () =>
  get("userAgent") ||
  "medium-research-mcp/1.0 (+https://github.com/TusharRedlioDesigns/medium-research-mcp)";

/**
 * OPTIONAL Lemmy instance base URL for anonymous reads (D-05). Returns the
 * operator-set LEMMY_INSTANCE or defaults to https://programming.dev (chosen for
 * dev-topic relevance). The value is the FULL base URL incl. the https:// scheme and
 * no trailing slash, so callers interpolate `${lemmyInstance()}/api/v3/...` exactly as
 * auth.js does (see shared/auth.js lemmyJwt, which builds `${c.instance}/api/v3/...`).
 *
 * Security: LEMMY_INSTANCE is operator-set env (read only via get()), NOT a per-call
 * tool parameter — untrusted tool input can never select the outbound host (SSRF
 * mitigation, T-02-02-SSRF). Must be a trusted full HTTPS URL.
 * @returns {string} the Lemmy instance base URL incl. scheme
 */
export const lemmyInstance = () =>
  get("lemmyInstance") || "https://programming.dev";

/**
 * OPTIONAL Reddit OAuth2 password-grant credentials (D-04). Returns an object ONLY when
 * all four of client_id, client_secret, username, and password are present; otherwise
 * returns undefined so Reddit degrades to keyless www.reddit.com/.json reads (D-03).
 * @returns {{ id:string, secret:string, user:string, pass:string } | undefined}
 */
export function redditCreds() {
  const id = get("redditClientId");
  const secret = get("redditClientSecret");
  const user = get("redditUsername");
  const pass = get("redditPassword");
  return id && secret && user && pass ? { id, secret, user, pass } : undefined;
}

/**
 * OPTIONAL Lemmy login credentials (D-05). Returns an object ONLY when instance,
 * username, and password are all present; otherwise undefined (no login, no app needed
 * for Lemmy — just username + password).
 * @returns {{ instance:string, user:string, pass:string } | undefined}
 */
export function lemmyCreds() {
  const instance = get("lemmyInstance");
  const user = get("lemmyUsername");
  const pass = get("lemmyPassword");
  return instance && user && pass ? { instance, user, pass } : undefined;
}

/**
 * OPTIONAL operator allowlist of hostnames the RSS fetcher may reach (D-03).
 *
 * RSS_ALLOWED_HOSTS is a comma-separated list of hostnames. It is a HARDENING KNOB,
 * NOT a credential, and it is OPERATOR-SET ENV — never a per-call tool parameter
 * (untrusted `rss_fetch(url)` input must never widen the allowlist). Like the other
 * optional helpers it degrades quietly (never throws):
 *   - unset / blank / only-separators  -> returns `null`  = DEFAULT mode: any public
 *     host is fetchable EXCEPT the private-range denylist enforced in http_client.js.
 *   - set to one or more hostnames      -> returns a `Set<string>` of trimmed,
 *     lowercased hostnames = LOCK-DOWN mode: only these hosts pass assertSafeUrl.
 *
 * The value is consumed by `assertSafeUrl` in shared/http_client.js (the SSRF
 * chokepoint); this is the ONLY place RSS_ALLOWED_HOSTS is read (CRED-01).
 * @returns {Set<string> | null}
 */
export function rssAllowedHosts() {
  const raw = get("rssAllowedHosts");
  if (!raw) return null;
  const hosts = raw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return hosts.length ? new Set(hosts) : null;
}
