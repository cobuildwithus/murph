import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildHostedLifecycleWranglerArgs,
  createHostedLifecycleWranglerError,
  resolveHostedLifecycleBucketNames,
} from "../src/r2-lifecycle.js";
import { resolvePnpmCommand } from "./wrangler-runner.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const lifecycleConfigPath = path.join(appDir, "r2-bundles-lifecycle.json");
const configuredBuckets = resolveHostedLifecycleBucketNames(process.env);

for (const bucketName of configuredBuckets) {
  console.log(`Applying transient lifecycle rules to R2 bucket ${bucketName}...`);
  await runWranglerCommand(
    buildHostedLifecycleWranglerArgs({
      bucketName,
      lifecycleConfigPath,
    }),
  );
}

console.log(
  `Applied transient lifecycle rules from ${path.relative(process.cwd(), lifecycleConfigPath) || path.basename(lifecycleConfigPath)}.`,
);

function runWranglerCommand(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolvePnpmCommand(), args, {
      cwd: appDir,
      env: process.env,
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(createHostedLifecycleWranglerError({ code, signal }));
    });
  });
}
