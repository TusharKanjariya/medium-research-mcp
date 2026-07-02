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
import { getFresh, getStale, set } from "./cache.js";

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

/**
 * GET url and parse JSON, with caching + resilient retry.
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {Record<string,string>} [opts.headers]
 * @param {number} [opts.ttlMs=900000]      cache TTL (~15 min)
 * @param {number} [opts.timeoutMs=10000]   per-attempt AbortController timeout
 * @param {string} [opts.cacheKey=url]      logical cache key — NEVER a secret
 * @param {Function} [opts.fetchImpl=fetch] injectable fetch (tests)
 * @param {Function} [opts.sleep]           injectable delay (tests)
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
  } = opts;

  const fresh = getFresh(cacheKey);
  if (fresh !== undefined) return fresh;

  let lastError;

  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    try {
      const response = await fetchWithTimeout(
        fetchImpl,
        url,
        { headers },
        timeoutMs,
      );

      if (response.ok) {
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

      // Any 4xx (incl. 429/408) or other non-retryable status: do NOT retry.
      lastError = new Error(`getJson: HTTP ${status} from ${redactUrl(url)}`);
      break;
    } catch (err) {
      lastError = err;

      const isTimeout = err && err.name === "AbortError";
      const isNetwork = err instanceof TypeError;
      const isRetryable = err instanceof RetryableError || isTimeout || isNetwork;

      if (!isRetryable) break; // non-retryable — stop immediately

      if (attempt < BACKOFF_MS.length) {
        await sleep(BACKOFF_MS[attempt]);
        continue;
      }
      // retries exhausted — fall through to stale/throw below
    }
  }

  const stale = getStale(cacheKey);
  if (stale !== undefined) return stale;

  throw lastError ?? new Error(`getJson: request to ${redactUrl(url)} failed`);
}

/**
 * POST a JSON body to url and parse the JSON response, with the SAME caching +
 * resilient retry/stale machinery as getJson() (BACKOFF_MS, RETRYABLE_5XX,
 * strict no-4xx-retry, stale fallback). The GraphQL sources (Hashnode) route
 * through here so they never call fetch() directly (CLAUDE.md).
 *
 * The cache key folds in the body so two different GraphQL queries to the same
 * URL do NOT collide: `url + ":" + sha1(JSON.stringify(body))`. The key is a
 * LOGICAL, non-secret key (these sources are keyless) — never put a secret in it.
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

      // Any 4xx (incl. 429/408) or other non-retryable status: do NOT retry.
      lastError = new Error(`postJson: HTTP ${status} from ${redactUrl(url)}`);
      break;
    } catch (err) {
      lastError = err;

      const isTimeout = err && err.name === "AbortError";
      const isNetwork = err instanceof TypeError;
      const isRetryable = err instanceof RetryableError || isTimeout || isNetwork;

      if (!isRetryable) break; // non-retryable — stop immediately

      if (attempt < BACKOFF_MS.length) {
        await sleep(BACKOFF_MS[attempt]);
        continue;
      }
      // retries exhausted — fall through to stale/throw below
    }
  }

  const stale = getStale(key);
  if (stale !== undefined) return stale;

  throw lastError ?? new Error(`postJson: request to ${redactUrl(url)} failed`);
}
