import {
  RunnerWriteFenceAlreadyActiveError,
} from "./runner-state-store.js";
import type { RunnerStateRecord } from "./types.js";

export function readRunnerWriteFenceAlreadyActiveRecord(error: unknown): RunnerStateRecord | null {
  if (error instanceof RunnerWriteFenceAlreadyActiveError) {
    return error.record;
  }
  if (!isObjectRecord(error) || error.name !== "RunnerWriteFenceAlreadyActiveError") {
    return null;
  }
  const record = error.record;
  return isRunnerStateRecord(record) ? record : null;
}

function isRunnerStateRecord(value: unknown): value is RunnerStateRecord {
  return isObjectRecord(value) && "writeFence" in value;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
