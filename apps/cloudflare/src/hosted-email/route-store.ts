/**
 * Hosted email route storage owns the encrypted R2 record layout for stable
 * per-user aliases and verified-sender indexes. Routing orchestration can use
 * this store without also carrying record codecs or object-key derivation.
 */

import type { R2BucketLike } from "../bundle-store.ts";
import {
  buildHostedStorageAad,
  deriveHostedStorageOpaqueId,
} from "../crypto-context.js";
import {
  readEncryptedR2Json,
  writeEncryptedR2Json,
} from "../crypto.ts";

export interface HostedEmailUserRouteRecord {
  aliasKey: string;
  identityId: string;
  schema: "murph.hosted-email-user-route.v1";
  updatedAt: string;
  userId: string;
}

export interface HostedEmailVerifiedSenderRouteRecord {
  identityId: string;
  schema: "murph.hosted-email-verified-sender-route.v1";
  senderHash: string;
  senderKey: string;
  updatedAt: string;
  userId: string;
}

export interface HostedEmailRouteStore {
  deleteVerifiedSenderRoute(senderKey: string): Promise<void>;
  readUserRoute(aliasKey: string): Promise<HostedEmailUserRouteRecord | null>;
  readVerifiedSenderRoute(senderKey: string): Promise<HostedEmailVerifiedSenderRouteRecord | null>;
  writeUserRoute(input: {
    aliasKey: string;
    identityId: string;
    userId: string;
  }): Promise<void>;
  writeVerifiedSenderRoute(input: {
    identityId: string;
    senderHash: string;
    senderKey: string;
    userId: string;
  }): Promise<void>;
}

interface HostedEmailRouteStoreInput {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
}

const HOSTED_EMAIL_USER_ROUTE_SCHEMA = "murph.hosted-email-user-route.v1";
const HOSTED_EMAIL_VERIFIED_SENDER_ROUTE_SCHEMA = "murph.hosted-email-verified-sender-route.v1";

export function createHostedEmailRouteStore(input: HostedEmailRouteStoreInput): HostedEmailRouteStore {
  return {
    async readUserRoute(aliasKey) {
      const key = await hostedEmailUserRouteObjectKey(input.key, aliasKey);
      return readEncryptedR2Json({
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
    },

    async readVerifiedSenderRoute(senderKey) {
      const key = await hostedEmailVerifiedSenderRouteObjectKey(input.key, senderKey);
      return readEncryptedR2Json({
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
    },

    async deleteVerifiedSenderRoute(senderKey) {
      const key = await hostedEmailVerifiedSenderRouteObjectKey(input.key, senderKey);
      await input.bucket.delete?.(key);
    },

    async writeUserRoute(writeInput) {
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

    async writeVerifiedSenderRoute(writeInput) {
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
