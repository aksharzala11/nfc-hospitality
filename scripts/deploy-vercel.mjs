#!/usr/bin/env node
/**
 * Deploy the working tree to the Vercel dev-testing project without git metadata.
 *
 *   npm run deploy:vercel            # production target (naam-five.vercel.app)
 *   npm run deploy:vercel -- --preview
 *
 * Why: the Vercel CLI attributes a deployment to the author of the latest git
 * commit. On a Hobby account, if HEAD was authored by someone else (e.g. a
 * teammate's commit on main) the deploy is rejected as coming from an outside
 * contributor. Deploying from a copy with no .git avoids that: the deployment
 * belongs to whoever is logged in to the CLI.
 *
 * Only tracked and untracked-but-not-ignored files are copied, so .env files,
 * node_modules and .next never leave the machine.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

if (!existsSync(".vercel/project.json")) {
  console.error("No .vercel/project.json here. Run `npx vercel link` once from the repo root.");
  process.exit(1);
}

const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

// Sweep copies left by earlier runs. The Vercel CLI keeps a background process
// alive for a few seconds after exiting, which on Windows locks the folder, so
// the end-of-run cleanup below can fail; by the next run the lock is gone.
for (const name of readdirSync(tmpdir())) {
  if (!name.startsWith("naam-vercel-")) continue;
  try {
    rmSync(join(tmpdir(), name), { recursive: true, force: true });
  } catch {
    /* still locked; try again next time */
  }
}

const dest = mkdtempSync(join(tmpdir(), "naam-vercel-"));
for (const f of files) {
  if (!existsSync(f)) continue; // deleted but still in the index
  mkdirSync(dirname(join(dest, f)), { recursive: true });
  cpSync(f, join(dest, f));
}
cpSync(".vercel", join(dest, ".vercel"), { recursive: true });
console.log(`Copied ${files.length} files to ${dest}`);

const target = process.argv.includes("--preview") ? [] : ["--prod"];
const result = spawnSync("npx", ["vercel", ...target, "--yes"], { cwd: dest, stdio: "inherit", shell: true });

// Windows can briefly hold handles on the folder after the CLI exits; retry,
// and never let a cleanup hiccup mask the deploy result.
try {
  rmSync(dest, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 });
} catch {
  // Expected on Windows; the sweep at the start of the next run removes it.
}
process.exit(result.status ?? 1);
