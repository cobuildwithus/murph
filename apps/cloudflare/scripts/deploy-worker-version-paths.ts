import path from "node:path";

import { resolveCloudflareDeployPaths } from "./deploy-automation.js";
import { runnerBundleDirectoryName } from "./runner-bundle-contract.js";

type DeployWorkerPathFlag = "--config" | "-c" | "--result" | "--secrets-file";

export function resolveDeployWorkerCliPaths(
  argv: string[],
  options: {
    deployRoot?: string;
  } = {},
): {
  configPath: string;
  resultPath: string;
  runnerBundleDir: string;
  secretsFilePath: string;
} {
  const deployRoot = options.deployRoot ?? path.dirname(resolveCloudflareDeployPaths().deployDir);
  const deployPaths = resolveCloudflareDeployPaths(deployRoot);

  let configPath = deployPaths.wranglerConfigPath;
  let resultPath = path.join(deployPaths.deployDir, "deployment-result.json");
  let secretsFilePath = deployPaths.workerSecretsPath;

  const assignPathFlag = (flag: DeployWorkerPathFlag, value: string): void => {
    switch (flag) {
      case "--config":
      case "-c":
        configPath = path.resolve(deployRoot, value);
        return;
      case "--result":
        resultPath = path.resolve(deployRoot, value);
        return;
      case "--secrets-file":
        secretsFilePath = path.resolve(deployRoot, value);
        return;
    }
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];

    if (current === "--") {
      continue;
    }

    const equalsIndex = current.indexOf("=");
    if (equalsIndex > 0) {
      const flag = current.slice(0, equalsIndex);
      const value = current.slice(equalsIndex + 1);
      if (!isDeployWorkerPathFlag(flag)) {
        throw new Error(formatUnsupportedDeployWorkerArgument(flag));
      }
      assignPathFlag(flag, requireDeployWorkerPathValue(flag, value));
      continue;
    }

    if (isDeployWorkerPathFlag(current)) {
      const next = argv[index + 1];
      assignPathFlag(current, requireDeployWorkerPathValue(current, next));
      index += 1;
      continue;
    }

    throw new Error(formatUnsupportedDeployWorkerArgument(current));
  }

  return {
    configPath,
    resultPath,
    runnerBundleDir: path.join(deployPaths.deployDir, runnerBundleDirectoryName),
    secretsFilePath,
  };
}

function isDeployWorkerPathFlag(flag: string): flag is DeployWorkerPathFlag {
  return (
    flag === "--config" ||
    flag === "-c" ||
    flag === "--result" ||
    flag === "--secrets-file"
  );
}

function requireDeployWorkerPathValue(flag: DeployWorkerPathFlag, value: string | undefined): string {
  if (!value || value.startsWith("-")) {
    throw new Error(`Missing value for ${flag}.`);
  }

  return value;
}

function formatUnsupportedDeployWorkerArgument(argument: string): string {
  const safeArgument = argument.includes("=") ? argument.slice(0, argument.indexOf("=")) : argument;
  return [
    `Unsupported deploy worker argument: ${safeArgument}.`,
    "deploy:worker:apply accepts only --config, --result, and --secrets-file.",
    "Run deploy:artifacts before apply to prepare generated deploy inputs.",
  ].join(" ");
}
