# context.md
Last Updated: 2026-03-10 — Pipeline automation with health-check, diff, and Discord alerts

## Current State
- All CLI commands functional: `check-links`, `scrape`, `discover`, `enrich`, `full`, `pipeline`
- New `pipeline` command runs: health-check, discovery, diff against previous run, Discord notification
- Fetch-based adapters working for Greenhouse (JSON API), Ashby (GraphQL), Lever (JSON API)
- Generic adapter for custom career pages (HTML + JSON-LD extraction)
- Browser adapter (Playwright) defined but not yet installed — lazy-loaded on demand
- 20 companies configured, all enabled, all with working ATS URLs
- Ashby adapter GraphQL queries now use parameterized variables (injection fix)
- Pipeline saves results to `output/last-run.json` for run-over-run diffing
- Discord webhook reads from `DISCORD_WEBHOOK_URL` env var or `~/.env` file

## Known Issues
- Generic adapter cannot list roles (only scrape individual URLs) — needs Playwright for JS-rendered career pages
- Playwright not yet installed — `npx playwright install chromium` needed before using browser adapter
- Discord webhook URL must be configured externally (not committed)

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
- `claude/pipeline-automation`
