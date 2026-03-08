import * as cheerio from 'cheerio';
import { safeFetch, NetworkError, RemovedError } from './adapter.js';
import { RoleDataSchema } from '../schema.js';

/**
 * Generic adapter for custom career pages that don't use a known ATS.
 * Attempts to extract job data from HTML using common patterns and JSON-LD.
 */

export async function scrapeRole(url, rateLimiter) {
  const response = await safeFetch(url, {}, rateLimiter);

  if (response.status === 404 || response.status === 410) {
    throw new RemovedError(`Page returned ${response.status}`, { url, statusCode: response.status });
  }
  if (!response.ok) {
    throw new NetworkError(`Page returned ${response.status}`, { url, statusCode: response.status });
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  // Try JSON-LD first
  const jsonLdScript = $('script[type="application/ld+json"]');
  for (let i = 0; i < jsonLdScript.length; i++) {
    try {
      const data = JSON.parse($(jsonLdScript[i]).html());
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item['@type'] === 'JobPosting') {
          return parseJsonLd(item, url);
        }
      }
    } catch {
      continue;
    }
  }

  // Fallback to HTML extraction
  const title = $('h1').first().text().trim();
  const location = $('[class*="location"]').first().text().trim() ||
                   $('meta[name="job:location"]').attr('content') ||
                   $('[itemprop="jobLocation"]').text().trim();

  const descriptionText = $('[class*="description"]').text().trim() ||
                          $('[itemprop="description"]').text().trim() ||
                          $('article').text().trim() ||
                          $('main').text().trim();

  const salary = extractSalary(descriptionText);
  const hostname = new URL(url).hostname.replace('www.', '');

  const roleData = {
    title: title || 'Unknown Title',
    company: hostname.split('.')[0],
    location: location || undefined,
    salary: salary || undefined,
    description: descriptionText.slice(0, 2000) || undefined,
    url,
    status: 'active',
    scrapedAt: new Date().toISOString(),
    atsType: 'generic',
  };

  return RoleDataSchema.parse(roleData);
}

function parseJsonLd(data, url) {
  const salary = data.baseSalary ? formatBaseSalary(data.baseSalary) : undefined;

  const roleData = {
    title: data.title || data.name || 'Unknown Title',
    company: data.hiringOrganization?.name || new URL(url).hostname.replace('www.', '').split('.')[0],
    location: formatJobLocation(data.jobLocation),
    salary: salary || undefined,
    description: (data.description || '').replace(/<[^>]+>/g, ' ').trim().slice(0, 2000) || undefined,
    postedDate: data.datePosted || undefined,
    url,
    status: 'active',
    scrapedAt: new Date().toISOString(),
    atsType: 'generic',
  };

  return RoleDataSchema.parse(roleData);
}

function formatBaseSalary(baseSalary) {
  if (!baseSalary?.value) return null;
  const { value } = baseSalary;
  const currency = baseSalary.currency || 'USD';
  if (value.minValue && value.maxValue) {
    return `${currency} ${value.minValue.toLocaleString()} - ${value.maxValue.toLocaleString()}`;
  }
  return null;
}

function formatJobLocation(jobLocation) {
  if (!jobLocation) return undefined;
  const locations = Array.isArray(jobLocation) ? jobLocation : [jobLocation];
  return locations
    .map(loc => {
      if (typeof loc === 'string') return loc;
      return [loc.address?.addressLocality, loc.address?.addressRegion]
        .filter(Boolean)
        .join(', ');
    })
    .filter(Boolean)
    .join(' | ');
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
