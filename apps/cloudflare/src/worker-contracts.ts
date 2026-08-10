import type {
  HostedWorkspaceInvocationResult,
} from "@murphai/hosted-execution/runtime-control";
import type {
  CloudflareHostedControlRuntimeShellPrewarmSource,
} from "@murphai/cloudflare-hosted-control/client";
import type { R2BucketLike } from "./bundle-store.ts";
import type { HostedBrowserVaultReplicaOrphanCandidate } from "./browser-vault-store.ts";
import type {
  HostedPrivateMediaPublishInput,
  HostedPrivateMediaPublishResult,
} from "./private-media.ts";
import { toStringEnvSource, type StringEnvSource } from "./string-env.ts";
import type {
  HostedWorkspaceSnapshotOrphanCandidate,
  HostedWorkspaceSnapshotUploadSession,
} from "./workspace-snapshot-store.ts";
import type { DatabaseHealthMonitorResult } from "./database-health/monitor.ts";
import type { DatabaseHealthStoredSample } from "./database-health/store.ts";

export interface WorkerSendEmailBindingLike {
  send(message: unknown): Promise<unknown>;
}

export interface WorkerAiBindingLike {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export interface WorkerAnalyticsEngineDatasetLike {
  writeDataPoint(dataPoint: {
    blobs?: string[];
    doubles?: number[];
    indexes?: string[];
  }): void;
}

export type WorkerProviderEgressTokenValidationRejectReason =
  | "missing_provider_egress_token"
  | "missing_runner_state"
  | "missing_write_fence"
  | "provider_egress_token_mismatch"
  | "write_fence_mismatch";

export type WorkerProviderEgressTokenValidationResult =
  | {
      owns: false;
      reason?: WorkerProviderEgressTokenValidationRejectReason;
    }
  | {
      attemptId: string;
      customInferenceEnvelope?: string;
      leaseGeneration: string;
      owns: true;
      platformAiUsageAllowed?: boolean;
      userId: string;
      workspaceVersion: string | null;
    };

export type WorkerProviderEgressCredentialValidationRejectReason =
  | "missing_runner_state"
  | "missing_write_fence"
  | "provider_egress_not_allowed"
  | "runner_container_mismatch"
  | "write_fence_mismatch";

export type WorkerProviderEgressCredentialValidationResult =
  | {
      owns: false;
      reason?: WorkerProviderEgressCredentialValidationRejectReason;
    }
  | {
      attemptId: string;
      leaseGeneration: string;
      owns: true;
      platformAiUsageAllowed?: boolean;
      userId: string;
      workspaceVersion: string | null;
    };

/**
 * Snapshot of the RunnerContainer DO's in-memory active workspace-invocation
 * operation. "Active" spans the whole DO-side invoke, including its
 * pre-dispatch readiness window — it proves the operation is in flight, not
 * that the runner child has accepted work. Consumers narrow what they need:
 * provider-egress fallback binds on `userId` only; the transport-failure
 * liveness probe matches the full attempt identity.
 */
export type WorkerActiveRuntimeUserFenceResult =
  | {
      active: false;
      reason: "no_active_runtime";
    }
  | {
      active: true;
      attemptId: string;
      leaseGeneration: string;
      userId: string;
    };

export interface WorkerRuntimeCompletionReceipt {
  attemptId: string;
  generation: string;
  result: HostedWorkspaceInvocationResult;
  userId: string;
}

export interface WorkerRunnerContainerStubLike {
  readActiveRuntimeUserFence?(): Promise<WorkerActiveRuntimeUserFenceResult>;
}

export interface WorkerDeploySmokeRunnerContainerStubLike
  extends WorkerRunnerContainerStubLike {
  /**
   * Returns and consumes the one deploy-smoke live-model egress grant.
   */
  readDeploySmokeLiveModelTurnFence?(): Promise<{
    active: boolean;
    model?: string;
  }>;
}

export interface WorkerRunnerContainerNamespaceLike<
  TStub extends WorkerRunnerContainerStubLike = WorkerRunnerContainerStubLike,
> {
  get?(id: unknown): TStub;
  getByName?(name: string): TStub;
  idFromString?(id: string): unknown;
}

export interface WorkerUserRunnerStubLike {
  bindUser?(userId: string): Promise<{ userId: string }>;
  deleteHostedUserData?(userId: string): Promise<unknown>;
  prewarmRuntimeShellForUser?(
    userId: string,
    source?: CloudflareHostedControlRuntimeShellPrewarmSource,
  ): Promise<void>;
  reconcileRuntimeHealthDataConsentForUser?(userId: string): Promise<unknown>;
  publishHostedPrivateMedia?(
    input: HostedPrivateMediaPublishInput,
  ): Promise<HostedPrivateMediaPublishResult>;
  createHostedWorkspaceSnapshotUploadSession?(
    input: HostedWorkspaceSnapshotUploadSession,
  ): Promise<HostedWorkspaceSnapshotUploadSession | null>;
  heartbeatHostedWorkspaceSnapshotUploadSession?(input: {
    attemptId: string;
    leaseGeneration: string;
    snapshotId: string;
    userId: string;
  }): Promise<boolean>;
  completeHostedWorkspaceSnapshotUploadSession?(input: {
    attemptId: string;
    leaseGeneration: string;
    snapshotId: string;
    userId: string;
  }): Promise<boolean>;
  rememberHostedWorkspaceSnapshotReplacedRef?(input: {
    expectedSession: HostedWorkspaceSnapshotUploadSession;
    replacedSnapshotRef: NonNullable<HostedWorkspaceSnapshotUploadSession["replacedSnapshotRef"]>;
  }): Promise<boolean>;
  rememberHostedWorkspaceSnapshotPresignedPut?(input: {
    drainUntil: string;
    expectedSession: HostedWorkspaceSnapshotUploadSession;
    expiresAt: string;
  }): Promise<HostedWorkspaceSnapshotUploadSession | null>;
  deleteHostedWorkspaceSnapshotUploadSession?(input: {
    snapshotId: string;
    userId: string;
  }): Promise<{ deleted: boolean }>;
  readHostedWorkspaceSnapshotUploadSession?(input: {
    snapshotId: string;
    userId: string;
  }): Promise<HostedWorkspaceSnapshotUploadSession | null>;
  recordHostedWorkspaceSnapshotOrphanCandidate?(
    input: HostedWorkspaceSnapshotOrphanCandidate,
  ): Promise<HostedWorkspaceSnapshotOrphanCandidate>;
  recordHostedBrowserVaultReplicaOrphanCandidate?(
    input: HostedBrowserVaultReplicaOrphanCandidate,
  ): Promise<HostedBrowserVaultReplicaOrphanCandidate>;
  validateRuntimeWriteFence?(input: {
    attemptId: string;
    generation: string;
    userId: string;
  }): Promise<boolean>;
  recordRuntimeCompletionFromContainer?(
    input: WorkerRuntimeCompletionReceipt,
  ): Promise<{ completed: boolean }>;
  validateRuntimeProviderEgressToken?(input: {
    providerEgressToken: string;
    userId: string;
  }): Promise<WorkerProviderEgressTokenValidationResult>;
  validateRuntimeProviderEgressCredential?(input: {
    providerKind: string;
    runnerContainerName: string;
    userId: string;
  }): Promise<WorkerProviderEgressCredentialValidationResult>;
}

export interface WorkerBindUserRunnerStubLike extends WorkerUserRunnerStubLike {
  bindUser(userId: string): Promise<{ userId: string }>;
}

export interface WorkerUserRunnerNamespaceLike<
  TStub extends WorkerUserRunnerStubLike = WorkerUserRunnerStubLike,
> {
  getByName(name: string): TStub;
}

export interface WorkerDatabaseHealthStubLike {
  readRecentSamples?(input?: {
    limit?: number;
  }): Promise<DatabaseHealthStoredSample[]> | DatabaseHealthStoredSample[];
  runScheduledCheck(input?: {
    scheduledAtMs?: number;
  }): Promise<DatabaseHealthMonitorResult>;
}

export interface WorkerDatabaseHealthNamespaceLike<
  TStub extends WorkerDatabaseHealthStubLike = WorkerDatabaseHealthStubLike,
> {
  getByName(name: string): TStub;
}

export interface WorkerEnvironmentContract<
  TStub extends WorkerUserRunnerStubLike = WorkerUserRunnerStubLike,
> extends Readonly<Record<string, unknown>> {
  AI?: WorkerAiBindingLike;
  BUNDLES: R2BucketLike;
  CF_VERSION_METADATA?: {
    id?: string;
    tag?: string;
    timestamp?: string;
  };
  CF_PUBLIC_BASE_URL?: string;
  DATABASE_HEALTH_MONITOR?: WorkerDatabaseHealthNamespaceLike;
  HOSTED_DATABASE_ALERT_ENABLED?: string;
  HOSTED_DATABASE_ALERT_LINQ_CHAT_ID?: string;
  HOSTED_DATABASE_ALERT_LINQ_SECONDARY_CHAT_ID?: string;
  HOSTED_DATABASE_ALERT_PLANETSCALE_BRANCH_ID?: string;
  HOSTED_DATABASE_ALERT_PLANETSCALE_BRANCH_NAME?: string;
  HOSTED_DATABASE_ALERT_PLANETSCALE_DATABASE_NAME?: string;
  HOSTED_DATABASE_ALERT_PLANETSCALE_ORGANIZATION?: string;
  HOSTED_DATABASE_ALERT_PLANETSCALE_SERVICE_TOKEN?: string;
  HOSTED_DATABASE_ALERT_PLANETSCALE_SERVICE_TOKEN_ID?: string;
  HOSTED_PRIVATE_MEDIA_CAPABILITY_SECRET?: string;
  HOSTED_RUNTIME_RETRY_ANALYTICS?: WorkerAnalyticsEngineDatasetLike;
  HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS?: string;
  HOSTED_AI_USAGE_REPORTING_SECRET?: string;
  HOSTED_LOG_FINGERPRINT_SECRET?: string;
  HOSTED_PHYSICAL_NOTES_ENABLED?: string;
  HOSTED_ASSISTANT_APPROVAL_POLICY?: string;
  HOSTED_ASSISTANT_MODEL?: string;
  HOSTED_ASSISTANT_PROVIDER?: string;
  HOSTED_ASSISTANT_REASONING_EFFORT?: string;
  HOSTED_ASSISTANT_SANDBOX?: string;
  ELEVENLABS_API_KEY?: string;
  OPENAI_API_KEY?: string;
  VENICE_API_KEY?: string;
  HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET?: string;
  HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON?: string;
  HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS?: string;
  HOSTED_EXECUTION_MAX_EVENT_ATTEMPTS?: string;
  HOSTED_EXECUTION_RETRY_DELAY_MS?: string;
  HOSTED_EXECUTION_RUNNER_ENV_PROFILES?: string;
  HOSTED_EXECUTION_WEB_CONTROL_TIMEOUT_MS?: string;
  HOSTED_R2_PRESIGN_ACCESS_KEY_ID?: string;
  HOSTED_R2_PRESIGN_ACCOUNT_ID?: string;
  HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT?: string;
  HOSTED_R2_PRESIGN_BUCKET_NAME?: string;
  HOSTED_R2_PRESIGN_CONTROL_ENDPOINT?: string;
  HOSTED_R2_PRESIGN_ENDPOINT?: string;
  HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY?: string;
  HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT?: string;
  HOSTED_EXECUTION_RUNNER_HOST_ALIAS?: string;
  MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED?: string;
  MURPH_HOSTED_LOCAL_DEPLOY_SMOKE_USE_BUILD_ID?: string;
  MURPH_HOSTED_LOCAL_PROFILE?: string;
  MURPH_HOSTED_LOCAL_R2_DOCKER_BRIDGE_HOST?: string;
  MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID?: string;
  HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL?: string;
  HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME?: string;
  HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG?: string;
  HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION?: string;
  HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM?: string;
  HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID?: string;
  HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK?: string;
  HOSTED_CRYPTO_ENV?: string;
  HOSTED_EMAIL?: WorkerSendEmailBindingLike;
  HOSTED_EMAIL_DEFAULT_SUBJECT?: string;
  HOSTED_EMAIL_DOMAIN?: string;
  HOSTED_EMAIL_FROM_ADDRESS?: string;
  HOSTED_EMAIL_LOCAL_PART?: string;
  HOSTED_EMAIL_SIGNING_SECRET?: string;
  EXA_API_KEY?: string;
  LINQ_ATTACHMENT_CDN_BASE_URL?: string;
  LINQ_API_BASE_URL?: string;
  LINQ_API_TOKEN?: string;
  MAPBOX_ACCESS_TOKEN?: string;
  MURPH_DATA_API_KEY?: string;
  MURPH_ELEVENLABS_MODEL_ID?: string;
  MURPH_ELEVENLABS_VOICE_ID?: string;
  RUNNER_CONTAINER?: WorkerRunnerContainerNamespaceLike;
  RUNNER_CONTAINER_SMOKE?: WorkerRunnerContainerNamespaceLike<
    WorkerDeploySmokeRunnerContainerStubLike
  >;
  TELEGRAM_API_BASE_URL?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_FILE_BASE_URL?: string;
  XAI_API_KEY?: string;
  HOSTED_WEB_CALLBACK_SIGNING_KEY_ID?: string;
  HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK?: string;
  HOSTED_WEB_BASE_URL?: string;
  USER_RUNNER: WorkerUserRunnerNamespaceLike<TStub>;
}

export function asWorkerStringEnvironment(
  source: Readonly<Record<string, unknown>>,
): StringEnvSource {
  return toStringEnvSource(source);
}
