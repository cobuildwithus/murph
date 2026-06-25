import {
  Prisma,
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
import {
  readRetellMurphPhoneCallId,
  type RetellCallPayload,
} from "./retell-payloads";

interface HostedPhoneCallWebhookTx {
  appendResultNotification(call: HostedPhoneCall): Promise<void>;
  hostedPhoneCall: {
    findUnique(input: {
      where:
        | { id: string }
        | { providerCallId: string };
    }): Promise<HostedPhoneCall | null>;
    findUniqueOrThrow(input: {
      where: {
        id: string;
      };
    }): Promise<HostedPhoneCall>;
    updateMany(input: {
      data: {
        analyzedAt?: Date;
        endedAt?: Date;
        providerCallId?: string;
        resultJson?: HostedPhoneCallResult;
        status: HostedPhoneCallStatus;
      };
      where: {
        analyzedAt?: null;
        endedAt?: null;
        id: string;
        provider: "retell";
        providerCallId?: string;
        status?: { in: HostedPhoneCallStatus[] };
      };
    }): Promise<{ count: number }>;
  };
}

interface HostedPhoneCallWebhookStore {
  $transaction<T>(
    callback: (tx: HostedPhoneCallWebhookTx) => Promise<T>,
  ): Promise<T>;
}

interface RetellWebhookCallTarget {
  call: HostedPhoneCall;
  providerCallIdData: {
    providerCallId?: string;
  };
}

export async function handleRetellCallEnded(input: {
  call: RetellCallPayload;
  prisma?: HostedPhoneCallWebhookStore;
}): Promise<void> {
  const prisma = resolveHostedPhoneCallWebhookStore(input.prisma);
  await prisma.$transaction(async (tx) => {
    const target = await readRetellWebhookCallTarget({
      call: input.call,
      prisma: tx,
    });
    if (!target) {
      return;
    }

    await tx.hostedPhoneCall.updateMany({
      data: {
        ...target.providerCallIdData,
        endedAt: readRetellEndedAt(input.call) ?? new Date(),
        status: classifyEndedStatus(input.call.disconnection_reason),
      },
      where: {
        endedAt: null,
        id: target.call.id,
        provider: "retell",
        ...(target.call.providerCallId ? { providerCallId: input.call.call_id } : {}),
        status: {
          in: ["starting", "calling", "ended"],
        },
      },
    });
  });
}

export async function handleRetellCallAnalyzed(input: {
  call: RetellCallPayload;
  prisma?: HostedPhoneCallWebhookStore;
}): Promise<void> {
  logRetellStorageModeMismatch(input.call);
  const prisma = resolveHostedPhoneCallWebhookStore(input.prisma);
  const result = mapRetellCallAnalysis(input.call);

  await prisma.$transaction(async (tx) => {
    const target = await readRetellWebhookCallTarget({
      call: input.call,
      prisma: tx,
    });
    if (!target) {
      return;
    }

    const updated = await tx.hostedPhoneCall.updateMany({
      data: {
        ...target.providerCallIdData,
        analyzedAt: new Date(),
        endedAt: readRetellEndedAt(input.call) ?? undefined,
        resultJson: result,
        status: mapPhoneCallStatus(result.outcome),
      },
      where: {
        analyzedAt: null,
        id: target.call.id,
        provider: "retell",
        ...(target.call.providerCallId ? { providerCallId: input.call.call_id } : {}),
      },
    });

    if (updated.count === 0) {
      return;
    }

    const stored = await tx.hostedPhoneCall.findUniqueOrThrow({
      where: {
        id: target.call.id,
      },
    });
    await tx.appendResultNotification(stored);
  });
}

async function appendPhoneCallResultNotificationTx(input: {
  call: HostedPhoneCall;
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  const call = input.call;
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
    prisma: input.prisma,
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
  await appendHostedMailboxEnvelopeTx({
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
    tx: input.prisma,
  });
}

async function readRetellWebhookCallTarget(input: {
  call: RetellCallPayload;
  prisma: HostedPhoneCallWebhookTx;
}): Promise<RetellWebhookCallTarget | null> {
  const murphCallId = readRetellMurphPhoneCallId(input.call);
  const call = murphCallId
    ? await input.prisma.hostedPhoneCall.findUnique({
      where: { id: murphCallId },
    })
    : await input.prisma.hostedPhoneCall.findUnique({
      where: { providerCallId: input.call.call_id },
    });

  if (!call || call.provider !== "retell") {
    return null;
  }
  if (call.providerCallId && call.providerCallId !== input.call.call_id) {
    return null;
  }

  return {
    call,
    providerCallIdData: call.providerCallId
      ? {}
      : { providerCallId: input.call.call_id },
  };
}

function resolveHostedPhoneCallWebhookStore(
  store: HostedPhoneCallWebhookStore | undefined,
): HostedPhoneCallWebhookStore {
  if (store) {
    return store;
  }

  const prisma = getPrisma();
  return {
    $transaction: async (callback) => prisma.$transaction(async (tx) => callback({
      appendResultNotification: async (call) => appendPhoneCallResultNotificationTx({
        call,
        prisma: tx,
      }),
      hostedPhoneCall: {
        findUnique: async (args) => {
          if ("id" in args.where) {
            return tx.hostedPhoneCall.findUnique({
              where: {
                id: args.where.id,
              },
            });
          }

          return tx.hostedPhoneCall.findUnique({
            where: {
              providerCallId: args.where.providerCallId,
            },
          });
        },
        findUniqueOrThrow: async (args) => tx.hostedPhoneCall.findUniqueOrThrow({
          where: {
            id: args.where.id,
          },
        }),
        updateMany: async (args) => tx.hostedPhoneCall.updateMany({
          data: args.data,
          where: {
            analyzedAt: args.where.analyzedAt,
            endedAt: args.where.endedAt,
            id: args.where.id,
            provider: args.where.provider,
            providerCallId: args.where.providerCallId,
            status: args.where.status,
          },
        }),
      },
    })),
  };
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
