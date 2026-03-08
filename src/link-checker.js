import pLimit from 'p-limit';
import { USER_AGENT } from './adapters/adapter.js';
import { LinkCheckResultSchema } from './schema.js';

/**
 * Batch URL health checker.
 * Extracts all URLs from a markdown file and checks each one.
 */

const GENERIC_CAREER_PATTERNS = [
  /\/careers\/?$/i,
  /\/jobs\/?$/i,
  /\/career\/?$/i,
  /\/join-us\/?$/i,
  /\/positions\/?$/i,
  /\/openings\/?$/i,
];

/**
 * Extract all URLs from markdown text.
 */
export function extractUrls(markdown) {
  const urlPattern = /https?:\/\/[^\s)>\]"'`]+/g;
  const matches = markdown.match(urlPattern) || [];
  // Deduplicate
  return [...new Set(matches)].map(url => {
    // Remove trailing punctuation that's likely not part of the URL
    return url.replace(/[.,;:!?)}\]]+$/, '');
  });
}

/**
 * Check a single URL's health.
 */
async function checkUrl(url, timeout = 15000) {
  const result = {
    url,
    status: 0,
    statusText: 'unknown',
    redirectUrl: undefined,
    redirectsToGeneric: false,
    error: undefined,
    checkedAt: new Date().toISOString(),
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    // Try HEAD first (cheaper)
    let response;
    try {
      response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'User-Agent': USER_AGENT },
      });
    } catch {
      // Some servers reject HEAD, fall back to GET
      response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'User-Agent': USER_AGENT },
      });
    }

    clearTimeout(timer);

    result.status = response.status;
    result.statusText = response.statusText;

    // Check if it was redirected
    if (response.url !== url && response.redirected) {
      result.redirectUrl = response.url;
      // Check if redirect target is a generic career page
      result.redirectsToGeneric = GENERIC_CAREER_PATTERNS.some(p => p.test(response.url));
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      result.status = 0;
      result.statusText = 'timeout';
      result.error = `Request timed out after ${timeout}ms`;
    } else {
      result.status = 0;
      result.statusText = 'error';
      result.error = err.message;
    }
  }

  return LinkCheckResultSchema.parse(result);
}

/**
 * Check all URLs from markdown input.
 * Returns results grouped by status.
 */
export async function checkLinks(markdown, options = {}) {
  const { concurrency = 5, timeout = 15000, onProgress } = options;
  const urls = extractUrls(markdown);
  const limit = pLimit(concurrency);

  let completed = 0;
  const results = await Promise.all(
    urls.map(url =>
      limit(async () => {
        const result = await checkUrl(url, timeout);
        completed++;
        if (onProgress) onProgress(completed, urls.length, result);
        return result;
      })
    )
  );

  // Group results by status
  const grouped = {
    ok: results.filter(r => r.status >= 200 && r.status < 300),
    redirect: results.filter(r => r.redirectUrl && !r.redirectsToGeneric),
    redirectGeneric: results.filter(r => r.redirectsToGeneric),
    clientError: results.filter(r => r.status >= 400 && r.status < 500),
    serverError: results.filter(r => r.status >= 500),
    timeout: results.filter(r => r.statusText === 'timeout'),
    error: results.filter(r => r.statusText === 'error'),
  };

  return { results, grouped, totalChecked: urls.length };
}

/**
 * Format link check results as markdown.
 */
export function formatLinkReport(checkResult) {
  const { grouped, totalChecked } = checkResult;
  const lines = [];

  lines.push(`# Link Health Report`);
  lines.push(`\nChecked **${totalChecked}** URLs at ${new Date().toISOString()}\n`);

  lines.push(`## Summary\n`);
  lines.push(`| Status | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| OK (2xx) | ${grouped.ok.length} |`);
  lines.push(`| Redirect (valid) | ${grouped.redirect.length} |`);
  lines.push(`| Redirect (generic/expired) | ${grouped.redirectGeneric.length} |`);
  lines.push(`| Client Error (4xx) | ${grouped.clientError.length} |`);
  lines.push(`| Server Error (5xx) | ${grouped.serverError.length} |`);
  lines.push(`| Timeout | ${grouped.timeout.length} |`);
  lines.push(`| Connection Error | ${grouped.error.length} |`);

  if (grouped.clientError.length > 0) {
    lines.push(`\n## Broken Links (4xx)\n`);
    lines.push(`| URL | Status |`);
    lines.push(`|-----|--------|`);
    for (const r of grouped.clientError) {
      lines.push(`| ${r.url} | ${r.status} ${r.statusText} |`);
    }
  }

  if (grouped.redirectGeneric.length > 0) {
    lines.push(`\n## Likely Expired (Redirect to Generic Career Page)\n`);
    lines.push(`| URL | Redirects To |`);
    lines.push(`|-----|-------------|`);
    for (const r of grouped.redirectGeneric) {
      lines.push(`| ${r.url} | ${r.redirectUrl} |`);
    }
  }

  if (grouped.serverError.length > 0) {
    lines.push(`\n## Server Errors (5xx)\n`);
    lines.push(`| URL | Status |`);
    lines.push(`|-----|--------|`);
    for (const r of grouped.serverError) {
      lines.push(`| ${r.url} | ${r.status} ${r.statusText} |`);
    }
  }

  if (grouped.timeout.length > 0) {
    lines.push(`\n## Timeouts\n`);
    for (const r of grouped.timeout) {
      lines.push(`- ${r.url}`);
    }
  }

  if (grouped.error.length > 0) {
    lines.push(`\n## Connection Errors\n`);
    lines.push(`| URL | Error |`);
    lines.push(`|-----|-------|`);
    for (const r of grouped.error) {
      lines.push(`| ${r.url} | ${r.error} |`);
    }
  }

  if (grouped.redirect.length > 0) {
    lines.push(`\n## Redirects (Valid)\n`);
    lines.push(`| URL | Redirects To |`);
    lines.push(`|-----|-------------|`);
    for (const r of grouped.redirect) {
      lines.push(`| ${r.url} | ${r.redirectUrl} |`);
    }
  }

  return lines.join('\n');
}
