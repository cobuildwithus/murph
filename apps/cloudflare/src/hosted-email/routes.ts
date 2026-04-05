/**
 * Owns hosted email address/token routing and the encrypted route records stored
 * in R2. New outbound mail now uses one stable per-user reply alias, direct mail
 * to the fixed public sender address can resolve through a synced verified-owner
 * index, and the routing layer hard-cuts over to stable user aliases plus
 * hash-only verified-owner records. Stable user aliases and verified-owner
 * records only rewrite R2 when ownership actually changes.
 */

import {
  normalizeHostedEmailAddress,
  resolveHostedEmailDirectSenderLookupAddress,
  type HostedEmailThreadTarget,
} from "@murphai/runtime-state";

import type { R2BucketLike } from "../bundle-store.ts";
import {
  buildHostedStorageAad,
  deriveHostedStorageOpaqueId,
} from "../crypto-context.js";
import {
  readEncryptedR2Json,
  writeEncryptedR2Json,
} from "../crypto.ts";
import { listHostedStorageObjectKeys } from "../storage-paths.js";
import type { HostedEmailConfig } from "./config.ts";

interface HostedEmailUserRouteRecord {
  aliasKey: string;
  identityId: string;
  schema: "murph.hosted-email-user-route.v1";
  updatedAt: string;
  userId: string;
}

interface HostedEmailVerifiedSenderRouteRecord {
  identityId: string;
  schema: "murph.hosted-email-verified-sender-route.v2";
  senderHash: string;
  senderKey: string;
  updatedAt: string;
  userId: string;
}

export interface HostedEmailInboundRoute {
  identityId: string;
  kind: "thread" | "user";
  routeAddress: string;
  target: HostedEmailThreadTarget | null;
  userId: string;
}

interface HostedEmailRouteStoreInput {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
}

const HOSTED_EMAIL_USER_ROUTE_SCHEMA = "murph.hosted-email-user-route.v1";
const HOSTED_EMAIL_VERIFIED_SENDER_ROUTE_SCHEMA = "murph.hosted-email-verified-sender-route.v2";

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
    key: aliasKey,
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

  const record = await store.readUserRoute(token.key);
  if (!record) {
    return null;
  }

  return {
    identityId: resolveHostedEmailRouteIdentity(record.identityId, input.config),
    kind: "user",
    routeAddress: candidate.address,
    target: null,
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
  if (!routeState.record || !routeState.matchesSenderAddress) {
    return null;
  }

  return {
    identityId: publicSenderAddress,
    kind: "user",
    routeAddress: publicSenderAddress,
    target: null,
    userId: routeState.record.userId,
  };
}

export function isHostedEmailPublicSenderAddress(
  address: string | null | undefined,
  config: HostedEmailConfig,
): boolean {
  const publicSenderAddress = normalizeHostedEmailAddress(config.fromAddress);
  const normalizedAddress = normalizeHostedEmailAddress(address);

  return publicSenderAddress !== null && normalizedAddress === publicSenderAddress;
}

function createHostedEmailRouteStore(input: HostedEmailRouteStoreInput) {
  return {
    async readUserRoute(aliasKey: string): Promise<HostedEmailUserRouteRecord | null> {
      for (const key of await hostedEmailUserRouteObjectKeys(input.key, input.keysById, aliasKey)) {
        const value = await readEncryptedR2Json({
          aad: buildHostedStorageAad({
            aliasKey,
            key,
            purpose: "email-route",
            routeKind: "user",
          }),
          bucket: input.bucket,
          cryptoKey: input.key,
          cryptoKeysById: input.keysById,
          expectedKeyId: input.keyId,
          key,
          parse(value) {
            return parseHostedEmailUserRouteRecord(value);
          },
          scope: "email-route",
        });

        if (value) {
          return value;
        }
      }

      return null;
    },
    async readVerifiedSenderRoute(senderKey: string): Promise<HostedEmailVerifiedSenderRouteRecord | null> {
      for (const key of await hostedEmailVerifiedSenderRouteObjectKeys(input.key, input.keysById, senderKey)) {
        try {
          const value = await readEncryptedR2Json({
            aad: buildHostedStorageAad({
              key,
              purpose: "email-route",
              routeKind: "verified-sender",
              senderKey,
            }),
            bucket: input.bucket,
            cryptoKey: input.key,
            cryptoKeysById: input.keysById,
            expectedKeyId: input.keyId,
            key,
            parse(value) {
              return parseHostedEmailVerifiedSenderRouteRecord(value);
            },
            scope: "email-route",
          });

          if (value) {
            return value;
          }
        } catch (error) {
          if (!(error instanceof TypeError)) {
            throw error;
          }
        }
      }

      return null;
    },
    async deleteVerifiedSenderRoute(senderKey: string): Promise<void> {
      for (const key of await hostedEmailVerifiedSenderRouteObjectKeys(input.key, input.keysById, senderKey)) {
        await input.bucket.delete?.(key);
      }
    },
    async writeUserRoute(writeInput: {
      aliasKey: string;
      identityId: string;
      userId: string;
    }): Promise<void> {
      const key = await hostedEmailUserRouteObjectKey(input.key, writeInput.aliasKey);
      await writeEncryptedR2Json({
        aad: buildHostedStorageAad({
          aliasKey: writeInput.aliasKey,
          key,
          purpose: "email-route",
          routeKind: "user",
        }),
        bucket: input.bucket,
        cryptoKey: input.key,
        key,
        keyId: input.keyId,
        scope: "email-route",
        value: {
          aliasKey: writeInput.aliasKey,
          identityId: writeInput.identityId,
          schema: HOSTED_EMAIL_USER_ROUTE_SCHEMA,
          updatedAt: new Date().toISOString(),
          userId: writeInput.userId,
        } satisfies HostedEmailUserRouteRecord,
      });
    },
    async writeVerifiedSenderRoute(writeInput: {
      identityId: string;
      senderHash: string;
      senderKey: string;
      userId: string;
    }): Promise<void> {
      const key = await hostedEmailVerifiedSenderRouteObjectKey(input.key, writeInput.senderKey);
      await writeEncryptedR2Json({
        aad: buildHostedStorageAad({
          key,
          purpose: "email-route",
          routeKind: "verified-sender",
          senderKey: writeInput.senderKey,
        }),
        bucket: input.bucket,
        cryptoKey: input.key,
        key,
        keyId: input.keyId,
        scope: "email-route",
        value: {
          identityId: writeInput.identityId,
          schema: HOSTED_EMAIL_VERIFIED_SENDER_ROUTE_SCHEMA,
          senderHash: writeInput.senderHash,
          senderKey: writeInput.senderKey,
          updatedAt: new Date().toISOString(),
          userId: writeInput.userId,
        } satisfies HostedEmailVerifiedSenderRouteRecord,
      });
    },
  };
}

async function createHostedEmailRouteToken(input: {
  key: string;
  secret: string;
}): Promise<string> {
  const signature = await createHostedEmailRouteSignature({
    payload: `u:${input.key}`,
    secret: input.secret,
  });
  return `u-${input.key}-${signature}`;
}

function resolveHostedEmailRouteIdentity(
  fallbackIdentityId: string,
  config: HostedEmailConfig,
): string {
  return normalizeHostedEmailAddress(config.fromAddress) ?? fallbackIdentityId;
}

function parseHostedEmailRouteCandidate(
  value: string | null | undefined,
  config: HostedEmailConfig,
): { address: string; detail: string } | null {
  const detailFromAddress = parseHostedEmailAddressDetail(value ?? "", config);
  if (detailFromAddress) {
    const normalizedAddress = normalizeHostedEmailAddress(value);

    if (!normalizedAddress) {
      return null;
    }

    return {
      address: normalizedAddress,
      detail: detailFromAddress,
    };
  }

  const normalized = value?.trim() ?? "";
  if (!normalized) {
    return null;
  }

  if (!/^[A-Za-z0-9-]+$/u.test(normalized)) {
    return null;
  }

  return {
    address: formatHostedEmailAddress(config, normalized),
    detail: normalized,
  };
}

async function parseHostedEmailRouteToken(input: {
  secret: string;
  token: string;
}): Promise<{ key: string } | null> {
  const match = /^(?<scope>[tu])-(?<key>[A-Za-z0-9]+)-(?<signature>[0-9a-f]+)$/u.exec(
    input.token.trim(),
  );
  if (!match?.groups || match.groups.scope !== "u") {
    return null;
  }

  const payload = `u:${match.groups.key}`;
  const expected = await createHostedEmailRouteSignature({
    payload,
    secret: input.secret,
  });
  if (expected !== match.groups.signature.toLowerCase()) {
    return null;
  }

  return {
    key: match.groups.key,
  };
}

async function deriveStableHostedEmailKey(secret: string, payload: string): Promise<string> {
  return (await createHostedEmailRouteSignature({ payload, secret })).slice(0, 16);
}

async function deriveHostedEmailVerifiedSenderKey(secret: string, verifiedEmailAddress: string): Promise<string> {
  return deriveStableHostedEmailKey(secret, `verified-sender:${verifiedEmailAddress}`);
}

async function deriveHostedEmailVerifiedSenderHash(
  secret: string,
  verifiedEmailAddress: string,
): Promise<string> {
  return createHostedEmailRouteHash({
    payload: `verified-owner:${verifiedEmailAddress}`,
    secret,
  });
}

async function deleteHostedEmailVerifiedSenderRoute(input: {
  secret: string;
  store: ReturnType<typeof createHostedEmailRouteStore>;
  userId: string;
  verifiedEmailAddress: string;
}): Promise<void> {
  const routeState = await readHostedEmailVerifiedSenderRouteState({
    secret: input.secret,
    senderAddress: input.verifiedEmailAddress,
    store: input.store,
  });
  if (!routeState.record || routeState.record.userId !== input.userId || !routeState.matchesSenderAddress) {
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
  matchesSenderAddress: boolean;
  record: HostedEmailVerifiedSenderRouteRecord | null;
  senderKey: string;
}

async function readHostedEmailVerifiedSenderRouteState(input: {
  secret: string;
  senderAddress: string;
  store: ReturnType<typeof createHostedEmailRouteStore>;
}): Promise<HostedEmailVerifiedSenderRouteState> {
  const senderKey = await deriveHostedEmailVerifiedSenderKey(input.secret, input.senderAddress);
  const record = await input.store.readVerifiedSenderRoute(senderKey);

  return {
    matchesSenderAddress: record
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
  if (routeState.record && !routeState.matchesSenderAddress) {
    throw new Error("Hosted verified email sender route is already assigned to a different sender hash.");
  }

  if (routeState.record && routeState.record.userId !== userId) {
    throw new Error("Hosted verified email sender route is already assigned to a different user.");
  }
}

async function createHostedEmailRouteHash(input: {
  payload: string;
  secret: string;
}): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(input.secret),
    {
      hash: "SHA-256",
      name: "HMAC",
    },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(input.payload)),
  );
  return [...signature]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function createHostedEmailRouteSignature(input: {
  payload: string;
  secret: string;
}): Promise<string> {
  return (await createHostedEmailRouteHash(input)).slice(0, 32);
}

function parseHostedEmailAddressDetail(address: string, config: HostedEmailConfig): string | null {
  const normalized = normalizeHostedEmailAddress(address);
  if (!normalized || !config.domain) {
    return null;
  }

  const expectedSuffix = `@${config.domain}`;
  if (!normalized.endsWith(expectedSuffix)) {
    return null;
  }

  const localPart = normalized.slice(0, -expectedSuffix.length);
  const prefix = `${config.localPart}+`;
  if (!localPart.startsWith(prefix)) {
    return null;
  }

  const detail = localPart.slice(prefix.length).trim();
  return detail.length > 0 ? detail : null;
}

function formatHostedEmailAddress(config: HostedEmailConfig, detail: string): string {
  if (!config.domain) {
    throw new Error("Hosted email domain is not configured.");
  }

  return `${config.localPart}+${detail}@${config.domain}`;
}

async function hostedEmailUserRouteObjectKey(rootKey: Uint8Array, aliasKey: string): Promise<string> {
  const routeSegment = await deriveHostedStorageOpaqueId({
    length: 40,
    rootKey,
    scope: "email-route",
    value: `user:${aliasKey}`,
  });

  return `hosted-email/users/${routeSegment}.json`;
}

async function hostedEmailVerifiedSenderRouteObjectKey(
  rootKey: Uint8Array,
  senderKey: string,
): Promise<string> {
  const routeSegment = await deriveHostedStorageOpaqueId({
    length: 40,
    rootKey,
    scope: "email-route",
    value: `verified-sender:${senderKey}`,
  });

  return `hosted-email/verified-senders/${routeSegment}.json`;
}

async function hostedEmailUserRouteObjectKeys(
  rootKey: Uint8Array,
  keysById: Readonly<Record<string, Uint8Array>> | undefined,
  aliasKey: string,
): Promise<string[]> {
  return listHostedStorageObjectKeys(rootKey, keysById, (candidateRootKey) =>
    hostedEmailUserRouteObjectKey(candidateRootKey, aliasKey)
  );
}

async function hostedEmailVerifiedSenderRouteObjectKeys(
  rootKey: Uint8Array,
  keysById: Readonly<Record<string, Uint8Array>> | undefined,
  senderKey: string,
): Promise<string[]> {
  return listHostedStorageObjectKeys(rootKey, keysById, (candidateRootKey) =>
    hostedEmailVerifiedSenderRouteObjectKey(candidateRootKey, senderKey)
  );
}

function parseHostedEmailUserRouteRecord(value: unknown): HostedEmailUserRouteRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted email user route must be an object.");
  }

  const record = value as Partial<HostedEmailUserRouteRecord>;
  if (record.schema !== HOSTED_EMAIL_USER_ROUTE_SCHEMA) {
    throw new TypeError("Hosted email user route schema is invalid.");
  }

  return {
    aliasKey: requireHostedEmailRecordString(record.aliasKey, "Hosted email user route aliasKey"),
    identityId: requireHostedEmailRecordString(record.identityId, "Hosted email user route identityId"),
    schema: HOSTED_EMAIL_USER_ROUTE_SCHEMA,
    updatedAt: requireHostedEmailRecordString(record.updatedAt, "Hosted email user route updatedAt"),
    userId: requireHostedEmailRecordString(record.userId, "Hosted email user route userId"),
  };
}

function parseHostedEmailVerifiedSenderRouteRecord(value: unknown): HostedEmailVerifiedSenderRouteRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted email verified sender route must be an object.");
  }

  const record = value as Partial<HostedEmailVerifiedSenderRouteRecord>;
  if (record.schema !== HOSTED_EMAIL_VERIFIED_SENDER_ROUTE_SCHEMA) {
    throw new TypeError("Hosted email verified sender route schema is invalid.");
  }

  return {
    identityId: requireHostedEmailRecordString(
      record.identityId,
      "Hosted email verified sender route identityId",
    ),
    senderKey: requireHostedEmailRecordString(
      record.senderKey,
      "Hosted email verified sender route senderKey",
    ),
    updatedAt: requireHostedEmailRecordString(
      record.updatedAt,
      "Hosted email verified sender route updatedAt",
    ),
    userId: requireHostedEmailRecordString(
      record.userId,
      "Hosted email verified sender route userId",
    ),
    schema: HOSTED_EMAIL_VERIFIED_SENDER_ROUTE_SCHEMA,
    senderHash: requireHostedEmailRecordString(
      record.senderHash,
      "Hosted email verified sender route senderHash",
    ),
  };
}

function requireHostedEmailRecordString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}
