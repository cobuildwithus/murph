import path from "node:path";

import { resolveCloudflareDeployPaths } from "../src/deploy-automation.js";

export function resolveDeployWorkerCliPaths(
  argv: string[],
  options: {
    deployRoot?: string;
  } = {},
): {
  configPath: string;
  deployPaths: ReturnType<typeof resolveCloudflareDeployPaths>;
  resultPath: string;
  secretsFilePath: string;
} {
  const deployRoot = options.deployRoot ?? path.dirname(resolveCloudflareDeployPaths().deployDir);
  const deployPaths = resolveCloudflareDeployPaths(deployRoot);

  let configPath = deployPaths.wranglerConfigPath;
  let resultPath = path.join(deployPaths.deployDir, "deployment-result.json");
  let secretsFilePath = deployPaths.workerSecretsPath;

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if ((current === "--config" || current === "-c") && next) {
      configPath = path.resolve(deployRoot, next);
      index += 1;
      continue;
    }

    if (current === "--result" && next) {
      resultPath = path.resolve(deployRoot, next);
      index += 1;
      continue;
    }

    if (current === "--secrets-file" && next) {
      secretsFilePath = path.resolve(deployRoot, next);
      index += 1;
      continue;
    }
  }

  return {
    configPath,
    deployPaths,
    resultPath,
    secretsFilePath,
  };
}
