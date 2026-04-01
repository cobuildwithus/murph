import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  runHostedWorkerDeployment,
  type DeploymentStatusPayload,
  type HostedWorkerDeploymentResult,
} from "./deploy-worker-version.shared.js";
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
      async mkdir(target, mkdirOptions) {
        await mkdir(target, mkdirOptions);
      },
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

    return JSON.parse(stdout) as DeploymentStatusPayload;
  } catch (error) {
    if (error instanceof Error && error.message.includes("has no deployments")) {
      return null;
    }

    throw error;
  }
}

async function readWranglerOutputFile(
  outputFilePath: string,
  type: string,
): Promise<Record<string, unknown> | null> {
  const content = await readFile(outputFilePath, "utf8");
  const entries = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];

    if (entry.type === type) {
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

function requireEnv(name: string, env: Readonly<Record<string, string | undefined>>): string {
  const value = normalizeString(env[name]);

  if (!value) {
    throw new Error(`${name} must be configured.`);
  }

  return value;
}

function normalizeString(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
