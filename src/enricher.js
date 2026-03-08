import { DomainRateLimiter } from './adapters/adapter.js';
import { scrapeUrl } from './scraper.js';

/**
 * Enricher module.
 * For each role with a working direct link, scrape full job details
 * and backfill missing fields (salary, requirements, team, posted date).
 */

/**
 * Parse existing roles from a markdown catalogue.
 * Extracts structured data from markdown entries.
 */
export function parseExistingRoles(markdown) {
  const roles = [];
  const lines = markdown.split('\n');

  let current = null;

  for (const line of lines) {
    // Detect role entries — look for markdown links with URLs
    const linkMatch = line.match(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/);
    if (linkMatch) {
      // Check if this looks like a job listing link (not a generic company link)
      const url = linkMatch[2];
      const text = linkMatch[1];

      if (isJobUrl(url)) {
        // Try to extract company and title from context
        const companyMatch = line.match(/\*\*([^*]+)\*\*/);
        current = {
          title: text || 'Unknown',
          company: companyMatch ? companyMatch[1] : extractCompanyFromUrl(url),
          url: url,
          // Track which fields are already present
          hasSalary: false,
          hasLocation: false,
          hasRequirements: false,
          hasTeam: false,
        };
        roles.push(current);
      }
    }

    // If we have a current role, check for existing data
    if (current) {
      if (line.match(/salary|compensation|pay/i) && line.match(/\$[\d,]+/)) {
        current.hasSalary = true;
      }
      if (line.match(/location:/i)) {
        current.hasLocation = true;
      }
      if (line.match(/requirements?:/i)) {
        current.hasRequirements = true;
      }
      if (line.match(/team:/i)) {
        current.hasTeam = true;
      }
    }
  }

  return roles;
}

function isJobUrl(url) {
  return /greenhouse\.io|ashbyhq\.com|lever\.co|workday\.com|\/jobs?\//i.test(url) ||
         /careers?\//i.test(url) ||
         /listing|posting|position|opening/i.test(url);
}

function extractCompanyFromUrl(url) {
  try {
    const hostname = new URL(url).hostname;
    // Try to get company from subdomain or path
    const parts = hostname.replace('www.', '').split('.');
    return parts[0];
  } catch {
    return 'Unknown';
  }
}

/**
 * Enrich existing roles by scraping live data.
 */
export async function enrichRoles(existingRoles, options = {}) {
  const { onProgress, staleThresholdDays = 90 } = options;
  const rateLimiter = new DomainRateLimiter(2000);

  const enrichments = [];
  let completed = 0;

  for (const existing of existingRoles) {
    const enrichment = {
      original: existing,
      enriched: null,
      fieldsAdded: [],
      error: null,
      isStale: false,
    };

    try {
      const scraped = await scrapeUrl(existing.url, rateLimiter);
      enrichment.enriched = scraped;

      // Track which fields were backfilled
      if (!existing.hasSalary && scraped.salary) {
        enrichment.fieldsAdded.push('salary');
      }
      if (!existing.hasLocation && scraped.location) {
        enrichment.fieldsAdded.push('location');
      }
      if (!existing.hasRequirements && scraped.requirements?.length > 0) {
        enrichment.fieldsAdded.push('requirements');
      }
      if (!existing.hasTeam && scraped.team) {
        enrichment.fieldsAdded.push('team');
      }

      // Check if role is stale
      if (scraped.postedDate) {
        const postedDate = new Date(scraped.postedDate);
        const daysSincePosted = (Date.now() - postedDate.getTime()) / (1000 * 60 * 60 * 24);
        enrichment.isStale = daysSincePosted > staleThresholdDays;
      }
    } catch (err) {
      enrichment.error = err.message;
      enrichment.errorType = err.name;
    }

    enrichments.push(enrichment);
    completed++;
    if (onProgress) onProgress(completed, existingRoles.length, enrichment);
  }

  const summary = {
    total: existingRoles.length,
    enriched: enrichments.filter(e => e.fieldsAdded.length > 0).length,
    stale: enrichments.filter(e => e.isStale).length,
    removed: enrichments.filter(e => e.errorType === 'RemovedError').length,
    errors: enrichments.filter(e => e.error && e.errorType !== 'RemovedError').length,
    enrichments,
  };

  return summary;
}
