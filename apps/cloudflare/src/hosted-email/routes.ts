/**
 * Owns hosted email address/token routing and the encrypted route records stored
 * in R2. Keeping this separate from transport code makes inbound addressing and
 * route persistence easier to audit without paging through MIME assembly logic.
 */

import {
  normalizeHostedEmailAddress,
  parseHostedEmailThreadTarget,
  serializeHostedEmailThreadTarget,
  type HostedEmailThreadTarget,
} from "@murphai/runtime-state";

import type { R2BucketLike } from "../bundle-store.ts";
import {
  readEncryptedR2Json,
  writeEncryptedR2Json,
} from "../crypto.ts";
import type { HostedEmailConfig } from "./config.ts";

interface HostedEmailUserRouteRecord {
  aliasKey: string;
  identityId: string;
  schema: "murph.hosted-email-user-route.v1";
  updatedAt: string;
  userId: string;
}

interface HostedEmailThreadRouteRecord {
  identityId: string;
  replyKey: string;
  schema: "murph.hosted-email-thread-route.v1";
  target: HostedEmailThreadTarget;
  updatedAt: string;
  userId: string;
}

export interface HostedEmailInboundRoute {
  identityId: string;
  kind: "thread" | "user";
  target: HostedEmailThreadTarget | null;
  userId: string;
}

interface HostedEmailRouteStoreInput {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
}

const HOSTED_EMAIL_THREAD_ROUTE_SCHEMA = "murph.hosted-email-thread-route.v1";
const HOSTED_EMAIL_USER_ROUTE_SCHEMA = "murph.hosted-email-user-route.v1";

export async function createHostedEmailUserAddress(input: {
  bucket: R2BucketLike;
  config: HostedEmailConfig;
  key: Uint8Array;
  keyId: string;
  userId: string;
}): Promise<string> {
  if (!input.config.domain || !input.config.signingSecret || !input.config.fromAddress) {
    throw new Error("Hosted email addressing is not configured.");
  }

  const aliasKey = await deriveStableHostedEmailKey(input.config.signingSecret, `user:${input.userId}`);
  await createHostedEmailRouteStore({
    bucket: input.bucket,
    key: input.key,
    keyId: input.keyId,
  }).writeUserRoute({
    aliasKey,
    identityId: input.config.fromAddress,
    userId: input.userId,
  });

  return formatHostedEmailAddress(input.config, await createHostedEmailRouteToken({
    key: aliasKey,
    scope: "user",
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

  const detail = parseHostedEmailAddressDetail(input.to, input.config);
  if (!detail) {
    return null;
  }

  const token = await parseHostedEmailRouteToken({
    secret: input.config.signingSecret,
    token: detail,
  });
  if (!token) {
    return null;
  }

  const store = createHostedEmailRouteStore({
    bucket: input.bucket,
    key: input.key,
    keyId: input.keyId,
    keysById: input.keysById,
  });

  if (token.scope === "user") {
    const record = await store.readUserRoute(token.key);
    if (!record) {
      return null;
    }

    return {
      identityId: record.identityId,
      kind: "user",
      target: null,
      userId: record.userId,
    };
  }

  const record = await store.readThreadRoute(token.key);
  if (!record) {
    return null;
  }

  return {
    identityId: record.identityId,
    kind: "thread",
    target: record.target,
    userId: record.userId,
  };
}

export async function writeHostedEmailThreadRoute(input: {
  bucket: R2BucketLike;
  identityId: string;
  key: Uint8Array;
  keyId: string;
  replyKey: string;
  target: HostedEmailThreadTarget;
  userId: string;
}): Promise<void> {
  await createHostedEmailRouteStore({
    bucket: input.bucket,
    key: input.key,
    keyId: input.keyId,
  }).writeThreadRoute({
    identityId: input.identityId,
    replyKey: input.replyKey,
    target: input.target,
    userId: input.userId,
  });
}

export async function createHostedEmailThreadAddress(input: {
  config: HostedEmailConfig;
  replyKey: string;
}): Promise<string> {
  if (!input.config.signingSecret) {
    throw new Error("Hosted email signing secret is not configured.");
  }

  return formatHostedEmailAddress(
    input.config,
    await createHostedEmailRouteToken({
      key: input.replyKey,
      scope: "thread",
      secret: input.config.signingSecret,
    }),
  );
}

function createHostedEmailRouteStore(input: HostedEmailRouteStoreInput) {
  return {
    async readThreadRoute(replyKey: string): Promise<HostedEmailThreadRouteRecord | null> {
      return readEncryptedR2Json({
        bucket: input.bucket,
        cryptoKey: input.key,
        cryptoKeysById: input.keysById,
        expectedKeyId: input.keyId,
        key: hostedEmailThreadRouteObjectKey(replyKey),
        parse(value) {
          return parseHostedEmailThreadRouteRecord(value);
        },
      });
    },
    async readUserRoute(aliasKey: string): Promise<HostedEmailUserRouteRecord | null> {
      return readEncryptedR2Json({
        bucket: input.bucket,
        cryptoKey: input.key,
        cryptoKeysById: input.keysById,
        expectedKeyId: input.keyId,
        key: hostedEmailUserRouteObjectKey(aliasKey),
        parse(value) {
          return parseHostedEmailUserRouteRecord(value);
        },
      });
    },
    async writeThreadRoute(writeInput: {
      identityId: string;
      replyKey: string;
      target: HostedEmailThreadTarget;
      userId: string;
    }): Promise<void> {
      await writeEncryptedR2Json({
        bucket: input.bucket,
        cryptoKey: input.key,
        key: hostedEmailThreadRouteObjectKey(writeInput.replyKey),
        keyId: input.keyId,
        value: {
          identityId: writeInput.identityId,
          replyKey: writeInput.replyKey,
          schema: HOSTED_EMAIL_THREAD_ROUTE_SCHEMA,
          target: writeInput.target,
          updatedAt: new Date().toISOString(),
          userId: writeInput.userId,
        } satisfies HostedEmailThreadRouteRecord,
      });
    },
    async writeUserRoute(writeInput: {
      aliasKey: string;
      identityId: string;
      userId: string;
    }): Promise<void> {
      await writeEncryptedR2Json({
        bucket: input.bucket,
        cryptoKey: input.key,
        key: hostedEmailUserRouteObjectKey(writeInput.aliasKey),
        keyId: input.keyId,
        value: {
          aliasKey: writeInput.aliasKey,
          identityId: writeInput.identityId,
          schema: HOSTED_EMAIL_USER_ROUTE_SCHEMA,
          updatedAt: new Date().toISOString(),
          userId: writeInput.userId,
        } satisfies HostedEmailUserRouteRecord,
      });
    },
  };
}

async function createHostedEmailRouteToken(input: {
  key: string;
  scope: "thread" | "user";
  secret: string;
}): Promise<string> {
  const scopeCode = input.scope === "thread" ? "t" : "u";
  const signature = await createHostedEmailRouteSignature({
    payload: `${scopeCode}:${input.key}`,
    secret: input.secret,
  });
  return `${scopeCode}-${input.key}-${signature}`;
}

async function parseHostedEmailRouteToken(input: {
  secret: string;
  token: string;
}): Promise<{ key: string; scope: "thread" | "user" } | null> {
  const match = /^(?<scope>[tu])-(?<key>[A-Za-z0-9]+)-(?<signature>[0-9a-f]+)$/u.exec(
    input.token.trim(),
  );
  if (!match?.groups) {
    return null;
  }

  const scope = match.groups.scope === "t" ? "thread" : "user";
  const payload = `${match.groups.scope}:${match.groups.key}`;
  const expected = await createHostedEmailRouteSignature({
    payload,
    secret: input.secret,
  });
  if (expected !== match.groups.signature.toLowerCase()) {
    return null;
  }

  return {
    key: match.groups.key,
    scope,
  };
}

async function deriveStableHostedEmailKey(secret: string, payload: string): Promise<string> {
  return (await createHostedEmailRouteSignature({ payload, secret })).slice(0, 16);
}

async function createHostedEmailRouteSignature(input: {
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
  return [...signature.slice(0, 16)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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

function hostedEmailThreadRouteObjectKey(replyKey: string): string {
  return `transient/hosted-email/threads/${replyKey}.json`;
}

function hostedEmailUserRouteObjectKey(aliasKey: string): string {
  return `transient/hosted-email/users/${aliasKey}.json`;
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

function parseHostedEmailThreadRouteRecord(value: unknown): HostedEmailThreadRouteRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted email thread route must be an object.");
  }

  const record = value as Partial<HostedEmailThreadRouteRecord>;
  if (record.schema !== HOSTED_EMAIL_THREAD_ROUTE_SCHEMA) {
    throw new TypeError("Hosted email thread route schema is invalid.");
  }

  if (!record.target || typeof record.target !== "object" || Array.isArray(record.target)) {
    throw new TypeError("Hosted email thread route target must be an object.");
  }

  const target = parseHostedEmailThreadTarget(serializeHostedEmailThreadTarget(record.target));
  if (!target) {
    throw new TypeError("Hosted email thread route target is invalid.");
  }

  return {
    identityId: requireHostedEmailRecordString(record.identityId, "Hosted email thread route identityId"),
    replyKey: requireHostedEmailRecordString(record.replyKey, "Hosted email thread route replyKey"),
    schema: HOSTED_EMAIL_THREAD_ROUTE_SCHEMA,
    target,
    updatedAt: requireHostedEmailRecordString(record.updatedAt, "Hosted email thread route updatedAt"),
    userId: requireHostedEmailRecordString(record.userId, "Hosted email thread route userId"),
  };
}

function requireHostedEmailRecordString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}
