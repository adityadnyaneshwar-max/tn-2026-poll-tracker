# Publish Checklist

## Before upload

Run these locally:

```powershell
node scripts/update-polls.mjs --offline
node scripts/preflight-publish.mjs
node server.mjs
```

Then confirm:

- The local site opens at `http://127.0.0.1:3000`
- The table shows 4 seeded poll rows
- Sorting works on at least two columns
- Search filters rows
- Source links open
- The warning banner appears when the snapshot is in cached/manual mode

## In GitHub

1. Create a new repository and upload this project.
2. Make sure the default branch is `main`.
3. Open `Settings -> Actions -> General` and allow workflows.
4. Open `Settings -> Pages` and set the source to `GitHub Actions`.
5. Open `Actions` and run `Deploy Poll Tracker`.
6. Open `Actions` and run `Update Poll Snapshot`.
7. Confirm both workflow runs succeed.

## After publish

- Open the GitHub Pages URL and confirm the homepage loads.
- Confirm the latest snapshot still renders a poll table.
- Confirm the Actions tab shows the 2-hour updater schedule.
- Confirm later commits to `public/data/polls.json` are created by the refresh workflow.
