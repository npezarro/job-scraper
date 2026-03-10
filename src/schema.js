import { z } from 'zod';

export const RoleDataSchema = z.object({
  title: z.string().min(1),
  company: z.string().min(1),
  location: z.string().optional(),
  salary: z.string().optional(),
  requirements: z.array(z.string()).optional(),
  description: z.string().optional(),
  team: z.string().optional(),
  postedDate: z.string().optional(),
  url: z.string().url(),
  status: z.enum(['active', 'stale', 'removed', 'redirect', 'unknown']).default('unknown'),
  scrapedAt: z.string().datetime().optional(),
  atsType: z.string().optional(),
});

export const LinkCheckResultSchema = z.object({
  url: z.string().url(),
  status: z.number(),
  statusText: z.string(),
  redirectUrl: z.string().optional(),
  redirectsToGeneric: z.boolean().default(false),
  error: z.string().optional(),
  checkedAt: z.string().datetime(),
});

export const CompanyConfigSchema = z.object({
  name: z.string().min(1),
  ats: z.string().min(1),
  boardUrl: z.string().url(),
  pmKeywords: z.array(z.string()).default(['product manager']),
  aiKeywords: z.array(z.string()).default(['AI', 'ML']),
  renderer: z.enum(['fetch', 'browser']).default('fetch'),
  enabled: z.boolean().default(true),
});
