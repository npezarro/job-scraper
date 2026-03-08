import * as cheerio from 'cheerio';
import { NetworkError, RemovedError } from './adapter.js';
import { RoleDataSchema } from '../schema.js';

/**
 * Browser-based adapter using Playwright.
 * Lazy-loaded — only imports Playwright when actually needed.
 * Used for Workday and other JS-rendered career pages.
 */

let browserInstance = null;

async function getBrowser() {
  if (browserInstance) return browserInstance;

  try {
    const { chromium } = await import('playwright');
    browserInstance = await chromium.launch({ headless: true });
    return browserInstance;
  } catch (err) {
    throw new Error(
      `Playwright not available. Install with: npm install playwright && npx playwright install chromium\n${err.message}`
    );
  }
}

export async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

/**
 * Scrape a single role using Playwright.
 */
export async function scrapeRole(url, rateLimiter) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  try {
    const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

    if (!response) {
      throw new NetworkError('No response received', { url });
    }

    const status = response.status();
    if (status === 404 || status === 410) {
      throw new RemovedError(`Page returned ${status}`, { url, statusCode: status });
    }

    // Wait for content to render
    await page.waitForTimeout(2000);

    const html = await page.content();
    const $ = cheerio.load(html);

    // Try JSON-LD structured data first
    const jsonLd = $('script[type="application/ld+json"]').text();
    if (jsonLd) {
      try {
        const structured = JSON.parse(jsonLd);
        if (structured['@type'] === 'JobPosting' || structured.title) {
          return parseJsonLd(structured, url);
        }
      } catch {
        // JSON-LD parse failed, continue with HTML
      }
    }

    // Generic HTML extraction
    const title = $('h1').first().text().trim() ||
                  $('[data-automation-id="jobPostingHeader"]').text().trim() ||
                  $('[class*="job-title"]').text().trim();

    const location = $('[class*="location"]').first().text().trim() ||
                     $('[data-automation-id="locations"]').text().trim();

    const descriptionText = $('[class*="description"]').text().trim() ||
                            $('article').text().trim() ||
                            $('main').text().trim();

    const salary = extractSalary(descriptionText);

    const roleData = {
      title: title || 'Unknown Title',
      company: new URL(url).hostname.replace('www.', '').split('.')[0],
      location: location || undefined,
      salary: salary || undefined,
      description: descriptionText.slice(0, 2000) || undefined,
      url,
      status: 'active',
      scrapedAt: new Date().toISOString(),
      atsType: 'browser',
    };

    return RoleDataSchema.parse(roleData);
  } finally {
    await context.close();
  }
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
    atsType: 'browser',
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
  if (value.value) return `${currency} ${value.value.toLocaleString()}`;
  return null;
}

function formatJobLocation(jobLocation) {
  if (!jobLocation) return undefined;
  const locations = Array.isArray(jobLocation) ? jobLocation : [jobLocation];
  return locations
    .map(loc => {
      if (typeof loc === 'string') return loc;
      return [loc.address?.addressLocality, loc.address?.addressRegion, loc.address?.addressCountry]
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
