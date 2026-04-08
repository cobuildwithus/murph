import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildHostedWranglerDeployConfig,
  readHostedDeployAutomationEnvironment,
  resolveCloudflareDeployPaths,
} from "./deploy-automation.js";

const outputPath = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : resolveCloudflareDeployPaths().wranglerConfigPath;

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  `${JSON.stringify(buildHostedWranglerDeployConfig(readHostedDeployAutomationEnvironment()), null, 2)}\n`,
  "utf8",
);

console.log(`Rendered Cloudflare deploy config to ${outputPath}`);
