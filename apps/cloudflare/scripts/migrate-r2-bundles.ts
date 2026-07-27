import {
  parseR2BundlesMigrationArgs,
  R2_BUNDLES_MIGRATION_USAGE,
  runR2BundlesMigration,
} from "./r2-bundles-migration.js";

try {
  const options = parseR2BundlesMigrationArgs(process.argv.slice(2));
  if ("help" in options) {
    console.log(R2_BUNDLES_MIGRATION_USAGE);
  } else {
    await runR2BundlesMigration(options);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "R2 bundles migration failed.");
  process.exitCode = 1;
}
