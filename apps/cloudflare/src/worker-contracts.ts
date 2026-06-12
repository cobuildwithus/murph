import type { R2BucketLike } from "./bundle-store.ts";
import { toStringEnvSource, type StringEnvSource } from "./string-env.ts";
import type {
  HostedWorkspaceSnapshotOrphanCandidate,
  HostedWorkspaceSnapshotUploadSession,
} from "./workspace-snapshot-store.ts";

export interface WorkerSendEmailBindingLike {
  send(message: unknown): Promise<unknown>;
}

export interface WorkerAiBindingLike {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export type WorkerActiveRuntimeWriteFenceValidationRejectReason =
  | "missing_runner_state"
  | "missing_write_fence"
  | "write_fence_mismatch";

export type WorkerActiveRuntimeWriteFenceValidationResult =
  | {
      owns: false;
      reason?: WorkerActiveRuntimeWriteFenceValidationRejectReason;
    }
  | {
      attemptId: string;
      leaseGeneration: string;
      owns: true;
      userId: string;
      workspaceVersion: string | null;
    };

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
      leaseGeneration: string;
      owns: true;
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

export interface WorkerRunnerContainerStubLike {
  readActiveRuntimeUserFence?(): Promise<WorkerActiveRuntimeUserFenceResult>;
}

export interface WorkerDeploySmokeRunnerContainerStubLike
  extends WorkerRunnerContainerStubLike {
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
  createHostedWorkspaceSnapshotUploadSession?(
    input: HostedWorkspaceSnapshotUploadSession,
  ): Promise<HostedWorkspaceSnapshotUploadSession>;
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
  validateRuntimeWriteFence?(input: {
    attemptId: string;
    generation: string;
    userId: string;
    workspaceVersion?: string | null;
  }): Promise<boolean>;
  validateActiveRuntimeWriteFence?(input: {
    userId: string;
  }): Promise<WorkerActiveRuntimeWriteFenceValidationResult>;
  validateRuntimeProviderEgressToken?(input: {
    providerEgressToken: string;
    userId: string;
  }): Promise<WorkerProviderEgressTokenValidationResult>;
}

export interface WorkerBindUserRunnerStubLike extends WorkerUserRunnerStubLike {
  bindUser(userId: string): Promise<{ userId: string }>;
}

export interface WorkerUserRunnerNamespaceLike<
  TStub extends WorkerUserRunnerStubLike = WorkerUserRunnerStubLike,
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
  HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS?: string;
  HOSTED_AI_USAGE_REPORTING_SECRET?: string;
  HOSTED_LOG_FINGERPRINT_SECRET?: string;
  HOSTED_ASSISTANT_APPROVAL_POLICY?: string;
  HOSTED_ASSISTANT_MODEL?: string;
  HOSTED_ASSISTANT_PROVIDER?: string;
  HOSTED_ASSISTANT_REASONING_EFFORT?: string;
  HOSTED_ASSISTANT_SANDBOX?: string;
  CLOUDFLARE_IMAGES_ACCOUNT_ID?: string;
  CLOUDFLARE_IMAGES_API_KEY?: string;
  CLOUDFLARE_IMAGES_VARIANT?: string;
  OPENAI_API_KEY?: string;
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
  LINQ_API_BASE_URL?: string;
  LINQ_API_TOKEN?: string;
  MAPBOX_ACCESS_TOKEN?: string;
  MURPH_DATA_API_KEY?: string;
  RUNNER_CONTAINER?: WorkerRunnerContainerNamespaceLike;
  RUNNER_CONTAINER_SMOKE?: WorkerRunnerContainerNamespaceLike<
    WorkerDeploySmokeRunnerContainerStubLike
  >;
  TELEGRAM_API_BASE_URL?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_FILE_BASE_URL?: string;
  WHATSAPP_ACCESS_TOKEN?: string;
  WHATSAPP_API_BASE_URL?: string;
  WHATSAPP_GRAPH_VERSION?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
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
