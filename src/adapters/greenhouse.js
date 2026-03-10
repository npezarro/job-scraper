import * as cheerio from 'cheerio';
import { safeFetch, NetworkError, SchemaError, RemovedError } from './adapter.js';
import { RoleDataSchema } from '../schema.js';

/**
 * Greenhouse adapter.
 * Uses the public JSON API at boards-api.greenhouse.io first,
 * falls back to HTML scraping for individual job pages.
 */

const API_BASE = 'https://boards-api.greenhouse.io/v1/boards';

/**
 * Extract company slug from a Greenhouse URL.
 * e.g. "https://job-boards.greenhouse.io/anthropic/jobs/123" → "anthropic"
 */
function extractSlug(url) {
  const patterns = [
    /job-boards\.greenhouse\.io\/([^/]+)/,
    /boards-api\.greenhouse\.io\/v1\/boards\/([^/]+)/,
    /boards\.greenhouse\.io\/([^/]+)/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function extractJobId(url) {
  const match = url.match(/jobs\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Scrape a single role via API, falling back to HTML.
 */
export async function scrapeRole(url, rateLimiter) {
  const slug = extractSlug(url);
  const jobId = extractJobId(url);

  if (slug && jobId) {
    try {
      return await scrapeViaApi(slug, jobId, url, rateLimiter);
    } catch (err) {
      if (err instanceof RemovedError) throw err;
      // Fall through to HTML scraping
    }
  }

  return await scrapeViaHtml(url, rateLimiter);
}

async function scrapeViaApi(slug, jobId, originalUrl, rateLimiter) {
  const apiUrl = `${API_BASE}/${slug}/jobs/${jobId}`;
  const response = await safeFetch(apiUrl, {}, rateLimiter);

  if (response.status === 404) {
    throw new RemovedError(`Job ${jobId} not found on Greenhouse`, { url: originalUrl, statusCode: 404 });
  }
  if (!response.ok) {
    throw new NetworkError(`Greenhouse API returned ${response.status}`, { url: apiUrl, statusCode: response.status });
  }

  const data = await response.json();
  return parseApiResponse(data, originalUrl);
}

function parseApiResponse(data, url) {
  // Greenhouse API HTML-entity-encodes content — two-pass decode:
  // 1) Load to decode entities → .text() gives us raw HTML string
  // 2) Load that HTML string → .text() gives us plain text
  const rawContent = data.content || '';
  const decodedHtml = cheerio.load(rawContent).text();
  const $ = cheerio.load(decodedHtml);
  const descriptionText = $.text().trim();

  // Try to extract salary from description
  const salary = extractSalary(descriptionText);
  const requirements = extractRequirements($);

  const roleData = {
    title: data.title || 'Unknown Title',
    company: data.company?.name || extractSlug(url) || 'Unknown',
    location: data.location?.name || undefined,
    salary: salary || undefined,
    requirements: requirements.length > 0 ? requirements : undefined,
    description: descriptionText.slice(0, 2000) || undefined,
    team: data.departments?.[0]?.name || undefined,
    postedDate: data.updated_at || data.created_at || undefined,
    url,
    status: 'active',
    scrapedAt: new Date().toISOString(),
    atsType: 'greenhouse',
  };

  return RoleDataSchema.parse(roleData);
}

async function scrapeViaHtml(url, rateLimiter) {
  const response = await safeFetch(url, {}, rateLimiter);

  if (response.status === 404 || response.status === 410) {
    throw new RemovedError(`Job page returned ${response.status}`, { url, statusCode: response.status });
  }
  if (!response.ok) {
    throw new NetworkError(`Greenhouse page returned ${response.status}`, { url, statusCode: response.status });
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  const title = $('h1.app-title').text().trim() || $('h1').first().text().trim();
  const location = $('.location').text().trim();
  const descriptionText = $('#content').text().trim() || $('body').text().trim();
  const salary = extractSalary(descriptionText);

  const roleData = {
    title: title || 'Unknown Title',
    company: extractSlug(url) || 'Unknown',
    location: location || undefined,
    salary: salary || undefined,
    description: descriptionText.slice(0, 2000) || undefined,
    url,
    status: 'active',
    scrapedAt: new Date().toISOString(),
    atsType: 'greenhouse',
  };

  return RoleDataSchema.parse(roleData);
}

/**
 * List all roles from a Greenhouse board via API.
 */
export async function listRoles(boardUrl, _filters = {}, rateLimiter = null) {
  const slug = extractSlug(boardUrl);
  if (!slug) throw new SchemaError(`Cannot extract Greenhouse slug from ${boardUrl}`, { url: boardUrl });

  const apiUrl = `${API_BASE}/${slug}/jobs?content=true`;
  const response = await safeFetch(apiUrl, {}, rateLimiter);

  if (!response.ok) {
    throw new NetworkError(`Greenhouse API returned ${response.status}`, { url: apiUrl, statusCode: response.status });
  }

  const data = await response.json();
  const jobs = data.jobs || [];

  return jobs
    .map(job => {
      try {
        return parseApiResponse(job, `https://job-boards.greenhouse.io/${slug}/jobs/${job.id}`);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function extractSalary(text) {
  // Match common salary patterns
  const patterns = [
    /\$[\d,]+(?:\.\d{2})?\s*[-–—to]+\s*\$[\d,]+(?:\.\d{2})?/gi,
    /\$[\d,]+k?\s*[-–—to]+\s*\$[\d,]+k?/gi,
    /salary\s*(?:range)?:?\s*\$[\d,]+\s*[-–—to]+\s*\$[\d,]+/gi,
    /compensation\s*(?:range)?:?\s*\$[\d,]+\s*[-–—to]+\s*\$[\d,]+/gi,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0].trim();
  }
  return null;
}

function extractRequirements($) {
  const requirements = [];
  const lists = $('ul');

  lists.each((_, list) => {
    const prevElement = $(list).prev();
    const prevText = prevElement.text().toLowerCase();
    if (prevText.includes('require') || prevText.includes('qualif') || prevText.includes('what you') || prevText.includes('you should')) {
      $(list).find('li').each((_, li) => {
        const text = $(li).text().trim();
        if (text.length > 10 && text.length < 500) {
          requirements.push(text);
        }
      });
    }
  });

  return requirements;
}
