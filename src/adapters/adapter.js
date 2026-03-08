/**
 * Base adapter interface. All ATS adapters implement these methods.
 *
 * scrapeRole(url) → RoleData — scrape a single job posting
 * listRoles(boardUrl, filters) → RoleData[] — list all roles from a board
 */

export class NetworkError extends Error {
  constructor(message, { url, statusCode } = {}) {
    super(message);
    this.name = 'NetworkError';
    this.url = url;
    this.statusCode = statusCode;
  }
}

export class SchemaError extends Error {
  constructor(message, { url, rawData } = {}) {
    super(message);
    this.name = 'SchemaError';
    this.url = url;
    this.rawData = rawData;
  }
}

export class RemovedError extends Error {
  constructor(message, { url, statusCode } = {}) {
    super(message);
    this.name = 'RemovedError';
    this.url = url;
    this.statusCode = statusCode;
  }
}

/**
 * Per-domain rate limiter. Ensures minimum delay between requests to the same domain.
 */
export class DomainRateLimiter {
  constructor(minDelayMs = 1500) {
    this.minDelayMs = minDelayMs;
    this.lastRequestTime = new Map();
  }

  async waitForDomain(domain) {
    const lastTime = this.lastRequestTime.get(domain) || 0;
    const elapsed = Date.now() - lastTime;
    if (elapsed < this.minDelayMs) {
      await new Promise(resolve => setTimeout(resolve, this.minDelayMs - elapsed));
    }
    this.lastRequestTime.set(domain, Date.now());
  }
}

export const USER_AGENT = 'JobSearchBot/1.0 (personal use)';

/**
 * Safe fetch wrapper with timeout, retries, and rate limiting.
 */
export async function safeFetch(url, options = {}, rateLimiter = null) {
  const { retries = 1, timeout = 15000, ...fetchOptions } = options;
  const parsedUrl = new URL(url);

  if (rateLimiter) {
    await rateLimiter.waitForDomain(parsedUrl.hostname);
  }

  fetchOptions.headers = {
    'User-Agent': USER_AGENT,
    ...fetchOptions.headers,
  };

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
        redirect: 'follow',
      });
      clearTimeout(timer);
      return response;
    } catch (err) {
      if (attempt === retries) {
        throw new NetworkError(`Failed to fetch ${url}: ${err.message}`, { url });
      }
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}
