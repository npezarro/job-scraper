import { DomainRateLimiter } from './adapters/adapter.js';
import * as greenhouse from './adapters/greenhouse.js';
import * as ashby from './adapters/ashby.js';
import * as lever from './adapters/lever.js';
import * as generic from './adapters/generic.js';

/**
 * Core scraping orchestrator.
 * Routes URLs to the appropriate adapter based on domain.
 */

const ATS_PATTERNS = [
  { pattern: /greenhouse\.io/i, adapter: greenhouse, name: 'greenhouse' },
  { pattern: /ashbyhq\.com/i, adapter: ashby, name: 'ashby' },
  { pattern: /lever\.co/i, adapter: lever, name: 'lever' },
];

/**
 * Detect which adapter to use for a given URL.
 */
export function detectAdapter(url) {
  for (const { pattern, adapter, name } of ATS_PATTERNS) {
    if (pattern.test(url)) return { adapter, name };
  }
  return { adapter: generic, name: 'generic' };
}

/**
 * Scrape a single URL, auto-detecting the adapter.
 */
export async function scrapeUrl(url, rateLimiter = null) {
  const rl = rateLimiter || new DomainRateLimiter();
  const { adapter, name } = detectAdapter(url);
  const result = await adapter.scrapeRole(url, rl);
  return { ...result, atsType: result.atsType || name };
}

/**
 * Scrape multiple URLs with concurrency control.
 */
export async function scrapeUrls(urls, options = {}) {
  const { onProgress } = options;
  const rateLimiter = new DomainRateLimiter(1500);

  const results = [];
  let completed = 0;

  // Sequential to respect rate limits per domain
  for (const url of urls) {
    try {
      const result = await scrapeUrl(url, rateLimiter);
      results.push({ success: true, data: result });
    } catch (err) {
      results.push({ success: false, url, error: err.message, errorType: err.name });
    }
    completed++;
    if (onProgress) onProgress(completed, urls.length);
  }

  return results;
}

/**
 * List all roles from a company board.
 */
export async function listCompanyRoles(companyConfig, rateLimiter = null) {
  const rl = rateLimiter || new DomainRateLimiter();
  const { adapter } = detectAdapter(companyConfig.boardUrl);

  if (!adapter.listRoles) {
    throw new Error(`Adapter for ${companyConfig.ats} does not support listing roles`);
  }

  return adapter.listRoles(companyConfig.boardUrl, {}, rl);
}
