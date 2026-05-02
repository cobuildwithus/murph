import {
  parseHostedUserRecipientPrivateKeyJwk,
  parseHostedUserRecipientPublicKeyJwk,
  type HostedUserRecipientPrivateKeyJwk,
  type HostedUserRecipientPublicKeyJwk,
} from "./hosted-ecdh-jwk.ts";

const HOSTED_BROWSER_SESSION_KEY_WRAP_SALT = new TextEncoder().encode(
  "murph.cloudflare.hosted.browser-session-key.wrap.v1",
);
const HOSTED_BROWSER_SESSION_KEY_BYTES = 32;

export const HOSTED_BROWSER_SESSION_KEY_ENVELOPE_SCHEMA = "murph.hosted-browser-session-key-envelope.v1";
export const HOSTED_BROWSER_SESSION_KEY_RECIPIENT_KIND = "browser-session";

export interface HostedBrowserSessionWrappedKeyRecipient {
  ciphertext: string;
  ephemeralPublicKeyJwk: HostedUserRecipientPublicKeyJwk;
  iv: string;
  keyId: string;
  kind: typeof HOSTED_BROWSER_SESSION_KEY_RECIPIENT_KIND;
}

export interface HostedBrowserSessionKeyEnvelope {
  createdAt: string;
  keyId: string;
  purpose: "browser-vault-replica";
  recipients: HostedBrowserSessionWrappedKeyRecipient[];
  schema: typeof HOSTED_BROWSER_SESSION_KEY_ENVELOPE_SCHEMA;
  userId: string;
}

export async function wrapHostedBrowserSessionKey(input: {
  keyBytes: Uint8Array;
  keyId: string;
  publicKeyJwk: HostedUserRecipientPublicKeyJwk;
  purpose: "browser-vault-replica";
  userId: string;
}): Promise<HostedBrowserSessionKeyEnvelope> {
  const keyBytes = requireSessionKeyBytes(input.keyBytes, "Hosted browser session key");
  const recipientPublicKey = await importHostedUserRecipientPublicKey(input.publicKeyJwk);
  const ephemeralKeyPair = await crypto.subtle.generateKey(
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    true,
    ["deriveBits"],
  );
  const wrappingKey = await deriveHostedBrowserSessionWrappingKey({
    counterpartyPublicKey: recipientPublicKey,
    keyId: input.keyId,
    privateKey: ephemeralKeyPair.privateKey,
    purpose: input.purpose,
    userId: input.userId,
  });
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await crypto.subtle.importKey("raw", toArrayBuffer(wrappingKey), "AES-GCM", false, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt(
    {
      additionalData: toArrayBuffer(buildHostedBrowserSessionKeyAad({
        keyId: input.keyId,
        purpose: input.purpose,
        userId: input.userId,
      })),
      iv: toArrayBuffer(iv),
      name: "AES-GCM",
    },
    cryptoKey,
    toArrayBuffer(keyBytes),
  );

  return {
    createdAt: new Date().toISOString(),
    keyId: input.keyId,
    purpose: input.purpose,
    recipients: [
      {
        ciphertext: encodeBase64(new Uint8Array(ciphertext)),
        ephemeralPublicKeyJwk: parseHostedUserRecipientPublicKeyJwk(
          await crypto.subtle.exportKey("jwk", ephemeralKeyPair.publicKey),
          "Hosted browser session ephemeral public key",
        ),
        iv: encodeBase64(iv),
        keyId: input.keyId,
        kind: HOSTED_BROWSER_SESSION_KEY_RECIPIENT_KIND,
      },
    ],
    schema: HOSTED_BROWSER_SESSION_KEY_ENVELOPE_SCHEMA,
    userId: input.userId,
  };
}

export async function unwrapHostedBrowserSessionKey(input: {
  envelope: HostedBrowserSessionKeyEnvelope;
  recipientPrivateKeyJwk: HostedUserRecipientPrivateKeyJwk;
}): Promise<Uint8Array> {
  const recipient = input.envelope.recipients.find((entry) => entry.kind === HOSTED_BROWSER_SESSION_KEY_RECIPIENT_KIND);

  if (!recipient) {
    throw new Error("Hosted browser session key envelope is missing a browser-session recipient.");
  }

  const recipientPrivateKey = await importHostedUserRecipientPrivateKey(input.recipientPrivateKeyJwk);
  const ephemeralPublicKey = await importHostedUserRecipientPublicKey(recipient.ephemeralPublicKeyJwk);
  const wrappingKey = await deriveHostedBrowserSessionWrappingKey({
    counterpartyPublicKey: ephemeralPublicKey,
    keyId: input.envelope.keyId,
    privateKey: recipientPrivateKey,
    purpose: input.envelope.purpose,
    userId: input.envelope.userId,
  });
  const cryptoKey = await crypto.subtle.importKey("raw", toArrayBuffer(wrappingKey), "AES-GCM", false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt(
    {
      additionalData: toArrayBuffer(buildHostedBrowserSessionKeyAad({
        keyId: input.envelope.keyId,
        purpose: input.envelope.purpose,
        userId: input.envelope.userId,
      })),
      iv: toArrayBuffer(decodeBase64(recipient.iv)),
      name: "AES-GCM",
    },
    cryptoKey,
    toArrayBuffer(decodeBase64(recipient.ciphertext)),
  );

  return requireSessionKeyBytes(new Uint8Array(plaintext), "Hosted browser session key");
}

export function parseHostedBrowserSessionKeyEnvelope(
  value: unknown,
  label = "Hosted browser session key envelope",
): HostedBrowserSessionKeyEnvelope {
  const record = requireRecord(value, label);
  const schema = requireString(record.schema, `${label}.schema`);
  const purpose = requireString(record.purpose, `${label}.purpose`);

  if (schema !== HOSTED_BROWSER_SESSION_KEY_ENVELOPE_SCHEMA) {
    throw new TypeError(`${label}.schema must be ${HOSTED_BROWSER_SESSION_KEY_ENVELOPE_SCHEMA}.`);
  }
  if (purpose !== "browser-vault-replica") {
    throw new TypeError(`${label}.purpose must be browser-vault-replica.`);
  }

  return {
    createdAt: requireString(record.createdAt, `${label}.createdAt`),
    keyId: requireString(record.keyId, `${label}.keyId`),
    purpose,
    recipients: readArray(record.recipients, `${label}.recipients`).map((entry, index) =>
      parseHostedBrowserSessionWrappedKeyRecipient(entry, `${label}.recipients[${index}]`)
    ),
    schema,
    userId: requireString(record.userId, `${label}.userId`),
  };
}

function parseHostedBrowserSessionWrappedKeyRecipient(
  value: unknown,
  label: string,
): HostedBrowserSessionWrappedKeyRecipient {
  const record = requireRecord(value, label);
  const kind = requireString(record.kind, `${label}.kind`);

  if (kind !== HOSTED_BROWSER_SESSION_KEY_RECIPIENT_KIND) {
    throw new TypeError(`${label}.kind must be browser-session.`);
  }

  return {
    ciphertext: requireString(record.ciphertext, `${label}.ciphertext`),
    ephemeralPublicKeyJwk: parseHostedUserRecipientPublicKeyJwk(
      record.ephemeralPublicKeyJwk,
      `${label}.ephemeralPublicKeyJwk`,
    ),
    iv: requireString(record.iv, `${label}.iv`),
    keyId: requireString(record.keyId, `${label}.keyId`),
    kind,
  };
}

async function deriveHostedBrowserSessionWrappingKey(input: {
  counterpartyPublicKey: CryptoKey;
  keyId: string;
  privateKey: CryptoKey;
  purpose: "browser-vault-replica";
  userId: string;
}): Promise<Uint8Array> {
  const sharedSecret = await crypto.subtle.deriveBits(
    {
      name: "ECDH",
      public: input.counterpartyPublicKey,
    },
    input.privateKey,
    256,
  );
  const hkdfKey = await crypto.subtle.importKey("raw", sharedSecret, "HKDF", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits(
    {
      hash: "SHA-256",
      info: toArrayBuffer(buildHostedBrowserSessionKeyAad({
        keyId: input.keyId,
        purpose: input.purpose,
        userId: input.userId,
      })),
      name: "HKDF",
      salt: toArrayBuffer(HOSTED_BROWSER_SESSION_KEY_WRAP_SALT),
    },
    hkdfKey,
    256,
  );

  return new Uint8Array(derived);
}

async function importHostedUserRecipientPublicKey(value: HostedUserRecipientPublicKeyJwk): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", value as JsonWebKey, { name: "ECDH", namedCurve: "P-256" }, false, []);
}

async function importHostedUserRecipientPrivateKey(value: HostedUserRecipientPrivateKeyJwk): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", value as JsonWebKey, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
}

function buildHostedBrowserSessionKeyAad(input: {
  keyId: string;
  purpose: "browser-vault-replica";
  userId: string;
}): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    keyId: input.keyId,
    purpose: input.purpose,
    userId: input.userId,
  }));
}

function requireSessionKeyBytes(value: Uint8Array, label: string): Uint8Array {
  if (value.byteLength !== HOSTED_BROWSER_SESSION_KEY_BYTES) {
    throw new TypeError(`${label} must be ${HOSTED_BROWSER_SESSION_KEY_BYTES} bytes.`);
  }

  return value;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}

function readArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }

  return value.slice();
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

function encodeBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
