import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildHostedWorkerSecretsPayload,
  resolveCloudflareDeployPaths,
} from "../src/deploy-automation.js";

const outputPath = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : resolveCloudflareDeployPaths().workerSecretsPath;

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(buildHostedWorkerSecretsPayload(), null, 2)}\n`, "utf8");

console.log(`Rendered Cloudflare worker secrets payload to ${outputPath}`);
