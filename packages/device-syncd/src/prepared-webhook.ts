import type {
  DeviceSyncJobInput,
  DeviceSyncWebhookAcceptanceMode,
  DeviceSyncWebhookExternalAccountDiagnostic,
} from "./types.ts";

export const DEVICE_SYNC_PREPARED_WEBHOOK_SCHEMA =
  "murph.device-sync-prepared-webhook.v1" as const;

const PREPARED_WEBHOOK_PROVIDER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const PREPARED_WEBHOOK_TRACE_ID_PATTERN = /^[0-9a-f]{64}$/u;
const PREPARED_WEBHOOK_MAX_SERIALIZED_BYTES = 64 * 1024;
const PREPARED_WEBHOOK_MAX_JOBS = 100;
const PREPARED_WEBHOOK_MAX_PAYLOAD_FIELDS = 64;
const PREPARED_WEBHOOK_MAX_STRING_LENGTH = 32 * 1024;
const textEncoder = new TextEncoder();

/**
 * Provider-authenticated webhook meaning frozen at public ingress.
 *
 * Queue consumers must keep every previously emitted schema decoder readable
 * through the maximum Queue/DLQ retention and redrive horizon. Current
 * connection, consent, source, and provider authority are deliberately not
 * frozen here and are revalidated when this prepared event is admitted.
 */
export interface PreparedDeviceSyncWebhookV1 {
  acceptanceMode: DeviceSyncWebhookAcceptanceMode;
  dataSourceProviderSlug?: string | null;
  eventType: string;
  externalAccountDiagnostic?: DeviceSyncWebhookExternalAccountDiagnostic;
  externalAccountId: string;
  jobs: DeviceSyncJobInput[];
  occurredAt?: string;
  provider: string;
  providerSentAt?: string;
  receivedAt: string;
  resourceCategory?: string | null;
  schema: typeof DEVICE_SYNC_PREPARED_WEBHOOK_SCHEMA;
  sourceProviderSlug?: string | null;
  traceId: string;
  unknownAccountAction?: "accept" | "retry";
}

export function parsePreparedDeviceSyncWebhook(
  value: unknown,
): PreparedDeviceSyncWebhookV1 {
  const record = requireRecord(value, "Prepared device webhook");
  assertExactKeys(record, [
    "acceptanceMode",
    "dataSourceProviderSlug",
    "eventType",
    "externalAccountDiagnostic",
    "externalAccountId",
    "jobs",
    "occurredAt",
    "provider",
    "providerSentAt",
    "receivedAt",
    "resourceCategory",
    "schema",
    "sourceProviderSlug",
    "traceId",
    "unknownAccountAction",
  ], "Prepared device webhook");

  const jobs = requireArray(record.jobs, "Prepared device webhook jobs")
    .map(parsePreparedJob);
  if (jobs.length > PREPARED_WEBHOOK_MAX_JOBS) {
    throw new RangeError("Prepared device webhook has too many jobs.");
  }

  const prepared: PreparedDeviceSyncWebhookV1 = {
    acceptanceMode: requireAcceptanceMode(record.acceptanceMode),
    eventType: requireString(record.eventType, "Prepared device webhook event type"),
    externalAccountId: requireString(
      record.externalAccountId,
      "Prepared device webhook external account id",
    ),
    jobs,
    provider: requireProvider(record.provider),
    receivedAt: requireIsoTimestamp(
      record.receivedAt,
      "Prepared device webhook receipt time",
    ),
    schema: requireLiteral(
      record.schema,
      DEVICE_SYNC_PREPARED_WEBHOOK_SCHEMA,
      "Prepared device webhook schema",
    ),
    traceId: requireTraceId(record.traceId),
    ...(record.dataSourceProviderSlug !== undefined
      ? {
          dataSourceProviderSlug: requireNullableString(
            record.dataSourceProviderSlug,
            "Prepared device webhook data source",
          ),
        }
      : {}),
    ...(record.externalAccountDiagnostic !== undefined
      ? {
          externalAccountDiagnostic: parseExternalAccountDiagnostic(
            record.externalAccountDiagnostic,
          ),
        }
      : {}),
    ...(record.occurredAt !== undefined
      ? {
          occurredAt: requireIsoTimestamp(
            record.occurredAt,
            "Prepared device webhook occurrence time",
          ),
        }
      : {}),
    ...(record.providerSentAt !== undefined
      ? {
          providerSentAt: requireIsoTimestamp(
            record.providerSentAt,
            "Prepared device webhook provider send time",
          ),
        }
      : {}),
    ...(record.resourceCategory !== undefined
      ? {
          resourceCategory: requireNullableString(
            record.resourceCategory,
            "Prepared device webhook resource category",
          ),
        }
      : {}),
    ...(record.sourceProviderSlug !== undefined
      ? {
          sourceProviderSlug: requireNullableString(
            record.sourceProviderSlug,
            "Prepared device webhook source",
          ),
        }
      : {}),
    ...(record.unknownAccountAction !== undefined
      ? {
          unknownAccountAction: requireUnknownAccountAction(
            record.unknownAccountAction,
          ),
        }
      : {}),
  };

  if (
    textEncoder.encode(JSON.stringify(prepared)).byteLength
      > PREPARED_WEBHOOK_MAX_SERIALIZED_BYTES
  ) {
    throw new RangeError("Prepared device webhook is too large.");
  }
  return prepared;
}

function parsePreparedJob(value: unknown, index: number): DeviceSyncJobInput {
  const label = `Prepared device webhook jobs[${index}]`;
  const record = requireRecord(value, label);
  assertExactKeys(record, [
    "availableAt",
    "dedupeKey",
    "kind",
    "maxAttempts",
    "payload",
    "priority",
  ], label);
  return {
    kind: requireString(record.kind, `${label} kind`),
    ...(record.availableAt !== undefined
      ? { availableAt: requireIsoTimestamp(record.availableAt, `${label} availableAt`) }
      : {}),
    ...(record.dedupeKey !== undefined
      ? { dedupeKey: requireString(record.dedupeKey, `${label} dedupeKey`) }
      : {}),
    ...(record.maxAttempts !== undefined
      ? { maxAttempts: requirePositiveInteger(record.maxAttempts, `${label} maxAttempts`) }
      : {}),
    ...(record.payload !== undefined
      ? { payload: parsePreparedJobPayload(record.payload, `${label} payload`) }
      : {}),
    ...(record.priority !== undefined
      ? { priority: requireFiniteNumber(record.priority, `${label} priority`) }
      : {}),
  };
}

function parsePreparedJobPayload(
  value: unknown,
  label: string,
): Record<string, unknown> {
  const record = requireRecord(value, label);
  const entries = Object.entries(record);
  if (entries.length > PREPARED_WEBHOOK_MAX_PAYLOAD_FIELDS) {
    throw new RangeError(`${label} has too many fields.`);
  }
  return Object.fromEntries(entries.map(([key, fieldValue]) => [
    requireString(key, `${label} field name`),
    parsePreparedJobPayloadValue(fieldValue, `${label}.${key}`),
  ]));
}

function parsePreparedJobPayloadValue(
  value: unknown,
  label: string,
): boolean | number | string | string[] {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return requireFiniteNumber(value, label);
  if (typeof value === "string") return requireString(value, label, true);
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      requireString(entry, `${label}[${index}]`, true));
  }
  throw new TypeError(`${label} has an unsupported value.`);
}

function parseExternalAccountDiagnostic(
  value: unknown,
): DeviceSyncWebhookExternalAccountDiagnostic {
  const label = "Prepared device webhook external account diagnostic";
  const record = requireRecord(value, label);
  assertExactKeys(record, [
    "candidates",
    "selectedExternalAccountIdHash",
    "selectedPath",
  ], label);
  const candidates = requireArray(record.candidates, `${label} candidates`)
    .map((candidate, index) => {
      const candidateLabel = `${label} candidates[${index}]`;
      const candidateRecord = requireRecord(candidate, candidateLabel);
      assertExactKeys(candidateRecord, [
        "kind",
        "path",
        "selected",
        "valueHash",
      ], candidateLabel);
      return {
        kind: requireDiagnosticCandidateKind(candidateRecord.kind),
        path: requireString(candidateRecord.path, `${candidateLabel} path`),
        selected: requireBoolean(candidateRecord.selected, `${candidateLabel} selected`),
        valueHash: requireHash(candidateRecord.valueHash, `${candidateLabel} value hash`),
      };
    });
  return {
    candidates,
    selectedExternalAccountIdHash: requireHash(
      record.selectedExternalAccountIdHash,
      `${label} selected hash`,
    ),
    selectedPath: requireNullableString(record.selectedPath, `${label} selected path`),
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return Object.fromEntries(Object.entries(value));
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  return value;
}

function assertExactKeys(
  record: Record<string, unknown>,
  allowedKeys: readonly string[],
  label: string,
): void {
  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(record).find((key) => !allowed.has(key));
  if (unexpected) throw new TypeError(`${label} contains unsupported field ${unexpected}.`);
}

function requireString(
  value: unknown,
  label: string,
  allowEmpty = false,
): string {
  if (
    typeof value !== "string"
    || (!allowEmpty && value.length === 0)
    || value.length > PREPARED_WEBHOOK_MAX_STRING_LENGTH
  ) {
    throw new TypeError(`${label} must be a bounded string.`);
  }
  return value;
}

function requireNullableString(value: unknown, label: string): string | null {
  return value === null ? null : requireString(value, label);
}

function requireIsoTimestamp(value: unknown, label: string): string {
  const timestamp = requireString(value, label);
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== timestamp) {
    throw new TypeError(`${label} must be a canonical ISO timestamp.`);
  }
  return timestamp;
}

function requireProvider(value: unknown): string {
  const provider = requireString(value, "Prepared device webhook provider");
  if (!PREPARED_WEBHOOK_PROVIDER_PATTERN.test(provider)) {
    throw new TypeError("Prepared device webhook provider is invalid.");
  }
  return provider;
}

function requireTraceId(value: unknown): string {
  const traceId = requireString(value, "Prepared device webhook trace id");
  if (!PREPARED_WEBHOOK_TRACE_ID_PATTERN.test(traceId)) {
    throw new TypeError("Prepared device webhook trace id is invalid.");
  }
  return traceId;
}

function requireHash(value: unknown, label: string): string {
  const hash = requireString(value, label);
  if (!PREPARED_WEBHOOK_TRACE_ID_PATTERN.test(hash)) {
    throw new TypeError(`${label} must be a SHA-256 hash.`);
  }
  return hash;
}

function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be finite.`);
  }
  return value;
}

function requirePositiveInteger(value: unknown, label: string): number {
  const number = requireFiniteNumber(value, label);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return number;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${label} must be boolean.`);
  return value;
}

function requireAcceptanceMode(value: unknown): DeviceSyncWebhookAcceptanceMode {
  if (value === "level_dirty_hint" || value === "durable_webhook_work") return value;
  throw new TypeError("Prepared device webhook acceptance mode is invalid.");
}

function requireUnknownAccountAction(value: unknown): "accept" | "retry" {
  if (value === "accept" || value === "retry") return value;
  throw new TypeError("Prepared device webhook unknown-account action is invalid.");
}

function requireDiagnosticCandidateKind(
  value: unknown,
): "client_user_id" | "external_account_id" {
  if (value === "client_user_id" || value === "external_account_id") return value;
  throw new TypeError("Prepared device webhook diagnostic candidate kind is invalid.");
}

function requireLiteral<Literal extends string>(
  value: unknown,
  expected: Literal,
  label: string,
): Literal {
  if (value !== expected) throw new TypeError(`${label} is unsupported.`);
  return expected;
}
