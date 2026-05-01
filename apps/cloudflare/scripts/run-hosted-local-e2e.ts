import process from "node:process";

import { runHostedLocalE2eSuite } from "../../../packages/hosted-local-harness/src/e2e.ts";

// Compatibility entrypoint for existing package scripts and tests.
// Runner bundle preparation remains owned by callers that still invoke this
// script directly. New callers should prefer:
//   scripts/hosted-local.ts e2e <scenario> --profile e2e:stub
await runHostedLocalE2eSuite({
  env: process.env,
  injectSkipRunnerBundleEnv: false,
  prepareRunnerBundle: false,
  scenario: "all",
});
