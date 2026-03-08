import * as cheerio from 'cheerio';
import { safeFetch, NetworkError, SchemaError, RemovedError } from './adapter.js';
import { RoleDataSchema } from '../schema.js';

/**
 * Ashby adapter.
 * Uses the public GraphQL API at jobs.ashbyhq.com/api/non-user-graphql.
 */

const GRAPHQL_URL = 'https://jobs.ashbyhq.com/api/non-user-graphql';

function extractSlug(url) {
  const match = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)/);
  return match ? match[1] : null;
}

function extractJobId(url) {
  const match = url.match(/jobs\.ashbyhq\.com\/[^/]+\/([a-f0-9-]+)/);
  return match ? match[1] : null;
}

/**
 * Scrape a single role via GraphQL API.
 */
export async function scrapeRole(url, rateLimiter) {
  const slug = extractSlug(url);
  const jobId = extractJobId(url);

  if (!slug) throw new SchemaError(`Cannot extract Ashby slug from ${url}`, { url });

  if (jobId) {
    try {
      return await scrapeJobById(slug, jobId, url, rateLimiter);
    } catch (err) {
      if (err instanceof RemovedError) throw err;
      // Fall through to HTML
    }
  }

  return await scrapeViaHtml(url, rateLimiter);
}

async function scrapeJobById(slug, jobId, originalUrl, rateLimiter) {
  const query = `
    query {
      jobPosting(id: "${jobId}") {
        id
        title
        departmentName
        locationName
        employmentType
        descriptionHtml
        publishedDate
        isListed
      }
    }
  `;

  const response = await safeFetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  }, rateLimiter);

  if (!response.ok) {
    throw new NetworkError(`Ashby GraphQL returned ${response.status}`, { url: GRAPHQL_URL, statusCode: response.status });
  }

  const data = await response.json();
  const job = data?.data?.jobPosting;

  if (!job || !job.isListed) {
    throw new RemovedError(`Job ${jobId} not found or unlisted on Ashby`, { url: originalUrl, statusCode: 404 });
  }

  return parseGraphQLResponse(job, originalUrl, slug);
}

function parseGraphQLResponse(job, url, slug) {
  const $ = cheerio.load(job.descriptionHtml || '');
  const descriptionText = $.text().trim();
  const salary = extractSalary(descriptionText);
  const requirements = extractRequirements($);

  const roleData = {
    title: job.title || 'Unknown Title',
    company: slug || 'Unknown',
    location: job.locationName || undefined,
    salary: salary || undefined,
    requirements: requirements.length > 0 ? requirements : undefined,
    description: descriptionText.slice(0, 2000) || undefined,
    team: job.departmentName || undefined,
    postedDate: job.publishedDate || undefined,
    url,
    status: 'active',
    scrapedAt: new Date().toISOString(),
    atsType: 'ashby',
  };

  return RoleDataSchema.parse(roleData);
}

async function scrapeViaHtml(url, rateLimiter) {
  const response = await safeFetch(url, {}, rateLimiter);

  if (response.status === 404 || response.status === 410) {
    throw new RemovedError(`Ashby page returned ${response.status}`, { url, statusCode: response.status });
  }
  if (!response.ok) {
    throw new NetworkError(`Ashby page returned ${response.status}`, { url, statusCode: response.status });
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  const title = $('h1').first().text().trim();
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
    atsType: 'ashby',
  };

  return RoleDataSchema.parse(roleData);
}

/**
 * List all roles from an Ashby board via GraphQL.
 */
export async function listRoles(boardUrl, filters = {}, rateLimiter = null) {
  const slug = extractSlug(boardUrl);
  if (!slug) throw new SchemaError(`Cannot extract Ashby slug from ${boardUrl}`, { url: boardUrl });

  const query = `
    query {
      jobBoard(organizationHostedJobsPageName: "${slug}") {
        jobPostings {
          id
          title
          departmentName
          locationName
          employmentType
          descriptionHtml
          publishedDate
          isListed
        }
      }
    }
  `;

  const response = await safeFetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  }, rateLimiter);

  if (!response.ok) {
    throw new NetworkError(`Ashby GraphQL returned ${response.status}`, { url: GRAPHQL_URL, statusCode: response.status });
  }

  const data = await response.json();
  const postings = data?.data?.jobBoard?.jobPostings || [];

  return postings
    .filter(job => job.isListed)
    .map(job => {
      try {
        return parseGraphQLResponse(job, `https://jobs.ashbyhq.com/${slug}/${job.id}`, slug);
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

function extractRequirements($) {
  const requirements = [];
  $('ul').each((_, list) => {
    const prevText = $(list).prev().text().toLowerCase();
    if (prevText.includes('require') || prevText.includes('qualif') || prevText.includes('what you')) {
      $(list).find('li').each((_, li) => {
        const text = $(li).text().trim();
        if (text.length > 10 && text.length < 500) requirements.push(text);
      });
    }
  });
  return requirements;
}
