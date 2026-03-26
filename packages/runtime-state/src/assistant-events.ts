import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  assistantAutomationEventCursorSchema,
  assistantAutomationEventSchema,
  toAssistantAutomationEventCursor,
  type AssistantAutomationEvent,
  type AssistantAutomationEventCursor,
} from "@healthybob/contracts";

import type { AssistantStatePaths } from "./assistant-state.js";
import { acquireDirectoryLock } from "./locks.js";
import { buildProcessCommand, isProcessRunning } from "./shared.js";
import { generateUlid } from "./ulid.js";

const ASSISTANT_EVENT_QUEUE_LOCK_DIRECTORY = ".assistant-events.lock";
const ASSISTANT_EVENT_QUEUE_LOCK_METADATA_PATH = ".assistant-events.lock.json";

interface AssistantEventQueueLockMetadata {
  command: string;
  pid: number;
  startedAt: string;
}

export interface ListAssistantAutomationEventsOptions {
  after?: AssistantAutomationEventCursor | null;
  limit?: number;
}

export function createAssistantAutomationEventId(at: Date | number | string = Date.now()): string {
  const timestamp =
    at instanceof Date
      ? at.getTime()
      : typeof at === "number"
        ? at
        : Date.parse(at);

  if (!Number.isFinite(timestamp)) {
    throw new TypeError("Assistant automation event ids require a valid timestamp.");
  }

  return generateUlid(timestamp);
}

export async function appendAssistantAutomationEvent(
  paths: AssistantStatePaths,
  event: AssistantAutomationEvent,
): Promise<AssistantAutomationEvent> {
  const [parsed] = await appendAssistantAutomationEvents(paths, [event]);
  return parsed as AssistantAutomationEvent;
}

export async function appendAssistantAutomationEvents(
  paths: AssistantStatePaths,
  events: readonly AssistantAutomationEvent[],
): Promise<AssistantAutomationEvent[]> {
  if (events.length === 0) {
    return [];
  }

  const parsed = events.map((event) => assistantAutomationEventSchema.parse(event));
  const handle = await acquireAssistantEventQueueWriteLock(paths);

  try {
    await mkdir(path.dirname(paths.eventQueuePath), { recursive: true });
    await appendFile(
      paths.eventQueuePath,
      `${parsed.map((event) => JSON.stringify(event)).join("\n")}\n`,
      "utf8",
    );
  } finally {
    await handle.release();
  }

  return parsed;
}

export async function listAssistantAutomationEvents(
  paths: AssistantStatePaths,
  options: ListAssistantAutomationEventsOptions = {},
): Promise<AssistantAutomationEvent[]> {
  let raw: string;

  try {
    raw = await readFile(paths.eventQueuePath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }

    throw error;
  }

  const after =
    options.after === undefined || options.after === null
      ? null
      : assistantAutomationEventCursorSchema.parse(options.after);
  const limit =
    typeof options.limit === "number" && Number.isFinite(options.limit)
      ? Math.max(Math.trunc(options.limit), 0)
      : null;
  const events = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => assistantAutomationEventSchema.parse(JSON.parse(line) as unknown))
    .filter((event) => after === null || compareAssistantAutomationEventCursor(event, after) > 0);

  return limit === null ? events : events.slice(0, limit);
}

export function compareAssistantAutomationEventCursor(
  left:
    | AssistantAutomationEvent
    | AssistantAutomationEventCursor
    | { eventId: string; occurredAt: string },
  right:
    | AssistantAutomationEvent
    | AssistantAutomationEventCursor
    | { eventId: string; occurredAt: string },
): number {
  const leftCursor =
    "type" in left
      ? toAssistantAutomationEventCursor(left)
      : assistantAutomationEventCursorSchema.parse(left);
  const rightCursor =
    "type" in right
      ? toAssistantAutomationEventCursor(right)
      : assistantAutomationEventCursorSchema.parse(right);

  return (
    leftCursor.eventId.localeCompare(rightCursor.eventId) ||
    leftCursor.occurredAt.localeCompare(rightCursor.occurredAt)
  );
}

async function acquireAssistantEventQueueWriteLock(paths: AssistantStatePaths): Promise<{
  release(): Promise<void>;
}> {
  return acquireDirectoryLock({
    ownerKey: `assistant-events:${paths.assistantStateRoot}`,
    lockPath: path.join(paths.assistantStateRoot, ASSISTANT_EVENT_QUEUE_LOCK_DIRECTORY),
    metadataPath: path.join(paths.assistantStateRoot, ASSISTANT_EVENT_QUEUE_LOCK_METADATA_PATH),
    metadata: {
      command: buildProcessCommand(),
      pid: process.pid,
      startedAt: new Date().toISOString(),
    },
    parseMetadata(value) {
      return isAssistantEventQueueLockMetadata(value) ? value : null;
    },
    invalidMetadataReason: "Assistant event queue lock metadata is malformed.",
    cleanupRetries: 3,
    cleanupRetryDelayMs: 10,
    inspectStale(metadata) {
      return isProcessRunning(metadata.pid) ? null : `Process ${metadata.pid} is no longer running.`;
    },
  });
}

function isAssistantEventQueueLockMetadata(
  value: unknown,
): value is AssistantEventQueueLockMetadata {
  return Boolean(
    value &&
      typeof value === "object" &&
      "command" in value &&
      typeof (value as { command?: unknown }).command === "string" &&
      "pid" in value &&
      typeof (value as { pid?: unknown }).pid === "number" &&
      Number.isInteger((value as { pid: number }).pid) &&
      "startedAt" in value &&
      typeof (value as { startedAt?: unknown }).startedAt === "string",
  );
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT",
  );
}
