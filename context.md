# context.md
Last Updated: 2026-03-08 — Initial build of job scraper CLI tool

## Current State
- All CLI commands functional: `check-links`, `scrape`, `discover`, `enrich`, `full`
- Fetch-based adapters working for Greenhouse (JSON API), Ashby (GraphQL), Lever (JSON API)
- Generic adapter for custom career pages (HTML + JSON-LD extraction)
- Browser adapter (Playwright) defined but not yet installed — lazy-loaded on demand
- Discovery tested: found 97 AI PM roles across Anthropic, Figma, Databricks, Vercel
- Scrape tested: salary extraction working ($370,000—$450,000 from Greenhouse)
- Link checker tested: HEAD/GET with redirect detection
- No existing job catalogue file on server yet (tool works without one)

## Known Issues
- Some companies returned 404 from their APIs (OpenAI, Notion, Canva on Greenhouse; Scale AI on Lever) — they may have migrated ATS platforms. Update `companies.json` as needed.
- Generic adapter cannot list roles (only scrape individual URLs) — needs Playwright for JS-rendered career pages
- Playwright not yet installed — `npx playwright install chromium` needed before using browser adapter

## Open Work
- Install Playwright chromium if browser-rendered career pages are needed
- Create/obtain the `ai_pm_roles_march2026.md` catalogue file for link checking and enrichment
- Consider adding cron job for scheduled discovery runs

## Environment Notes
- Location: `/home/generatedByTermius/job-scraper`
- Node.js 20.18.3
- CLI tool (run-and-exit), not a PM2 service
- Cache dir: `~/.cache/job-scraper/` (not yet used, planned for future)

## Active Branch
- `main`
