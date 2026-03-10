import * as cheerio from 'cheerio';
import { safeFetch, NetworkError, SchemaError, RemovedError } from './adapter.js';
import { RoleDataSchema } from '../schema.js';

/**
 * Lever adapter.
 * Uses the public JSON API at api.lever.co/v0/postings/{company}.
 */

const API_BASE = 'https://api.lever.co/v0/postings';

function extractSlug(url) {
  const match = url.match(/jobs\.lever\.co\/([^/?#]+)/);
  return match ? match[1] : null;
}

function extractJobId(url) {
  const match = url.match(/jobs\.lever\.co\/[^/]+\/([a-f0-9-]+)/);
  return match ? match[1] : null;
}

/**
 * Scrape a single role via API.
 */
export async function scrapeRole(url, rateLimiter) {
  const slug = extractSlug(url);
  const jobId = extractJobId(url);

  if (slug && jobId) {
    try {
      return await scrapeViaApi(slug, jobId, url, rateLimiter);
    } catch (err) {
      if (err instanceof RemovedError) throw err;
    }
  }

  return await scrapeViaHtml(url, rateLimiter);
}

async function scrapeViaApi(slug, jobId, originalUrl, rateLimiter) {
  const apiUrl = `${API_BASE}/${slug}/${jobId}`;
  const response = await safeFetch(apiUrl, {}, rateLimiter);

  if (response.status === 404) {
    throw new RemovedError(`Job ${jobId} not found on Lever`, { url: originalUrl, statusCode: 404 });
  }
  if (!response.ok) {
    throw new NetworkError(`Lever API returned ${response.status}`, { url: apiUrl, statusCode: response.status });
  }

  const data = await response.json();
  return parseApiResponse(data, originalUrl, slug);
}

function parseApiResponse(data, url, slug) {
  const descriptionHtml = data.descriptionPlain || data.description || '';
  const $ = cheerio.load(typeof descriptionHtml === 'string' && descriptionHtml.includes('<') ? descriptionHtml : `<p>${descriptionHtml}</p>`);
  const descriptionText = $.text().trim();

  // Combine all list items from additional sections
  const fullText = [
    descriptionText,
    ...(data.lists || []).map(l => `${l.text}\n${l.content}`),
  ].join('\n');

  const salary = extractSalary(fullText);
  const requirements = extractRequirementsFromLever(data);

  const roleData = {
    title: data.text || 'Unknown Title',
    company: slug || 'Unknown',
    location: data.categories?.location || undefined,
    salary: salary || data.salaryRange ? formatSalaryRange(data.salaryRange) : undefined,
    requirements: requirements.length > 0 ? requirements : undefined,
    description: descriptionText.slice(0, 2000) || undefined,
    team: data.categories?.team || data.categories?.department || undefined,
    postedDate: data.createdAt ? new Date(data.createdAt).toISOString() : undefined,
    url,
    status: 'active',
    scrapedAt: new Date().toISOString(),
    atsType: 'lever',
  };

  return RoleDataSchema.parse(roleData);
}

async function scrapeViaHtml(url, rateLimiter) {
  const response = await safeFetch(url, {}, rateLimiter);

  if (response.status === 404 || response.status === 410) {
    throw new RemovedError(`Lever page returned ${response.status}`, { url, statusCode: response.status });
  }
  if (!response.ok) {
    throw new NetworkError(`Lever page returned ${response.status}`, { url, statusCode: response.status });
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  const title = $('h2[data-qa="posting-name"]').text().trim() || $('h2').first().text().trim();
  const location = $('[class*="location"]').first().text().trim();
  const descriptionText = $('[class*="description"]').text().trim() || $('main').text().trim();

  const roleData = {
    title: title || 'Unknown Title',
    company: extractSlug(url) || 'Unknown',
    location: location || undefined,
    description: descriptionText.slice(0, 2000) || undefined,
    url,
    status: 'active',
    scrapedAt: new Date().toISOString(),
    atsType: 'lever',
  };

  return RoleDataSchema.parse(roleData);
}

/**
 * List all roles from a Lever board via API.
 */
export async function listRoles(boardUrl, _filters = {}, rateLimiter = null) {
  const slug = extractSlug(boardUrl);
  if (!slug) throw new SchemaError(`Cannot extract Lever slug from ${boardUrl}`, { url: boardUrl });

  const apiUrl = `${API_BASE}/${slug}?mode=json`;
  const response = await safeFetch(apiUrl, {}, rateLimiter);

  if (!response.ok) {
    throw new NetworkError(`Lever API returned ${response.status}`, { url: apiUrl, statusCode: response.status });
  }

  const jobs = await response.json();

  return (Array.isArray(jobs) ? jobs : [])
    .map(job => {
      try {
        return parseApiResponse(job, job.hostedUrl || `https://jobs.lever.co/${slug}/${job.id}`, slug);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function extractSalary(text) {
  const patterns = [
    /\$[\d,]+(?:\.\d{2})?\s*[-–—to]+\s*\$[\d,]+(?:\.\d{2})?/gi,
    /\$[\d,]+k?\s*[-–—to]+\s*\$[\d,]+k?/gi,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0].trim();
  }
  return null;
}

function formatSalaryRange(range) {
  if (!range) return null;
  const { min, max, currency } = range;
  if (!min && !max) return null;
  const curr = currency || 'USD';
  if (min && max) return `${curr} ${min.toLocaleString()} - ${max.toLocaleString()}`;
  if (min) return `${curr} ${min.toLocaleString()}+`;
  if (max) return `Up to ${curr} ${max.toLocaleString()}`;
  return null;
}

function extractRequirementsFromLever(data) {
  const requirements = [];
  for (const list of (data.lists || [])) {
    const headerText = (list.text || '').toLowerCase();
    if (headerText.includes('require') || headerText.includes('qualif') || headerText.includes('you should') || headerText.includes('you have')) {
      const $ = cheerio.load(list.content || '');
      $('li').each((_, li) => {
        const text = $(li).text().trim();
        if (text.length > 10 && text.length < 500) requirements.push(text);
      });
    }
  }
  return requirements;
}
