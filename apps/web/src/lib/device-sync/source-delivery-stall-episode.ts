import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  isPushPrimarySourceRecoveryNoticeEligible,
} from "@murphai/device-syncd/source-staleness";

const NOTICE_IDENTITY_PREFIX = "device-delivery-stalled:v1:";
const SOURCE_ID_PATTERN = /^dcs_[A-Za-z0-9_-]{1,120}$/u;
const EPISODE_DIGEST_PATTERN = /^[a-f0-9]{32}$/u;

export interface HostedSourceDeliveryStallNoticeCandidate {
  connectionId: string;
  lastDataAt: string;
  lifecycleEpoch: number | null;
  sourceId: string;
  sourceInstanceKey: string;
  sourceProviderSlug: string;
}

export function resolveHostedSourceDeliveryStallNoticeCandidate(input: {
  connectionId: string;
  lastDataAt: string | null;
  lifecycleEpoch: number | null;
  now: string;
  sourceId: string;
  sourceInstanceKey: string;
  sourceProviderSlug: string;
  status: "connected" | "disconnected" | "error" | "unavailable";
}): HostedSourceDeliveryStallNoticeCandidate | null {
  if (
    !SOURCE_ID_PATTERN.test(input.sourceId)
    || !isPushPrimarySourceRecoveryNoticeEligible(input)
    || input.lastDataAt === null
  ) {
    return null;
  }
  return {
    connectionId: input.connectionId,
    lastDataAt: input.lastDataAt,
    lifecycleEpoch: input.lifecycleEpoch,
    sourceId: input.sourceId,
    sourceInstanceKey: input.sourceInstanceKey,
    sourceProviderSlug: input.sourceProviderSlug,
  };
}

export function buildHostedSourceDeliveryStallNoticeKey(
  candidate: HostedSourceDeliveryStallNoticeCandidate,
): string {
  const digest = createHash("sha256")
    .update(JSON.stringify({
      connectionId: candidate.connectionId,
      lastDataAt: candidate.lastDataAt,
      lifecycleEpoch: candidate.lifecycleEpoch,
      sourceId: candidate.sourceId,
      sourceInstanceKey: candidate.sourceInstanceKey,
      sourceProviderSlug: candidate.sourceProviderSlug,
      version: "v1",
    }))
    .digest("hex")
    .slice(0, 32);
  return `${NOTICE_IDENTITY_PREFIX}${candidate.sourceId}:${digest}`;
}

/**
 * Revalidates this one queued silence episode while holding its canonical
 * source row through the provider-dispatch claim transaction.
 */
export async function isHostedSourceDeliveryStallEpisodeCurrentTx(input: {
  deliveryIdempotencyKey: string | null;
  memberId: string;
  now: string;
  tx: Prisma.TransactionClient;
}): Promise<"current" | "not-applicable" | "superseded"> {
  const key = input.deliveryIdempotencyKey?.trim() ?? "";
  if (!key.startsWith(NOTICE_IDENTITY_PREFIX)) {
    return "not-applicable";
  }
  const identity = parseHostedSourceDeliveryStallNoticeKey(key);
  if (!identity) {
    return "superseded";
  }

  const locked = await input.tx.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM device_connection_source
    WHERE id = ${identity.sourceId}
    FOR UPDATE
  `;
  if (locked.length !== 1) {
    return "superseded";
  }

  const source = await input.tx.deviceConnectionSource.findUnique({
    select: {
      connection: { select: { status: true, userId: true } },
      connectionId: true,
      id: true,
      lastDataAt: true,
      lifecycleEpoch: true,
      sourceInstanceKey: true,
      sourceProviderSlug: true,
      status: true,
    },
    where: { id: identity.sourceId },
  });
  if (
    !source
    || source.connection.userId !== input.memberId
    || source.connection.status !== "active"
    || source.status !== "connected"
    || source.lastDataAt === null
    || !isPushPrimarySourceRecoveryNoticeEligible({
      lastDataAt: source.lastDataAt.toISOString(),
      now: input.now,
      sourceProviderSlug: source.sourceProviderSlug,
      status: source.status,
    })
  ) {
    return "superseded";
  }

  return buildHostedSourceDeliveryStallNoticeKey({
    connectionId: source.connectionId,
    lastDataAt: source.lastDataAt.toISOString(),
    lifecycleEpoch: source.lifecycleEpoch,
    sourceId: source.id,
    sourceInstanceKey: source.sourceInstanceKey,
    sourceProviderSlug: source.sourceProviderSlug,
  }) === key
    ? "current"
    : "superseded";
}

function parseHostedSourceDeliveryStallNoticeKey(
  key: string,
): { sourceId: string } | null {
  const parts = key.slice(NOTICE_IDENTITY_PREFIX.length).split(":");
  if (
    parts.length !== 2
    || !SOURCE_ID_PATTERN.test(parts[0] ?? "")
    || !EPISODE_DIGEST_PATTERN.test(parts[1] ?? "")
  ) {
    return null;
  }
  return { sourceId: parts[0] as string };
}
