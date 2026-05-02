import {
  getHostedCryptoDomainForLane,
  isHostedCryptoDomain,
  isHostedCryptoLane,
  type HostedCryptoDomain,
  type HostedCryptoLane,
} from "./hosted-domain-crypto.ts";

const HOSTED_DATA_KEY_BYTES = 32;
const HOSTED_DATA_KEY_IV_BYTES = 12;
const HOSTED_DATA_KEY_WRAP_SALT = toArrayBuffer(
  new TextEncoder().encode("murph.hosted-data-key-envelope.root-wrap.v1"),
);

export const HOSTED_DATA_KEY_ENVELOPE_SCHEMA =
  "murph.hosted-data-key-envelope.v1";

export interface HostedDataKeyResourceV1 {
  objectKey?: string;
  purpose: string;
  rowId?: string;
  table?: string;
  userId: string;
}

export interface HostedDataKeyDomainRootWrapV1 {
  ciphertext: string;
  iv: string;
  kind: "domain-root";
  rootKeyId: string;
}

export interface HostedDataKeyEnvelopeV1 {
  alg: "AES-256-GCM-HKDF-SHA256";
  dataKeyId: string;
  domain: HostedCryptoDomain;
  lane: HostedCryptoLane;
  resource: HostedDataKeyResourceV1;
  rootKeyId: string;
  schema: typeof HOSTED_DATA_KEY_ENVELOPE_SCHEMA;
  wraps: HostedDataKeyDomainRootWrapV1[];
}

export function createHostedDataKeyId(lane: HostedCryptoLane): string {
  return `hdk:${lane}:${crypto.randomUUID()}`;
}

export function generateHostedDataKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(HOSTED_DATA_KEY_BYTES));
}

export async function createHostedDataKeyEnvelopeWithDomainRoot(input: {
  dataKey?: Uint8Array;
  dataKeyId?: string;
  domain: HostedCryptoDomain;
  lane: HostedCryptoLane;
  resource: HostedDataKeyResourceV1;
  rootKey: Uint8Array;
  rootKeyId: string;
}): Promise<{ dataKey: Uint8Array; envelope: HostedDataKeyEnvelopeV1 }> {
  const domain = requireHostedDataKeyDomain(
    input.domain,
    "Hosted data-key envelope domain",
  );
  const lane = requireHostedDataKeyLane(
    input.lane,
    "Hosted data-key envelope lane",
  );
  assertDataKeyLaneDomain({ domain, lane });
  const dataKey = requireDataKeyBytes(
    input.dataKey ?? generateHostedDataKey(),
    "Hosted data key",
  );
  const dataKeyId = requireNonEmptyString(
    input.dataKeyId ?? createHostedDataKeyId(lane),
    "Hosted data key id",
  );
  const rootKeyId = requireNonEmptyString(
    input.rootKeyId,
    "Hosted data-key rootKeyId",
  );
  const resource = normalizeHostedDataKeyResource(input.resource);
  const envelopeBase = {
    alg: "AES-256-GCM-HKDF-SHA256" as const,
    dataKeyId,
    domain,
    lane,
    resource,
    rootKeyId,
    schema: HOSTED_DATA_KEY_ENVELOPE_SCHEMA,
  };
  const wrapKey = await deriveHostedDataKeyRootWrapKey({
    ...envelopeBase,
    rootKey: input.rootKey,
  });
  const iv = crypto.getRandomValues(new Uint8Array(HOSTED_DATA_KEY_IV_BYTES));
  const wrapAad = buildHostedDataKeyRootWrapAad(envelopeBase);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { additionalData: toArrayBuffer(wrapAad), iv, name: "AES-GCM" },
      wrapKey,
      toArrayBuffer(dataKey),
    ),
  );

  return {
    dataKey,
    envelope: {
      ...envelopeBase,
      wraps: [
        {
          ciphertext: encodeBase64(ciphertext),
          iv: encodeBase64(iv),
          kind: "domain-root",
          rootKeyId,
        },
      ],
    },
  };
}

export async function unwrapHostedDataKeyWithDomainRoot(input: {
  envelope: HostedDataKeyEnvelopeV1;
  rootKey: Uint8Array;
  rootKeyId: string;
}): Promise<Uint8Array> {
  const envelope = parseHostedDataKeyEnvelope(input.envelope);
  const rootKeyId = requireNonEmptyString(
    input.rootKeyId,
    "Hosted data-key unwrap rootKeyId",
  );
  if (envelope.rootKeyId !== rootKeyId) {
    throw new Error("Hosted data-key envelope rootKeyId mismatch.");
  }
  const wrap = envelope.wraps.find(
    (entry) => entry.kind === "domain-root" && entry.rootKeyId === rootKeyId,
  );
  if (!wrap) {
    throw new Error(
      `Hosted data-key envelope is missing domain-root wrap ${rootKeyId}.`,
    );
  }

  const wrapKey = await deriveHostedDataKeyRootWrapKey({
    alg: envelope.alg,
    dataKeyId: envelope.dataKeyId,
    domain: envelope.domain,
    lane: envelope.lane,
    resource: envelope.resource,
    rootKey: input.rootKey,
    rootKeyId,
    schema: envelope.schema,
  });
  const plaintext = new Uint8Array(
    await crypto.subtle.decrypt(
      {
        additionalData: toArrayBuffer(buildHostedDataKeyRootWrapAad(envelope)),
        iv: toArrayBuffer(
          decodeFixedBase64(
            wrap.iv,
            HOSTED_DATA_KEY_IV_BYTES,
            "Hosted data-key wrap IV",
          ),
        ),
        name: "AES-GCM",
      },
      wrapKey,
      toArrayBuffer(decodeBase64(wrap.ciphertext)),
    ),
  );

  return requireDataKeyBytes(plaintext, "Hosted unwrapped data key");
}

export function parseHostedDataKeyEnvelope(
  value: unknown,
  label = "Hosted data-key envelope",
): HostedDataKeyEnvelopeV1 {
  const record = requireRecord(value, label);
  const schema = requireLiteral(
    record.schema,
    HOSTED_DATA_KEY_ENVELOPE_SCHEMA,
    `${label}.schema`,
  );
  const alg = requireLiteral(
    record.alg,
    "AES-256-GCM-HKDF-SHA256",
    `${label}.alg`,
  );
  const domain = requireHostedDataKeyDomain(record.domain, `${label}.domain`);
  const lane = requireHostedDataKeyLane(record.lane, `${label}.lane`);
  assertDataKeyLaneDomain({ domain, lane });
  const rootKeyId = requireNonEmptyString(record.rootKeyId, `${label}.rootKeyId`);
  const envelope: HostedDataKeyEnvelopeV1 = {
    alg,
    dataKeyId: requireNonEmptyString(record.dataKeyId, `${label}.dataKeyId`),
    domain,
    lane,
    resource: parseHostedDataKeyResource(record.resource, `${label}.resource`),
    rootKeyId,
    schema,
    wraps: requireArray(record.wraps, `${label}.wraps`).map((entry, index) =>
      parseHostedDataKeyDomainRootWrap(entry, `${label}.wraps[${index}]`),
    ),
  };
  if (!envelope.wraps.some((wrap) => wrap.rootKeyId === rootKeyId)) {
    throw new TypeError(
      `${label}.wraps must include a domain-root wrap for rootKeyId.`,
    );
  }
  return envelope;
}

async function deriveHostedDataKeyRootWrapKey(input: {
  alg: "AES-256-GCM-HKDF-SHA256";
  dataKeyId: string;
  domain: HostedCryptoDomain;
  lane: HostedCryptoLane;
  resource: HostedDataKeyResourceV1;
  rootKey: Uint8Array;
  rootKeyId: string;
  schema: typeof HOSTED_DATA_KEY_ENVELOPE_SCHEMA;
}): Promise<CryptoKey> {
  const rootKey = requireDataKeyRootKeyBytes(
    input.rootKey,
    "Hosted data-key root key",
  );
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(rootKey),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      hash: "SHA-256",
      info: toArrayBuffer(buildHostedDataKeyRootWrapAad(input)),
      name: "HKDF",
      salt: HOSTED_DATA_KEY_WRAP_SALT,
    },
    keyMaterial,
    { length: 256, name: "AES-GCM" },
    false,
    ["decrypt", "encrypt"],
  );
}

function buildHostedDataKeyRootWrapAad(input: {
  alg: "AES-256-GCM-HKDF-SHA256";
  dataKeyId: string;
  domain: HostedCryptoDomain;
  lane: HostedCryptoLane;
  resource: HostedDataKeyResourceV1;
  rootKeyId: string;
  schema: typeof HOSTED_DATA_KEY_ENVELOPE_SCHEMA;
}): Uint8Array {
  return new TextEncoder().encode(canonicalJson({
    alg: input.alg,
    dataKeyId: input.dataKeyId,
    domain: input.domain,
    lane: input.lane,
    resource: input.resource,
    rootKeyId: input.rootKeyId,
    schema: input.schema,
    wrapKind: "domain-root",
  }));
}

function normalizeHostedDataKeyResource(
  resource: HostedDataKeyResourceV1,
): HostedDataKeyResourceV1 {
  const objectKey = normalizeOptionalString(resource.objectKey);
  const rowId = normalizeOptionalString(resource.rowId);
  const table = normalizeOptionalString(resource.table);

  return {
    ...(objectKey ? { objectKey } : {}),
    purpose: requireNonEmptyString(
      resource.purpose,
      "Hosted data-key resource purpose",
    ),
    ...(rowId ? { rowId } : {}),
    ...(table ? { table } : {}),
    userId: requireNonEmptyString(resource.userId, "Hosted data-key resource userId"),
  };
}

function parseHostedDataKeyResource(
  value: unknown,
  label: string,
): HostedDataKeyResourceV1 {
  const record = requireRecord(value, label);
  return normalizeHostedDataKeyResource({
    ...(record.objectKey === undefined
      ? {}
      : { objectKey: requireNonEmptyString(record.objectKey, `${label}.objectKey`) }),
    purpose: requireNonEmptyString(record.purpose, `${label}.purpose`),
    ...(record.rowId === undefined
      ? {}
      : { rowId: requireNonEmptyString(record.rowId, `${label}.rowId`) }),
    ...(record.table === undefined
      ? {}
      : { table: requireNonEmptyString(record.table, `${label}.table`) }),
    userId: requireNonEmptyString(record.userId, `${label}.userId`),
  });
}

function parseHostedDataKeyDomainRootWrap(
  value: unknown,
  label: string,
): HostedDataKeyDomainRootWrapV1 {
  const record = requireRecord(value, label);
  return {
    ciphertext: requireNonEmptyString(record.ciphertext, `${label}.ciphertext`),
    iv: requireNonEmptyString(record.iv, `${label}.iv`),
    kind: requireLiteral(record.kind, "domain-root", `${label}.kind`),
    rootKeyId: requireNonEmptyString(record.rootKeyId, `${label}.rootKeyId`),
  };
}

function assertDataKeyLaneDomain(input: {
  domain: HostedCryptoDomain;
  lane: HostedCryptoLane;
}): void {
  const expectedDomain = getHostedCryptoDomainForLane(input.lane);
  if (expectedDomain !== input.domain) {
    throw new TypeError(
      `Hosted data-key lane ${input.lane} belongs to ${expectedDomain}, not ${input.domain}.`,
    );
  }
}

function requireHostedDataKeyDomain(
  value: unknown,
  label: string,
): HostedCryptoDomain {
  if (typeof value === "string" && isHostedCryptoDomain(value)) {
    return value;
  }
  throw new TypeError(`${label} must be a hosted crypto domain.`);
}

function requireHostedDataKeyLane(
  value: unknown,
  label: string,
): HostedCryptoLane {
  if (typeof value === "string" && isHostedCryptoLane(value)) {
    return value;
  }
  throw new TypeError(`${label} must be a hosted crypto lane.`);
}

function requireDataKeyBytes(value: Uint8Array, label: string): Uint8Array {
  if (value.byteLength !== HOSTED_DATA_KEY_BYTES) {
    throw new TypeError(`${label} must be ${HOSTED_DATA_KEY_BYTES} bytes.`);
  }
  return value;
}

function requireDataKeyRootKeyBytes(
  value: Uint8Array,
  label: string,
): Uint8Array {
  if (value.byteLength !== 32) {
    throw new TypeError(`${label} must be 32 bytes.`);
  }
  return value;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }
  return value.slice();
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function requireLiteral<TLiteral extends string>(
  value: unknown,
  literal: TLiteral,
  label: string,
): TLiteral {
  if (value !== literal) {
    throw new TypeError(`${label} must be ${literal}.`);
  }
  return literal;
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJson(entry)]),
    );
  }
  return value;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
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

function decodeFixedBase64(
  value: string,
  expectedBytes: number,
  label: string,
): Uint8Array {
  const decoded = decodeBase64(value);
  if (decoded.byteLength !== expectedBytes) {
    throw new TypeError(`${label} must decode to ${expectedBytes} bytes.`);
  }
  return decoded;
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength,
  ) as ArrayBuffer;
}
