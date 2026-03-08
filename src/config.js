import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { CompanyConfigSchema } from './schema.js';
import { z } from 'zod';

/**
 * Load and validate company configurations.
 */

export function loadCompanies(configPath) {
  const resolved = resolve(configPath);
  if (!existsSync(resolved)) {
    throw new Error(`Config file not found: ${resolved}`);
  }

  const raw = readFileSync(resolved, 'utf-8');
  const data = JSON.parse(raw);

  if (!Array.isArray(data)) {
    throw new Error('Company config must be a JSON array');
  }

  return z.array(CompanyConfigSchema).parse(data);
}

/**
 * Load markdown file content.
 */
export function loadMarkdown(filePath) {
  const resolved = resolve(filePath);
  if (!existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }
  return readFileSync(resolved, 'utf-8');
}

/**
 * Default cache directory.
 */
export function getCacheDir() {
  const home = process.env.HOME || process.env.USERPROFILE || '/tmp';
  return resolve(home, '.cache', 'job-scraper');
}
