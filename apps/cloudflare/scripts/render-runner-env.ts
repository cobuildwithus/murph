import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildHostedRunnerEnvironment,
  formatEnvFile,
  resolveCloudflareDeployPaths,
} from "../src/deploy-automation.js";

const outputPath = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : resolveCloudflareDeployPaths().runnerEnvPath;

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, formatEnvFile(buildHostedRunnerEnvironment()), "utf8");

console.log(`Rendered hosted runner env file to ${outputPath}`);
