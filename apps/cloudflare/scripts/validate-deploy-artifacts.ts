import { assertPreparedDeployArtifacts } from "./deploy-artifacts.js";
import { readBooleanEnv } from "./deploy-automation/shared.ts";
import { resolveDeployWorkerCliPaths } from "./deploy-worker-version-paths.js";

const {
  configPath,
  runnerBundleDir,
  secretsFilePath,
} = resolveDeployWorkerCliPaths(process.argv.slice(2));

await assertPreparedDeployArtifacts({
  configPath,
  includeSecrets: readBooleanEnv(process.env.HOSTED_EXECUTION_INCLUDE_SECRETS, true),
  runnerBundleDir,
  secretsFilePath,
});

console.log("Cloudflare deploy artifacts validated.");
