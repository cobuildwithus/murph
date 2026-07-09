import "server-only";

import type { PrismaClient } from "@prisma/client";

import { getPrisma } from "../prisma";

type HostedIngressLatencyDeliveryLinkPrismaClient = {
  hostedIngressLatencyTrace: Pick<
    PrismaClient["hostedIngressLatencyTrace"],
    "updateMany"
  >;
};

export interface HostedIngressLatencyDeliveryLinkResult {
  matchedCount: number;
  recorded: boolean;
}

export async function linkHostedIngressLatencyTracesToAcceptedLinqDelivery(input: {
  authenticatedUserId: string;
  answeredMailboxItemIds: readonly string[];
  linqDeliveryId: string;
  prisma?: HostedIngressLatencyDeliveryLinkPrismaClient;
  replyRuntimeAttemptId: string;
}): Promise<HostedIngressLatencyDeliveryLinkResult> {
  const authenticatedUserId = requireSafeLatencyLinkIdentifier(
    input.authenticatedUserId,
    "Hosted ingress latency delivery-link user id",
  );
  const linqDeliveryId = requireSafeLatencyLinkIdentifier(
    input.linqDeliveryId,
    "Hosted ingress latency Linq delivery id",
  );
  const replyRuntimeAttemptId = requireSafeLatencyLinkIdentifier(
    input.replyRuntimeAttemptId,
    "Hosted ingress latency reply runtime attempt id",
  );
  const answeredMailboxItemIds = Array.from(new Set(
    input.answeredMailboxItemIds.map((mailboxItemId) =>
      requireSafeLatencyLinkIdentifier(
        mailboxItemId,
        "Hosted ingress latency answered mailbox item id",
      )),
  ));

  if (answeredMailboxItemIds.length === 0) {
    return { matchedCount: 0, recorded: false };
  }

  const prisma = input.prisma ?? getPrisma();
  const updated = await prisma.hostedIngressLatencyTrace.updateMany({
    data: {
      linqDeliveryId,
      replyRuntimeAttemptId,
    },
    where: {
      linqDeliveryId: null,
      mailboxItemId: {
        in: answeredMailboxItemIds,
      },
      replyRuntimeAttemptId: null,
      runtimeAttemptId: replyRuntimeAttemptId,
      source: "linq",
      userId: authenticatedUserId,
    },
  });

  return {
    matchedCount: updated.count,
    recorded: updated.count > 0,
  };
}

function requireSafeLatencyLinkIdentifier(value: string, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string.`);
  }
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_.:-]{1,256}$/u.test(normalized)) {
    throw new TypeError(`${label} is invalid.`);
  }
  return normalized;
}
