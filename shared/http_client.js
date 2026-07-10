// shared/http_client.js — the ONLY HTTP path for every server (CLAUDE.md).
// Servers MUST call getJson() rather than fetch() so they inherit caching,
// retry/backoff, per-request timeout, and stale-cache fallback uniformly.
//
// Resilience policy (faithful to ARCHITECTURE §8, FOUND-02, ROADMAP Phase 1
// Success Criterion 2):
//   - Serve an in-TTL cache hit before touching the network.
//   - Retry ONLY transient failures: network/TypeError, AbortError (timeout),
//     a non-JSON body, and 5xx {500,502,503,504}. Backoff steps: 500/1000/2000ms
//     (3 retries after the initial attempt).
//   - STRICT no-4xx-retry: NO 4xx is ever retried — INCLUDING 429 and 408.
//     ARCHITECTURE §8 ("never retry 4xx") is applied literally with no
//     Retry-After exception (RESEARCH Open Questions RESOLVED — strict).
//   - On exhausting retries, serve a stale cache entry if one exists; otherwise
//     throw a clear error naming the URL.
//
// fetch and sleep are injectable so unit tests drive retry timing without the
// real network and without real waits.

import { createHash } from "node:crypto";
import { BlockList, isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";
import { getFresh, getStale, set } from "./cache.js";
import { rssAllowedHosts, userAgent } from "./credentials.js";

const BACKOFF_MS = [500, 1000, 2000];
const RETRYABLE_5XX = new Set([500, 502, 503, 504]);
const DEFAULT_TTL_MS = 15 * 60 * 1000; // ~15 min (FOUND-01)
const DEFAULT_TIMEOUT_MS = 10_000;

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Marks an error that should trigger a retry (5xx / non-JSON body).
class RetryableError extends Error {}

// Strip the query string from a URL before it appears in a thrown error message
// (WR-01, CLAUDE.md security: keys are "never logged or echoed in output/errors").
// A credential carried as a query param (e.g. Stack Exchange's `key=`) must never
// leak into an error surfaced back through an MCP tool result. Callers that also
// key the cache must pass a secret-free `cacheKey` — this only guards error text.
function redactUrl(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return String(url).split("?")[0];
  }
}

// `init` carries the fetch RequestInit (headers, and for POST also method/body);
// the abort `signal` is merged in so every verb shares one timeout path.
async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ===========================================================================
// SSRF guard (D-01 scheme allowlist, D-02 private-range denylist + per-hop
// redirect re-validation, D-03 optional operator allowlist). This is the
// project's FIRST fetch path whose outbound host comes from UNTRUSTED tool
// input (rss_fetch(url)), so the controls live here on the single shared
// chokepoint where no server can bypass them and every future text source
// inherits them. See 04-RESEARCH "Security Domain" + OWASP SSRF (Node.js).
// ===========================================================================

// D-02 denylist — native subnet classification via node:net BlockList; NEVER
// hand-rolled CIDR/bitmask math (a classic SSRF-bypass source). Ranges per
// RFC1918 / RFC6598 (CGNAT) / RFC3927 (link-local, incl. 169.254.169.254 cloud
// metadata) / RFC4193 (IPv6 ULA) plus loopback/multicast/reserved.
const DENY = new BlockList();
// IPv4
DENY.addSubnet("0.0.0.0", 8, "ipv4"); // "this host"
DENY.addSubnet("10.0.0.0", 8, "ipv4"); // RFC1918 private
DENY.addSubnet("100.64.0.0", 10, "ipv4"); // CGNAT (RFC6598)
DENY.addSubnet("127.0.0.0", 8, "ipv4"); // loopback
DENY.addSubnet("169.254.0.0", 16, "ipv4"); // link-local incl. 169.254.169.254 metadata
DENY.addSubnet("172.16.0.0", 12, "ipv4"); // RFC1918 private
DENY.addSubnet("192.0.0.0", 24, "ipv4"); // IETF protocol assignments
DENY.addSubnet("192.168.0.0", 16, "ipv4"); // RFC1918 private
DENY.addSubnet("198.18.0.0", 15, "ipv4"); // benchmarking
DENY.addSubnet("224.0.0.0", 4, "ipv4"); // multicast
DENY.addSubnet("240.0.0.0", 4, "ipv4"); // reserved
// IPv6
DENY.addAddress("::", "ipv6"); // unspecified (in6addr_any) — connect() routes to loopback (CR-01)
DENY.addAddress("::1", "ipv6"); // loopback
DENY.addSubnet("fc00::", 7, "ipv6"); // ULA (private)
DENY.addSubnet("fe80::", 10, "ipv6"); // link-local
DENY.addSubnet("ff00::", 8, "ipv6"); // multicast
DENY.addSubnet("64:ff9b::", 96, "ipv6"); // NAT64 well-known prefix (RFC6052) — embeds a v4 target (WR-03)

const ALLOWED_SCHEMES = new Set(["http:", "https:"]); // D-01

// Strip surrounding brackets that WHATWG URL keeps on IPv6 hostnames
// (new URL("http://[::1]/").hostname === "[::1]").
function unbracket(hostname) {
  return hostname.replace(/^\[/, "").replace(/\]$/, "");
}

// Canonicalize an IPv4-mapped IPv6 address (::ffff:a.b.c.d in dotted form, the
// WHATWG-normalized hex form ::ffff:HHHH:HHHH, or the SIIT/IPv4-translatable
// ::ffff:0:HHHH:HHHH form, WR-03) down to its IPv4 form so a mapped encoding of a
// blocked IP cannot slip past BlockList (T-04-05). Non-mapped addresses pass
// through unchanged. (The NAT64 well-known prefix 64:ff9b::/96 is caught directly
// by the DENY BlockList above, not here.)
function canonicalizeMappedV4(address) {
  const m = /^::ffff:(.+)$/i.exec(address);
  if (!m) return address;
  const tail = m[1];
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(tail)) return tail; // ::ffff:1.2.3.4
  // SIIT / IPv4-translatable form ::ffff:0:HHHH:HHHH (RFC7915) — a leading 0 group
  // precedes the two v4 hextets. Check BEFORE the bare HHHH:HHHH case.
  const siit = /^0:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(tail);
  if (siit) {
    const hi = parseInt(siit[1], 16);
    const lo = parseInt(siit[2], 16);
    return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
  }
  const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(tail); // ::ffff:HHHH:HHHH
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
  }
  return address;
}

// True if `address` (an IP literal or a DNS-resolved address) falls in the DENY
// denylist after canonicalizing any IPv4-mapped IPv6 encoding.
function isBlockedAddress(address) {
  const ip = canonicalizeMappedV4(address);
  const kind = isIP(ip);
  if (kind === 0) return false; // not an IP we can classify — leave to DNS path
  return DENY.check(ip, kind === 6 ? "ipv6" : "ipv4");
}

/**
 * Validate a URL against the SSRF policy and return the parsed URL, or throw a
 * clear (redacted) error. Called on the INITIAL host AND on every redirect
 * Location before the socket is followed (see fetchTextManual).
 *
 * Policy: (D-01) scheme ∈ {http,https}; (D-03) if RSS_ALLOWED_HOSTS is set, host
 * must be listed; (D-02) resolve the host and reject if ANY resolved address — or
 * an IP-literal host itself — is loopback/private/link-local/CGNAT/ULA/reserved,
 * including IPv4-mapped-IPv6 encodings.
 *
 * `lookup` is injectable so unit tests force a host to "resolve" to a private IP
 * with no real DNS. Errors use redactUrl (origin+path only) so no query-string
 * secret can leak (T-04-08 / V7); hostnames are not secrets.
 *
 * ACCEPTED RESIDUAL — TOCTOU / DNS rebinding (WR-02): this guard resolves-and-
 * checks the host here, but the subsequent fetch performs its OWN, INDEPENDENT
 * DNS resolution inside undici when it opens the socket. The checked address is
 * not pinned to the connected address, so a resolver returning a public IP at
 * check time and an internal IP at connect time (short-TTL DNS rebinding) is NOT
 * fully closed. Per-hop redirect re-validation (fetchTextManual) narrows the
 * redirect vector, but the check-vs-connect gap on every host remains open
 * without IP pinning (pass a custom `lookup` to a per-request undici dispatcher
 * so the socket connects to the exact validated IP, or re-check the peer IP
 * post-connect). This is a knowingly-accepted low risk for a LOCAL, single-user,
 * personal-use MCP tool (matches 04-CONTEXT / 04-RESEARCH "Security Domain") — it
 * is documented here rather than silently left as a hole.
 *
 * @param {string} rawUrl
 * @param {object} [opts]
 * @param {Function} [opts.lookup=dnsLookup] injectable dns.lookup (tests)
 * @returns {Promise<URL>} the validated, parsed URL
 */
export async function assertSafeUrl(rawUrl, { lookup = dnsLookup } = {}) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error(`rss: invalid URL`);
  }

  // D-04: reject credentials embedded in the URL (user:pass@host). A
  // userinfo-carrying URL can smuggle a target past naive host checks and can
  // leak a secret in logs — the redacted origin+path form is used so no secret
  // is echoed back through a tool result. Tightens getText/RSS callers too (A3).
  if (u.username || u.password) {
    throw new Error(`rss: credentials in URL are not allowed [${redactUrl(u.href)}]`);
  }

  if (!ALLOWED_SCHEMES.has(u.protocol)) {
    throw new Error(
      `rss: scheme ${u.protocol} not allowed (http/https only) [${redactUrl(u.href)}]`,
    );
  }

  const host = unbracket(u.hostname);

  const allow = rssAllowedHosts(); // D-03
  if (allow && !allow.has(host.toLowerCase())) {
    throw new Error(`rss: host ${host} not in RSS_ALLOWED_HOSTS`);
  }

  // An IP-literal host needs no DNS — classify it directly (offline, deterministic).
  if (isIP(host)) {
    if (isBlockedAddress(host)) {
      throw new Error(`rss: host ${host} resolves to a blocked address`);
    }
    return u;
  }

  // Resolve EVERY address the host maps to and reject if ANY is internal (D-02).
  const addrs = await lookup(host, { all: true });
  for (const { address } of addrs) {
    if (isBlockedAddress(address)) {
      throw new Error(`rss: host ${host} resolves to a blocked address`);
    }
  }
  return u;
}

const MAX_REDIRECTS = 5;

// Fetch `startUrl` with SSRF validation on the initial host AND on every redirect
// Location, following manually (native fetch auto-follows up to 20 hops WITHOUT
// re-checking the SSRF policy per hop — that is the redirect-to-internal /
// DNS-rebinding hole, T-04-04). Returns the first non-3xx Response (its
// status/body is handled by getText's attempt loop); throws past the hop cap.
async function fetchTextManual(fetchImpl, startUrl, init, timeoutMs, lookup) {
  let url = (await assertSafeUrl(startUrl, { lookup })).href;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetchWithTimeout(
      fetchImpl,
      url,
      { ...init, redirect: "manual" },
      timeoutMs,
    );
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res; // 3xx without Location — let the caller handle it
      // RE-VALIDATE the redirect target before following (D-02 per-hop guard).
      url = (await assertSafeUrl(new URL(loc, url).href, { lookup })).href;
      continue;
    }
    return res; // 2xx/4xx/5xx — getText's loop classifies it
  }
  throw new Error(`rss: too many redirects`);
}

/**
 * GET url and parse JSON, with caching + resilient retry.
 *
 * OPT-IN SSRF guard (SEC-01, D-01/D-02): pass `untrustedHost: true` when the
 * host comes from untrusted tool/LLM input (e.g. a user-supplied instance host).
 * That routes the fetch through the SAME `fetchTextManual` → `assertSafeUrl`
 * denylist + per-hop redirect re-validation that `getText`/RSS use (no forked
 * guard, D-02), and adds a content-type gate (D-03): a 200 whose content-type is
 * HTML is treated as a terminal "login required / not JSON" response — NOT
 * retried and NOT served from stale — instead of crashing on `JSON.parse`.
 * Fixed-host callers pass no flag and behave byte-for-byte unchanged, paying
 * ZERO DNS cost (D-01). Non-default ports are allowed — only the resolved IP
 * decides rejection (D-05).
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {Record<string,string>} [opts.headers]
 * @param {number} [opts.ttlMs=900000]      cache TTL (~15 min)
 * @param {number} [opts.timeoutMs=10000]   per-attempt AbortController timeout
 * @param {string} [opts.cacheKey=url]      logical cache key — NEVER a secret
 * @param {Function} [opts.fetchImpl=fetch] injectable fetch (tests)
 * @param {Function} [opts.sleep]           injectable delay (tests)
 * @param {boolean} [opts.untrustedHost=false] route through the SSRF guard +
 *                                          content-type gate (untrusted host)
 * @param {Function} [opts.lookup=dnsLookup] injectable dns.lookup (SSRF tests)
 * @returns {Promise<any>} parsed JSON value (fresh, refreshed, or stale)
 */
export async function getJson(url, opts = {}) {
  const {
    headers = {},
    ttlMs = DEFAULT_TTL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    cacheKey = url,
    fetchImpl = fetch,
    sleep = realSleep,
    untrustedHost = false,
    lookup = dnsLookup,
  } = opts;

  const fresh = getFresh(cacheKey);
  if (fresh !== undefined) return fresh;

  let lastError;
  // WR-04: the stale fallback is for TRANSIENT upstream failures only
  // (5xx/network/timeout/non-JSON). A hard 4xx (incl. 404/400) is a definitive
  // "the resource is gone/bad" answer — serving stale for it would surface a
  // deleted resource forever (the cache never evicts). Track whether the TERMINAL
  // failure was transient so only that path may fall back to stale.
  let transientFailure = false;

  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    try {
      // When the host is untrusted, validate-then-fetch through the shared SSRF
      // guard (re-validating every redirect hop, D-02); otherwise the fixed-host
      // path stays byte-for-byte identical and never resolves DNS (D-01).
      const response = untrustedHost
        ? await fetchTextManual(fetchImpl, url, { headers }, timeoutMs, lookup)
        : await fetchWithTimeout(fetchImpl, url, { headers }, timeoutMs);

      if (response.ok) {
        // D-03 content-type gate (untrustedHost only): a 200 carrying an HTML
        // content-type is a login/interstitial page, not JSON. Gate on a POSITIVE
        // HTML signal (Pitfall 6 — do NOT reject merely-non-json types; text/plain
        // carrying valid JSON must still parse) and fail closed: terminal error,
        // NOT retryable, NOT served from stale — mirroring the 4xx path below.
        if (untrustedHost) {
          const ct = response.headers.get("content-type") ?? "";
          if (/html/i.test(ct)) {
            lastError = new Error(
              `getJson: non-JSON response (login required?) from ${redactUrl(url)}`,
            );
            transientFailure = false;
            break;
          }
        }
        let value;
        try {
          value = await response.json();
        } catch {
          // Non-JSON body (e.g. an HTML block page) — treat as a failed attempt
          // (Pitfall 6), never an uncaught crash.
          throw new RetryableError(`getJson: non-JSON body from ${redactUrl(url)}`);
        }
        set(cacheKey, value, ttlMs);
        return value;
      }

      const { status } = response;
      if (RETRYABLE_5XX.has(status)) {
        throw new RetryableError(`getJson: HTTP ${status} from ${redactUrl(url)}`);
      }

      // Any 4xx (incl. 429/408) or other non-retryable status: do NOT retry, and
      // do NOT serve stale — this is a definitive client-error terminal state.
      lastError = new Error(`getJson: HTTP ${status} from ${redactUrl(url)}`);
      transientFailure = false;
      break;
    } catch (err) {
      lastError = err;

      const isTimeout = err && err.name === "AbortError";
      const isNetwork = err instanceof TypeError;
      const isRetryable = err instanceof RetryableError || isTimeout || isNetwork;

      if (!isRetryable) {
        transientFailure = false;
        break; // non-retryable — stop immediately
      }

      if (attempt < BACKOFF_MS.length) {
        await sleep(BACKOFF_MS[attempt]);
        continue;
      }
      // Retries exhausted on a transient failure — stale fallback is allowed.
      transientFailure = true;
    }
  }

  if (transientFailure) {
    const stale = getStale(cacheKey);
    if (stale !== undefined) return stale;
  }

  throw lastError ?? new Error(`getJson: request to ${redactUrl(url)} failed`);
}

/**
 * POST a JSON body to url and parse the JSON response, with the SAME caching +
 * resilient retry/stale machinery as getJson() (BACKOFF_MS, RETRYABLE_5XX,
 * strict no-4xx-retry, stale fallback). POST-based sources (e.g. GraphQL or
 * POST-search APIs) route through here so they never call fetch() directly
 * (CLAUDE.md).
 *
 * The cache key folds in the body so two different POST payloads to the same
 * URL do NOT collide: `url + ":" + sha1(JSON.stringify(body))`. The key is a
 * LOGICAL, non-secret key — never put a secret in it.
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {any}    [opts.body]              JSON-serializable request body
 * @param {Record<string,string>} [opts.headers]
 * @param {number} [opts.ttlMs=900000]      cache TTL (~15 min)
 * @param {number} [opts.timeoutMs=10000]   per-attempt AbortController timeout
 * @param {string} [opts.cacheKey]          logical cache key — NEVER a secret;
 *                                          defaults to url+sha1(body)
 * @param {Function} [opts.fetchImpl=fetch] injectable fetch (tests)
 * @param {Function} [opts.sleep]           injectable delay (tests)
 * @returns {Promise<any>} parsed JSON value (fresh, refreshed, or stale)
 */
export async function postJson(url, opts = {}) {
  const {
    body,
    headers = {},
    ttlMs = DEFAULT_TTL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    cacheKey,
    fetchImpl = fetch,
    sleep = realSleep,
  } = opts;

  const serialized = JSON.stringify(body);
  // Body-aware default key so distinct payloads to one URL never collide.
  const key =
    cacheKey ??
    `${url}:${createHash("sha1").update(serialized ?? "").digest("hex")}`;

  const fresh = getFresh(key);
  if (fresh !== undefined) return fresh;

  const init = {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: serialized,
  };

  let lastError;
  // WR-04: stale fallback only for transient terminal failures (see getJson).
  let transientFailure = false;

  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    try {
      const response = await fetchWithTimeout(fetchImpl, url, init, timeoutMs);

      if (response.ok) {
        let value;
        try {
          value = await response.json();
        } catch {
          throw new RetryableError(`postJson: non-JSON body from ${redactUrl(url)}`);
        }
        set(key, value, ttlMs);
        return value;
      }

      const { status } = response;
      if (RETRYABLE_5XX.has(status)) {
        throw new RetryableError(`postJson: HTTP ${status} from ${redactUrl(url)}`);
      }

      // Any 4xx (incl. 429/408) or other non-retryable status: do NOT retry, and
      // do NOT serve stale — this is a definitive client-error terminal state.
      lastError = new Error(`postJson: HTTP ${status} from ${redactUrl(url)}`);
      transientFailure = false;
      break;
    } catch (err) {
      lastError = err;

      const isTimeout = err && err.name === "AbortError";
      const isNetwork = err instanceof TypeError;
      const isRetryable = err instanceof RetryableError || isTimeout || isNetwork;

      if (!isRetryable) {
        transientFailure = false;
        break; // non-retryable — stop immediately
      }

      if (attempt < BACKOFF_MS.length) {
        await sleep(BACKOFF_MS[attempt]);
        continue;
      }
      // Retries exhausted on a transient failure — stale fallback is allowed.
      transientFailure = true;
    }
  }

  if (transientFailure) {
    const stale = getStale(key);
    if (stale !== undefined) return stale;
  }

  throw lastError ?? new Error(`postJson: request to ${redactUrl(url)} failed`);
}

/**
 * GET url and return the RAW response text, with the SAME caching + resilient
 * retry/backoff + stale-fallback machinery as getJson() (BACKOFF_MS,
 * RETRYABLE_5XX, strict no-4xx-retry, transient-only stale gate). This is the
 * shared SSRF-guarded text-fetch path the RSS server builds on (D-07): the
 * outbound host comes from untrusted tool input, so assertSafeUrl runs on the
 * initial host AND every redirect hop (redirect:"manual" — see fetchTextManual).
 *
 * Deltas from getJson: (1) response.text() instead of response.json() — an empty
 * body is a NORMAL result, feed validity is the parser's concern (04-03), not the
 * HTTP layer's; (2) a default `User-Agent: userAgent()` header (reddit `.rss`
 * needs a real UA) merged with caller headers; (3) an injectable `lookup` so SSRF
 * tests force a resolved IP with no real DNS. An assertSafeUrl rejection (invalid
 * URL, bad scheme, blocked host, redirect-to-internal) is a plain Error — NOT
 * retryable and NOT served from stale — so a 302→internal-IP is rejected outright.
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {Record<string,string>} [opts.headers]
 * @param {number} [opts.ttlMs=900000]      cache TTL (~15 min)
 * @param {number} [opts.timeoutMs=10000]   per-attempt AbortController timeout
 * @param {string} [opts.cacheKey=url]      logical cache key — NEVER a secret
 * @param {Function} [opts.fetchImpl=fetch] injectable fetch (tests)
 * @param {Function} [opts.sleep]           injectable delay (tests)
 * @param {Function} [opts.lookup=dnsLookup] injectable dns.lookup (SSRF tests)
 * @returns {Promise<string>} raw response text (fresh, refreshed, or stale)
 */
export async function getText(url, opts = {}) {
  const {
    headers = {},
    ttlMs = DEFAULT_TTL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    cacheKey = url,
    fetchImpl = fetch,
    sleep = realSleep,
    lookup = dnsLookup,
  } = opts;

  const fresh = getFresh(cacheKey);
  if (fresh !== undefined) return fresh;

  // Reddit `.rss` (and some feeds) 429/403 without a real UA — default one in.
  const mergedHeaders = { "User-Agent": userAgent(), ...headers };

  let lastError;
  // WR-04: stale fallback only for TRANSIENT terminal failures (see getJson).
  let transientFailure = false;

  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    try {
      // SSRF validate-then-fetch, re-validating every redirect Location (D-02).
      const response = await fetchTextManual(
        fetchImpl,
        url,
        { headers: mergedHeaders },
        timeoutMs,
        lookup,
      );

      if (response.ok) {
        // Empty body is a normal result — no non-text special-casing (D-07).
        const value = await response.text();
        set(cacheKey, value, ttlMs);
        return value;
      }

      const { status } = response;
      if (RETRYABLE_5XX.has(status)) {
        throw new RetryableError(`getText: HTTP ${status} from ${redactUrl(url)}`);
      }

      // Any 4xx (incl. 429/408) or other non-retryable status: do NOT retry, and
      // do NOT serve stale — this is a definitive client-error terminal state.
      lastError = new Error(`getText: HTTP ${status} from ${redactUrl(url)}`);
      transientFailure = false;
      break;
    } catch (err) {
      lastError = err;

      const isTimeout = err && err.name === "AbortError";
      const isNetwork = err instanceof TypeError;
      const isRetryable = err instanceof RetryableError || isTimeout || isNetwork;

      if (!isRetryable) {
        // Includes an assertSafeUrl SSRF rejection — fail closed, never retry/stale.
        transientFailure = false;
        break;
      }

      if (attempt < BACKOFF_MS.length) {
        await sleep(BACKOFF_MS[attempt]);
        continue;
      }
      // Retries exhausted on a transient failure — stale fallback is allowed.
      transientFailure = true;
    }
  }

  if (transientFailure) {
    const stale = getStale(cacheKey);
    if (stale !== undefined) return stale;
  }

  throw lastError ?? new Error(`getText: request to ${redactUrl(url)} failed`);
}
