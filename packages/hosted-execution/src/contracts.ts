import type { SharePack } from "@healthybob/contracts";

export const HOSTED_EXECUTION_SIGNATURE_HEADER = "x-hb-execution-signature";
export const HOSTED_EXECUTION_TIMESTAMP_HEADER = "x-hb-execution-timestamp";

export type HostedExecutionEventKind =
  | "member.activated"
  | "linq.message.received"
  | "email.message.received"
  | "assistant.cron.tick"
  | "device-sync.wake"
  | "vault.share.accepted";

export interface HostedExecutionBaseEvent {
  kind: HostedExecutionEventKind;
  userId: string;
}

export interface HostedExecutionMemberActivatedEvent extends HostedExecutionBaseEvent {
  kind: "member.activated";
}

export interface HostedExecutionLinqMessageReceivedEvent extends HostedExecutionBaseEvent {
  kind: "linq.message.received";
  linqEvent: Record<string, unknown>;
  normalizedPhoneNumber: string;
}


export interface HostedExecutionEmailMessageReceivedEvent extends HostedExecutionBaseEvent {
  kind: "email.message.received";
  envelopeFrom: string | null;
  envelopeTo: string | null;
  identityId: string;
  rawMessageKey: string;
  threadTarget: string | null;
}
export interface HostedExecutionAssistantCronTickEvent extends HostedExecutionBaseEvent {
  kind: "assistant.cron.tick";
  reason: "alarm" | "manual" | "device-sync";
}

export interface HostedExecutionDeviceSyncWakeEvent extends HostedExecutionBaseEvent {
  kind: "device-sync.wake";
  reason: "connected" | "webhook_hint" | "disconnected" | "reauthorization_required";
}
export interface HostedExecutionVaultShareAcceptedEvent extends HostedExecutionBaseEvent {
  kind: "vault.share.accepted";
  pack: SharePack;
}

export type HostedExecutionEvent =
  | HostedExecutionMemberActivatedEvent
  | HostedExecutionLinqMessageReceivedEvent
  | HostedExecutionEmailMessageReceivedEvent
  | HostedExecutionAssistantCronTickEvent
  | HostedExecutionDeviceSyncWakeEvent
  | HostedExecutionVaultShareAcceptedEvent;

export interface HostedExecutionDispatchRequest {
  event: HostedExecutionEvent;
  eventId: string;
  occurredAt: string;
}

export type HostedExecutionBundleKind = "vault" | "agent-state";

export interface HostedExecutionRunnerRequest {
  bundles: {
    agentState: string | null;
    vault: string | null;
  };
  dispatch: HostedExecutionDispatchRequest;
}

export interface HostedExecutionRunnerResult {
  bundles: {
    agentState: string | null;
    vault: string | null;
  };
  result: {
    eventsHandled: number;
    nextWakeAt?: string | null;
    summary: string;
  };
}

export interface HostedExecutionBundleRef {
  hash: string;
  key: string;
  size: number;
  updatedAt: string;
}

export interface HostedExecutionUserStatus {
  backpressuredEventIds?: string[];
  bundleRefs: {
    agentState: HostedExecutionBundleRef | null;
    vault: HostedExecutionBundleRef | null;
  };
  inFlight: boolean;
  lastError: string | null;
  lastEventId: string | null;
  lastRunAt: string | null;
  nextWakeAt: string | null;
  pendingEventCount: number;
  poisonedEventIds: string[];
  retryingEventId: string | null;
  userId: string;
}

export interface HostedExecutionUserEnvStatus {
  configuredUserEnvKeys: string[];
  userId: string;
}

export interface HostedExecutionUserEnvUpdate {
  env: Record<string, string | null>;
  mode: "merge" | "replace";
}

export interface HostedExecutionSharePackResponse {
  pack: SharePack;
  shareCode: string;
  shareId: string;
}
