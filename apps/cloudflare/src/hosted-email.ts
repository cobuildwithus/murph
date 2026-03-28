import {
  createHostedEmailThreadTarget,
  ensureHostedEmailReplySubject,
  normalizeHostedEmailAddress,
  normalizeHostedEmailAddressList,
  parseHostedEmailThreadTarget,
  serializeHostedEmailThreadTarget,
  type HostedEmailThreadTarget,
} from "@murph/runtime-state";
import { resolveHostedEmailSenderIdentity } from "@murph/hosted-execution";
import type { HostedEmailSendRequest } from "@murph/assistant-runtime";

import type { R2BucketLike } from "./bundle-store.ts";
import {
  readEncryptedR2Json,
  readEncryptedR2Payload,
  writeEncryptedR2Json,
  writeEncryptedR2Payload,
} from "./crypto.ts";

export interface HostedEmailConfig {
  apiBaseUrl: string;
  cloudflareAccountId: string | null;
  cloudflareApiToken: string | null;
  defaultSubject: string;
  domain: string | null;
  fromAddress: string | null;
  localPart: string;
  signingSecret: string | null;
}

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

export interface HostedEmailWorkerRequest {
  headers?: Headers;
  from: string;
  raw: ReadableStream<Uint8Array> | ArrayBuffer | Uint8Array | string;
  rawSize?: number;
  setReject?(reason: string): void;
  to: string;
}

const HOSTED_EMAIL_THREAD_ROUTE_SCHEMA = "murph.hosted-email-thread-route.v1";
const HOSTED_EMAIL_USER_ROUTE_SCHEMA = "murph.hosted-email-user-route.v1";

export function readHostedEmailConfig(
  source: Readonly<Record<string, string | undefined>> = process.env,
): HostedEmailConfig {
  const domain = normalizeHostedEmailAddressComponent(source.HOSTED_EMAIL_DOMAIN);
  const localPart = normalizeHostedEmailAddressComponent(source.HOSTED_EMAIL_LOCAL_PART) ?? "assistant";
  const fromAddress = resolveHostedEmailSenderIdentity(source);

  return {
    apiBaseUrl: normalizeHostedEmailApiBaseUrl(source.HOSTED_EMAIL_CLOUDFLARE_API_BASE_URL),
    cloudflareAccountId: normalizeHostedEmailAddressComponent(
      source.HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID,
    ),
    cloudflareApiToken: normalizeHostedEmailAddressComponent(
      source.HOSTED_EMAIL_CLOUDFLARE_API_TOKEN,
    ),
    defaultSubject: normalizeHostedEmailSubject(source.HOSTED_EMAIL_DEFAULT_SUBJECT) ?? "Murph update",
    domain,
    fromAddress,
    localPart,
    signingSecret: normalizeHostedEmailAddressComponent(source.HOSTED_EMAIL_SIGNING_SECRET),
  };
}

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

export async function readHostedEmailRawMessage(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
  rawMessageKey: string;
  userId: string;
}): Promise<Uint8Array | null> {
  return readEncryptedR2Payload({
    bucket: input.bucket,
    cryptoKey: input.key,
    cryptoKeysById: input.keysById,
    expectedKeyId: input.keyId,
    key: hostedEmailRawMessageObjectKey(input.userId, input.rawMessageKey),
  });
}

export async function writeHostedEmailRawMessage(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
  plaintext: Uint8Array;
  userId: string;
}): Promise<string> {
  const rawMessageKey = (await sha256Hex(input.plaintext)).slice(0, 32);
  await writeEncryptedR2Payload({
    bucket: input.bucket,
    cryptoKey: input.key,
    key: hostedEmailRawMessageObjectKey(input.userId, rawMessageKey),
    keyId: input.keyId,
    plaintext: input.plaintext,
  });
  return rawMessageKey;
}

export async function sendHostedEmailMessage(input: {
  bucket: R2BucketLike;
  config: HostedEmailConfig;
  key: Uint8Array;
  keyId: string;
  request: HostedEmailSendRequest;
  userId: string;
}): Promise<{
  target: string;
}> {
  if (!input.config.domain || !input.config.signingSecret) {
    throw new Error("Hosted email routing is not configured.");
  }
  if (!input.config.cloudflareAccountId || !input.config.cloudflareApiToken) {
    throw new Error("Hosted email sending is not configured.");
  }

  const store = createHostedEmailRouteStore({
    bucket: input.bucket,
    key: input.key,
    keyId: input.keyId,
  });
  const prepared = await prepareHostedEmailSend({
    config: input.config,
    message: input.request.message,
    target: input.request.target,
    targetKind: input.request.targetKind,
  });

  const response = await fetch(
    `${input.config.apiBaseUrl}/accounts/${encodeURIComponent(input.config.cloudflareAccountId)}/email/sending/send_raw`,
    {
      body: JSON.stringify({
        from: prepared.fromAddress,
        mime_message: prepared.mimeMessage,
        recipients: prepared.recipients,
      }),
      headers: {
        authorization: `Bearer ${input.config.cloudflareApiToken}`,
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    },
  );

  const payload = await response.json().catch(() => null) as {
    errors?: Array<{ message?: string | null }>;
    messages?: Array<{ message?: string | null }>;
    result?: {
      delivered?: string[];
      permanent_bounces?: string[];
      queued?: string[];
    };
    success?: boolean;
  } | null;

  if (!response.ok || payload?.success === false) {
    const details = [
      ...(payload?.errors ?? []),
      ...(payload?.messages ?? []),
    ]
      .map((entry) => entry.message?.trim())
      .filter((entry): entry is string => Boolean(entry));
    throw new Error(
      details[0] ?? `Hosted email send failed with HTTP ${response.status}.`,
    );
  }

  await store.writeThreadRoute({
    identityId: prepared.fromAddress,
    replyKey: prepared.threadTarget.replyKey ?? prepared.replyKey,
    target: prepared.threadTarget,
    userId: input.userId,
  });

  return {
    target: serializeHostedEmailThreadTarget(prepared.threadTarget),
  };
}

export async function readHostedEmailMessageBytes(
  input: HostedEmailWorkerRequest["raw"],
): Promise<Uint8Array> {
  if (typeof input === "string") {
    return new TextEncoder().encode(input);
  }

  if (input instanceof Uint8Array) {
    return input;
  }

  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }

  return await readHostedEmailReadableStream(input);
}

function createHostedEmailRouteStore(input: {
  bucket: R2BucketLike;
  key: Uint8Array;
  keyId: string;
  keysById?: Readonly<Record<string, Uint8Array>>;
}) {
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

async function prepareHostedEmailSend(input: {
  config: HostedEmailConfig;
  message: string;
  target: string;
  targetKind: HostedEmailSendRequest["targetKind"];
}): Promise<{
  fromAddress: string;
  mimeMessage: string;
  recipients: string[];
  replyKey: string;
  threadTarget: HostedEmailThreadTarget;
}> {
  const fromAddress = input.config.fromAddress;
  if (!fromAddress) {
    throw new Error("Hosted email sender identity is not configured.");
  }

  const existingThreadTarget = input.targetKind === "thread"
    ? parseHostedEmailThreadTarget(input.target)
    : null;
  if (input.targetKind === "thread" && !existingThreadTarget) {
    throw new Error("Hosted email thread delivery requires a serialized thread target.");
  }

  const replyKey = existingThreadTarget?.replyKey ?? randomHostedEmailKey();
  const replyAliasAddress = await createHostedEmailThreadAddress({
    config: input.config,
    replyKey,
  });
  const to = existingThreadTarget
    ? existingThreadTarget.to
    : normalizeHostedEmailAddressList([input.target]);
  const cc = existingThreadTarget?.cc ?? [];
  if (to.length === 0) {
    throw new Error("Hosted email delivery requires at least one recipient email address.");
  }

  const subject = existingThreadTarget
    ? ensureHostedEmailReplySubject(existingThreadTarget.subject, input.config.defaultSubject)
    : input.config.defaultSubject;
  const messageId = createHostedEmailMessageId(fromAddress);
  const threadTarget = createHostedEmailThreadTarget({
    cc,
    lastMessageId: messageId,
    references: [
      ...(existingThreadTarget?.references ?? []),
      existingThreadTarget?.lastMessageId,
      messageId,
    ].filter((value): value is string => Boolean(value && value.trim())),
    replyAliasAddress,
    replyKey,
    subject,
    to,
  });

  return {
    fromAddress,
    mimeMessage: buildRawMimeMessage({
      bodyText: input.message,
      fromAddress,
      inReplyTo: existingThreadTarget?.lastMessageId ?? null,
      messageId,
      references: existingThreadTarget?.references ?? [],
      replyToAddress: replyAliasAddress,
      subject,
      to,
      cc,
    }),
    recipients: normalizeHostedEmailAddressList([...to, ...cc]),
    replyKey,
    threadTarget,
  };
}

async function createHostedEmailThreadAddress(input: {
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

function buildRawMimeMessage(input: {
  bodyText: string;
  cc: string[];
  fromAddress: string;
  inReplyTo: string | null;
  messageId: string;
  references: string[];
  replyToAddress: string | null;
  subject: string;
  to: string[];
}): string {
  const headers = [
    `From: ${input.fromAddress}`,
    `To: ${input.to.join(", ")}`,
    input.cc.length > 0 ? `Cc: ${input.cc.join(", ")}` : null,
    `Subject: ${encodeMimeHeader(input.subject)}`,
    `Message-ID: ${input.messageId}`,
    `Date: ${new Date().toUTCString()}`,
    input.replyToAddress ? `Reply-To: ${input.replyToAddress}` : null,
    input.inReplyTo ? `In-Reply-To: ${input.inReplyTo}` : null,
    input.references.length > 0 ? `References: ${input.references.join(" ")}` : null,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: base64",
  ].filter((value): value is string => value !== null);

  return `${headers.join("\r\n")}\r\n\r\n${wrapMimeBase64(
    encodeUtf8Base64(input.bodyText),
  )}\r\n`;
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
  return bytesToHex(signature.slice(0, 16));
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

function createHostedEmailMessageId(fromAddress: string): string {
  const domain = fromAddress.split("@")[1] ?? "localhost";
  return `<hosted.${Date.now().toString(36)}.${randomHostedEmailKey()}@${domain}>`;
}

function wrapMimeBase64(value: string): string {
  return value.replace(/.{1,76}/gu, "$&\r\n").trimEnd();
}

function encodeUtf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function encodeMimeHeader(value: string): string {
  return /[^\x20-\x7E]/u.test(value)
    ? `=?UTF-8?B?${encodeUtf8Base64(value)}?=`
    : value;
}

async function readHostedEmailReadableStream(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      if (value) {
        chunks.push(value);
        totalLength += value.byteLength;
      }
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return combined;
}

function hostedEmailThreadRouteObjectKey(replyKey: string): string {
  return `transient/hosted-email/threads/${replyKey}.json`;
}

function hostedEmailUserRouteObjectKey(aliasKey: string): string {
  return `transient/hosted-email/users/${aliasKey}.json`;
}

function hostedEmailRawMessageObjectKey(userId: string, rawMessageKey: string): string {
  return `transient/hosted-email/messages/${encodeURIComponent(userId)}/${rawMessageKey}.eml`;
}

function parseHostedEmailUserRouteRecord(value: unknown): HostedEmailUserRouteRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted email user route must be an object.");
  }

  const record = value as Partial<HostedEmailUserRouteRecord>;
  if (record.schema !== HOSTED_EMAIL_USER_ROUTE_SCHEMA) {
    throw new TypeError("Hosted email user route schema is invalid.");
  }
  if (!record.aliasKey || !record.identityId || !record.userId) {
    throw new TypeError("Hosted email user route is incomplete.");
  }

  return {
    aliasKey: record.aliasKey,
    identityId: record.identityId,
    schema: HOSTED_EMAIL_USER_ROUTE_SCHEMA,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date().toISOString(),
    userId: record.userId,
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
  if (!record.identityId || !record.replyKey || !record.userId) {
    throw new TypeError("Hosted email thread route is incomplete.");
  }

  const target = parseHostedEmailThreadTarget(
    typeof record.target === "string"
      ? record.target
      : record.target
        ? serializeHostedEmailThreadTarget(record.target)
        : null,
  );
  if (!target) {
    throw new TypeError("Hosted email thread route target is invalid.");
  }

  return {
    identityId: record.identityId,
    replyKey: record.replyKey,
    schema: HOSTED_EMAIL_THREAD_ROUTE_SCHEMA,
    target,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date().toISOString(),
    userId: record.userId,
  };
}

function randomHostedEmailKey(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(8)));
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes))));
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function normalizeHostedEmailApiBaseUrl(value: string | undefined): string {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized.replace(/\/$/u, "") : "https://api.cloudflare.com/client/v4";
}

function normalizeHostedEmailAddressComponent(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function normalizeHostedEmailSubject(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}
