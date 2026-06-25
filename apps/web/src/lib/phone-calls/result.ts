import {
  type HostedPhoneCall,
  type HostedPhoneCallStatus,
} from "@prisma/client";
import {
  buildHostedExecutionAssistantNotificationRequestedWake,
  hostedPhoneCallBriefSchema,
  hostedPhoneCallResultSchema,
  type HostedPhoneCallBrief,
  type HostedPhoneCallResult,
} from "@murphai/hosted-execution";

import {
  appendHostedMailboxEnvelopeTx,
} from "../hosted-mailbox/store";
import {
  readHostedMemberSnapshot,
} from "../hosted-onboarding/hosted-member-store";
import {
  resolveHostedMemberAssistantNotificationRoute,
  resolveHostedMemberMessagingState,
} from "../hosted-onboarding/messaging-state";
import { getPrisma } from "../prisma";
import type { RetellCallPayload } from "./retell-payloads";

interface HostedPhoneCallWebhookStore {
  hostedPhoneCall: {
    findUniqueOrThrow(input: {
      where: {
        providerCallId: string;
      };
    }): Promise<HostedPhoneCall>;
    updateMany(input: {
      data: {
        analyzedAt?: Date;
        endedAt?: Date;
        resultJson?: HostedPhoneCallResult;
        status: HostedPhoneCallStatus;
      };
      where: {
        analyzedAt?: null;
        endedAt?: null;
        provider: "retell";
        providerCallId: string;
        status?: { in: HostedPhoneCallStatus[] };
      };
    }): Promise<{ count: number }>;
  };
}

export async function handleRetellCallEnded(input: {
  call: RetellCallPayload;
  prisma?: HostedPhoneCallWebhookStore;
}): Promise<void> {
  const prisma = input.prisma ?? getPrisma();
  await prisma.hostedPhoneCall.updateMany({
    data: {
      endedAt: readRetellEndedAt(input.call) ?? new Date(),
      status: classifyEndedStatus(input.call.disconnection_reason),
    },
    where: {
      endedAt: null,
      provider: "retell",
      providerCallId: input.call.call_id,
      status: {
        in: ["starting", "calling", "ended"],
      },
    },
  });
}

export async function handleRetellCallAnalyzed(input: {
  call: RetellCallPayload;
  prisma?: HostedPhoneCallWebhookStore;
  resultHandler?: (callId: string) => Promise<void>;
}): Promise<void> {
  logRetellStorageModeMismatch(input.call);
  const prisma = input.prisma ?? getPrisma();
  const result = mapRetellCallAnalysis(input.call);
  const updated = await prisma.hostedPhoneCall.updateMany({
    data: {
      analyzedAt: new Date(),
      endedAt: readRetellEndedAt(input.call) ?? undefined,
      resultJson: result,
      status: mapPhoneCallStatus(result.outcome),
    },
    where: {
      analyzedAt: null,
      provider: "retell",
      providerCallId: input.call.call_id,
    },
  });

  if (updated.count === 0) {
    return;
  }

  const stored = await prisma.hostedPhoneCall.findUniqueOrThrow({
    where: {
      providerCallId: input.call.call_id,
    },
  });
  await (input.resultHandler ?? ((callId) => handlePhoneCallResult({ callId })))(stored.id);
}

export async function handlePhoneCallResult(input: {
  callId: string;
}): Promise<void> {
  const prisma = getPrisma();
  const call = await prisma.hostedPhoneCall.findUnique({
    where: {
      id: input.callId,
    },
  });
  if (!call?.resultJson) {
    return;
  }

  const result = hostedPhoneCallResultSchema.safeParse(call.resultJson);
  if (!result.success) {
    return;
  }

  const brief = hostedPhoneCallBriefSchema.safeParse(call.briefJson);
  if (!brief.success) {
    return;
  }

  const member = await readHostedMemberSnapshot({
    memberId: call.memberId,
    prisma,
  });
  if (!member) {
    return;
  }

  const messaging = resolveHostedMemberMessagingState({
    identity: member.identity,
    routing: member.routing,
  });
  const route = resolveHostedMemberAssistantNotificationRoute({
    linqChatId: member.routing?.linqChatId ?? member.routing?.pendingLinqChatId ?? null,
    linqContactLookupKey: member.routing?.pendingLinqParticipantContact?.lookupKey ?? null,
    linqRecipientPhone: member.routing?.linqRecipientPhone ?? member.routing?.pendingLinqRecipientPhone ?? null,
    memberId: call.memberId,
    memberPhoneNumber: member.identity?.phoneNumber ?? null,
    messaging,
  });
  if (!route) {
    return;
  }

  const text = renderPhoneCallResultNotification({
    brief: brief.data,
    result: result.data,
  });
  const notificationKey = `phone-call-result:${call.id}`;
  await prisma.$transaction((tx) => appendHostedMailboxEnvelopeTx({
    envelope: buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: `assistant.notification.requested:${notificationKey}`,
      memberId: call.memberId,
      notification: {
        deliveryDedupeToken: notificationKey,
        deliveryDispatchMode: "queue-only",
        deliveryIdempotencyKey: notificationKey,
        instructions: [
          "Send the final result of the completed Murph phone call.",
          "Use the exact user-facing text in responsePolicy.",
          "If the result describes a completed appointment and connected calendar tools are available, create or update the calendar only through the normal assistant policy after this notification is handled.",
        ].join("\n\n"),
        responsePolicy: {
          kind: "require_send_exact_text",
          text,
        },
        route,
      },
      occurredAt: new Date().toISOString(),
    }),
    tx,
  }));
}

export function mapRetellCallAnalysis(call: RetellCallPayload): HostedPhoneCallResult {
  const customAnalysis = readRecord(call.call_analysis?.custom_analysis_data);
  const outcome = readOutcome(customAnalysis?.outcome);
  const summary =
    readNonEmptyString(customAnalysis?.result)
    ?? readNonEmptyString(call.call_analysis?.call_summary)
    ?? "The call ended, but Retell did not return a final result.";
  const followUp = readNonEmptyString(customAnalysis?.follow_up);

  return hostedPhoneCallResultSchema.parse({
    ...(followUp ? { followUp } : {}),
    outcome,
    summary,
  });
}

function renderPhoneCallResultNotification(input: {
  brief: HostedPhoneCallBrief;
  result: HostedPhoneCallResult;
}): string {
  const lines = [
    `I called ${input.brief.to.label ?? input.brief.to.phoneNumber}.`,
    input.result.summary,
  ];
  if (input.result.outcome === "needs_user" && input.result.followUp) {
    lines.push(input.result.followUp);
  } else if (input.result.followUp) {
    lines.push(`Follow-up: ${input.result.followUp}`);
  }
  if (!input.result.followUp && input.result.outcome === "completed") {
    lines.push("No follow-up is needed.");
  }

  return lines.join("\n\n");
}

function mapPhoneCallStatus(outcome: HostedPhoneCallResult["outcome"]): HostedPhoneCallStatus {
  switch (outcome) {
    case "completed":
      return "completed";
    case "needs_user":
      return "needs_user";
    case "not_completed":
      return "failed";
  }
}

function classifyEndedStatus(reason: string | null | undefined): HostedPhoneCallStatus {
  const normalized = reason?.toLowerCase() ?? "";
  if (
    normalized.includes("busy")
    || normalized.includes("error")
    || normalized.includes("fail")
    || normalized.includes("no_answer")
    || normalized.includes("not_connected")
  ) {
    return "failed";
  }
  return "ended";
}

function readRetellEndedAt(call: RetellCallPayload): Date | null {
  const value = call.end_timestamp;
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value < 1_000_000_000_000 ? value * 1_000 : value);
  }
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const numeric = Number.parseInt(value, 10);
  if (Number.isFinite(numeric)) {
    return new Date(numeric < 1_000_000_000_000 ? numeric * 1_000 : numeric);
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function readOutcome(value: unknown): HostedPhoneCallResult["outcome"] {
  return value === "completed" || value === "needs_user" || value === "not_completed"
    ? value
    : "not_completed";
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function logRetellStorageModeMismatch(call: RetellCallPayload): void {
  const storageMode = call.data_storage_setting?.trim();
  if (!storageMode || storageMode === "basic_attributes_only") {
    return;
  }

  console.warn("Retell phone call storage mode mismatch.", {
    dataStorageSetting: storageMode,
    providerCallIdPresent: Boolean(call.call_id),
  });
}
