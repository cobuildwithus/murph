import {
  parseR2BundlesOnlineCopyArgs,
  R2_BUNDLES_ONLINE_COPY_USAGE,
  runR2BundlesOnlineCopy,
} from "./r2-bundles-online-copy.js";

try {
  const options = parseR2BundlesOnlineCopyArgs(process.argv.slice(2));
  if ("help" in options) {
    console.log(R2_BUNDLES_ONLINE_COPY_USAGE);
  } else {
    await runR2BundlesOnlineCopy(options);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "R2 bundles online copy failed.");
  process.exitCode = 1;
}
