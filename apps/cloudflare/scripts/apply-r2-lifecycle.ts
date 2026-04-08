import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildHostedLifecycleWranglerArgs,
  resolveHostedLifecycleBucketNames,
} from "./r2-lifecycle.js";
import { runWranglerLogged } from "./wrangler-runner.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const lifecycleConfigPath = path.join(appDir, "r2-bundles-lifecycle.json");
const configuredBuckets = resolveHostedLifecycleBucketNames(process.env);

for (const bucketName of configuredBuckets) {
  console.log(`Applying transient lifecycle rules to R2 bucket ${bucketName}...`);
  await runWranglerLogged(
    buildHostedLifecycleWranglerArgs({
      bucketName,
      lifecycleConfigPath,
    }),
    {
      cwd: appDir,
    },
  );
}

console.log(
  `Applied transient lifecycle rules from ${path.relative(process.cwd(), lifecycleConfigPath) || path.basename(lifecycleConfigPath)}.`,
);
