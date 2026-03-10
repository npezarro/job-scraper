import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { discoverRoles } from './discovery.js';
import { loadCompanies } from './config.js';
import { formatRoles } from './formatter.js';
import { USER_AGENT } from './adapters/adapter.js';

/**
 * Pipeline orchestration module.
 * Runs discovery across all companies, diffs against previous run,
 * optionally posts summary to Discord via webhook.
 */

const LAST_RUN_PATH = resolve('output/last-run.json');
const DISCORD_MAX_LENGTH = 2000;

// ── Health Check ────────────────────────────────────────────────────────────

/**
 * HEAD-request each company's boardUrl to check reachability.
 * Returns { reachable: Company[], unreachable: { company, status, error }[] }.
 */
async function healthCheck(companies) {
  const reachable = [];
  const unreachable = [];

  for (const company of companies) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);

      let response;
      try {
        response = await fetch(company.boardUrl, {
          method: 'HEAD',
          signal: controller.signal,
          redirect: 'follow',
          headers: { 'User-Agent': USER_AGENT },
        });
      } catch {
        // Some servers reject HEAD — fall back to GET
        response = await fetch(company.boardUrl, {
          method: 'GET',
          signal: controller.signal,
          redirect: 'follow',
          headers: { 'User-Agent': USER_AGENT },
        });
      }

      clearTimeout(timer);

      if (response.status >= 400) {
        unreachable.push({
          company: company.name,
          boardUrl: company.boardUrl,
          status: response.status,
          error: `HTTP ${response.status}`,
        });
      } else {
        reachable.push(company);
      }
    } catch (err) {
      unreachable.push({
        company: company.name,
        boardUrl: company.boardUrl,
        status: 0,
        error: err.name === 'AbortError' ? 'timeout' : err.message,
      });
    }
  }

  return { reachable, unreachable };
}

// ── Last Run Persistence ────────────────────────────────────────────────────

function loadLastRun() {
  try {
    if (existsSync(LAST_RUN_PATH)) {
      const raw = readFileSync(LAST_RUN_PATH, 'utf-8');
      return JSON.parse(raw);
    }
  } catch {
    // Corrupted file — treat as no previous run
  }
  return null;
}

function saveLastRun(data) {
  const dir = dirname(LAST_RUN_PATH);
  mkdirSync(dir, { recursive: true });
  writeFileSync(LAST_RUN_PATH, JSON.stringify(data, null, 2));
}

// ── Diff Logic ──────────────────────────────────────────────────────────────

/**
 * Compare current roles against a previous run.
 * Returns { newRoles, removedRoles }.
 */
function diffRuns(currentRoles, previousRoles) {
  const prevUrls = new Set(previousRoles.map(r => r.url));
  const currUrls = new Set(currentRoles.map(r => r.url));

  const newRoles = currentRoles.filter(r => !prevUrls.has(r.url));
  const removedRoles = previousRoles.filter(r => !currUrls.has(r.url));

  return { newRoles, removedRoles };
}

// ── Discord Notification ────────────────────────────────────────────────────

/**
 * Read the Discord webhook URL from env or ~/.env file.
 */
function getWebhookUrl() {
  // Check environment variable first
  if (process.env.DISCORD_WEBHOOK_URL) {
    return process.env.DISCORD_WEBHOOK_URL;
  }

  // Try reading from ~/.env
  try {
    const envPath = resolve(process.env.HOME || '/root', '.env');
    if (existsSync(envPath)) {
      const envContent = readFileSync(envPath, 'utf-8');
      const match = envContent.match(/^DISCORD_WEBHOOK_URL=(.+)$/m);
      if (match) return match[1].trim().replace(/^["']|["']$/g, '');
    }
  } catch {
    // Ignore file read errors
  }

  return null;
}

/**
 * Post a summary to Discord via webhook.
 * Splits messages that exceed the 2000-char limit.
 */
async function postToDiscord(summary) {
  const webhookUrl = getWebhookUrl();
  if (!webhookUrl) {
    console.warn('  DISCORD_WEBHOOK_URL not set — skipping notification');
    return;
  }

  const messages = formatDiscordMessages(summary);

  for (const content of messages) {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });

      if (!response.ok) {
        console.warn(`  Discord webhook returned ${response.status} — message may not have been delivered`);
      }
    } catch (err) {
      console.warn(`  Discord webhook error: ${err.message} — continuing without notification`);
    }
  }
}

/**
 * Build Discord message strings, splitting if they exceed the limit.
 */
function formatDiscordMessages(summary) {
  const { totalRoles, newRoles, removedRoles, unreachableCompanies, errors, companiesChecked } = summary;

  let header = `**Job Scraper Pipeline Summary**\n`;
  header += `Companies checked: ${companiesChecked}\n`;
  header += `Total roles found: ${totalRoles}\n`;
  header += `New roles: ${newRoles.length}\n`;
  header += `Removed roles: ${removedRoles.length}\n`;

  if (unreachableCompanies.length > 0) {
    header += `Unreachable companies: ${unreachableCompanies.map(u => u.company).join(', ')}\n`;
  }

  if (errors.length > 0) {
    header += `Errors: ${errors.length} (${errors.map(e => e.company).join(', ')})\n`;
  }

  if (newRoles.length === 0) {
    return [header + '\nNo new roles since last run.'];
  }

  // List new roles (cap at 10 in the notification)
  let roleList = '\n**New Roles:**\n';
  const displayRoles = newRoles.slice(0, 10);
  for (const role of displayRoles) {
    roleList += `- ${role.title} @ ${role.company}\n`;
  }
  if (newRoles.length > 10) {
    roleList += `... and ${newRoles.length - 10} more. See output/last-run.json for full list.\n`;
  }

  const fullMessage = header + roleList;

  // Split if needed
  if (fullMessage.length <= DISCORD_MAX_LENGTH) {
    return [fullMessage];
  }

  // Split into chunks
  const messages = [];
  let current = header;

  if (current.length >= DISCORD_MAX_LENGTH) {
    // Header itself is too long (unlikely), just truncate
    messages.push(current.slice(0, DISCORD_MAX_LENGTH - 3) + '...');
    return messages;
  }

  for (const role of displayRoles) {
    const line = `- ${role.title} @ ${role.company}\n`;
    if (current.length + line.length > DISCORD_MAX_LENGTH - 50) {
      current += `... continued in next message\n`;
      messages.push(current);
      current = '**New Roles (cont.):**\n';
    }
    current += line;
  }

  if (newRoles.length > 10) {
    current += `... and ${newRoles.length - 10} more.\n`;
  }

  messages.push(current);
  return messages;
}

// ── Main Pipeline ───────────────────────────────────────────────────────────

/**
 * Run the full pipeline.
 * @param {object} options
 * @param {string} options.config - Path to companies.json
 * @param {boolean} options.notify - Post results to Discord
 */
export async function runPipeline(options = {}) {
  const { config = 'data/companies.json', notify = false } = options;

  console.log('=== Job Scraper Pipeline ===\n');

  // Step 1: Load companies
  console.log('Step 1: Loading companies...');
  const allCompanies = loadCompanies(config);
  const enabledCompanies = allCompanies.filter(c => c.enabled !== false);
  console.log(`  Loaded ${allCompanies.length} companies (${enabledCompanies.length} enabled)\n`);

  // Step 2: Health check
  console.log('Step 2: Health check...');
  const { reachable, unreachable } = await healthCheck(enabledCompanies);
  console.log(`  Reachable: ${reachable.length}`);
  if (unreachable.length > 0) {
    console.log(`  Unreachable (skipping):`);
    for (const u of unreachable) {
      console.log(`    ${u.company}: ${u.error} (${u.boardUrl})`);
    }
  }
  console.log();

  // Step 3: Load previous run
  console.log('Step 3: Loading previous run...');
  const previousRun = loadLastRun();
  const previousRoles = previousRun?.roles || [];
  if (previousRun) {
    console.log(`  Previous run: ${previousRoles.length} roles from ${previousRun.timestamp}`);
  } else {
    console.log('  No previous run found — all roles will be reported as new');
  }
  console.log();

  // Step 4: Discovery
  console.log('Step 4: Running discovery...');
  const discovery = await discoverRoles(reachable, new Set(), {
    onProgress: (done, total, result) => {
      const roleCount = result.roles?.length || 0;
      const errorMsg = result.errors?.length > 0 ? ` (${result.errors[0]})` : '';
      console.log(`  [${done}/${total}] ${result.company}: ${roleCount} roles${errorMsg}`);
    },
  });

  const currentRoles = discovery.byCompany.flatMap(c => c.roles);
  console.log(`\n  Total roles discovered: ${currentRoles.length}\n`);

  // Step 5: Diff
  console.log('Step 5: Diffing against previous run...');
  const { newRoles, removedRoles } = diffRuns(currentRoles, previousRoles);
  console.log(`  New roles: ${newRoles.length}`);
  console.log(`  Removed roles: ${removedRoles.length}\n`);

  // Step 6: Save current run
  console.log('Step 6: Saving results...');
  const runData = {
    timestamp: new Date().toISOString(),
    companiesChecked: reachable.length,
    totalRoles: currentRoles.length,
    roles: currentRoles,
    unreachable: unreachable,
    errors: discovery.errors,
  };
  saveLastRun(runData);
  console.log(`  Saved to ${LAST_RUN_PATH}\n`);

  // Write new roles markdown if any
  if (newRoles.length > 0) {
    const report = formatRoles(newRoles, { title: 'New Roles Since Last Run' });
    const reportPath = resolve('output/new-roles.md');
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, report);
    console.log(`  New roles report: ${reportPath}\n`);
  }

  // Build summary
  const pipelineSummary = {
    companiesChecked: reachable.length,
    totalRoles: currentRoles.length,
    newRoles,
    removedRoles,
    unreachableCompanies: unreachable,
    errors: discovery.errors,
  };

  // Step 7: Discord notification
  if (notify) {
    console.log('Step 7: Posting to Discord...');
    await postToDiscord(pipelineSummary);
    console.log();
  }

  // Print final summary
  console.log('=== Pipeline Complete ===');
  console.log(`  Companies checked: ${reachable.length} (${unreachable.length} unreachable)`);
  console.log(`  Total roles: ${currentRoles.length}`);
  console.log(`  New since last run: ${newRoles.length}`);
  console.log(`  Removed since last run: ${removedRoles.length}`);
  if (discovery.errors.length > 0) {
    console.log(`  Errors: ${discovery.errors.length}`);
  }

  return pipelineSummary;
}
