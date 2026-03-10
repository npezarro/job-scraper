#!/usr/bin/env node

import { Command } from 'commander';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { checkLinks, formatLinkReport, extractUrls } from './link-checker.js';
import { scrapeUrl, scrapeUrls } from './scraper.js';
import { discoverRoles, extractExistingUrls } from './discovery.js';
import { parseExistingRoles, enrichRoles } from './enricher.js';
import { formatRoles, formatEnrichedRoles } from './formatter.js';
import { loadCompanies, loadMarkdown } from './config.js';
import { runPipeline } from './pipeline.js';

const program = new Command();

program
  .name('job-scraper')
  .description('AI PM job listing scraper & enrichment tool')
  .version('1.0.0');

// ── check-links ──────────────────────────────────────────────────────────────

program
  .command('check-links')
  .description('Check all URLs in a markdown file for health status')
  .requiredOption('--input <path>', 'Path to markdown file with URLs')
  .option('--output <path>', 'Output path for report', 'output/link-report.md')
  .option('--concurrency <n>', 'Max concurrent requests', parseInt, 5)
  .option('--timeout <ms>', 'Request timeout in ms', parseInt, 15000)
  .action(async (opts) => {
    try {
      console.log(`Loading ${opts.input}...`);
      const markdown = loadMarkdown(opts.input);
      const urls = extractUrls(markdown);
      console.log(`Found ${urls.length} URLs to check\n`);

      const result = await checkLinks(markdown, {
        concurrency: opts.concurrency,
        timeout: opts.timeout,
        onProgress: (done, total, r) => {
          const status = r.status || r.statusText;
          process.stdout.write(`\r[${done}/${total}] ${status} ${r.url.slice(0, 80)}`);
        },
      });

      console.log('\n');

      const report = formatLinkReport(result);
      ensureOutputDir(opts.output);
      writeFileSync(resolve(opts.output), report);
      console.log(`Report written to ${opts.output}`);

      // Print summary
      const { grouped } = result;
      console.log('\nSummary:');
      console.log(`  OK: ${grouped.ok.length}`);
      console.log(`  Redirect: ${grouped.redirect.length}`);
      console.log(`  Likely expired: ${grouped.redirectGeneric.length}`);
      console.log(`  Broken (4xx): ${grouped.clientError.length}`);
      console.log(`  Server error (5xx): ${grouped.serverError.length}`);
      console.log(`  Timeout: ${grouped.timeout.length}`);
      console.log(`  Connection error: ${grouped.error.length}`);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ── scrape ───────────────────────────────────────────────────────────────────

program
  .command('scrape')
  .description('Scrape a single job URL for full details')
  .requiredOption('--url <url>', 'Job posting URL to scrape')
  .option('--json', 'Output as JSON instead of markdown')
  .action(async (opts) => {
    try {
      validateUrl(opts.url);
      console.log(`Scraping ${opts.url}...`);
      const result = await scrapeUrl(opts.url);

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        const { formatRole } = await import('./formatter.js');
        console.log('\n' + formatRole(result));
      }
    } catch (err) {
      console.error(`Error: ${err.name}: ${err.message}`);
      process.exit(1);
    }
  });

// ── discover ─────────────────────────────────────────────────────────────────

program
  .command('discover')
  .description('Search company career pages for new AI/ML PM roles')
  .option('--config <path>', 'Path to companies.json', 'data/companies.json')
  .option('--input <path>', 'Existing catalogue for deduplication')
  .option('--output <path>', 'Output path for new roles', 'output/new-roles.md')
  .option('--keywords <words>', 'Additional keywords (comma-separated)')
  .action(async (opts) => {
    try {
      console.log(`Loading company configs from ${opts.config}...`);
      const companies = loadCompanies(opts.config);
      console.log(`Loaded ${companies.length} companies\n`);

      let existingUrls = new Set();
      if (opts.input) {
        const markdown = loadMarkdown(opts.input);
        existingUrls = extractExistingUrls(markdown);
        console.log(`Loaded ${existingUrls.size} existing URLs for deduplication\n`);
      }

      const summary = await discoverRoles(companies, existingUrls, {
        onProgress: (done, total, result) => {
          const roleCount = result.roles?.length || 0;
          const errorMsg = result.errors?.length > 0 ? ` (${result.errors[0]})` : '';
          console.log(`[${done}/${total}] ${result.company}: ${roleCount} new roles${errorMsg}`);
        },
      });

      console.log(`\nDiscovery complete:`);
      console.log(`  Companies checked: ${summary.companiesChecked}`);
      console.log(`  New roles found: ${summary.totalNewRoles}`);

      // Collect all new roles
      const allNewRoles = summary.byCompany.flatMap(c => c.roles);
      if (allNewRoles.length > 0) {
        const report = formatRoles(allNewRoles, { title: 'Newly Discovered AI PM Roles' });
        ensureOutputDir(opts.output);
        writeFileSync(resolve(opts.output), report);
        console.log(`\nNew roles written to ${opts.output}`);
      } else {
        console.log('\nNo new roles found.');
      }

      if (summary.errors.length > 0) {
        console.log(`\nErrors (${summary.errors.length}):`);
        for (const e of summary.errors) {
          console.log(`  ${e.company}: ${e.errors.join(', ')}`);
        }
      }
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ── enrich ───────────────────────────────────────────────────────────────────

program
  .command('enrich')
  .description('Backfill missing data for existing catalogue roles')
  .requiredOption('--input <path>', 'Path to existing catalogue markdown')
  .option('--output <path>', 'Output path for enriched roles', 'output/enriched-roles.md')
  .action(async (opts) => {
    try {
      console.log(`Loading ${opts.input}...`);
      const markdown = loadMarkdown(opts.input);
      const existingRoles = parseExistingRoles(markdown);
      console.log(`Found ${existingRoles.length} roles to enrich\n`);

      if (existingRoles.length === 0) {
        console.log('No roles with job URLs found in the catalogue.');
        return;
      }

      const summary = await enrichRoles(existingRoles, {
        onProgress: (done, total, enrichment) => {
          const status = enrichment.error ? `ERROR: ${enrichment.error.slice(0, 50)}` :
                         enrichment.fieldsAdded.length > 0 ? `+${enrichment.fieldsAdded.join(', ')}` :
                         'no new data';
          process.stdout.write(`\r[${done}/${total}] ${status.padEnd(60)}`);
        },
      });

      console.log('\n\nEnrichment complete:');
      console.log(`  Total roles: ${summary.total}`);
      console.log(`  Enriched (new data): ${summary.enriched}`);
      console.log(`  Stale (>90 days): ${summary.stale}`);
      console.log(`  Removed/expired: ${summary.removed}`);
      console.log(`  Errors: ${summary.errors}`);

      const enrichedWithData = summary.enrichments.filter(e => e.fieldsAdded.length > 0);
      if (enrichedWithData.length > 0) {
        const report = formatEnrichedRoles(enrichedWithData);
        ensureOutputDir(opts.output);
        writeFileSync(resolve(opts.output), report);
        console.log(`\nEnriched roles written to ${opts.output}`);
      }
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ── full ─────────────────────────────────────────────────────────────────────

program
  .command('full')
  .description('Full pipeline: check links, discover new roles, enrich existing')
  .option('--config <path>', 'Path to companies.json', 'data/companies.json')
  .requiredOption('--input <path>', 'Path to existing catalogue markdown')
  .option('--output-dir <path>', 'Output directory', 'output')
  .action(async (opts) => {
    const outputDir = resolve(opts.outputDir);
    mkdirSync(outputDir, { recursive: true });

    try {
      // Step 1: Check links
      console.log('═══ Step 1: Link Health Check ═══\n');
      const markdown = loadMarkdown(opts.input);
      const urls = extractUrls(markdown);
      console.log(`Checking ${urls.length} URLs...`);

      const linkResult = await checkLinks(markdown, {
        onProgress: (done, total) => {
          process.stdout.write(`\r  [${done}/${total}]`);
        },
      });

      const linkReport = formatLinkReport(linkResult);
      writeFileSync(resolve(outputDir, 'link-report.md'), linkReport);
      console.log(`\n  Report: ${outputDir}/link-report.md`);
      console.log(`  OK: ${linkResult.grouped.ok.length} | Broken: ${linkResult.grouped.clientError.length} | Expired: ${linkResult.grouped.redirectGeneric.length}\n`);

      // Step 2: Discover new roles
      console.log('═══ Step 2: Discover New Roles ═══\n');
      const companies = loadCompanies(opts.config);
      const existingUrls = extractExistingUrls(markdown);

      const discovery = await discoverRoles(companies, existingUrls, {
        onProgress: (done, total, result) => {
          console.log(`  [${done}/${total}] ${result.company}: ${result.roles?.length || 0} new roles`);
        },
      });

      const allNewRoles = discovery.byCompany.flatMap(c => c.roles);
      if (allNewRoles.length > 0) {
        const newRolesReport = formatRoles(allNewRoles, { title: 'Newly Discovered AI PM Roles' });
        writeFileSync(resolve(outputDir, 'new-roles.md'), newRolesReport);
        console.log(`  Found ${allNewRoles.length} new roles → ${outputDir}/new-roles.md\n`);
      } else {
        console.log('  No new roles found.\n');
      }

      // Step 3: Enrich existing roles
      console.log('═══ Step 3: Enrich Existing Roles ═══\n');
      const existingRoles = parseExistingRoles(markdown);
      console.log(`  Enriching ${existingRoles.length} roles...`);

      if (existingRoles.length > 0) {
        const enrichment = await enrichRoles(existingRoles, {
          onProgress: (done, total) => {
            process.stdout.write(`\r  [${done}/${total}]`);
          },
        });

        const enrichedWithData = enrichment.enrichments.filter(e => e.fieldsAdded.length > 0);
        if (enrichedWithData.length > 0) {
          const enrichReport = formatEnrichedRoles(enrichedWithData);
          writeFileSync(resolve(outputDir, 'enriched-roles.md'), enrichReport);
          console.log(`\n  Enriched: ${enrichment.enriched} | Stale: ${enrichment.stale} | Removed: ${enrichment.removed}`);
          console.log(`  Report: ${outputDir}/enriched-roles.md\n`);
        } else {
          console.log('\n  No new data to backfill.\n');
        }
      }

      console.log('═══ Pipeline Complete ═══');
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ── pipeline ────────────────────────────────────────────────────────────────

program
  .command('pipeline')
  .description('Run discovery pipeline with health check, diff, and optional Discord alerts')
  .option('--config <path>', 'Path to companies.json', 'data/companies.json')
  .option('--notify', 'Post summary to Discord webhook')
  .action(async (opts) => {
    try {
      await runPipeline({
        config: opts.config,
        notify: opts.notify || false,
      });
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ── helpers ──────────────────────────────────────────────────────────────────

function validateUrl(url) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('URL must use http or https protocol');
    }
  } catch {
    console.error(`Invalid URL: ${url}`);
    process.exit(1);
  }
}

function ensureOutputDir(filePath) {
  const dir = dirname(resolve(filePath));
  mkdirSync(dir, { recursive: true });
}

program.parse();
