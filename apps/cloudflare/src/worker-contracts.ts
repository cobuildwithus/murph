import type { R2BucketLike } from "./bundle-store.ts";
import { toStringEnvSource, type StringEnvSource } from "./string-env.ts";

export const LEGACY_ACTIVE_INVOCATION_COMPATIBILITY_DELETE_AFTER = "2026-05-25";

export interface WorkerSendEmailBindingLike {
  send(message: unknown): Promise<unknown>;
}

export interface WorkerUserRunnerStubLike {
  bindUser?(userId: string): Promise<{ userId: string }>;
  deleteHostedUserData?(userId: string): Promise<unknown>;
  validateRuntimeWriteFence?(input: {
    attemptId: string;
    generation: string;
    userId: string;
    workspaceVersion?: string | null;
  }): Promise<boolean>;
  /**
   * Legacy active-invocation compatibility around the write fence.
   * Delete after 2026-05-25; live code must use `validateRuntimeWriteFence`.
   */
  ownsActiveInvocationLease?(input: {
    attemptId: string;
    leaseGeneration: string;
    userId: string;
    workspaceVersion?: string | null;
  }): Promise<boolean>;
  /**
   * Legacy active-invocation compatibility around the write fence.
   * Delete after 2026-05-25; this path is intentionally inert.
   */
  recordActiveInvocationHeartbeat?(input: {
    attemptId: string;
    leaseGeneration: string;
    userId: string;
  }): Promise<unknown>;
  recordRuntimeWriteFenceWorkspaceCheckpoint?(input: {
    attemptId: string;
    generation: string;
    userId: string;
    workspaceVersion: string;
  }): Promise<{ recorded: boolean }>;
  /**
   * Legacy active-invocation compatibility around the write fence.
   * Delete after 2026-05-25; live code must use
   * `recordRuntimeWriteFenceWorkspaceCheckpoint`.
   */
  recordActiveInvocationWorkspaceCheckpoint?(input: {
    attemptId: string;
    leaseGeneration: string;
    userId: string;
    workspaceVersion: string;
  }): Promise<{ recorded: boolean }>;
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
  BUNDLES: R2BucketLike;
  CF_VERSION_METADATA?: {
    id?: string;
    tag?: string;
    timestamp?: string;
  };
  HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS?: string;
  HOSTED_AI_USAGE_GATE_ALLOW_SIGNING_KEY_ID?: string;
  HOSTED_AI_USAGE_GATE_ALLOW_SIGNING_SECRET?: string;
  ALLOW_LOCAL_INTERNAL_PROXY?: string;
  HOSTED_ASSISTANT_APPROVAL_POLICY?: string;
  HOSTED_ASSISTANT_MODEL?: string;
  HOSTED_ASSISTANT_PROVIDER?: string;
  HOSTED_ASSISTANT_REASONING_EFFORT?: string;
  HOSTED_ASSISTANT_SANDBOX?: string;
  OPENAI_API_KEY?: string;
  HOSTED_EXECUTION_MAX_EVENT_ATTEMPTS?: string;
  HOSTED_EXECUTION_RETRY_DELAY_MS?: string;
  HOSTED_EXECUTION_RUNNER_ENV_PROFILES?: string;
  HOSTED_EXECUTION_RUNNER_DESTROY_TIMEOUT_MS?: string;
  HOSTED_EXECUTION_RUNNER_TIMEOUT_MS?: string;
  HOSTED_EXECUTION_WEB_CONTROL_TIMEOUT_MS?: string;
  HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT?: string;
  HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL?: string;
  MURPH_HOSTED_LOCAL_TEST_ROUTES?: string;
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
