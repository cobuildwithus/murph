import "server-only";

import type {
  HostedRuntimeLogEntry,
} from "@murphai/hosted-execution/runtime-control";

import {
  isHostedRuntimeLogDatabaseConfigured,
} from "./database";
import {
  recordHostedRuntimeLogs,
} from "./store";

export async function writeHostedRuntimeLogs(input: {
  entries: readonly HostedRuntimeLogEntry[];
  userId: string;
}): Promise<number> {
  if (!isHostedRuntimeLogDatabaseConfigured()) {
    return 0;
  }

  return recordHostedRuntimeLogs(input);
}
