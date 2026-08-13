import type {
  HostedMailboxItem,
  HostedMailboxKind,
  HostedMailboxLane,
} from "@murphai/hosted-execution/runtime-control";
import {
  HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
  HOSTED_MAILBOX_KINDS,
  HOSTED_MAILBOX_LANES,
} from "@murphai/hosted-execution/runtime-control";

export const HOSTED_MAILBOX_IMPORT_ACTIONS = [
  "import-conversation-message",
  "apply-member-activation",
  "apply-member-channels-update",
  "apply-member-preferences",
  "dispatch-assistant-notification",
  "run-assistant-ask",
  "continue-assistant-ask",
  "run-clinical-records-sync",
  "run-device-sync-wake",
  "run-environment-voice",
  "import-meal-photo",
  "apply-runtime-control-request",
  "import-vault-share-delivery",
  "import-vault-share-revoke",
  "skip-retired-mailbox-item",
] as const;

export type HostedMailboxImportAction =
  (typeof HOSTED_MAILBOX_IMPORT_ACTIONS)[number];

export type HostedMailboxQuarantineCode =
  | "invalid_lane_seq"
  | "invalid_payload_bytes"
  | "invalid_payload_schema"
  | "invalid_timestamp"
  | "lane_kind_mismatch"
  | "unsupported_kind"
  | "unsupported_lane";

export interface HostedMailboxRoutePlan {
  action: HostedMailboxImportAction;
  advanceProgress: true;
  itemRef: {
    id: string;
    kind: HostedMailboxKind;
    lane: HostedMailboxLane;
    laneSeq: string;
  };
  state: "route";
}

export interface HostedMailboxQuarantinePlan {
  advanceProgress: false;
  quarantineCode: HostedMailboxQuarantineCode;
  state: "quarantine";
}

export type HostedMailboxRoutingPlan =
  | HostedMailboxQuarantinePlan
  | HostedMailboxRoutePlan;

const SUPPORTED_MAILBOX_KINDS: readonly string[] = HOSTED_MAILBOX_KINDS;
const SUPPORTED_MAILBOX_LANES: readonly string[] = HOSTED_MAILBOX_LANES;

const ACTION_BY_KIND = {
  "assistant.ask.completed": "continue-assistant-ask",
  "assistant.ask.requested": "run-assistant-ask",
  "assistant.notification.requested": "dispatch-assistant-notification",
  "clinical-records.sync-requested": "run-clinical-records-sync",
  "conversation.message": "import-conversation-message",
  "device-sync.wake": "run-device-sync-wake",
  "environment-voice.captured": "run-environment-voice",
  "group-newsletter.email-needed": "skip-retired-mailbox-item",
  "meal-photo.captured": "import-meal-photo",
  "member.activated": "apply-member-activation",
  "member.channels.updated": "apply-member-channels-update",
  "member.preferences.updated": "apply-member-preferences",
  "runtime.browser-vault-refresh-requested": "apply-runtime-control-request",
  "runtime.codex-auth-requested": "apply-runtime-control-request",
  "runtime.device-sync-recovery-requested": "apply-runtime-control-request",
  "runtime.mailbox-lag-observed": "apply-runtime-control-request",
  "runtime.maintenance-requested": "apply-runtime-control-request",
  "runtime.manual-requested": "apply-runtime-control-request",
  "runtime.provider-setup-continuation-requested": "apply-runtime-control-request",
  "runtime.pending-effects-reconcile-requested": "apply-runtime-control-request",
  "vault-share.delivery": "import-vault-share-delivery",
  "vault-share.revoke": "import-vault-share-revoke",
} satisfies Record<HostedMailboxKind, HostedMailboxImportAction>;

export function createHostedMailboxRoutingPlan(
  item: HostedMailboxItem,
): HostedMailboxRoutingPlan {
  if (!isHostedMailboxKind(item.kind)) {
    return quarantine("unsupported_kind");
  }

  if (!isHostedMailboxLane(item.lane)) {
    return quarantine("unsupported_lane");
  }

  if (item.lane !== resolveExpectedLaneForHostedMailboxKind(item.kind)) {
    return quarantine("lane_kind_mismatch");
  }

  if (!isPositiveIntegerString(item.laneSeq)) {
    return quarantine("invalid_lane_seq");
  }

  if (item.payloadSchema !== HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA) {
    return quarantine("invalid_payload_schema");
  }

  if (!hasValidMailboxTimestamps(item)) {
    return quarantine("invalid_timestamp");
  }

  if (!hasValidPayloadBytes(item.payloadBytes)) {
    return quarantine("invalid_payload_bytes");
  }

  return {
    action: ACTION_BY_KIND[item.kind],
    advanceProgress: true,
    itemRef: {
      id: item.id,
      kind: item.kind,
      lane: item.lane,
      laneSeq: item.laneSeq,
    },
    state: "route",
  };
}

export function resolveExpectedLaneForHostedMailboxKind(
  kind: HostedMailboxKind,
): HostedMailboxLane {
  return kind === "conversation.message" ? "conversation" : "system";
}

function quarantine(
  quarantineCode: HostedMailboxQuarantineCode,
): HostedMailboxQuarantinePlan {
  return {
    advanceProgress: false,
    quarantineCode,
    state: "quarantine",
  };
}

function isHostedMailboxKind(value: unknown): value is HostedMailboxKind {
  return typeof value === "string" && SUPPORTED_MAILBOX_KINDS.includes(value);
}

function isHostedMailboxLane(value: unknown): value is HostedMailboxLane {
  return typeof value === "string" && SUPPORTED_MAILBOX_LANES.includes(value);
}

function isPositiveIntegerString(value: string | null): value is string {
  if (!value || !/^(?:0|[1-9]\d*)$/u.test(value)) {
    return false;
  }

  return BigInt(value) > 0n;
}

function hasValidMailboxTimestamps(
  item: HostedMailboxItem,
): boolean {
  return isValidIsoTimestamp(item.createdAt)
    && isValidIsoTimestamp(item.occurredAt)
    && isValidIsoTimestamp(item.updatedAt)
    && (
      item.expiresAt === undefined
      || item.expiresAt === null
      || isValidIsoTimestamp(item.expiresAt)
    );
}

function isValidIsoTimestamp(value: unknown): boolean {
  return typeof value === "string"
    && value.trim().length > 0
    && Number.isFinite(Date.parse(value));
}

function hasValidPayloadBytes(value: unknown): boolean {
  return value === undefined
    || value === null
    || (
      typeof value === "number"
      && Number.isSafeInteger(value)
      && value >= 0
    );
}
