import {
  isHostedLinqConversationMessageWake,
  isHostedTelegramConversationMessageWake,
  type HostedExecutionWake,
} from "@murphai/hosted-execution";
import {
  parseTelegramThreadTarget,
} from "@murphai/messaging-ingress/telegram-webhook";
import {
  parseHostedExecutionWake,
  parseHostedRuntimeReconciliationFacts,
} from "@murphai/hosted-execution/parsers";
import type {
  HostedRuntimeReconciliationBlockedReason,
  HostedRuntimeReconciliationFacts,
  HostedRuntimeReconciliationFactsRequest,
  HostedRuntimeReconciliationFactsWorkspace,
} from "@murphai/hosted-execution/orchestration-control";
import type {
  HostedMailboxLaneConsumed,
  HostedMailboxLaneLag,
} from "@murphai/hosted-execution/runtime-control";

import {
  computeHostedMailboxLaneLag,
  readHostedMailboxRedactedStatusRecord,
} from "../hosted-mailbox/lag";
import {
  decodeHostedMailboxStoredPayload,
  readHostedMailboxConsumedSeqByLane,
  readHostedMailboxFirstPendingConversationItem,
  readHostedMailboxPendingSystemItemsNeedAiUsageGate,
  readHostedMailboxMaxSeqByLane,
  readHostedMailboxPayload,
} from "../hosted-mailbox/store";
import {
  claimHostedAiUsageLimitNotice,
  releaseHostedAiUsageLimitNotice,
} from "../hosted-execution/usage-allowance";
import {
  buildAiUsageQuotaReplyResponse,
} from "../hosted-onboarding/webhook-provider-linq-shared";
import {
  drainHostedLinqSideEffectsDirect,
} from "../hosted-onboarding/webhook-transport";
import {
  hasHostedMemberActiveAccess,
} from "../hosted-onboarding/entitlement";
import {
  readHostedMemberCoreState,
} from "../hosted-onboarding/hosted-member-store";
import {
  readHostedWorkspace,
  type HostedWorkspaceRecord,
} from "../hosted-workspace/store";
import {
  getPrisma,
} from "../prisma";
import {
  resolveHostedRuntimeAiUsageGate,
  type HostedRuntimeUsageGateCheck,
} from "./runtime-usage-decision";

type HostedRuntimeReconciliationUsageGateStatus =
  | HostedRuntimeUsageGateCheck["status"]
  | "not_required";

type HostedRuntimeReconciliationUsageGateMode = "mutating" | "read_only";
type HostedRuntimeReconciliationDecisionSource = "workflow" | "status";

const HOSTED_RUNTIME_RECONCILIATION_FACTS_LOG_SCHEMA =
  "murph.hosted-runtime.reconciliation-facts.v1";
const HOSTED_TELEGRAM_USAGE_LIMIT_NOTICE_TIMEOUT_MS = 15_000;
const DEFAULT_TELEGRAM_API_BASE_URL = "https://api.telegram.org";

export async function readHostedRuntimeReconciliationFacts(
  input: HostedRuntimeReconciliationFactsRequest & {
    decisionSource?: HostedRuntimeReconciliationDecisionSource;
    now?: Date | string;
    usageGateMode?: HostedRuntimeReconciliationUsageGateMode;
  },
): Promise<HostedRuntimeReconciliationFacts> {
  const prisma = getPrisma();
  const now = normalizeHostedRuntimeReconciliationDate(input.now);
  const [member, workspace] = await Promise.all([
    readHostedMemberCoreState({
      memberId: input.userId,
      prisma,
    }),
    readHostedWorkspace({ prisma, userId: input.userId }),
  ]);
  const projectedWorkspace = projectHostedRuntimeReconciliationWorkspace(workspace);

  if (!member || !hasHostedMemberActiveAccess(member)) {
    const facts = buildHostedRuntimeBlockedFacts({
      mailboxLag: [],
      reason: "user_not_active",
      retryAt: projectedWorkspace
        ? readHostedRuntimeFutureTimestamp(projectedWorkspace.inboxMediaRetentionWakeAt, now)
        : null,
      workspace: projectedWorkspace,
    });
    emitHostedRuntimeReconciliationFacts({
      facts,
      request: input,
      usageGateRequired: false,
      usageGateStatus: "not_required",
    });
    return facts;
  }

  const [maxSeqByLane, consumedSeqByLane] = await Promise.all([
    readHostedMailboxMaxSeqByLane({ prisma, userId: input.userId }),
    readHostedMailboxConsumedSeqByLane({
      lanes: ["conversation"],
      prisma,
      userId: input.userId,
    }),
  ]);
  const redactedStatus = readHostedMailboxRedactedStatusRecord(
    workspace?.redactedStatusJson,
  );
  const mailboxLag = maxSeqByLane.map((highWater) =>
    computeHostedMailboxLaneLag({
      highWater,
      redactedStatusJson: redactedStatus,
    })
  );

  if (!projectedWorkspace) {
    const facts = buildHostedRuntimeBlockedFacts({
      mailboxLag,
      reason: "hosted_runtime_not_configured",
      retryAt: null,
      workspace: null,
    });
    emitHostedRuntimeReconciliationFacts({
      facts,
      request: input,
      usageGateRequired: false,
      usageGateStatus: "not_required",
    });
    return facts;
  }

  const usageGateRequired = await hostedRuntimeReconciliationNeedsAiUsageGate({
    consumedSeqByLane,
    mailboxLag,
    now,
    prisma,
    userId: input.userId,
    workspace: projectedWorkspace,
  });

  if (usageGateRequired) {
    const gate = await resolveHostedRuntimeAiUsageGate({
      mode: input.usageGateMode ?? "mutating",
      now,
      userId: input.userId,
    });

    if (gate.status === "denied") {
      if ((input.usageGateMode ?? "mutating") === "mutating") {
        await sendHostedRuntimeAiUsageLimitNoticeForPendingConversation({
          consumedSeqByLane,
          gate,
          mailboxLag,
          now,
          prisma,
          userId: input.userId,
        });
      }
      const facts = buildHostedRuntimeBlockedFacts({
        mailboxLag,
        reason: "ai_usage_denied",
        retryAt: resolveHostedRuntimeAiBlockedRetryAt({
          aiRetryAt: null,
          now,
          workspace: projectedWorkspace,
        }),
        workspace: projectedWorkspace,
      });
      emitHostedRuntimeReconciliationFacts({
        facts,
        request: input,
        usageGateRequired: true,
        usageGateStatus: gate.status,
      });
      return facts;
    }

    if (gate.status === "unavailable") {
      const facts = buildHostedRuntimeBlockedFacts({
        mailboxLag,
        reason: "ai_usage_gate_unavailable",
        retryAt: resolveHostedRuntimeAiBlockedRetryAt({
          aiRetryAt: gate.retryAt,
          now,
          workspace: projectedWorkspace,
        }),
        workspace: projectedWorkspace,
      });
      emitHostedRuntimeReconciliationFacts({
        facts,
        request: input,
        usageGateRequired: true,
        usageGateStatus: gate.status,
      });
      return facts;
    }

    const facts = parseHostedRuntimeReconciliationFacts({
      blocked: null,
      mailboxLag,
      workspace: projectedWorkspace,
    });
    emitHostedRuntimeReconciliationFacts({
      facts,
      request: input,
      usageGateRequired: true,
      usageGateStatus: gate.status,
    });
    return facts;
  }

  const facts = parseHostedRuntimeReconciliationFacts({
    blocked: null,
    mailboxLag,
    workspace: projectedWorkspace,
  });
  emitHostedRuntimeReconciliationFacts({
    facts,
    request: input,
    usageGateRequired: false,
    usageGateStatus: "not_required",
  });
  return facts;
}

function buildHostedRuntimeBlockedFacts(input: {
  mailboxLag: HostedMailboxLaneLag[];
  reason: HostedRuntimeReconciliationBlockedReason;
  retryAt: string | null;
  workspace: HostedRuntimeReconciliationFactsWorkspace | null;
}): HostedRuntimeReconciliationFacts {
  return parseHostedRuntimeReconciliationFacts({
    blocked: {
      reason: input.reason,
      retryAt: input.retryAt,
    },
    mailboxLag: input.mailboxLag,
    workspace: input.workspace,
  });
}

async function hostedRuntimeReconciliationNeedsAiUsageGate(input: {
  consumedSeqByLane: readonly HostedMailboxLaneConsumed[];
  mailboxLag: readonly HostedMailboxLaneLag[];
  now: Date;
  prisma: Parameters<typeof readHostedMailboxMaxSeqByLane>[0]["prisma"];
  userId: string;
  workspace: HostedRuntimeReconciliationFactsWorkspace;
}): Promise<boolean> {
  if (hasHostedFreshConversationMailboxLag({
    consumedSeqByLane: input.consumedSeqByLane,
    mailboxLag: input.mailboxLag,
  })) {
    return true;
  }

  if (hasHostedMailboxLag(input.mailboxLag, "system")) {
    const gatedSystemItemPending =
      await readHostedMailboxPendingSystemItemsNeedAiUsageGate({
        afterSeq: readHostedMailboxLaneImportedSeq(input.mailboxLag, "system"),
        prisma: input.prisma,
        userId: input.userId,
      });
    if (gatedSystemItemPending) {
      return true;
    }
  }

  return isHostedRuntimeWakeDue(input.workspace.nextWakeAt, input.now)
    && isHostedRuntimeModelCapableWorkspaceWakeReason(input.workspace.nextWakeReason);
}

function resolveHostedRuntimeAiBlockedRetryAt(input: {
  aiRetryAt: string | null;
  now: Date;
  workspace: HostedRuntimeReconciliationFactsWorkspace;
}): string | null {
  return earliestHostedRuntimeReconciliationTimestamp([
    input.aiRetryAt,
    readHostedRuntimeFutureTimestamp(input.workspace.inboxMediaRetentionWakeAt, input.now),
  ]);
}

async function sendHostedRuntimeAiUsageLimitNoticeForPendingConversation(input: {
  consumedSeqByLane: readonly HostedMailboxLaneConsumed[];
  gate: Extract<HostedRuntimeUsageGateCheck, { status: "denied" }>;
  mailboxLag: readonly HostedMailboxLaneLag[];
  now: Date;
  prisma: NonNullable<Parameters<typeof readHostedMailboxMaxSeqByLane>[0]["prisma"]>;
  userId: string;
}): Promise<void> {
  const decision = input.gate.decision;
  if (
    decision.reason !== "ai_usage_limit_exceeded" ||
    !decision.userNotice ||
    !hasHostedFreshConversationMailboxLag({
      consumedSeqByLane: input.consumedSeqByLane,
      mailboxLag: input.mailboxLag,
    })
  ) {
    return;
  }

  const pendingItem = await readHostedMailboxFirstPendingConversationItem({
    afterSeq: readHostedConversationFreshWorkFloor({
      consumedSeqByLane: input.consumedSeqByLane,
      mailboxLag: input.mailboxLag,
    }).toString(),
    prisma: input.prisma,
    userId: input.userId,
  });
  if (!pendingItem) {
    return;
  }

  const wake = await readHostedRuntimePendingConversationWake({
    item: pendingItem,
    prisma: input.prisma,
  });
  if (!wake) {
    return;
  }

  if (isHostedTelegramConversationMessageWake(wake)) {
    const noticeDelivery = prepareHostedRuntimeTelegramUsageLimitNotice({
      target: wake.message.telegramMessage.threadId,
    });
    if (!noticeDelivery) {
      return;
    }

    const sentAt = input.now;
    const claimed = await claimHostedAiUsageLimitNotice({
      memberId: input.userId,
      periodStart: decision.periodStart,
      prisma: input.prisma,
      sentAt,
    });
    if (!claimed) {
      return;
    }

    try {
      await sendHostedRuntimeTelegramUsageLimitNotice({
        delivery: noticeDelivery,
        message: decision.userNotice.message,
        replyToMessageId: wake.message.telegramMessage.messageId,
      });
    } catch (error) {
      await releaseHostedRuntimeAiUsageNoticeClaimBestEffort({
        memberId: input.userId,
        periodStart: decision.periodStart,
        prisma: input.prisma,
        sentAt,
      });
      throw error;
    }
    return;
  }

  if (!isHostedLinqConversationMessageWake(wake)) {
    return;
  }

  const sentAt = input.now;
  const claimed = await claimHostedAiUsageLimitNotice({
    memberId: input.userId,
    periodStart: decision.periodStart,
    prisma: input.prisma,
    sentAt,
  });
  if (!claimed) {
    return;
  }

  await drainHostedLinqSideEffectsDirect({
    prisma: input.prisma,
    sideEffects: buildAiUsageQuotaReplyResponse({
      chatId: wake.message.linqMessage.chatId,
      claimToken: {
        periodStart: decision.periodStart.toISOString(),
        sentAt: sentAt.toISOString(),
      },
      memberId: input.userId,
      message: decision.userNotice.message,
      messageId: wake.message.linqMessage.messageId,
      noticeCode: decision.userNotice.code,
      occurredAt: wake.occurredAt,
      sourceEventId: wake.eventId,
    }).desiredSideEffects,
  });
}

async function sendHostedRuntimeTelegramUsageLimitNotice(input: {
  delivery: HostedRuntimeTelegramUsageLimitNoticeDelivery;
  message: string;
  replyToMessageId: string;
}): Promise<void> {
  const timeout = new AbortController();
  const timeoutId = setTimeout(
    () => timeout.abort(),
    HOSTED_TELEGRAM_USAGE_LIMIT_NOTICE_TIMEOUT_MS,
  );

  try {
    let response: Awaited<ReturnType<typeof input.delivery.fetchImplementation>>;
    try {
      response = await input.delivery.fetchImplementation(
        `${input.delivery.baseUrl}/bot${input.delivery.token}/sendMessage`,
        {
          body: JSON.stringify({
            business_connection_id: input.delivery.target.businessConnectionId ?? undefined,
            chat_id: input.delivery.target.chatId,
            direct_messages_topic_id: input.delivery.target.directMessagesTopicId ?? undefined,
            message_thread_id: input.delivery.target.messageThreadId ?? undefined,
            reply_to_message_id: parseHostedRuntimeTelegramMessageId(input.replyToMessageId),
            text: input.message,
          }),
          headers: {
            "content-type": "application/json",
          },
          method: "POST",
          signal: timeout.signal,
        },
      );
    } catch {
      throw new Error(
        "Hosted Telegram usage-limit notice delivery could not be confirmed after calling the Bot API.",
      );
    }

    const payload = await readHostedRuntimeTelegramJsonResponse(response);
    if (response.ok && isHostedRuntimeTelegramSuccessResponse(payload)) {
      return;
    }

    throw new Error(
      formatHostedRuntimeTelegramFailureMessage({
        errorContext: readHostedRuntimeTelegramErrorContext(payload),
        status: response.status,
      }),
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

type HostedRuntimeTelegramUsageLimitNoticeDelivery = {
  baseUrl: string;
  fetchImplementation: typeof fetch;
  target: NonNullable<ReturnType<typeof parseTelegramThreadTarget>>;
  token: string;
};

function prepareHostedRuntimeTelegramUsageLimitNotice(input: {
  target: string;
}): HostedRuntimeTelegramUsageLimitNoticeDelivery | null {
  const token = readHostedRuntimeTelegramEnv("TELEGRAM_BOT_TOKEN");
  const target = parseTelegramThreadTarget(input.target);
  const fetchImplementation = globalThis.fetch?.bind(globalThis);

  if (!token || !target || typeof fetchImplementation !== "function") {
    return null;
  }

  return {
    baseUrl: normalizeHostedRuntimeTelegramApiBaseUrl(
      readHostedRuntimeTelegramEnv("TELEGRAM_API_BASE_URL"),
    ),
    fetchImplementation,
    target,
    token,
  };
}

async function readHostedRuntimeTelegramJsonResponse(
  response: Response,
): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function isHostedRuntimeTelegramSuccessResponse(value: unknown): boolean {
  return Boolean(
    value
      && typeof value === "object"
      && "ok" in value
      && value.ok === true,
  );
}

function readHostedRuntimeTelegramErrorContext(value: unknown): {
  description: string | null;
  errorCode: number | null;
} {
  if (!value || typeof value !== "object") {
    return {
      description: null,
      errorCode: null,
    };
  }

  const description =
    "description" in value && typeof value.description === "string"
      ? value.description.trim() || null
      : null;
  const errorCode =
    "error_code" in value
      && typeof value.error_code === "number"
      && Number.isInteger(value.error_code)
      ? value.error_code
      : null;

  return {
    description,
    errorCode,
  };
}

function formatHostedRuntimeTelegramFailureMessage(input: {
  errorContext: {
    description: string | null;
    errorCode: number | null;
  };
  status: number;
}): string {
  const parts = [
    `Hosted Telegram usage-limit notice delivery failed with HTTP ${input.status}`,
  ];
  if (input.errorContext.errorCode !== null) {
    parts.push(`Telegram error_code ${input.errorContext.errorCode}`);
  }
  if (input.errorContext.description) {
    parts.push(`description: ${input.errorContext.description}`);
  }
  const message = parts.join("; ");
  return /[.!?]$/u.test(message) ? message : `${message}.`;
}

function parseHostedRuntimeTelegramMessageId(value: string): number | undefined {
  const normalized = value.trim();
  return /^\d+$/u.test(normalized) ? Number.parseInt(normalized, 10) : undefined;
}

function normalizeHostedRuntimeTelegramApiBaseUrl(value: string | null): string {
  const candidate = value ?? DEFAULT_TELEGRAM_API_BASE_URL;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return DEFAULT_TELEGRAM_API_BASE_URL;
    }
    return url.toString().replace(/\/$/u, "");
  } catch {
    return DEFAULT_TELEGRAM_API_BASE_URL;
  }
}

function readHostedRuntimeTelegramEnv(name: string): string | null {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

async function releaseHostedRuntimeAiUsageNoticeClaimBestEffort(input: {
  memberId: string;
  periodStart: Date;
  prisma: NonNullable<Parameters<typeof readHostedMailboxMaxSeqByLane>[0]["prisma"]>;
  sentAt: Date;
}): Promise<void> {
  try {
    await releaseHostedAiUsageLimitNotice(input);
  } catch (error) {
    console.error("Hosted Telegram usage-limit notice claim release failed.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  }
}

async function readHostedRuntimePendingConversationWake(input: {
  item: Awaited<ReturnType<typeof readHostedMailboxFirstPendingConversationItem>>;
  prisma: NonNullable<Parameters<typeof readHostedMailboxPayload>[0]["prisma"]>;
}): Promise<HostedExecutionWake | null> {
  if (!input.item) {
    return null;
  }

  const payload = input.item.payloadRef
    ? await readHostedMailboxPayload({
        dedupeKey: input.item.dedupeKey,
        mailboxItemId: input.item.id,
        payloadRef: input.item.payloadRef,
        prisma: input.prisma,
        userId: input.item.userId,
      })
    : null;
  const decoded = await decodeHostedMailboxStoredPayload({
    dedupeKey: input.item.dedupeKey,
    kind: input.item.kind,
    lane: input.item.lane,
    laneSeq: input.item.laneSeq,
    mailboxItemId: input.item.id,
    occurredAt: input.item.occurredAt,
    payloadCiphertext: payload?.payloadCiphertext ?? null,
    payloadInlineCiphertext: input.item.payloadInlineCiphertext,
    payloadSchema: input.item.payloadSchema,
    prisma: input.prisma,
    userId: input.item.userId,
  });

  return decoded ? parseHostedExecutionWake(decoded) : null;
}

function hasHostedMailboxLag(
  mailboxLag: readonly HostedMailboxLaneLag[],
  targetLane?: HostedMailboxLaneLag["lane"],
): boolean {
  return mailboxLag.some((laneLag) => {
    if (targetLane !== undefined && laneLag.lane !== targetLane) {
      return false;
    }
    try {
      return BigInt(laneLag.lag) > 0n;
    } catch {
      return false;
    }
  });
}

function hasHostedFreshConversationMailboxLag(input: {
  consumedSeqByLane: readonly HostedMailboxLaneConsumed[];
  mailboxLag: readonly HostedMailboxLaneLag[];
}): boolean {
  const maxSeq = parseHostedMailboxReconciliationSeq(
    input.mailboxLag.find((laneLag) => laneLag.lane === "conversation")?.maxSeq,
  );
  if (maxSeq === null) {
    return false;
  }

  return maxSeq > readHostedConversationFreshWorkFloor(input);
}

function readHostedConversationFreshWorkFloor(input: {
  consumedSeqByLane: readonly HostedMailboxLaneConsumed[];
  mailboxLag: readonly HostedMailboxLaneLag[];
}): bigint {
  const importedSeq = parseHostedMailboxReconciliationSeq(
    readHostedMailboxLaneImportedSeq(input.mailboxLag, "conversation"),
  ) ?? 0n;
  const consumedSeq = parseHostedMailboxReconciliationSeq(
    input.consumedSeqByLane.find((entry) => entry.lane === "conversation")?.consumedSeq,
  ) ?? 0n;

  return consumedSeq > importedSeq ? consumedSeq : importedSeq;
}

function parseHostedMailboxReconciliationSeq(
  value: string | null | undefined,
): bigint | null {
  return typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value)
    ? BigInt(value)
    : null;
}

function readHostedMailboxLaneImportedSeq(
  mailboxLag: readonly HostedMailboxLaneLag[],
  lane: HostedMailboxLaneLag["lane"],
): string {
  return mailboxLag.find((laneLag) => laneLag.lane === lane)?.importedSeq ?? "0";
}

function emitHostedRuntimeReconciliationFacts(event: {
  facts: HostedRuntimeReconciliationFacts;
  request: HostedRuntimeReconciliationFactsRequest & {
    decisionSource?: HostedRuntimeReconciliationDecisionSource;
  };
  usageGateRequired: boolean;
  usageGateStatus: HostedRuntimeReconciliationUsageGateStatus;
}): void {
  console.info("Hosted runtime reconciliation facts.", {
    blockedReason: event.facts.blocked?.reason ?? null,
    component: "hosted.orchestration.reconciliation",
    conversationLagPresent: hasHostedMailboxLag(event.facts.mailboxLag, "conversation"),
    decisionSource: event.request.decisionSource ?? "workflow",
    mailboxLagLaneCount: event.facts.mailboxLag.length,
    retryAtPresent: event.facts.blocked?.retryAt !== null
      && event.facts.blocked?.retryAt !== undefined,
    schema: HOSTED_RUNTIME_RECONCILIATION_FACTS_LOG_SCHEMA,
    status: event.facts.blocked
      ? "blocked"
      : hasHostedMailboxLag(event.facts.mailboxLag)
        ? "work_pending"
        : "idle",
    usageGateRequired: event.usageGateRequired,
    usageGateStatus: event.usageGateStatus,
    userIdPresent: event.request.userId.length > 0,
    workspaceInboxMediaRetentionWakeAtPresent:
      event.facts.workspace?.inboxMediaRetentionWakeAt !== null
        && event.facts.workspace?.inboxMediaRetentionWakeAt !== undefined,
    workspaceNextWakeAtPresent:
      event.facts.workspace?.nextWakeAt !== null
        && event.facts.workspace?.nextWakeAt !== undefined,
    workspaceNextWakeReason: describeHostedRuntimeWakeReasonForLog(
      event.facts.workspace?.nextWakeReason ?? null,
    ),
    workspacePresent: event.facts.workspace !== null,
  });
}

function describeHostedRuntimeWakeReasonForLog(reason: string | null): string | null {
  switch (reason) {
    case null:
      return null;
    case "alarm":
    case "assistant":
    case "assistant_due":
    case "device-sync.reconcile":
    case "mailbox":
      return reason;
    default:
      return "other";
  }
}

function isHostedRuntimeModelCapableWorkspaceWakeReason(
  reason: string | null,
): boolean {
  return reason === "assistant" || reason === "assistant_due";
}

function isHostedRuntimeWakeDue(value: string | null, now: Date): boolean {
  const timestamp = readHostedRuntimeReconciliationTimestamp(value);
  return timestamp !== null && timestamp <= now.getTime();
}

function readHostedRuntimeFutureTimestamp(value: string | null, now: Date): string | null {
  const timestamp = readHostedRuntimeReconciliationTimestamp(value);
  if (timestamp === null || timestamp <= now.getTime()) {
    return null;
  }

  return value;
}

function earliestHostedRuntimeReconciliationTimestamp(
  values: readonly (string | null)[],
): string | null {
  let selected: string | null = null;
  let selectedMs = Number.POSITIVE_INFINITY;
  for (const value of values) {
    const timestamp = readHostedRuntimeReconciliationTimestamp(value);
    if (timestamp === null || timestamp >= selectedMs) {
      continue;
    }
    selected = value;
    selectedMs = timestamp;
  }

  return selected;
}

function readHostedRuntimeReconciliationTimestamp(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function projectHostedRuntimeReconciliationWorkspace(
  workspace: HostedWorkspaceRecord | null,
): HostedRuntimeReconciliationFactsWorkspace | null {
  return workspace
    ? {
        inboxMediaRetentionWakeAt: workspace.inboxMediaRetentionWakeAt,
        nextWakeAt: workspace.nextWakeAt,
        nextWakeReason: workspace.nextWakeReason,
        version: workspace.version,
      }
    : null;
}

function normalizeHostedRuntimeReconciliationDate(
  value: Date | string | undefined,
): Date {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return new Date();
}
