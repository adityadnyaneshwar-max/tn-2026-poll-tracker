# Tamil Nadu 2026 Poll Tracker

Static poll-tracker frontend plus a lightweight Node updater that refreshes a JSON snapshot of Tamil Nadu 2026 Assembly election opinion polls.

## What it does

- Shows a sortable table with poll date, pollster, seat projections, vote shares, and source links.
- Keeps the newest updates on top by default.
- Validates source links during ingestion.
- Falls back to the last cached snapshot and surfaces a warning when live fetching fails.
- Supports scheduled refreshes every 2 hours through GitHub Actions.

## Local preview

Run the updater in offline mode first to generate a snapshot from the verified seed rows:

```powershell
node scripts/update-polls.mjs --offline
node scripts/preflight-publish.mjs
node server.mjs
```

Then open `http://127.0.0.1:3000`.

## Live refresh pipeline

The updater combines:

- `data/manual-polls.json` for verified seed records and PDF-based sources.
- `data/source-manifest.json` for source-domain allowlists and search queries.
- RSS discovery via Google News and Bing News, followed by article parsing and deduplication.

The scheduled workflow in `.github/workflows/update-polls.yml` runs every 2 hours and writes the latest snapshot to `public/data/polls.json`.

## Deployment

The repo includes a GitHub Pages deployment workflow in `.github/workflows/deploy-pages.yml`.

### GitHub Pages

1. Push this project to a GitHub repository.
2. Set the default branch to `main`.
3. In GitHub, open `Settings -> Pages` and choose GitHub Actions as the source.
4. Run the `Deploy Poll Tracker` workflow or push to `main`.
5. Keep the `Update Poll Snapshot` workflow enabled so `public/data/polls.json` refreshes every 2 hours.

The site stays static, while the scheduled workflow updates the JSON data snapshot in-place.

If you want a single pre-upload validation step, run:

```powershell
node scripts/preflight-publish.mjs
```

The full manual checklist is in `PUBLISH_CHECKLIST.md`.

### Netlify

- The included `netlify.toml` publishes `public/`.
- `public/data/polls.json` is configured with revalidation-friendly cache headers so the tracker can pick up fresh snapshots.
- If you host on Netlify instead of GitHub Pages, you can still use the GitHub Action updater to commit fresh data back to the repo every 2 hours.

### Vercel

- The included `vercel.json` serves `public/` as a static site and applies low-cache headers to `public/data/polls.json`.
- As with Netlify, the scheduled GitHub Action can remain the polling-data refresh mechanism.

## Notes

- The frontend uses cache-busting query params when requesting `public/data/polls.json`.
- GitHub Pages itself does not let this repo set custom response headers, so the client-side cache busting is important there.
- The current seed data is intentionally conservative: verified polls are included first, and the live discovery pipeline only adds rows when it can extract at least two usable signals from a source.
