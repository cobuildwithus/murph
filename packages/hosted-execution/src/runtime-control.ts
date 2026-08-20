import type {
  HostedExecutionSnapshotRefState,
} from "./bundles.ts";
import type {
  HostedExecutionDeviceSyncRuntimeApplyRequest,
  HostedExecutionDeviceSyncRuntimeSnapshotRequest,
  HostedExecutionDeviceSyncWakeHint,
} from "@murphai/device-syncd/hosted-runtime";
import type {
  AssistantRuntimeIssueRecord,
} from "@murphai/runtime-state/node";
import type {
  AssistantUsageRecord,
  AssistantUsageTokenPricingBasis,
} from "./assistant-usage.ts";
import type {
  HostedAssistantCustomInferenceOverride,
} from "./assistant-inference.ts";
import type {
  HostedAssistantModelOverride,
  HostedAssistantProductModel,
  HostedAssistantProvider,
  HostedAssistantProviderOverride,
  HostedAssistantReasoningEffort,
  HostedAssistantReasoningEffortOverride,
} from "./assistant-model.ts";
import type {
  HostedExecutionAcceptedGroupMessageParticipant,
  HostedExecutionAssistantAskOrigin,
  HostedExecutionAssistantAskResult,
  HostedExecutionDailyMetricReportedPayload,
  HostedBrowserVaultReplicaCursorRef,
  HostedBrowserVaultReplicaRef,
  HostedExecutionLinqExternalThreadRouteAuthority,
} from "./contracts.ts";
import {
  HOSTED_EXECUTION_ASSISTANT_ASK_PERMISSION_TEXT_MAX_CODE_POINTS,
  HOSTED_EXECUTION_RUNTIME_CONTROL_WAKE_KINDS,
} from "./contracts.ts";

import type {
  HostedVaultShareDeliveryRecord,
  HostedVaultShareProjectionKind,
  HostedVaultShareProjectionScope,
  HostedVaultShareSelectableProjectionKind,
  HostedVaultShareSelectableProjectionScope,
} from "./vault-share.ts";
import {
  HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS,
} from "./vault-share-limits.ts";
import type {
  HostedRuntimePendingGroupSetupInput,
} from "./pending-group-setup.ts";

export const HOSTED_MAILBOX_LANES = [
  "system",
  "conversation",
] as const;

export type HostedMailboxLane = (typeof HOSTED_MAILBOX_LANES)[number];

export const HOSTED_RUNTIME_FAILURE_PHASE_NAMES = [
  "browser_vault.refresh",
  "codex.prepare",
  "foreground.pass",
  "mailbox.import.initial",
  "runtime",
  "runtime.return",
  "workspace.checkpoint.durable_effect",
  "workspace.checkpoint.idle_compact",
  "workspace.checkpoint.idle_shutdown",
  "workspace.read",
  "workspace.restore",
] as const;

export type HostedRuntimeFailurePhaseName =
  (typeof HOSTED_RUNTIME_FAILURE_PHASE_NAMES)[number];
export type HostedRuntimeFailurePhaseCode =
  `runtime_phase:${HostedRuntimeFailurePhaseName}`;

const HOSTED_RUNTIME_FAILURE_PHASE_CODES = new Set<string>(
  HOSTED_RUNTIME_FAILURE_PHASE_NAMES.map(
    (phase): HostedRuntimeFailurePhaseCode => `runtime_phase:${phase}`,
  ),
);

const HOSTED_RUNTIME_FAILURE_PHASE_CODE_PROPERTY =
  "hostedRuntimeFailurePhaseCode";

export const HOSTED_RUNTIME_FAILURE_PHASE_CODE_DETAIL_KEY =
  "runtimeFailurePhaseCode";

export function buildHostedRuntimeFailurePhaseCode(
  phase: HostedRuntimeFailurePhaseName,
): HostedRuntimeFailurePhaseCode {
  return `runtime_phase:${phase}`;
}

export function isHostedRuntimeFailurePhaseCode(
  value: unknown,
): value is HostedRuntimeFailurePhaseCode {
  return typeof value === "string"
    && HOSTED_RUNTIME_FAILURE_PHASE_CODES.has(value);
}

export function attachHostedRuntimeFailurePhaseCode(
  error: unknown,
  phase: HostedRuntimeFailurePhaseName,
): unknown {
  if (!(error instanceof Error) || readHostedRuntimeFailurePhaseCode(error)) {
    return error;
  }

  try {
    Object.defineProperty(error, HOSTED_RUNTIME_FAILURE_PHASE_CODE_PROPERTY, {
      configurable: false,
      enumerable: false,
      value: buildHostedRuntimeFailurePhaseCode(phase),
      writable: false,
    });
  } catch {
    // Diagnostics are fail-open: frozen or hostile errors retain their
    // original behavior when the optional phase cannot be attached.
  }
  return error;
}

export function readHostedRuntimeFailurePhaseCode(
  error: unknown,
): HostedRuntimeFailurePhaseCode | null {
  try {
    if (!error || typeof error !== "object") {
      return null;
    }
    const descriptor = Object.getOwnPropertyDescriptor(
      error,
      HOSTED_RUNTIME_FAILURE_PHASE_CODE_PROPERTY,
    );
    return descriptor && "value" in descriptor
      && isHostedRuntimeFailurePhaseCode(descriptor.value)
      ? descriptor.value
      : null;
  } catch {
    return null;
  }
}

// Migration-only reader metadata. Remove after one mailbox retention window
// has elapsed since the old producer was retired and no retained rows remain.
export const HOSTED_RETIRED_MAILBOX_KINDS = [
  "group-newsletter.email-needed",
] as const;

export type HostedRetiredMailboxKind =
  (typeof HOSTED_RETIRED_MAILBOX_KINDS)[number];

export const HOSTED_MAILBOX_KINDS = [
  "conversation.message",
  "member.activated",
  "member.channels.updated",
  "member.preferences.updated",
  "assistant.notification.requested",
  "assistant.ask.requested",
  "assistant.ask.completed",
  "clinical-records.sync-requested",
  "device-sync.wake",
  "environment-voice.captured",
  "health.daily-metric.reported",
  "meal-photo.captured",
  "member.action.requested",
  "member.action.completed",
  "vault-share.delivery",
  "vault-share.revoke",
  ...HOSTED_RETIRED_MAILBOX_KINDS,
  ...HOSTED_EXECUTION_RUNTIME_CONTROL_WAKE_KINDS,
] as const;

export type HostedMailboxKind = (typeof HOSTED_MAILBOX_KINDS)[number];

export const HOSTED_RUNTIME_CONTROL_MAILBOX_KINDS =
  HOSTED_EXECUTION_RUNTIME_CONTROL_WAKE_KINDS;

export type HostedRuntimeControlMailboxKind =
  (typeof HOSTED_RUNTIME_CONTROL_MAILBOX_KINDS)[number];

export const HOSTED_AI_USAGE_ALLOWANCE_PRICED_MODELS = [
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
] as const;

export type HostedAiUsageAllowancePricedModel =
  (typeof HOSTED_AI_USAGE_ALLOWANCE_PRICED_MODELS)[number];

export const HOSTED_AI_USAGE_OPENAI_FLEX_TOKEN_PRICING_MODELS =
  [
    ...HOSTED_AI_USAGE_ALLOWANCE_PRICED_MODELS,
  ] as readonly HostedAiUsageAllowancePricedModel[];

export type HostedAiUsageOpenAiFlexTokenPricingModel =
  (typeof HOSTED_AI_USAGE_OPENAI_FLEX_TOKEN_PRICING_MODELS)[number];

// Image models stay separate from HOSTED_AI_USAGE_ALLOWANCE_PRICED_MODELS
// because that list validates HOSTED_ASSISTANT_MODEL in deploy preflight.
export const HOSTED_AI_USAGE_ALLOWANCE_OPENAI_IMAGE_PRICED_MODELS = [
  "gpt-image-2",
] as const;

export type HostedAiUsageAllowanceOpenAiImagePricedModel =
  (typeof HOSTED_AI_USAGE_ALLOWANCE_OPENAI_IMAGE_PRICED_MODELS)[number];

export const HOSTED_AI_USAGE_ALLOWANCE_ELEVENLABS_TTS_PRICED_MODELS = [
  "eleven_flash_v2",
  "eleven_flash_v2_5",
  "eleven_multilingual_v2",
  "eleven_turbo_v2",
  "eleven_turbo_v2_5",
  "eleven_v3",
] as const;

export type HostedAiUsageAllowanceElevenLabsTtsPricedModel =
  (typeof HOSTED_AI_USAGE_ALLOWANCE_ELEVENLABS_TTS_PRICED_MODELS)[number];

export const HOSTED_AI_USAGE_ALLOWANCE_ELEVENLABS_MUSIC_PRICED_MODELS = [
  "music_v2",
] as const;

export type HostedAiUsageAllowanceElevenLabsMusicPricedModel =
  (typeof HOSTED_AI_USAGE_ALLOWANCE_ELEVENLABS_MUSIC_PRICED_MODELS)[number];

const HOSTED_AI_USAGE_OPENAI_TOKEN_PRICING_PROVIDER_NAMES = new Set<string>([
  "hosted-openai",
  "openai",
]);

export const HOSTED_AI_USAGE_ALLOWANCE_ACCEPTED_MODEL_IDS = [
  ...HOSTED_AI_USAGE_ALLOWANCE_PRICED_MODELS,
] as const;

export const HOSTED_AI_USAGE_ALLOW_DECISION_SCHEMA =
  "murph.hosted-ai-usage-allow-decision.v1";
export const HOSTED_AI_USAGE_ALLOW_DECISION_SIGNATURE_ALG = "HMAC-SHA256";

export interface HostedAiUsageAllowDecisionBody {
  allowed: true;
  expiresAt: string;
  issuedAt: string;
  nonce: string;
  schema: typeof HOSTED_AI_USAGE_ALLOW_DECISION_SCHEMA;
  userId: string;
}

export interface HostedAiUsageAllowDecisionSignature {
  alg: typeof HOSTED_AI_USAGE_ALLOW_DECISION_SIGNATURE_ALG;
  keyId: string;
  signature: string;
}

export interface HostedAiUsageAllowDecision
  extends HostedAiUsageAllowDecisionBody {
  signature: HostedAiUsageAllowDecisionSignature;
}

export type HostedRunnerNudgeRequest = Record<string, never>;

export function isHostedAiUsageAllowancePricedModelId(
  value: string,
): value is HostedAiUsageAllowancePricedModel {
  return HOSTED_AI_USAGE_ALLOWANCE_PRICED_MODELS.includes(
    value as HostedAiUsageAllowancePricedModel,
  );
}

export function normalizeHostedAiUsageAllowancePricedModelId(
  value: string,
): HostedAiUsageAllowancePricedModel | null {
  const normalized = value.trim().toLowerCase();
  const exact = normalizeHostedAiUsageAllowancePricedModelCandidate(normalized);
  if (exact) {
    return exact;
  }

  const providerScoped = normalized.split("/").at(-1) ?? normalized;
  const providerScopedExact =
    normalizeHostedAiUsageAllowancePricedModelCandidate(providerScoped);
  if (providerScopedExact) {
    return providerScopedExact;
  }

  const datedSnapshotBase = providerScoped.replace(/-\d{4}-\d{2}-\d{2}$/u, "");

  return normalizeHostedAiUsageAllowancePricedModelCandidate(datedSnapshotBase);
}

export function isHostedAiUsageAllowanceElevenLabsTtsPricedModelId(
  value: string,
): value is HostedAiUsageAllowanceElevenLabsTtsPricedModel {
  return HOSTED_AI_USAGE_ALLOWANCE_ELEVENLABS_TTS_PRICED_MODELS.includes(
    value as HostedAiUsageAllowanceElevenLabsTtsPricedModel,
  );
}

export function normalizeHostedAiUsageAllowanceElevenLabsTtsModelId(
  value: string | null | undefined,
): HostedAiUsageAllowanceElevenLabsTtsPricedModel | null {
  const normalized = value?.trim().toLowerCase();
  return normalized && isHostedAiUsageAllowanceElevenLabsTtsPricedModelId(normalized)
    ? normalized
    : null;
}

export function isHostedAiUsageAllowanceElevenLabsMusicPricedModelId(
  value: string,
): value is HostedAiUsageAllowanceElevenLabsMusicPricedModel {
  return HOSTED_AI_USAGE_ALLOWANCE_ELEVENLABS_MUSIC_PRICED_MODELS.includes(
    value as HostedAiUsageAllowanceElevenLabsMusicPricedModel,
  );
}

export function normalizeHostedAiUsageAllowanceElevenLabsMusicModelId(
  value: string | null | undefined,
): HostedAiUsageAllowanceElevenLabsMusicPricedModel | null {
  const normalized = value?.trim().toLowerCase();
  return normalized && isHostedAiUsageAllowanceElevenLabsMusicPricedModelId(normalized)
    ? normalized
    : null;
}

export function isHostedAiUsageOpenAiFlexTokenPricingModelId(
  value: string | null | undefined,
): value is HostedAiUsageAllowancePricedModel {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = normalizeHostedAiUsageAllowancePricedModelId(value);
  return normalized
    ? HOSTED_AI_USAGE_OPENAI_FLEX_TOKEN_PRICING_MODELS.includes(normalized)
    : false;
}

export function isHostedAiUsageAllowanceOpenAiImagePricedModelId(
  value: string,
): value is HostedAiUsageAllowanceOpenAiImagePricedModel {
  return HOSTED_AI_USAGE_ALLOWANCE_OPENAI_IMAGE_PRICED_MODELS.includes(
    value as HostedAiUsageAllowanceOpenAiImagePricedModel,
  );
}

export function normalizeHostedAiUsageAllowanceOpenAiImageModelId(
  value: string | null | undefined,
): HostedAiUsageAllowanceOpenAiImagePricedModel | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const exact = normalizeHostedAiUsageAllowanceOpenAiImageModelCandidate(
    normalized,
  );
  if (exact) {
    return exact;
  }

  const providerScoped = normalized.split("/").at(-1) ?? normalized;
  const providerScopedExact =
    normalizeHostedAiUsageAllowanceOpenAiImageModelCandidate(providerScoped);
  if (providerScopedExact) {
    return providerScopedExact;
  }

  const datedSnapshotBase = providerScoped.replace(/-\d{4}-\d{2}-\d{2}$/u, "");

  return normalizeHostedAiUsageAllowanceOpenAiImageModelCandidate(
    datedSnapshotBase,
  );
}

export function isHostedAiUsageOpenAiTokenPricingProviderName(
  value: unknown,
): boolean {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized
    ? HOSTED_AI_USAGE_OPENAI_TOKEN_PRICING_PROVIDER_NAMES.has(normalized)
    : false;
}

export function resolveHostedAiUsageTokenPricingBasis(input: {
  model: string | null | undefined;
  providerName: unknown;
  serviceTier?: string | null | undefined;
}): AssistantUsageTokenPricingBasis {
  if (input.serviceTier !== "flex") {
    return "standard";
  }

  return isHostedAiUsageOpenAiFlexTokenPricingModelId(input.model)
    && isHostedAiUsageOpenAiTokenPricingProviderName(input.providerName)
    ? "openai-flex"
    : "standard";
}

export async function signHostedAiUsageAllowDecision(input: {
  body: HostedAiUsageAllowDecisionBody;
  keyId?: string | null;
  secret: string;
}): Promise<HostedAiUsageAllowDecision> {
  const keyId = normalizeHostedAiUsageAllowDecisionText(input.keyId) ?? "v1";
  const signature = await signHostedAiUsageAllowDecisionPayload({
    payload: buildHostedAiUsageAllowDecisionSigningPayload(input.body),
    secret: input.secret,
  });

  return {
    ...input.body,
    signature: {
      alg: HOSTED_AI_USAGE_ALLOW_DECISION_SIGNATURE_ALG,
      keyId,
      signature,
    },
  };
}

export async function verifyHostedAiUsageAllowDecision(input: {
  decision: HostedAiUsageAllowDecision;
  secret: string;
}): Promise<boolean> {
  const expected = await signHostedAiUsageAllowDecisionPayload({
    payload: buildHostedAiUsageAllowDecisionSigningPayload(input.decision),
    secret: input.secret,
  });

  return constantTimeStringEqual(expected, input.decision.signature.signature);
}

export function parseHostedAiUsageAllowDecision(
  value: unknown,
): HostedAiUsageAllowDecision {
  const record = requireHostedAiUsageAllowDecisionObject(value, "AI usage allow decision");
  const signature = requireHostedAiUsageAllowDecisionObject(
    record.signature,
    "AI usage allow decision signature",
  );

  return {
    allowed: requireHostedAiUsageAllowDecisionAllowed(record.allowed),
    expiresAt: requireHostedAiUsageAllowDecisionIsoDate(record.expiresAt, "expiresAt"),
    issuedAt: requireHostedAiUsageAllowDecisionIsoDate(record.issuedAt, "issuedAt"),
    nonce: requireHostedAiUsageAllowDecisionText(record.nonce, "nonce"),
    schema: requireHostedAiUsageAllowDecisionSchema(record.schema),
    signature: {
      alg: requireHostedAiUsageAllowDecisionSignatureAlg(signature.alg),
      keyId: requireHostedAiUsageAllowDecisionText(signature.keyId, "signature.keyId"),
      signature: requireHostedAiUsageAllowDecisionText(
        signature.signature,
        "signature.signature",
      ),
    },
    userId: requireHostedAiUsageAllowDecisionText(record.userId, "userId"),
  };
}

export function parseHostedRunnerNudgeRequest(value: unknown): HostedRunnerNudgeRequest {
  if (value === null || value === undefined) {
    return {};
  }

  const record = requireHostedAiUsageAllowDecisionObject(value, "runner nudge request");
  const keys = Object.keys(record);
  if (keys.length === 0) {
    return {};
  }

  throw new TypeError("runner nudge request must not include legacy fields.");
}

export function buildHostedAiUsageAllowDecisionBody(input: {
  expiresAt: Date | string;
  issuedAt: Date | string;
  nonce: string;
  userId: string;
}): HostedAiUsageAllowDecisionBody {
  return {
    allowed: true,
    expiresAt: normalizeHostedAiUsageAllowDecisionDate(input.expiresAt, "expiresAt"),
    issuedAt: normalizeHostedAiUsageAllowDecisionDate(input.issuedAt, "issuedAt"),
    nonce: requireHostedAiUsageAllowDecisionText(input.nonce, "nonce"),
    schema: HOSTED_AI_USAGE_ALLOW_DECISION_SCHEMA,
    userId: requireHostedAiUsageAllowDecisionText(input.userId, "userId"),
  };
}

function normalizeHostedAiUsageAllowancePricedModelCandidate(
  value: string,
): HostedAiUsageAllowancePricedModel | null {
  return isHostedAiUsageAllowancePricedModelId(value) ? value : null;
}

function normalizeHostedAiUsageAllowanceOpenAiImageModelCandidate(
  value: string,
): HostedAiUsageAllowanceOpenAiImagePricedModel | null {
  return isHostedAiUsageAllowanceOpenAiImagePricedModelId(value) ? value : null;
}

function buildHostedAiUsageAllowDecisionSigningPayload(
  body: HostedAiUsageAllowDecisionBody,
): ArrayBuffer {
  return encodeHostedAiUsageAllowDecisionUtf8(canonicalHostedAiUsageAllowDecisionJson({
    allowed: true,
    expiresAt: body.expiresAt,
    issuedAt: body.issuedAt,
    nonce: body.nonce,
    schema: body.schema,
    userId: body.userId,
  }));
}

async function signHostedAiUsageAllowDecisionPayload(input: {
  payload: ArrayBuffer;
  secret: string;
}): Promise<string> {
  const secret = requireHostedAiUsageAllowDecisionText(input.secret, "secret");
  const key = await crypto.subtle.importKey(
    "raw",
    encodeHostedAiUsageAllowDecisionUtf8(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, input.payload);
  return encodeHostedAiUsageAllowDecisionBase64Url(new Uint8Array(signature));
}

function canonicalHostedAiUsageAllowDecisionJson(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new TypeError("Cannot canonicalize non-finite number.");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalHostedAiUsageAllowDecisionJson(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalHostedAiUsageAllowDecisionJson(record[key])}`)
      .join(",")}}`;
  }
  throw new TypeError("Cannot canonicalize unsupported JSON value.");
}

function encodeHostedAiUsageAllowDecisionUtf8(value: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(value);
  const buffer = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(buffer).set(encoded);
  return buffer;
}

function encodeHostedAiUsageAllowDecisionBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

function constantTimeStringEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const maxLength = Math.max(leftBytes.byteLength, rightBytes.byteLength);
  let diff = leftBytes.byteLength ^ rightBytes.byteLength;

  for (let index = 0; index < maxLength; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return diff === 0;
}

function normalizeHostedAiUsageAllowDecisionText(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function requireHostedAiUsageAllowDecisionObject(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireHostedAiUsageAllowDecisionText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value !== value.trim()) {
    throw new TypeError(`AI usage allow decision ${label} must be a non-empty trimmed string.`);
  }
  return value;
}

function requireHostedAiUsageAllowDecisionIsoDate(value: unknown, label: string): string {
  const text = requireHostedAiUsageAllowDecisionText(value, label);
  if (!Number.isFinite(Date.parse(text))) {
    throw new TypeError(`AI usage allow decision ${label} must be an ISO date string.`);
  }
  return text;
}

function normalizeHostedAiUsageAllowDecisionDate(value: Date | string, label: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(`AI usage allow decision ${label} must be a valid date.`);
  }
  return date.toISOString();
}

function requireHostedAiUsageAllowDecisionAllowed(value: unknown): true {
  if (value !== true) {
    throw new TypeError("AI usage allow decision allowed must be true.");
  }
  return true;
}

function requireHostedAiUsageAllowDecisionSchema(
  value: unknown,
): typeof HOSTED_AI_USAGE_ALLOW_DECISION_SCHEMA {
  if (value !== HOSTED_AI_USAGE_ALLOW_DECISION_SCHEMA) {
    throw new TypeError("AI usage allow decision schema is invalid.");
  }
  return HOSTED_AI_USAGE_ALLOW_DECISION_SCHEMA;
}

function requireHostedAiUsageAllowDecisionSignatureAlg(
  value: unknown,
): typeof HOSTED_AI_USAGE_ALLOW_DECISION_SIGNATURE_ALG {
  if (value !== HOSTED_AI_USAGE_ALLOW_DECISION_SIGNATURE_ALG) {
    throw new TypeError("AI usage allow decision signature alg is invalid.");
  }
  return HOSTED_AI_USAGE_ALLOW_DECISION_SIGNATURE_ALG;
}

export const HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA = "murph.hosted-mailbox-item.v1";
export const HOSTED_MAILBOX_PAYLOAD_SCHEMA = "murph.hosted-mailbox-payload.v1";

export const HOSTED_MAILBOX_INLINE_PAYLOAD_FIELD = "hosted-mailbox-inline-payload";
export const HOSTED_MAILBOX_REF_PAYLOAD_FIELD = "hosted-mailbox-ref-payload";

export type HostedMailboxPayloadStorage = "inline" | "sidecar";

export interface HostedMailboxPayloadCryptoMetadata {
  dedupeKey: string;
  itemId: string;
  kind: string;
  lane: string;
  laneSeq: bigint | number | string;
  occurredAt: string;
  payloadSchema: string;
  payloadStorage: HostedMailboxPayloadStorage;
  userId: string;
}

function resolveHostedMailboxPayloadField(
  payloadStorage: HostedMailboxPayloadStorage,
): typeof HOSTED_MAILBOX_INLINE_PAYLOAD_FIELD | typeof HOSTED_MAILBOX_REF_PAYLOAD_FIELD {
  switch (payloadStorage) {
    case "inline":
      return HOSTED_MAILBOX_INLINE_PAYLOAD_FIELD;
    case "sidecar":
      return HOSTED_MAILBOX_REF_PAYLOAD_FIELD;
  }
}

function buildHostedMailboxPayloadAadObjectKey(
  input: Pick<
    HostedMailboxPayloadCryptoMetadata,
    | "dedupeKey"
    | "kind"
    | "lane"
    | "occurredAt"
    | "payloadSchema"
    | "payloadStorage"
  >,
): string {
  return JSON.stringify({
    dedupeKey: requireHostedMailboxPayloadAadString(input.dedupeKey, "dedupeKey"),
    kind: requireHostedMailboxPayloadAadString(input.kind, "kind"),
    lane: requireHostedMailboxPayloadAadString(input.lane, "lane"),
    occurredAt: requireHostedMailboxPayloadAadString(input.occurredAt, "occurredAt"),
    payloadSchema: requireHostedMailboxPayloadAadString(input.payloadSchema, "payloadSchema"),
    payloadStorage: input.payloadStorage,
  });
}

export type HostedMailboxPayloadField =
  typeof HOSTED_MAILBOX_INLINE_PAYLOAD_FIELD | typeof HOSTED_MAILBOX_REF_PAYLOAD_FIELD;
export type HostedMailboxPayloadScope = `hosted-mailbox-payload:${HostedMailboxPayloadField}`;

export interface HostedMailboxPayloadSecureBoxAad {
  field: HostedMailboxPayloadField;
  objectKey: string;
  purpose: "hosted-mailbox-payload";
  rowId: string;
  sequence: HostedMailboxPayloadCryptoMetadata["laneSeq"];
  table: "hosted_mailbox_item";
}

// Prepared account-deletion mailbox payloads are sealed before their durable
// ordering sequence exists. The terminal database transaction allocates that
// sequence together with the row insert, while this marker selects the
// sequence-independent AAD in both Web and runtime decoders.
export const HOSTED_MAILBOX_PREPARED_PAYLOAD_CIPHERTEXT_PREFIX = "hmp2:";
export const HOSTED_MAILBOX_PREPARED_PAYLOAD_AAD_SEQUENCE =
  "prepared-before-sequence-v2";

export function buildHostedMailboxPayloadScope(
  payloadStorage: HostedMailboxPayloadStorage,
): HostedMailboxPayloadScope {
  return `hosted-mailbox-payload:${resolveHostedMailboxPayloadField(payloadStorage)}`;
}

export function buildHostedMailboxPayloadSecureBoxAad(
  input: HostedMailboxPayloadCryptoMetadata,
): HostedMailboxPayloadSecureBoxAad {
  return {
    field: resolveHostedMailboxPayloadField(input.payloadStorage),
    objectKey: buildHostedMailboxPayloadAadObjectKey(input),
    purpose: "hosted-mailbox-payload",
    rowId: input.itemId,
    sequence: input.laneSeq,
    table: "hosted_mailbox_item",
  };
}

function requireHostedMailboxPayloadAadString(value: string, label: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new TypeError(`Hosted mailbox payload AAD ${label} must be a non-empty string.`);
  }

  return normalized;
}

export interface HostedMailboxItem {
  causalSeq?: string | null;
  consumedAt?: string | null;
  createdAt: string;
  dedupeKey: string;
  expiresAt?: string | null;
  id: string;
  kind: HostedMailboxKind;
  lane: HostedMailboxLane;
  laneSeq: string;
  occurredAt: string;
  payloadBytes?: number | null;
  payloadInlineCiphertext?: string | null;
  payloadRef?: string | null;
  payloadSchema: string;
  updatedAt: string;
  userId: string;
}

export interface HostedMailboxPayload {
  createdAt: string;
  mailboxItemId: string;
  payloadCiphertext: string;
  payloadSchema: string;
  userId: string;
}

export const HOSTED_RUNTIME_SIDE_INPUT_UNAVAILABLE_CODES = [
  "not_found",
  "expired",
  "gone",
] as const;

export type HostedRuntimeSideInputUnavailableCode =
  (typeof HOSTED_RUNTIME_SIDE_INPUT_UNAVAILABLE_CODES)[number];

export interface HostedRuntimeSideInputUnavailable {
  code: HostedRuntimeSideInputUnavailableCode;
  retryable: boolean;
}

export interface HostedMailboxPayloadFetchRequest {
  dedupeKey: string;
  mailboxItemId: string;
  payloadRef?: string | null;
  requestId: string;
}

export interface HostedMailboxPayloadFetchResponse {
  fetchedAt: string;
  payload: HostedMailboxPayload | null;
  unavailable?: HostedRuntimeSideInputUnavailable | null;
}

export interface HostedMailboxLaneCounterState {
  lane: HostedMailboxLane;
  nextSeq: string;
  updatedAt: string;
  userId: string;
}

export interface HostedMailboxLaneCursor {
  importedSeq: string;
  lane: HostedMailboxLane;
}

export const HOSTED_MAILBOX_FETCH_CURSOR_MODES = [
  "imported_seq",
] as const;

export type HostedMailboxFetchCursorMode =
  (typeof HOSTED_MAILBOX_FETCH_CURSOR_MODES)[number];

export interface HostedMailboxFetchRequest {
  cursorMode?: HostedMailboxFetchCursorMode | null;
  lanes: HostedMailboxLaneCursor[];
  limitPerLane: number;
  requestId: string;
}

export interface HostedMailboxLaneHighWater {
  lane: HostedMailboxLane;
  maxSeq: string;
  maxUpdatedAt?: string | null;
}

export interface HostedMailboxLaneConsumed {
  consumedSeq: string;
  lane: HostedMailboxLane;
}

export interface HostedGroupRunningBitProjection {
  expiresAt: string;
  publicAlias: string | null;
  requestedBit: string;
  schema: "murph.group-sponsorship-bit.v1";
}

export interface HostedMailboxFetchResponse {
  // Optional for deploy-window compatibility. Web emits this only for an
  // allowed conversation batch whose current effective capacity is low.
  conversationUsageStatus?: "low" | null;
  // Optional for consumer-first rollout. It is Web-owned, expiring group
  // context and is attached only to fresh route-authorized group inputs.
  groupRunningBit?: HostedGroupRunningBitProjection | null;
  // Optional for deploy-window compatibility: older web responses omit it and
  // the runtime treats every lane as consumed through seq 0.
  consumedSeqByLane?: HostedMailboxLaneConsumed[] | null;
  fetchedAt: string;
  items: HostedMailboxItem[];
  maxSeqByLane: HostedMailboxLaneHighWater[];
  userId: string;
}

export const HOSTED_RUNTIME_DEVICE_SYNC_BRIDGE_KINDS = [
  "device-sync.wake",
  "device-sync.snapshot",
  "device-sync.apply",
] as const;

export type HostedRuntimeDeviceSyncBridgeKind =
  (typeof HOSTED_RUNTIME_DEVICE_SYNC_BRIDGE_KINDS)[number];

export interface HostedRuntimeDeviceSyncWakeBridgeEnvelope {
  connectionId?: string | null;
  expectedConnectedAt?: string;
  hint?: HostedExecutionDeviceSyncWakeHint | null;
  kind: "device-sync.wake";
  provider?: string | null;
  requestId: string;
}

export interface HostedRuntimeDeviceSyncSnapshotBridgeEnvelope {
  kind: "device-sync.snapshot";
  request: HostedExecutionDeviceSyncRuntimeSnapshotRequest;
  requestId: string;
}

export interface HostedRuntimeDeviceSyncApplyBridgeEnvelope {
  kind: "device-sync.apply";
  request: HostedExecutionDeviceSyncRuntimeApplyRequest;
  requestId: string;
}

export type HostedRuntimeDeviceSyncBridgeEnvelope =
  | HostedRuntimeDeviceSyncWakeBridgeEnvelope
  | HostedRuntimeDeviceSyncSnapshotBridgeEnvelope
  | HostedRuntimeDeviceSyncApplyBridgeEnvelope;

export type HostedRuntimeUsageNoticeDeliveryTarget =
  | {
      channel: "linq";
      replyToMessageId: string | null;
      routeAuthority: HostedExecutionLinqExternalThreadRouteAuthority | null;
      target: string;
    }
  | {
      channel: "telegram";
      replyToMessageId: string;
      target: string;
    };

export interface HostedRuntimeUsageRecordRequest {
  noticeDeliveryTarget?: HostedRuntimeUsageNoticeDeliveryTarget | null;
  usage: AssistantUsageRecord;
}

export interface HostedRuntimeUsageRecordResponse {
  recorded: boolean;
  usageId: string;
}

export const HOSTED_PRODUCT_FEEDBACK_KINDS = [
  "feature_interest",
  "feature_request",
  "frustration",
] as const;

export type HostedProductFeedbackKind =
  (typeof HOSTED_PRODUCT_FEEDBACK_KINDS)[number];

export const HOSTED_PRODUCT_FEEDBACK_SUMMARY_MAX_LENGTH = 2_000;

const HOSTED_PRODUCT_FEEDBACK_REDACTION_TOKEN = "[redacted]";

const HOSTED_PRODUCT_FEEDBACK_SUMMARY_REDACTION_PATTERNS = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu,
  /@[A-Z0-9_]{2,}\b/giu,
  /\bhttps?:\/\/[^\s<>"']+/giu,
  /\bwww\.[^\s<>"']+/giu,
  /\b(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/gu,
  /\b\d{3}-\d{2}-\d{4}\b/gu,
  /\b(?:\d[ -]?){13,19}\b/gu,
  /\b(?:member|user|usr|account)_[A-Za-z0-9_-]{6,}\b/gu,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu,
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/gu,
  /\b0x[A-Fa-f0-9]{40,64}\b/gu,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/gu,
  /\b(?:sk|pk|rk|ak|pat|ghp|gho|ghu|ghs|github_pat|xox[baprs])_[A-Za-z0-9_=-]{12,}\b/gu,
  /\b\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\s*mmHg\b/giu,
  /\b\d+(?:\.\d+)?\s*(?:bpm|mg\/dL|mmol\/L|mmHg|mIU\/L|ng\/mL|pg\/mL|g\/dL|µg\/dL)\b/giu,
  /\b[A-Fa-f0-9]{32,}\b/gu,
] as const;

export function sanitizeHostedProductFeedbackSummary(value: string): string {
  let summary = value.trim().replace(/\s+/gu, " ");
  for (const pattern of HOSTED_PRODUCT_FEEDBACK_SUMMARY_REDACTION_PATTERNS) {
    summary = summary.replace(pattern, HOSTED_PRODUCT_FEEDBACK_REDACTION_TOKEN);
  }
  return summary.trim().replace(/\s+/gu, " ");
}

export interface HostedRuntimeProductFeedbackRecord {
  idempotencyKey: string;
  kind: HostedProductFeedbackKind;
  relatedChangelogItemIds: string[];
  summary: string;
}

export const HOSTED_PRODUCT_SUPPORT_ESCALATION_PREFIX = "Support escalation:";

export function isHostedProductSupportEscalationSummary(
  value: string | null | undefined,
): value is string {
  return typeof value === "string"
    && value.startsWith(HOSTED_PRODUCT_SUPPORT_ESCALATION_PREFIX)
    && value.slice(HOSTED_PRODUCT_SUPPORT_ESCALATION_PREFIX.length).trim().length > 0;
}

export function isHostedProductSupportEscalationFeedback(
  feedback: Pick<
    HostedRuntimeProductFeedbackRecord,
    "kind" | "relatedChangelogItemIds" | "summary"
  >,
): boolean {
  return feedback.kind === "frustration"
    && feedback.relatedChangelogItemIds.length === 0
    && isHostedProductSupportEscalationSummary(feedback.summary);
}

export interface HostedRuntimeProductFeedbackRecordRequest {
  feedback: HostedRuntimeProductFeedbackRecord;
}

export interface HostedRuntimeProductFeedbackRecordResponse {
  feedbackId: string;
  recorded: boolean;
}

export const HOSTED_RUNTIME_ASSISTANT_ASK_REQUEST_ID_MAX_CODE_POINTS = 200;
export const HOSTED_RUNTIME_ASSISTANT_ASK_DIAGNOSTIC_CODE_HEADER =
  "x-murph-assistant-ask-diagnostic-code";
export const HOSTED_RUNTIME_ASSISTANT_ASK_REQUEST_ID_HEADER =
  "x-murph-assistant-ask-request-id";
/**
 * Body-only protocol marker. An old strict Web parser rejects this unknown
 * field, so a new caller cannot silently enter the retired destination-bearing
 * protocol during an ordered rollout.
 */
export const HOSTED_RUNTIME_GROUP_CURRENT_SENDER_PROTOCOL_MARKER =
  "currentSenderProtocol";
export const HOSTED_RUNTIME_GROUP_CURRENT_SENDER_PROTOCOL_MARKER_VALUE = "v3";

export function isHostedRuntimeAssistantAskDiagnosticCode(
  value: unknown,
): value is string {
  return typeof value === "string" && /^P[0-9]{4}$/u.test(value);
}

export function isHostedRuntimeAssistantAskRequestId(
  value: unknown,
): value is string {
  return typeof value === "string" && /^aask_req_[0-9a-f]{64}$/u.test(value);
}

export type HostedRuntimeAssistantAskControlRequest =
  | {
      action: "prepare";
      requestId: string;
    }
  | {
      action: "complete";
      requestId: string;
      result: HostedExecutionAssistantAskResult;
    };

export type HostedRuntimeAssistantAskTerminalReason =
  | "expired"
  | "unavailable";

export interface HostedRuntimeAssistantAskDisclosureContext {
  permissionText: string;
}

export type HostedRuntimeAssistantAskControlResponse =
  | {
      action: "prepare";
      disclosure?: HostedRuntimeAssistantAskDisclosureContext;
      question: string;
      status: "ready";
      targetLabel: string | null;
    }
  | {
      action: "prepare" | "complete";
      status: "terminal";
      terminalReason: HostedRuntimeAssistantAskTerminalReason;
    }
  | {
      action: "prepare";
      status: "already_completed";
    }
  | {
      action: "complete";
      status: "completed" | "already_completed";
    };

export type HostedRuntimeGroupToolAction = HostedRuntimeGroupToolRequest["action"];

export const HOSTED_RUNTIME_GROUP_KINDS = [
  "couple",
  "custom",
  "family",
  "friends",
  "household",
  "team",
] as const;

export type HostedRuntimeGroupKind = (typeof HOSTED_RUNTIME_GROUP_KINDS)[number];

export const HOSTED_RUNTIME_GROUP_DISPLAY_NAME_MAX_LENGTH = 120;
export const HOSTED_RUNTIME_GROUP_CHAT_ICON_URL_MAX_LENGTH = 2000;
export const HOSTED_RUNTIME_GROUP_JOIN_OFFER_MESSAGE_TEMPLATE_MAX_LENGTH = 1000;
export const HOSTED_RUNTIME_GROUP_DISCLOSURE_PERMISSION_TEXT_MAX_CODE_POINTS =
  HOSTED_EXECUTION_ASSISTANT_ASK_PERMISSION_TEXT_MAX_CODE_POINTS;
export const HOSTED_RUNTIME_GROUP_DISCLOSURE_GRANTS_MAX = 25;
export const HOSTED_RUNTIME_GROUP_DISCLOSURE_HISTORY_MAX = 25;

export interface HostedRuntimeGroupDisclosureGrantSummary {
  grantId: string;
  permissionText: string;
}

export interface HostedRuntimeGroupDisclosureGrantListEntry
  extends HostedRuntimeGroupDisclosureGrantSummary {
  groupLabel: string | null;
}
export const HOSTED_RUNTIME_GROUP_JOIN_OFFER_LEGACY_MESSAGE_TEMPLATE =
  "Sounds good. Like or heart this message to share {{share_scope}} with the group, or use {{join_url}} to customize what you share.";

export interface HostedRuntimeGroupMemberSummary {
  disclosureGrants?: HostedRuntimeGroupDisclosureGrantSummary[];
  grantedVaultShareProjectionKinds: HostedVaultShareProjectionKind[];
  grantedVaultShareProjectionScopes: HostedVaultShareProjectionScope[];
  handle: string | null;
  memberId: string;
  role: string;
}

export interface HostedRuntimeGroupSummary {
  displayName: string | null;
  id: string;
  kind: string;
  memberCount: number;
  members: HostedRuntimeGroupMemberSummary[];
  requestedVaultShareProjectionKinds: HostedVaultShareProjectionKind[];
  requestedVaultShareProjectionScopes: HostedVaultShareProjectionScope[];
  status: string;
}

export interface HostedRuntimeGroupUsageStatus {
  /** Whether an assistant-initiated low-capacity funding prompt is timely. */
  fundingNeeded: boolean;
  /** Current explicit funding capability, independent of urgency. */
  fundingUrl: string | null;
  /** Required on the current shape; absent only on legacy response branches. */
  includedUsageUsedPercent?: number;
}

export const HOSTED_USAGE_REFERRAL_POLICY_CODES = [
  "new_person_activation_v1",
  "active_group_v1",
] as const;

export type HostedUsageReferralPolicyCode =
  (typeof HOSTED_USAGE_REFERRAL_POLICY_CODES)[number];

export interface HostedRuntimeUsageReferralMissionSnapshot {
  destinationKind: "group" | "personal";
  expiresAt: string;
  policyCode: HostedUsageReferralPolicyCode;
  rewardLabel: string;
  state: "armed" | "target_bound";
}

export interface HostedRuntimeUsageReferralSnapshot {
  activeMissions: HostedRuntimeUsageReferralMissionSnapshot[];
  availablePolicies: Array<{
    code: HostedUsageReferralPolicyCode;
    requirementsLabel: string;
    rewardLabel: string;
  }>;
  trialCreditNotice: string | null;
}

export interface HostedRuntimeGroupToolSenderContext {
  /**
   * Trusted current-turn sender evidence injected by the hosted runtime. The
   * model never supplies these fields, and exactly one provider namespace may
   * be present.
   */
  linqSenderHandles?: readonly string[];
  telegramSenderHandles?: readonly string[];
}

export interface HostedRuntimeUsageReferralSourceConversation {
  channel: "linq" | "telegram";
  /**
   * Ephemeral provider service observed by the Linq runtime. It is used only
   * to gate service-specific referral behavior and is never persisted.
   */
  linqService?: "imessage" | "rcs" | "sms";
  threadId: string;
  threadIsDirect: boolean;
}

export interface HostedRuntimeUsageReferralSourceContext {
  /**
   * Blinded current-conversation locator injected by the hosted runtime. Web
   * persists it only for a personal reward so its celebration cannot drift to
   * another direct channel or a newly bound provider conversation.
   */
  sourceConversation?: HostedRuntimeUsageReferralSourceConversation;
}

export const HOSTED_RUNTIME_GROUP_MEMBERSHIPS_MAX = 25;

export interface HostedRuntimeGroupMembershipSummary {
  displayName: string | null;
  grantedVaultShareProjectionScopes: HostedVaultShareProjectionScope[];
  kind: string;
  memberCount: number;
  membershipId: string;
  permissionsUrl: string | null;
  requestedVaultShareProjectionScopes: HostedVaultShareProjectionScope[];
  role: string;
  sponsorshipUrl: string | null;
}

export interface HostedRuntimeGroupCreateJoinLinkRequest {
  displayName?: string | null;
  kind?: HostedRuntimeGroupKind | null;
  // Compatibility for old fixed-kind callers. Selector-only projections must
  // use requestedVaultShareProjectionScopes.
  requestedVaultShareProjectionKinds?: HostedVaultShareSelectableProjectionKind[] | null;
  // Closed over the individually selectable scopes: the membership-implied
  // profile-name.v0 share is never requestable through a join link.
  requestedVaultShareProjectionScopes?: HostedVaultShareSelectableProjectionScope[] | null;
}

export interface HostedRuntimeGroupPostJoinOfferRequest {
  displayName?: string | null;
  // Legacy wire compatibility only. Web owns the canonical consent sentence
  // because an affirmative reaction grants the frozen server-side snapshot.
  messageTemplate?: string | null;
  // Compatibility for old fixed-kind callers. Selector-only projections must
  // use projectionScopes.
  projectionKinds?: HostedVaultShareSelectableProjectionKind[] | null;
  // Closed over the individually selectable scopes; the offer always includes
  // the membership-implied profile-name.v0 share in its deterministic copy.
  projectionScopes?: HostedVaultShareSelectableProjectionScope[] | null;
}

export interface HostedRuntimeGroupUpdateDisplayNameRequest {
  displayName: string;
}

export interface HostedRuntimeGroupSetChatAvatarRequest {
  groupChatIconUrl: string;
}

export function hostedRuntimeLinqProviderErrorMessageForCode(
  code: unknown,
): string | null {
  switch (code) {
    case 5006:
      return "The avatar image type was not accepted.";
    case 5007:
      return "The avatar image could not be downloaded.";
    default:
      return null;
  }
}

export const HOSTED_RUNTIME_PRIVATE_MEDIA_DELIVERY_ORIGIN =
  "https://murph-hosted.cobuildwithus.workers.dev";
export const HOSTED_RUNTIME_PRIVATE_MEDIA_DELIVERY_PATH_PREFIX =
  "/private-media/v1/";
const HOSTED_RUNTIME_PRIVATE_MEDIA_DELIVERY_PATH_PATTERN =
  /^\/private-media\/v1\/v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{32,1024}(?:\/group-avatar\.(?:jpg|png|webp))?$/u;

export function isHostedRuntimePrivateImageDeliveryUrl(
  url: URL,
  expectedOrigin = HOSTED_RUNTIME_PRIVATE_MEDIA_DELIVERY_ORIGIN,
): boolean {
  if (isLegacyHostedRuntimePrivateImageDeliveryUrl(url)) {
    return true;
  }
  let normalizedExpectedOrigin: string;
  try {
    const parsedExpectedOrigin = new URL(expectedOrigin);
    if (
      parsedExpectedOrigin.username
      || parsedExpectedOrigin.password
      || parsedExpectedOrigin.pathname !== "/"
      || parsedExpectedOrigin.search
      || parsedExpectedOrigin.hash
    ) {
      return false;
    }
    normalizedExpectedOrigin = parsedExpectedOrigin.origin;
  } catch {
    return false;
  }
  if (
    url.origin !== normalizedExpectedOrigin
    || url.username
    || url.password
    || url.hash
    || !HOSTED_RUNTIME_PRIVATE_MEDIA_DELIVERY_PATH_PATTERN.test(url.pathname)
  ) {
    return false;
  }
  const entries = [...url.searchParams.entries()];
  if (
    entries.length !== 1
    || entries.filter(([key]) => key === "exp").length !== 1
  ) {
    return false;
  }
  const expiresAt = url.searchParams.get("exp");
  return expiresAt !== null
    && /^[1-9][0-9]*$/u.test(expiresAt)
    && Number.isSafeInteger(Number(expiresAt));
}

function isLegacyHostedRuntimePrivateImageDeliveryUrl(url: URL): boolean {
  const pathSegments = url.pathname.split("/").filter(Boolean);
  if (
    url.protocol !== "https:"
    || url.hostname !== "imagedelivery.net"
    || url.port
    || url.username
    || url.password
    || url.hash
    || pathSegments.length < 3
  ) {
    return false;
  }
  const entries = [...url.searchParams.entries()];
  if (entries.length === 0) {
    const pathAndSuffix = url.href.slice(url.origin.length);
    return /^\/[A-Za-z0-9_-]{1,256}\/[A-Za-z0-9_-]{1,256}\/public$/u
      .test(pathAndSuffix);
  }
  if (
    entries.length !== 2
    || entries.filter(([key]) => key === "exp").length !== 1
    || entries.filter(([key]) => key === "sig").length !== 1
  ) {
    return false;
  }
  const expiresAt = url.searchParams.get("exp");
  const signature = url.searchParams.get("sig");
  return expiresAt !== null
    && /^[1-9][0-9]*$/u.test(expiresAt)
    && Number.isSafeInteger(Number(expiresAt))
    && signature !== null
    && /^[0-9a-f]{64}$/u.test(signature);
}

/**
 * Injected by the hosted runtime from the current wake's Linq delivery
 * context; never supplied by the model. The web handler asserts the authority
 * row before touching the chat.
 */
export interface HostedRuntimeGroupToolLinqThreadContext {
  authority: HostedExecutionLinqExternalThreadRouteAuthority;
  chatId: string;
}

// Legacy runner-to-Web request shape retained at the old-facing control-plane
// boundary during the accepted-message participant rollout.
export interface HostedRuntimeGroupToolSelfOptOutContext {
  senderHandle: string;
  source: "email" | "linq";
}

export const HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX = 32;
export const HOSTED_RUNTIME_GROUP_SENDER_HANDLE_MAX_CODE_POINTS = 512;
// JSON can escape one code point to six bytes. One KiB covers the fixed
// request envelope, projection scopes, quotes, and commas.
export const HOSTED_RUNTIME_GROUP_TOOL_REQUEST_MAX_BYTES = 1_024
  + HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX
    * HOSTED_RUNTIME_GROUP_SENDER_HANDLE_MAX_CODE_POINTS
    * 6;
export const HOSTED_RUNTIME_GROUP_SHARED_READ_MAX_PROJECTION_SCOPES = 3;
export const HOSTED_RUNTIME_GROUP_SHARED_READ_MAX_MEMBERS = 200;
export const HOSTED_RUNTIME_GROUP_SHARED_READ_MAX_RECORDS_PER_PROJECTION =
  HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS;
export const HOSTED_RUNTIME_GROUP_SHARED_READ_MEMBER_ID_MAX_CODE_POINTS = 200;
export const HOSTED_RUNTIME_GROUP_SHARED_READ_PARTICIPANT_ID_MAX_CODE_POINTS = 200;
export const HOSTED_RUNTIME_GROUP_SHARED_READ_DISPLAY_NAME_MAX_CODE_POINTS = 200;
export const HOSTED_RUNTIME_GROUP_SHARED_READ_SCOPE_KEY_MAX_CODE_POINTS = 256;
export const HOSTED_RUNTIME_GROUP_SHARED_READ_UNAVAILABLE_REASON_MAX_CODE_POINTS = 500;
export const HOSTED_RUNTIME_GROUP_OWNER_ADVISORY_NAME_MAX_CODE_POINTS = 48;
export const HOSTED_RUNTIME_GROUP_CONTACT_CARD_SHARE_KEY_MAX_CODE_POINTS = 200;

export interface HostedRuntimeGroupChatParticipant {
  handle: string;
  /** Durable activation proof, not current access or membership in this group. */
  hasOwnMurph: boolean;
  /**
   * Optional, host-sanitized current-turn presentation name from the human
   * group owner's address-book projection. It grants no identity or routing
   * authority.
   */
  ownerAdvisoryName?: string;
}

export interface HostedRuntimeGroupSharedReadRequest {
  projectionScopes: readonly HostedVaultShareSelectableProjectionScope[];
}

export type HostedRuntimeGroupSharedRecord = Pick<
  HostedVaultShareDeliveryRecord,
  "data" | "occurredAt" | "recordKey" | "source"
>;

export interface HostedRuntimeGroupSharedProjection {
  /**
   * `pending` means an active readable grant exists but its first projection
   * snapshot has not materialized. `missing` is reserved for a completed empty
   * snapshot or a grant that current access makes unreadable.
   */
  dataStatus: "available" | "missing" | "pending";
  /**
   * Canonical UTC time at which the current exact-scope grant became active.
   * Missing means the producer predates this additive evidence field; null is
   * valid only when the scope is not granted.
   */
  grantedAt?: string | null;
  grantStatus: "granted" | "not_granted";
  projectionScope: HostedVaultShareSelectableProjectionScope;
  projectionScopeKey: string;
  records: readonly HostedRuntimeGroupSharedRecord[];
}

export interface HostedRuntimeGroupSharedMember {
  currentTurnHandles: readonly string[];
  displayName: string | null;
  memberId: string;
  participantId: string;
  projections: readonly HostedRuntimeGroupSharedProjection[];
}

export type HostedRuntimeGroupSharedReadResult =
  | {
      members: readonly HostedRuntimeGroupSharedMember[];
      requestedProjectionScopeKeys: readonly string[];
      status: "ok";
    }
  | {
      members: readonly [];
      requestedProjectionScopeKeys: readonly string[];
      status: "none";
    }
  | {
      status: "unavailable";
      unavailableReason: string;
    };

export const HOSTED_RUNTIME_GROUP_PARTICIPANT_DISPLAY_NAME_SOURCES = [
  "profile-name",
  "unverified-owner-contact",
] as const;

export type HostedRuntimeGroupParticipantDisplayNameSource =
  (typeof HOSTED_RUNTIME_GROUP_PARTICIPANT_DISPLAY_NAME_SOURCES)[number];

export interface HostedRuntimeGroupParticipantDisplayName {
  displayName: string;
  displayNameSource: HostedRuntimeGroupParticipantDisplayNameSource;
  senderHandle: string;
}

export type HostedRuntimeGroupParticipantDisplayNamesResult =
  | {
      /**
       * Requested handles for which Web successfully checked every applicable
       * authorized name source and found no safe display name. Omitted by
       * legacy Web deployments and never includes policy or authority
       * omissions.
       */
      nameMissSenderHandles?: readonly string[];
      participants: readonly HostedRuntimeGroupParticipantDisplayName[];
      status: "ok";
    }
  | {
      status: "unavailable";
      unavailableReason: string;
    };

export type HostedRuntimeGroupToolRequest =
  | {
      action: "ask";
      groupLabel?: string | null;
      originAssistantInputId: string;
      originSessionId: string;
      question: string;
    }
  | {
      action: "ask_current_sender";
      audience?: "current_sender" | "group";
      mode: "clarification" | "continuation" | "new";
      origin: Extract<
        HostedExecutionAssistantAskOrigin,
        { kind: "accepted_input" }
      >;
    }
  | {
      action: "record_current_sender_daily_metric";
      dailyMetric: HostedExecutionDailyMetricReportedPayload;
      origin: Extract<
        HostedExecutionAssistantAskOrigin,
        { kind: "accepted_input" }
      >;
    }
  | {
      action: "ask_member";
      grantId: string;
      origin: HostedExecutionAssistantAskOrigin;
      question: string;
    }
  | {
      action: "post_disclosure_request";
      linqThread?: HostedRuntimeGroupToolLinqThreadContext | null;
      originAssistantInputId: string;
      permissionText: string;
    }
  | { action: "revoke_disclosure_grant"; grantId: string }
  | { action: "read_current" }
  | {
      action: "prepare_next_group";
      setup?: HostedRuntimePendingGroupSetupInput;
    }
  | { action: "read_next_group" }
  | { action: "cancel_next_group" }
  | { action: "read_chat_name" }
  | { action: "read_usage" }
  | {
      action: "read_participant_display_names";
      /**
       * Exact route-admitted current-turn Linq sender evidence supplied by the
       * hosted runtime. Web preserves exact-member profile precedence and may
       * apply an unverified owner-contact label to an otherwise-unregistered
       * canonical phone. It returns presentation labels only, never
       * participant or member identifiers.
       */
      linqSenderHandles: readonly string[];
    }
  | {
      action: "create_signup_referral_link";
      participant?: HostedExecutionAcceptedGroupMessageParticipant | null;
    }
  | ({
      action: "read_usage_referral";
      participant?: HostedExecutionAcceptedGroupMessageParticipant | null;
    } & HostedRuntimeGroupToolSenderContext
      & HostedRuntimeUsageReferralSourceContext)
  | ({
      action: "arm_usage_referral";
      policyCodes: HostedUsageReferralPolicyCode[];
    } & HostedRuntimeGroupToolSenderContext
      & HostedRuntimeUsageReferralSourceContext)
  | ({
      action: "cancel_usage_referral";
      policyCode: HostedUsageReferralPolicyCode;
    } & HostedRuntimeGroupToolSenderContext)
  | ({
      action: "read_shared";
      /**
       * Current-turn sender evidence injected by the hosted runtime, kept in
       * one field per channel because each provider's handles are matched
       * against a different member identity index. A numeric Telegram user id
       * normalizes into a valid phone lookup key, so it must never reach the
       * Linq matcher. Exactly one field may be present.
       */
      linqSenderHandles?: readonly string[];
      telegramSenderHandles?: readonly string[];
    } & HostedRuntimeGroupSharedReadRequest)
  | {
      action: "prepare_email";
      projectionScopes: readonly HostedVaultShareSelectableProjectionScope[];
    }
  | { action: "list_memberships" }
  | { action: "leave_membership"; membershipId: string }
  | {
      action: "update_display_name";
      linqThread?: HostedRuntimeGroupToolLinqThreadContext | null;
      updateDisplayName: HostedRuntimeGroupUpdateDisplayNameRequest;
    }
  | { action: "create_join_link"; joinLink?: HostedRuntimeGroupCreateJoinLinkRequest | null }
  | {
      action: "post_join_offer";
      joinOffer?: HostedRuntimeGroupPostJoinOfferRequest | null;
      linqThread?: HostedRuntimeGroupToolLinqThreadContext | null;
    }
  | {
      action: "preflight_set_chat_avatar";
      linqThread?: HostedRuntimeGroupToolLinqThreadContext | null;
    }
  | { action: "read_chat_participants"; linqThread?: HostedRuntimeGroupToolLinqThreadContext | null }
  | {
      action: "set_chat_avatar";
      groupChatIconUrl: string;
      linqThread?: HostedRuntimeGroupToolLinqThreadContext | null;
    }
  | {
      action: "share_contact_card";
      contactCardImageUrl?: never;
      contactCardShareKey?: never;
      directLinqChatId?: never;
      linqThread?: HostedRuntimeGroupToolLinqThreadContext | null;
    }
  | {
      action: "share_contact_card";
      contactCardImageUrl: string;
      contactCardShareKey: string;
      /**
       * Trusted-host chat id for a personalized card in a direct conversation.
       * The trusted turn-context wrapper injects it before transport; Web then
       * revalidates that exact direct chat against the member's route owner.
       */
      directLinqChatId?: string;
      linqThread?: never;
    }
  | {
      action: "revoke_own_email_share";
      participant?: HostedExecutionAcceptedGroupMessageParticipant | null;
      selfOptOut?: HostedRuntimeGroupToolSelfOptOutContext | null;
    };

export type HostedRuntimeGroupAskResult =
  | { status: "accepted"; targetLabel: string | null }
  | { groupLabels: string[]; status: "clarification_required" }
  | { status: "no_groups" }
  | { status: "unavailable"; unavailableReason: string };

export type HostedRuntimeGroupMemberAskResult =
  | { status: "accepted" }
  | ({ status: "completed" } & HostedExecutionAssistantAskResult)
  | Extract<HostedRuntimeGroupAskResult, { status: "unavailable" }>;

export type HostedRuntimeGroupCurrentSenderDirectResult =
  | { status: "accepted" }
  | { status: "clarification_required" }
  | { status: "unavailable"; unavailableReason: string };

export type HostedRuntimeGroupDailyMetricReportResult =
  | { status: "accepted" }
  | { status: "unavailable"; unavailableReason: string };

export type HostedRuntimeGroupToolResponse =
  | {
      action: "ask";
      result: HostedRuntimeGroupAskResult;
    }
  | {
      action: "ask_current_sender";
      result: HostedRuntimeGroupCurrentSenderDirectResult;
    }
  | {
      action: "record_current_sender_daily_metric";
      result: HostedRuntimeGroupDailyMetricReportResult;
    }
  | { action: "ask_member"; result: HostedRuntimeGroupMemberAskResult }
  | {
      action: "post_disclosure_request";
      result:
        | { status: "sent" }
        | { status: "unavailable"; unavailableReason: string };
    }
  | {
      action: "revoke_disclosure_grant";
      result:
        | { status: "revoked" }
        | { status: "already_revoked" }
        | { status: "unavailable"; unavailableReason: string };
    }
  | {
      action: "read_current";
      result:
        | { status: "ok"; group: HostedRuntimeGroupSummary }
        | { status: "none"; group: null }
        | { status: "unavailable"; unavailableReason: string; group: null };
    }
  | {
      action: "prepare_next_group";
      result:
        | {
            expiresAt: string;
            setup: HostedRuntimePendingGroupSetupInput;
            status: "prepared";
          }
        | { status: "unavailable"; unavailableReason: string };
    }
  | {
      action: "read_next_group";
      result:
        | {
            expiresAt: string;
            setup: HostedRuntimePendingGroupSetupInput;
            status: "prepared";
          }
        | { status: "none" }
        | { status: "unavailable"; unavailableReason: string };
    }
  | {
      action: "cancel_next_group";
      result:
        | { status: "canceled" | "none" }
        | { status: "unavailable"; unavailableReason: string };
    }
  | {
      action: "read_chat_name";
      result:
        | { displayName: string; status: "ok" }
        | { displayName: null; status: "none" }
        | {
            displayName: null;
            status: "unavailable";
            unavailableReason: string;
          };
    }
  | {
      action: "read_usage";
      result:
        | { status: "ok"; usage: HostedRuntimeGroupUsageStatus }
        | { status: "unavailable"; unavailableReason: string; usage: null };
    }
  | {
      action: "read_participant_display_names";
      result: HostedRuntimeGroupParticipantDisplayNamesResult;
    }
  | {
      action: "read_shared";
      result: HostedRuntimeGroupSharedReadResult;
    }
  | {
      action: "prepare_email";
      result: HostedRuntimeGroupEmailPreparationResult;
    }
  | {
      action: "list_memberships";
      result:
        | {
            status: "ok";
            disclosureGrants: HostedRuntimeGroupDisclosureGrantListEntry[];
            memberships: HostedRuntimeGroupMembershipSummary[];
            truncated: boolean;
          }
        | {
            status: "unavailable";
            unavailableReason: string;
            memberships: null;
          };
    }
  | {
      action: "create_signup_referral_link";
      result:
        | {
            expiresAt: string;
            signupUrl: string;
            status: "ok";
          }
        | {
            status: "unavailable";
            unavailableReason: string;
          };
    }
  | {
      action:
        | "arm_usage_referral"
        | "cancel_usage_referral"
        | "read_usage_referral";
      result:
        | {
            outcome: "armed" | "canceled" | "read";
            referral: HostedRuntimeUsageReferralSnapshot;
            status: "ok";
          }
        | {
            referral: null;
            status: "unavailable";
            unavailableReason: string;
          };
    }
  | {
      action: "leave_membership";
      result:
        | { status: "left" }
        | { status: "already_left" }
        | { status: "owner_cannot_leave" }
        | { status: "unavailable"; unavailableReason: string };
    }
  | {
      action: "create_join_link";
      result:
        | {
            status: "ok";
            group: HostedRuntimeGroupSummary;
            joinUrl: string;
            /** Legacy additive evidence; consumers must not infer link delivery. */
            offeredAt?: string;
          }
        | { status: "unavailable"; unavailableReason: string; group: null };
    }
  | {
      action: "update_display_name";
      result:
        // The provider accepted the rename request. Like set_chat_avatar, this
        // is request acceptance, not an observation that the upstream title
        // changed. A null group means no updated hosted group summary came back
        // — either the chat has no hosted group record or the label write was
        // not confirmed. It does not prove which.
        | { status: "ok"; group: HostedRuntimeGroupSummary | null }
        | { status: "unavailable"; unavailableReason: string; group: null };
    }
  | {
      action: "post_join_offer";
      result:
        | {
            status: "sent";
            group: HostedRuntimeGroupSummary;
            joinUrl: string;
            /**
             * `posted` means the provider message was durably bound.
             * `existing` means Web reused a covering active offer; consumers
             * should present the returned first-party link instead of claiming
             * a new native message was sent.
             */
            offerState?: "existing" | "posted";
            /** Provider chronology only when the message was created during this send attempt. */
            offeredAt?: string;
          }
        | { status: "unavailable"; unavailableReason: string; group: null };
    }
  | {
      action: "read_chat_participants";
      result:
        | { status: "ok"; participants: HostedRuntimeGroupChatParticipant[] }
        | { status: "unavailable"; unavailableReason: string; participants: null };
    }
  | {
      action: "set_chat_avatar";
      result:
        | { status: "requested" }
        | { status: "ok" }
        | {
            status: "unavailable";
            unavailableReason: string;
            providerErrorCode?: number;
            providerErrorMessage?: string;
          };
    }
  | {
      action: "preflight_set_chat_avatar";
      result:
        | { status: "ok" }
        | { status: "unavailable"; unavailableReason: string };
    }
  | {
      action: "share_contact_card";
      result:
        | { status: "sent" }
        | { status: "already_shared" }
        // Personalized cards only: the provider may have accepted this exact
        // request and the send owner could not establish which.
        | { status: "unconfirmed" }
        | { status: "unavailable"; unavailableReason: string };
    }
  | {
      action: "revoke_own_email_share";
      result:
        | { status: "revoked"; revokedCount: number }
        | { status: "already_removed"; revokedCount: 0 }
        | { status: "unavailable"; unavailableReason: string };
    };

export type HostedRuntimeGroupEmailEffectAction =
  | "prepare_email"
  | "send_email";

export const HOSTED_RUNTIME_GROUP_EMAIL_SUBJECT_MAX_LENGTH = 160;
export const HOSTED_RUNTIME_GROUP_EMAIL_TEXT_MAX_LENGTH = 100_000;
export const HOSTED_RUNTIME_GROUP_EMAIL_HTML_MAX_LENGTH = 500_000;
export const HOSTED_RUNTIME_GROUP_EMAIL_PARTICIPANTS_MAX = 100;
export const HOSTED_RUNTIME_GROUP_EMAIL_AUTHORIZED_SHARES_PER_PARTICIPANT_MAX = 100;
export const HOSTED_RUNTIME_GROUP_EMAIL_AUTHORIZATION_PROOF_HEX_LENGTH = 64;
const HOSTED_RUNTIME_GROUP_EMAIL_AUTHORIZATION_PROOF_PATTERN = new RegExp(
  `^[0-9a-f]{${HOSTED_RUNTIME_GROUP_EMAIL_AUTHORIZATION_PROOF_HEX_LENGTH}}$`,
  "u",
);

export function isHostedRuntimeGroupEmailAuthorizationProof(
  value: unknown,
): value is string {
  return typeof value === "string"
    && HOSTED_RUNTIME_GROUP_EMAIL_AUTHORIZATION_PROOF_PATTERN.test(value);
}

export interface HostedRuntimeGroupEmailAuthorizedShare {
  projectionScopeKey: string;
  shareId: string;
}

export interface HostedRuntimeGroupEmailParticipantSummary {
  authorizedShares: HostedRuntimeGroupEmailAuthorizedShare[];
  hasEmail: boolean;
  memberId: string;
}

export interface HostedRuntimeScheduledAutomationAuthority {
  automationId: string;
  occurrenceAt: string;
}

export type HostedRuntimeGroupEmailScheduledAuthority =
  HostedRuntimeScheduledAutomationAuthority;

export interface HostedRuntimeGroupEmailEffectSendRequest {
  action: "send_email";
  html: string;
  subject: string;
  text?: string | null;
}

export interface HostedRuntimeGroupEmailEffectPrepareRequest {
  action: "prepare_email";
  projectionScopes: readonly HostedVaultShareSelectableProjectionScope[];
}

export type HostedRuntimeGroupEmailEffectRequest =
  | HostedRuntimeGroupEmailEffectPrepareRequest
  | HostedRuntimeGroupEmailEffectSendRequest;

export type HostedRuntimeGroupEmailPreparationResult =
  | {
      authorizationProof: string;
      groupId: string;
      missingEmailParticipants: HostedRuntimeGroupEmailParticipantSummary[];
      participants: HostedRuntimeGroupEmailParticipantSummary[];
      status: "ok";
    }
  | {
      status: "unavailable";
      unavailableReason: string;
    };

export type HostedRuntimeGroupEmailSendResult =
  | {
      participantCount: number;
      skippedNoEmailMemberIds: string[];
      status: "accepted";
    }
  | {
      participantCount: number;
      skippedNoEmailMemberIds: string[];
      status: "sent";
    }
  | {
      failedRecipientCount: number;
      participantCount: number;
      sentRecipientCount: number;
      skippedNoEmailMemberIds: string[];
      status: "partial_failure";
    }
  | {
      participantCount: 0;
      skippedNoEmailMemberIds: string[];
      status: "no_recipients";
    }
  | {
      status: "unavailable";
      unavailableReason: string;
    };

export type HostedRuntimeGroupEmailEffectResponse =
  | {
      action: "prepare_email";
      result: HostedRuntimeGroupEmailPreparationResult;
    }
  | {
      action: "send_email";
      result: HostedRuntimeGroupEmailSendResult;
    };

export type HostedRuntimeFamilyPlanToolAction =
  | "create_invite"
  | "read_status"
  | "start_checkout";

export const HOSTED_PLAN_CODES = ["pulse", "edge"] as const;
export type HostedPlanCode = (typeof HOSTED_PLAN_CODES)[number];

export const HOSTED_FAMILY_PLAN_CODES = ["pulse", "edge", "max"] as const;
export type HostedFamilyPlanCode = (typeof HOSTED_FAMILY_PLAN_CODES)[number];

export interface HostedRuntimeFamilyPlanCreateInviteRequest {
  planCode?: HostedFamilyPlanCode;
  targetEmail?: string | null;
  targetLabel?: string | null;
  targetPhoneNumber?: string | null;
  targetTelegramUsername?: string | null;
}

export type HostedRuntimeFamilyPlanToolRequest =
  | {
      action: "create_invite";
      invite: HostedRuntimeFamilyPlanCreateInviteRequest;
    }
  | {
      action: "read_status";
    }
  | {
      action: "start_checkout";
      confirmedTrialConversion?: true;
    };

export interface HostedRuntimeFamilyPlanActiveTrialConversion {
  includedPulseSeats: number;
  monthlyAmountUsdCents: number;
  perSeatMonthlyAmountUsdCents: number;
  trialEndsImmediately: true;
}

export interface HostedRuntimeFamilyPlanToolSeatStatus {
  active: number;
  billed: number;
  invited: number;
  max: number;
  min: number;
  remaining: number;
  used: number;
}

export interface HostedRuntimeFamilyPlanToolMember {
  isOwner: boolean;
  label: string | null;
  planCode: HostedFamilyPlanCode;
  role: string;
  status: string;
}

export interface HostedRuntimeFamilyPlanToolInvite {
  acceptUrl: string | null;
  expiresAt: string;
  planCode: HostedFamilyPlanCode;
  status: string;
  targetLabel: string | null;
  targetPhoneHint: string | null;
  telegramInviteUrl: string | null;
}

export interface HostedRuntimeFamilyPlanToolPlanStatus {
  active: number;
  billed: number;
  invited: number;
  remaining: number;
  used: number;
}

export type HostedRuntimeFamilyPlanToolPlans = Record<
  HostedFamilyPlanCode,
  HostedRuntimeFamilyPlanToolPlanStatus
>;

export interface HostedRuntimeFamilyPlanToolStatusResponse {
  activeTrialConversion: HostedRuntimeFamilyPlanActiveTrialConversion | null;
  billingActive: boolean;
  billingStatus: string;
  members: HostedRuntimeFamilyPlanToolMember[];
  owner: boolean;
  pendingInvites: HostedRuntimeFamilyPlanToolInvite[];
  plans: HostedRuntimeFamilyPlanToolPlans;
  seats: HostedRuntimeFamilyPlanToolSeatStatus;
}

export interface HostedRuntimeFamilyPlanToolCreateInviteResponse {
  invite: HostedRuntimeFamilyPlanToolInvite;
  plans: HostedRuntimeFamilyPlanToolPlans;
  replyText: string;
  seats: HostedRuntimeFamilyPlanToolSeatStatus;
}

export interface HostedRuntimeFamilyPlanToolStartCheckoutResponse {
  alreadyActive: boolean;
  billingActive: boolean;
  billingStatus: string;
  checkoutUrl: string | null;
  owner: boolean;
  plans: HostedRuntimeFamilyPlanToolPlans;
  seats: HostedRuntimeFamilyPlanToolSeatStatus;
  unavailableReason: "already_sponsored" | null;
}

export type HostedRuntimeFamilyPlanToolResponse =
  | {
      action: "create_invite";
      result: HostedRuntimeFamilyPlanToolCreateInviteResponse;
    }
  | {
      action: "read_status";
      result: HostedRuntimeFamilyPlanToolStatusResponse;
    }
  | {
      action: "start_checkout";
      result: HostedRuntimeFamilyPlanToolStartCheckoutResponse;
    };

export interface HostedRuntimeIMessageContactToolRequest {
  assistantInputId: string;
}

export type HostedRuntimeIMessageContactToolResponse =
  | {
      phoneNumber: string;
      status: "assigned" | "existing";
      verifiedSenderPhoneHint: string;
    }
  | {
      phoneNumber: null;
      status: "identity_required" | "unavailable";
      verifiedSenderPhoneHint: null;
    };

export type HostedRuntimeAssistantConfigurationToolRequest =
  | {
      action: "read";
    }
  | ({
      action: "update";
    } & HostedRuntimeAssistantConfigurationChanges);

export type HostedRuntimeAssistantConfigurationChanges =
  | {
      model: HostedAssistantProductModel;
      provider?: HostedAssistantProvider;
      reasoningEffort?: HostedAssistantReasoningEffort;
    }
  | {
      model?: never;
      provider: HostedAssistantProvider;
      reasoningEffort?: HostedAssistantReasoningEffort;
    }
  | {
      model?: never;
      provider?: never;
      reasoningEffort: HostedAssistantReasoningEffort;
    };

export type HostedRuntimeAssistantConfigurationControlRequest =
  | {
      action: "read";
    }
  | ({
      action: "update";
      assistantInputId: string;
    } & HostedRuntimeAssistantConfigurationChanges);

export interface HostedRuntimeAssistantConfigurationSnapshot {
  availableModels: HostedAssistantProductModel[];
  availableProviders: HostedAssistantProvider[];
  availableReasoningEfforts: HostedAssistantReasoningEffort[];
  configurationAvailable: boolean;
  dormantSolPreference: boolean;
  model: HostedAssistantProductModel;
  provider: HostedAssistantProvider;
  reasoningEffort: HostedAssistantReasoningEffort;
  solAvailable: boolean;
}

export type HostedRuntimeAssistantConfigurationUpdateStatus =
  | "unchanged"
  | "unavailable"
  | "updated"
  | "upgrade_required";

export type HostedRuntimeAssistantConfigurationToolResponse =
  | {
      action: "read";
      result: HostedRuntimeAssistantConfigurationSnapshot;
    }
  | {
      action: "update";
      result: HostedRuntimeAssistantConfigurationSnapshot & {
        appliesAt: "next_turn";
        requiredPlan: "edge" | null;
        status: HostedRuntimeAssistantConfigurationUpdateStatus;
      };
    };

export type HostedCodexAuthUpdate =
  | {
      attemptId: string;
      phase: "device_code";
      userCode: string;
      verificationUrl: string;
    }
  | {
      attemptId: string;
      phase: "connected" | "disconnected" | "failed";
    };

export const HOSTED_CODEX_AUTH_UPDATE_RESPONSE_STATUSES = [
  "applied",
  "already_applied",
  "superseded",
] as const;

export type HostedCodexAuthUpdateResponseStatus =
  (typeof HOSTED_CODEX_AUTH_UPDATE_RESPONSE_STATUSES)[number];

export interface HostedCodexAuthUpdateResponse {
  applied: boolean;
  status: HostedCodexAuthUpdateResponseStatus;
}

export interface HostedRuntimeIssueExportRequest {
  issues: AssistantRuntimeIssueRecord[];
}

export interface HostedRuntimeIssueExportResponse {
  issueIds: string[];
  recorded: number;
}

export const HOSTED_INGRESS_LATENCY_SOURCES = [
  "linq",
  "telegram",
] as const;

export type HostedIngressLatencySource =
  (typeof HOSTED_INGRESS_LATENCY_SOURCES)[number];

export function readHostedIngressLatencySource(
  value: unknown,
): HostedIngressLatencySource | null {
  if (typeof value !== "string") {
    return null;
  }
  return (HOSTED_INGRESS_LATENCY_SOURCES as readonly string[]).includes(value)
    ? value as HostedIngressLatencySource
    : null;
}

export const HOSTED_RUNTIME_LATENCY_TRACE_ASSISTANT_INPUT_MAX_IDS = 64;
export const HOSTED_RUNTIME_LATENCY_TRACE_BODY_LIMIT_BYTES = 32 * 1024;
export const HOSTED_RUNTIME_LATENCY_TRACE_MILESTONES = [
  "runner_job_accepted",
  "runtime_phase_started",
  "workspace_restore_done",
  "mailbox_import_done",
  "checkpoint_publication_expected_by",
] as const;

export const HOSTED_RUNTIME_ASSISTANT_MILESTONES = [
  "linq_typing_request_started",
  "linq_typing_accepted",
  "progress_update_accepted",
  "first_codex_output_observed",
  "first_codex_text_observed",
  "terminal_non_reply_committed",
] as const;

export type HostedRuntimeAssistantMilestone =
  (typeof HOSTED_RUNTIME_ASSISTANT_MILESTONES)[number];

export type HostedRuntimeLatencyTraceMilestone =
  (typeof HOSTED_RUNTIME_LATENCY_TRACE_MILESTONES)[number];

export interface HostedRuntimeLatencyPhaseBreakdown {
  schemaVersion: number;
  // Control-plane orchestration diagnostics before the runner-container DO
  // starts dispatch. Timestamps come from different hosts and are for coarse
  // span splitting only. The two bounded ids correlate one Web direct ensure
  // with the runtime invocation it launched.
  orchestration?: {
    temporalActivityStartedAtEpochMs?: number;
    temporalActivityRequestStartedAtEpochMs?: number;
    tokenAcquireStartedAtEpochMs?: number;
    tokenAcquiredAtEpochMs?: number;
    directEnsureRequestStartedAtEpochMs?: number;
    directEnsureResponseReceivedAtEpochMs?: number;
    directEnsureOrchestrationAttemptId?: string;
    directEnsureResultKind?:
      | "legacy_accepted"
      | "runtime_processing_accepted"
      | "retry_later";
    directEnsureAction?: "started" | "replaced" | "woken" | "already_running";
    directEnsureRuntimeAttemptId?: string;
    runtimeControlAuthStartedAtEpochMs?: number;
    runtimeControlAuthFinishedAtEpochMs?: number;
    cloudflareRouteReceivedAtEpochMs?: number;
    runtimeInvocationOrchestrationAttemptId?: string;
    triggeredByWebDirect?: boolean;
    userRunnerRpcStartedAtEpochMs?: number;
    runtimeConsentLockAcquiredAtEpochMs?: number;
    healthDataAdmissionReadStartedAtEpochMs?: number;
    healthDataAdmissionReadFinishedAtEpochMs?: number;
    userRunnerEnsureStartedAtEpochMs?: number;
    runnerStateBindStartedAtEpochMs?: number;
    runnerStateBindFinishedAtEpochMs?: number;
    runnerStateReadStartedAtEpochMs?: number;
    runnerStateReadFinishedAtEpochMs?: number;
    activeFenceObservedAtEpochMs?: number;
    activeFenceTargetWasPriorVersion?: boolean;
    activeWakeStartedAtEpochMs?: number;
    activeWakeFinishedAtEpochMs?: number;
    activeWakeElapsedMs?: number;
    activeWakeAccepted?: boolean;
    activeWakeFoundNoActiveChild?: boolean;
    replacementFenceClearStartedAtEpochMs?: number;
    replacementFenceClearedAtEpochMs?: number;
    replacementFenceClearElapsedMs?: number;
    replacedStaleFence?: boolean;
    freshStartRequestedAtEpochMs?: number;
    freshStartFenceBoundAtEpochMs?: number;
    freshStartContainerReadyAtEpochMs?: number;
    freshStartInvocationPreparedAtEpochMs?: number;
    freshStartInvocationAcceptedAtEpochMs?: number;
    shellPrewarmFirstHintAtEpochMs?: number;
    shellPrewarmFinishedAtEpochMs?: number;
    shellPrewarmOperationElapsedMs?: number;
    shellPrewarmHintCount?: number;
    shellPrewarmOutcome?:
      | "cold_start_observed"
      | "failed"
      | "start_issued_warm"
      | "superseded";
    shellPrewarmSource?:
      | "linq-instant-start"
      | "linq-typing-started"
      | "unknown";
    workspaceReadElapsedMs?: number;
    runtimeStoreEnsureElapsedMs?: number;
    runtimeInvocationPreparationElapsedMs?: number;
  };
  // Durable Object dispatch stamps (DO-side Date.now() epoch ms), diagnostics
  // only. invokeReceivedAtEpochMs is stamped when the DO invoke handler starts;
  // containerEnsureReadyStartedAtEpochMs immediately before ensureContainerReady,
  // which may be a warm no-op rather than a container start. The segment from
  // there to runner_job_accepted_at therefore bundles container scheduling/boot
  // (cold only, nodeStartupMs measures the boot slice), the runner POST, request
  // body decode, and the lazy runtime-contract load — not pure CF scheduling.
  dispatch?: {
    invokeReceivedAtEpochMs?: number;
    containerEnsureReadyStartedAtEpochMs?: number;
  };
  restore?: {
    sizeGuardMs?: number;
    dataKeyUnwrapMs?: number;
    scratchPrepareMs?: number;
    presignGetMs?: number;
    objectFetchMs?: number;
    // Last successful GET attempt, from request start until Fetch resolves headers.
    objectFetchResponseHeadersMs?: number;
    // Last successful GET attempt, from validated headers until stream EOF. This
    // includes consumer backpressure from streamed hash/decrypt work.
    objectFetchBodyReadMs?: number;
    decryptMs?: number;
    archiveExtractMs?: number;
    durableRootReplaceMs?: number;
    cleanupMs?: number;
    extractMs?: number;
    encryptedBytes?: number;
    plainBytes?: number;
    replaySafeReadMaxAttempt?: number;
  };
  boot?: {
    nodeStartupMs?: number;
    restoreWasCold?: boolean;
  };
  wake?: {
    runtimeWakeNotifiedAtEpochMs?: number;
    foregroundWaitResolvedAtEpochMs?: number;
    foregroundImportStartedAtEpochMs?: number;
    foregroundWakeOrdinal?: number;
    activeRuntimePassOrdinal?: number;
    activeRuntimePassStartedAtEpochMs?: number;
    activeRuntimePassForeground?: boolean;
  };
  import?: {
    decodeStartedAtEpochMs?: number;
    decodeDoneAtEpochMs?: number;
    autoReplyPreparedAtEpochMs?: number;
    pendingIndexEnsuredAtEpochMs?: number;
    stagedAtEpochMs?: number;
  };
  // Runtime-owned work between mailbox staging and the assistant engine's
  // local Codex turn/start write. These metadata-only diagnostics are attached
  // to that existing milestone rather than emitted synchronously.
  // Only mailboxImportDoneToAssistantPhaseMs,
  // workspaceAssistantPreAutomationMs, and
  // automationLaneToAssistantServiceMs participate in the canonical additive
  // provider-start path. The other leaves are nested diagnostics.
  preProvider?: {
    mailboxImportDoneToAssistantPhaseMs?: number;
    // These adjacent nested leaves exactly partition
    // mailboxImportDoneToAssistantPhaseMs when all are present.
    mailboxImportDoneToForegroundPassMs?: number;
    foregroundPassToWorkspaceForegroundPassMs?: number;
    workspaceForegroundPassToAssistantPhaseCallbackMs?: number;
    assistantPhaseCallbackToAssistantPhaseMs?: number;
    workspaceAssistantPreAutomationMs?: number;
    automationLaneToAssistantServiceMs?: number;
    // These adjacent nested leaves exactly partition
    // automationLaneToAssistantServiceMs when all are present.
    automationReadinessMs?: number;
    automationInputSelectionMs?: number;
    automationPassSetupMs?: number;
    automationCandidateScanMs?: number;
    automationGroupAndOperationScopeMs?: number;
    automationTerminalEvidenceMs?: number;
    automationSessionPreflightMs?: number;
    automationCrossSessionContextMs?: number;
    automationPromptPreparationMs?: number;
    automationServiceHandoffMs?: number;
    executionTargetHydrateMs?: number;
    systemMailboxMaintenanceMs?: number;
    memberPreferencesPrePlanningMs?: number;
    automationBootstrapMs?: number;
    outboxScanBytesRead?: number;
    outboxScanElapsedMs?: number;
    outboxScanFilesRead?: number;
    outboxScanPerformed?: boolean;
    receiptScanBytesRead?: number;
    receiptScanElapsedMs?: number;
    receiptScanFilesRead?: number;
    receiptScanLockWaitMs?: number;
    receiptScanPerformed?: boolean;
  };
  // Exact runtime-observed epoch timestamps. These deliberately distinguish
  // visible channel activity and local Codex output from an upstream provider
  // request or token boundary that the runtime cannot observe.
  assistant?: {
    linqTypingRequestStartedAtEpochMs?: number;
    linqTypingAcceptedAtEpochMs?: number;
    progressUpdateAcceptedAtEpochMs?: number;
    firstCodexOutputObservedAtEpochMs?: number;
    firstCodexTextObservedAtEpochMs?: number;
    terminalNonReplyCommittedAtEpochMs?: number;
    checkpointPublicationExpectedByEpochMs?: number;
    runtimeLeaseGeneration?: string;
  };
  provider?: {
    // Together with the three canonical preProvider leaves, these six leaves
    // are adjacent and additive. Session, prompt, admission, and App Server
    // lifecycle leaves below are nested diagnostics and must not be added.
    assistantServicePreLockMs?: number;
    codexAppServerInitializeMs?: number;
    codexAppServerPreProviderMs?: number;
    codexAppServerSpawnReadyMs?: number;
    codexAppServerThreadResumeMs?: number;
    codexAppServerThreadStartMs?: number;
    codexAppServerWarmReuseMs?: number;
    codexProcessPreparationMs?: number;
    turnLockWaitMs?: number;
    sessionResolveMs?: number;
    promptBuildMs?: number;
    admissionMs?: number;
    preProviderSetupMs?: number;
    providerPlanAndGateMs?: number;
    linqEgressGuardMs?: number;
  };
}

export const HOSTED_RUNTIME_MAILBOX_TO_ASSISTANT_TIMING_SUBDIVISION_KEYS = [
  "mailboxImportDoneToForegroundPassMs",
  "foregroundPassToWorkspaceForegroundPassMs",
  "workspaceForegroundPassToAssistantPhaseCallbackMs",
  "assistantPhaseCallbackToAssistantPhaseMs",
] as const;

type HostedRuntimeMailboxToAssistantTimingSubdivision = Required<Pick<
  NonNullable<HostedRuntimeLatencyPhaseBreakdown["preProvider"]>,
  (typeof HOSTED_RUNTIME_MAILBOX_TO_ASSISTANT_TIMING_SUBDIVISION_KEYS)[number]
>>;

export type HostedRuntimeMailboxToAssistantTimingSubdivisionInspection =
  | { kind: "absent" }
  | { kind: "invalid" }
  | {
      kind: "complete";
      subdivision: HostedRuntimeMailboxToAssistantTimingSubdivision;
    };

export function inspectHostedRuntimeMailboxToAssistantTimingSubdivision(
  preProvider: NonNullable<HostedRuntimeLatencyPhaseBreakdown["preProvider"]>,
): HostedRuntimeMailboxToAssistantTimingSubdivisionInspection {
  const {
    assistantPhaseCallbackToAssistantPhaseMs,
    foregroundPassToWorkspaceForegroundPassMs,
    mailboxImportDoneToForegroundPassMs,
    workspaceForegroundPassToAssistantPhaseCallbackMs,
  } = preProvider;
  if (
    assistantPhaseCallbackToAssistantPhaseMs === undefined
    && foregroundPassToWorkspaceForegroundPassMs === undefined
    && mailboxImportDoneToForegroundPassMs === undefined
    && workspaceForegroundPassToAssistantPhaseCallbackMs === undefined
  ) {
    return { kind: "absent" };
  }
  if (
    assistantPhaseCallbackToAssistantPhaseMs === undefined
    || foregroundPassToWorkspaceForegroundPassMs === undefined
    || mailboxImportDoneToForegroundPassMs === undefined
    || workspaceForegroundPassToAssistantPhaseCallbackMs === undefined
  ) {
    return { kind: "invalid" };
  }

  const subdivision = {
    mailboxImportDoneToForegroundPassMs,
    foregroundPassToWorkspaceForegroundPassMs,
    workspaceForegroundPassToAssistantPhaseCallbackMs,
    assistantPhaseCallbackToAssistantPhaseMs,
  };
  const values = Object.values(subdivision);
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    return { kind: "invalid" };
  }
  const sum = values.reduce<number>((total, value) => total + value, 0);
  if (
    !Number.isSafeInteger(sum)
    || !Number.isSafeInteger(preProvider.mailboxImportDoneToAssistantPhaseMs)
    || preProvider.mailboxImportDoneToAssistantPhaseMs !== sum
  ) {
    return { kind: "invalid" };
  }
  return {
    kind: "complete",
    subdivision,
  };
}

export const HOSTED_RUNTIME_AUTOMATION_LANE_TIMING_SUBDIVISION_KEYS = [
  "automationReadinessMs",
  "automationInputSelectionMs",
  "automationPassSetupMs",
  "automationCandidateScanMs",
  "automationGroupAndOperationScopeMs",
  "automationTerminalEvidenceMs",
  "automationSessionPreflightMs",
  "automationCrossSessionContextMs",
  "automationPromptPreparationMs",
  "automationServiceHandoffMs",
] as const;

type HostedRuntimeAutomationLaneTimingSubdivision = Required<Pick<
  NonNullable<HostedRuntimeLatencyPhaseBreakdown["preProvider"]>,
  (typeof HOSTED_RUNTIME_AUTOMATION_LANE_TIMING_SUBDIVISION_KEYS)[number]
>>;

export type HostedRuntimeAutomationLaneTimingSubdivisionInspection =
  | { kind: "absent" }
  | { kind: "invalid" }
  | {
      kind: "complete";
      subdivision: HostedRuntimeAutomationLaneTimingSubdivision;
    };

export function inspectHostedRuntimeAutomationLaneTimingSubdivision(
  preProvider: NonNullable<HostedRuntimeLatencyPhaseBreakdown["preProvider"]>,
): HostedRuntimeAutomationLaneTimingSubdivisionInspection {
  const {
    automationCandidateScanMs,
    automationCrossSessionContextMs,
    automationGroupAndOperationScopeMs,
    automationInputSelectionMs,
    automationPassSetupMs,
    automationPromptPreparationMs,
    automationReadinessMs,
    automationServiceHandoffMs,
    automationSessionPreflightMs,
    automationTerminalEvidenceMs,
  } = preProvider;
  if (
    automationCandidateScanMs === undefined
    && automationCrossSessionContextMs === undefined
    && automationGroupAndOperationScopeMs === undefined
    && automationInputSelectionMs === undefined
    && automationPassSetupMs === undefined
    && automationPromptPreparationMs === undefined
    && automationReadinessMs === undefined
    && automationServiceHandoffMs === undefined
    && automationSessionPreflightMs === undefined
    && automationTerminalEvidenceMs === undefined
  ) {
    return { kind: "absent" };
  }
  if (
    automationCandidateScanMs === undefined
    || automationCrossSessionContextMs === undefined
    || automationGroupAndOperationScopeMs === undefined
    || automationInputSelectionMs === undefined
    || automationPassSetupMs === undefined
    || automationPromptPreparationMs === undefined
    || automationReadinessMs === undefined
    || automationServiceHandoffMs === undefined
    || automationSessionPreflightMs === undefined
    || automationTerminalEvidenceMs === undefined
  ) {
    return { kind: "invalid" };
  }

  const subdivision = {
    automationReadinessMs,
    automationInputSelectionMs,
    automationPassSetupMs,
    automationCandidateScanMs,
    automationGroupAndOperationScopeMs,
    automationTerminalEvidenceMs,
    automationSessionPreflightMs,
    automationCrossSessionContextMs,
    automationPromptPreparationMs,
    automationServiceHandoffMs,
  };
  const values = Object.values(subdivision);
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    return { kind: "invalid" };
  }
  const sum = values.reduce<number>((total, value) => total + value, 0);
  if (
    !Number.isSafeInteger(sum)
    || !Number.isSafeInteger(preProvider.automationLaneToAssistantServiceMs)
    || preProvider.automationLaneToAssistantServiceMs !== sum
  ) {
    return { kind: "invalid" };
  }
  return {
    kind: "complete",
    subdivision,
  };
}

export const HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_PHASE_KEYS = [
  "orchestration",
  "dispatch",
  "restore",
  "boot",
  "wake",
  "import",
  "preProvider",
  "assistant",
  "provider",
] as const;

export type HostedRuntimeLatencyPhaseBreakdownPhase =
  (typeof HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_PHASE_KEYS)[number];

export const HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_KEYS = [
  "schemaVersion",
  ...HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_PHASE_KEYS,
] as const;

export const HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_LEAF_KEYS: Record<
  HostedRuntimeLatencyPhaseBreakdownPhase,
  readonly string[]
> = {
  orchestration: [
    "temporalActivityStartedAtEpochMs",
    "temporalActivityRequestStartedAtEpochMs",
    "tokenAcquireStartedAtEpochMs",
    "tokenAcquiredAtEpochMs",
    "directEnsureRequestStartedAtEpochMs",
    "directEnsureResponseReceivedAtEpochMs",
    "directEnsureOrchestrationAttemptId",
    "directEnsureResultKind",
    "directEnsureAction",
    "directEnsureRuntimeAttemptId",
    "runtimeControlAuthStartedAtEpochMs",
    "runtimeControlAuthFinishedAtEpochMs",
    "cloudflareRouteReceivedAtEpochMs",
    "runtimeInvocationOrchestrationAttemptId",
    "triggeredByWebDirect",
    "userRunnerRpcStartedAtEpochMs",
    "runtimeConsentLockAcquiredAtEpochMs",
    "healthDataAdmissionReadStartedAtEpochMs",
    "healthDataAdmissionReadFinishedAtEpochMs",
    "userRunnerEnsureStartedAtEpochMs",
    "runnerStateBindStartedAtEpochMs",
    "runnerStateBindFinishedAtEpochMs",
    "runnerStateReadStartedAtEpochMs",
    "runnerStateReadFinishedAtEpochMs",
    "activeFenceObservedAtEpochMs",
    "activeFenceTargetWasPriorVersion",
    "activeWakeStartedAtEpochMs",
    "activeWakeFinishedAtEpochMs",
    "activeWakeElapsedMs",
    "activeWakeAccepted",
    "activeWakeFoundNoActiveChild",
    "replacementFenceClearStartedAtEpochMs",
    "replacementFenceClearedAtEpochMs",
    "replacementFenceClearElapsedMs",
    "replacedStaleFence",
    "freshStartRequestedAtEpochMs",
    "freshStartFenceBoundAtEpochMs",
    "freshStartContainerReadyAtEpochMs",
    "freshStartInvocationPreparedAtEpochMs",
    "freshStartInvocationAcceptedAtEpochMs",
    "shellPrewarmFirstHintAtEpochMs",
    "shellPrewarmFinishedAtEpochMs",
    "shellPrewarmOperationElapsedMs",
    "shellPrewarmHintCount",
    "shellPrewarmOutcome",
    "shellPrewarmSource",
    "workspaceReadElapsedMs",
    "runtimeStoreEnsureElapsedMs",
    "runtimeInvocationPreparationElapsedMs",
  ],
  dispatch: [
    "invokeReceivedAtEpochMs",
    "containerEnsureReadyStartedAtEpochMs",
  ],
  restore: [
    "sizeGuardMs",
    "dataKeyUnwrapMs",
    "scratchPrepareMs",
    "presignGetMs",
    "objectFetchMs",
    "objectFetchResponseHeadersMs",
    "objectFetchBodyReadMs",
    "decryptMs",
    "archiveExtractMs",
    "durableRootReplaceMs",
    "cleanupMs",
    "extractMs",
    "encryptedBytes",
    "plainBytes",
    "replaySafeReadMaxAttempt",
  ],
  boot: ["nodeStartupMs", "restoreWasCold"],
  wake: [
    "runtimeWakeNotifiedAtEpochMs",
    "foregroundWaitResolvedAtEpochMs",
    "foregroundImportStartedAtEpochMs",
    "foregroundWakeOrdinal",
    "activeRuntimePassOrdinal",
    "activeRuntimePassStartedAtEpochMs",
    "activeRuntimePassForeground",
  ],
  import: [
    "decodeStartedAtEpochMs",
    "decodeDoneAtEpochMs",
    "autoReplyPreparedAtEpochMs",
    "pendingIndexEnsuredAtEpochMs",
    "stagedAtEpochMs",
  ],
  preProvider: [
    "mailboxImportDoneToAssistantPhaseMs",
    "mailboxImportDoneToForegroundPassMs",
    "foregroundPassToWorkspaceForegroundPassMs",
    "workspaceForegroundPassToAssistantPhaseCallbackMs",
    "assistantPhaseCallbackToAssistantPhaseMs",
    "workspaceAssistantPreAutomationMs",
    "automationLaneToAssistantServiceMs",
    "automationReadinessMs",
    "automationInputSelectionMs",
    "automationPassSetupMs",
    "automationCandidateScanMs",
    "automationGroupAndOperationScopeMs",
    "automationTerminalEvidenceMs",
    "automationSessionPreflightMs",
    "automationCrossSessionContextMs",
    "automationPromptPreparationMs",
    "automationServiceHandoffMs",
    "executionTargetHydrateMs",
    "systemMailboxMaintenanceMs",
    "memberPreferencesPrePlanningMs",
    "automationBootstrapMs",
    "outboxScanBytesRead",
    "outboxScanElapsedMs",
    "outboxScanFilesRead",
    "outboxScanPerformed",
    "receiptScanBytesRead",
    "receiptScanElapsedMs",
    "receiptScanFilesRead",
    "receiptScanLockWaitMs",
    "receiptScanPerformed",
  ],
  assistant: [
    "linqTypingRequestStartedAtEpochMs",
    "linqTypingAcceptedAtEpochMs",
    "progressUpdateAcceptedAtEpochMs",
    "firstCodexOutputObservedAtEpochMs",
    "firstCodexTextObservedAtEpochMs",
    "terminalNonReplyCommittedAtEpochMs",
    "checkpointPublicationExpectedByEpochMs",
    "runtimeLeaseGeneration",
  ],
  provider: [
    "assistantServicePreLockMs",
    "codexAppServerInitializeMs",
    "codexAppServerPreProviderMs",
    "codexAppServerSpawnReadyMs",
    "codexAppServerThreadResumeMs",
    "codexAppServerThreadStartMs",
    "codexAppServerWarmReuseMs",
    "codexProcessPreparationMs",
    "turnLockWaitMs",
    "sessionResolveMs",
    "promptBuildMs",
    "admissionMs",
    "preProviderSetupMs",
    "providerPlanAndGateMs",
    "linqEgressGuardMs",
  ],
} as const;

export const HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_BOOLEAN_LEAF_KEYS =
  [
    "orchestration.activeFenceTargetWasPriorVersion",
    "orchestration.activeWakeAccepted",
    "orchestration.activeWakeFoundNoActiveChild",
    "orchestration.replacedStaleFence",
    "orchestration.triggeredByWebDirect",
    "wake.activeRuntimePassForeground",
    "boot.restoreWasCold",
    "preProvider.outboxScanPerformed",
    "preProvider.receiptScanPerformed",
  ] as const;

const HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_STRING_LEAF_VALUES:
  Readonly<Record<string, readonly string[]>> = {
    "orchestration.shellPrewarmOutcome": [
      "cold_start_observed",
      "failed",
      "start_issued_warm",
      "superseded",
    ],
    "orchestration.shellPrewarmSource": [
      "linq-instant-start",
      "linq-typing-started",
      "unknown",
    ],
    "orchestration.directEnsureResultKind": [
      "legacy_accepted",
      "runtime_processing_accepted",
      "retry_later",
    ],
    "orchestration.directEnsureAction": [
      "started",
      "replaced",
      "woken",
      "already_running",
    ],
  };

export type HostedRuntimeLatencyPhaseBreakdownLeafRule =
  | { kind: "boolean" }
  | { kind: "enum_string"; values: readonly string[] }
  | { kind: "lease_generation" }
  | { kind: "orchestration_attempt_id" }
  | { kind: "opaque_identifier" }
  | { kind: "safe_integer" };

export const HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_LEAF_RULES: Readonly<
  Record<
    HostedRuntimeLatencyPhaseBreakdownPhase,
    Readonly<Record<string, HostedRuntimeLatencyPhaseBreakdownLeafRule>>
  >
> = {
  assistant: buildHostedRuntimeLatencyPhaseBreakdownLeafRules("assistant"),
  boot: buildHostedRuntimeLatencyPhaseBreakdownLeafRules("boot"),
  dispatch: buildHostedRuntimeLatencyPhaseBreakdownLeafRules("dispatch"),
  import: buildHostedRuntimeLatencyPhaseBreakdownLeafRules("import"),
  orchestration: buildHostedRuntimeLatencyPhaseBreakdownLeafRules("orchestration"),
  preProvider: buildHostedRuntimeLatencyPhaseBreakdownLeafRules("preProvider"),
  provider: buildHostedRuntimeLatencyPhaseBreakdownLeafRules("provider"),
  restore: buildHostedRuntimeLatencyPhaseBreakdownLeafRules("restore"),
  wake: buildHostedRuntimeLatencyPhaseBreakdownLeafRules("wake"),
};

function buildHostedRuntimeLatencyPhaseBreakdownLeafRules(
  phase: HostedRuntimeLatencyPhaseBreakdownPhase,
): Readonly<Record<string, HostedRuntimeLatencyPhaseBreakdownLeafRule>> {
  return Object.fromEntries(
    HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_LEAF_KEYS[phase].map(
      (leafKey): [string, HostedRuntimeLatencyPhaseBreakdownLeafRule] => [
        leafKey,
        readHostedRuntimeLatencyPhaseBreakdownLeafRule(phase, leafKey),
      ],
    ),
  );
}

function readHostedRuntimeLatencyPhaseBreakdownLeafRule(
  phase: HostedRuntimeLatencyPhaseBreakdownPhase,
  leafKey: string,
): HostedRuntimeLatencyPhaseBreakdownLeafRule {
  if (
    phase === "orchestration"
    && (
      leafKey === "directEnsureOrchestrationAttemptId"
      || leafKey === "runtimeInvocationOrchestrationAttemptId"
    )
  ) {
    return { kind: "orchestration_attempt_id" };
  }
  if (
    phase === "orchestration"
    && leafKey === "directEnsureRuntimeAttemptId"
  ) {
    return { kind: "opaque_identifier" };
  }
  const allowedStringValues =
    HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_STRING_LEAF_VALUES[`${phase}.${leafKey}`];
  if (allowedStringValues) {
    return { kind: "enum_string", values: allowedStringValues };
  }
  if (phase === "assistant" && leafKey === "runtimeLeaseGeneration") {
    return { kind: "lease_generation" };
  }
  if (
    HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_BOOLEAN_LEAF_KEYS.some(
      (key) => key === `${phase}.${leafKey}`,
    )
  ) {
    return { kind: "boolean" };
  }
  return { kind: "safe_integer" };
}

export type HostedRuntimeLatencyPhaseBreakdownJsonLeaf = number | boolean | string;
export type HostedRuntimeOrchestrationLatencyDiagnostics = NonNullable<
  HostedRuntimeLatencyPhaseBreakdown["orchestration"]
>;

export const HOSTED_RUNTIME_ORCHESTRATION_LATENCY_DIAGNOSTICS_HEADER =
  "x-hosted-runtime-orchestration-latency";

export type HostedRuntimeLatencyPhaseBreakdownJson = {
  [key: string]:
    | HostedRuntimeLatencyPhaseBreakdownJsonLeaf
    | Record<string, HostedRuntimeLatencyPhaseBreakdownJsonLeaf>;
};

export interface HostedRuntimeLatencyPhaseBreakdownJsonMergeResult {
  changed: boolean;
  value: HostedRuntimeLatencyPhaseBreakdownJson;
}

const HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_PHASE_KEY_SET = new Set<string>(
  HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_PHASE_KEYS,
);

const HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_LEAF_KEY_SETS: Record<
  HostedRuntimeLatencyPhaseBreakdownPhase,
  ReadonlySet<string>
> = {
  orchestration: new Set(HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_LEAF_KEYS.orchestration),
  dispatch: new Set(HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_LEAF_KEYS.dispatch),
  restore: new Set(HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_LEAF_KEYS.restore),
  boot: new Set(HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_LEAF_KEYS.boot),
  wake: new Set(HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_LEAF_KEYS.wake),
  import: new Set(HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_LEAF_KEYS.import),
  preProvider: new Set(HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_LEAF_KEYS.preProvider),
  assistant: new Set(HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_LEAF_KEYS.assistant),
  provider: new Set(HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_LEAF_KEYS.provider),
};

export function sanitizeHostedRuntimeOrchestrationLatencyDiagnostics(
  value: unknown,
): HostedRuntimeOrchestrationLatencyDiagnostics | null {
  if (!isHostedRuntimeLatencyPhaseBreakdownRecord(value)) {
    return null;
  }

  const diagnostics: Record<string, HostedRuntimeLatencyPhaseBreakdownJsonLeaf> = {};
  for (const [leafKey, leaf] of Object.entries(value)) {
    if (
      HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_LEAF_KEY_SETS.orchestration.has(leafKey)
      && isHostedRuntimeLatencyPhaseBreakdownLeafSafe("orchestration", leafKey, leaf)
    ) {
      diagnostics[leafKey] = leaf;
    }
  }
  sanitizeHostedRuntimeDirectEnsureOutcome(diagnostics);

  return Object.keys(diagnostics).length > 0
    ? diagnostics as HostedRuntimeOrchestrationLatencyDiagnostics
    : null;
}

// Diagnostic JSON can be merged repeatedly as late runtime phases arrive.
// Existing leaves win so retries cannot clobber earlier timestamps, while stale
// stored leaves are dropped before the next write. Accepted progress is the one
// repeated milestone: retain its earliest timestamp when callbacks arrive out
// of order.
export function mergeHostedRuntimeLatencyPhaseBreakdownJson(input: {
  existing: unknown;
  incoming: HostedRuntimeLatencyPhaseBreakdown;
  phases: readonly HostedRuntimeLatencyPhaseBreakdownPhase[];
}): HostedRuntimeLatencyPhaseBreakdownJsonMergeResult {
  if (!isHostedRuntimeLatencyPhaseBreakdownRecord(input.incoming)) {
    throw new TypeError("Hosted runtime latency phaseBreakdown must be an object.");
  }
  assertHostedRuntimeLatencyPhaseBreakdownLeavesSafe(input.incoming);

  const sanitizedExisting = sanitizeHostedRuntimeLatencyPhaseBreakdownJson(input.existing);
  const merged: HostedRuntimeLatencyPhaseBreakdownJson = { ...sanitizedExisting.value };
  let changed = sanitizedExisting.changed;

  const schemaVersion =
    typeof sanitizedExisting.value.schemaVersion === "number"
      ? sanitizedExisting.value.schemaVersion
      : input.incoming.schemaVersion;
  if (merged.schemaVersion !== schemaVersion) {
    merged.schemaVersion = schemaVersion;
    changed = true;
  }

  for (const phase of input.phases) {
    const incomingPhase = input.incoming[phase];
    if (!incomingPhase || Object.keys(incomingPhase).length === 0) {
      continue;
    }

    const existingPhase = isHostedRuntimeLatencyPhaseBreakdownRecord(merged[phase])
      ? merged[phase]
      : {};
    const mergedPhase: Record<string, HostedRuntimeLatencyPhaseBreakdownJsonLeaf> = {
      ...existingPhase,
    };
    let phaseChanged = false;

    for (const [leafKey, leaf] of Object.entries(incomingPhase)) {
      if (
        phase === "assistant"
        && leafKey === "progressUpdateAcceptedAtEpochMs"
        && typeof leaf === "number"
        && typeof mergedPhase[leafKey] === "number"
      ) {
        if (leaf < mergedPhase[leafKey]) {
          mergedPhase[leafKey] = leaf;
          phaseChanged = true;
        }
        continue;
      }
      if (mergedPhase[leafKey] !== undefined) {
        continue;
      }
      if (!isHostedRuntimeLatencyPhaseBreakdownLeafSafe(phase, leafKey, leaf)) {
        throw new TypeError(
          `Hosted runtime latency phaseBreakdown ${phase}.${leafKey} must match the latency schema type.`,
        );
      }
      mergedPhase[leafKey] = leaf;
      phaseChanged = true;
    }

    if (phaseChanged) {
      merged[phase] = mergedPhase;
      changed = true;
    }
  }

  assertHostedRuntimeLatencyPhaseBreakdownLeavesSafe(merged);
  return { changed, value: merged };
}

function sanitizeHostedRuntimeLatencyPhaseBreakdownJson(value: unknown): {
  changed: boolean;
  value: HostedRuntimeLatencyPhaseBreakdownJson;
} {
  if (!isHostedRuntimeLatencyPhaseBreakdownRecord(value)) {
    return {
      changed: value !== null && value !== undefined,
      value: {},
    };
  }

  let changed = false;
  const sanitized: HostedRuntimeLatencyPhaseBreakdownJson = {};
  if (value.schemaVersion !== undefined) {
    if (isSafeHostedRuntimeLatencyPhaseBreakdownNumber(value.schemaVersion)) {
      sanitized.schemaVersion = value.schemaVersion;
    } else {
      changed = true;
    }
  }

  for (const [key, entry] of Object.entries(value)) {
    if (key === "schemaVersion") {
      continue;
    }
    if (
      !HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_PHASE_KEY_SET.has(key)
      || !isHostedRuntimeLatencyPhaseBreakdownRecord(entry)
    ) {
      changed = true;
      continue;
    }

    const phase = key as HostedRuntimeLatencyPhaseBreakdownPhase;
    const allowedLeafKeys = HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_LEAF_KEY_SETS[phase];
    const sanitizedPhase: Record<string, HostedRuntimeLatencyPhaseBreakdownJsonLeaf> = {};
    for (const [leafKey, leaf] of Object.entries(entry)) {
      if (
        allowedLeafKeys.has(leafKey)
        && isHostedRuntimeLatencyPhaseBreakdownLeafSafe(phase, leafKey, leaf)
      ) {
        sanitizedPhase[leafKey] = leaf;
      } else {
        changed = true;
      }
    }
    if (phase === "orchestration") {
      changed = sanitizeHostedRuntimeDirectEnsureOutcome(sanitizedPhase) || changed;
    }
    if (Object.keys(sanitizedPhase).length > 0) {
      sanitized[phase] = sanitizedPhase;
    } else if (Object.keys(entry).length > 0) {
      changed = true;
    }
  }

  return { changed, value: sanitized };
}

function assertHostedRuntimeLatencyPhaseBreakdownLeavesSafe(
  value: Record<string, unknown>,
): void {
  for (const [key, entry] of Object.entries(value)) {
    if (key === "schemaVersion") {
      if (!isSafeHostedRuntimeLatencyPhaseBreakdownNumber(entry)) {
        throw new TypeError("Hosted runtime latency phaseBreakdown schemaVersion must be a non-negative safe integer.");
      }
      continue;
    }
    if (!isHostedRuntimeLatencyPhaseBreakdownRecord(entry)) {
      throw new TypeError(`Hosted runtime latency phaseBreakdown ${key} must be an object.`);
    }
    if (!HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_PHASE_KEY_SET.has(key)) {
      throw new TypeError(`Hosted runtime latency phaseBreakdown ${key} is not allowed.`);
    }

    const phase = key as HostedRuntimeLatencyPhaseBreakdownPhase;
    const allowedLeafKeys = HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_LEAF_KEY_SETS[phase];
    for (const [leafKey, leaf] of Object.entries(entry)) {
      if (!allowedLeafKeys.has(leafKey)) {
        throw new TypeError(
          `Hosted runtime latency phaseBreakdown ${key}.${leafKey} is not allowed.`,
        );
      }
      if (!isHostedRuntimeLatencyPhaseBreakdownLeafSafe(phase, leafKey, leaf)) {
        throw new TypeError(
          `Hosted runtime latency phaseBreakdown ${key}.${leafKey} must match the latency schema type.`,
        );
      }
    }
    if (
      key === "orchestration"
      && !isHostedRuntimeDirectEnsureOutcomeConsistent(entry)
    ) {
      throw new TypeError(
        "Hosted runtime latency phaseBreakdown orchestration direct ensure outcome is inconsistent.",
      );
    }
  }
}

function sanitizeHostedRuntimeDirectEnsureOutcome(
  orchestration: Record<string, HostedRuntimeLatencyPhaseBreakdownJsonLeaf>,
): boolean {
  if (isHostedRuntimeDirectEnsureOutcomeConsistent(orchestration)) {
    return false;
  }
  delete orchestration.directEnsureResultKind;
  delete orchestration.directEnsureAction;
  delete orchestration.directEnsureRuntimeAttemptId;
  return true;
}

function isHostedRuntimeDirectEnsureOutcomeConsistent(
  orchestration: Record<string, unknown>,
): boolean {
  const resultKind = orchestration.directEnsureResultKind;
  const action = orchestration.directEnsureAction;
  const runtimeAttemptId = orchestration.directEnsureRuntimeAttemptId;
  if (resultKind === undefined) {
    return action === undefined && runtimeAttemptId === undefined;
  }
  if (resultKind === "runtime_processing_accepted") {
    return action !== undefined && runtimeAttemptId !== undefined;
  }
  return action === undefined && runtimeAttemptId === undefined;
}

function isHostedRuntimeLatencyPhaseBreakdownRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHostedRuntimeLatencyPhaseBreakdownLeafSafe(
  phase: HostedRuntimeLatencyPhaseBreakdownPhase,
  leafKey: string,
  value: unknown,
): value is HostedRuntimeLatencyPhaseBreakdownJsonLeaf {
  const rule = HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_LEAF_RULES[phase][leafKey];
  switch (rule?.kind) {
    case "boolean":
      return typeof value === "boolean";
    case "enum_string":
      return typeof value === "string" && rule.values.includes(value);
    case "lease_generation":
      return typeof value === "string"
        && value.length <= 20
        && /^(?:0|[1-9]\d*)$/u.test(value);
    case "orchestration_attempt_id":
      return isHostedRuntimeDirectEnsureOrchestrationAttemptId(value);
    case "opaque_identifier":
      return isHostedRuntimeLatencyOpaqueIdentifier(value);
    case "safe_integer":
      return isSafeHostedRuntimeLatencyPhaseBreakdownNumber(value);
    default:
      return false;
  }
}

export function isHostedRuntimeDirectEnsureOrchestrationAttemptId(
  value: unknown,
): value is string {
  return typeof value === "string"
    && /^web-ingress-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
}

function isHostedRuntimeLatencyOpaqueIdentifier(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 192
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value);
}

function isSafeHostedRuntimeLatencyPhaseBreakdownNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export interface HostedRuntimeLatencyTraceStagedMilestones {
  runnerJobAcceptedAt?: string | null;
  runtimePhaseStartedAt?: string | null;
  workspaceRestoreDoneAt?: string | null;
  phaseBreakdown?: HostedRuntimeLatencyPhaseBreakdown | null;
}

export interface HostedRuntimeLatencyTraceAssistantInputStagedEvent
  extends HostedRuntimeLatencyTraceStagedMilestones {
  assistantInputId: string;
  at: string;
  mailboxItemId: string;
  runtimeAttemptId?: string | null;
  source: HostedIngressLatencySource;
  type: "assistant_input_staged";
}

export interface HostedRuntimeLatencyTraceProviderStartedEvent {
  // This legacy wire name marks the local Codex `turn/start` request write.
  // It does not prove upstream generation or first-token delivery has begun.
  assistantInputIds: string[];
  at: string;
  phaseBreakdown?: HostedRuntimeLatencyPhaseBreakdown | null;
  providerRequestOrdinal: number;
  runtimeAttemptId?: string | null;
  source: HostedIngressLatencySource;
  type: "provider_started";
}

export interface HostedRuntimeLatencyTraceAssistantMilestoneEvent {
  assistantInputIds: string[];
  at: string;
  checkpointPublicationExpectedBy?: string | null;
  milestone: HostedRuntimeAssistantMilestone;
  runtimeAttemptId?: string | null;
  source: HostedIngressLatencySource;
  type: "assistant_milestone";
}

export interface HostedRuntimeLatencyTraceMilestoneEvent {
  at: string;
  milestone: HostedRuntimeLatencyTraceMilestone;
  runtimeAttemptId?: string | null;
  source: HostedIngressLatencySource;
  type: "runtime_milestone";
}

export type HostedRuntimeLatencyTraceEvent =
  | HostedRuntimeLatencyTraceAssistantInputStagedEvent
  | HostedRuntimeLatencyTraceAssistantMilestoneEvent
  | HostedRuntimeLatencyTraceProviderStartedEvent
  | HostedRuntimeLatencyTraceMilestoneEvent;

export interface HostedRuntimeLatencyTraceRequest {
  event: HostedRuntimeLatencyTraceEvent;
}

export interface HostedRuntimeLatencyTraceResponse {
  matchedCount: number;
  recorded: boolean;
  unmatchedCount: number;
}

export interface HostedWorkspaceState {
  browserVaultReplicaRef?: HostedBrowserVaultReplicaCursorRef;
  checkpointedAt?: string | null;
  createdAt: string;
  inboxMediaRetentionWakeAt?: string | null;
  nextWakeAt?: string | null;
  nextWakeReason?: string | null;
  redactedStatus?: HostedRuntimeRedactedJson | null;
  snapshotRef: HostedExecutionSnapshotRefState;
  updatedAt: string;
  userId: string;
  version: string;
}

export interface HostedWorkspaceReadResponse {
  fetchedAt: string;
  hostedAssistantCustomInferenceOverride?: HostedAssistantCustomInferenceOverride;
  hostedAssistantModelOverride?: HostedAssistantModelOverride;
  hostedAssistantProviderOverride?: HostedAssistantProviderOverride;
  hostedAssistantReasoningEffortOverride?: HostedAssistantReasoningEffortOverride;
  platformAiUsageAllowed?: boolean;
  workspace: HostedWorkspaceState | null;
}

export const HOSTED_WORKSPACE_CHECKPOINT_REASONS = [
  "import",
  "active_turn_input",
  "active_turn_acceptance",
  "outbox_sending",
  "outbox_receipt",
  "activation_bootstrap",
  "canonical_runtime_commit",
  "assistant_runtime_commit",
  "provider_cleanup",
  "system_mailbox_receipt",
  "idle_shutdown",
] as const;

export type HostedWorkspaceCheckpointReason =
  (typeof HOSTED_WORKSPACE_CHECKPOINT_REASONS)[number];

export const HOSTED_WORKSPACE_CHECKPOINT_CONFLICT_REASONS = [
  "foreground_pending",
  "workspace_version",
] as const;

export type HostedWorkspaceCheckpointConflictReason =
  (typeof HOSTED_WORKSPACE_CHECKPOINT_CONFLICT_REASONS)[number];

export const HOSTED_WORKSPACE_CHECKPOINT_HANDLED_CONVERSATION_ITEM_MAX_IDS = 256;

export const HOSTED_IDLE_CHECKPOINT_TRIGGERS = [
  "idle_window",
  "runtime_wake",
  "shutdown_signal",
] as const;

export type HostedIdleCheckpointTrigger =
  (typeof HOSTED_IDLE_CHECKPOINT_TRIGGERS)[number];

export interface HostedWorkspaceCheckpointRequest {
  attemptId: string;
  browserVaultReplicaRef?: HostedBrowserVaultReplicaCursorRef;
  expectedWorkspaceVersion: string;
  handledConversationMailboxItemIds?: string[];
  idleCheckpointTrigger?: HostedIdleCheckpointTrigger;
  inboxMediaRetentionWakeAt?: string | null;
  leaseGeneration: string;
  nextWakeAt?: string | null;
  nextWakeReason?: string | null;
  reason: HostedWorkspaceCheckpointReason;
  redactedStatus?: HostedRuntimeRedactedJson | null;
  runtimeWakePendingAtCheckpoint?: boolean;
  snapshotRef: HostedExecutionSnapshotRefState;
}

export interface HostedWorkspaceCheckpointResponse {
  checkpointed: boolean;
  checkpointConflictReason?: HostedWorkspaceCheckpointConflictReason | null;
  conversationInputAhead?: boolean;
  replacedSnapshotRef?: HostedExecutionSnapshotRefState;
  workspace: HostedWorkspaceState;
}

export interface HostedBrowserVaultReplicaPublishRequest {
  replicaRef: HostedBrowserVaultReplicaRef;
}

export interface HostedBrowserVaultReplicaPublishResponse {
  published: boolean;
  workspace: HostedWorkspaceState | null;
}

export const HOSTED_RUNTIME_LOG_LEVELS = [
  "debug",
  "info",
  "warn",
  "error",
] as const;

export type HostedRuntimeLogLevel = (typeof HOSTED_RUNTIME_LOG_LEVELS)[number];

export const HOSTED_RUNTIME_LOG_COMPONENTS = [
  "assistant",
  "device-sync",
  "mailbox",
  "outbox",
  "runner",
  "runtime",
  "workspace",
] as const;

export type HostedRuntimeLogComponent =
  (typeof HOSTED_RUNTIME_LOG_COMPONENTS)[number];

export const HOSTED_RUNTIME_LOG_PHASES = [
  "active_turn_input",
  "checkpoint",
  "error",
  "fetch",
  "idle",
  "import",
  "outbox",
  "invoke",
  "restore",
] as const;

export type HostedRuntimeLogPhase = (typeof HOSTED_RUNTIME_LOG_PHASES)[number];

export const HOSTED_RUNTIME_LOG_EVENT_CODES = [
  "checkpoint.cas_conflict",
  "checkpoint.committed",
  "checkpoint.codex_continuity_missing_after_full_fallback",
  "checkpoint.hot_state_fallback",
  "checkpoint.idle_shutdown_snapshot_skipped",
  "checkpoint.optional_sidecar_degraded",
  "checkpoint.runtime_residue_deferred",
  "checkpoint.bundle_write_finished",
  "checkpoint.bundle_write_started",
  "checkpoint.snapshot_failed",
  "checkpoint.snapshot_finished",
  "checkpoint.snapshot_plan",
  "checkpoint.snapshot_preempted",
  "checkpoint.snapshot_size_progress",
  "checkpoint.snapshot_started",
  "workspace.codex_home_snapshot_failed",
  "assistant.device_connect",
  "assistant.device_activity_automation_failed",
  "assistant.codex_auth_failed",
  "assistant.automation_detail",
  "assistant.computer_tool_failed",
  "assistant.onboarding_followup_reconciled",
  "assistant.pass_finished",
  "device-sync.dense_raw_retention",
  "device-sync.dirty_ack_persistence_failed",
  "device-sync.fitbit_migration_cutover_failed",
  "device-sync.import_completed",
  "device-sync.job_failed",
  "device-sync.legacy_platform_env_present",
  "device-sync.maintenance_failed",
  "device-sync.module_load_failed",
  "device-sync.source_stalled",
  "device-sync.wake_projection_failed",
  "mailbox.appended",
  "mailbox.dedupe_conflict",
  "mailbox.imported",
  "mailbox.linq_attachment_download_finished",
  "mailbox.parser_drain_failed",
  "mailbox.parser_jobs_failed",
  "mailbox.post_checkpoint_effects_finished",
  "mailbox.system_processed",
  "mailbox.telegram_attachment_download_finished",
  "mailbox.quarantined",
  "mailbox.retryable_payload_missing",
  "outbox.ambiguous",
  "outbox.delivery_finished",
  "outbox.linq_app_card_fallback_error",
  "outbox.receipt_checkpointed",
  "runner.accepted_attempt_failed",
  "runner.error",
  "runner.idle",
  "runner.lease_superseded",
  "runner.provider_egress_diagnostic",
  "runner.started",
  "workspace.codex_home_snapshot",
] as const;

export type HostedRuntimeLogEventCode =
  (typeof HOSTED_RUNTIME_LOG_EVENT_CODES)[number];

export const HOSTED_RUNTIME_LOG_REQUEST_MAX_ENTRIES = 50;

export const HOSTED_CANONICAL_WRITE_RECEIPT_LOG_SHA_STATUS_KEY =
  "hostedCanonicalWriteReceiptLogSha256";
export const HOSTED_CANONICAL_WRITE_RECEIPT_LOG_BYTE_SIZE_STATUS_KEY =
  "hostedCanonicalWriteReceiptLogByteSize";
export const HOSTED_CANONICAL_WRITE_RECEIPT_RECOVERY_STATUS_KEY =
  "hostedCanonicalWriteReceiptRecoveryStatus";
export const HOSTED_CANONICAL_WRITE_RECEIPT_RECOVERY_PRIOR_WAKE_AT_STATUS_KEY =
  "hostedCanonicalWriteReceiptRecoveryPriorNextWakeAt";
export const HOSTED_CANONICAL_WRITE_RECEIPT_RECOVERY_PRIOR_WAKE_REASON_STATUS_KEY =
  "hostedCanonicalWriteReceiptRecoveryPriorNextWakeReason";
export const HOSTED_CANONICAL_WRITE_RECEIPT_RECOVERY_REDACTED_STATUS_KEYS = [
  HOSTED_CANONICAL_WRITE_RECEIPT_RECOVERY_STATUS_KEY,
  HOSTED_CANONICAL_WRITE_RECEIPT_RECOVERY_PRIOR_WAKE_AT_STATUS_KEY,
  HOSTED_CANONICAL_WRITE_RECEIPT_RECOVERY_PRIOR_WAKE_REASON_STATUS_KEY,
] as const;
export const HOSTED_CANONICAL_WRITE_RECEIPT_REDACTED_STATUS_KEYS = [
  HOSTED_CANONICAL_WRITE_RECEIPT_LOG_SHA_STATUS_KEY,
  HOSTED_CANONICAL_WRITE_RECEIPT_LOG_BYTE_SIZE_STATUS_KEY,
  ...HOSTED_CANONICAL_WRITE_RECEIPT_RECOVERY_REDACTED_STATUS_KEYS,
] as const;

export type HostedRuntimeRedactedScalar = boolean | null | number | string;
export type HostedRuntimeRedactedObject = Record<string, HostedRuntimeRedactedScalar>;
export type HostedRuntimeRedactedValue =
  | HostedRuntimeRedactedScalar
  | HostedRuntimeRedactedScalar[]
  | HostedRuntimeRedactedObject[];
export type HostedRuntimeRedactedJson = Record<string, HostedRuntimeRedactedValue>;

export interface HostedRuntimeLogEntry {
  at: string;
  attemptId?: string | null;
  checkpointVersion?: string | null;
  component: HostedRuntimeLogComponent;
  errorCode?: string | null;
  eventCode: HostedRuntimeLogEventCode;
  leaseGeneration?: string | null;
  level: HostedRuntimeLogLevel;
  mailboxLane?: HostedMailboxLane | null;
  mailboxSeqEnd?: string | null;
  mailboxSeqStart?: string | null;
  outboxIntentRef?: string | null;
  phase: HostedRuntimeLogPhase;
  redactedJson?: HostedRuntimeRedactedJson | null;
  workspaceVersion?: string | null;
}

export interface HostedRuntimeLogRequest {
  entries: HostedRuntimeLogEntry[];
}

export interface HostedRuntimeLogResponse {
  loggedCount: number;
}

export interface HostedMailboxLaneLag {
  importedSeq: string;
  lag: string;
  lane: HostedMailboxLane;
  maxSeq: string;
  maxUpdatedAt?: string | null;
}

export interface HostedRunnerNudgeResult {
  accepted: boolean;
  alarmScheduled: boolean;
  immediateDriveStarted?: boolean;
  inFlight: boolean;
  kind: "caught-up" | "processing-ensured" | "retry-scheduled";
  nextAlarmAt?: string | null;
}

export interface HostedRunnerStatusResponse {
  heartbeatAt?: string | null;
  inFlight: boolean;
  lastErrorAt?: string | null;
  lastErrorCode?: string | null;
  lastInvocationAt?: string | null;
  mailboxLag: HostedMailboxLaneLag[];
  nextAlarmAt?: string | null;
  recentLogs?: HostedRuntimeLogEntry[];
  userId: string;
  workspace: HostedWorkspaceState | null;
}

export interface HostedRuntimeWebStatusResponse {
  mailboxLag: HostedMailboxLaneLag[];
  recentLogs?: HostedRuntimeLogEntry[];
  userId: string;
  workspace: HostedWorkspaceState | null;
}

export const HOSTED_HEALTH_DATA_CONSENT_STATES = [
  "granted",
  "revoked",
  "missing",
] as const;

export type HostedHealthDataConsentState =
  (typeof HOSTED_HEALTH_DATA_CONSENT_STATES)[number];

export interface HostedRuntimeHealthDataAdmissionResponse {
  consentState: HostedHealthDataConsentState;
  processingAllowed: boolean;
  userId: string;
}

export const HOSTED_WORKSPACE_INVOCATION_STATUSES = [
  "idle",
  "budget_exhausted",
  "scheduled",
  "failed",
] as const;

export type HostedWorkspaceInvocationStatus = (typeof HOSTED_WORKSPACE_INVOCATION_STATUSES)[number];

export interface HostedWorkspaceInvocationBudget {
  maxMailboxItems?: number | null;
  maxRuntimeMs?: number | null;
}

export const HOSTED_WORKSPACE_INVOCATION_PROCESSING_MODES = [
  "default",
  "inbox_media_retention",
  "system_mailbox",
] as const;

export type HostedWorkspaceInvocationProcessingMode =
  (typeof HOSTED_WORKSPACE_INVOCATION_PROCESSING_MODES)[number];

export interface HostedWorkspaceInvocationRequest {
  assistantExecutionBlocked?: true;
  attemptId: string;
  budget?: HostedWorkspaceInvocationBudget | null;
  idleCheckpointDelayMs?: number | null;
  leaseGeneration: string;
  processingMode?: HostedWorkspaceInvocationProcessingMode | null;
  providerEgressToken?: string | null;
  userId: string;
  workspace?: HostedWorkspaceState | null;
  workspaceVersion: string;
}

export interface HostedWorkspaceInvocationResult {
  immediateRecheckRequested?: true;
  nextWakeAt?: string | null;
  nextWakeReason?: string | null;
  redactedStatus?: HostedRuntimeRedactedJson | null;
  status: HostedWorkspaceInvocationStatus;
}

export function isHostedRuntimeMailboxContinuation(input: {
  nextWakeAt?: Date | string | null;
  nextWakeReason?: string | null;
  redactedStatus?: unknown;
}): boolean {
  if (readHostedRuntimeRetryableMailboxBlockedCount(input.redactedStatus) > 0n) {
    return true;
  }

  return input.nextWakeAt !== undefined
    && input.nextWakeAt !== null
    && input.nextWakeReason?.trim() === "mailbox";
}

export function isHostedRuntimeFutureMailboxContinuation(
  input: {
    nextWakeAt?: Date | string | null;
    nextWakeReason?: string | null;
    redactedStatus?: unknown;
  },
  nowMs: number = Date.now(),
): boolean {
  const nextWakeAtMs = input.nextWakeAt instanceof Date
    ? input.nextWakeAt.getTime()
    : input.nextWakeAt
      ? Date.parse(input.nextWakeAt)
      : Number.NaN;

  return Number.isFinite(nextWakeAtMs)
    && nextWakeAtMs > nowMs
    && isHostedRuntimeMailboxContinuation(input);
}

function readHostedRuntimeRetryableMailboxBlockedCount(value: unknown): bigint {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return 0n;
  }
  const rawCount = (value as Record<string, unknown>)[
    "hostedMailboxRetryableBlockedCount"
  ];
  if (rawCount === undefined || rawCount === null) {
    return 0n;
  }
  if (typeof rawCount === "bigint") {
    if (rawCount >= 0n) {
      return rawCount;
    }
  }
  if (typeof rawCount === "number") {
    if (Number.isSafeInteger(rawCount) && rawCount >= 0) {
      return BigInt(rawCount);
    }
  }
  if (typeof rawCount === "string" && /^[0-9]+$/u.test(rawCount)) {
    return BigInt(rawCount);
  }
  throw new TypeError(
    "Hosted runtime retryable mailbox blocked count must be a non-negative integer.",
  );
}

export function isHostedMailboxLane(value: string): value is HostedMailboxLane {
  return HOSTED_MAILBOX_LANES.includes(value as HostedMailboxLane);
}

export function isHostedMailboxKind(value: string): value is HostedMailboxKind {
  return HOSTED_MAILBOX_KINDS.includes(value as HostedMailboxKind);
}

export function isHostedRetiredMailboxKind(
  value: string,
): value is HostedRetiredMailboxKind {
  return HOSTED_RETIRED_MAILBOX_KINDS.some((kind) => kind === value);
}
