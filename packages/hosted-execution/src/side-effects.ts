import {
  gatewayDeliveryTargetKindValues,
  gatewayReplyRouteKindValues,
  type GatewayDeliveryTargetKind,
  type GatewayReplyRouteKind,
} from "@murphai/gateway-core";

export const HOSTED_ASSISTANT_DELIVERY_KIND = "assistant.delivery" as const;

export const hostedAssistantDeliveryTargetKindValues =
  gatewayDeliveryTargetKindValues;
export const HOSTED_ASSISTANT_DELIVERY_KINDS = [
  HOSTED_ASSISTANT_DELIVERY_KIND,
] as const;

export const hostedAssistantDeliveryRecordStateValues = [
  "pending",
  "sending",
  "sent",
  "failed",
  "failed_ambiguous",
] as const;

export const hostedAssistantDeliveryPhaseValues = [
  "foreground_current_turn",
  "background_retry",
] as const;

export const HOSTED_ASSISTANT_DELIVERY_RECORD_STATES =
  hostedAssistantDeliveryRecordStateValues;
export const HOSTED_ASSISTANT_DELIVERY_PHASES =
  hostedAssistantDeliveryPhaseValues;

export type HostedAssistantDeliveryKind = typeof HOSTED_ASSISTANT_DELIVERY_KIND;
export type HostedAssistantDeliveryTargetKind = GatewayDeliveryTargetKind;
export type HostedAssistantBindingDeliveryKind = GatewayReplyRouteKind;
export type HostedAssistantDeliveryPhase =
  (typeof hostedAssistantDeliveryPhaseValues)[number];

export type HostedAssistantDeliveryRecordState =
  (typeof hostedAssistantDeliveryRecordStateValues)[number];

export const hostedAssistantBindingDeliveryKindValues = gatewayReplyRouteKindValues;

export interface HostedAssistantDeliveryImageMedia {
  alt: string | null;
  kind: "image";
  source: string | null;
  url: string;
}

export interface HostedAssistantDeliveryVoiceMemoMedia {
  filename: string;
  kind: "voice_memo";
  mimeType: "audio/aac" | "audio/mp4" | "audio/mpeg" | "audio/wav" | "audio/x-m4a";
  modelId: string;
  sizeBytes: number;
  source: "elevenlabs";
  transcript: string;
  transportRefs: {
    linq?: {
      attachmentId: string;
      downloadUrl: string | null;
    };
  };
  url: string | null;
  voiceId: string;
}

export type HostedAssistantDeliveryMedia =
  | HostedAssistantDeliveryImageMedia
  | HostedAssistantDeliveryVoiceMemoMedia;

export interface HostedAssistantDeliveryPayload {
  actorId: string | null;
  bindingDeliveryKind: HostedAssistantBindingDeliveryKind | null;
  bindingDeliveryTarget: string | null;
  channel: string | null;
  deliverySourceKey: string | null;
  explicitTarget: string | null;
  idempotencyKey: string;
  identityId: string | null;
  media: readonly HostedAssistantDeliveryMedia[];
  message: string;
  subject: string | null;
  replyToMessageId: string | null;
  sessionId: string;
  threadId: string | null;
  threadIsDirect: boolean | null;
  transportIdempotent: boolean;
  turnId: string;
}

export interface HostedAssistantDeliverySideEffect {
  deliveryPhase: HostedAssistantDeliveryPhase;
  effectId: string;
  fingerprint: string;
  kind: HostedAssistantDeliveryKind;
  payload: HostedAssistantDeliveryPayload;
}

export type HostedAssistantDeliveryEffect = HostedAssistantDeliverySideEffect;

export interface HostedAssistantDeliveryReceipt {
  channel: string;
  idempotencyKey: string;
  messageLength: number;
  providerMessageId: string | null;
  providerThreadId: string | null;
  sentAt: string;
  target: string;
  targetKind: HostedAssistantDeliveryTargetKind;
}

export type HostedAssistantDelivery = HostedAssistantDeliveryReceipt;

export interface HostedAssistantDeliveryAttempt {
  channel: string | null;
  idempotencyKey: string | null;
  messageLength: number | null;
  providerMessageId: string | null;
  providerThreadId: string | null;
  startedAt: string;
  target: string | null;
  targetKind: HostedAssistantDeliveryTargetKind | null;
}

export interface HostedAssistantDeliveryFailure {
  code: string | null;
  failedAt: string;
  message: string;
}

interface HostedAssistantDeliveryRecordBase {
  effectId: string;
  fingerprint: string;
  kind: HostedAssistantDeliveryKind;
  recordedAt: string;
}

export interface HostedAssistantDeliveryPendingRecord
  extends HostedAssistantDeliveryRecordBase {
  state: "pending";
}

export interface HostedAssistantDeliverySendingRecord
  extends HostedAssistantDeliveryRecordBase {
  attempt: HostedAssistantDeliveryAttempt;
  state: "sending";
}

export interface HostedAssistantDeliverySentRecord
  extends HostedAssistantDeliveryRecordBase {
  delivery: HostedAssistantDeliveryReceipt;
  state: "sent";
}

export interface HostedAssistantDeliveryFailedRecord
  extends HostedAssistantDeliveryRecordBase {
  attempt: HostedAssistantDeliveryAttempt;
  failure: HostedAssistantDeliveryFailure;
  state: "failed";
}

export interface HostedAssistantDeliveryAmbiguousFailureRecord
  extends HostedAssistantDeliveryRecordBase {
  attempt: HostedAssistantDeliveryAttempt;
  failure: HostedAssistantDeliveryFailure;
  state: "failed_ambiguous";
}

export type HostedAssistantDeliverySentSideEffectRecord =
  HostedAssistantDeliverySentRecord;

export type HostedAssistantDeliveryRecord =
  | HostedAssistantDeliveryPendingRecord
  | HostedAssistantDeliverySendingRecord
  | HostedAssistantDeliverySentRecord
  | HostedAssistantDeliveryFailedRecord
  | HostedAssistantDeliveryAmbiguousFailureRecord;

function buildHostedAssistantDeliveryIdentity(input: {
  dedupeKey: string;
  effectId: string;
}): Pick<HostedAssistantDeliverySideEffect, "effectId" | "fingerprint" | "kind"> {
  return {
    effectId: input.effectId,
    fingerprint: input.dedupeKey,
    kind: HOSTED_ASSISTANT_DELIVERY_KIND,
  };
}

export function buildHostedAssistantDeliverySideEffect(input: {
  dedupeKey: string;
  deliveryPhase?: HostedAssistantDeliveryPhase;
  effectId: string;
  payload: HostedAssistantDeliveryPayload;
}): HostedAssistantDeliverySideEffect {
  return {
    ...buildHostedAssistantDeliveryIdentity(input),
    deliveryPhase: parseHostedAssistantDeliveryPhase(
      input.deliveryPhase ?? "background_retry",
      "Hosted assistant delivery side effect deliveryPhase",
    ),
    payload: parseHostedAssistantDeliveryPayload(
      input.payload,
      "Hosted assistant delivery side effect payload",
    ),
  };
}

export const buildHostedAssistantDeliveryEffect =
  buildHostedAssistantDeliverySideEffect;

export function buildHostedAssistantDeliveryPendingRecord(input: {
  dedupeKey: string;
  effectId: string;
  recordedAt: string;
}): HostedAssistantDeliveryPendingRecord {
  return {
    ...buildHostedAssistantDeliveryIdentity(input),
    recordedAt: requireString(input.recordedAt, "Hosted assistant pending side effect recordedAt"),
    state: "pending",
  };
}

export function buildHostedAssistantDeliverySendingRecord(input: {
  attempt: HostedAssistantDeliveryAttempt;
  dedupeKey: string;
  effectId: string;
}): HostedAssistantDeliverySendingRecord {
  const attempt = parseHostedAssistantDeliveryAttempt(
    input.attempt,
    "Hosted assistant sending side effect attempt",
  );
  return {
    ...buildHostedAssistantDeliveryIdentity(input),
    attempt,
    recordedAt: attempt.startedAt,
    state: "sending",
  };
}

export function buildHostedAssistantDeliverySentRecord(input: {
  dedupeKey: string;
  delivery: HostedAssistantDeliveryReceipt;
  effectId: string;
}): HostedAssistantDeliverySentRecord {
  return {
    ...buildHostedAssistantDeliveryIdentity(input),
    delivery: parseHostedAssistantDeliveryReceipt(
      input.delivery,
      "Hosted assistant sent side effect delivery",
    ),
    recordedAt: input.delivery.sentAt,
    state: "sent",
  };
}

export function buildHostedAssistantDeliveryFailedRecord(input: {
  attempt: HostedAssistantDeliveryAttempt;
  dedupeKey: string;
  effectId: string;
  failure: HostedAssistantDeliveryFailure;
  state?: "failed" | "failed_ambiguous";
}):
  | HostedAssistantDeliveryFailedRecord
  | HostedAssistantDeliveryAmbiguousFailureRecord {
  const attempt = parseHostedAssistantDeliveryAttempt(
    input.attempt,
    "Hosted assistant failed side effect attempt",
  );
  const failure = parseHostedAssistantDeliveryFailure(
    input.failure,
    "Hosted assistant failed side effect failure",
  );
  const state = input.state ?? "failed";

  return {
    ...buildHostedAssistantDeliveryIdentity(input),
    attempt,
    failure,
    recordedAt: failure.failedAt,
    state,
  };
}

export function parseHostedAssistantDeliverySideEffect(
  value: unknown,
): HostedAssistantDeliverySideEffect {
  const record = requireObject(value, "Hosted assistant delivery side effect");

  return {
    deliveryPhase: parseHostedAssistantDeliveryPhase(
      record.deliveryPhase ?? "background_retry",
      "Hosted assistant delivery side effect deliveryPhase",
    ),
    effectId: requireHostedAssistantDeliveryEffectId(
      record,
      "Hosted assistant delivery side effect",
    ),
    fingerprint: requireString(
      record.fingerprint,
      "Hosted assistant delivery side effect fingerprint",
    ),
    kind: requireHostedAssistantDeliveryKind(
      record.kind,
      "Hosted assistant delivery side effect kind",
    ),
    payload: parseHostedAssistantDeliveryPayload(
      record.payload,
      "Hosted assistant delivery side effect payload",
    ),
  };
}

export const parseHostedAssistantDeliveryEffect =
  parseHostedAssistantDeliverySideEffect;

export function parseHostedAssistantDeliverySideEffects(
  value: unknown,
): HostedAssistantDeliverySideEffect[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => parseHostedAssistantDeliverySideEffect(entry));
}

export const parseHostedAssistantDeliveryEffects =
  parseHostedAssistantDeliverySideEffects;

export function parseHostedAssistantDeliveryRecord(
  value: unknown,
): HostedAssistantDeliveryRecord {
  const record = requireObject(value, "Hosted assistant delivery record");
  const kind = requireHostedAssistantDeliveryKind(
    record.kind,
    "Hosted assistant delivery record kind",
  );
  const state = requireHostedAssistantDeliveryRecordState(
    record.state,
    "Hosted assistant delivery record state",
  );
  const baseRecord = {
    effectId: requireHostedAssistantDeliveryEffectId(
      record,
      "Hosted assistant delivery record",
    ),
    fingerprint: requireString(
      record.fingerprint,
      "Hosted assistant delivery record fingerprint",
    ),
    kind,
    recordedAt: requireString(
      record.recordedAt,
      "Hosted assistant delivery record recordedAt",
    ),
  };

  switch (state) {
    case "pending":
      return {
        ...baseRecord,
        state,
      };
    case "sending":
      return {
        ...baseRecord,
        attempt: parseHostedAssistantDeliveryAttempt(
          record.attempt,
          "Hosted assistant delivery record attempt",
        ),
        state,
      };
    case "sent":
      return {
        ...baseRecord,
        delivery: parseHostedAssistantDeliveryReceipt(
          record.delivery,
          "Hosted assistant delivery record delivery",
        ),
        state,
      };
    case "failed":
    case "failed_ambiguous":
      return {
        ...baseRecord,
        attempt: parseHostedAssistantDeliveryAttempt(
          record.attempt,
          "Hosted assistant delivery record attempt",
        ),
        failure: parseHostedAssistantDeliveryFailure(
          record.failure,
          "Hosted assistant delivery record failure",
        ),
        state,
      };
  }
}

export function sameHostedAssistantDeliverySideEffectIdentity(
  left: Pick<HostedAssistantDeliveryRecord, "effectId" | "fingerprint" | "kind">,
  right: Pick<HostedAssistantDeliveryRecord, "effectId" | "fingerprint" | "kind">,
): boolean {
  return (
    left.effectId === right.effectId
    && left.fingerprint === right.fingerprint
    && left.kind === right.kind
  );
}

export function sameHostedAssistantDeliveryReceipt(
  left: HostedAssistantDeliveryReceipt,
  right: HostedAssistantDeliveryReceipt,
): boolean {
  return (
    left.channel === right.channel
    && left.idempotencyKey === right.idempotencyKey
    && left.messageLength === right.messageLength
    && left.providerMessageId === right.providerMessageId
    && left.providerThreadId === right.providerThreadId
    && left.sentAt === right.sentAt
    && left.target === right.target
    && left.targetKind === right.targetKind
  );
}

export function sameHostedAssistantDeliveryAttempt(
  left: HostedAssistantDeliveryAttempt,
  right: HostedAssistantDeliveryAttempt,
): boolean {
  return (
    left.channel === right.channel
    && left.idempotencyKey === right.idempotencyKey
    && left.messageLength === right.messageLength
    && left.providerMessageId === right.providerMessageId
    && left.providerThreadId === right.providerThreadId
    && left.startedAt === right.startedAt
    && left.target === right.target
    && left.targetKind === right.targetKind
  );
}

export function sameHostedAssistantDeliveryFailure(
  left: HostedAssistantDeliveryFailure,
  right: HostedAssistantDeliveryFailure,
): boolean {
  return (
    left.code === right.code
    && left.failedAt === right.failedAt
    && left.message === right.message
  );
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
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

function requireStringValue(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string.`);
  }

  return value;
}

function requireHttpsUrl(value: unknown, label: string): string {
  const url = requireString(value, label);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new TypeError(`${label} must be a valid HTTPS URL.`);
  }
  if (parsed.protocol !== "https:") {
    throw new TypeError(`${label} must use HTTPS.`);
  }

  return parsed.toString();
}

function requireHostedAssistantDeliveryEffectId(
  record: Record<string, unknown>,
  label: string,
): string {
  return requireString(record.effectId, `${label} effectId`);
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }

  return value;
}

function requirePositiveIntegerAtMost(
  value: unknown,
  label: string,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > max
  ) {
    throw new TypeError(`${label} must be a positive integer no larger than ${max}.`);
  }

  return value;
}

function requireHostedAssistantDeliveryKind(
  value: unknown,
  label: string,
): HostedAssistantDeliveryKind {
  const kind = requireString(value, label);

  if (isHostedAssistantDeliveryKind(kind)) {
    return kind;
  }

  throw new TypeError(`Unsupported hosted assistant delivery kind: ${kind}`);
}

function requireHostedAssistantDeliveryRecordState(
  value: unknown,
  label: string,
): HostedAssistantDeliveryRecordState {
  const state = requireString(value, label);

  if (isHostedAssistantDeliveryRecordState(state)) {
    return state;
  }

  throw new TypeError(`Unsupported hosted assistant delivery record state: ${state}`);
}

function parseHostedAssistantDeliveryPhase(
  value: unknown,
  label: string,
): HostedAssistantDeliveryPhase {
  const phase = requireString(value, label);

  if ((hostedAssistantDeliveryPhaseValues as readonly string[]).includes(phase)) {
    return phase as HostedAssistantDeliveryPhase;
  }

  throw new TypeError(`Unsupported hosted assistant delivery phase: ${phase}`);
}

export function isHostedAssistantDeliveryKind(
  value: string,
): value is HostedAssistantDeliveryKind {
  return value === HOSTED_ASSISTANT_DELIVERY_KIND;
}

export function isHostedAssistantDeliveryRecordState(
  value: string,
): value is HostedAssistantDeliveryRecordState {
  return (hostedAssistantDeliveryRecordStateValues as readonly string[]).includes(value);
}

function parseHostedAssistantDeliveryPayload(
  value: unknown,
  label: string,
): HostedAssistantDeliveryPayload {
  const record = requireObject(value, label);

  return {
    actorId: requireNullableString(record.actorId ?? null, `${label}.actorId`),
    bindingDeliveryKind: requireNullableHostedAssistantBindingDeliveryKind(
      record.bindingDeliveryKind ?? null,
      `${label}.bindingDeliveryKind`,
    ),
    bindingDeliveryTarget: requireNullableString(
      record.bindingDeliveryTarget ?? null,
      `${label}.bindingDeliveryTarget`,
    ),
    channel: requireNullableString(record.channel ?? null, `${label}.channel`),
    deliverySourceKey: requireNullableString(
      record.deliverySourceKey ?? null,
      `${label}.deliverySourceKey`,
    ),
    explicitTarget: requireNullableString(
      record.explicitTarget ?? null,
      `${label}.explicitTarget`,
    ),
    idempotencyKey: requireString(record.idempotencyKey, `${label}.idempotencyKey`),
    identityId: requireNullableString(record.identityId ?? null, `${label}.identityId`),
    media: parseHostedAssistantDeliveryMediaList(record.media ?? [], `${label}.media`),
    message: requireStringValue(record.message, `${label}.message`),
    subject: requireNullableString(record.subject ?? null, `${label}.subject`),
    replyToMessageId: requireNullableString(
      record.replyToMessageId ?? null,
      `${label}.replyToMessageId`,
    ),
    sessionId: requireString(record.sessionId, `${label}.sessionId`),
    threadId: requireNullableString(record.threadId ?? null, `${label}.threadId`),
    threadIsDirect: requireNullableBoolean(
      record.threadIsDirect ?? null,
      `${label}.threadIsDirect`,
    ),
    transportIdempotent: requireBoolean(
      record.transportIdempotent,
      `${label}.transportIdempotent`,
    ),
    turnId: requireString(record.turnId, `${label}.turnId`),
  };
}

function parseHostedAssistantDeliveryMediaList(
  value: unknown,
  label: string,
): HostedAssistantDeliveryMedia[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }

  if (value.length > 40) {
    throw new TypeError(`${label} must contain at most 40 entries.`);
  }

  return value.map((entry, index) =>
    parseHostedAssistantDeliveryMedia(entry, `${label}[${index}]`)
  );
}

function parseHostedAssistantDeliveryMedia(
  value: unknown,
  label: string,
): HostedAssistantDeliveryMedia {
  const record = requireObject(value, label);
  const kind = record.kind ?? "image";
  if (kind === "image") {
    return {
      alt: requireNullableString(record.alt ?? null, `${label}.alt`),
      kind,
      source: requireNullableString(record.source ?? null, `${label}.source`),
      url: requireHttpsUrl(record.url, `${label}.url`),
    };
  }
  if (kind === "voice_memo") {
    return parseHostedAssistantDeliveryVoiceMemoMedia(record, label);
  }

  throw new TypeError(`${label}.kind must be image or voice_memo.`);
}

function parseHostedAssistantDeliveryVoiceMemoMedia(
  record: Record<string, unknown>,
  label: string,
): HostedAssistantDeliveryVoiceMemoMedia {
  const transportRefs = requireObject(record.transportRefs ?? {}, `${label}.transportRefs`);
  const linq = transportRefs.linq === undefined
    ? undefined
    : parseHostedAssistantDeliveryVoiceMemoLinqTransportRef(
        transportRefs.linq,
        `${label}.transportRefs.linq`,
      );
  const url = record.url === null || record.url === undefined
    ? null
    : requireHttpsUrl(record.url, `${label}.url`);
  if (!url && !linq?.attachmentId) {
    throw new TypeError(`${label} requires a public URL or Linq attachment id.`);
  }

  return {
    filename: requireString(record.filename, `${label}.filename`),
    kind: "voice_memo",
    mimeType: requireHostedAssistantVoiceMemoMimeType(record.mimeType, `${label}.mimeType`),
    modelId: requireString(record.modelId, `${label}.modelId`),
    sizeBytes: requirePositiveIntegerAtMost(record.sizeBytes, `${label}.sizeBytes`, 10 * 1024 * 1024),
    source: requireHostedAssistantVoiceMemoSource(record.source, `${label}.source`),
    transcript: requireString(record.transcript, `${label}.transcript`),
    transportRefs: {
      ...(linq ? { linq } : {}),
    },
    url,
    voiceId: requireString(record.voiceId, `${label}.voiceId`),
  };
}

function parseHostedAssistantDeliveryVoiceMemoLinqTransportRef(
  value: unknown,
  label: string,
): HostedAssistantDeliveryVoiceMemoMedia["transportRefs"]["linq"] {
  const record = requireObject(value, label);
  return {
    attachmentId: requireString(record.attachmentId, `${label}.attachmentId`),
    downloadUrl:
      record.downloadUrl === null || record.downloadUrl === undefined
        ? null
        : requireHttpsUrl(record.downloadUrl, `${label}.downloadUrl`),
  };
}

function requireHostedAssistantVoiceMemoMimeType(
  value: unknown,
  label: string,
): HostedAssistantDeliveryVoiceMemoMedia["mimeType"] {
  const mimeType = requireString(value, label);
  if (
    mimeType === "audio/aac" ||
    mimeType === "audio/mp4" ||
    mimeType === "audio/mpeg" ||
    mimeType === "audio/wav" ||
    mimeType === "audio/x-m4a"
  ) {
    return mimeType;
  }

  throw new TypeError(`${label} must be a supported voice memo MIME type.`);
}

function requireHostedAssistantVoiceMemoSource(
  value: unknown,
  label: string,
): "elevenlabs" {
  const source = requireString(value, label);
  if (source === "elevenlabs") {
    return source;
  }

  throw new TypeError(`${label} must be elevenlabs.`);
}

function parseHostedAssistantDeliveryAttempt(
  value: unknown,
  label: string,
): HostedAssistantDeliveryAttempt {
  const record = requireObject(value, label);

  return {
    channel: requireNullableString(record.channel ?? null, `${label}.channel`),
    idempotencyKey: requireNullableString(
      record.idempotencyKey ?? null,
      `${label}.idempotencyKey`,
    ),
    messageLength: requireNullableNonNegativeInteger(
      record.messageLength ?? null,
      `${label}.messageLength`,
    ),
    providerMessageId: requireNullableString(
      record.providerMessageId ?? null,
      `${label}.providerMessageId`,
    ),
    providerThreadId: requireNullableString(
      record.providerThreadId ?? null,
      `${label}.providerThreadId`,
    ),
    startedAt: requireString(record.startedAt, `${label}.startedAt`),
    target: requireNullableString(record.target ?? null, `${label}.target`),
    targetKind: requireNullableHostedAssistantDeliveryTargetKind(
      record.targetKind ?? null,
      `${label}.targetKind`,
    ),
  };
}

function parseHostedAssistantDeliveryFailure(
  value: unknown,
  label: string,
): HostedAssistantDeliveryFailure {
  const record = requireObject(value, label);

  return {
    code: requireNullableString(record.code ?? null, `${label}.code`),
    failedAt: requireString(record.failedAt, `${label}.failedAt`),
    message: requireString(record.message, `${label}.message`),
  };
}

function parseHostedAssistantDeliveryReceipt(
  value: unknown,
  label: string,
): HostedAssistantDeliveryReceipt {
  const record = requireObject(value, label);

  return {
    channel: requireString(record.channel, `${label}.channel`),
    idempotencyKey: requireString(
      record.idempotencyKey,
      `${label}.idempotencyKey`,
    ),
    messageLength: requireNonNegativeInteger(
      record.messageLength,
      `${label}.messageLength`,
    ),
    providerMessageId: requireNullableString(
      record.providerMessageId ?? null,
      `${label}.providerMessageId`,
    ),
    providerThreadId: requireNullableString(
      record.providerThreadId ?? null,
      `${label}.providerThreadId`,
    ),
    sentAt: requireString(record.sentAt, `${label}.sentAt`),
    target: requireString(record.target, `${label}.target`),
    targetKind: requireHostedAssistantDeliveryTargetKind(
      record.targetKind,
      `${label}.targetKind`,
    ),
  };
}

function requireNullableString(value: unknown, label: string): string | null {
  if (value === null) {
    return null;
  }

  return requireString(value, label);
}

function requireNullableNonNegativeInteger(value: unknown, label: string): number | null {
  if (value === null) {
    return null;
  }

  return requireNonNegativeInteger(value, label);
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean.`);
  }

  return value;
}

function requireNullableBoolean(value: unknown, label: string): boolean | null {
  if (value === null) {
    return null;
  }

  return requireBoolean(value, label);
}

function requireHostedAssistantBindingDeliveryKind(
  value: unknown,
  label: string,
): HostedAssistantBindingDeliveryKind {
  const bindingKind = requireString(value, label);

  if ((hostedAssistantBindingDeliveryKindValues as readonly string[]).includes(bindingKind)) {
    return bindingKind as HostedAssistantBindingDeliveryKind;
  }

  throw new TypeError(
    `Unsupported hosted assistant binding delivery kind: ${bindingKind}`,
  );
}

function requireNullableHostedAssistantBindingDeliveryKind(
  value: unknown,
  label: string,
): HostedAssistantBindingDeliveryKind | null {
  if (value === null) {
    return null;
  }

  return requireHostedAssistantBindingDeliveryKind(value, label);
}

function requireHostedAssistantDeliveryTargetKind(
  value: unknown,
  label: string,
): HostedAssistantDeliveryTargetKind {
  const targetKind = requireString(value, label);

  if ((hostedAssistantDeliveryTargetKindValues as readonly string[]).includes(targetKind)) {
    return targetKind as HostedAssistantDeliveryTargetKind;
  }

  throw new TypeError(
    `Unsupported hosted assistant delivery target kind: ${targetKind}`,
  );
}

function requireNullableHostedAssistantDeliveryTargetKind(
  value: unknown,
  label: string,
): HostedAssistantDeliveryTargetKind | null {
  if (value === null) {
    return null;
  }

  return requireHostedAssistantDeliveryTargetKind(value, label);
}
