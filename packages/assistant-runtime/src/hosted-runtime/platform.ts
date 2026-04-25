import type {
  HostedAssistantDeliveryRecord,
  HostedAssistantDeliverySideEffect,
} from "@murphai/hosted-execution/side-effects";
import type {
  HostedExecutionDeviceSyncConnectLinkResponse,
  HostedExecutionDeviceSyncRuntimeApplyRequest,
  HostedExecutionDeviceSyncRuntimeApplyResponse,
  HostedExecutionDeviceSyncRuntimeSnapshotResponse,
} from "@murphai/device-syncd/hosted-runtime";
import type {
  HostedRuntimeDrainEvent,
} from "@murphai/hosted-execution/contracts";
import type {
  AssistantTurnInputRefreshPhase,
} from "@murphai/assistant-engine";
import type {
  HostedEmailSendRequest,
} from "../hosted-email.ts";

export interface HostedRuntimeArtifactStore {
  get(sha256: string): Promise<Uint8Array | null>;
  put(input: {
    bytes: Uint8Array;
    sha256: string;
  }): Promise<void>;
}

type HostedRuntimeEffectsPortBase = {
  deletePreparedAssistantDelivery?(
    input: Pick<HostedAssistantDeliverySideEffect, "effectId" | "fingerprint">,
  ): Promise<void>;
  readRawEmailMessage(rawMessageKey: string): Promise<Uint8Array | null>;
  readAssistantDeliveryRecord?(
    input: Pick<HostedAssistantDeliverySideEffect, "effectId" | "fingerprint">,
  ): Promise<HostedAssistantDeliveryRecord | null>;
  sendEmail(request: HostedEmailSendRequest): Promise<{ target: string } | void>;
  writeAssistantDeliveryRecord?(
    record: HostedAssistantDeliveryRecord,
  ): Promise<HostedAssistantDeliveryRecord>;
};

export type HostedRuntimeEffectsPort = HostedRuntimeEffectsPortBase;

export interface HostedRuntimeDeviceSyncPort {
  applyUpdates(input: {
    occurredAt?: string | null;
    updates: HostedExecutionDeviceSyncRuntimeApplyRequest["updates"];
  }): Promise<HostedExecutionDeviceSyncRuntimeApplyResponse>;
  createConnectLink(input: {
    provider: string;
  }): Promise<HostedExecutionDeviceSyncConnectLinkResponse>;
  fetchSnapshot(input?: {
    connectionId?: string | null;
    provider?: string | null;
  }): Promise<HostedExecutionDeviceSyncRuntimeSnapshotResponse>;
}

export interface HostedRuntimeBillingPort {
  resolveVercelAiGatewayStripeCustomerId(): Promise<HostedRuntimeBillingStripeCustomerResponse>;
}

export interface HostedRuntimeUsageExportPort {
  recordUsage(usage: readonly object[]): Promise<HostedRuntimeUsageRecordResponse>;
}

export interface HostedRuntimeIssueExportPort {
  recordIssues(issues: readonly object[]): Promise<HostedRuntimeIssueRecordResponse>;
}

export interface HostedRuntimeTurnInputPort {
  refresh(input: {
    afterSeq?: string | null;
    phase: AssistantTurnInputRefreshPhase;
    requestId: string;
  }): Promise<{
    events: HostedRuntimeDrainEvent[];
  }>;
}

export interface HostedRuntimeMessagingActivityPort {
  stopActiveRunMessagingActivity(input: {
    reason: "before_committed_assistant_delivery";
    runId: string;
  }): Promise<{
    stopped: boolean;
  }>;
}

export interface HostedRuntimePlatform {
  artifactStore: HostedRuntimeArtifactStore;
  billingPort?: HostedRuntimeBillingPort | null;
  deviceSyncPort?: HostedRuntimeDeviceSyncPort | null;
  effectsPort: HostedRuntimeEffectsPort;
  issueExportPort?: HostedRuntimeIssueExportPort | null;
  messagingActivityPort?: HostedRuntimeMessagingActivityPort | null;
  turnInputPort?: HostedRuntimeTurnInputPort | null;
  usageExportPort?: HostedRuntimeUsageExportPort | null;
}

export interface HostedRuntimeBillingStripeCustomerResponse {
  stripeCustomerId: string | null;
}

export interface HostedRuntimeUsageRecordResponse {
  recorded: number;
  usageIds: string[];
}

export interface HostedRuntimeIssueRecordResponse {
  issueIds: string[];
  recorded: number;
}

export function parseHostedRuntimeUsageRecordResponse(
  value: unknown,
): HostedRuntimeUsageRecordResponse {
  const response = parseHostedRuntimeRecordResponse(value, "usageIds");
  return {
    recorded: response.recorded,
    usageIds: response.ids,
  };
}

export const HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED_ENV =
  "HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED";
export const HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY_ENV =
  "HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY";

export function parseHostedRuntimeBillingStripeCustomerResponse(
  value: unknown,
): HostedRuntimeBillingStripeCustomerResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted runtime Stripe customer response must be an object.");
  }

  const stripeCustomerId = (value as { stripeCustomerId?: unknown }).stripeCustomerId;

  if (stripeCustomerId !== null && stripeCustomerId !== undefined && typeof stripeCustomerId !== "string") {
    throw new TypeError(
      "Hosted runtime Stripe customer response.stripeCustomerId must be a string or null.",
    );
  }

  if (typeof stripeCustomerId === "string") {
    const normalizedStripeCustomerId = stripeCustomerId.trim();
    if (normalizedStripeCustomerId.length === 0) {
      throw new TypeError(
        "Hosted runtime Stripe customer response.stripeCustomerId must be a non-empty string or null.",
      );
    }

    return {
      stripeCustomerId: normalizedStripeCustomerId,
    };
  }

  return {
    stripeCustomerId: null,
  };
}

function parseHostedRuntimeRecordResponse(
  value: unknown,
  idsFieldName: "issueIds" | "usageIds",
): { ids: string[]; recorded: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted runtime record response must be an object.");
  }

  const recorded = (value as { recorded?: unknown }).recorded;
  const ids = (value as Record<string, unknown>)[idsFieldName];

  if (typeof recorded !== "number" || !Number.isSafeInteger(recorded) || recorded < 0) {
    throw new TypeError("Hosted runtime record response.recorded must be a non-negative integer.");
  }

  if (!Array.isArray(ids)) {
    throw new TypeError(`Hosted runtime record response.${idsFieldName} must be a string array of non-empty values.`);
  }

  const normalizedIds: string[] = []
  for (const entry of ids) {
    if (typeof entry !== "string") {
      throw new TypeError(`Hosted runtime record response.${idsFieldName} must be a string array of non-empty values.`);
    }
    const trimmedEntry = entry.trim()
    if (trimmedEntry.length === 0) {
      throw new TypeError(`Hosted runtime record response.${idsFieldName} must be a string array of non-empty values.`);
    }
    normalizedIds.push(trimmedEntry)
  }

  return {
    ids: normalizedIds,
    recorded,
  };
}


export function parseHostedRuntimeIssueRecordResponse(
  value: unknown,
): HostedRuntimeIssueRecordResponse {
  const response = parseHostedRuntimeRecordResponse(value, "issueIds");
  return {
    issueIds: response.ids,
    recorded: response.recorded,
  };
}
