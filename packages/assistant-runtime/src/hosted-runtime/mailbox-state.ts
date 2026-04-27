import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  HOSTED_MAILBOX_LANES,
  isHostedMailboxLane,
} from "@murphai/hosted-execution";
import type {
  HostedMailboxLane,
} from "@murphai/hosted-execution";
import {
  parseVersionedJsonStateEnvelope,
  readVersionedJsonStateFile,
  resolveAssistantStatePaths,
  writeVersionedJsonStateFile,
} from "@murphai/runtime-state/node";

export const HOSTED_MAILBOX_IMPORT_STATE_SCHEMA =
  "murph.hosted-mailbox-import-state.v1";
export const HOSTED_MAILBOX_IMPORT_STATE_SCHEMA_VERSION = 1;
export const HOSTED_MAILBOX_IMPORT_STATE_RELATIVE_PATH =
  ".runtime/operations/assistant/hosted-mailbox.json";

export type HostedMailboxImportStatus =
  | "imported"
  | "quarantined"
  | "skipped";

export interface HostedMailboxImportStatusRecord {
  itemKind: string | null;
  lane: HostedMailboxLane;
  occurredAt: string;
  reasonCode: string | null;
  seq: string | null;
  status: HostedMailboxImportStatus;
}

export interface HostedMailboxImportState {
  recentStatuses: HostedMailboxImportStatusRecord[];
  watermarks: Record<HostedMailboxLane, string>;
}

export interface HostedMailboxImportStatusInput {
  itemKind?: string | null;
  lane: HostedMailboxLane;
  occurredAt: string;
  reasonCode?: string | null;
  seq?: string | null;
  status: HostedMailboxImportStatus;
}

const HOSTED_MAILBOX_IMPORT_STATE_LABEL = "hosted mailbox import state";
const DEFAULT_MAX_RECENT_STATUSES = 50;
const DECIMAL_SEQUENCE_PATTERN = /^(?:0|[1-9][0-9]*)$/u;
const STATUS_CODE_PATTERN = /^[a-z][a-z0-9._-]{0,95}$/u;
const STATUS_RECORD_KEYS = new Set([
  "itemKind",
  "lane",
  "occurredAt",
  "reasonCode",
  "seq",
  "status",
]);
const STATE_KEYS = new Set(["recentStatuses", "watermarks"]);

export function resolveHostedMailboxImportStatePath(vaultRoot: string): string {
  const assistantStatePaths = resolveAssistantStatePaths(vaultRoot);
  return path.join(assistantStatePaths.assistantStateRoot, "hosted-mailbox.json");
}

export function createEmptyHostedMailboxImportState(): HostedMailboxImportState {
  return {
    recentStatuses: [],
    watermarks: createEmptyHostedMailboxWatermarks(),
  };
}

export function parseHostedMailboxImportStateEnvelope(
  value: unknown,
): HostedMailboxImportState {
  return parseVersionedJsonStateEnvelope(value, {
    label: HOSTED_MAILBOX_IMPORT_STATE_LABEL,
    parseValue: parseHostedMailboxImportStateValue,
    schema: HOSTED_MAILBOX_IMPORT_STATE_SCHEMA,
    schemaVersion: HOSTED_MAILBOX_IMPORT_STATE_SCHEMA_VERSION,
  });
}

export async function readHostedMailboxImportState(input: {
  vaultRoot: string;
}): Promise<HostedMailboxImportState> {
  try {
    const result = await readVersionedJsonStateFile({
      currentPath: resolveHostedMailboxImportStatePath(input.vaultRoot),
      label: HOSTED_MAILBOX_IMPORT_STATE_LABEL,
      parseValue: parseHostedMailboxImportStateValue,
      schema: HOSTED_MAILBOX_IMPORT_STATE_SCHEMA,
      schemaVersion: HOSTED_MAILBOX_IMPORT_STATE_SCHEMA_VERSION,
    });
    return result.value;
  } catch (error) {
    if (isNodeFileNotFoundError(error)) {
      return createEmptyHostedMailboxImportState();
    }
    throw error;
  }
}

export async function writeHostedMailboxImportState(input: {
  state: HostedMailboxImportState;
  vaultRoot: string;
}): Promise<void> {
  const filePath = resolveHostedMailboxImportStatePath(input.vaultRoot);
  const state = parseHostedMailboxImportStateValue(input.state);

  await writeVersionedJsonStateFile(
    {
      filePath,
      mode: 0o600,
      schema: HOSTED_MAILBOX_IMPORT_STATE_SCHEMA,
      schemaVersion: HOSTED_MAILBOX_IMPORT_STATE_SCHEMA_VERSION,
      value: state,
    },
    {
      chmod,
      async mkdir(directoryPath: string) {
        await mkdir(directoryPath, {
          mode: 0o700,
          recursive: true,
        });
        await chmod(directoryPath, 0o700);
      },
      writeFile(filePathToWrite: string, text: string) {
        return writeFile(filePathToWrite, text, "utf8");
      },
    },
  );
}

export function advanceHostedMailboxLaneWatermark(
  state: HostedMailboxImportState,
  input: {
    lane: HostedMailboxLane;
    seq: string;
  },
): {
  advanced: boolean;
  state: HostedMailboxImportState;
} {
  const normalizedState = parseHostedMailboxImportStateValue(state);
  const lane = parseHostedMailboxLane(input.lane, "hosted mailbox watermark lane");
  const seq = parseHostedMailboxSeq(input.seq, "hosted mailbox watermark seq");
  const currentSeq = normalizedState.watermarks[lane];

  if (compareHostedMailboxSeq(seq, currentSeq) <= 0) {
    return {
      advanced: false,
      state: normalizedState,
    };
  }

  return {
    advanced: true,
    state: {
      ...normalizedState,
      watermarks: {
        ...normalizedState.watermarks,
        [lane]: seq,
      },
    },
  };
}

export function recordHostedMailboxImportStatus(
  state: HostedMailboxImportState,
  input: HostedMailboxImportStatusInput,
  options?: {
    maxRecentStatuses?: number;
  },
): HostedMailboxImportState {
  const normalizedState = parseHostedMailboxImportStateValue(state);
  const record = normalizeHostedMailboxImportStatusInput(input);
  const maxRecentStatuses = options?.maxRecentStatuses ?? DEFAULT_MAX_RECENT_STATUSES;

  if (
    !Number.isSafeInteger(maxRecentStatuses)
    || maxRecentStatuses < 0
  ) {
    throw new TypeError(
      "hosted mailbox import status maxRecentStatuses must be a non-negative safe integer.",
    );
  }

  return {
    ...normalizedState,
    recentStatuses: [...normalizedState.recentStatuses, record].slice(-maxRecentStatuses),
  };
}

export function recordHostedMailboxImportQuarantine(
  state: HostedMailboxImportState,
  input: Omit<HostedMailboxImportStatusInput, "status">,
  options?: {
    maxRecentStatuses?: number;
  },
): HostedMailboxImportState {
  return recordHostedMailboxImportStatus(
    state,
    {
      ...input,
      status: "quarantined",
    },
    options,
  );
}

function parseHostedMailboxImportStateValue(
  value: unknown,
): HostedMailboxImportState {
  const state = assertPlainObject(value, HOSTED_MAILBOX_IMPORT_STATE_LABEL);
  assertObjectKeys(
    state,
    STATE_KEYS,
    `${HOSTED_MAILBOX_IMPORT_STATE_LABEL} value`,
  );

  return {
    recentStatuses: parseHostedMailboxImportStatusRecords(state.recentStatuses),
    watermarks: parseHostedMailboxWatermarks(state.watermarks),
  };
}

function parseHostedMailboxWatermarks(value: unknown): Record<HostedMailboxLane, string> {
  const watermarks = assertPlainObject(value, "hosted mailbox watermarks");
  const keys = Object.keys(watermarks);

  for (const key of keys) {
    parseHostedMailboxLane(key, "hosted mailbox watermark lane");
  }

  for (const lane of HOSTED_MAILBOX_LANES) {
    if (!Object.prototype.hasOwnProperty.call(watermarks, lane)) {
      throw new TypeError(`hosted mailbox watermarks.${lane} is required.`);
    }
  }

  if (keys.length !== HOSTED_MAILBOX_LANES.length) {
    throw new TypeError("hosted mailbox watermarks must contain only supported lanes.");
  }

  return {
    conversation: parseHostedMailboxSeq(
      watermarks.conversation,
      "hosted mailbox conversation watermark",
    ),
    system: parseHostedMailboxSeq(
      watermarks.system,
      "hosted mailbox system watermark",
    ),
  };
}

function createEmptyHostedMailboxWatermarks(): Record<HostedMailboxLane, string> {
  return {
    conversation: "0",
    system: "0",
  };
}

function parseHostedMailboxImportStatusRecords(
  value: unknown,
): HostedMailboxImportStatusRecord[] {
  if (!Array.isArray(value)) {
    throw new TypeError("hosted mailbox import state recentStatuses must be an array.");
  }

  return value.map((record, index) =>
    parseHostedMailboxImportStatusRecord(
      record,
      `hosted mailbox import state recentStatuses[${index}]`,
    ),
  );
}

function parseHostedMailboxImportStatusRecord(
  value: unknown,
  label: string,
): HostedMailboxImportStatusRecord {
  const record = assertPlainObject(value, label);
  assertObjectKeys(record, STATUS_RECORD_KEYS, label);

  return {
    itemKind: parseNullableStatusCode(record.itemKind, `${label}.itemKind`),
    lane: parseHostedMailboxLane(record.lane, `${label}.lane`),
    occurredAt: parseIsoInstant(record.occurredAt, `${label}.occurredAt`),
    reasonCode: parseNullableStatusCode(record.reasonCode, `${label}.reasonCode`),
    seq: record.seq === null
      ? null
      : parseHostedMailboxSeq(record.seq, `${label}.seq`),
    status: parseHostedMailboxImportStatus(record.status, `${label}.status`),
  };
}

function normalizeHostedMailboxImportStatusInput(
  input: HostedMailboxImportStatusInput,
): HostedMailboxImportStatusRecord {
  const record: HostedMailboxImportStatusRecord = {
    itemKind: parseNullableStatusCode(input.itemKind ?? null, "hosted mailbox status itemKind"),
    lane: parseHostedMailboxLane(input.lane, "hosted mailbox status lane"),
    occurredAt: parseIsoInstant(input.occurredAt, "hosted mailbox status occurredAt"),
    reasonCode: parseNullableStatusCode(
      input.reasonCode ?? null,
      "hosted mailbox status reasonCode",
    ),
    seq: input.seq === undefined || input.seq === null
      ? null
      : parseHostedMailboxSeq(input.seq, "hosted mailbox status seq"),
    status: parseHostedMailboxImportStatus(input.status, "hosted mailbox status"),
  };

  if (record.status === "quarantined" && record.reasonCode === null) {
    throw new TypeError("hosted mailbox quarantined status requires a reasonCode.");
  }

  return record;
}

function parseHostedMailboxLane(value: unknown, label: string): HostedMailboxLane {
  if (typeof value !== "string" || !isHostedMailboxLane(value)) {
    throw new TypeError(`${label} must be one of: conversation, system.`);
  }

  return value;
}

function parseHostedMailboxSeq(value: unknown, label: string): string {
  if (typeof value !== "string" || !DECIMAL_SEQUENCE_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a non-negative decimal string.`);
  }

  return value;
}

function parseHostedMailboxImportStatus(
  value: unknown,
  label: string,
): HostedMailboxImportStatus {
  if (typeof value !== "string" || !isHostedMailboxImportStatus(value)) {
    throw new TypeError(`${label} must be one of: imported, quarantined, skipped.`);
  }

  return value;
}

function parseNullableStatusCode(value: unknown, label: string): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a compact status code or null.`);
  }

  const normalized = value.trim();
  if (!STATUS_CODE_PATTERN.test(normalized)) {
    throw new TypeError(`${label} must be a compact status code or null.`);
  }

  return normalized;
}

function parseIsoInstant(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be an ISO instant string.`);
  }

  const normalized = value.trim();
  const timestampMs = Date.parse(normalized);
  if (
    !Number.isFinite(timestampMs)
    || new Date(timestampMs).toISOString() !== normalized
  ) {
    throw new TypeError(`${label} must be an ISO instant string.`);
  }

  return normalized;
}

function compareHostedMailboxSeq(left: string, right: string): number {
  const leftSeq = BigInt(left);
  const rightSeq = BigInt(right);

  if (leftSeq < rightSeq) {
    return -1;
  }

  if (leftSeq > rightSeq) {
    return 1;
  }

  return 0;
}

function assertPlainObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function assertObjectKeys(
  value: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new TypeError(`${label} contains unsupported field ${key}.`);
    }
  }
}

function isNodeFileNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "ENOENT"
  );
}

function isHostedMailboxImportStatus(value: string): value is HostedMailboxImportStatus {
  return value === "imported" || value === "quarantined" || value === "skipped";
}
