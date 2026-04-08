import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  runHostedWorkerDeployment,
  type DeploymentStatusPayload,
  type HostedWorkerDeploymentResult,
} from "./deploy-worker-version.shared.js";
import { requireConfiguredString } from "./deploy-automation/shared.ts";
import { resolveDeployWorkerCliPaths } from "./deploy-worker-version-paths.js";
import { runWranglerJson, runWranglerLogged } from "./wrangler-runner.js";

export async function runDeployWorkerVersionCli(
  argv: string[],
  options: {
    deployRoot?: string;
    env?: Readonly<Record<string, string | undefined>>;
    log?: boolean;
    runHostedWorkerDeployment?: typeof runHostedWorkerDeployment;
  } = {},
): Promise<HostedWorkerDeploymentResult> {
  const { configPath, deployPaths, resultPath, secretsFilePath } = resolveDeployWorkerCliPaths(argv, {
    deployRoot: options.deployRoot,
  });
  const env = options.env ?? process.env;
  const workerName = requireEnv("CF_WORKER_NAME", env);

  const result = await (options.runHostedWorkerDeployment ?? runHostedWorkerDeployment)({
    configPath,
    dependencies: {
      async deployDirect(input) {
        await runWranglerLogged([
          "deploy",
          "--config",
          input.configPath,
          "--message",
          input.deploymentMessage,
          "--name",
          input.workerName,
          "--tag",
          input.versionTag,
          ...(input.includeSecrets ? ["--secrets-file", input.secretsFilePath] : []),
        ]);
      },
      async deployVersions(input) {
        await runWranglerLogged([
          "versions",
          "deploy",
          ...input.versionSpecs,
          "--config",
          input.configPath,
          "--message",
          input.deploymentMessage,
          "--name",
          input.workerName,
          "--yes",
        ]);
      },
      mkdir,
      readCurrentDeployment,
      readRenderedDeployConfig,
      async uploadVersion(input) {
        const outputFilePath = path.join(
          await mkdtemp(path.join(tmpdir(), "hosted-cloudflare-upload-")),
          "wrangler-output.jsonl",
        );

        await runWranglerLogged(
          [
            "versions",
            "upload",
            "--config",
            input.configPath,
            "--message",
            input.message,
            "--name",
            input.workerName,
            "--tag",
            input.tag,
            ...(input.includeSecrets ? ["--secrets-file", input.secretsFilePath] : []),
          ],
          {
            envOverrides: {
              WRANGLER_OUTPUT_FILE_PATH: outputFilePath,
            },
          },
        );

        const output = await readWranglerOutputFile(outputFilePath, "version-upload");

        if (!output || typeof output.version_id !== "string" || output.version_id.length === 0) {
          throw new Error("Wrangler did not report a version_id after versions upload.");
        }

        return output.version_id;
      },
      writeFile,
    },
    env,
    resultPath,
    secretsFilePath,
    workerName,
  });

  if (options.log ?? true) {
    console.log(`Rendered Cloudflare deployment result to ${resultPath}`);
    if (result.candidateVersionId) {
      console.log(`Candidate version: ${result.candidateVersionId}`);
    }
  }

  return result;
}

async function readCurrentDeployment(
  currentWorkerName: string,
  currentConfigPath: string,
): Promise<DeploymentStatusPayload | null> {
  try {
    const stdout = await runWranglerJson([
      "deployments",
      "status",
      "--config",
      currentConfigPath,
      "--json",
      "--name",
      currentWorkerName,
    ]);

    return parseJsonValue<DeploymentStatusPayload>(
      stdout,
      `Wrangler deployment status for worker ${currentWorkerName}`,
    );
  } catch (error) {
    if (isWranglerNoDeploymentsError(error)) {
      return null;
    }

    throw error;
  }
}

async function readWranglerOutputFile(
  outputFilePath: string,
  entryType: string,
): Promise<Record<string, unknown> | null> {
  const lines = (await readFile(outputFilePath, "utf8")).split("\n");

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();

    if (!line) {
      continue;
    }

    const entry = parseJsonValue<Record<string, unknown>>(
      line,
      `Wrangler output entry in ${outputFilePath} at line ${index + 1}`,
    );

    if (entry.type === entryType) {
      return entry;
    }
  }

  return null;
}

async function readRenderedDeployConfig(configFilePath: string): Promise<Record<string, unknown>> {
  const content = await readFile(configFilePath, "utf8");

  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    throw new Error(
      `Expected a rendered JSON deploy config at ${configFilePath}. Re-run deploy:config:render before deploying.`,
    );
  }
}

function isWranglerNoDeploymentsError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("has no deployments");
}

function parseJsonValue<T>(value: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new Error(
      `${label} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function requireEnv(name: string, env: Readonly<Record<string, string | undefined>>): string {
  return requireConfiguredString(env[name], name);
}
