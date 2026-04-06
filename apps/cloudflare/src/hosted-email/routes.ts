/**
 * Hosted email routing now keeps orchestration plus verified-sender ownership
 * rules in one place, while encrypted R2 persistence, address formatting, and
 * HMAC token helpers live in dedicated modules.
 */

import {
  normalizeHostedEmailAddress,
  resolveHostedEmailDirectSenderLookupAddress,
} from "@murphai/runtime-state";

import type { R2BucketLike } from "../bundle-store.ts";
import type { HostedEmailConfig } from "./config.ts";
import {
  formatHostedEmailAddress,
  parseHostedEmailRouteCandidate,
  resolveHostedEmailRouteIdentity,
  isHostedEmailPublicSenderAddress,
} from "./route-addressing.ts";
import {
  createHostedEmailRouteToken,
  deriveHostedEmailVerifiedSenderHash,
  deriveHostedEmailVerifiedSenderKey,
  deriveStableHostedEmailKey,
  parseHostedEmailRouteToken,
} from "./route-crypto.ts";
import {
  createHostedEmailRouteStore,
  type HostedEmailRouteStore,
  type HostedEmailVerifiedSenderRouteRecord,
} from "./route-store.ts";

export { isHostedEmailPublicSenderAddress } from "./route-addressing.ts";

export interface HostedEmailInboundRoute {
  identityId: string;
  routeAddress: string;
  userId: string;
}

export async function resolveHostedEmailIngressRoute(input: {
  bucket: R2BucketLike;
  config: HostedEmailConfig;
  envelopeFrom?: string | null;
  hasRepeatedHeaderFrom?: boolean;
  headerFrom?: string | null;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
  to: string;
}): Promise<HostedEmailInboundRoute | null> {
  if (isHostedEmailPublicSenderAddress(input.to, input.config)) {
    return resolveHostedEmailDirectSenderRoute({
      bucket: input.bucket,
      config: input.config,
      envelopeFrom: input.envelopeFrom,
      hasRepeatedHeaderFrom: input.hasRepeatedHeaderFrom,
      headerFrom: input.headerFrom,
      key: input.key,
      keyId: input.keyId,
      keysById: input.keysById,
    });
  }

  return resolveHostedEmailInboundRoute({
    bucket: input.bucket,
    config: input.config,
    key: input.key,
    keyId: input.keyId,
    keysById: input.keysById,
    to: input.to,
  });
}

export async function ensureHostedEmailVerifiedSenderRouteAvailable(input: {
  bucket: R2BucketLike;
  config: HostedEmailConfig;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
  userId: string;
  verifiedEmailAddress?: string | null;
}): Promise<void> {
  const verifiedEmailAddress = normalizeHostedEmailAddress(input.verifiedEmailAddress);
  if (
    !normalizeHostedEmailAddress(input.config.fromAddress)
    || !verifiedEmailAddress
    || !input.config.signingSecret
  ) {
    return;
  }

  const store = createHostedEmailRouteStore({
    bucket: input.bucket,
    key: input.key,
    keyId: input.keyId,
    keysById: input.keysById,
  });
  const routeState = await readHostedEmailVerifiedSenderRouteState({
    secret: input.config.signingSecret,
    senderAddress: verifiedEmailAddress,
    store,
  });
  assertHostedEmailVerifiedSenderRouteAssignable(routeState, input.userId);
}

export async function reconcileHostedEmailVerifiedSenderRoute(input: {
  bucket: R2BucketLike;
  config: HostedEmailConfig;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
  nextVerifiedEmailAddress?: string | null;
  previousVerifiedEmailAddress?: string | null;
  userId: string;
}): Promise<void> {
  const publicSenderAddress = normalizeHostedEmailAddress(input.config.fromAddress);
  if (!publicSenderAddress || !input.config.signingSecret) {
    return;
  }

  const previousVerifiedEmailAddress = normalizeHostedEmailAddress(input.previousVerifiedEmailAddress);
  const nextVerifiedEmailAddress = normalizeHostedEmailAddress(input.nextVerifiedEmailAddress);
  const store = createHostedEmailRouteStore({
    bucket: input.bucket,
    key: input.key,
    keyId: input.keyId,
    keysById: input.keysById,
  });

  const shouldMovePreviousRoute = Boolean(
    previousVerifiedEmailAddress && previousVerifiedEmailAddress !== nextVerifiedEmailAddress,
  );

  if (!nextVerifiedEmailAddress) {
    if (shouldMovePreviousRoute) {
      await deleteHostedEmailVerifiedSenderRoute({
        secret: input.config.signingSecret,
        store,
        userId: input.userId,
        verifiedEmailAddress: previousVerifiedEmailAddress!,
      });
    }
    return;
  }

  const routeState = await readHostedEmailVerifiedSenderRouteState({
    secret: input.config.signingSecret,
    senderAddress: nextVerifiedEmailAddress,
    store,
  });
  assertHostedEmailVerifiedSenderRouteAssignable(routeState, input.userId);
  if (!routeState.record) {
    await store.writeVerifiedSenderRoute({
      identityId: publicSenderAddress,
      senderHash: await deriveHostedEmailVerifiedSenderHash(
        input.config.signingSecret,
        nextVerifiedEmailAddress,
      ),
      senderKey: routeState.senderKey,
      userId: input.userId,
    });
  }

  if (shouldMovePreviousRoute) {
    await deleteHostedEmailVerifiedSenderRoute({
      secret: input.config.signingSecret,
      store,
      userId: input.userId,
      verifiedEmailAddress: previousVerifiedEmailAddress!,
    });
  }
}

export async function createHostedEmailUserAddress(input: {
  bucket: R2BucketLike;
  config: HostedEmailConfig;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
  userId: string;
}): Promise<string> {
  if (!input.config.domain || !input.config.signingSecret || !input.config.fromAddress) {
    throw new Error("Hosted email addressing is not configured.");
  }

  const aliasKey = await deriveStableHostedEmailKey(input.config.signingSecret, `user:${input.userId}`);
  const store = createHostedEmailRouteStore({
    bucket: input.bucket,
    key: input.key,
    keyId: input.keyId,
    keysById: input.keysById,
  });
  const existing = await store.readUserRoute(aliasKey);
  if (existing && existing.userId !== input.userId) {
    throw new Error("Hosted email user route is already assigned to a different user.");
  }
  if (!existing) {
    await store.writeUserRoute({
      aliasKey,
      identityId: input.config.fromAddress,
      userId: input.userId,
    });
  }

  return formatHostedEmailAddress(input.config, await createHostedEmailRouteToken({
    aliasKey,
    secret: input.config.signingSecret,
  }));
}

export async function resolveHostedEmailInboundRoute(input: {
  bucket: R2BucketLike;
  config: HostedEmailConfig;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
  to: string;
}): Promise<HostedEmailInboundRoute | null> {
  if (!input.config.domain || !input.config.signingSecret) {
    return null;
  }

  const store = createHostedEmailRouteStore({
    bucket: input.bucket,
    key: input.key,
    keyId: input.keyId,
    keysById: input.keysById,
  });

  const candidate = parseHostedEmailRouteCandidate(input.to, input.config);
  if (!candidate) {
    return null;
  }

  const token = await parseHostedEmailRouteToken({
    secret: input.config.signingSecret,
    token: candidate.detail,
  });
  if (!token) {
    return null;
  }

  const record = await store.readUserRoute(token.aliasKey);
  if (!record) {
    return null;
  }

  return {
    identityId: resolveHostedEmailRouteIdentity(record.identityId, input.config),
    routeAddress: candidate.address,
    userId: record.userId,
  };
}

async function resolveHostedEmailDirectSenderRoute(input: {
  bucket: R2BucketLike;
  config: HostedEmailConfig;
  envelopeFrom?: string | null;
  hasRepeatedHeaderFrom?: boolean;
  headerFrom?: string | null;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
}): Promise<HostedEmailInboundRoute | null> {
  const publicSenderAddress = normalizeHostedEmailAddress(input.config.fromAddress);
  if (!publicSenderAddress || !input.config.signingSecret) {
    return null;
  }

  const senderAddress = resolveHostedEmailDirectSenderLookupAddress({
    envelopeFrom: input.envelopeFrom,
    hasRepeatedHeaderFrom: input.hasRepeatedHeaderFrom,
    headerFrom: input.headerFrom,
  });
  if (!senderAddress) {
    return null;
  }

  const store = createHostedEmailRouteStore({
    bucket: input.bucket,
    key: input.key,
    keyId: input.keyId,
    keysById: input.keysById,
  });
  const routeState = await readHostedEmailVerifiedSenderRouteState({
    secret: input.config.signingSecret,
    senderAddress,
    store,
  });
  if (!routeState.record || !routeState.matchesSenderHash) {
    return null;
  }

  return {
    identityId: publicSenderAddress,
    routeAddress: publicSenderAddress,
    userId: routeState.record.userId,
  };
}

async function deleteHostedEmailVerifiedSenderRoute(input: {
  secret: string;
  store: HostedEmailRouteStore;
  userId: string;
  verifiedEmailAddress: string;
}): Promise<void> {
  const routeState = await readHostedEmailVerifiedSenderRouteState({
    secret: input.secret,
    senderAddress: input.verifiedEmailAddress,
    store: input.store,
  });
  if (!routeState.record || routeState.record.userId !== input.userId || !routeState.matchesSenderHash) {
    return;
  }

  await input.store.deleteVerifiedSenderRoute(routeState.senderKey);
}

async function matchesHostedEmailVerifiedSenderRoute(input: {
  record: HostedEmailVerifiedSenderRouteRecord;
  secret: string;
  senderAddress: string;
}): Promise<boolean> {
  return input.record.senderHash === await deriveHostedEmailVerifiedSenderHash(
    input.secret,
    input.senderAddress,
  );
}

interface HostedEmailVerifiedSenderRouteState {
  matchesSenderHash: boolean;
  record: HostedEmailVerifiedSenderRouteRecord | null;
  senderKey: string;
}

async function readHostedEmailVerifiedSenderRouteState(input: {
  secret: string;
  senderAddress: string;
  store: HostedEmailRouteStore;
}): Promise<HostedEmailVerifiedSenderRouteState> {
  const senderKey = await deriveHostedEmailVerifiedSenderKey(input.secret, input.senderAddress);
  const record = await input.store.readVerifiedSenderRoute(senderKey);

  return {
    matchesSenderHash: record
      ? await matchesHostedEmailVerifiedSenderRoute({
          record,
          secret: input.secret,
          senderAddress: input.senderAddress,
        })
      : false,
    record,
    senderKey,
  };
}

function assertHostedEmailVerifiedSenderRouteAssignable(
  routeState: HostedEmailVerifiedSenderRouteState,
  userId: string,
): void {
  if (routeState.record && !routeState.matchesSenderHash) {
    throw new Error("Hosted verified email sender route is already assigned to a different sender hash.");
  }

  if (routeState.record && routeState.record.userId !== userId) {
    throw new Error("Hosted verified email sender route is already assigned to a different user.");
  }
}
