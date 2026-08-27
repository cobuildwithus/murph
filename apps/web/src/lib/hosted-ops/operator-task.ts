import "server-only";

import { createHash, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import {
  buildHostedExecutionAssistantAskRequestedWake,
  buildHostedExecutionAssistantNotificationRequestedWake,
  HOSTED_EXECUTION_ASSISTANT_ASK_QUESTION_MAX_CODE_POINTS,
  HOSTED_EXECUTION_ASSISTANT_ASK_REQUEST_TTL_MS,
  type HostedOperatorTaskControlRequest,
  type HostedOperatorTaskControlResponse,
  type HostedExecutionAssistantAskResult,
} from "@murphai/hosted-execution";

import {
  openHostedUserSecureBoxString,
  sealHostedUserSecureBoxString,
} from "../hosted-crypto/secure-box";
import {
  appendHostedMailboxEnvelopeWithPreparedCryptoTx,
  readHostedMailboxWakeByItemId,
  runWithPreparedHostedMailboxItemAppendCrypto,
} from "../hosted-mailbox/store";
import {
  requireHostedRuntimeActiveAccess,
  requireHostedRuntimeActiveAccessForUpdateTx,
} from "../hosted-mailbox/runtime-access";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { handoffHostedMailboxWake } from "../hosted-orchestration/mailbox-wake";
import {
  bindHostedAssistantNotificationDestination,
  resolveHostedAssistantNotificationDestination,
  type HostedAssistantNotificationBoundDestination,
  type HostedAssistantNotificationDestination,
} from "../hosted-routing/assistant-notification-destination";
import { getPrisma } from "../prisma";

const OPERATOR_TASK_ID_NAMESPACE = "murph.hosted-operator-task.v1";
const OPERATOR_TASK_RESULT_PURPOSE = "hosted-operator-task-result";
const OPERATOR_TASK_TABLE = "hosted_operator_task";
const OPERATOR_TASK_IDEMPOTENCY_MAX = 256;
const OPERATOR_TASK_LIST_LIMIT = 20;

export type HostedOperatorTaskKind = "diagnostic" | "member_message";
export type HostedOperatorTaskSource = "cron" | "ops" | "workflow";

export interface HostedOperatorTaskAdmissionInput {
  idempotencyKey: string;
  kind: HostedOperatorTaskKind;
  memberId: string;
  prompt: string;
  requestedByMemberId?: string | null;
  signal?: AbortSignal;
  source: HostedOperatorTaskSource;
}

export interface HostedOperatorTaskView {
  completedAt: string | null;
  createdAt: string;
  expiresAt: string;
  id: string;
  kind: HostedOperatorTaskKind;
  memberId: string;
  result: HostedExecutionAssistantAskResult | null;
  source: HostedOperatorTaskSource;
  status: "accepted" | "completed" | "failed" | "queued" | "running";
}

export async function admitHostedOperatorTask(
  input: HostedOperatorTaskAdmissionInput,
  options: { prisma?: PrismaClient } = {},
): Promise<HostedOperatorTaskView> {
  const prisma = options.prisma ?? getPrisma();
  const memberId = requireBoundedText(input.memberId, 256, "memberId");
  const requestedByMemberId = input.requestedByMemberId == null
    ? null
    : requireBoundedText(input.requestedByMemberId, 256, "requestedByMemberId");
  const idempotencyKey = requireBoundedText(
    input.idempotencyKey,
    OPERATOR_TASK_IDEMPOTENCY_MAX,
    "idempotencyKey",
  );
  const prompt = requireBoundedText(
    input.prompt,
    HOSTED_EXECUTION_ASSISTANT_ASK_QUESTION_MAX_CODE_POINTS,
    "prompt",
  );
  const requestShapeHash = createOperatorTaskRequestShapeHash({
    kind: input.kind,
    memberId,
    prompt,
    requestedByMemberId,
    source: input.source,
  });
  await requireHostedRuntimeActiveAccess(memberId, { prisma });

  const taskId = createOperatorTaskId({ idempotencyKey, source: input.source });
  const requestMailboxItemId = input.kind === "diagnostic"
    ? createOperatorAssistantAskRequestId(taskId)
    : `assistant.notification.requested:operator-task:${taskId}`;
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + HOSTED_EXECUTION_ASSISTANT_ASK_REQUEST_TTL_MS,
  );
  const envelope = input.kind === "diagnostic"
    ? buildHostedExecutionAssistantAskRequestedWake({
        ask: {
          expiresAt: expiresAt.toISOString(),
          question: prompt,
          target: { kind: "operator_task", taskId },
        },
        eventId: requestMailboxItemId,
        memberId,
        occurredAt: now.toISOString(),
      })
    : await buildOperatorMessageWake({
        expiresAt,
        memberId,
        now,
        prisma,
        prompt,
        requestMailboxItemId,
        taskId,
      });

  const task = await runWithPreparedHostedMailboxItemAppendCrypto({
    append: (prepared) => prisma.$transaction(async (tx) => {
      await requireHostedRuntimeActiveAccessForUpdateTx(memberId, { prisma: tx });
      const existing = await tx.hostedOperatorTask.findUnique({
        where: { idempotencyKey },
      });
      if (existing) {
        if (
          existing.id !== taskId
          || existing.memberId !== memberId
          || existing.kind !== input.kind
          || existing.source !== input.source
          || existing.requestedByMemberId !== requestedByMemberId
          || existing.requestShapeHash !== requestShapeHash
        ) {
          throw operatorTaskError(
            "HOSTED_OPERATOR_TASK_IDEMPOTENCY_CONFLICT",
            "Operator task idempotency key is already bound to another request.",
            409,
          );
        }
        return existing;
      }
      const append = await appendHostedMailboxEnvelopeWithPreparedCryptoTx({
        envelope,
        expiresAt,
        itemId: requestMailboxItemId,
        prepared,
        tx,
      });
      if (append.dedupeConflict || append.item.id !== requestMailboxItemId) {
        throw operatorTaskError(
          "HOSTED_OPERATOR_TASK_MAILBOX_CONFLICT",
          "Operator task mailbox identity conflicts with another request.",
          409,
        );
      }
      return tx.hostedOperatorTask.create({
        data: {
          expiresAt,
          id: taskId,
          idempotencyKey,
          kind: input.kind,
          memberId,
          requestMailboxItemId,
          requestShapeHash,
          requestedByMemberId,
          source: input.source,
          status: input.kind === "member_message" ? "accepted" : "queued",
        },
      });
    }),
    prisma,
    userId: memberId,
  });

  await handoffHostedMailboxWake({
    directWakeSource: "assistant-ask-request",
    expectedUserId: memberId,
    mailboxItemId: requestMailboxItemId,
    signal: input.signal,
  });
  return serializeOperatorTask(task, null);
}

export async function listHostedOperatorTasks(input: {
  prisma?: PrismaClient;
  requestedByMemberId: string;
}): Promise<HostedOperatorTaskView[]> {
  const prisma = input.prisma ?? getPrisma();
  const rows = await prisma.hostedOperatorTask.findMany({
    orderBy: { createdAt: "desc" },
    take: OPERATOR_TASK_LIST_LIMIT,
    where: { requestedByMemberId: input.requestedByMemberId },
  });
  return Promise.all(rows.map(async (row) => serializeOperatorTask(
    row,
    row.resultEncrypted
      ? await decryptOperatorTaskResult({
          memberId: row.memberId,
          taskId: row.id,
          value: row.resultEncrypted,
        })
      : null,
  )));
}

export async function resolveHostedOperatorTaskMemberId(input: {
  prisma?: PrismaClient;
  query: string;
}): Promise<string> {
  const prisma = input.prisma ?? getPrisma();
  const query = requireBoundedText(input.query, 256, "member");
  if (!/^\d{4}$/u.test(query)) {
    return query;
  }
  const matches = await prisma.hostedMemberIdentity.findMany({
    select: { memberId: true },
    take: 2,
    where: { maskedPhoneNumberHint: { endsWith: query } },
  });
  if (matches.length !== 1) {
    throw operatorTaskError(
      "HOSTED_OPERATOR_TASK_MEMBER_LOOKUP_AMBIGUOUS",
      matches.length === 0
        ? "No member matched those phone digits."
        : "More than one member matched those phone digits. Use the full member ID.",
      409,
    );
  }
  return matches[0]?.memberId ?? query;
}

export async function tryHandleHostedOperatorDiagnosticControl(input: {
  boundRuntimeMemberId: string;
  now?: Date;
  prisma?: PrismaClient;
  request: {
    action: "complete" | "prepare";
    requestId: string;
    result?: HostedExecutionAssistantAskResult;
  };
}): Promise<{
  mailboxWake: null;
  response: Record<string, unknown>;
} | null> {
  const prisma = input.prisma ?? getPrisma();
  const task = await prisma.hostedOperatorTask.findUnique({
    where: { requestMailboxItemId: input.request.requestId },
  });
  if (!task || task.kind !== "diagnostic") {
    return null;
  }
  const now = input.now ?? new Date();
  if (task.memberId !== input.boundRuntimeMemberId || task.expiresAt <= now) {
    await prisma.hostedOperatorTask.updateMany({
      data: { completedAt: now, status: "failed" },
      where: { id: task.id, status: { in: ["queued", "running"] } },
    });
    return {
      mailboxWake: null,
      response: {
        action: input.request.action,
        status: "terminal",
        terminalReason: "expired",
      },
    };
  }
  if (task.status === "completed") {
    return {
      mailboxWake: null,
      response: { action: input.request.action, status: "already_completed" },
    };
  }
  if (input.request.action === "prepare") {
    const wake = await readHostedMailboxWakeByItemId({
      mailboxItemId: task.requestMailboxItemId,
      prisma,
    });
    if (!wake || wake.kind !== "assistant.ask.requested") {
      await prisma.hostedOperatorTask.updateMany({
        data: { completedAt: now, status: "failed" },
        where: { id: task.id, status: { in: ["queued", "running"] } },
      });
      return {
        mailboxWake: null,
        response: { action: "prepare", status: "terminal", terminalReason: "unavailable" },
      };
    }
    await prisma.hostedOperatorTask.updateMany({
      data: { status: "running" },
      where: { id: task.id, status: "queued" },
    });
    return {
      mailboxWake: null,
      response: {
        action: "prepare",
        disclosure: {
          permissionText:
            "An authorized Murph operator requested one private, read-only diagnostic. Inspect only this member's Murph context needed to answer the question. Do not send a member message, change state, invoke tools, or disclose anyone else's information. Return the concise diagnostic only to the authorized operator.",
        },
        question: wake.ask.question,
        status: "ready",
        targetLabel: null,
      },
    };
  }
  if (!input.request.result) {
    throw new TypeError("Operator diagnostic completion requires a result.");
  }
  const resultEncrypted = await encryptOperatorTaskResult({
    memberId: task.memberId,
    taskId: task.id,
    value: input.request.result,
  });
  await prisma.hostedOperatorTask.updateMany({
    data: { completedAt: now, resultEncrypted, status: "completed" },
    where: { id: task.id, status: { in: ["queued", "running"] } },
  });
  return {
    mailboxWake: null,
    response: { action: "complete", status: "completed" },
  };
}

export async function handleHostedOperatorMessageControl(input: {
  boundRuntimeMemberId: string;
  now?: Date;
  prisma?: PrismaClient;
  request: HostedOperatorTaskControlRequest;
}): Promise<HostedOperatorTaskControlResponse> {
  const prisma = input.prisma ?? getPrisma();
  const task = await prisma.hostedOperatorTask.findUnique({
    where: { id: input.request.taskId },
  });
  if (
    !task
    || task.kind !== "member_message"
    || task.memberId !== input.boundRuntimeMemberId
    || task.requestMailboxItemId !== input.request.requestId
    || task.expiresAt.toISOString() !== input.request.expiresAt
  ) {
    throw operatorTaskError(
      "HOSTED_OPERATOR_TASK_CONTROL_INVALID",
      "Operator task runtime authority is invalid.",
      409,
    );
  }
  if (task.status === "completed") {
    return { status: "already_completed" };
  }
  const now = input.now ?? new Date();
  if (task.status === "failed") {
    return { status: "expired" };
  }
  if (input.request.action === "authorize") {
    if (task.expiresAt <= now) {
      await prisma.hostedOperatorTask.updateMany({
        data: { completedAt: now, status: "failed" },
        where: { id: task.id, status: { in: ["accepted", "running"] } },
      });
      return { status: "expired" };
    }
    const updated = await prisma.hostedOperatorTask.updateMany({
      data: { status: "running" },
      where: { id: task.id, status: "accepted" },
    });
    if (updated.count === 1 || task.status === "running") {
      return { status: "authorized" };
    }
    return { status: "expired" };
  }
  if (input.request.action === "fail") {
    const failed = await prisma.hostedOperatorTask.updateMany({
      data: { completedAt: now, status: "failed" },
      where: { id: task.id, status: { in: ["accepted", "running"] } },
    });
    if (failed.count === 1) {
      return { status: "failed" };
    }
    const current = await prisma.hostedOperatorTask.findUnique({
      select: { status: true },
      where: { id: task.id },
    });
    return {
      status: current?.status === "completed" ? "already_completed" : "expired",
    };
  }
  const completed = await prisma.hostedOperatorTask.updateMany({
    data: { completedAt: now, status: "completed" },
    where: { id: task.id, status: { in: ["accepted", "running"] } },
  });
  if (completed.count === 1) {
    return { status: "completed" };
  }
  const current = await prisma.hostedOperatorTask.findUnique({
    select: { status: true },
    where: { id: task.id },
  });
  return {
    status: current?.status === "completed" ? "already_completed" : "expired",
  };
}

async function buildOperatorMessageWake(input: {
  expiresAt: Date;
  memberId: string;
  now: Date;
  prisma: PrismaClient;
  prompt: string;
  requestMailboxItemId: string;
  taskId: string;
}) {
  const destination = await resolveHostedAssistantNotificationDestination({
    memberId: input.memberId,
    prisma: input.prisma,
  });
  const bound = bindHostedOperatorMessageDestination({
    destination,
    memberId: input.memberId,
  });
  return buildHostedExecutionAssistantNotificationRequestedWake({
    eventId: input.requestMailboxItemId,
    memberId: input.memberId,
    notification: {
      deliveryDedupeToken: input.requestMailboxItemId,
      deliveryDispatchMode: "queue-only",
      deliveryIdempotencyKey: input.requestMailboxItemId,
      externalThreadRouteAuthority: bound.externalThreadRouteAuthority,
      instructions: [
        "Author one natural in-chat continuation for this member's existing private conversation.",
        "Use the bounded private conversation context when useful. The platform owns delivery; do not mention internal tools, queues, operators, or claim the member requested this message. Do not perform any other action.",
        "The authorized team request is:",
        JSON.stringify({ request: input.prompt }),
      ].join("\n\n"),
      notificationPromptProfile: "operator-message",
      operatorTask: {
        expiresAt: input.expiresAt.toISOString(),
        taskId: input.taskId,
      },
      responsePolicy: { kind: "require_send" },
      route: bound.route,
    },
    occurredAt: input.now.toISOString(),
  });
}

export function bindHostedOperatorMessageDestination(input: {
  destination: HostedAssistantNotificationDestination | null;
  memberId: string;
}): HostedAssistantNotificationBoundDestination {
  const { destination } = input;
  if (
    !destination
    || destination.conversationShape !== "direct-member"
    || destination.route.delivery.kind !== "thread"
  ) {
    throw operatorTaskError(
      "HOSTED_OPERATOR_TASK_DIRECT_ROUTE_REQUIRED",
      "Member messaging requires an active private direct route.",
      409,
    );
  }
  const bound = bindHostedAssistantNotificationDestination({
    destination,
    memberId: input.memberId,
  });
  if (
    bound.route.threadIsDirect !== true
    || bound.externalThreadRouteAuthority === null
  ) {
    throw operatorTaskError(
      "HOSTED_OPERATOR_TASK_DIRECT_ROUTE_REQUIRED",
      "Member messaging requires an active private direct route.",
      409,
    );
  }
  return bound;
}

function createOperatorTaskId(input: {
  idempotencyKey: string;
  source: HostedOperatorTaskSource;
}): string {
  return `opt_${createHash("sha256")
    .update(OPERATOR_TASK_ID_NAMESPACE)
    .update("\0")
    .update(input.source)
    .update("\0")
    .update(input.idempotencyKey)
    .digest("hex")}`;
}

function createOperatorTaskRequestShapeHash(input: {
  kind: HostedOperatorTaskKind;
  memberId: string;
  prompt: string;
  requestedByMemberId: string | null;
  source: HostedOperatorTaskSource;
}): string {
  return createHash("sha256")
    .update("murph.hosted-operator-task-request.v1")
    .update("\0")
    .update(JSON.stringify(input))
    .digest("hex");
}

function createOperatorAssistantAskRequestId(taskId: string): string {
  return `aask_req_${createHash("sha256").update(taskId).digest("hex")}`;
}

function requireBoundedText(value: string, max: number, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || [...normalized].length > max) {
    throw operatorTaskError(
      "HOSTED_OPERATOR_TASK_INPUT_INVALID",
      `${label} is missing or too long.`,
      400,
    );
  }
  return normalized;
}

function operatorTaskError(code: string, message: string, httpStatus: number) {
  return hostedOnboardingError({ code, httpStatus, message, retryable: false });
}

async function encryptOperatorTaskResult(input: {
  memberId: string;
  taskId: string;
  value: HostedExecutionAssistantAskResult;
}): Promise<string> {
  const value = await sealHostedUserSecureBoxString({
    aad: {
      field: "result_encrypted",
      purpose: OPERATOR_TASK_RESULT_PURPOSE,
      rowId: input.taskId,
      table: OPERATOR_TASK_TABLE,
    },
    lane: "hosted-member-private-field",
    scope: "hosted-operator-task:result",
    userId: input.memberId,
    value: JSON.stringify(input.value),
  });
  if (!value) {
    throw new Error("Operator task result encryption returned no ciphertext.");
  }
  return value;
}

async function decryptOperatorTaskResult(input: {
  memberId: string;
  taskId: string;
  value: string;
}): Promise<HostedExecutionAssistantAskResult> {
  const value = await openHostedUserSecureBoxString({
    aad: {
      field: "result_encrypted",
      purpose: OPERATOR_TASK_RESULT_PURPOSE,
      rowId: input.taskId,
      table: OPERATOR_TASK_TABLE,
    },
    lane: "hosted-member-private-field",
    scope: "hosted-operator-task:result",
    userId: input.memberId,
    value: input.value,
  });
  if (!value) {
    throw new Error("Operator task result ciphertext returned no plaintext.");
  }
  return JSON.parse(value) as HostedExecutionAssistantAskResult;
}

function serializeOperatorTask(
  task: {
    completedAt: Date | null;
    createdAt: Date;
    expiresAt: Date;
    id: string;
    kind: string;
    memberId: string;
    source: string;
    status: string;
  },
  result: HostedExecutionAssistantAskResult | null,
): HostedOperatorTaskView {
  return {
    completedAt: task.completedAt?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(),
    expiresAt: task.expiresAt.toISOString(),
    id: task.id,
    kind: task.kind as HostedOperatorTaskKind,
    memberId: task.memberId,
    result,
    source: task.source as HostedOperatorTaskSource,
    status: task.status as HostedOperatorTaskView["status"],
  };
}

export function createHostedOperatorTaskIdempotencyKey(): string {
  return randomUUID();
}
