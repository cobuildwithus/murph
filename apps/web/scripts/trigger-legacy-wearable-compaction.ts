import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { HostedBillingStatus, type PrismaClient } from "@prisma/client";
import { Client, Connection, type ConnectionOptions } from "@temporalio/client";
import {
  HOSTED_USER_RUNTIME_SIGNAL_NAME,
  HOSTED_USER_RUNTIME_TASK_QUEUE,
  HOSTED_USER_RUNTIME_WORKFLOW_TYPE,
  type HostedRuntimeSignal,
} from "@murphai/hosted-execution";
import {
  parseHostedRuntimeSignal,
  parseHostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/parsers";
import {
  readHostedRuntimeTemporalEnvironment,
  readHostedRuntimeTemporalWorkflowOptions,
  type HostedRuntimeTemporalEnvironment,
} from "@murphai/hosted-execution/temporal-env";

import {
  getPrisma,
} from "../src/lib/prisma";

export const LEGACY_WEARABLE_RECEIPT_COMPACTION_WAKE_REASON =
  "legacy-wearable-receipt-compaction-v1";
export const LEGACY_WEARABLE_COMPACTION_REPORT_SCHEMA =
  "murph.hosted-legacy-wearable-compaction-trigger.report.v1";
const SKIP_LOCAL_ENV_FILES_ENV = "MURPH_SKIP_LOCAL_ENV_FILES";

const DEFAULT_WAIT_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_POLL_MS = 15_000;

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const hostedWorkspaceSelect = {
  checkpointedAt: true,
  nextWakeAt: true,
  nextWakeReason: true,
  redactedStatusJson: true,
  snapshotRef: true,
  updatedAt: true,
  userId: true,
  version: true,
} as const;

export interface HostedWorkspaceRow {
  checkpointedAt: Date | null;
  nextWakeAt: Date | null;
  nextWakeReason: string | null;
  redactedStatusJson: unknown;
  snapshotRef: unknown;
  updatedAt: Date;
  userId: string;
  version: bigint;
}

export interface HostedMemberTargetRow {
  hostedWorkspace: HostedWorkspaceRow | null;
  id: string;
}

type TriggerMode = "dry_run" | "execute";

export interface HostedLegacyWearableCompactionStore {
  findWorkspace(userId: string): Promise<HostedWorkspaceRow | null>;
  findWorkspaces(userIds: readonly string[]): Promise<HostedWorkspaceRow[]>;
  listActiveMembers(input: {
    limit: number | null;
    memberIds: readonly string[];
  }): Promise<HostedMemberTargetRow[]>;
  markCompactionWakeDue(input: {
    forceExistingWake: boolean;
    now: Date;
    userId: string;
    version: bigint;
  }): Promise<{ count: number }>;
}

export interface HostedUserRuntimeSignalClient {
  workflow: {
    signalWithStart(
      workflowType: typeof HOSTED_USER_RUNTIME_WORKFLOW_TYPE,
      options: {
        args: unknown[];
        signal: typeof HOSTED_USER_RUNTIME_SIGNAL_NAME;
        signalArgs: [HostedRuntimeSignal];
        taskQueue: string;
        workflowId: string;
      },
    ): Promise<unknown>;
  };
}

interface OwnedHostedUserRuntimeSignalClient {
  client: HostedUserRuntimeSignalClient;
  close(): Promise<void>;
}

export interface HostedLegacyWearableCompactionOptions {
  forceExistingWake: boolean;
  help: boolean;
  limit: number | null;
  memberIds: string[];
  mode: TriggerMode;
  pollMs: number;
  timeoutMs: number;
  wait: boolean;
}

export interface SnapshotSizeReport {
  encryptedBytes: number | null;
  encryptedMiB: number | null;
  fileCount: number | null;
  kind: "v2" | "unavailable";
  plainBytes: number | null;
  plainMiB: number | null;
}

export interface LegacyWearableCompactionStatusReport {
  bytesAfter: number | null;
  bytesBefore: number | null;
  compactedCount: number | null;
  hasMore: boolean | null;
  mutated: boolean | null;
  oversizedEnvelopeSkippedCount: number | null;
  oversizedEvidenceSkippedCount: number | null;
  scannedCount: number | null;
  skippedCount: number | null;
}

export interface LegacyWearableCompactionTargetReport {
  after: SnapshotSizeReport | null;
  before: SnapshotSizeReport | null;
  compaction: LegacyWearableCompactionStatusReport | null;
  dryRun: boolean;
  scheduledWakeReason: string | null;
  signalAccepted: boolean;
  status:
    | "checkpointed_without_compaction_status"
    | "completed"
    | "conflict"
    | "dry_run"
    | "scheduled"
    | "signal_failed"
    | "skipped_existing_wake"
    | "skipped_no_snapshot"
    | "skipped_no_workspace"
    | "timeout";
  target: number;
  versionAfterSchedule: string | null;
  versionBefore: string | null;
}

export interface LegacyWearableCompactionReport {
  completedAt: string;
  mode: TriggerMode;
  schema: typeof LEGACY_WEARABLE_COMPACTION_REPORT_SCHEMA;
  startedAt: string;
  targets: LegacyWearableCompactionTargetReport[];
  totals: LegacyWearableCompactionTotals;
  wakeReason: typeof LEGACY_WEARABLE_RECEIPT_COMPACTION_WAKE_REASON;
  wait: boolean;
}

export interface LegacyWearableCompactionTotals {
  afterEncryptedBytes: number;
  afterKnownCount: number;
  afterPlainBytes: number;
  beforeEncryptedBytes: number;
  beforeKnownCount: number;
  beforePlainBytes: number;
  completedCount: number;
  encryptedDeltaBytes: number | null;
  scheduledCount: number;
  skippedCount: number;
  targetCount: number;
  timeoutCount: number;
}

interface PendingTarget {
  report: LegacyWearableCompactionTargetReport;
  scheduledAt: Date;
  scheduledVersion: bigint;
  userId: string;
}

export function parseHostedLegacyWearableCompactionArgs(
  args: readonly string[],
): HostedLegacyWearableCompactionOptions {
  let mode: TriggerMode = "dry_run";
  let explicitDryRun = false;
  let explicitExecute = false;
  let forceExistingWake = false;
  let wait = false;
  let limit: number | null = null;
  let timeoutMs = DEFAULT_WAIT_TIMEOUT_MS;
  let pollMs = DEFAULT_POLL_MS;
  const memberIds: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";

    if (arg === "--") {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      return {
        forceExistingWake,
        help: true,
        limit,
        memberIds,
        mode,
        pollMs,
        timeoutMs,
        wait,
      };
    }

    if (arg === "--execute") {
      explicitExecute = true;
      mode = "execute";
      continue;
    }

    if (arg === "--dry-run") {
      explicitDryRun = true;
      mode = "dry_run";
      continue;
    }

    if (arg === "--wait") {
      wait = true;
      continue;
    }

    if (arg === "--force-existing-wake") {
      forceExistingWake = true;
      continue;
    }

    if (arg === "--limit") {
      index += 1;
      limit = parsePositiveInteger(args[index], "--limit");
      continue;
    }

    if (arg.startsWith("--limit=")) {
      limit = parsePositiveInteger(arg.slice("--limit=".length), "--limit");
      continue;
    }

    if (arg === "--member-id") {
      index += 1;
      memberIds.push(parseMemberId(args[index]));
      continue;
    }

    if (arg.startsWith("--member-id=")) {
      memberIds.push(parseMemberId(arg.slice("--member-id=".length)));
      continue;
    }

    if (arg === "--timeout-ms") {
      index += 1;
      timeoutMs = parsePositiveInteger(args[index], "--timeout-ms");
      continue;
    }

    if (arg.startsWith("--timeout-ms=")) {
      timeoutMs = parsePositiveInteger(arg.slice("--timeout-ms=".length), "--timeout-ms");
      continue;
    }

    if (arg === "--poll-ms") {
      index += 1;
      pollMs = parsePositiveInteger(args[index], "--poll-ms");
      continue;
    }

    if (arg.startsWith("--poll-ms=")) {
      pollMs = parsePositiveInteger(arg.slice("--poll-ms=".length), "--poll-ms");
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  if (explicitDryRun && explicitExecute) {
    throw new Error("Use either --dry-run or --execute, not both.");
  }

  if (wait && mode !== "execute") {
    throw new Error("--wait requires --execute.");
  }

  return {
    forceExistingWake,
    help: false,
    limit,
    memberIds,
    mode,
    pollMs,
    timeoutMs,
    wait,
  };
}

export async function runHostedLegacyWearableCompactionTrigger(input: {
  createTemporalClient?: () => Promise<HostedUserRuntimeSignalClient>;
  now?: Date;
  options: HostedLegacyWearableCompactionOptions;
  store: HostedLegacyWearableCompactionStore;
}): Promise<LegacyWearableCompactionReport> {
  const startedAt = input.now ?? new Date();
  const rows = await input.store.listActiveMembers({
    limit: input.options.limit,
    memberIds: input.options.memberIds,
  });

  const reports: LegacyWearableCompactionTargetReport[] = [];
  const pending: PendingTarget[] = [];
  let temporalOwner: OwnedHostedUserRuntimeSignalClient | null = null;
  let client: HostedUserRuntimeSignalClient | null = null;

  if (input.options.mode === "execute") {
    if (input.createTemporalClient) {
      client = await input.createTemporalClient();
    } else {
      temporalOwner = await createTemporalClient();
      client = temporalOwner.client;
    }
  }

  try {
    for (const [index, row] of rows.entries()) {
      const target = index + 1;
      const workspace = row.hostedWorkspace;

      if (!workspace) {
        reports.push(createSkippedTargetReport(target, "skipped_no_workspace"));
        continue;
      }

      const before = readSnapshotSizeReport(workspace.snapshotRef);
      const baseReport: LegacyWearableCompactionTargetReport = {
        after: null,
        before,
        compaction: readLegacyWearableCompactionStatusReport(
          workspace.redactedStatusJson,
        ),
        dryRun: input.options.mode === "dry_run",
        scheduledWakeReason: null,
        signalAccepted: false,
        status: "dry_run",
        target,
        versionAfterSchedule: null,
        versionBefore: workspace.version.toString(),
      };

      if (!workspace.snapshotRef) {
        reports.push({
          ...baseReport,
          status: "skipped_no_snapshot",
        });
        continue;
      }

      if (hasNonCompactionWorkspaceWake(workspace) && !input.options.forceExistingWake) {
        reports.push({
          ...baseReport,
          status: "skipped_existing_wake",
        });
        continue;
      }

      if (input.options.mode === "dry_run") {
        reports.push(baseReport);
        continue;
      }

      if (client === null) {
        throw new Error("Temporal client is required for execute mode.");
      }

      const scheduled = await scheduleLegacyWearableCompactionWake({
        forceExistingWake: input.options.forceExistingWake,
        now: startedAt,
        store: input.store,
        userId: row.id,
        version: workspace.version,
      });

      if (!scheduled) {
        reports.push({
          ...baseReport,
          status: "conflict",
        });
        continue;
      }

      const scheduledVersion = scheduled.version;
      const scheduledReport: LegacyWearableCompactionTargetReport = {
        ...baseReport,
        scheduledWakeReason:
          LEGACY_WEARABLE_RECEIPT_COMPACTION_WAKE_REASON,
        status: "scheduled",
        versionAfterSchedule: scheduledVersion.toString(),
      };
      reports.push(scheduledReport);

      try {
        await signalHostedUserRuntimeWorkflow({
          client,
          signal: parseHostedRuntimeSignal({ kind: "mailbox_lag_observed" }),
          userId: row.id,
        });
        scheduledReport.signalAccepted = true;
        pending.push({
          report: scheduledReport,
          scheduledAt: startedAt,
          scheduledVersion,
          userId: row.id,
        });
      } catch {
        scheduledReport.status = "signal_failed";
      }
    }

    if (input.options.wait && pending.length > 0) {
      await waitForCompactionTargets({
        pending,
        pollMs: input.options.pollMs,
        store: input.store,
        timeoutMs: input.options.timeoutMs,
      });
    }

    return {
      completedAt: new Date().toISOString(),
      mode: input.options.mode,
      schema: LEGACY_WEARABLE_COMPACTION_REPORT_SCHEMA,
      startedAt: startedAt.toISOString(),
      targets: reports,
      totals: buildLegacyWearableCompactionTotals(reports),
      wakeReason: LEGACY_WEARABLE_RECEIPT_COMPACTION_WAKE_REASON,
      wait: input.options.wait,
    };
  } finally {
    await temporalOwner?.close();
  }
}

export function readSnapshotSizeReport(value: unknown): SnapshotSizeReport {
  try {
    const ref = parseHostedWorkspaceSnapshotV2Ref(value);
    return {
      encryptedBytes: ref.archive.encryptedByteSize,
      encryptedMiB: bytesToMiB(ref.archive.encryptedByteSize),
      fileCount: ref.archive.fileCount,
      kind: "v2",
      plainBytes: ref.archive.totalPlainBytes,
      plainMiB: bytesToMiB(ref.archive.totalPlainBytes),
    };
  } catch {
    return {
      encryptedBytes: null,
      encryptedMiB: null,
      fileCount: null,
      kind: "unavailable",
      plainBytes: null,
      plainMiB: null,
    };
  }
}

export function readLegacyWearableCompactionStatusReport(
  value: unknown,
): LegacyWearableCompactionStatusReport | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (
    !Object.hasOwn(record, "legacyWearableReceiptCompactionBytesBefore")
    && !Object.hasOwn(record, "legacyWearableReceiptCompactionCompactedCount")
  ) {
    return null;
  }

  return {
    bytesAfter: readOptionalFiniteNumber(
      record.legacyWearableReceiptCompactionBytesAfter,
    ),
    bytesBefore: readOptionalFiniteNumber(
      record.legacyWearableReceiptCompactionBytesBefore,
    ),
    compactedCount: readOptionalFiniteNumber(
      record.legacyWearableReceiptCompactionCompactedCount,
    ),
    hasMore: readOptionalBoolean(
      record.legacyWearableReceiptCompactionHasMore,
    ),
    mutated: readOptionalBoolean(
      record.legacyWearableReceiptCompactionMutated,
    ),
    oversizedEnvelopeSkippedCount: readOptionalFiniteNumber(
      record.legacyWearableReceiptCompactionOversizedEnvelopeSkippedCount,
    ),
    oversizedEvidenceSkippedCount: readOptionalFiniteNumber(
      record.legacyWearableReceiptCompactionOversizedEvidenceSkippedCount,
    ),
    scannedCount: readOptionalFiniteNumber(
      record.legacyWearableReceiptCompactionScannedCount,
    ),
    skippedCount: readOptionalFiniteNumber(
      record.legacyWearableReceiptCompactionSkippedCount,
    ),
  };
}

export function buildLegacyWearableCompactionTotals(
  targets: readonly LegacyWearableCompactionTargetReport[],
): LegacyWearableCompactionTotals {
  let beforeEncryptedBytes = 0;
  let beforePlainBytes = 0;
  let beforeKnownCount = 0;
  let afterEncryptedBytes = 0;
  let afterPlainBytes = 0;
  let afterKnownCount = 0;
  let scheduledCount = 0;
  let completedCount = 0;
  let skippedCount = 0;
  let timeoutCount = 0;

  for (const target of targets) {
    if (target.before?.encryptedBytes != null && target.before?.plainBytes != null) {
      beforeEncryptedBytes += target.before.encryptedBytes;
      beforePlainBytes += target.before.plainBytes;
      beforeKnownCount += 1;
    }
    if (target.after?.encryptedBytes != null && target.after?.plainBytes != null) {
      afterEncryptedBytes += target.after.encryptedBytes;
      afterPlainBytes += target.after.plainBytes;
      afterKnownCount += 1;
    }
    if (target.versionAfterSchedule !== null) {
      scheduledCount += 1;
    }
    if (target.status === "completed") {
      completedCount += 1;
    }
    if (target.status.startsWith("skipped_")) {
      skippedCount += 1;
    }
    if (target.status === "timeout") {
      timeoutCount += 1;
    }
  }

  return {
    afterEncryptedBytes,
    afterKnownCount,
    afterPlainBytes,
    beforeEncryptedBytes,
    beforeKnownCount,
    beforePlainBytes,
    completedCount,
    encryptedDeltaBytes: afterKnownCount > 0 && afterKnownCount === beforeKnownCount
      ? afterEncryptedBytes - beforeEncryptedBytes
      : null,
    scheduledCount,
    skippedCount,
    targetCount: targets.length,
    timeoutCount,
  };
}

export function hostedLegacyWearableCompactionUsage(): string {
  return [
    "Usage: pnpm --dir apps/web hosted:legacy-wearable-compaction -- [options]",
    "",
    "Options:",
    "  --dry-run              List active hosted workspaces and current sizes only. Default.",
    "  --execute              Schedule the compaction wake and signal hosted runtime workflows.",
    "  --wait                 Poll for after sizes until compaction finishes or times out.",
    "  --force-existing-wake  Replace an existing non-compaction workspace wake.",
    "  --limit <count>        Limit active hosted members selected.",
    "  --member-id <id>       Restrict to a member id. Repeatable.",
    "  --timeout-ms <ms>      Wait timeout. Default: 900000.",
    "  --poll-ms <ms>         Wait poll interval. Default: 15000.",
  ].join("\n");
}

async function scheduleLegacyWearableCompactionWake(input: {
  forceExistingWake: boolean;
  now: Date;
  store: HostedLegacyWearableCompactionStore;
  userId: string;
  version: bigint;
}): Promise<HostedWorkspaceRow | null> {
  const updated = await input.store.markCompactionWakeDue({
    forceExistingWake: input.forceExistingWake,
    now: input.now,
    userId: input.userId,
    version: input.version,
  });

  if (updated.count !== 1) {
    return null;
  }

  return input.store.findWorkspace(input.userId);
}

async function waitForCompactionTargets(input: {
  pending: PendingTarget[];
  pollMs: number;
  store: HostedLegacyWearableCompactionStore;
  timeoutMs: number;
}): Promise<void> {
  const pending = new Map(input.pending.map((target) => [target.userId, target]));
  const deadlineMs = Date.now() + input.timeoutMs;

  while (pending.size > 0 && Date.now() <= deadlineMs) {
    const rows = await input.store.findWorkspaces([...pending.keys()]);
    const rowByUserId = new Map(rows.map((row) => [row.userId, row]));

    for (const [userId, target] of pending.entries()) {
      const row = rowByUserId.get(userId);
      if (!row) {
        target.report.status = "conflict";
        pending.delete(userId);
        continue;
      }

      target.report.after = readSnapshotSizeReport(row.snapshotRef);
      target.report.compaction =
        readLegacyWearableCompactionStatusReport(row.redactedStatusJson);

      if (row.version <= target.scheduledVersion) {
        continue;
      }

      if (!isAfter(row.checkpointedAt, target.scheduledAt)) {
        continue;
      }

      if (
        row.nextWakeReason === LEGACY_WEARABLE_RECEIPT_COMPACTION_WAKE_REASON
        || target.report.compaction?.hasMore === true
      ) {
        continue;
      }

      if (!target.report.compaction) {
        target.report.status = "checkpointed_without_compaction_status";
        pending.delete(userId);
        continue;
      }

      target.report.status = "completed";
      pending.delete(userId);
    }

    if (pending.size > 0 && Date.now() < deadlineMs) {
      await sleep(Math.min(input.pollMs, Math.max(1, deadlineMs - Date.now())));
    }
  }

  for (const target of pending.values()) {
    target.report.status = "timeout";
  }
}

function createSkippedTargetReport(
  target: number,
  status: "skipped_existing_wake" | "skipped_no_snapshot" | "skipped_no_workspace",
): LegacyWearableCompactionTargetReport {
  return {
    after: null,
    before: null,
    compaction: null,
    dryRun: true,
    scheduledWakeReason: null,
    signalAccepted: false,
    status,
    target,
    versionAfterSchedule: null,
    versionBefore: null,
  };
}

function hasNonCompactionWorkspaceWake(workspace: HostedWorkspaceRow): boolean {
  return workspace.nextWakeAt !== null
    && workspace.nextWakeReason !== LEGACY_WEARABLE_RECEIPT_COMPACTION_WAKE_REASON;
}

async function createTemporalClient(): Promise<OwnedHostedUserRuntimeSignalClient> {
  const environment = readHostedRuntimeTemporalEnvironment(process.env, {
    defaultAddress: null,
  });
  if (!environment.address) {
    throw new Error("HOSTED_TEMPORAL_ADDRESS or TEMPORAL_ADDRESS is required for --execute.");
  }

  const connection = await Connection.connect(buildTemporalConnectionOptions(environment));
  return {
    client: new Client({
      connection,
      namespace: environment.namespace,
    }),
    close: () => connection.close(),
  };
}

async function signalHostedUserRuntimeWorkflow(input: {
  client: HostedUserRuntimeSignalClient;
  signal: HostedRuntimeSignal;
  userId: string;
}): Promise<void> {
  const environment = readHostedRuntimeTemporalEnvironment(process.env, {
    defaultAddress: null,
  });
  await input.client.workflow.signalWithStart(
    HOSTED_USER_RUNTIME_WORKFLOW_TYPE,
    {
      args: [{
        options: readHostedRuntimeTemporalWorkflowOptions(),
        userId: input.userId,
      }],
      signal: HOSTED_USER_RUNTIME_SIGNAL_NAME,
      signalArgs: [input.signal],
      taskQueue: environment.taskQueue || HOSTED_USER_RUNTIME_TASK_QUEUE,
      workflowId: hostedUserRuntimeWorkflowId(input.userId),
    },
  );
}

function hostedUserRuntimeWorkflowId(userId: string): string {
  const normalized = userId.trim();
  if (!normalized) {
    throw new Error("Hosted runtime workflow userId is required.");
  }

  return `hosted-user-runtime:${normalized}`;
}

function buildTemporalConnectionOptions(
  environment: HostedRuntimeTemporalEnvironment,
): ConnectionOptions {
  if (!environment.address) {
    throw new Error("HOSTED_TEMPORAL_ADDRESS or TEMPORAL_ADDRESS is required for --execute.");
  }

  return {
    address: environment.address,
    ...(environment.apiKey ? { apiKey: environment.apiKey } : {}),
    tls: environment.tls,
  };
}

export function createHostedLegacyWearableCompactionStore(
  prisma: PrismaClient,
): HostedLegacyWearableCompactionStore {
  return {
    findWorkspace(userId) {
      return prisma.hostedWorkspace.findUnique({
        select: hostedWorkspaceSelect,
        where: {
          userId,
        },
      });
    },
    findWorkspaces(userIds) {
      return prisma.hostedWorkspace.findMany({
        select: hostedWorkspaceSelect,
        where: {
          userId: {
            in: [...userIds],
          },
        },
      });
    },
    listActiveMembers(input) {
      return prisma.hostedMember.findMany({
        orderBy: [
          { createdAt: "asc" },
          { id: "asc" },
        ],
        select: {
          hostedWorkspace: {
            select: hostedWorkspaceSelect,
          },
          id: true,
        },
        take: input.limit ?? undefined,
        where: {
          billingStatus: HostedBillingStatus.active,
          ...(input.memberIds.length > 0
            ? { id: { in: [...input.memberIds] } }
            : {}),
          suspendedAt: null,
        },
      });
    },
    markCompactionWakeDue(input) {
      return prisma.hostedWorkspace.updateMany({
        data: {
          nextWakeAt: input.now,
          nextWakeReason: LEGACY_WEARABLE_RECEIPT_COMPACTION_WAKE_REASON,
          version: {
            increment: 1,
          },
        },
        where: {
          ...(input.forceExistingWake
            ? {}
            : {
                OR: [
                  {
                    nextWakeAt: null,
                  },
                  {
                    nextWakeReason: LEGACY_WEARABLE_RECEIPT_COMPACTION_WAKE_REASON,
                  },
                ],
              }),
          userId: input.userId,
          version: input.version,
        },
      });
    },
  };
}

function loadHostedWebEnvFiles(): void {
  if (process.env[SKIP_LOCAL_ENV_FILES_ENV] === "1") {
    return;
  }

  for (const envFile of [".env.local", ".env"]) {
    const envPath = path.join(appDir, envFile);
    if (existsSync(envPath)) {
      process.loadEnvFile(envPath);
    }
  }
}

function parsePositiveInteger(value: string | undefined, label: string): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function parseMemberId(value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error("--member-id requires a value.");
  }
  return normalized;
}

function readOptionalFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readOptionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function bytesToMiB(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 100) / 100;
}

function isAfter(value: Date | null, cutoff: Date): boolean {
  return value instanceof Date && value.getTime() >= cutoff.getTime();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const options = parseHostedLegacyWearableCompactionArgs(process.argv.slice(2));
  if (options.help) {
    console.info(hostedLegacyWearableCompactionUsage());
    return;
  }

  loadHostedWebEnvFiles();
  const prisma = getPrisma();
  try {
    const report = await runHostedLegacyWearableCompactionTrigger({
      options,
      store: createHostedLegacyWearableCompactionStore(prisma),
    });
    console.info(JSON.stringify(report, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
