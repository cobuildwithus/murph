import {
  assistantResponseCardSchema,
  type AssistantResponseCard,
  type DailyNutritionResponseCard,
  type NutritionCardMetric,
} from "@murphai/contracts";
import {
  gatewayDeliveryTargetKindValues,
  gatewayReplyRouteKindValues,
  type GatewayDeliveryTargetKind,
  type GatewayReplyRouteKind,
} from "@murphai/gateway-core";
import {
  isNormalizedAssistantVaultFileRef,
} from "@murphai/runtime-state/assistant-generated-deliveries";

export const HOSTED_ASSISTANT_DELIVERY_KIND = "assistant.delivery" as const;
// Must stay >= the hosted mailbox run import limit so one grouped auto-reply
// can carry every answered conversation item through the side-effect payload.
const HOSTED_ASSISTANT_DELIVERY_ANSWERED_MAILBOX_ITEM_ID_LIMIT = 100;

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

export interface HostedAssistantDeliveryVaultImageMedia {
  alt: string | null;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  filename: string;
  kind: "vault_image";
  ref: string;
  sha256: string;
  sizeBytes: number;
  source: string | null;
}

export type HostedAssistantDeliveryVoiceMemoGeneration =
  | {
      kind: "elevenlabs_speech";
      modelId: string;
      outputFormat: "mp3_44100_128";
      text: string;
      voiceId: string;
    }
  | {
      durationMs: number;
      forceInstrumental: boolean;
      kind: "elevenlabs_music";
      modelId: "music_v2";
      outputFormat: "mp3_48000_192";
      prompt: string;
    };

export type HostedAssistantDeliveryVoiceMemoTransport =
  | {
      attachmentId: string;
      kind: "linq_attachment";
    }
  | {
      generation: HostedAssistantDeliveryVoiceMemoGeneration;
      kind: "telegram_generation";
    };

export interface HostedAssistantDeliveryVoiceMemoMedia {
  filename: string;
  kind: "voice_memo";
  transcript: string | null;
  transport: HostedAssistantDeliveryVoiceMemoTransport;
}

export interface HostedAssistantDeliveryVaultFileMedia {
  approvalGeneration: string | null;
  approvalId: string | null;
  contentType: string;
  filename: string;
  kind: "vault_file";
  ref: string;
  sha256: string;
  sizeBytes: number;
}

export type HostedAssistantDeliveryMedia =
  | HostedAssistantDeliveryImageMedia
  | HostedAssistantDeliveryVaultImageMedia
  | HostedAssistantDeliveryVoiceMemoMedia
  | HostedAssistantDeliveryVaultFileMedia;

export type HostedAssistantNutritionCardMetric = NutritionCardMetric;
export type HostedAssistantDailyNutritionResponseCard =
  DailyNutritionResponseCard;
export type HostedAssistantResponseCard = AssistantResponseCard;

export type HostedAssistantMessageReaction =
  | "heart"
  | "thumbs_up"
  | "laugh";

export interface HostedAssistantDeliveryPayload {
  actorId: string | null;
  answeredMailboxItemIds: readonly string[];
  bindingDeliveryKind: HostedAssistantBindingDeliveryKind | null;
  bindingDeliveryTarget: string | null;
  channel: string | null;
  card?: HostedAssistantResponseCard | null;
  deliverySourceKey: string | null;
  emailHtml?: string | null;
  explicitTarget: string | null;
  idempotencyKey: string;
  identityId: string | null;
  media: readonly HostedAssistantDeliveryMedia[];
  message: string;
  nativeReplyRequested?: true;
  groupEmailAuthorizationProof?: string | null;
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

export interface HostedAssistantMessageDeliveryReceipt {
  kind?: "message";
  channel: string;
  idempotencyKey: string;
  messageLength: number;
  providerMessageId: string | null;
  providerThreadId: string | null;
  sentAt: string;
  target: string;
  targetKind: HostedAssistantDeliveryTargetKind;
}

export interface HostedAssistantMessageReactionDeliveryReceipt {
  kind: "message-reaction";
  channel: "linq" | "telegram";
  idempotencyKey: string;
  reaction: HostedAssistantMessageReaction;
  sentAt: string;
  target: string;
  targetKind: HostedAssistantDeliveryTargetKind;
  targetMessageId: string;
}

export type HostedAssistantDeliveryReceipt =
  | HostedAssistantMessageDeliveryReceipt
  | HostedAssistantMessageReactionDeliveryReceipt;

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
  if (left.kind === "message-reaction" || right.kind === "message-reaction") {
    return (
      left.kind === "message-reaction"
      && right.kind === "message-reaction"
      && left.channel === right.channel
      && left.idempotencyKey === right.idempotencyKey
      && left.reaction === right.reaction
      && left.sentAt === right.sentAt
      && left.target === right.target
      && left.targetKind === right.targetKind
      && left.targetMessageId === right.targetMessageId
    );
  }

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
  const card = parseHostedAssistantResponseCard(
    record.card ?? null,
    `${label}.card`,
  );
  const media = parseHostedAssistantDeliveryMediaList(
    record.media ?? [],
    `${label}.media`,
  );
  if (card !== null && media.length > 0) {
    throw new TypeError(`${label} cannot combine card and media.`);
  }
  const threadIsDirect = requireNullableBoolean(
    record.threadIsDirect ?? null,
    `${label}.threadIsDirect`,
  );
  const channel = requireNullableString(
    record.channel ?? null,
    `${label}.channel`,
  );
  if (card?.kind === "challenge_standings") {
    if (channel !== "linq" || threadIsDirect !== false) {
      throw new TypeError(
        `${label}.card requires an authenticated Linq group conversation.`,
      );
    }
  } else if (card !== null && threadIsDirect !== true) {
    throw new TypeError(`${label}.card requires a private direct conversation.`);
  }
  if (record.newsletterAuthorizationProof !== undefined) {
    throw new TypeError(
      `${label}.newsletterAuthorizationProof belongs to a retired runner wire contract.`,
    );
  }
  return {
    actorId: requireNullableString(record.actorId ?? null, `${label}.actorId`),
    answeredMailboxItemIds: parseHostedAssistantDeliveryAnsweredMailboxItemIds(
      record.answeredMailboxItemIds ?? [],
      `${label}.answeredMailboxItemIds`,
    ),
    bindingDeliveryKind: requireNullableHostedAssistantBindingDeliveryKind(
      record.bindingDeliveryKind ?? null,
      `${label}.bindingDeliveryKind`,
    ),
    bindingDeliveryTarget: requireNullableString(
      record.bindingDeliveryTarget ?? null,
      `${label}.bindingDeliveryTarget`,
    ),
    channel,
    ...(record.card === undefined ? {} : { card }),
    deliverySourceKey: requireNullableString(
      record.deliverySourceKey ?? null,
      `${label}.deliverySourceKey`,
    ),
    ...(record.emailHtml === undefined
      ? {}
      : {
          emailHtml: requireNullableString(record.emailHtml, `${label}.emailHtml`),
        }),
    explicitTarget: requireNullableString(
      record.explicitTarget ?? null,
      `${label}.explicitTarget`,
    ),
    idempotencyKey: requireString(record.idempotencyKey, `${label}.idempotencyKey`),
    identityId: requireNullableString(record.identityId ?? null, `${label}.identityId`),
    media,
    message: requireStringValue(record.message, `${label}.message`),
    ...(record.nativeReplyRequested === undefined
      ? {}
      : {
          nativeReplyRequested: requireTrue(
            record.nativeReplyRequested,
            `${label}.nativeReplyRequested`,
          ),
        }),
    ...(record.groupEmailAuthorizationProof === undefined
      ? {}
      : {
          groupEmailAuthorizationProof: requireNullableGroupEmailAuthorizationProof(
            record.groupEmailAuthorizationProof,
            `${label}.groupEmailAuthorizationProof`,
          ),
        }),
    subject: requireNullableString(record.subject ?? null, `${label}.subject`),
    replyToMessageId: requireNullableString(
      record.replyToMessageId ?? null,
      `${label}.replyToMessageId`,
    ),
    sessionId: requireString(record.sessionId, `${label}.sessionId`),
    threadId: requireNullableString(record.threadId ?? null, `${label}.threadId`),
    threadIsDirect,
    transportIdempotent: requireBoolean(
      record.transportIdempotent,
      `${label}.transportIdempotent`,
    ),
    turnId: requireString(record.turnId, `${label}.turnId`),
  };
}

function parseHostedAssistantResponseCard(
  value: unknown,
  label: string,
): HostedAssistantResponseCard | null {
  if (value === null) {
    return null;
  }
  const parsed = assistantResponseCardSchema.safeParse(value);
  if (!parsed.success) {
    throw new TypeError(`${label} must be a valid assistant response card.`);
  }
  return parsed.data;
}

function requireNullableGroupEmailAuthorizationProof(
  value: unknown,
  label: string,
): string | null {
  if (value === null) {
    return null;
  }
  const proof = requireString(value, label);
  if (!/^[0-9a-f]{64}$/u.test(proof)) {
    throw new TypeError(`${label} must be a SHA-256 hex digest.`);
  }
  return proof;
}

function parseHostedAssistantDeliveryAnsweredMailboxItemIds(
  value: unknown,
  label: string,
): string[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }
  if (value.length > HOSTED_ASSISTANT_DELIVERY_ANSWERED_MAILBOX_ITEM_ID_LIMIT) {
    throw new TypeError(
      `${label} must contain at most ${HOSTED_ASSISTANT_DELIVERY_ANSWERED_MAILBOX_ITEM_ID_LIMIT} entries.`,
    );
  }

  return value.map((entry, index) => {
    const itemId = requireString(entry, `${label}[${index}]`).trim();
    if (!itemId) {
      throw new TypeError(`${label}[${index}] must be a non-empty string.`);
    }
    return itemId;
  });
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
  if (kind === "vault_image") {
    return parseHostedAssistantDeliveryVaultImageMedia(record, label);
  }
  if (kind === "voice_memo") {
    return parseHostedAssistantDeliveryVoiceMemoMedia(record, label);
  }
  if (kind === "vault_file") {
    return parseHostedAssistantDeliveryVaultFileMedia(record, label);
  }

  throw new TypeError(
    `${label}.kind must be image, vault_image, voice_memo, or vault_file.`,
  );
}

function parseHostedAssistantDeliveryVaultImageMedia(
  record: Record<string, unknown>,
  label: string,
): HostedAssistantDeliveryVaultImageMedia {
  requireExactObjectKeys(
    record,
    {
      required: ["contentType", "filename", "kind", "ref", "sha256", "sizeBytes"],
      optional: ["alt", "source"],
    },
    label,
  );
  const ref = requireBoundedTrimmedString(record.ref, `${label}.ref`, 1_024);
  if (!isNormalizedAssistantVaultFileRef(ref)) {
    throw new TypeError(`${label}.ref must be a normalized supported vault-relative path.`);
  }
  const sha256 = requireString(record.sha256, `${label}.sha256`);
  if (!/^[0-9a-f]{64}$/u.test(sha256)) {
    throw new TypeError(`${label}.sha256 must be a lowercase SHA-256 hex digest.`);
  }
  const contentType = requireString(record.contentType, `${label}.contentType`);
  if (
    contentType !== "image/jpeg" &&
    contentType !== "image/png" &&
    contentType !== "image/webp"
  ) {
    throw new TypeError(`${label}.contentType must be a supported image MIME type.`);
  }
  const filename = requireBoundedTrimmedString(
    record.filename,
    `${label}.filename`,
    255,
  );
  if (/[\\/\u0000-\u001F\u007F]/u.test(filename)) {
    throw new TypeError(
      `${label}.filename must not contain path separators or control characters.`,
    );
  }
  return {
    alt: requireNullableBoundedTrimmedString(
      record.alt ?? null,
      `${label}.alt`,
      500,
    ),
    contentType,
    filename,
    kind: "vault_image",
    ref,
    sha256,
    sizeBytes: requirePositiveIntegerAtMost(
      record.sizeBytes,
      `${label}.sizeBytes`,
      10 * 1024 * 1024,
    ),
    source: requireNullableBoundedTrimmedString(
      record.source ?? null,
      `${label}.source`,
      200,
    ),
  };
}

function parseHostedAssistantDeliveryVaultFileMedia(
  record: Record<string, unknown>,
  label: string,
): HostedAssistantDeliveryVaultFileMedia {
  requireExactObjectKeys(
    record,
    {
      required: ["contentType", "filename", "kind", "ref", "sha256", "sizeBytes"],
      optional: ["approvalGeneration", "approvalId"],
    },
    label,
  );
  const approvalGeneration = requireNullableSha256Hex(
    record.approvalGeneration ?? null,
    `${label}.approvalGeneration`,
  );
  const approvalId = requireNullableHostedActionApprovalId(
    record.approvalId ?? null,
    `${label}.approvalId`,
  );
  if ((approvalGeneration === null) !== (approvalId === null)) {
    throw new TypeError(
      `${label}.approvalId and ${label}.approvalGeneration must be present together.`,
    );
  }
  const ref = requireBoundedTrimmedString(record.ref, `${label}.ref`, 1_024);
  if (!isNormalizedAssistantVaultFileRef(ref)) {
    throw new TypeError(`${label}.ref must be a normalized supported vault-relative path.`);
  }
  const sha256 = requireString(record.sha256, `${label}.sha256`);
  if (!/^[0-9a-f]{64}$/u.test(sha256)) {
    throw new TypeError(`${label}.sha256 must be a lowercase SHA-256 hex digest.`);
  }
  const contentType = requireBoundedTrimmedString(
    record.contentType,
    `${label}.contentType`,
    200,
  );
  if (!/^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/u.test(contentType)) {
    throw new TypeError(`${label}.contentType must be a MIME type.`);
  }
  const filename = requireBoundedTrimmedString(
    record.filename,
    `${label}.filename`,
    255,
  );
  if (/[\\/\u0000-\u001F\u007F]/u.test(filename)) {
    throw new TypeError(`${label}.filename must not contain path separators or control characters.`);
  }
  return {
    approvalGeneration,
    approvalId,
    contentType,
    filename,
    kind: "vault_file",
    ref,
    sha256,
    sizeBytes: requirePositiveIntegerAtMost(
      record.sizeBytes,
      `${label}.sizeBytes`,
      100 * 1024 * 1024,
    ),
  };
}

function requireNullableHostedActionApprovalId(
  value: unknown,
  label: string,
): string | null {
  if (value === null) {
    return null;
  }
  const approvalId = requireString(value, label);
  if (!/^haa_[A-Za-z0-9_-]{32}$/u.test(approvalId)) {
    throw new TypeError(`${label} must be a hosted action approval id.`);
  }
  return approvalId;
}

function requireNullableSha256Hex(value: unknown, label: string): string | null {
  if (value === null) {
    return null;
  }
  const hash = requireString(value, label);
  if (!/^[0-9a-f]{64}$/u.test(hash)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 hex digest.`);
  }
  return hash;
}

function parseHostedAssistantDeliveryVoiceMemoMedia(
  record: Record<string, unknown>,
  label: string,
): HostedAssistantDeliveryVoiceMemoMedia {
  requireExactObjectKeys(
    record,
    {
      required: ["filename", "kind", "transport"],
      optional: ["transcript"],
    },
    label,
  );

  return {
    filename: requireBoundedTrimmedString(record.filename, `${label}.filename`, 255),
    kind: "voice_memo",
    transcript: record.transcript === undefined || record.transcript === null
      ? null
      : requireBoundedTrimmedString(
          record.transcript,
          `${label}.transcript`,
          4_000,
        ),
    transport: parseHostedAssistantDeliveryVoiceMemoTransport(
      record.transport,
      `${label}.transport`,
    ),
  };
}

function parseHostedAssistantDeliveryVoiceMemoTransport(
  value: unknown,
  label: string,
): HostedAssistantDeliveryVoiceMemoTransport {
  const record = requireObject(value, label);
  const kind = requireString(record.kind, `${label}.kind`);
  if (kind === "linq_attachment") {
    requireExactObjectKeys(record, { required: ["attachmentId", "kind"] }, label);
    return {
      attachmentId: requireBoundedTrimmedString(
        record.attachmentId,
        `${label}.attachmentId`,
        200,
      ),
      kind,
    };
  }
  if (kind === "telegram_generation") {
    requireExactObjectKeys(record, { required: ["generation", "kind"] }, label);
    return {
      generation: parseHostedAssistantDeliveryVoiceMemoGeneration(
        record.generation,
        `${label}.generation`,
      ),
      kind,
    };
  }

  throw new TypeError(`${label}.kind must be linq_attachment or telegram_generation.`);
}

function parseHostedAssistantDeliveryVoiceMemoGeneration(
  value: unknown,
  label: string,
): HostedAssistantDeliveryVoiceMemoGeneration {
  const record = requireObject(value, label);
  const kind = requireString(record.kind, `${label}.kind`);
  if (kind === "elevenlabs_speech") {
    requireExactObjectKeys(
      record,
      { required: ["kind", "modelId", "outputFormat", "text", "voiceId"] },
      label,
    );
    if (record.outputFormat !== "mp3_44100_128") {
      throw new TypeError(`${label}.outputFormat must be mp3_44100_128.`);
    }
    return {
      kind,
      modelId: requireBoundedTrimmedString(record.modelId, `${label}.modelId`, 200),
      outputFormat: "mp3_44100_128",
      text: requireBoundedTrimmedString(record.text, `${label}.text`, 4_000),
      voiceId: requireBoundedTrimmedString(record.voiceId, `${label}.voiceId`, 200),
    };
  }
  if (kind === "elevenlabs_music") {
    requireExactObjectKeys(
      record,
      {
        required: [
          "durationMs",
          "forceInstrumental",
          "kind",
          "modelId",
          "outputFormat",
          "prompt",
        ],
      },
      label,
    );
    if (record.modelId !== "music_v2") {
      throw new TypeError(`${label}.modelId must be music_v2.`);
    }
    if (record.outputFormat !== "mp3_48000_192") {
      throw new TypeError(`${label}.outputFormat must be mp3_48000_192.`);
    }
    return {
      durationMs: requireIntegerInRange(
        record.durationMs,
        `${label}.durationMs`,
        3_000,
        300_000,
      ),
      forceInstrumental: requireBoolean(
        record.forceInstrumental,
        `${label}.forceInstrumental`,
      ),
      kind,
      modelId: "music_v2",
      outputFormat: "mp3_48000_192",
      prompt: requireBoundedTrimmedString(record.prompt, `${label}.prompt`, 4_100),
    };
  }

  throw new TypeError(`${label}.kind must be elevenlabs_speech or elevenlabs_music.`);
}

function requireExactObjectKeys(
  record: Record<string, unknown>,
  spec: { required: readonly string[]; optional?: readonly string[] },
  label: string,
): void {
  const allowed = new Set<string>([...spec.required, ...(spec.optional ?? [])]);
  const presentKeys = Object.keys(record);
  const present = new Set(presentKeys);
  const unknown = presentKeys.filter((key) => !allowed.has(key)).sort();
  const missing = spec.required.filter((key) => !present.has(key)).sort();
  if (missing.length === 0 && unknown.length === 0) {
    return;
  }
  const parts: string[] = [];
  if (missing.length > 0) {
    parts.push(`missing required fields: ${missing.join(", ")}`);
  }
  if (unknown.length > 0) {
    parts.push(`unsupported fields: ${unknown.join(", ")}`);
  }
  throw new TypeError(`${label} has ${parts.join("; ")}.`);
}

function requireBoundedTrimmedString(
  value: unknown,
  label: string,
  maxLength: number,
): string {
  const normalized = requireString(value, label).trim();
  if (!normalized || normalized.length > maxLength) {
    throw new TypeError(`${label} must contain 1 to ${maxLength} characters.`);
  }
  return normalized;
}

function requireIntegerInRange(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new TypeError(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value as number;
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
  if (record.kind === "message-reaction") {
    return {
      kind: "message-reaction",
      channel: requireHostedAssistantReactionChannel(
        record.channel,
        `${label}.channel`,
      ),
      idempotencyKey: requireString(
        record.idempotencyKey,
        `${label}.idempotencyKey`,
      ),
      reaction: requireHostedAssistantMessageReaction(
        record.reaction,
        `${label}.reaction`,
      ),
      sentAt: requireString(record.sentAt, `${label}.sentAt`),
      target: requireString(record.target, `${label}.target`),
      targetKind: requireHostedAssistantDeliveryTargetKind(
        record.targetKind,
        `${label}.targetKind`,
      ),
      targetMessageId: requireString(record.targetMessageId, `${label}.targetMessageId`),
    };
  }

  return {
    ...(record.kind === "message" ? { kind: "message" as const } : {}),
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

function requireHostedAssistantReactionChannel(
  value: unknown,
  label: string,
): "linq" | "telegram" {
  const channel = requireString(value, label);
  if (channel !== "telegram" && channel !== "linq") {
    throw new TypeError(`${label} must be linq or telegram for reactions.`);
  }

  return channel;
}

function requireNullableString(value: unknown, label: string): string | null {
  if (value === null) {
    return null;
  }

  return requireString(value, label);
}

function requireNullableBoundedTrimmedString(
  value: unknown,
  label: string,
  maxLength: number,
): string | null {
  if (value === null) {
    return null;
  }

  return requireBoundedTrimmedString(value, label, maxLength);
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

function requireTrue(value: unknown, label: string): true {
  if (value !== true) {
    throw new TypeError(`${label} must be true when present.`);
  }

  return true;
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

function requireHostedAssistantMessageReaction(
  value: unknown,
  label: string,
): HostedAssistantMessageReaction {
  const reaction = requireString(value, label);
  if (reaction === "heart" || reaction === "thumbs_up" || reaction === "laugh") {
    return reaction;
  }

  throw new TypeError(`${label} is not a supported assistant reaction.`);
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
