import pLimit from 'p-limit';
import { DomainRateLimiter } from './adapters/adapter.js';
import { listCompanyRoles } from './scraper.js';

/**
 * Discovery module.
 * Crawls company career pages to find new AI/ML PM roles.
 */

/**
 * Filter roles that match PM + AI/ML keywords.
 */
function matchesFilters(role, companyConfig) {
  const pmKeywords = companyConfig.pmKeywords || ['product manager', 'product lead'];
  const aiKeywords = companyConfig.aiKeywords || ['AI', 'ML', 'machine learning', 'generative'];

  const searchText = [
    role.title || '',
    role.description || '',
    role.team || '',
  ].join(' ').toLowerCase();

  const hasPm = pmKeywords.some(kw => searchText.includes(kw.toLowerCase()));
  const hasAi = aiKeywords.some(kw => searchText.includes(kw.toLowerCase()));

  return hasPm && hasAi;
}

/**
 * Discover new roles across all configured companies.
 * Deduplicates against existing catalogue URLs.
 */
export async function discoverRoles(companies, existingUrls = new Set(), options = {}) {
  const { onProgress, concurrency = 2 } = options;
  const rateLimiter = new DomainRateLimiter(2000);
  const limit = pLimit(concurrency);

  const allDiscovered = [];
  let completed = 0;

  const results = await Promise.all(
    companies.map(company =>
      limit(async () => {
        const discovered = { company: company.name, roles: [], errors: [] };

        try {
          const allRoles = await listCompanyRoles(company, rateLimiter);

          // Filter for PM + AI roles
          const matching = allRoles.filter(role => matchesFilters(role, company));

          // Deduplicate against existing catalogue
          const newRoles = matching.filter(role => !existingUrls.has(role.url));

          discovered.roles = newRoles;
          discovered.totalOnBoard = allRoles.length;
          discovered.matchingFilters = matching.length;
        } catch (err) {
          discovered.errors.push(err.message);
        }

        completed++;
        if (onProgress) onProgress(completed, companies.length, discovered);
        allDiscovered.push(discovered);
        return discovered;
      })
    )
  );

  const summary = {
    companiesChecked: companies.length,
    totalNewRoles: results.reduce((sum, r) => sum + r.roles.length, 0),
    byCompany: results,
    errors: results.filter(r => r.errors.length > 0),
  };

  return summary;
}

/**
 * Extract existing URLs from a markdown catalogue for deduplication.
 */
export function extractExistingUrls(markdown) {
  const urlPattern = /https?:\/\/[^\s)>\]"'`]+/g;
  const matches = markdown.match(urlPattern) || [];
  return new Set(matches.map(url => url.replace(/[.,;:!?)}\]]+$/, '')));
}
