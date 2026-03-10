# context.md
Last Updated: 2026-03-10 — ESLint setup, lint cleanup, URL verification

## Current State
- All CLI commands functional: `check-links`, `scrape`, `discover`, `enrich`, `full`, `pipeline`
- ESLint 9.17 configured with flat config (`eslint.config.js`), ES module support
- Lint scripts: `npm run lint` and `npm run lint:fix`
- `no-console` enforced in library files (adapters, scraper, etc.), disabled in CLI entry points
- Unused imports and variables cleaned up across codebase
- All 20 company board URLs verified reachable (Salesforce returns 405 on HEAD but 200 on GET)
- Fetch-based adapters working for Greenhouse (JSON API), Ashby (GraphQL), Lever (JSON API)
- Generic adapter for custom career pages (HTML + JSON-LD extraction)
- Browser adapter (Playwright) defined but not yet installed — lazy-loaded on demand
- Pipeline saves results to `output/last-run.json` for run-over-run diffing
- Discord webhook reads from `DISCORD_WEBHOOK_URL` env var or `~/.env` file

## Known Issues
- Generic adapter cannot list roles (only scrape individual URLs) — needs Playwright for JS-rendered career pages
- Playwright not yet installed — `npx playwright install chromium` needed before using browser adapter
- Discord webhook URL must be configured externally (not committed)
- `NODE_ENV=production` on the VM skips devDependencies; use `NODE_ENV=development npm install` to get ESLint

## Open Work
- Install Playwright chromium if browser-rendered career pages are needed
- Create/obtain the `ai_pm_roles_march2026.md` catalogue file for link checking and enrichment
- Consider adding cron job for scheduled `pipeline --notify` runs
- Consider adding embed-style Discord messages (currently uses plain text)

## Environment Notes
- Location: `/home/generatedByTermius/job-scraper`
- Node.js 20.18.3
- CLI tool (run-and-exit), not a PM2 service
- Cache dir: `~/.cache/job-scraper/` (not yet used, planned for future)
- Discord webhook: set via `DISCORD_WEBHOOK_URL` env var or `~/.env`

## Active Branch
- `agent/lint-cleanup`
