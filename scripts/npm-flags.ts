/**
 * npm takes an option given without "--" before it as its own: `npm run sant:menu:sync --dry-run`
 * runs the script WITHOUT --dry-run and only sets `npm_config_dry_run=true` in its environment
 * (checked with npm 11; the variable survives dotenv-cli in the :lightsail scripts). A dry run
 * meant for review would then write. The Santo sync and import scripts read --dry-run through
 * wantsDryRun(), so that slip still makes a dry run, and say so. No database access here.
 */

/** npm took `--<flag>` as its own option (it was given without "--" before it). */
export function npmTook(flag: string): boolean {
  return process.env[`npm_config_${flag.replace(/-/g, "_")}`] === "true";
}

/** --dry-run was given, after "--" as it should be or swallowed by npm (then with a note on stderr). */
export function wantsDryRun(args: Record<string, string>): boolean {
  if (args["dry-run"] === "true") return true;
  if (!npmTook("dry-run")) return false;
  console.error(
    'npm took --dry-run as its own option (no "--" before it): running as a dry run anyway. ' +
      "Next time: npm run <script> -- --dry-run",
  );
  return true;
}
