import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import type { DeviceSyncConnectTarget } from "@murphai/device-syncd/connect-config";
import { deviceSyncError } from "@murphai/device-syncd/errors";

const WHOOP_DIRECT_CONNECT_MEMBER_LIMIT = 2;

export async function assertHostedWhoopConnectCapacityAvailable(input: {
  memberId: string;
  prisma: PrismaClient;
  target: DeviceSyncConnectTarget;
}): Promise<void> {
  if (!isHostedWhoopConnectTarget(input.target)) {
    return;
  }

  const existingMemberWhere = {
    userId: input.memberId,
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
  } satisfies Prisma.DeviceConnectionWhereInput;
  const existingMemberConnection = await input.prisma.deviceConnection.findFirst({
    where: existingMemberWhere,
    select: { id: true },
  });
  if (existingMemberConnection) {
    return;
  }

  const currentMembers = await input.prisma.$queryRaw<Array<{ userId: string }>>(Prisma.sql`
    WITH direct_members AS (
      SELECT connection.user_id
      FROM device_connection AS connection
      WHERE connection.provider = 'whoop'
        AND connection.status <> 'disconnected'
      GROUP BY connection.user_id
      ORDER BY connection.user_id ASC
      LIMIT ${WHOOP_DIRECT_CONNECT_MEMBER_LIMIT}
    ),
    junction_members AS (
      SELECT connection.user_id
      FROM device_connection_source AS source
      JOIN device_connection AS connection
        ON connection.id = source.connection_id
      WHERE source.source_provider_slug = 'whoop_v2'
        AND source.status <> 'disconnected'
        AND connection.provider = 'junction'
        AND connection.status <> 'disconnected'
      GROUP BY connection.user_id
      ORDER BY connection.user_id ASC
      LIMIT ${WHOOP_DIRECT_CONNECT_MEMBER_LIMIT}
    )
    SELECT member.user_id AS "userId"
    FROM (
      SELECT direct.user_id FROM direct_members AS direct
      UNION
      SELECT junction.user_id FROM junction_members AS junction
    ) AS member
    ORDER BY member.user_id ASC
    LIMIT ${WHOOP_DIRECT_CONNECT_MEMBER_LIMIT}
  `);

  if (
    currentMembers.length < WHOOP_DIRECT_CONNECT_MEMBER_LIMIT
    || currentMembers.some((member) => member.userId === input.memberId)
  ) {
    return;
  }

  // The exact fast-path and bounded graph read are intentionally separate so
  // existing members avoid the shared graph. Recheck only on the rejecting
  // path so a connection committed between those reads remains idempotent.
  const concurrentExistingMemberConnection =
    await input.prisma.deviceConnection.findFirst({
      where: existingMemberWhere,
      select: { id: true },
    });
  if (concurrentExistingMemberConnection) {
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
