import { createHash, randomBytes } from "node:crypto";

import {
  configuredDeviceSyncProviderKeys,
  type ConfiguredDeviceSyncProviderKey,
} from "@murphai/device-syncd/connect-config";

import { resolveHostedPublicBaseUrl } from "../hosted-web/public-url";
import type { HostedPrismaTransactionClient } from "./prisma-store";

export interface HostedDeviceConnectIntentRecord {
  claimHash: string;
  memberId: string;
  provider: ConfiguredDeviceSyncProviderKey;
  providerSetupId: string | null;
  connectSourceId: string;
  connectTarget: string;
  sourceProviderSlug: string | null;
  createdAt: Date;
  expiresAt: Date;
  startedAt: Date | null;
}

const HOSTED_DEVICE_CONNECT_INTENT_CLAIM_PREFIX = "dc_";
const HOSTED_DEVICE_CONNECT_INTENT_CLAIM_BYTES = 24;
const HOSTED_DEVICE_CONNECT_INTENT_TTL_MS = 15 * 60 * 1000;
export const HOSTED_DEVICE_RECONNECT_NOTICE_INTENT_TTL_MS = 72 * 60 * 60 * 1000;

export async function createHostedDeviceConnectIntentTx(input: {
  connectSourceId: string;
  connectTarget: string;
  memberId: string;
  now?: Date;
  provider: ConfiguredDeviceSyncProviderKey;
  providerSetupId?: string | null;
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
  const providerSetupId = input.providerSetupId ?? null;
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
      providerSetupId,
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
      provider: input.provider,
      request: input.request,
    }),
    deviceConnectUrl: buildHostedDeviceConnectIntentDirectUrl({
      claim,
      request: input.request,
    }),
    expiresAt: expiresAt.toISOString(),
  };
}

export function normalizeHostedDeviceConnectIntentClaimHash(claim: string): string | null {
  if (
    !claim.startsWith(HOSTED_DEVICE_CONNECT_INTENT_CLAIM_PREFIX)
    || !/^dc_[A-Za-z0-9_-]{32}$/u.test(claim)
  ) {
    return null;
  }

  return hashHostedDeviceConnectIntentClaim(claim);
}

export function toHostedDeviceConnectIntentRecord(record: {
  claimHash: string;
  memberId: string;
  provider: string;
  providerSetupId: string | null;
  connectSourceId: string;
  connectTarget: string;
  sourceProviderSlug: string | null;
  createdAt: Date;
  expiresAt: Date;
  startedAt: Date | null;
}): HostedDeviceConnectIntentRecord {
  const providerSetupId = record.providerSetupId ?? null;
  return {
    claimHash: record.claimHash,
    memberId: record.memberId,
    provider: requireConfiguredDeviceSyncProviderKey(record.provider),
    providerSetupId,
    connectSourceId: record.connectSourceId,
    connectTarget: record.connectTarget,
    sourceProviderSlug: record.sourceProviderSlug,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    startedAt: record.startedAt,
  };
}

function buildHostedDeviceConnectIntentUrl(input: {
  claim: string;
  connectSourceId: string;
  provider: ConfiguredDeviceSyncProviderKey;
  request: Request;
}): string {
  const baseUrl = resolveHostedPublicBaseUrl() ?? new URL(input.request.url).origin;
  const url = new URL("/connect", `${baseUrl}/`);
  const fragment = new URLSearchParams();
  fragment.set("deviceConnectIntent", input.claim);
  fragment.set("connectSource", input.connectSourceId);
  fragment.set("connectProvider", input.provider);
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

function hashHostedDeviceConnectIntentClaim(claim: string): string {
  return createHash("sha256").update(claim).digest("hex");
}

function requireConfiguredDeviceSyncProviderKey(value: string): ConfiguredDeviceSyncProviderKey {
  for (const key of configuredDeviceSyncProviderKeys) {
    if (key === value) {
      return key;
    }
  }

  throw new TypeError("Stored device connect intent provider is not supported.");
}
