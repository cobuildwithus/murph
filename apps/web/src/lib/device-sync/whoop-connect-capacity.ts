import "server-only";

import type { PrismaClient } from "@prisma/client";
import type { DeviceSyncConnectTarget } from "@murphai/device-syncd/connect-config";
import { deviceSyncError } from "@murphai/device-syncd/errors";

const WHOOP_DIRECT_CONNECT_MEMBER_LIMIT = 10;

export async function assertHostedWhoopConnectCapacityAvailable(input: {
  memberId: string;
  prisma: PrismaClient;
  target: DeviceSyncConnectTarget;
}): Promise<void> {
  if (!isHostedWhoopConnectTarget(input.target)) {
    return;
  }

  const currentMembers = await input.prisma.deviceConnection.findMany({
    where: {
      status: { not: "disconnected" },
      OR: [
        { provider: "whoop" },
        {
          provider: "junction",
          sources: {
            some: {
              sourceProviderSlug: "whoop_v2",
              status: { not: "disconnected" },
            },
          },
        },
      ],
    },
    select: { userId: true },
    distinct: ["userId"],
  });

  if (
    currentMembers.length < WHOOP_DIRECT_CONNECT_MEMBER_LIMIT
    || currentMembers.some((member) => member.userId === input.memberId)
  ) {
    return;
  }

  throw deviceSyncError({
    code: "WHOOP_DIRECT_CONNECT_CAP_REACHED",
    httpStatus: 409,
    message:
      "Direct WHOOP connections are full right now. You can keep WHOOP syncing through Apple Health in the Murph app.",
    retryable: false,
  });
}

function isHostedWhoopConnectTarget(target: DeviceSyncConnectTarget): boolean {
  return target.provider === "whoop"
    || (target.provider === "junction" && target.sourceProviderSlug === "whoop_v2");
}
