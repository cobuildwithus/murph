import "server-only";

import { createHash, randomUUID } from "node:crypto";

import {
  buildHostedExecutionRuntimeControlWake,
  HOSTED_USER_RUNTIME_SIGNAL_NAME,
  HOSTED_USER_RUNTIME_TASK_QUEUE,
  HOSTED_USER_RUNTIME_WORKFLOW_TYPE,
  HOSTED_RUNTIME_PREWARM_SOURCE,
  type HostedRuntimePrewarmSource,
  type HostedRuntimeSignal,
  type HostedExecutionRuntimeControlWakeKind,
} from "@murphai/hosted-execution";
import {
  parseHostedRuntimeSignal,
} from "@murphai/hosted-execution/parsers";

import {
  appendHostedMailboxEnvelopeTx,
  readHostedMailboxItemCheckpointById,
  type HostedMailboxItemCheckpointRecord,
} from "../hosted-mailbox/store";
import {
  hasHostedMemberActiveAccess,
} from "../hosted-onboarding/entitlement";
import {
  readHostedMemberCoreState,
} from "../hosted-onboarding/hosted-member-store";
import {
  ensureHostedWorkspace,
  type HostedWorkspaceRecord,
} from "../hosted-workspace/store";
import {
  getPrisma,
} from "../prisma";
import {
  readHostedRuntimeTemporalEnvironment,
  readHostedRuntimeTemporalWorkflowOptions,
  readHostedRuntimeTemporalSignalClientIfConfigured,
  type HostedRuntimeTemporalSignalClient,
} from "./temporal-client";

export interface HostedRuntimeSignalResult {
  signalAccepted: true;
  workflowId: string;
}

export interface SignalHostedUserRuntimeWorkflowInput {
  client?: HostedRuntimeTemporalSignalClient | null;
  ensureWorkspace?: boolean;
  signal: HostedRuntimeSignal;
  taskQueue?: string | null;
  userId: string;
}

export interface SignalHostedMailboxAppendInput {
  client?: HostedRuntimeTemporalSignalClient | null;
  expectedUserId?: string | null;
  mailboxItemId: string;
  source: string;
}

export interface SignalHostedDeviceSyncRecoveryInput {
  client?: HostedRuntimeTemporalSignalClient | null;
  eventId?: string | null;
  occurredAt?: string | null;
  userId: string;
}

export interface SignalHostedBrowserVaultRefreshInput {
  client?: HostedRuntimeTemporalSignalClient | null;
  userId: string;
}

export interface SignalHostedManualRunInput {
  client?: HostedRuntimeTemporalSignalClient | null;
  userId: string;
}

export interface SignalHostedRuntimeRecheckInput {
  client?: HostedRuntimeTemporalSignalClient | null;
  userId: string;
}

export interface SignalHostedRuntimePrewarmInput {
  client?: HostedRuntimeTemporalSignalClient | null;
  eventId: string;
  occurredAt: string;
  source?: HostedRuntimePrewarmSource;
  userId: string;
}

export type HostedDeviceSyncRecoverySignalIntent = "device-sync-reconcile-recovery";

export interface SignalHostedDeviceSyncMailboxInput {
  client?: HostedRuntimeTemporalSignalClient | null;
  mailboxItemId: string;
  recoveryIntent?: HostedDeviceSyncRecoverySignalIntent | null;
}

export function hostedUserRuntimeWorkflowId(userId: string): string {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    throw new Error("Hosted runtime workflow userId is required.");
  }

  return `hosted-user-runtime:${normalizedUserId}`;
}

export async function signalHostedMailboxAppendRuntime(
  input: SignalHostedMailboxAppendInput,
): Promise<HostedRuntimeSignalResult> {
  const mailboxItem = await readHostedMailboxItemCheckpointById({
    mailboxItemId: input.mailboxItemId,
  });

  if (!mailboxItem) {
    throw new Error("Hosted mailbox item is missing for runtime signal.");
  }
  assertExpectedHostedMailboxOwner({
    expectedUserId: input.expectedUserId ?? null,
    mailboxItem,
  });

  return signalHostedUserRuntimeWorkflow({
    client: input.client,
    ensureWorkspace: true,
    signal: parseHostedRuntimeSignal({
      kind: "mailbox_appended",
      lane: mailboxItem.lane,
      laneSeq: mailboxItem.laneSeq,
      mailboxItemId: mailboxItem.id,
      source: sanitizeHostedRuntimeSignalSource(input.source),
    }),
    userId: mailboxItem.userId,
  });
}

export async function signalHostedDeviceSyncRecoveryRuntime(
  input: SignalHostedDeviceSyncRecoveryInput,
): Promise<HostedRuntimeSignalResult> {
  return signalHostedRuntimeControlMailboxRequest({
    client: input.client,
    eventId: input.eventId ?? null,
    kind: "runtime.device-sync-recovery-requested",
    occurredAt: input.occurredAt ?? null,
    runtimeSignalKind: "device_sync_recovery_requested",
    source: "device-sync-recovery",
    userId: input.userId,
  });
}

export async function signalHostedDeviceSyncBackgroundMaintenanceRuntime(
  input: SignalHostedDeviceSyncRecoveryInput,
): Promise<HostedRuntimeSignalResult> {
  return signalHostedUserRuntimeWorkflow({
    client: input.client,
    ensureWorkspace: true,
    signal: parseHostedRuntimeSignal({
      kind: "device_sync_recovery_requested",
    }),
    userId: input.userId,
  });
}

export async function signalHostedBrowserVaultRefreshRuntime(
  input: SignalHostedBrowserVaultRefreshInput,
): Promise<HostedRuntimeSignalResult> {
  await ensureHostedRuntimeWorkspaceForActiveUser(input.userId);
  try {
    return await signalHostedUserRuntimeWorkflow({
      client: input.client,
      ensureWorkspace: false,
      signal: parseHostedRuntimeSignal({
        kind: "browser_vault_refresh_requested",
      }),
      userId: input.userId,
    });
  } catch {
    const fallbackControl =
      buildHostedBrowserVaultRefreshRuntimeControlFallback(input.userId);
    return signalHostedRuntimeControlMailboxRequest({
      client: input.client,
      eventId: fallbackControl.eventId,
      kind: "runtime.browser-vault-refresh-requested",
      occurredAt: fallbackControl.occurredAt,
      source: "browser-vault-refresh",
      userId: input.userId,
    });
  }
}

export async function signalHostedManualRunRuntime(
  input: SignalHostedManualRunInput,
): Promise<HostedRuntimeSignalResult> {
  return signalHostedRuntimeControlMailboxRequest({
    client: input.client,
    kind: "runtime.manual-requested",
    source: "manual",
    userId: input.userId,
  });
}

export async function signalHostedRuntimeRecheckRuntime(
  input: SignalHostedRuntimeRecheckInput,
): Promise<HostedRuntimeSignalResult> {
  return signalHostedUserRuntimeWorkflow({
    client: input.client,
    ensureWorkspace: false,
    signal: parseHostedRuntimeSignal({
      kind: "runtime_recheck_requested",
    }),
    userId: input.userId,
  });
}

export async function signalHostedRuntimePrewarm(
  input: SignalHostedRuntimePrewarmInput,
): Promise<HostedRuntimeSignalResult> {
  return signalHostedUserRuntimeWorkflow({
    client: input.client,
    ensureWorkspace: false,
    signal: parseHostedRuntimeSignal({
      eventId: buildHostedRuntimePrewarmEventId({
        eventId: input.eventId,
        source: input.source ?? HOSTED_RUNTIME_PREWARM_SOURCE,
      }),
      kind: "runtime_prewarm_requested",
      occurredAt: input.occurredAt,
      source: input.source ?? HOSTED_RUNTIME_PREWARM_SOURCE,
    }),
    userId: input.userId,
  });
}

export async function signalHostedDeviceSyncMailboxRuntime(
  input: SignalHostedDeviceSyncMailboxInput,
): Promise<HostedRuntimeSignalResult> {
  const mailboxItem = await readHostedMailboxItemCheckpointById({
    mailboxItemId: input.mailboxItemId,
  });

  if (!mailboxItem) {
    throw new Error("Hosted device-sync mailbox item is missing for runtime signal.");
  }

  const shouldSignalRecovery = shouldSignalHostedDeviceSyncRecovery(
    input.recoveryIntent ?? null,
  );
  if (shouldSignalRecovery) {
    return signalHostedDeviceSyncRecoveryRuntime({
      client: input.client,
      eventId: buildHostedDeviceSyncRecoveryRuntimeControlEventId({
        mailboxItemId: mailboxItem.id,
        recoveryIntent: input.recoveryIntent ?? null,
      }),
      occurredAt: mailboxItem.occurredAt,
      userId: mailboxItem.userId,
    });
  }

  return signalHostedUserRuntimeWorkflow({
    client: input.client,
    ensureWorkspace: true,
    signal: parseHostedRuntimeSignal({
      kind: "mailbox_appended",
      lane: mailboxItem.lane,
      laneSeq: mailboxItem.laneSeq,
      mailboxItemId: mailboxItem.id,
      source: "device-sync",
    }),
    userId: mailboxItem.userId,
  });
}

async function signalHostedRuntimeControlMailboxRequest(input: {
  client?: HostedRuntimeTemporalSignalClient | null;
  eventId?: string | null;
  kind: HostedExecutionRuntimeControlWakeKind;
  occurredAt?: string | null;
  runtimeSignalKind?: "device_sync_recovery_requested" | null;
  source: string;
  userId: string;
}): Promise<HostedRuntimeSignalResult> {
  const prisma = getPrisma();
  await ensureHostedRuntimeWorkspaceForActiveUser(input.userId, prisma);
  const deterministicEventId = normalizeHostedRuntimeControlEventId(input.eventId);
  const occurredAt = normalizeHostedRuntimeControlOccurredAt(input.occurredAt)
    ?? (deterministicEventId ? HOSTED_RUNTIME_CONTROL_DETERMINISTIC_OCCURRED_AT : new Date().toISOString());
  const mailboxItem = (await prisma.$transaction((tx) =>
    appendHostedMailboxEnvelopeTx({
      envelope: buildHostedExecutionRuntimeControlWake({
        eventId: deterministicEventId
          ?? `runtime-control:${input.kind}:${randomUUID()}`,
        kind: input.kind,
        occurredAt,
        userId: input.userId,
      }),
      tx,
    })
  )).item;

  return signalHostedUserRuntimeWorkflow({
    client: input.client,
    ensureWorkspace: false,
    signal: input.runtimeSignalKind === "device_sync_recovery_requested"
      ? parseHostedRuntimeSignal({
        kind: "device_sync_recovery_requested",
      })
      : parseHostedRuntimeSignal({
        kind: "mailbox_appended",
        lane: mailboxItem.lane,
        laneSeq: mailboxItem.laneSeq,
        mailboxItemId: mailboxItem.id,
        source: sanitizeHostedRuntimeSignalSource(input.source),
      }),
    userId: input.userId,
  });
}

const HOSTED_RUNTIME_CONTROL_DETERMINISTIC_OCCURRED_AT = "1970-01-01T00:00:00.000Z";

function buildHostedDeviceSyncRecoveryRuntimeControlEventId(input: {
  mailboxItemId: string;
  recoveryIntent: HostedDeviceSyncRecoverySignalIntent | null;
}): string {
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({
      mailboxItemId: input.mailboxItemId,
      recoveryIntent: input.recoveryIntent,
      version: 1,
    }))
    .digest("hex")
    .slice(0, 32);

  return `runtime-control:device-sync-recovery:${fingerprint}`;
}

const BROWSER_VAULT_REFRESH_CONTROL_DEDUPE_WINDOW_MS = 60_000;

function buildHostedBrowserVaultRefreshRuntimeControlFallback(userId: string): {
  eventId: string;
  occurredAt: string;
} {
  const bucketMs = Math.floor(Date.now() / BROWSER_VAULT_REFRESH_CONTROL_DEDUPE_WINDOW_MS) *
    BROWSER_VAULT_REFRESH_CONTROL_DEDUPE_WINDOW_MS;
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({
      bucketMs,
      userId,
      version: 1,
    }))
    .digest("hex")
    .slice(0, 32);

  return {
    eventId: `runtime-control:browser-vault-refresh:${fingerprint}`,
    occurredAt: new Date(bucketMs).toISOString(),
  };
}

function buildHostedRuntimePrewarmEventId(input: {
  eventId: string;
  source: HostedRuntimePrewarmSource;
}): string {
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({
      eventId: input.eventId,
      source: input.source,
      version: 1,
    }))
    .digest("hex")
    .slice(0, 32);

  return `runtime-prewarm:${fingerprint}`;
}

function normalizeHostedRuntimeControlEventId(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeHostedRuntimeControlOccurredAt(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeHostedRuntimeControlEventId(value);
  if (!normalized) {
    return null;
  }

  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function signalHostedUserRuntimeWorkflow(
  input: SignalHostedUserRuntimeWorkflowInput,
): Promise<HostedRuntimeSignalResult> {
  const client =
    input.client === undefined
      ? await readHostedRuntimeTemporalSignalClientIfConfigured()
      : input.client;
  if (!client) {
    throw new Error("Hosted runtime Temporal client is not configured.");
  }

  if (input.ensureWorkspace === true) {
    await ensureHostedRuntimeWorkspaceForActiveUser(input.userId);
  }

  const workflowId = hostedUserRuntimeWorkflowId(input.userId);
  const taskQueue =
    input.taskQueue?.trim()
    || readHostedRuntimeTemporalEnvironment().taskQueue
    || HOSTED_USER_RUNTIME_TASK_QUEUE;
  const signal = parseHostedRuntimeSignal(input.signal);

  await client.workflow.signalWithStart(HOSTED_USER_RUNTIME_WORKFLOW_TYPE, {
    args: [{
      options: readHostedRuntimeTemporalWorkflowOptions(),
      userId: input.userId,
    }],
    signal: HOSTED_USER_RUNTIME_SIGNAL_NAME,
    signalArgs: [signal],
    taskQueue,
    workflowId,
  });

  return {
    signalAccepted: true,
    workflowId,
  };
}

async function ensureHostedRuntimeWorkspaceForActiveUser(
  userId: string,
  prisma = getPrisma(),
): Promise<HostedWorkspaceRecord> {
  const member = await readHostedMemberCoreState({
    memberId: userId,
    prisma,
  });

  if (!member || !hasHostedMemberActiveAccess(member)) {
    throw new Error("Hosted runtime user is not active.");
  }

  return await ensureHostedWorkspace({
    prisma,
    userId,
  });
}

export function sanitizeHostedRuntimeSignalSource(source: string): string {
  const lowered = source.trim().toLowerCase();
  const safe = lowered
    .replace(/[^a-z0-9._:-]+/gu, "-")
    .replace(/^[^a-z0-9]+/u, "")
    .replace(/[^a-z0-9]+$/u, "")
    .slice(0, 64)
    .replace(/[^a-z0-9]+$/u, "");

  return safe || "unknown";
}

function assertExpectedHostedMailboxOwner(input: {
  expectedUserId: string | null;
  mailboxItem: HostedMailboxItemCheckpointRecord;
}): void {
  if (!input.expectedUserId) {
    return;
  }

  if (input.expectedUserId !== input.mailboxItem.userId) {
    throw new Error("Hosted mailbox item owner does not match runtime signal user.");
  }
}

function shouldSignalHostedDeviceSyncRecovery(
  intent: HostedDeviceSyncRecoverySignalIntent | null,
): boolean {
  switch (intent) {
    case "device-sync-reconcile-recovery":
      return true;
    case null:
      return false;
    default: {
      const exhaustive: never = intent;
      throw new Error(`Unsupported hosted device-sync recovery intent: ${String(exhaustive)}`);
    }
  }
}
