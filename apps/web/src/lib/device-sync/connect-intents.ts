import "server-only";

import { createHash, randomBytes } from "node:crypto";

import {
  configuredDeviceSyncProviderKeys,
  type ConfiguredDeviceSyncProviderKey,
} from "@murphai/device-syncd/connect-config";

import { resolveHostedPublicBaseUrl } from "../hosted-web/public-url";
import { getPrisma } from "../prisma";
import type { HostedPrismaTransactionClient } from "./prisma-store";

export interface HostedDeviceConnectIntentRecord {
  claimHash: string;
  memberId: string;
  provider: ConfiguredDeviceSyncProviderKey;
  connectSourceId: string;
  connectTarget: string;
  sourceProviderSlug: string | null;
  createdAt: Date;
  expiresAt: Date;
  startedAt: Date | null;
}

export type HostedDeviceConnectIntentReadResult =
  | { status: "available"; intent: HostedDeviceConnectIntentRecord }
  | { status: "expired" | "missing" | "used" };

export type HostedDeviceConnectIntentClaimResult =
  | { status: "claimed"; intent: HostedDeviceConnectIntentRecord }
  | { status: "expired" | "missing" | "owner_mismatch" | "used" };

const HOSTED_DEVICE_CONNECT_INTENT_CLAIM_PREFIX = "dc_";
const HOSTED_DEVICE_CONNECT_INTENT_CLAIM_BYTES = 24;
const HOSTED_DEVICE_CONNECT_INTENT_TTL_MS = 15 * 60 * 1000;
export const HOSTED_DEVICE_RECONNECT_NOTICE_INTENT_TTL_MS = 72 * 60 * 60 * 1000;

export async function createHostedDeviceConnectIntent(input: {
  connectSourceId: string;
  connectTarget: string;
  memberId: string;
  now?: Date;
  provider: ConfiguredDeviceSyncProviderKey;
  request: Request;
  sourceProviderSlug: string | null;
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

export async function createHostedDeviceConnectIntentTx(input: {
  connectSourceId: string;
  connectTarget: string;
  memberId: string;
  now?: Date;
  provider: ConfiguredDeviceSyncProviderKey;
  request: Request;
  sourceProviderSlug: string | null;
  ttlMs?: number;
  tx: HostedPrismaTransactionClient;
}): Promise<{
  claim: string;
  connectUrl: string;
  deviceConnectUrl: string;
  expiresAt: string;
}> {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + normalizeHostedDeviceConnectIntentTtlMs(input.ttlMs));
  const claim = generateHostedDeviceConnectIntentClaim();
  const claimHash = hashHostedDeviceConnectIntentClaim(claim);

  await input.tx.deviceConnectIntent.deleteMany({
    where: {
      expiresAt: {
        lte: now,
      },
    },
  });

  await input.tx.deviceConnectIntent.create({
    data: {
      claimHash,
      memberId: input.memberId,
      provider: input.provider,
      connectSourceId: input.connectSourceId,
      connectTarget: input.connectTarget,
      sourceProviderSlug: input.sourceProviderSlug,
      createdAt: now,
      expiresAt,
    },
  });

  return {
    claim,
    connectUrl: buildHostedDeviceConnectIntentUrl({
      claim,
      connectSourceId: input.connectSourceId,
      request: input.request,
    }),
    deviceConnectUrl: buildHostedDeviceConnectIntentDirectUrl({
      claim,
      request: input.request,
    }),
    expiresAt: expiresAt.toISOString(),
  };
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

function buildHostedDeviceConnectIntentUrl(input: {
  claim: string;
  connectSourceId: string;
  request: Request;
}): string {
  const baseUrl = resolveHostedPublicBaseUrl() ?? new URL(input.request.url).origin;
  const url = new URL("/connect", `${baseUrl}/`);
  const fragment = new URLSearchParams();
  fragment.set("deviceConnectIntent", input.claim);
  fragment.set("connectSource", input.connectSourceId);
  url.hash = fragment.toString();
  return url.toString();
}

function buildHostedDeviceConnectIntentDirectUrl(input: {
  claim: string;
  request: Request;
}): string {
  const baseUrl = resolveHostedPublicBaseUrl() ?? new URL(input.request.url).origin;
  const url = new URL(`/device/connect/${encodeURIComponent(input.claim)}`, `${baseUrl}/`);
  return url.toString();
}

function normalizeHostedDeviceConnectIntentTtlMs(value: number | null | undefined): number {
  if (!Number.isFinite(value) || value === undefined || value === null) {
    return HOSTED_DEVICE_CONNECT_INTENT_TTL_MS;
  }

  return Math.max(60_000, Math.min(Math.trunc(value), HOSTED_DEVICE_RECONNECT_NOTICE_INTENT_TTL_MS));
}

function generateHostedDeviceConnectIntentClaim(): string {
  return `${HOSTED_DEVICE_CONNECT_INTENT_CLAIM_PREFIX}${
    randomBytes(HOSTED_DEVICE_CONNECT_INTENT_CLAIM_BYTES).toString("base64url")
  }`;
}

function normalizeHostedDeviceConnectIntentClaimHash(claim: string): string | null {
  if (
    !claim.startsWith(HOSTED_DEVICE_CONNECT_INTENT_CLAIM_PREFIX)
    || !/^dc_[A-Za-z0-9_-]{32}$/u.test(claim)
  ) {
    return null;
  }

  return hashHostedDeviceConnectIntentClaim(claim);
}

function hashHostedDeviceConnectIntentClaim(claim: string): string {
  return createHash("sha256").update(claim).digest("hex");
}

function toHostedDeviceConnectIntentRecord(record: {
  claimHash: string;
  memberId: string;
  provider: string;
  connectSourceId: string;
  connectTarget: string;
  sourceProviderSlug: string | null;
  createdAt: Date;
  expiresAt: Date;
  startedAt: Date | null;
}): HostedDeviceConnectIntentRecord {
  return {
    claimHash: record.claimHash,
    memberId: record.memberId,
    provider: requireConfiguredDeviceSyncProviderKey(record.provider),
    connectSourceId: record.connectSourceId,
    connectTarget: record.connectTarget,
    sourceProviderSlug: record.sourceProviderSlug,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    startedAt: record.startedAt,
  };
}

function requireConfiguredDeviceSyncProviderKey(value: string): ConfiguredDeviceSyncProviderKey {
  for (const key of configuredDeviceSyncProviderKeys) {
    if (key === value) {
      return key;
    }
  }

  throw new TypeError("Stored device connect intent provider is not supported.");
}
