import {
  HOSTED_RUNTIME_TEMPORAL_DEFAULT_ADDRESS,
  readHostedRuntimeTemporalEnvironment as readSharedHostedRuntimeTemporalEnvironment,
  readHostedRuntimeTemporalWorkflowOptions,
  type HostedRuntimeTemporalEnvSource,
  type HostedRuntimeTemporalTls,
} from "@murphai/hosted-execution/temporal-env";

import type {
  HostedUserRuntimeWorkflowOptions,
} from "./workflow-types.js";

export interface HostedRuntimeTemporalEnvironment {
  address: string;
  apiKey?: string;
  namespace: string;
  taskQueue: string;
  tls: HostedRuntimeTemporalTls;
}

export type { HostedRuntimeTemporalTls };

export function readHostedRuntimeTemporalEnvironment(
  source: HostedRuntimeTemporalEnvSource = process.env,
): HostedRuntimeTemporalEnvironment {
  const environment = readSharedHostedRuntimeTemporalEnvironment(source, {
    defaultAddress: HOSTED_RUNTIME_TEMPORAL_DEFAULT_ADDRESS,
  });
  if (environment.address === null) {
    throw new TypeError("TEMPORAL_ADDRESS must be configured.");
  }

  return {
    address: environment.address,
    ...(environment.apiKey !== null ? { apiKey: environment.apiKey } : {}),
    namespace: environment.namespace,
    taskQueue: environment.taskQueue,
    tls: environment.tls,
  };
}

export function readHostedUserRuntimeWorkflowOptions(
  source: HostedRuntimeTemporalEnvSource = process.env,
): HostedUserRuntimeWorkflowOptions {
  return readHostedRuntimeTemporalWorkflowOptions(source);
}
