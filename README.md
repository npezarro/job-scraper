# Job Scraper

CLI tool to scrape, verify, and enrich AI PM job listings from major ATS platforms.

## Quick Start

```bash
npm install
node src/index.js --help
```

## Commands

```bash
# Check link health for a markdown file with job URLs
node src/index.js check-links --input path/to/catalogue.md

# Scrape a single job posting
node src/index.js scrape --url "https://job-boards.greenhouse.io/anthropic/jobs/5125387008"
node src/index.js scrape --url "https://job-boards.greenhouse.io/anthropic/jobs/5125387008" --json

# Discover new AI PM roles across configured companies
node src/index.js discover --config data/companies.json
node src/index.js discover --config data/companies.json --input existing-catalogue.md

# Enrich existing roles with missing salary, requirements, team data
node src/index.js enrich --input path/to/catalogue.md

# Full pipeline (check links + discover + enrich)
node src/index.js full --config data/companies.json --input path/to/catalogue.md
```

## Supported ATS Platforms

| Platform | Method | Coverage |
|----------|--------|----------|
| Greenhouse | JSON API | Full (list + scrape) |
| Ashby | GraphQL API | Full (list + scrape) |
| Lever | JSON API | Full (list + scrape) |
| Workday | Playwright | Scrape only (requires chromium) |
| Custom pages | HTML + JSON-LD | Scrape only |

## Browser Adapter (Optional)

For JS-rendered career pages (Workday, custom sites):

```bash
npm install playwright
npx playwright install chromium
```

## Configuration

Edit `data/companies.json` to add or modify company career page configs.
