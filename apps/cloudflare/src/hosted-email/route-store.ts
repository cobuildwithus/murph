/**
 * Hosted email route storage owns the encrypted R2 record layout for reply
 * aliases only. Public-sender authority is no longer a Cloudflare-owned seam.
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
  identityId: string;
  schema: "murph.hosted-email-user-route.v1";
  userId: string;
}

export interface HostedEmailRouteStore {
  readUserRoute(aliasKey: string): Promise<HostedEmailUserRouteRecord | null>;
  writeUserRoute(input: {
    aliasKey: string;
    identityId: string;
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
          identityId: writeInput.identityId,
          schema: HOSTED_EMAIL_USER_ROUTE_SCHEMA,
          userId: writeInput.userId,
        } satisfies HostedEmailUserRouteRecord,
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

function parseHostedEmailUserRouteRecord(value: unknown): HostedEmailUserRouteRecord {
  const record = requireHostedEmailRouteRecordObject(value, "Hosted email user route");
  if (record.schema !== HOSTED_EMAIL_USER_ROUTE_SCHEMA) {
    throw new TypeError("Hosted email user route schema is invalid.");
  }

  return {
    identityId: requireHostedEmailRecordString(record.identityId, "Hosted email user route identityId"),
    schema: HOSTED_EMAIL_USER_ROUTE_SCHEMA,
    userId: requireHostedEmailRecordString(record.userId, "Hosted email user route userId"),
  };
}

function requireHostedEmailRouteRecordObject(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function requireHostedEmailRecordString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}
