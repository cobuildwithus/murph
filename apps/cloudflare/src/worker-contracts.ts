import type {
  GatewayFetchAttachmentsInput,
  GatewayGetConversationInput,
  GatewayListConversationsInput,
  GatewayAttachment,
  GatewayConversation,
  GatewayListConversationsResult,
  GatewayListOpenPermissionsInput,
  GatewayPermissionRequest,
  GatewayPollEventsInput,
  GatewayPollEventsResult,
  GatewayReadMessagesInput,
  GatewayReadMessagesResult,
  GatewayRespondToPermissionInput,
} from "@murphai/gateway-core";
import type {
  HostedExecutionBundleRef,
} from "@murphai/hosted-execution";
import type {
  HostedExecutionDeviceSyncRuntimeApplyRequest,
  HostedExecutionDeviceSyncRuntimeApplyResponse,
  HostedExecutionDeviceSyncRuntimeSnapshotRequest,
  HostedExecutionDeviceSyncRuntimeSnapshotResponse,
} from "@murphai/device-syncd/hosted-runtime";

import type { R2BucketLike } from "./bundle-store.ts";
import type {
  HostedExecutionCommitPayload,
  HostedExecutionCommittedResult,
} from "./execution-journal.ts";

export interface WorkerUserRunnerCommitInput {
  eventId: string;
  payload: HostedExecutionCommitPayload & {
    currentBundleRef: HostedExecutionBundleRef | null;
  };
}

export interface WorkerUserRunnerStubLike {
  bootstrapUser?(userId: string): Promise<{ userId: string }>;
  provisionManagedUserCrypto?(userId: string): Promise<{ recipientKinds: string[]; rootKeyId: string; userId: string }>;
  commit(input: WorkerUserRunnerCommitInput): Promise<HostedExecutionCommittedResult>;
  gatewayFetchAttachments?(input: GatewayFetchAttachmentsInput): Promise<GatewayAttachment[]>;
  gatewayGetConversation?(input: GatewayGetConversationInput): Promise<GatewayConversation | null>;
  gatewayListConversations?(input?: GatewayListConversationsInput): Promise<GatewayListConversationsResult>;
  gatewayListOpenPermissions?(input?: GatewayListOpenPermissionsInput): Promise<GatewayPermissionRequest[]>;
  gatewayPollEvents?(input?: GatewayPollEventsInput): Promise<GatewayPollEventsResult>;
  gatewayReadMessages?(input: GatewayReadMessagesInput): Promise<GatewayReadMessagesResult>;
  gatewayRespondToPermission?(input: GatewayRespondToPermissionInput): Promise<GatewayPermissionRequest | null>;
  applyDeviceSyncRuntimeUpdates?(input: {
    request: HostedExecutionDeviceSyncRuntimeApplyRequest;
  }): Promise<HostedExecutionDeviceSyncRuntimeApplyResponse>;
  getDeviceSyncRuntimeSnapshot?(input: {
    request: HostedExecutionDeviceSyncRuntimeSnapshotRequest;
  }): Promise<HostedExecutionDeviceSyncRuntimeSnapshotResponse>;
  putPendingUsage?(input: {
    usage: readonly Record<string, unknown>[];
  }): Promise<{ recorded: number; usageIds: string[] }>;
  readPendingUsage?(input?: { limit?: number | null }): Promise<Record<string, unknown>[]>;
  deletePendingUsage?(input: { usageIds: readonly string[] }): Promise<void>;
}

export interface WorkerUserRunnerNamespaceLike<
  TStub extends WorkerUserRunnerStubLike = WorkerUserRunnerStubLike,
> {
  getByName(name: string): TStub;
}

export interface WorkerEnvironmentContract<
  TStub extends WorkerUserRunnerStubLike = WorkerUserRunnerStubLike,
> extends Readonly<Record<string, unknown>> {
  BUNDLES: R2BucketLike;
  HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS?: string;
  HOSTED_ASSISTANT_API_KEY_ENV?: string;
  HOSTED_ASSISTANT_APPROVAL_POLICY?: string;
  HOSTED_ASSISTANT_BASE_URL?: string;
  HOSTED_ASSISTANT_CODEX_COMMAND?: string;
  HOSTED_ASSISTANT_MODEL?: string;
  HOSTED_ASSISTANT_OSS?: string;
  HOSTED_ASSISTANT_PROFILE?: string;
  HOSTED_ASSISTANT_PROVIDER?: string;
  HOSTED_ASSISTANT_PROVIDER_NAME?: string;
  HOSTED_ASSISTANT_REASONING_EFFORT?: string;
  HOSTED_ASSISTANT_SANDBOX?: string;
  HOSTED_ASSISTANT_ZERO_DATA_RETENTION?: string;
  HOSTED_EXECUTION_AUTOMATION_RECIPIENT_KEY_ID?: string;
  HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK?: string;
  HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_KEYRING_JSON?: string;
  HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK?: string;
  HOSTED_EXECUTION_RECOVERY_RECIPIENT_KEY_ID?: string;
  HOSTED_EXECUTION_RECOVERY_RECIPIENT_PUBLIC_JWK?: string;
  HOSTED_EXECUTION_TEE_AUTOMATION_RECIPIENT_KEY_ID?: string;
  HOSTED_EXECUTION_TEE_AUTOMATION_RECIPIENT_PUBLIC_JWK?: string;
  HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY?: string;
  HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY_ID?: string;
  HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEYRING_JSON?: string;
  HOSTED_EXECUTION_MAX_EVENT_ATTEMPTS?: string;
  HOSTED_EXECUTION_RETRY_DELAY_MS?: string;
  HOSTED_EXECUTION_RUNNER_ENV_PROFILES?: string;
  HOSTED_EXECUTION_RUNNER_TIMEOUT_MS?: string;
  HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT?: string;
  HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME?: string;
  HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG?: string;
  HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID?: string;
  HOSTED_EMAIL_CLOUDFLARE_API_BASE_URL?: string;
  HOSTED_EMAIL_CLOUDFLARE_API_TOKEN?: string;
  HOSTED_EMAIL_DEFAULT_SUBJECT?: string;
  HOSTED_EMAIL_DOMAIN?: string;
  HOSTED_EMAIL_FROM_ADDRESS?: string;
  HOSTED_EMAIL_LOCAL_PART?: string;
  HOSTED_EMAIL_SIGNING_SECRET?: string;
  HOSTED_WEB_CALLBACK_SIGNING_KEY_ID?: string;
  HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK?: string;
  HOSTED_WEB_BASE_URL?: string;
  USER_RUNNER: WorkerUserRunnerNamespaceLike<TStub>;
}
