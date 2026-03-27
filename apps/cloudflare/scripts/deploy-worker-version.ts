import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { resolveCloudflareDeployPaths } from "../src/deploy-automation.js";
import {
  runHostedWorkerDeployment,
  type DeploymentStatusPayload,
} from "./deploy-worker-version.shared.js";

const args = parseCliArgs(process.argv.slice(2));
const deployPaths = resolveCloudflareDeployPaths(process.cwd());
const configPath = args.configPath ?? path.resolve(process.cwd(), ".deploy", "wrangler.generated.jsonc");
const resultPath = args.resultPath ?? path.join(deployPaths.deployDir, "deployment-result.json");
const secretsFilePath = args.secretsFilePath ?? deployPaths.workerSecretsPath;
const workerName = requireEnv("CF_WORKER_NAME");

const result = await runHostedWorkerDeployment({
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
    async mkdir(target, options) {
      await mkdir(target, options);
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
          WRANGLER_OUTPUT_FILE_PATH: outputFilePath,
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
  resultPath,
  secretsFilePath,
  workerName,
});

console.log(`Rendered Cloudflare deployment result to ${resultPath}`);
if (result.candidateVersionId) {
  console.log(`Candidate version: ${result.candidateVersionId}`);
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

async function runWranglerLogged(
  wranglerArgs: string[],
  envOverrides: Record<string, string> = {},
): Promise<void> {
  const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

  await new Promise<void>((resolve, reject) => {
    const child = spawn(pnpmCommand, ["exec", "wrangler", ...wranglerArgs], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...envOverrides,
      },
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`wrangler ${wranglerArgs.join(" ")} exited with code ${code ?? "unknown"}.`));
    });
  });
}

async function runWranglerJson(wranglerArgs: string[]): Promise<string> {
  const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

  return await new Promise<string>((resolve, reject) => {
    const child = spawn(pnpmCommand, ["exec", "wrangler", ...wranglerArgs], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["inherit", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }

      reject(
        new Error(
          `wrangler ${wranglerArgs.join(" ")} exited with code ${code ?? "unknown"}.${
            stderr.trim().length > 0 ? ` ${stderr.trim()}` : ""
          }`,
        ),
      );
    });
  });
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

function parseCliArgs(argv: string[]): {
  configPath: string | null;
  resultPath: string | null;
  secretsFilePath: string | null;
} {
  let configPath: string | null = null;
  let resultPath: string | null = null;
  let secretsFilePath: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if ((current === "--config" || current === "-c") && next) {
      configPath = path.resolve(process.cwd(), next);
      index += 1;
      continue;
    }

    if (current === "--result" && next) {
      resultPath = path.resolve(process.cwd(), next);
      index += 1;
      continue;
    }

    if (current === "--secrets-file" && next) {
      secretsFilePath = path.resolve(process.cwd(), next);
      index += 1;
      continue;
    }
  }

  return {
    configPath,
    resultPath,
    secretsFilePath,
  };
}

function requireEnv(name: string): string {
  const value = normalizeString(process.env[name]);

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
