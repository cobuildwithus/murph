import {
  parseR2BundlesActiveOwnerGateArgs,
  R2_BUNDLES_ACTIVE_OWNER_GATE_USAGE,
  runR2BundlesActiveOwnerGate,
} from "./r2-bundles-migration.js";

try {
  const options = parseR2BundlesActiveOwnerGateArgs(process.argv.slice(2));
  if ("help" in options) {
    console.log(R2_BUNDLES_ACTIVE_OWNER_GATE_USAGE);
  } else {
    await runR2BundlesActiveOwnerGate(options);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "R2 active-owner gate failed.");
  process.exitCode = 1;
}
