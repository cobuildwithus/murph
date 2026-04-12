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
  cryptoKey: Uint8Array;
  cryptoKeyId: string;
  cryptoKeysById?: Readonly<Record<string, Uint8Array>>;
}

const HOSTED_EMAIL_USER_ROUTE_SCHEMA = "murph.hosted-email-user-route.v1";
const HOSTED_EMAIL_VERIFIED_SENDER_ROUTE_SCHEMA = "murph.hosted-email-verified-sender-route.v1";

export function createHostedEmailRouteStore(input: HostedEmailRouteStoreInput): HostedEmailRouteStore {
  return {
    async readUserRoute(aliasKey) {
      const objectKey = await hostedEmailUserRouteObjectKey(input.cryptoKey, aliasKey);
      return readEncryptedR2Json({
        aad: buildHostedStorageAad({
          aliasKey,
          key: objectKey,
          purpose: "email-route",
          routeKind: "user",
        }),
        bucket: input.bucket,
        cryptoKey: input.cryptoKey,
        cryptoKeysById: input.cryptoKeysById,
        expectedKeyId: input.cryptoKeyId,
        key: objectKey,
        parse(value) {
          return parseHostedEmailUserRouteRecord(value);
        },
        scope: "email-route",
      });
    },

    async readVerifiedSenderRoute(senderKey) {
      const objectKey = await hostedEmailVerifiedSenderRouteObjectKey(input.cryptoKey, senderKey);
      return readEncryptedR2Json({
        aad: buildHostedStorageAad({
          key: objectKey,
          purpose: "email-route",
          routeKind: "verified-sender",
          senderKey,
        }),
        bucket: input.bucket,
        cryptoKey: input.cryptoKey,
        cryptoKeysById: input.cryptoKeysById,
        expectedKeyId: input.cryptoKeyId,
        key: objectKey,
        parse(value) {
          return parseHostedEmailVerifiedSenderRouteRecord(value);
        },
        scope: "email-route",
      });
    },

    async deleteVerifiedSenderRoute(senderKey) {
      const objectKey = await hostedEmailVerifiedSenderRouteObjectKey(input.cryptoKey, senderKey);
      await input.bucket.delete?.(objectKey);
    },

    async writeUserRoute(writeInput) {
      const objectKey = await hostedEmailUserRouteObjectKey(input.cryptoKey, writeInput.aliasKey);
      await writeEncryptedR2Json({
        aad: buildHostedStorageAad({
          aliasKey: writeInput.aliasKey,
          key: objectKey,
          purpose: "email-route",
          routeKind: "user",
        }),
        bucket: input.bucket,
        cryptoKey: input.cryptoKey,
        key: objectKey,
        keyId: input.cryptoKeyId,
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
      const objectKey = await hostedEmailVerifiedSenderRouteObjectKey(input.cryptoKey, writeInput.senderKey);
      await writeEncryptedR2Json({
        aad: buildHostedStorageAad({
          key: objectKey,
          purpose: "email-route",
          routeKind: "verified-sender",
          senderKey: writeInput.senderKey,
        }),
        bucket: input.bucket,
        cryptoKey: input.cryptoKey,
        key: objectKey,
        keyId: input.cryptoKeyId,
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
  const record = requireHostedEmailRouteRecordObject<HostedEmailUserRouteRecord>(
    value,
    "Hosted email user route",
  );
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
  const record = requireHostedEmailRouteRecordObject<HostedEmailVerifiedSenderRouteRecord>(
    value,
    "Hosted email verified sender route",
  );
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

function requireHostedEmailRouteRecordObject<TRecord extends object>(
  value: unknown,
  label: string,
): Partial<TRecord> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Partial<TRecord>;
}

function requireHostedEmailRecordString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}
