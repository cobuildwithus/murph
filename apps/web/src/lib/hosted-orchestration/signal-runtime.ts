import "server-only";

import {
  HOSTED_USER_RUNTIME_SIGNAL_NAME,
  HOSTED_USER_RUNTIME_TASK_QUEUE,
  HOSTED_USER_RUNTIME_WORKFLOW_TYPE,
  type HostedRuntimeSignal,
} from "@murphai/hosted-execution";
import {
  parseHostedRuntimeSignal,
} from "@murphai/hosted-execution/parsers";

import {
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

export type HostedDeviceSyncRecoverySignalIntent =
  | "device-sync-dirty-recovery"
  | "device-sync-reconcile-recovery";

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
  return signalHostedUserRuntimeWorkflow({
    client: input.client,
    ensureWorkspace: true,
    signal: parseHostedRuntimeSignal({
      kind: "browser_vault_refresh_requested",
    }),
    userId: input.userId,
  });
}

export async function signalHostedManualRunRuntime(
  input: SignalHostedManualRunInput,
): Promise<HostedRuntimeSignalResult> {
  return signalHostedUserRuntimeWorkflow({
    client: input.client,
    ensureWorkspace: true,
    signal: parseHostedRuntimeSignal({
      kind: "manual_run_requested",
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

async function ensureHostedRuntimeWorkspaceForActiveUser(userId: string): Promise<void> {
  const prisma = getPrisma();
  const member = await readHostedMemberCoreState({
    memberId: userId,
    prisma,
  });

  if (!member || !hasHostedMemberActiveAccess(member)) {
    throw new Error("Hosted runtime user is not active.");
  }

  await ensureHostedWorkspace({
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
    case "device-sync-dirty-recovery":
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
