import type { R2BucketLike } from "./bundle-store.ts";
import { toStringEnvSource, type StringEnvSource } from "./string-env.ts";

export interface WorkerSendEmailBindingLike {
  send(message: unknown): Promise<unknown>;
}

export interface WorkerUserRunnerStubLike {
  bootstrapUser?(userId: string): Promise<{ userId: string }>;
  stopActiveRunMessagingActivity?(input: {
    reason?: string | null;
    runId: string;
  }): Promise<{
    stopped: boolean;
  }>;
}

export interface WorkerBootstrapUserRunnerStubLike extends WorkerUserRunnerStubLike {
  bootstrapUser(userId: string): Promise<{ userId: string }>;
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
  HOSTED_ASSISTANT_API_KEY_ENV?: string;
  HOSTED_ASSISTANT_APPROVAL_POLICY?: string;
  HOSTED_ASSISTANT_BASE_URL?: string;
  HOSTED_ASSISTANT_CODEX_COMMAND?: string;
  HOSTED_ASSISTANT_GATEWAY_ONLY_PROVIDERS?: string;
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
  HOSTED_EXECUTION_WEB_CONTROL_TIMEOUT_MS?: string;
  HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT?: string;
  HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL?: string;
  HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME?: string;
  HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG?: string;
  HOSTED_EMAIL?: WorkerSendEmailBindingLike;
  HOSTED_EMAIL_DEFAULT_SUBJECT?: string;
  HOSTED_EMAIL_DOMAIN?: string;
  HOSTED_EMAIL_FROM_ADDRESS?: string;
  HOSTED_EMAIL_LOCAL_PART?: string;
  HOSTED_EMAIL_SIGNING_SECRET?: string;
  HOSTED_WAKE_ENCRYPTION_KEY?: string;
  HOSTED_WAKE_ENCRYPTION_KEYRING_JSON?: string;
  HOSTED_WAKE_ENCRYPTION_KEY_VERSION?: string;
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
