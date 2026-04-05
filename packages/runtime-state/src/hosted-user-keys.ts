const HOSTED_USER_ROOT_KEY_WRAP_SALT = new TextEncoder().encode(
  "murph.cloudflare.hosted.user-root-key.wrap.v1",
);
const HOSTED_USER_ROOT_KEY_WRAP_SCOPE = "root-key-recipient";
const HOSTED_USER_ROOT_KEY_BYTES = 32;

export const HOSTED_USER_ROOT_KEY_ENVELOPE_SCHEMA = "murph.hosted-user-root-key-envelope.v2";
export const HOSTED_USER_ROOT_KEY_RECIPIENT_KINDS = [
  "automation",
  "user-unlock",
  "recovery",
  "tee-automation",
] as const;
export const HOSTED_USER_MANAGED_ROOT_KEY_RECIPIENT_KINDS = [
  "user-unlock",
  "recovery",
] as const;

export type HostedUserRootKeyEnvelopeSchema = typeof HOSTED_USER_ROOT_KEY_ENVELOPE_SCHEMA;
export type HostedUserRootKeyRecipientKind =
  (typeof HOSTED_USER_ROOT_KEY_RECIPIENT_KINDS)[number];
export type HostedUserManagedRootKeyRecipientKind =
  (typeof HOSTED_USER_MANAGED_ROOT_KEY_RECIPIENT_KINDS)[number];

export interface HostedUserRecipientPublicKeyJwk {
  crv: "P-256";
  ext?: boolean;
  key_ops?: string[];
  kty: "EC";
  x: string;
  y: string;
}

export interface HostedUserRecipientPrivateKeyJwk extends HostedUserRecipientPublicKeyJwk {
  d: string;
}

export interface HostedWrappedRootKeyRecipient {
  ciphertext: string;
  ephemeralPublicKeyJwk: HostedUserRecipientPublicKeyJwk;
  iv: string;
  keyId: string;
  kind: HostedUserRootKeyRecipientKind;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface HostedUserRootKeyEnvelope {
  createdAt: string;
  recipients: HostedWrappedRootKeyRecipient[];
  rootKeyId: string;
  schema: HostedUserRootKeyEnvelopeSchema;
  updatedAt: string;
  userId: string;
}

export interface HostedUserRootKeyEnvelopeRecipientInput {
  keyId: string;
  kind: HostedUserRootKeyRecipientKind;
  metadata?: Record<string, string | number | boolean | null>;
  publicKeyJwk: HostedUserRecipientPublicKeyJwk;
}

export async function generateHostedUserRecipientKeyPair(): Promise<{
  privateKeyJwk: HostedUserRecipientPrivateKeyJwk;
  publicKeyJwk: HostedUserRecipientPublicKeyJwk;
}> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    true,
    ["deriveBits"],
  );

  return {
    privateKeyJwk: parseHostedUserRecipientPrivateKeyJwk(
      await crypto.subtle.exportKey("jwk", keyPair.privateKey),
      "Hosted user recipient private key",
    ),
    publicKeyJwk: parseHostedUserRecipientPublicKeyJwk(
      await crypto.subtle.exportKey("jwk", keyPair.publicKey),
      "Hosted user recipient public key",
    ),
  };
}

export async function createHostedUserRootKeyEnvelope(input: {
  createdAt?: string;
  recipients: readonly HostedUserRootKeyEnvelopeRecipientInput[];
  rootKey?: Uint8Array;
  rootKeyId?: string;
  userId: string;
}): Promise<{ envelope: HostedUserRootKeyEnvelope; rootKey: Uint8Array }> {
  const rootKey = requireRootKeyBytes(
    input.rootKey ?? crypto.getRandomValues(new Uint8Array(HOSTED_USER_ROOT_KEY_BYTES)),
    "Hosted user root key",
  );
  const nowIso = input.createdAt ?? new Date().toISOString();
  const rootKeyId = input.rootKeyId ?? createHostedUserRootKeyId();

  return {
    envelope: {
      createdAt: nowIso,
      recipients: await Promise.all(
        input.recipients.map((recipient) =>
          wrapHostedUserRootKeyRecipient({
            recipient,
            rootKey,
            rootKeyId,
            userId: input.userId,
          })
        ),
      ),
      rootKeyId,
      schema: HOSTED_USER_ROOT_KEY_ENVELOPE_SCHEMA,
      updatedAt: nowIso,
      userId: input.userId,
    },
    rootKey,
  };
}

export async function wrapHostedUserRootKeyRecipient(input: {
  recipient: HostedUserRootKeyEnvelopeRecipientInput;
  rootKey: Uint8Array;
  rootKeyId: string;
  userId: string;
}): Promise<HostedWrappedRootKeyRecipient> {
  const rootKey = requireRootKeyBytes(input.rootKey, "Hosted user root key");
  const recipientPublicKey = await importHostedUserRecipientPublicKey(input.recipient.publicKeyJwk);
  const ephemeralKeyPair = await crypto.subtle.generateKey(
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    true,
    ["deriveBits"],
  );
  const wrappingKey = await deriveHostedUserRecipientWrappingKey({
    counterpartyPublicKey: recipientPublicKey,
    privateKey: ephemeralKeyPair.privateKey,
    recipient: input.recipient,
    rootKeyId: input.rootKeyId,
    userId: input.userId,
  });
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(wrappingKey),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const ciphertext = await crypto.subtle.encrypt(
    {
      additionalData: toArrayBuffer(
        buildHostedUserRootKeyRecipientAad({
          keyId: input.recipient.keyId,
          recipientKind: input.recipient.kind,
          rootKeyId: input.rootKeyId,
          userId: input.userId,
        }),
      ),
      iv: toArrayBuffer(iv),
      name: "AES-GCM",
    },
    cryptoKey,
    toArrayBuffer(rootKey),
  );

  return {
    ciphertext: encodeBase64(new Uint8Array(ciphertext)),
    ephemeralPublicKeyJwk: parseHostedUserRecipientPublicKeyJwk(
      await crypto.subtle.exportKey("jwk", ephemeralKeyPair.publicKey),
      "Hosted wrapped root key recipient ephemeral public key",
    ),
    iv: encodeBase64(iv),
    keyId: input.recipient.keyId,
    kind: input.recipient.kind,
    ...(input.recipient.metadata ? { metadata: input.recipient.metadata } : {}),
  };
}

export async function unwrapHostedUserRootKeyRecipient(input: {
  envelope: HostedUserRootKeyEnvelope;
  recipient: HostedWrappedRootKeyRecipient;
  recipientPrivateKeyJwk: HostedUserRecipientPrivateKeyJwk;
}): Promise<Uint8Array> {
  const recipientPrivateKey = await importHostedUserRecipientPrivateKey(input.recipientPrivateKeyJwk);
  const ephemeralPublicKey = await importHostedUserRecipientPublicKey(input.recipient.ephemeralPublicKeyJwk);
  const wrappingKey = await deriveHostedUserRecipientWrappingKey({
    counterpartyPublicKey: ephemeralPublicKey,
    privateKey: recipientPrivateKey,
    recipient: {
      keyId: input.recipient.keyId,
      kind: input.recipient.kind,
    },
    rootKeyId: input.envelope.rootKeyId,
    userId: input.envelope.userId,
  });
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(wrappingKey),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const plaintext = await crypto.subtle.decrypt(
    {
      additionalData: toArrayBuffer(
        buildHostedUserRootKeyRecipientAad({
          keyId: input.recipient.keyId,
          recipientKind: input.recipient.kind,
          rootKeyId: input.envelope.rootKeyId,
          userId: input.envelope.userId,
        }),
      ),
      iv: toArrayBuffer(decodeBase64(input.recipient.iv)),
      name: "AES-GCM",
    },
    cryptoKey,
    toArrayBuffer(decodeBase64(input.recipient.ciphertext)),
  );

  return requireRootKeyBytes(new Uint8Array(plaintext), "Hosted user root key");
}

export async function unwrapHostedUserRootKeyForKind(input: {
  envelope: HostedUserRootKeyEnvelope;
  kind: HostedUserRootKeyRecipientKind;
  recipientPrivateKeyJwk: HostedUserRecipientPrivateKeyJwk;
}): Promise<Uint8Array> {
  const recipient = findHostedWrappedRootKeyRecipient(input.envelope, input.kind);

  if (!recipient) {
    throw new Error(`Hosted user root key envelope is missing a ${input.kind} recipient.`);
  }

  return unwrapHostedUserRootKeyRecipient({
    envelope: input.envelope,
    recipient,
    recipientPrivateKeyJwk: input.recipientPrivateKeyJwk,
  });
}

export function buildHostedUserRootKeyRecipientAad(input: {
  keyId: string;
  recipientKind: HostedUserRootKeyRecipientKind;
  rootKeyId: string;
  userId: string;
}): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    keyId: input.keyId,
    recipientKind: input.recipientKind,
    rootKeyId: input.rootKeyId,
    scope: HOSTED_USER_ROOT_KEY_WRAP_SCOPE,
    userId: input.userId,
  }));
}

export function createHostedUserRootKeyId(): string {
  return `urk:${crypto.randomUUID()}`;
}

export function parseHostedUserRootKeyEnvelope(
  value: unknown,
  label = "Hosted user root key envelope",
): HostedUserRootKeyEnvelope {
  const record = requireRecord(value, label);
  const recipients = readArray(record.recipients, `${label}.recipients`).map((entry, index) =>
    parseHostedWrappedRootKeyRecipient(entry, `${label}.recipients[${index}]`)
  );
  assertHostedUserRootKeyEnvelopeUniqueRecipientKinds(recipients, `${label}.recipients`);

  return {
    createdAt: requireString(record.createdAt, `${label}.createdAt`),
    recipients,
    rootKeyId: requireString(record.rootKeyId, `${label}.rootKeyId`),
    schema: requireEnvelopeSchema(record.schema, `${label}.schema`),
    updatedAt: requireString(record.updatedAt, `${label}.updatedAt`),
    userId: requireString(record.userId, `${label}.userId`),
  };
}

function assertHostedUserRootKeyEnvelopeUniqueRecipientKinds(
  recipients: readonly HostedWrappedRootKeyRecipient[],
  label: string,
): void {
  const seen = new Set<HostedUserRootKeyRecipientKind>();

  for (const recipient of recipients) {
    if (seen.has(recipient.kind)) {
      throw new TypeError(`${label} contains duplicate ${recipient.kind} recipients.`);
    }

    seen.add(recipient.kind);
  }
}

export function parseHostedWrappedRootKeyRecipient(
  value: unknown,
  label = "Hosted wrapped root key recipient",
): HostedWrappedRootKeyRecipient {
  const record = requireRecord(value, label);

  return {
    ciphertext: requireString(record.ciphertext, `${label}.ciphertext`),
    ephemeralPublicKeyJwk: parseHostedUserRecipientPublicKeyJwk(
      record.ephemeralPublicKeyJwk,
      `${label}.ephemeralPublicKeyJwk`,
    ),
    iv: requireString(record.iv, `${label}.iv`),
    keyId: requireString(record.keyId, `${label}.keyId`),
    kind: requireRecipientKind(record.kind, `${label}.kind`),
    ...(record.metadata === undefined
      ? {}
      : { metadata: parseMetadataRecord(record.metadata, `${label}.metadata`) }),
  };
}

export function parseHostedUserRecipientPublicKeyJwk(
  value: unknown,
  label = "Hosted user recipient public key",
): HostedUserRecipientPublicKeyJwk {
  const record = requireRecord(value, label);
  const kty = requireString(record.kty, `${label}.kty`);
  const crv = requireString(record.crv, `${label}.crv`);

  if (kty !== "EC" || crv !== "P-256") {
    throw new TypeError(`${label} must be an EC P-256 public JWK.`);
  }

  return {
    crv: "P-256",
    ...(record.ext === undefined ? {} : { ext: requireBoolean(record.ext, `${label}.ext`) }),
    ...(record.key_ops === undefined ? {} : {
      key_ops: readArray(record.key_ops, `${label}.key_ops`).map((entry, index) =>
        requireString(entry, `${label}.key_ops[${index}]`)
      ),
    }),
    kty: "EC",
    x: requireString(record.x, `${label}.x`),
    y: requireString(record.y, `${label}.y`),
  };
}

export function parseHostedUserRecipientPrivateKeyJwk(
  value: unknown,
  label = "Hosted user recipient private key",
): HostedUserRecipientPrivateKeyJwk {
  const publicKey = parseHostedUserRecipientPublicKeyJwk(value, label);
  const record = requireRecord(value, label);

  return {
    ...publicKey,
    d: requireString(record.d, `${label}.d`),
  };
}

export function findHostedWrappedRootKeyRecipient(
  envelope: HostedUserRootKeyEnvelope,
  kind: HostedUserRootKeyRecipientKind,
): HostedWrappedRootKeyRecipient | null {
  return envelope.recipients.find((recipient) => recipient.kind === kind) ?? null;
}

export function isHostedUserManagedRootKeyRecipientKind(
  value: string,
): value is HostedUserManagedRootKeyRecipientKind {
  return value === "user-unlock" || value === "recovery";
}

async function deriveHostedUserRecipientWrappingKey(input: {
  counterpartyPublicKey: CryptoKey;
  privateKey: CryptoKey;
  recipient: Pick<HostedUserRootKeyEnvelopeRecipientInput, "keyId" | "kind">;
  rootKeyId: string;
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
  const hkdfKey = await crypto.subtle.importKey(
    "raw",
    sharedSecret,
    "HKDF",
    false,
    ["deriveBits"],
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      info: toArrayBuffer(buildHostedUserRootKeyRecipientAad({
        keyId: input.recipient.keyId,
        recipientKind: input.recipient.kind,
        rootKeyId: input.rootKeyId,
        userId: input.userId,
      })),
      salt: toArrayBuffer(HOSTED_USER_ROOT_KEY_WRAP_SALT),
    },
    hkdfKey,
    256,
  );

  return new Uint8Array(derived);
}

async function importHostedUserRecipientPublicKey(
  value: HostedUserRecipientPublicKeyJwk,
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    value as JsonWebKey,
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    false,
    [],
  );
}

async function importHostedUserRecipientPrivateKey(
  value: HostedUserRecipientPrivateKeyJwk,
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    value as JsonWebKey,
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    false,
    ["deriveBits"],
  );
}

function requireEnvelopeSchema(value: unknown, label: string): HostedUserRootKeyEnvelopeSchema {
  const schema = requireString(value, label);

  if (schema !== HOSTED_USER_ROOT_KEY_ENVELOPE_SCHEMA) {
    throw new TypeError(`${label} must be ${HOSTED_USER_ROOT_KEY_ENVELOPE_SCHEMA}.`);
  }

  return schema;
}

function requireRecipientKind(value: unknown, label: string): HostedUserRootKeyRecipientKind {
  const kind = requireString(value, label);

  if (
    kind === "automation"
    || kind === "user-unlock"
    || kind === "recovery"
    || kind === "tee-automation"
  ) {
    return kind;
  }

  throw new TypeError(`${label} must be a supported root key recipient kind.`);
}

function parseMetadataRecord(
  value: unknown,
  label: string,
): Record<string, string | number | boolean | null> {
  const record = requireRecord(value, label);
  const result: Record<string, string | number | boolean | null> = {};

  for (const [key, entry] of Object.entries(record)) {
    if (
      entry === null
      || typeof entry === "string"
      || typeof entry === "number"
      || typeof entry === "boolean"
    ) {
      result[key] = entry;
      continue;
    }

    throw new TypeError(`${label}.${key} must be a scalar JSON value.`);
  }

  return result;
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

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean.`);
  }

  return value;
}

function readArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }

  return value;
}

function requireRootKeyBytes(value: Uint8Array, label: string): Uint8Array {
  if (value.byteLength !== HOSTED_USER_ROOT_KEY_BYTES) {
    throw new TypeError(`${label} must be ${HOSTED_USER_ROOT_KEY_BYTES} bytes.`);
  }

  return value;
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
