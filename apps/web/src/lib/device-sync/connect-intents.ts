import "server-only";

import type { ConfiguredDeviceSyncProviderKey } from "@murphai/device-syncd/connect-config";

import {
  createHostedDeviceConnectIntentTx,
  normalizeHostedDeviceConnectIntentClaimHash,
  toHostedDeviceConnectIntentRecord,
  type HostedDeviceConnectIntentRecord,
} from "./connect-intent-core";
import { getPrisma } from "../prisma";

export {
  createHostedDeviceConnectIntentTx,
  HOSTED_DEVICE_RECONNECT_NOTICE_INTENT_TTL_MS,
  type HostedDeviceConnectIntentRecord,
} from "./connect-intent-core";

export type HostedDeviceConnectIntentReadResult =
  | { status: "available"; intent: HostedDeviceConnectIntentRecord }
  | { status: "expired" | "missing" | "used" };

export type HostedDeviceConnectIntentClaimResult =
  | { status: "claimed"; intent: HostedDeviceConnectIntentRecord }
  | { status: "expired" | "missing" | "owner_mismatch" | "used" };

export async function createHostedDeviceConnectIntent(input: {
  connectSourceId: string;
  connectTarget: string;
  memberId: string;
  now?: Date;
  provider: ConfiguredDeviceSyncProviderKey;
  providerSetupId?: string | null;
  request: Request;
  sourceProviderSlug: string | null;
  ttlMs?: number;
}): Promise<{
  claim: string;
  connectUrl: string;
  deviceConnectUrl: string;
  expiresAt: string;
}> {
  return getPrisma().$transaction((tx) =>
    createHostedDeviceConnectIntentTx({
      ...input,
      tx,
    })
  );
}

export async function readHostedDeviceConnectIntent(
  claim: string,
  now: Date = new Date(),
): Promise<HostedDeviceConnectIntentReadResult> {
  const claimHash = normalizeHostedDeviceConnectIntentClaimHash(claim);
  if (!claimHash) {
    return { status: "missing" };
  }

  const record = await getPrisma().deviceConnectIntent.findUnique({
    where: {
      claimHash,
    },
  });

  if (!record) {
    return { status: "missing" };
  }

  if (record.expiresAt.getTime() <= now.getTime()) {
    await getPrisma().deviceConnectIntent.deleteMany({
      where: {
        claimHash,
        expiresAt: {
          lte: now,
        },
      },
    });
    return { status: "expired" };
  }

  if (record.startedAt) {
    return { status: "used" };
  }

  return {
    status: "available",
    intent: toHostedDeviceConnectIntentRecord(record),
  };
}

export async function claimHostedDeviceConnectIntentForStart(input: {
  claim: string;
  memberId: string;
  now?: Date;
}): Promise<HostedDeviceConnectIntentClaimResult> {
  const now = input.now ?? new Date();
  const claimHash = normalizeHostedDeviceConnectIntentClaimHash(input.claim);
  if (!claimHash) {
    return { status: "missing" };
  }

  return getPrisma().$transaction(async (tx) => {
    const record = await tx.deviceConnectIntent.findUnique({
      where: {
        claimHash,
      },
    });

    if (!record) {
      return { status: "missing" };
    }

    if (record.expiresAt.getTime() <= now.getTime()) {
      await tx.deviceConnectIntent.deleteMany({
        where: {
          claimHash,
          expiresAt: {
            lte: now,
          },
        },
      });
      return { status: "expired" };
    }

    if (record.startedAt) {
      return { status: "used" };
    }

    if (record.memberId !== input.memberId) {
      return { status: "owner_mismatch" };
    }

    const update = await tx.deviceConnectIntent.updateMany({
      where: {
        claimHash,
        memberId: input.memberId,
        startedAt: null,
        expiresAt: {
          gt: now,
        },
      },
      data: {
        startedAt: now,
      },
    });

    if (update.count !== 1) {
      return { status: "used" };
    }

    const claimed = await tx.deviceConnectIntent.findUniqueOrThrow({
      where: {
        claimHash,
      },
    });

    return {
      status: "claimed",
      intent: toHostedDeviceConnectIntentRecord(claimed),
    };
  });
}

export async function releaseHostedDeviceConnectIntentStart(input: {
  claim: string;
  memberId: string;
}): Promise<void> {
  const claimHash = normalizeHostedDeviceConnectIntentClaimHash(input.claim);
  if (!claimHash) {
    return;
  }

  await getPrisma().deviceConnectIntent.updateMany({
    where: {
      claimHash,
      memberId: input.memberId,
      startedAt: {
        not: null,
      },
    },
    data: {
      startedAt: null,
    },
  });
}
