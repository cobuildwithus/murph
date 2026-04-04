import {
  buildHostedWrappedRootKeyRecipientAadFields,
  buildLegacyHostedWrappedRootKeyRecipientAadFields,
  findHostedWrappedRootKeyRecipient,
  type HostedUserRootKeyEnvelope,
  type HostedUserManagedRootKeyRecipientKind,
} from "@murphai/runtime-state";

const HOSTED_BROWSER_CONTEXT_SALT = new TextEncoder().encode("murph.cloudflare.hosted.storage.v2");
const HOSTED_BROWSER_CIPHER_SCHEMA = "murph.hosted-cipher.v2";
const HOSTED_BROWSER_RECIPIENT_KEY_BYTES = 32;
const utf8Encoder = new TextEncoder();

export interface HostedBrowserCipherEnvelope {
  algorithm: "AES-GCM";
  ciphertext: string;
  iv: string;
  keyId: string;
  schema: typeof HOSTED_BROWSER_CIPHER_SCHEMA;
  scope?: string;
}

export interface HostedUserRecipientUpsertPayload {
  metadata?: Record<string, string | number | boolean | null>;
  recipientKeyBase64: string;
  recipientKeyId: string;
}

export function generateHostedUserRecipientKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(HOSTED_BROWSER_RECIPIENT_KEY_BYTES));
}

export function createHostedUserRecipientUpsertPayload(input: {
  key: Uint8Array;
  keyId: string;
  metadata?: Record<string, string | number | boolean | null>;
}): HostedUserRecipientUpsertPayload {
  return {
    ...(input.metadata ? { metadata: input.metadata } : {}),
    recipientKeyBase64: encodeHostedBrowserBase64(
      requireHostedBrowserRecipientKeyBytes(input.key, "Hosted browser recipient key"),
    ),
    recipientKeyId: input.keyId,
  };
}

export async function unwrapHostedUserRootKeyForBrowser(input: {
  envelope: HostedUserRootKeyEnvelope;
  kind: HostedUserManagedRootKeyRecipientKind;
  recipientKey: Uint8Array;
}): Promise<Uint8Array> {
  const recipient = findHostedWrappedRootKeyRecipient(input.envelope, input.kind);

  if (!recipient) {
    throw new Error(`Hosted user root key envelope is missing a ${input.kind} recipient.`);
  }

  const recipientKey = requireHostedBrowserRecipientKeyBytes(
    input.recipientKey,
    `${input.kind} recipient key`,
  );
  const cipherEnvelope: HostedBrowserCipherEnvelope = {
    algorithm: "AES-GCM" as const,
    ciphertext: recipient.ciphertext,
    iv: recipient.iv,
    keyId: recipient.keyId,
    schema: HOSTED_BROWSER_CIPHER_SCHEMA,
    scope: "root-key-recipient" as const,
  };

  try {
    return await decryptHostedBrowserCipherEnvelope({
      aad: buildHostedBrowserStorageAad(buildHostedWrappedRootKeyRecipientAadFields({
        keyId: recipient.keyId,
        kind: recipient.kind,
        rootKeyId: input.envelope.rootKeyId,
        userId: input.envelope.userId,
      })),
      envelope: cipherEnvelope,
      rootKey: recipientKey,
      scope: "root-key-recipient",
    });
  } catch {
    return decryptHostedBrowserCipherEnvelope({
      aad: buildHostedBrowserStorageAad(buildLegacyHostedWrappedRootKeyRecipientAadFields({
        keyId: recipient.keyId,
        kind: recipient.kind,
      })),
      envelope: cipherEnvelope,
      rootKey: recipientKey,
      scope: "root-key-recipient",
    });
  }
}

export async function deriveHostedUserDomainKeyForBrowser(
  rootKey: Uint8Array,
  scope: string,
): Promise<Uint8Array> {
  return deriveHostedBrowserStorageKey(rootKey, scope);
}

export async function decryptHostedBrowserCipherEnvelope(input: {
  aad?: Uint8Array;
  envelope: HostedBrowserCipherEnvelope;
  rootKey: Uint8Array;
  scope: string;
}): Promise<Uint8Array> {
  if (input.envelope.schema !== HOSTED_BROWSER_CIPHER_SCHEMA || input.envelope.algorithm !== "AES-GCM") {
    throw new Error("Hosted browser cipher envelope is invalid.");
  }

  if (input.envelope.scope !== undefined && input.envelope.scope !== input.scope) {
    throw new Error(`Hosted browser cipher scope mismatch: expected ${input.scope}, got ${input.envelope.scope}.`);
  }

  const scopedKey = await deriveHostedBrowserStorageKey(input.rootKey, input.scope);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(scopedKey),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const plaintext = await crypto.subtle.decrypt(
    {
      ...(input.aad && input.aad.byteLength > 0
        ? { additionalData: toArrayBuffer(input.aad) }
        : {}),
      iv: toArrayBuffer(decodeHostedBrowserBase64(input.envelope.iv)),
      name: "AES-GCM",
    },
    cryptoKey,
    toArrayBuffer(decodeHostedBrowserBase64(input.envelope.ciphertext)),
  );

  return new Uint8Array(plaintext);
}

export function buildHostedBrowserStorageAad(
  fields: Readonly<Record<string, string | number | boolean | null | undefined>>,
): Uint8Array {
  const canonical = Object.fromEntries(
    Object.entries(fields)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, value ?? null]),
  );

  return utf8Encoder.encode(JSON.stringify(canonical));
}

async function deriveHostedBrowserStorageKey(rootKey: Uint8Array, scope: string): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(rootKey),
    "HKDF",
    false,
    ["deriveBits"],
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      info: utf8Encoder.encode(scope),
      salt: HOSTED_BROWSER_CONTEXT_SALT,
    },
    baseKey,
    256,
  );

  return new Uint8Array(derived);
}

function requireHostedBrowserRecipientKeyBytes(value: Uint8Array, label: string): Uint8Array {
  if (value.byteLength !== HOSTED_BROWSER_RECIPIENT_KEY_BYTES) {
    throw new TypeError(`${label} must be ${HOSTED_BROWSER_RECIPIENT_KEY_BYTES} bytes.`);
  }

  return value;
}

function encodeHostedBrowserBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function decodeHostedBrowserBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}
