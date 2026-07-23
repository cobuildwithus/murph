import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  NativeConnection,
  Worker,
  type NativeConnectionOptions,
  type WorkerOptions,
} from "@temporalio/worker";

import * as activities from "./activities/index.js";
import {
  HOSTED_USER_RUNTIME_TASK_QUEUE,
} from "./index.js";
import {
  readHostedRuntimeTemporalEnvironment,
  type HostedRuntimeTemporalTls,
} from "./temporal-env.js";

const require = createRequire(import.meta.url);

export const HOSTED_TEMPORAL_WORKER_DEFAULT_SHUTDOWN_GRACE_MS = 270_000;
export const HOSTED_TEMPORAL_WORKER_DEFAULT_SHUTDOWN_FORCE_MS = 295_000;
export const HOSTED_TEMPORAL_WORKER_DEFAULT_MAX_CONCURRENT_ACTIVITY_TASK_EXECUTIONS = 100;
export const HOSTED_TEMPORAL_WORKER_DEFAULT_MAX_CONCURRENT_WORKFLOW_TASK_EXECUTIONS = 20;
export const HOSTED_TEMPORAL_WORKER_DEFAULT_MAX_CACHED_WORKFLOWS = 100;

type HostedUserRuntimeWorkerEnvSource =
  Readonly<Record<string, string | undefined>>;

export interface HostedUserRuntimeWorkerOptions {
  address?: string;
  apiKey?: string;
  connection?: NativeConnection;
  namespace?: string;
  maxConcurrentActivityTaskExecutions?: number;
  maxConcurrentWorkflowTaskExecutions?: number;
  production?: boolean;
  shutdownForceTimeMs?: number;
  shutdownGraceTimeMs?: number;
  taskQueue?: string;
  tls?: HostedRuntimeTemporalTls;
  workflowBundlePath?: string;
}

export async function createHostedUserRuntimeWorker(
  options: HostedUserRuntimeWorkerOptions = {},
): Promise<Worker> {
  const production = options.production ?? process.env.NODE_ENV === "production";
  const workflowCodeOptions = resolveHostedUserRuntimeWorkflowCodeOptions({
    production,
    workflowBundlePath: options.workflowBundlePath,
  });
  const workerShutdownOptions = resolveHostedUserRuntimeWorkerShutdownOptions({
    production,
    shutdownForceTimeMs: options.shutdownForceTimeMs,
    shutdownGraceTimeMs: options.shutdownGraceTimeMs,
    source: process.env,
  });
  const workerPerformanceOptions = resolveHostedUserRuntimeWorkerPerformanceOptions({
    maxConcurrentActivityTaskExecutions:
      options.maxConcurrentActivityTaskExecutions,
    maxConcurrentWorkflowTaskExecutions:
      options.maxConcurrentWorkflowTaskExecutions,
    production,
    source: process.env,
  });
  const connection =
    options.connection ??
    (await NativeConnection.connect(buildNativeConnectionOptions(options)));

  return Worker.create({
    activities,
    connection,
    namespace: options.namespace ?? "default",
    taskQueue: options.taskQueue ?? HOSTED_USER_RUNTIME_TASK_QUEUE,
    ...workflowCodeOptions,
    ...workerShutdownOptions,
    ...workerPerformanceOptions,
  });
}

export async function runHostedUserRuntimeWorker(
  options: HostedUserRuntimeWorkerOptions = {},
): Promise<void> {
  const worker = await createHostedUserRuntimeWorker(options);
  await worker.run();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const environment = readHostedRuntimeTemporalEnvironment();
  await runHostedUserRuntimeWorker({
    address: environment.address,
    apiKey: environment.apiKey,
    namespace: environment.namespace,
    taskQueue: environment.taskQueue,
    tls: environment.tls,
  });
}

function buildNativeConnectionOptions(
  options: HostedUserRuntimeWorkerOptions,
): NativeConnectionOptions {
  return {
    ...(options.address ? { address: options.address } : {}),
    ...(options.apiKey ? { apiKey: options.apiKey } : {}),
    tls: options.tls ?? false,
  };
}

function resolveHostedUserRuntimeWorkflowsPath(): string {
  const sourcePath = fileURLToPath(
    new URL("./workflows/index.ts", import.meta.url),
  );
  if (existsSync(sourcePath)) {
    return sourcePath;
  }
  return require.resolve("./workflows/index.js");
}

function resolveHostedUserRuntimeWorkflowBundlePath(
  explicitPath?: string,
): string {
  const bundlePath = explicitPath
    ?? fileURLToPath(new URL("./workflow-bundle.js", import.meta.url));
  if (!existsSync(bundlePath)) {
    throw new Error(
      "Hosted Temporal workflow bundle is missing. Run the hosted-orchestrator-temporal build before starting the production worker.",
    );
  }
  return bundlePath;
}

function resolveHostedUserRuntimeWorkflowCodeOptions(input: {
  production: boolean;
  workflowBundlePath?: string;
}): Pick<WorkerOptions, "workflowBundle" | "workflowsPath"> {
  if (input.production) {
    return {
      workflowBundle: {
        codePath: resolveHostedUserRuntimeWorkflowBundlePath(
          input.workflowBundlePath,
        ),
      },
    };
  }

  return {
    workflowsPath: resolveHostedUserRuntimeWorkflowsPath(),
  };
}

export interface HostedUserRuntimeWorkerShutdownOptions {
  shutdownForceTimeMs: number;
  shutdownGraceTimeMs: number;
}

export function readHostedUserRuntimeWorkerShutdownOptions(
  source: HostedUserRuntimeWorkerEnvSource = process.env,
): HostedUserRuntimeWorkerShutdownOptions {
  const entries = readHostedUserRuntimeWorkerShutdownEnvEntries(source);
  return parseHostedUserRuntimeWorkerShutdownOptions(entries);
}

export interface HostedUserRuntimeWorkerPerformanceOptions {
  activityTaskPollerBehavior: { type: "autoscaling" };
  maxCachedWorkflows: number;
  maxConcurrentActivityTaskExecutions: number;
  maxConcurrentWorkflowTaskExecutions: number;
  reuseV8Context: true;
  workflowTaskPollerBehavior: { type: "autoscaling" };
}

export function readHostedUserRuntimeWorkerPerformanceOptions(
  source: HostedUserRuntimeWorkerEnvSource = process.env,
): HostedUserRuntimeWorkerPerformanceOptions {
  const entries = readHostedUserRuntimeWorkerPerformanceEnvEntries(source);
  return parseHostedUserRuntimeWorkerPerformanceOptions(entries, {});
}

function resolveHostedUserRuntimeWorkerShutdownOptions(input: {
  production: boolean;
  shutdownForceTimeMs?: number;
  shutdownGraceTimeMs?: number;
  source: HostedUserRuntimeWorkerEnvSource;
}): Pick<WorkerOptions, "shutdownForceTime" | "shutdownGraceTime"> {
  const entries = readHostedUserRuntimeWorkerShutdownEnvEntries(input.source);
  if (
    !input.production
    && input.shutdownForceTimeMs === undefined
    && input.shutdownGraceTimeMs === undefined
    && !entries.hasPolicy
  ) {
    return {};
  }

  const envOptions = parseHostedUserRuntimeWorkerShutdownOptions(entries);
  const shutdownGraceTimeMs =
    input.shutdownGraceTimeMs ?? envOptions.shutdownGraceTimeMs;
  const shutdownForceTimeMs =
    input.shutdownForceTimeMs ?? envOptions.shutdownForceTimeMs;

  assertPositiveInteger(shutdownGraceTimeMs, "shutdownGraceTimeMs");
  assertPositiveInteger(shutdownForceTimeMs, "shutdownForceTimeMs");
  assertShutdownForceCoversGrace({
    shutdownForceTimeMs,
    shutdownGraceTimeMs,
  });

  return {
    shutdownForceTime: shutdownForceTimeMs,
    shutdownGraceTime: shutdownGraceTimeMs,
  };
}

function resolveHostedUserRuntimeWorkerPerformanceOptions(input: {
  maxConcurrentActivityTaskExecutions?: number;
  maxConcurrentWorkflowTaskExecutions?: number;
  production: boolean;
  source: HostedUserRuntimeWorkerEnvSource;
}): Pick<
  WorkerOptions,
  | "activityTaskPollerBehavior"
  | "maxConcurrentActivityTaskExecutions"
  | "maxConcurrentWorkflowTaskExecutions"
  | "maxCachedWorkflows"
  | "reuseV8Context"
  | "workflowTaskPollerBehavior"
> {
  const entries = readHostedUserRuntimeWorkerPerformanceEnvEntries(input.source);
  if (
    !input.production
    && input.maxConcurrentActivityTaskExecutions === undefined
    && input.maxConcurrentWorkflowTaskExecutions === undefined
    && !entries.hasPolicy
  ) {
    return createHostedUserRuntimeAutoscalingPollerOptions();
  }

  return parseHostedUserRuntimeWorkerPerformanceOptions(entries, {
    maxConcurrentActivityTaskExecutions:
      input.maxConcurrentActivityTaskExecutions,
    maxConcurrentWorkflowTaskExecutions:
      input.maxConcurrentWorkflowTaskExecutions,
  });
}

interface HostedUserRuntimeWorkerShutdownEnvEntries {
  hasPolicy: boolean;
  shutdownForceEntry: { key: string; value: string } | null;
  shutdownGraceEntry: { key: string; value: string } | null;
}

interface HostedUserRuntimeWorkerPerformanceEnvEntries {
  activityExecutionEntry: { key: string; value: string } | null;
  hasPolicy: boolean;
  workflowExecutionEntry: { key: string; value: string } | null;
}

function readHostedUserRuntimeWorkerPerformanceEnvEntries(
  source: HostedUserRuntimeWorkerEnvSource,
): HostedUserRuntimeWorkerPerformanceEnvEntries {
  const activityExecutionEntry = readOptionalEnvEntry(
    source,
    "HOSTED_TEMPORAL_WORKER_MAX_CONCURRENT_ACTIVITY_TASK_EXECUTIONS",
    "TEMPORAL_WORKER_MAX_CONCURRENT_ACTIVITY_TASK_EXECUTIONS",
  );
  const workflowExecutionEntry = readOptionalEnvEntry(
    source,
    "HOSTED_TEMPORAL_WORKER_MAX_CONCURRENT_WORKFLOW_TASK_EXECUTIONS",
    "TEMPORAL_WORKER_MAX_CONCURRENT_WORKFLOW_TASK_EXECUTIONS",
  );
  return {
    activityExecutionEntry,
    hasPolicy:
      activityExecutionEntry !== null || workflowExecutionEntry !== null,
    workflowExecutionEntry,
  };
}

function readHostedUserRuntimeWorkerShutdownEnvEntries(
  source: HostedUserRuntimeWorkerEnvSource,
): HostedUserRuntimeWorkerShutdownEnvEntries {
  const shutdownGraceEntry = readOptionalEnvEntry(
    source,
    "HOSTED_TEMPORAL_WORKER_SHUTDOWN_GRACE_MS",
    "TEMPORAL_WORKER_SHUTDOWN_GRACE_MS",
  );
  const shutdownForceEntry = readOptionalEnvEntry(
    source,
    "HOSTED_TEMPORAL_WORKER_SHUTDOWN_FORCE_MS",
    "TEMPORAL_WORKER_SHUTDOWN_FORCE_MS",
  );
  return {
    hasPolicy: shutdownGraceEntry !== null || shutdownForceEntry !== null,
    shutdownForceEntry,
    shutdownGraceEntry,
  };
}

function parseHostedUserRuntimeWorkerShutdownOptions(
  entries: HostedUserRuntimeWorkerShutdownEnvEntries,
): HostedUserRuntimeWorkerShutdownOptions {
  const shutdownGraceTimeMs = parsePositiveIntegerEnvEntry(
    entries.shutdownGraceEntry,
    HOSTED_TEMPORAL_WORKER_DEFAULT_SHUTDOWN_GRACE_MS,
  );
  const shutdownForceTimeMs = parsePositiveIntegerEnvEntry(
    entries.shutdownForceEntry,
    HOSTED_TEMPORAL_WORKER_DEFAULT_SHUTDOWN_FORCE_MS,
  );

  assertShutdownForceCoversGrace({
    shutdownForceTimeMs,
    shutdownGraceTimeMs,
  });

  return {
    shutdownForceTimeMs,
    shutdownGraceTimeMs,
  };
}

function parseHostedUserRuntimeWorkerPerformanceOptions(
  entries: HostedUserRuntimeWorkerPerformanceEnvEntries,
  overrides: Partial<Pick<
    HostedUserRuntimeWorkerPerformanceOptions,
    | "maxConcurrentActivityTaskExecutions"
    | "maxConcurrentWorkflowTaskExecutions"
  >>,
): HostedUserRuntimeWorkerPerformanceOptions {
  const maxConcurrentActivityTaskExecutions =
    overrides.maxConcurrentActivityTaskExecutions
    ?? parsePositiveIntegerEnvEntry(
      entries.activityExecutionEntry,
      HOSTED_TEMPORAL_WORKER_DEFAULT_MAX_CONCURRENT_ACTIVITY_TASK_EXECUTIONS,
    );
  const maxConcurrentWorkflowTaskExecutions =
    overrides.maxConcurrentWorkflowTaskExecutions
    ?? parsePositiveIntegerEnvEntry(
      entries.workflowExecutionEntry,
      HOSTED_TEMPORAL_WORKER_DEFAULT_MAX_CONCURRENT_WORKFLOW_TASK_EXECUTIONS,
    );

  assertPositiveInteger(
    maxConcurrentActivityTaskExecutions,
    "maxConcurrentActivityTaskExecutions",
  );
  assertIntegerAtLeast(
    maxConcurrentWorkflowTaskExecutions,
    "maxConcurrentWorkflowTaskExecutions",
    2,
  );
  if (
    maxConcurrentWorkflowTaskExecutions
    > HOSTED_TEMPORAL_WORKER_DEFAULT_MAX_CACHED_WORKFLOWS
  ) {
    throw new TypeError(
      `maxConcurrentWorkflowTaskExecutions must be less than or equal to the fixed ${HOSTED_TEMPORAL_WORKER_DEFAULT_MAX_CACHED_WORKFLOWS}-Workflow cache limit.`,
    );
  }

  return {
    ...createHostedUserRuntimeAutoscalingPollerOptions(),
    maxCachedWorkflows: HOSTED_TEMPORAL_WORKER_DEFAULT_MAX_CACHED_WORKFLOWS,
    maxConcurrentActivityTaskExecutions,
    maxConcurrentWorkflowTaskExecutions,
    reuseV8Context: true,
  };
}

function createHostedUserRuntimeAutoscalingPollerOptions(): Pick<
  HostedUserRuntimeWorkerPerformanceOptions,
  "activityTaskPollerBehavior" | "workflowTaskPollerBehavior"
> {
  return {
    activityTaskPollerBehavior: { type: "autoscaling" },
    workflowTaskPollerBehavior: { type: "autoscaling" },
  };
}

function readOptionalEnvEntry(
  source: HostedUserRuntimeWorkerEnvSource,
  ...keys: readonly string[]
): { key: string; value: string } | null {
  for (const key of keys) {
    const value = source[key]?.trim();
    if (value) {
      return { key, value };
    }
  }
  return null;
}

function parsePositiveIntegerEnvEntry(
  entry: { key: string; value: string } | null,
  fallback: number,
): number {
  if (entry === null) {
    return fallback;
  }
  if (!/^[0-9]+$/u.test(entry.value)) {
    throw new TypeError(`${entry.key} must be a positive integer.`);
  }
  const parsed = Number(entry.value);
  assertPositiveInteger(parsed, entry.key);
  return parsed;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
}

function assertIntegerAtLeast(value: number, label: string, min: number): void {
  assertPositiveInteger(value, label);
  if (value < min) {
    throw new TypeError(`${label} must be greater than or equal to ${min}.`);
  }
}

function assertShutdownForceCoversGrace(input: {
  shutdownForceTimeMs: number;
  shutdownGraceTimeMs: number;
}): void {
  if (input.shutdownForceTimeMs < input.shutdownGraceTimeMs) {
    throw new TypeError(
      "HOSTED_TEMPORAL_WORKER_SHUTDOWN_FORCE_MS must be greater than or equal to HOSTED_TEMPORAL_WORKER_SHUTDOWN_GRACE_MS.",
    );
  }
}
