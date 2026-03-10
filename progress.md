# Progress Log

| Date | Type | Description |
|------|------|-------------|
| 2026-03-10 | refactor | ESLint 9.17 with flat config and ES module support. Removed unused imports (`readFileSync`, `existsSync`, `scrapeUrls`) and prefixed unused params. Verified all 20 company board URLs reachable. Added `lint` and `lint:fix` scripts. |
| 2026-03-10 | feat | Pipeline automation — new `pipeline` command with health-check, run-over-run diff, and Discord webhook alerts. Fixed Ashby GraphQL injection. Migrated 4 stale companies (OpenAI, Notion, Canva, Scale AI) from dead ATS URLs to Ashby. Added `enabled` field to company schema. |
| 2026-03-08 | feat | Initial build — CLI tool with check-links, scrape, discover, enrich, full pipeline commands. Fetch-based adapters for Greenhouse, Ashby, Lever. Generic + browser adapters. 20 companies configured. |
