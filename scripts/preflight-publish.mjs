import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

const REQUIRED_FILES = [
  "README.md",
  ".github/workflows/deploy-pages.yml",
  ".github/workflows/update-polls.yml",
  "public/index.html",
  "public/app.js",
  "public/styles.css",
  "public/data/polls.json",
  "data/manual-polls.json",
  "data/source-manifest.json",
  "public/.nojekyll"
];

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`OK: ${message}`);
}

function loadJson(relativePath) {
  return JSON.parse(readFileSync(join(ROOT, relativePath), "utf8"));
}

function assert(condition, successMessage, failureMessage) {
  if (condition) {
    pass(successMessage);
  } else {
    fail(failureMessage);
  }
}

function main() {
  for (const relativePath of REQUIRED_FILES) {
    assert(
      existsSync(join(ROOT, relativePath)),
      `${relativePath} exists`,
      `${relativePath} is missing`
    );
  }

  const snapshot = loadJson("public/data/polls.json");
  const manualPolls = loadJson("data/manual-polls.json");
  const packageJson = loadJson("package.json");
  const deployWorkflow = readFileSync(join(ROOT, ".github/workflows/deploy-pages.yml"), "utf8");
  const updateWorkflow = readFileSync(join(ROOT, ".github/workflows/update-polls.yml"), "utf8");
  const appJs = readFileSync(join(ROOT, "public/app.js"), "utf8");
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");

  assert(
    Array.isArray(snapshot.polls) && snapshot.polls.length >= 4,
    `snapshot contains ${snapshot.polls.length} poll rows`,
    "snapshot must contain at least 4 poll rows"
  );

  assert(
    Array.isArray(manualPolls) && manualPolls.length >= 4,
    `manual poll seed contains ${manualPolls.length} records`,
    "manual poll seed must contain at least 4 records"
  );

  assert(
    typeof snapshot.metadata?.warning === "string" && snapshot.metadata.warning.length > 0,
    "snapshot warning banner text is present",
    "snapshot warning banner text is missing"
  );

  assert(
    snapshot.polls.every((poll) => poll.sourceUrl && poll.sourceName),
    "all poll rows include source name and URL",
    "every poll row must include sourceName and sourceUrl"
  );

  assert(
    packageJson.scripts?.start === "node server.mjs",
    "package.json includes the start script",
    "package.json is missing the start script"
  );

  assert(
    packageJson.scripts?.["verify:publish"] === "node scripts/preflight-publish.mjs",
    "package.json includes the publish verification script",
    "package.json is missing the verify:publish script"
  );

  assert(
    deployWorkflow.includes("actions/deploy-pages@v4") && deployWorkflow.includes("branches:"),
    "GitHub Pages deploy workflow looks configured",
    "GitHub Pages deploy workflow is missing expected deployment configuration"
  );

  assert(
    updateWorkflow.includes('cron: "0 */2 * * *"') && updateWorkflow.includes("node scripts/update-polls.mjs"),
    "poll update workflow includes 2-hour refresh scheduling",
    "poll update workflow is missing the expected 2-hour refresh schedule"
  );

  assert(
    appJs.includes("warning-banner") && appJs.includes("setInterval(loadSnapshot, AUTO_REFRESH_MS)"),
    "frontend includes warning banner handling and auto-refresh",
    "frontend is missing warning banner handling or auto-refresh"
  );

  assert(
    readme.includes("GitHub Pages") && readme.includes("Update Poll Snapshot"),
    "README includes GitHub publishing instructions",
    "README is missing the GitHub publishing instructions"
  );

  if (process.exitCode) {
    console.error("\nPreflight checks failed. Fix the items above before uploading the repo.");
    return;
  }

  console.log("\nPublish preflight passed.");
  console.log("Next manual steps:");
  console.log("1. Create a GitHub repo and upload this folder.");
  console.log("2. Set the default branch to main.");
  console.log("3. Enable GitHub Actions and GitHub Pages (GitHub Actions source).");
  console.log("4. Run 'Deploy Poll Tracker' and 'Update Poll Snapshot' once from the Actions tab.");
}

main();
