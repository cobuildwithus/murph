import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildHostedWranglerDeployConfig,
  readHostedDeployAutomationEnvironment,
  resolveCloudflareDeployPaths,
} from "./deploy-automation.js";
import { assertPreparedRunnerBundle } from "./deploy-artifacts.js";

const deployPaths = resolveCloudflareDeployPaths();
const outputPath = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : deployPaths.wranglerConfigPath;
const runnerBundleManifest = await assertPreparedRunnerBundle({
  runnerBundleDir: path.join(deployPaths.deployDir, "runner-bundle"),
});

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  `${JSON.stringify(buildHostedWranglerDeployConfig(
    readHostedDeployAutomationEnvironment(),
    { runnerBundleManifest },
  ), null, 2)}\n`,
  "utf8",
);

console.log(`Rendered Cloudflare deploy config to ${outputPath}`);
