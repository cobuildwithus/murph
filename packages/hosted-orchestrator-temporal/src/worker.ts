import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  NativeConnection,
  Worker,
  type NativeConnectionOptions,
} from "@temporalio/worker";

import * as activities from "./activities/index.js";
import { HOSTED_USER_RUNTIME_TASK_QUEUE } from "./index.js";
import { readHostedRuntimeTemporalEnvironment } from "./temporal-env.js";

const require = createRequire(import.meta.url);

export interface HostedUserRuntimeWorkerOptions {
  address?: string;
  connection?: NativeConnection;
  namespace?: string;
  taskQueue?: string;
  tls?: boolean;
}

export async function createHostedUserRuntimeWorker(
  options: HostedUserRuntimeWorkerOptions = {},
): Promise<Worker> {
  const connection =
    options.connection ??
    (await NativeConnection.connect(buildNativeConnectionOptions(options)));

  return Worker.create({
    activities,
    connection,
    namespace: options.namespace ?? "default",
    taskQueue: options.taskQueue ?? HOSTED_USER_RUNTIME_TASK_QUEUE,
    workflowsPath: resolveHostedUserRuntimeWorkflowsPath(),
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
    tls: options.tls === true,
  };
}

function resolveHostedUserRuntimeWorkflowsPath(): string {
  const sourcePath = fileURLToPath(
    new URL("./workflows/hosted-user-runtime.ts", import.meta.url),
  );
  if (existsSync(sourcePath)) {
    return sourcePath;
  }
  return require.resolve("./workflows/hosted-user-runtime.js");
}
