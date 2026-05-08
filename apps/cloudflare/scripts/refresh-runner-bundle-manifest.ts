import path from "node:path";

import { writeRunnerBundleManifest } from "./deploy-artifacts.js";
import { resolveCloudflareDeployPaths } from "./deploy-automation.js";

const paths = resolveCloudflareDeployPaths();
const defaultRunnerBundleLabel = "apps/cloudflare/.deploy/runner-bundle";
const runnerBundleDir = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.join(paths.deployDir, "runner-bundle");
const runnerBundleLabel = process.argv[2]
  ? path.isAbsolute(process.argv[2])
    ? "<custom-runner-bundle>"
    : process.argv[2]
  : defaultRunnerBundleLabel;

await writeRunnerBundleManifest(runnerBundleDir);

console.log(`Refreshed runner bundle manifest at ${runnerBundleLabel}`);
