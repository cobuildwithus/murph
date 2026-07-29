import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  HostedRuntimeLinqDeliveryBlockCode,
  HostedRuntimeLinqDeliveryPosture,
} from "@murphai/hosted-execution/routes";

import {
  createHostedPhoneLookupKeyReadCandidates,
} from "./contact-privacy";
import {
  readHostedLinqChatHealth,
  readHostedLinqLineProviderState,
} from "./linq-provider-health-store";
import { normalizePhoneNumber } from "./phone";

type HostedLinqEgressPolicyClient = PrismaClient | Prisma.TransactionClient;

export type HostedLinqDeliveryPosture =
  | "normal"
  | HostedRuntimeLinqDeliveryPosture;

export const HOSTED_LINQ_DELIVERY_SIGNALS = [
  "line_at_risk",
  "chat_at_risk",
  "chat_health_unknown",
  "delivery_warning",
] as const;

export type HostedLinqDeliverySignal =
  typeof HOSTED_LINQ_DELIVERY_SIGNALS[number];

export type HostedLinqEgressBlockCode = HostedRuntimeLinqDeliveryBlockCode;

export type HostedLinqEgressPolicyResult =
  | {
      kind: "allow";
      posture: HostedLinqDeliveryPosture;
      signals: HostedLinqDeliverySignal[];
    }
  | {
      code: HostedLinqEgressBlockCode;
      kind: "block";
    };

export async function resolveHostedLinqEgressPolicyForRuntime(input: {
  fromPhoneNumber?: string | null;
  prisma: HostedLinqEgressPolicyClient;
  target: string | null;
  targetKind?: string | null;
}): Promise<HostedLinqEgressPolicyResult> {
  const targetKind = input.targetKind?.trim() ?? "";
  const newConversation = targetKind === "participant";
  const chatHealth = newConversation
    ? null
    : await readHostedLinqChatHealth({
        chatId: input.target,
        prisma: input.prisma,
      });
  const phoneNumberLookupKeys = new Set(
    createHostedPhoneLookupKeyReadCandidates(
      normalizePhoneNumber(input.fromPhoneNumber),
    ),
  );
  if (chatHealth?.phoneNumberLookupKey) {
    phoneNumberLookupKeys.add(chatHealth.phoneNumberLookupKey);
  }
  const lineLookupKeys = [...phoneNumberLookupKeys];
  const [line, lineProviderState] = await Promise.all([
    lineLookupKeys.length === 0
      ? null
      : input.prisma.hostedLinqLine.findFirst({
          select: {
            egressPolicy: true,
            healthStatus: true,
            phoneNumberLookupKey: true,
          },
          where: {
            phoneNumberLookupKey: { in: lineLookupKeys },
          },
        }),
    readHostedLinqLineProviderState({
      phoneNumberLookupKeys: lineLookupKeys,
      prisma: input.prisma,
    }),
  ]);

  return evaluateHostedLinqEgressPolicy({
    chatHealthStatus: chatHealth?.providerStatus ?? null,
    lineDeliveryHealthStatus: line?.healthStatus ?? null,
    lineEgressPolicy: line?.egressPolicy ?? null,
    lineReputationStatus: lineProviderState?.reputationStatus ?? null,
    lineServiceStatus: lineProviderState?.serviceStatus ?? null,
    newConversation,
  });
}

export function evaluateHostedLinqEgressPolicy(input: {
  chatHealthStatus: unknown;
  lineDeliveryHealthStatus: unknown;
  lineEgressPolicy: unknown;
  lineReputationStatus: unknown;
  lineServiceStatus: unknown;
  newConversation: boolean;
}): HostedLinqEgressPolicyResult {
  const lineEgressPolicy = normalizePolicyToken(input.lineEgressPolicy);
  const lineServiceStatus = normalizePolicyToken(input.lineServiceStatus);
  const lineReputationStatus = normalizePolicyToken(input.lineReputationStatus);
  const chatHealthStatus = normalizePolicyToken(input.chatHealthStatus);
  const lineDeliveryHealthStatus = normalizePolicyToken(
    input.lineDeliveryHealthStatus,
  ).toLowerCase();

  if (lineEgressPolicy && lineEgressPolicy !== "ENABLED") {
    return { code: "operator_disabled", kind: "block" };
  }
  if (lineServiceStatus === "FLAGGED") {
    return { code: "line_flagged", kind: "block" };
  }
  if (lineReputationStatus === "CRITICAL") {
    return { code: "line_critical", kind: "block" };
  }
  if (input.newConversation && lineReputationStatus === "AT_RISK") {
    return { code: "line_at_risk_new_conversation", kind: "block" };
  }
  if (chatHealthStatus === "OPTED_OUT") {
    return { code: "chat_opted_out", kind: "block" };
  }
  if (chatHealthStatus === "CRITICAL") {
    return { code: "chat_critical", kind: "block" };
  }
  if (lineDeliveryHealthStatus === "unhealthy") {
    return { code: "delivery_unhealthy", kind: "block" };
  }
  if (
    input.newConversation
    && (lineDeliveryHealthStatus === "warning" || lineDeliveryHealthStatus === "degraded")
  ) {
    return { code: "delivery_warning_new_conversation", kind: "block" };
  }

  const signals: HostedLinqDeliverySignal[] = [];
  if (lineReputationStatus === "AT_RISK") {
    signals.push("line_at_risk");
  }
  if (chatHealthStatus === "AT_RISK") {
    signals.push("chat_at_risk");
  } else if (!input.newConversation && !chatHealthStatus) {
    signals.push("chat_health_unknown");
  }
  if (lineDeliveryHealthStatus === "warning" || lineDeliveryHealthStatus === "degraded") {
    signals.push("delivery_warning");
  }

  return {
    kind: "allow",
    posture: signals.includes("chat_at_risk")
      ? "recover"
      : signals.length > 0
        ? "cautious"
        : "normal",
    signals,
  };
}

function normalizePolicyToken(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}
