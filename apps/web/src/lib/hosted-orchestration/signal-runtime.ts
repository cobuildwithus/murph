import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

import {
  buildHostedExecutionRuntimeControlWake,
  HOSTED_USER_RUNTIME_SIGNAL_NAME,
  HOSTED_USER_RUNTIME_TASK_QUEUE,
  HOSTED_USER_RUNTIME_WORKFLOW_TYPE,
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
  hostedOnboardingError,
} from "../hosted-onboarding/errors";
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
import {
  resolveHostedRuntimeAiUsageGate,
} from "./runtime-usage-decision";

export interface HostedRuntimeSignalResult {
  signalAccepted: true;
  workflowId: string;
}

export interface SignalHostedUserRuntimeWorkflowInput {
  client?: HostedRuntimeTemporalSignalClient | null;
  environment?: NodeJS.ProcessEnv;
  ensureWorkspace?: boolean;
  prisma?: PrismaClient;
  signal: HostedRuntimeSignal;
  taskQueue?: string | null;
  userId: string;
}

export interface SignalHostedMailboxAppendInput {
  client?: HostedRuntimeTemporalSignalClient | null;
  environment?: NodeJS.ProcessEnv;
  expectedUserId?: string | null;
  mailboxItemId: string;
  prisma?: PrismaClient;
}

export interface SignalHostedBrowserVaultRefreshInput {
  client?: HostedRuntimeTemporalSignalClient | null;
  environment?: NodeJS.ProcessEnv;
  prisma?: PrismaClient;
  userId: string;
}

export interface SignalHostedManualRunInput {
  client?: HostedRuntimeTemporalSignalClient | null;
  environment?: NodeJS.ProcessEnv;
  prisma?: PrismaClient;
  userId: string;
}

export interface SignalHostedRuntimeRecheckInput {
  client?: HostedRuntimeTemporalSignalClient | null;
  environment?: NodeJS.ProcessEnv;
  userId: string;
}

export interface SignalHostedDeviceSyncMailboxInput {
  client?: HostedRuntimeTemporalSignalClient | null;
  environment?: NodeJS.ProcessEnv;
  mailboxItemId: string;
  prisma?: PrismaClient;
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
    prisma: input.prisma,
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
    environment: input.environment,
    ensureWorkspace: true,
    prisma: input.prisma,
    signal: parseHostedRuntimeSignal({
      kind: "mailbox_appended",
      lane: mailboxItem.lane,
      laneSeq: mailboxItem.laneSeq,
      mailboxItemId: mailboxItem.id,
    }),
    userId: mailboxItem.userId,
  });
}

export async function signalHostedBrowserVaultRefreshRuntime(
  input: SignalHostedBrowserVaultRefreshInput,
): Promise<HostedRuntimeSignalResult> {
  const prisma = input.prisma ?? getPrisma();
  const workspace = await ensureHostedRuntimeWorkspaceForActiveUser(input.userId, prisma);
  const control = buildHostedBrowserVaultRefreshRuntimeControlEvent({
    userId: input.userId,
    workspaceVersion: workspace.version,
  });

  return signalHostedRuntimeControlMailboxRequest({
    client: input.client,
    environment: input.environment,
    eventId: control.eventId,
    kind: "runtime.browser-vault-refresh-requested",
    occurredAt: control.occurredAt,
    prisma,
    userId: input.userId,
  });
}

export async function signalHostedManualRunRuntime(
  input: SignalHostedManualRunInput,
): Promise<HostedRuntimeSignalResult> {
  const prisma = input.prisma ?? getPrisma();
  await assertHostedManualRunAiUsageAllowed({
    prisma,
    userId: input.userId,
  });

  return signalHostedRuntimeControlMailboxRequest({
    client: input.client,
    environment: input.environment,
    kind: "runtime.manual-requested",
    prisma,
    userId: input.userId,
  });
}

export async function signalHostedRuntimeRecheckRuntime(
  input: SignalHostedRuntimeRecheckInput,
): Promise<HostedRuntimeSignalResult> {
  return signalHostedUserRuntimeWorkflow({
    client: input.client,
    environment: input.environment,
    ensureWorkspace: false,
    signal: parseHostedRuntimeSignal({
      kind: "runtime_recheck_requested",
    }),
    userId: input.userId,
  });
}

export async function signalHostedDeviceSyncMailboxRuntime(
  input: SignalHostedDeviceSyncMailboxInput,
): Promise<HostedRuntimeSignalResult> {
  const mailboxItem = await readHostedMailboxItemCheckpointById({
    mailboxItemId: input.mailboxItemId,
    prisma: input.prisma,
  });

  if (!mailboxItem) {
    throw new Error("Hosted device-sync mailbox item is missing for runtime signal.");
  }

  return signalHostedUserRuntimeWorkflow({
    client: input.client,
    environment: input.environment,
    ensureWorkspace: true,
    prisma: input.prisma,
    signal: parseHostedRuntimeSignal({
      kind: "mailbox_appended",
      lane: mailboxItem.lane,
      laneSeq: mailboxItem.laneSeq,
      mailboxItemId: mailboxItem.id,
    }),
    userId: mailboxItem.userId,
  });
}

async function assertHostedManualRunAiUsageAllowed(input: {
  prisma: PrismaClient;
  userId: string;
}): Promise<void> {
  const gate = await resolveHostedRuntimeAiUsageGate({
    prisma: input.prisma,
    userId: input.userId,
  });

  if (gate.status === "allowed") {
    return;
  }

  if (gate.status === "unavailable") {
    throw hostedOnboardingError({
      code: "HOSTED_RUNTIME_MANUAL_WAKE_AI_USAGE_GATE_UNAVAILABLE",
      details: {
        retryAt: gate.retryAt,
      },
      httpStatus: 503,
      message: "Hosted runtime manual wake AI usage gate is unavailable.",
      retryable: true,
    });
  }

  throw hostedOnboardingError({
    code: "HOSTED_RUNTIME_MANUAL_WAKE_AI_USAGE_DENIED",
    httpStatus: 403,
    message: "Hosted runtime manual wake AI usage is denied.",
  });
}

async function signalHostedRuntimeControlMailboxRequest(input: {
  client?: HostedRuntimeTemporalSignalClient | null;
  environment?: NodeJS.ProcessEnv;
  eventId?: string | null;
  kind: HostedExecutionRuntimeControlWakeKind;
  occurredAt?: string | null;
  prisma?: PrismaClient;
  userId: string;
}): Promise<HostedRuntimeSignalResult> {
  const prisma = input.prisma ?? getPrisma();
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
    environment: input.environment,
    ensureWorkspace: false,
    prisma,
    signal: parseHostedRuntimeSignal({
      kind: "mailbox_appended",
      lane: mailboxItem.lane,
      laneSeq: mailboxItem.laneSeq,
      mailboxItemId: mailboxItem.id,
    }),
    userId: input.userId,
  });
}

const HOSTED_RUNTIME_CONTROL_DETERMINISTIC_OCCURRED_AT = "1970-01-01T00:00:00.000Z";

const BROWSER_VAULT_REFRESH_CONTROL_DEDUPE_WINDOW_MS = 60_000;

function buildHostedBrowserVaultRefreshRuntimeControlEvent(input: {
  userId: string;
  workspaceVersion: string;
}): {
  eventId: string;
  occurredAt: string;
} {
  const bucketMs = Math.floor(Date.now() / BROWSER_VAULT_REFRESH_CONTROL_DEDUPE_WINDOW_MS) *
    BROWSER_VAULT_REFRESH_CONTROL_DEDUPE_WINDOW_MS;
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({
      bucketMs,
      userId: input.userId,
      version: 1,
      workspaceVersion: input.workspaceVersion,
    }))
    .digest("hex")
    .slice(0, 32);

  return {
    eventId: `runtime-control:browser-vault-refresh:${fingerprint}`,
    occurredAt: new Date(bucketMs).toISOString(),
  };
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
  const environment = input.environment ?? process.env;
  const client =
    input.client === undefined
      ? await readHostedRuntimeTemporalSignalClientIfConfigured()
      : input.client;
  if (!client) {
    throw new Error("Hosted runtime Temporal client is not configured.");
  }

  if (input.ensureWorkspace === true) {
    await ensureHostedRuntimeWorkspaceForActiveUser(input.userId, input.prisma ?? getPrisma());
  }

  const workflowId = hostedUserRuntimeWorkflowId(input.userId);
  const taskQueue =
    input.taskQueue?.trim()
    || readHostedRuntimeTemporalEnvironment(environment).taskQueue
    || HOSTED_USER_RUNTIME_TASK_QUEUE;
  const signal = parseHostedRuntimeSignal(input.signal);

  await client.workflow.signalWithStart(HOSTED_USER_RUNTIME_WORKFLOW_TYPE, {
    args: [{
      options: readHostedRuntimeTemporalWorkflowOptions(environment),
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
