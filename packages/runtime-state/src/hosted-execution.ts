export const HOSTED_EXECUTION_SIGNATURE_HEADER = "x-hb-execution-signature";
export const HOSTED_EXECUTION_TIMESTAMP_HEADER = "x-hb-execution-timestamp";

export type HostedExecutionEventKind =
  | "member.activated"
  | "linq.message.received"
  | "assistant.cron.tick";

export interface HostedExecutionBaseEvent {
  kind: HostedExecutionEventKind;
  userId: string;
}

export interface HostedExecutionMemberActivatedEvent extends HostedExecutionBaseEvent {
  kind: "member.activated";
  linqChatId: string | null;
  normalizedPhoneNumber: string;
}

export interface HostedExecutionLinqMessageReceivedEvent extends HostedExecutionBaseEvent {
  kind: "linq.message.received";
  linqChatId: string | null;
  linqEvent: Record<string, unknown>;
  normalizedPhoneNumber: string;
}

export interface HostedExecutionAssistantCronTickEvent extends HostedExecutionBaseEvent {
  kind: "assistant.cron.tick";
  reason: "alarm" | "manual";
}

export type HostedExecutionEvent =
  | HostedExecutionMemberActivatedEvent
  | HostedExecutionLinqMessageReceivedEvent
  | HostedExecutionAssistantCronTickEvent;

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
  bundleRefs: {
    agentState: HostedExecutionBundleRef | null;
    vault: HostedExecutionBundleRef | null;
  };
  inFlight: boolean;
  lastError: string | null;
  lastEventId: string | null;
  lastRunAt: string | null;
  nextWakeAt: string | null;
  userId: string;
}
