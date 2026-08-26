import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import {
  HOSTED_WEB_WORKFLOW_PREBUILT_CONFIG_CAPTURE_ENV,
  HOSTED_WEB_WORKFLOW_PREBUILT_CONFIG_CAPTURE_FILE_NAME,
} from "./clean-hosted-web-workflow-artifacts.js";

const defaultRepoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const HOSTED_WEB_APP_DIR = "apps/web";
const MAX_JSON_FILE_BYTES = 1024 * 1024;
const WORKFLOW_FUNCTIONS = [
  { configKey: "steps", routeSegment: "step" },
  { configKey: "workflows", routeSegment: "flow" },
] as const;

type JsonObject = Record<string, unknown>;
type WorkflowTrigger = JsonObject & {
  consumer: string;
  initialDelaySeconds: number;
  retryAfterSeconds: number;
  topic: string;
  type: "queue/v2beta";
};
type ExpectedRouteTriggers = {
  routeSegment: string;
  triggers: WorkflowTrigger[];
};
type FunctionGroup = {
  expectedTriggers: WorkflowTrigger[];
  functionConfigPath: string;
};
type FunctionConfigPlan = {
  functionConfigPath: string;
  updatedConfig: JsonObject | null;
};
type CommandInvocation = {
  args: string[];
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  label: string;
};
type CommandRunner = (invocation: CommandInvocation) => Promise<void>;

export async function ensureHostedWebVercelPrebuiltWorkflowTriggers(input: {
  outputDir: string;
  sdkConfigPath: string;
}): Promise<void> {
  const sdkConfig = await readJsonObject(
    input.sdkConfigPath,
    "captured Workflow SDK config",
  );
  const expectedRoutes = parseExpectedRouteTriggers(sdkConfig);

  const outputConfig = await readJsonObject(
    path.join(input.outputDir, "config.json"),
    "Vercel Build Output config",
  );
  if (outputConfig.version !== 3) {
    throw new Error("Vercel Build Output config must declare version 3.");
  }

  const outputRoot = await resolveDirectory(
    input.outputDir,
    "Vercel Build Output directory",
  );
  const functionsRoot = await resolveDirectory(
    path.join(input.outputDir, "functions"),
    "Vercel functions directory",
  );
  assertPathWithin(outputRoot, functionsRoot, "Vercel functions directory");

  const plans = await createFunctionConfigPlans({
    expectedRoutes,
    functionsRoot,
  });
  for (const plan of plans) {
    if (plan.updatedConfig !== null) {
      await writeJsonAtomically(plan.functionConfigPath, plan.updatedConfig);
    }
  }

  const verificationPlans = await createFunctionConfigPlans({
    expectedRoutes,
    functionsRoot,
  });
  if (verificationPlans.some((plan) => plan.updatedConfig !== null)) {
    throw new Error(
      "Vercel prebuilt Workflow trigger validation failed after repairing the artifact.",
    );
  }
}

export async function deployHostedWebVercelPrebuilt(input: {
  commandRunner?: CommandRunner;
  repoRoot?: string;
  vercelArgs?: string[];
} = {}): Promise<void> {
  const repoRoot = await resolveDirectory(
    input.repoRoot ?? defaultRepoRoot,
    "repository root",
  );
  const appDir = await resolveDirectory(
    path.join(repoRoot, HOSTED_WEB_APP_DIR),
    "Hosted Web application directory",
  );
  assertPathWithin(repoRoot, appDir, "Hosted Web application directory");

  const outputDir = path.join(appDir, ".vercel/output");
  const captureDirectory = await mkdtemp(
    path.join(os.tmpdir(), "hosted-web-workflow-prebuilt-"),
  );
  const sdkConfigPath = path.join(
    captureDirectory,
    HOSTED_WEB_WORKFLOW_PREBUILT_CONFIG_CAPTURE_FILE_NAME,
  );
  const commandRunner = input.commandRunner ?? runCommand;
  const vercelArgs = input.vercelArgs ?? [];

  const buildEnv = {
    ...process.env,
    [HOSTED_WEB_WORKFLOW_PREBUILT_CONFIG_CAPTURE_ENV]: sdkConfigPath,
  };
  const deployEnv = { ...process.env };
  delete deployEnv[HOSTED_WEB_WORKFLOW_PREBUILT_CONFIG_CAPTURE_ENV];

  try {
    await commandRunner({
      args: ["build", ...vercelArgs],
      command: "vercel",
      cwd: appDir,
      env: buildEnv,
      label: "local Vercel prebuilt build",
    });

    const resolvedOutputDir = await resolveDirectory(
      outputDir,
      "Vercel Build Output directory",
    );
    assertPathWithin(appDir, resolvedOutputDir, "Vercel Build Output directory");
    await ensureHostedWebVercelPrebuiltWorkflowTriggers({
      outputDir: resolvedOutputDir,
      sdkConfigPath,
    });

    // The SDK evidence is outside .vercel/output and must not outlive this proof.
    // A cleanup failure blocks the upload rather than leaving ambiguous state.
    await rm(sdkConfigPath, { force: true });

    await commandRunner({
      args: ["deploy", "--prebuilt", ...vercelArgs],
      command: "vercel",
      cwd: appDir,
      env: deployEnv,
      label: "Vercel prebuilt upload",
    });
  } finally {
    await rm(captureDirectory, { force: true, recursive: true });
  }
}

async function createFunctionConfigPlans(input: {
  expectedRoutes: ExpectedRouteTriggers[];
  functionsRoot: string;
}): Promise<FunctionConfigPlan[]> {
  const groups = await resolveFunctionGroups(input.functionsRoot, input.expectedRoutes);
  const plans = await Promise.all(
    [...groups.values()].map(async (group): Promise<FunctionConfigPlan> => {
      const currentConfig = await readJsonObject(
        group.functionConfigPath,
        "resolved Vercel function .vc-config.json",
      );
      const currentTriggers = parseExistingTriggers(currentConfig);
      const mergedTriggers = mergeRequiredWorkflowTriggers(
        currentTriggers,
        group.expectedTriggers,
        "Resolved Vercel function contains a conflicting Workflow queue trigger.",
      );

      return {
        functionConfigPath: group.functionConfigPath,
        updatedConfig: mergedTriggers.length === currentTriggers.length
          ? null
          : {
              ...currentConfig,
              experimentalTriggers: mergedTriggers,
            },
      };
    }),
  );

  return plans.sort((left, right) =>
    left.functionConfigPath.localeCompare(right.functionConfigPath)
  );
}

async function resolveFunctionGroups(
  functionsRoot: string,
  expectedRoutes: ExpectedRouteTriggers[],
): Promise<Map<string, FunctionGroup>> {
  const resolvedRoutes = await Promise.all(
    expectedRoutes.map(async (route) => ({
      route,
      functionConfigPath: await resolveRouteFunctionConfig(
        functionsRoot,
        route.routeSegment,
      ),
    })),
  );
  const groups = new Map<string, FunctionGroup>();

  for (const resolvedRoute of resolvedRoutes) {
    const existingGroup = groups.get(resolvedRoute.functionConfigPath);
    if (!existingGroup) {
      groups.set(resolvedRoute.functionConfigPath, {
        expectedTriggers: [...resolvedRoute.route.triggers],
        functionConfigPath: resolvedRoute.functionConfigPath,
      });
      continue;
    }

    existingGroup.expectedTriggers = mergeRequiredWorkflowTriggers(
      existingGroup.expectedTriggers,
      resolvedRoute.route.triggers,
      "Captured Workflow SDK config contains conflicting queue triggers " +
        "for one final function.",
    );
  }

  return groups;
}

async function resolveRouteFunctionConfig(
  functionsRoot: string,
  routeSegment: string,
): Promise<string> {
  const routeFunctionDir = await resolveDirectory(
    path.join(
      functionsRoot,
      ".well-known",
      "workflow",
      "v1",
      `${routeSegment}.func`,
    ),
    `Workflow ${routeSegment} route function`,
  );
  assertPathWithin(
    functionsRoot,
    routeFunctionDir,
    `Workflow ${routeSegment} route function`,
  );

  return path.join(routeFunctionDir, ".vc-config.json");
}

function parseExpectedRouteTriggers(config: JsonObject): ExpectedRouteTriggers[] {
  if (config.version !== "0") {
    throw new Error("Captured Workflow SDK config must declare version \"0\".");
  }

  return WORKFLOW_FUNCTIONS.map(({ configKey, routeSegment }) => {
    const functionConfig = config[configKey];
    if (!isJsonObject(functionConfig)) {
      throw new Error(`Captured Workflow SDK config is missing ${configKey}.`);
    }

    const triggerValues = functionConfig.experimentalTriggers;
    if (!Array.isArray(triggerValues) || triggerValues.length === 0) {
      throw new Error(
        `Captured Workflow SDK config ${configKey}.experimentalTriggers ` +
          "must be a non-empty array.",
      );
    }

    const triggers = triggerValues.map((value, index) => {
      if (!isWorkflowTrigger(value)) {
        throw new Error(
          `Captured Workflow SDK config ${configKey}.experimentalTriggers[${index}] ` +
            "is not a valid queue/v2beta trigger.",
        );
      }
      return value;
    });
    assertUnambiguousTriggerSet(
      triggers,
      `Captured Workflow SDK config ${configKey}.experimentalTriggers`,
    );

    return { routeSegment, triggers };
  });
}

function parseExistingTriggers(config: JsonObject): JsonObject[] {
  if (!Object.hasOwn(config, "experimentalTriggers")) {
    return [];
  }

  const triggerValues = config.experimentalTriggers;
  if (!Array.isArray(triggerValues)) {
    throw new Error(
      "Resolved Vercel function experimentalTriggers must be an array when present.",
    );
  }

  const triggers = triggerValues.map((value, index) => {
    if (!isJsonObject(value)) {
      throw new Error(
        `Resolved Vercel function experimentalTriggers[${index}] must be a JSON object.`,
      );
    }
    return value;
  });
  return triggers;
}

function mergeRequiredWorkflowTriggers<T extends JsonObject>(
  currentTriggers: T[],
  requiredTriggers: WorkflowTrigger[],
  conflictMessage: string,
): Array<T | WorkflowTrigger> {
  const merged: Array<T | WorkflowTrigger> = [...currentTriggers];

  for (const requiredTrigger of requiredTriggers) {
    const identity = workflowTriggerIdentity(requiredTrigger);
    const matching = merged.filter(
      (trigger) => queueTriggerIdentity(trigger) === identity,
    );

    if (matching.length === 0) {
      merged.push(requiredTrigger);
      continue;
    }
    if (
      matching.length === 1 &&
      isDeepStrictEqual(matching[0], requiredTrigger)
    ) {
      continue;
    }
    throw new Error(conflictMessage);
  }

  return merged;
}

function assertUnambiguousTriggerSet(
  triggers: WorkflowTrigger[],
  label: string,
): void {
  for (let index = 0; index < triggers.length; index += 1) {
    for (
      let comparisonIndex = index + 1;
      comparisonIndex < triggers.length;
      comparisonIndex += 1
    ) {
      if (isDeepStrictEqual(triggers[index], triggers[comparisonIndex])) {
        throw new Error(`${label} contains a duplicate trigger.`);
      }
      if (
        workflowTriggerIdentity(triggers[index]) ===
        workflowTriggerIdentity(triggers[comparisonIndex])
      ) {
        throw new Error(`${label} contains conflicting queue trigger identities.`);
      }
    }
  }
}

function workflowTriggerIdentity(trigger: WorkflowTrigger): string {
  return JSON.stringify([trigger.type, trigger.topic, trigger.consumer]);
}

function queueTriggerIdentity(trigger: JsonObject): string | null {
  if (
    typeof trigger.type !== "string" ||
    typeof trigger.topic !== "string" ||
    typeof trigger.consumer !== "string"
  ) {
    return null;
  }
  return JSON.stringify([trigger.type, trigger.topic, trigger.consumer]);
}

function isWorkflowTrigger(value: unknown): value is WorkflowTrigger {
  return isJsonObject(value) &&
    value.type === "queue/v2beta" &&
    typeof value.topic === "string" &&
    value.topic.trim().length > 0 &&
    typeof value.consumer === "string" &&
    value.consumer.trim().length > 0 &&
    typeof value.retryAfterSeconds === "number" &&
    Number.isInteger(value.retryAfterSeconds) &&
    value.retryAfterSeconds >= 0 &&
    typeof value.initialDelaySeconds === "number" &&
    Number.isInteger(value.initialDelaySeconds) &&
    value.initialDelaySeconds >= 0;
}

async function readJsonObject(filePath: string, label: string): Promise<JsonObject> {
  const fileStats = await assertRegularFile(filePath, label);
  if (fileStats.size > MAX_JSON_FILE_BYTES) {
    throw new Error(`${label} exceeds the supported size limit.`);
  }

  let contents: string;
  try {
    contents = await readFile(filePath, "utf8");
  } catch {
    throw new Error(`Unable to read ${label}.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
  if (!isJsonObject(parsed)) {
    throw new Error(`${label} must contain one JSON object.`);
  }

  return parsed;
}

async function assertRegularFile(
  filePath: string,
  label: string,
): Promise<import("node:fs").Stats> {
  let fileStats;
  try {
    fileStats = await lstat(filePath);
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new Error(`${label} is missing.`);
    }
    throw new Error(`Unable to inspect ${label}.`);
  }
  if (!fileStats.isFile()) {
    throw new Error(`${label} must be a regular file.`);
  }

  return fileStats;
}

async function resolveDirectory(directoryPath: string, label: string): Promise<string> {
  let resolvedPath: string;
  try {
    resolvedPath = await realpath(directoryPath);
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new Error(`${label} is missing.`);
    }
    throw new Error(`Unable to resolve ${label}.`);
  }

  let directoryStats;
  try {
    directoryStats = await stat(resolvedPath);
  } catch {
    throw new Error(`Unable to inspect ${label}.`);
  }
  if (!directoryStats.isDirectory()) {
    throw new Error(`${label} must resolve to a directory.`);
  }

  return resolvedPath;
}

function assertPathWithin(rootPath: string, candidatePath: string, label: string): void {
  const relativePath = path.relative(rootPath, candidatePath);
  if (
    relativePath === "" ||
    (!path.isAbsolute(relativePath) &&
      relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`))
  ) {
    return;
  }
  throw new Error(`${label} resolves outside its allowed local build boundary.`);
}

async function writeJsonAtomically(
  filePath: string,
  value: JsonObject,
): Promise<void> {
  const fileStats = await stat(filePath);
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;

  try {
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: fileStats.mode & 0o777,
    });
    await rename(tempPath, filePath);
  } finally {
    await rm(tempPath, { force: true });
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value);
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT";
}

async function runCommand(invocation: CommandInvocation): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: invocation.env,
      shell: false,
      stdio: "inherit",
    });

    child.once("error", () => {
      reject(new Error(`Unable to start ${invocation.label}.`));
    });
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const outcome = signal
        ? `signal ${signal}`
        : `exit code ${code ?? "unknown"}`;
      reject(new Error(`${invocation.label} failed with ${outcome}.`));
    });
  });
}

export async function main(): Promise<void> {
  await deployHostedWebVercelPrebuilt({
    vercelArgs: process.argv.slice(2),
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Hosted Web Vercel prebuilt deployment failed.";
    console.error(message);
    process.exitCode = 1;
  }
}
