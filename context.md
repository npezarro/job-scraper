# context.md
Last Updated: 2026-03-15 — Atomic writes, cron scheduling, log rotation

## Current State
- All CLI commands functional: `check-links`, `scrape`, `discover`, `enrich`, `full`, `pipeline`
- ESLint 9.17 configured with flat config (`eslint.config.js`), ES module support
- `last-run.json` writes are atomic (tmp file + rename) to prevent corruption
- **Cron scheduling active**: `0 */6 * * *` runs `pipeline:notify` every 6 hours
- **Log rotation**: `/etc/logrotate.d/job-scraper` rotates `pipeline.log` weekly, keeps 4 compressed
- Fetch-based adapters working for Greenhouse (JSON API), Ashby (GraphQL), Lever (JSON API)
- Generic adapter for custom career pages (HTML + JSON-LD extraction)
- Browser adapter (Playwright) defined but not yet installed
- Pipeline saves results to `output/last-run.json` for run-over-run diffing
- Discord webhook reads from `DISCORD_WEBHOOK_URL` env var or `~/.env` file
- Last pipeline run: 2026-03-15, 103 roles across 19 companies, 0 new

## Known Issues
- Generic adapter cannot list roles (5 companies affected: Google DeepMind, Meta, Stripe, Salesforce, Slack)
- Playwright not yet installed for JS-rendered career pages
- Discord webhook URL must be configured externally (not committed)
- `NODE_ENV=production` on the VM skips devDependencies; use `NODE_ENV=development npm install` to get ESLint

## Open Work
- Install Playwright chromium if browser-rendered career pages are needed
- Discord embed formatting (structured embeds with apply links instead of plain text)
- Markdown sorting/visual hierarchy in `new-roles.md`
- Applied/dismissed tracking to filter out previously seen roles

## Environment Notes
- Location: `/home/generatedByTermius/job-scraper`
- Node.js 20.18.3
- CLI tool (run-and-exit), not a PM2 service
- Cron: `0 */6 * * *` under `generatedByTermius` crontab
- Log: `output/pipeline.log` (rotated weekly by logrotate)
- Discord webhook: set via `DISCORD_WEBHOOK_URL` env var or `~/.env`

## Active Branch
- `claude/atomic-writes-cron`
