// shared/auth.js — username/password -> cached token, one shared path for two
// providers (CRED-02): the OPTIONAL Reddit OAuth2 password grant (D-03/D-04) and the
// Lemmy 0.19+ login (D-05). Both exchange credentials ONCE for a token that is cached
// in-memory; thereafter only the token is used.
//
// Security invariants (CRED-02, ASVS V2/V7/V8):
//   - Passwords live ONLY inside the exchange() closure and the outgoing request body.
//   - The cache stores { token, expires } — the password NEVER enters the cache.
//   - Nothing here logs a credential; auth errors name only the HTTP status, never the
//     password value.
//   - A failed exchange leaves no cache entry (only a successful exchange writes one).
//
// fetch is injectable (opts.fetchImpl) so tests drive exchanges offline with no real
// network and no live auth endpoints.

import { redditCreds, lemmyCreds, userAgent } from "./credentials.js";

// key -> { token, expires }. Keyed by a stable, non-secret identity:
//   "reddit:<user>"  |  "lemmy:<instance>:<user>"
// Exported so tests can assert the entry holds a token only (never a password).
export const tokenCache = new Map();

/**
 * The single cached-token path shared by both providers (D-05).
 * Returns the cached token while it is still within TTL; otherwise runs exchange(),
 * caches { token, expires }, and returns the token. A throwing exchange writes nothing.
 *
 * @param {string} key stable, non-secret cache identity
 * @param {number} ttlMs fallback TTL when the exchange reports no expiry
 * @param {() => Promise<{ token: string, expiresInMs?: number }>} exchange
 * @returns {Promise<string>} the token
 */
export async function cachedToken(key, ttlMs, exchange) {
  const entry = tokenCache.get(key);
  if (entry && entry.expires > Date.now()) return entry.token;
  const { token, expiresInMs } = await exchange();
  tokenCache.set(key, { token, expires: Date.now() + (expiresInMs ?? ttlMs) });
  return token;
}

/**
 * OPTIONAL Reddit OAuth2 password grant. Returns null when Reddit creds are absent so
 * the caller degrades to keyless www.reddit.com/<sub>/.json reads (D-03/D-04).
 *
 * When all four Reddit creds are present, POSTs the password grant to
 * https://www.reddit.com/api/v1/access_token with HTTP Basic (client_id:secret) and a
 * real User-Agent (Reddit REQUIRES one). Token cached ~55 min (tokens live ~1h).
 *
 * Note: 2FA appends ":TOTP" to the password before the grant; authenticated API calls
 * target oauth.reddit.com in later phases (D-04).
 *
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<string|null>} the access token, or null to degrade to keyless
 */
export async function redditToken({ fetchImpl = fetch } = {}) {
  const c = redditCreds();
  if (!c) return null;
  return cachedToken(`reddit:${c.user}`, 55 * 60_000, async () => {
    // Buffer is a Node built-in — no base64 dependency (RESEARCH "Don't Hand-Roll").
    const basic = Buffer.from(`${c.id}:${c.secret}`).toString("base64");
    const body = new URLSearchParams({
      grant_type: "password",
      username: c.user,
      password: c.pass,
    });
    const res = await fetchImpl("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": userAgent(),
      },
      body,
    });
    if (!res.ok) throw new Error(`Reddit auth failed: ${res.status}`);
    const j = await res.json(); // { access_token, expires_in }
    return { token: j.access_token, expiresInMs: (j.expires_in ?? 3600) * 1000 };
  });
}

/**
 * Lemmy 0.19+ login. Returns null when Lemmy creds are absent (D-05). Otherwise POSTs
 * { username_or_email, password } to <instance>/api/v3/user/login and caches the jwt
 * (~24h) for use as an `Authorization: Bearer <jwt>` header in later phases.
 *
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<string|null>} the jwt, or null to degrade to anonymous reads
 */
export async function lemmyJwt({ fetchImpl = fetch } = {}) {
  const c = lemmyCreds();
  if (!c) return null;
  return cachedToken(`lemmy:${c.instance}:${c.user}`, 24 * 3600_000, async () => {
    const res = await fetchImpl(`${c.instance}/api/v3/user/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username_or_email: c.user, password: c.pass }),
    });
    if (!res.ok) throw new Error(`Lemmy login failed: ${res.status}`);
    const j = await res.json(); // { jwt }
    return { token: j.jwt };
  });
}
