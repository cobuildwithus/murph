import {
  buildHostedDomainRootWrapContext,
  buildHostedSecureBoxAad,
  createHostedDomainRootKeyId,
  createHostedRecipientPrivateKeyring,
  generateHostedDomainRootKey,
  openHostedSecureBox,
  parseHostedEcdhWrappedDomainRootKey,
  parseHostedSecureBoxEnvelope,
  parseHostedUserRecipientPrivateKeyJwk,
  sealHostedSecureBox,
  selectHostedRecipientPrivateKeyForDecrypt,
  unwrapHostedDomainRootKeyWithP256Ecdh,
  wrapHostedDomainRootKeyWithP256Ecdh,
  type HostedEcdhWrappedDomainRootKey,
  type HostedRecipientPrivateKeyring,
  type HostedSecureBoxEnvelopeV1,
} from "@murphai/runtime-state";

export const DEVICE_WEBHOOK_QUEUE_ENVELOPE_SCHEMA =
  "murph.device-webhook-queue-envelope.v1" as const;
export const DEVICE_WEBHOOK_QUEUE_PAYLOAD_SCHEMA =
  "murph.device-webhook-queue-payload.v1" as const;
export const DEVICE_WEBHOOK_ADMISSION_BATCH_SCHEMA =
  "murph.device-webhook-admission-batch.v1" as const;
export const DEVICE_WEBHOOK_ADMISSION_RESULT_SCHEMA =
  "murph.device-webhook-admission-result.v1" as const;
export const CLOUDFLARE_HOSTED_CONTROL_DEVICE_WEBHOOK_ENQUEUE_PATH =
  "/internal/device-webhooks/enqueue" as const;
export const HOSTED_DEVICE_WEBHOOK_ADMISSION_PATH =
  "/api/internal/device-sync/webhooks/admit-batch" as const;
export const DEVICE_WEBHOOK_TRANSPORT_USER_ID =
  "device-webhook-transport" as const;
export const DEVICE_WEBHOOK_QUEUE_MAX_BATCH_SIZE = 100;
export const DEVICE_WEBHOOK_ADMISSION_MAX_BATCH_SIZE = 25;
export const DEVICE_WEBHOOK_QUEUE_MAX_RAW_BODY_BYTES = 32 * 1024;
export const DEVICE_WEBHOOK_QUEUE_MAX_HEADER_BYTES = 8 * 1024;
export const DEVICE_WEBHOOK_QUEUE_MAX_ENVELOPE_BYTES = 120 * 1024;
export const DEVICE_WEBHOOK_ADMISSION_MAX_BODY_BYTES = 2 * 1024 * 1024;
export const DEVICE_WEBHOOK_ADMISSION_HANDLER_MAX_DURATION_SECONDS = 90;
export const DEVICE_WEBHOOK_ADMISSION_TIMEOUT_MS = 110_000;

const DEVICE_WEBHOOK_QUEUE_MAX_HEADERS = 64;
const DEVICE_WEBHOOK_QUEUE_MAX_PROVIDER_LENGTH = 64;
const DEVICE_WEBHOOK_QUEUE_MAX_HEADER_NAME_LENGTH = 128;
const DEVICE_WEBHOOK_QUEUE_MAX_HEADER_VALUE_LENGTH = 4 * 1024;
const DEVICE_WEBHOOK_SIGNATURE_HEADER_NAMES = new Set([
  "svix-id",
  "svix-signature",
  "svix-timestamp",
  "x-oura-signature",
  "x-oura-timestamp",
  "x-strava-signature",
  "x-whoop-signature",
  "x-whoop-signature-timestamp",
]);
const DEVICE_WEBHOOK_QUEUE_PROVIDER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const DEVICE_WEBHOOK_HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u;
const DEVICE_WEBHOOK_QUEUE_TRANSPORT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DEVICE_WEBHOOK_QUEUE_ROOT_KEY_ID_PATTERN =
  /^udrk:ingress:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

export interface DeviceWebhookTransportHeader {
  name: string;
  value: string;
}

export interface DeviceWebhookQueuePayloadV1 {
  headers: DeviceWebhookTransportHeader[];
  provider: string;
  rawBodyBase64: string;
  receivedAt: string;
  schema: typeof DEVICE_WEBHOOK_QUEUE_PAYLOAD_SCHEMA;
  transportId: string;
}

export interface DeviceWebhookQueueEnvelopeV1 {
  encryptedPayload: HostedSecureBoxEnvelopeV1;
  rootKeyWrap: HostedEcdhWrappedDomainRootKey;
  schema: typeof DEVICE_WEBHOOK_QUEUE_ENVELOPE_SCHEMA;
  transportId: string;
}

export interface DeviceWebhookAdmissionBatchV1 {
  entries: DeviceWebhookQueuePayloadV1[];
  schema: typeof DEVICE_WEBHOOK_ADMISSION_BATCH_SCHEMA;
}

export type DeviceWebhookAdmissionDisposition =
  | "accepted"
  | "duplicate"
  | "retry";

export interface DeviceWebhookAdmissionResultEntry {
  disposition: DeviceWebhookAdmissionDisposition;
  transportId: string;
}

export interface DeviceWebhookAdmissionResultV1 {
  entries: DeviceWebhookAdmissionResultEntry[];
  schema: typeof DEVICE_WEBHOOK_ADMISSION_RESULT_SCHEMA;
}

export function canQueueDeviceWebhook(input: {
  headers: readonly DeviceWebhookTransportHeader[];
  rawBody: Uint8Array;
}): boolean {
  try {
    normalizeHeaders(input.headers);
    requireRawBody(input.rawBody);
    return true;
  } catch {
    return false;
  }
}

export function copyDeviceWebhookTransportHeaders(
  headers: Headers,
): DeviceWebhookTransportHeader[] {
  return normalizeHeaders(
    Array.from(headers.entries())
      .filter(([name]) => DEVICE_WEBHOOK_SIGNATURE_HEADER_NAMES.has(name.toLowerCase()))
      .map(([name, value]) => ({ name, value })),
  );
}

export async function sealDeviceWebhookQueueEnvelope(input: {
  env: string;
  headers: readonly DeviceWebhookTransportHeader[];
  provider: string;
  rawBody: Uint8Array;
  receivedAt: string;
  recipientKeyId: string;
  recipientPublicJwk: JsonWebKey;
}): Promise<DeviceWebhookQueueEnvelopeV1> {
  const transportId = requireTransportId(crypto.randomUUID());
  const payload = parseDeviceWebhookQueuePayload({
    headers: input.headers,
    provider: input.provider,
    rawBodyBase64: encodeBase64(requireRawBody(input.rawBody)),
    receivedAt: input.receivedAt,
    schema: DEVICE_WEBHOOK_QUEUE_PAYLOAD_SCHEMA,
    transportId,
  });
  const rootKey = generateHostedDomainRootKey();
  const rootKeyId = createHostedDomainRootKeyId("ingress");
  const encryptionContext = buildHostedDomainRootWrapContext({
    domain: "ingress",
    env: requireNonEmptyString(input.env, "Device webhook transport env"),
    recipient: "cloudflare-automation-secret",
    rootKeyId,
    userId: DEVICE_WEBHOOK_TRANSPORT_USER_ID,
  });
  const aad = createDeviceWebhookTransportAad(transportId);

  try {
    const [rootKeyWrap, encryptedPayload] = await Promise.all([
      wrapHostedDomainRootKeyWithP256Ecdh({
        encryptionContext,
        recipient: "cloudflare-automation-secret",
        recipientKeyId: requireNonEmptyString(
          input.recipientKeyId,
          "Device webhook transport recipient key id",
        ),
        recipientPublicJwk: input.recipientPublicJwk,
        rootKey,
      }),
      sealHostedSecureBox({
        aad,
        domain: "ingress",
        lane: "device-webhook-transport",
        plaintext: textEncoder.encode(JSON.stringify(payload)),
        rootKey,
        rootKeyId,
        scope: transportId,
      }),
    ]);
    const envelope: DeviceWebhookQueueEnvelopeV1 = {
      encryptedPayload,
      rootKeyWrap,
      schema: DEVICE_WEBHOOK_QUEUE_ENVELOPE_SCHEMA,
      transportId,
    };
    assertEnvelopeSize(envelope);
    return envelope;
  } finally {
    rootKey.fill(0);
  }
}

export async function openDeviceWebhookQueueEnvelope(input: {
  env: string;
  envelope: DeviceWebhookQueueEnvelopeV1;
  privateKeyring: HostedRecipientPrivateKeyring;
}): Promise<DeviceWebhookQueuePayloadV1> {
  const envelope = parseDeviceWebhookQueueEnvelope(input.envelope);
  assertSafeVisibleEnvelopeMetadata(envelope);
  const expectedContext = buildHostedDomainRootWrapContext({
    domain: "ingress",
    env: requireNonEmptyString(input.env, "Device webhook transport env"),
    recipient: "cloudflare-automation-secret",
    rootKeyId: envelope.encryptedPayload.rootKeyId,
    userId: DEVICE_WEBHOOK_TRANSPORT_USER_ID,
  });
  if (canonicalJson(envelope.rootKeyWrap.encryptionContext) !== canonicalJson(expectedContext)) {
    throw new Error("Device webhook transport root-key context mismatch.");
  }
  const privateKey = selectHostedRecipientPrivateKeyForDecrypt({
    keyring: input.privateKeyring,
    recipient: "cloudflare-automation-secret",
    recipientKeyId: envelope.rootKeyWrap.recipientKeyId,
  });
  const rootKey = await unwrapHostedDomainRootKeyWithP256Ecdh({
    privateJwk: privateKey.privateJwk,
    wrap: envelope.rootKeyWrap,
  });
  try {
    const plaintext = await openHostedSecureBox({
      aad: createDeviceWebhookTransportAad(envelope.transportId),
      envelope: envelope.encryptedPayload,
      expectedDomain: "ingress",
      expectedLane: "device-webhook-transport",
      expectedRootKeyId: envelope.encryptedPayload.rootKeyId,
      expectedScope: envelope.transportId,
      rootKey,
    });
    const payload = parseDeviceWebhookQueuePayload(
      JSON.parse(textDecoder.decode(plaintext)),
    );
    if (payload.transportId !== envelope.transportId) {
      throw new Error("Device webhook transport id mismatch.");
    }
    return payload;
  } finally {
    rootKey.fill(0);
  }
}

export function createDeviceWebhookTransportPrivateKeyring(input: {
  activePrivateJwk: JsonWebKey;
  activeRecipientKeyId: string;
  keyringJson?: string | null;
}): HostedRecipientPrivateKeyring {
  return createHostedRecipientPrivateKeyring({
    activePrivateJwk: input.activePrivateJwk,
    activeRecipient: "cloudflare-automation-secret",
    activeRecipientKeyId: input.activeRecipientKeyId,
    keyringJson: input.keyringJson,
  });
}

export function createDeviceWebhookTransportPrivateKeyringFromJson(input: {
  activePrivateJwkJson: string;
  activeRecipientKeyId: string;
  keyringJson?: string | null;
}): HostedRecipientPrivateKeyring {
  let activePrivateJwk: unknown;
  try {
    activePrivateJwk = JSON.parse(input.activePrivateJwkJson);
  } catch {
    throw new TypeError("Device webhook transport private JWK must be valid JSON.");
  }
  return createHostedRecipientPrivateKeyring({
    activePrivateJwk: parseHostedUserRecipientPrivateKeyJwk(
      activePrivateJwk,
      "Device webhook transport private JWK",
    ),
    activeRecipient: "cloudflare-automation-secret",
    activeRecipientKeyId: input.activeRecipientKeyId,
    keyringJson: input.keyringJson,
  });
}

export function parseDeviceWebhookQueueEnvelope(
  value: unknown,
): DeviceWebhookQueueEnvelopeV1 {
  const record = requireRecord(value, "Device webhook queue envelope");
  assertExactKeys(record, [
    "encryptedPayload",
    "rootKeyWrap",
    "schema",
    "transportId",
  ], "Device webhook queue envelope");
  const transportId = requireTransportId(record.transportId);
  const encryptedPayload = parseHostedSecureBoxEnvelope(
    record.encryptedPayload,
    "Device webhook queue envelope encryptedPayload",
  );
  if (
    encryptedPayload.domain !== "ingress"
    || encryptedPayload.lane !== "device-webhook-transport"
    || encryptedPayload.scope !== transportId
  ) {
    throw new TypeError("Device webhook queue envelope encrypted payload scope is invalid.");
  }
  const rootKeyWrap = parseHostedEcdhWrappedDomainRootKey(
    record.rootKeyWrap,
    "Device webhook queue envelope rootKeyWrap",
  );
  if (rootKeyWrap.recipient !== "cloudflare-automation-secret") {
    throw new TypeError("Device webhook queue envelope recipient is invalid.");
  }
  const envelope: DeviceWebhookQueueEnvelopeV1 = {
    encryptedPayload,
    rootKeyWrap,
    schema: requireLiteral(
      record.schema,
      DEVICE_WEBHOOK_QUEUE_ENVELOPE_SCHEMA,
      "Device webhook queue envelope schema",
    ),
    transportId,
  };
  assertEnvelopeSize(envelope);
  return envelope;
}

export async function reencryptDeviceWebhookQueueEnvelopeForPersistence(input: {
  activeRecipientKeyId: string;
  env: string;
  envelope: DeviceWebhookQueueEnvelopeV1;
  privateKeyring: HostedRecipientPrivateKeyring;
}): Promise<DeviceWebhookQueueEnvelopeV1> {
  const envelope = parseDeviceWebhookQueueEnvelope(input.envelope);
  const payload = await openDeviceWebhookQueueEnvelope({
    env: input.env,
    envelope,
    privateKeyring: input.privateKeyring,
  });
  const activePrivateKey = selectHostedRecipientPrivateKeyForDecrypt({
    keyring: input.privateKeyring,
    recipient: "cloudflare-automation-secret",
    recipientKeyId: input.activeRecipientKeyId,
  });
  if (activePrivateKey.status !== "active") {
    throw new TypeError("Device webhook persistence key must be active.");
  }
  const { crv, kty, x, y } = activePrivateKey.privateJwk;
  return sealDeviceWebhookQueueEnvelope({
    env: input.env,
    headers: payload.headers,
    provider: payload.provider,
    rawBody: decodeDeviceWebhookRawBody(payload),
    receivedAt: payload.receivedAt,
    recipientKeyId: activePrivateKey.recipientKeyId,
    recipientPublicJwk: {
      crv,
      ext: true,
      key_ops: [],
      kty,
      x,
      y,
    },
  });
}

export function parseDeviceWebhookQueuePayload(
  value: unknown,
): DeviceWebhookQueuePayloadV1 {
  const record = requireRecord(value, "Device webhook queue payload");
  assertExactKeys(record, [
    "headers",
    "provider",
    "rawBodyBase64",
    "receivedAt",
    "schema",
    "transportId",
  ], "Device webhook queue payload");
  const rawBodyBase64 = requireNonEmptyString(
    record.rawBodyBase64,
    "Device webhook queue payload rawBodyBase64",
  );
  requireRawBody(decodeBase64(rawBodyBase64));
  return {
    headers: normalizeHeaders(
      requireArray(record.headers, "Device webhook queue payload headers").map(
        (entry, index) => parseHeader(entry, index),
      ),
    ),
    provider: requireProvider(record.provider),
    rawBodyBase64,
    receivedAt: requireIsoTimestamp(record.receivedAt),
    schema: requireLiteral(
      record.schema,
      DEVICE_WEBHOOK_QUEUE_PAYLOAD_SCHEMA,
      "Device webhook queue payload schema",
    ),
    transportId: requireTransportId(record.transportId),
  };
}

export function parseDeviceWebhookAdmissionBatch(
  value: unknown,
): DeviceWebhookAdmissionBatchV1 {
  const record = requireRecord(value, "Device webhook admission batch");
  assertExactKeys(record, ["entries", "schema"], "Device webhook admission batch");
  const entries = requireArray(
    record.entries,
    "Device webhook admission batch entries",
  ).map(parseDeviceWebhookQueuePayload);
  if (entries.length === 0 || entries.length > DEVICE_WEBHOOK_ADMISSION_MAX_BATCH_SIZE) {
    throw new RangeError(
      `Device webhook admission batch must contain between 1 and ${DEVICE_WEBHOOK_ADMISSION_MAX_BATCH_SIZE} entries.`,
    );
  }
  assertUniqueTransportIds(entries);
  return {
    entries,
    schema: requireLiteral(
      record.schema,
      DEVICE_WEBHOOK_ADMISSION_BATCH_SCHEMA,
      "Device webhook admission batch schema",
    ),
  };
}

export function parseDeviceWebhookAdmissionResult(
  value: unknown,
): DeviceWebhookAdmissionResultV1 {
  const record = requireRecord(value, "Device webhook admission result");
  assertExactKeys(record, ["entries", "schema"], "Device webhook admission result");
  const entries = requireArray(
    record.entries,
    "Device webhook admission result entries",
  ).map((value, index) => {
    const entry = requireRecord(value, `Device webhook admission result entries[${index}]`);
    assertExactKeys(
      entry,
      ["disposition", "transportId"],
      `Device webhook admission result entries[${index}]`,
    );
    return {
      disposition: requireDisposition(entry.disposition),
      transportId: requireTransportId(entry.transportId),
    };
  });
  if (entries.length > DEVICE_WEBHOOK_QUEUE_MAX_BATCH_SIZE) {
    throw new RangeError("Device webhook admission result has too many entries.");
  }
  assertUniqueTransportIds(entries);
  return {
    entries,
    schema: requireLiteral(
      record.schema,
      DEVICE_WEBHOOK_ADMISSION_RESULT_SCHEMA,
      "Device webhook admission result schema",
    ),
  };
}

export function decodeDeviceWebhookRawBody(payload: DeviceWebhookQueuePayloadV1): Uint8Array {
  return requireRawBody(decodeBase64(payload.rawBodyBase64));
}

export function createDeviceWebhookHeaders(payload: DeviceWebhookQueuePayloadV1): Headers {
  return new Headers(
    payload.headers.map(({ name, value }): [string, string] => [name, value]),
  );
}

function createDeviceWebhookTransportAad(transportId: string): Uint8Array {
  return buildHostedSecureBoxAad({
    domain: "ingress",
    lane: "device-webhook-transport",
    purpose: "device-webhook-queue-transport",
    scope: requireTransportId(transportId),
    userId: DEVICE_WEBHOOK_TRANSPORT_USER_ID,
  });
}

function parseHeader(value: unknown, index: number): DeviceWebhookTransportHeader {
  const label = `Device webhook queue payload headers[${index}]`;
  const record = requireRecord(value, label);
  assertExactKeys(record, ["name", "value"], label);
  return {
    name: requireHeaderName(record.name, `${label}.name`),
    value: requireHeaderValue(record.value, `${label}.value`),
  };
}

function normalizeHeaders(
  input: readonly DeviceWebhookTransportHeader[],
): DeviceWebhookTransportHeader[] {
  if (input.length > DEVICE_WEBHOOK_QUEUE_MAX_HEADERS) {
    throw new RangeError("Device webhook transport has too many headers.");
  }
  const headers = input.map((entry, index) => ({
    name: requireHeaderName(entry.name, `Device webhook transport header ${index} name`),
    value: requireHeaderValue(entry.value, `Device webhook transport header ${index} value`),
  }));
  if (headers.some(({ name }) => !DEVICE_WEBHOOK_SIGNATURE_HEADER_NAMES.has(name))) {
    throw new TypeError("Device webhook transport contains an unrelated header.");
  }
  if (new Set(headers.map(({ name }) => name)).size !== headers.length) {
    throw new TypeError("Device webhook transport contains duplicate headers.");
  }
  const totalBytes = headers.reduce(
    (sum, entry) => sum + textEncoder.encode(entry.name).byteLength
      + textEncoder.encode(entry.value).byteLength,
    0,
  );
  if (totalBytes > DEVICE_WEBHOOK_QUEUE_MAX_HEADER_BYTES) {
    throw new RangeError("Device webhook transport headers are too large.");
  }
  return headers;
}

function requireRawBody(value: Uint8Array): Uint8Array {
  if (value.byteLength > DEVICE_WEBHOOK_QUEUE_MAX_RAW_BODY_BYTES) {
    throw new RangeError("Device webhook transport body is too large.");
  }
  return value;
}

function requireProvider(value: unknown): string {
  const provider = requireNonEmptyString(value, "Device webhook transport provider");
  if (
    provider.length > DEVICE_WEBHOOK_QUEUE_MAX_PROVIDER_LENGTH
    || !DEVICE_WEBHOOK_QUEUE_PROVIDER_PATTERN.test(provider)
  ) {
    throw new TypeError("Device webhook transport provider is invalid.");
  }
  return provider;
}

function requireHeaderName(value: unknown, label: string): string {
  const name = requireNonEmptyString(value, label).toLowerCase();
  if (
    name.length > DEVICE_WEBHOOK_QUEUE_MAX_HEADER_NAME_LENGTH
    || !DEVICE_WEBHOOK_HEADER_NAME_PATTERN.test(name)
  ) {
    throw new TypeError(`${label} is invalid.`);
  }
  return name;
}

function requireHeaderValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length > DEVICE_WEBHOOK_QUEUE_MAX_HEADER_VALUE_LENGTH) {
    throw new TypeError(`${label} is invalid.`);
  }
  try {
    new Headers({ "x-device-webhook-value": value });
  } catch {
    throw new TypeError(`${label} is invalid.`);
  }
  return value;
}

function requireIsoTimestamp(value: unknown): string {
  const timestamp = requireNonEmptyString(value, "Device webhook transport receivedAt");
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== timestamp) {
    throw new TypeError("Device webhook transport receivedAt must be a canonical ISO timestamp.");
  }
  return timestamp;
}

function requireTransportId(value: unknown): string {
  const transportId = requireNonEmptyString(value, "Device webhook transport id");
  if (!DEVICE_WEBHOOK_QUEUE_TRANSPORT_ID_PATTERN.test(transportId)) {
    throw new TypeError("Device webhook transport id must be a lowercase UUID v4.");
  }
  return transportId;
}

function requireDisposition(value: unknown): DeviceWebhookAdmissionDisposition {
  if (value === "accepted" || value === "duplicate" || value === "retry") {
    return value;
  }
  throw new TypeError("Device webhook admission disposition is invalid.");
}

function assertUniqueTransportIds(
  entries: readonly { transportId: string }[],
): void {
  if (new Set(entries.map((entry) => entry.transportId)).size !== entries.length) {
    throw new TypeError("Device webhook batch transport ids must be unique.");
  }
}

function assertEnvelopeSize(envelope: DeviceWebhookQueueEnvelopeV1): void {
  if (textEncoder.encode(JSON.stringify(envelope)).byteLength > DEVICE_WEBHOOK_QUEUE_MAX_ENVELOPE_BYTES) {
    throw new RangeError("Device webhook queue envelope is too large.");
  }
}

function assertSafeVisibleEnvelopeMetadata(
  envelope: DeviceWebhookQueueEnvelopeV1,
): void {
  if (!DEVICE_WEBHOOK_QUEUE_ROOT_KEY_ID_PATTERN.test(envelope.encryptedPayload.rootKeyId)) {
    throw new TypeError("Device webhook queue root key id is invalid.");
  }
  requireCanonicalBase64Bytes(
    envelope.encryptedPayload.iv,
    12,
    "Device webhook queue payload IV",
  );
  requireCanonicalBase64Bytes(
    envelope.rootKeyWrap.iv,
    12,
    "Device webhook queue root wrap IV",
  );
  requireCanonicalBase64Bytes(
    envelope.rootKeyWrap.ciphertext,
    48,
    "Device webhook queue wrapped root",
  );
  requireCanonicalBase64(
    envelope.encryptedPayload.ciphertext,
    "Device webhook queue payload ciphertext",
  );
}

function requireCanonicalBase64Bytes(
  value: string,
  expectedBytes: number,
  label: string,
): void {
  const decoded = requireCanonicalBase64(value, label);
  if (decoded.byteLength !== expectedBytes) {
    throw new TypeError(`${label} must decode to ${expectedBytes} bytes.`);
  }
}

function requireCanonicalBase64(value: string, label: string): Uint8Array {
  let decoded: Uint8Array;
  try {
    decoded = decodeBase64(value);
  } catch {
    throw new TypeError(`${label} must be valid base64.`);
  }
  if (encodeBase64(decoded) !== value) {
    throw new TypeError(`${label} must use canonical base64.`);
  }
  return decoded;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return Object.fromEntries(Object.entries(value));
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }
  return value;
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new TypeError(`${label} must be a non-empty trimmed string.`);
  }
  return value;
}

function requireLiteral<const T extends string>(
  value: unknown,
  expected: T,
  label: string,
): T {
  if (value !== expected) {
    throw new TypeError(`${label} must be ${expected}.`);
  }
  return expected;
}

function assertExactKeys(
  record: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(record).sort();
  const sortedExpected = [...expected].sort();
  if (actual.length !== sortedExpected.length || actual.some((key, index) => key !== sortedExpected[index])) {
    throw new TypeError(`${label} contains unexpected fields.`);
  }
}

function encodeBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new TypeError("Device webhook transport body must be valid base64.");
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (encodeBase64(bytes) !== value) {
    throw new TypeError("Device webhook transport body must use canonical base64.");
  }
  return bytes;
}

function canonicalJson(value: Record<string, string>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))));
}
