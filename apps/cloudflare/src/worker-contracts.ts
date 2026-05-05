import type { R2BucketLike } from "./bundle-store.ts";
import { toStringEnvSource, type StringEnvSource } from "./string-env.ts";

export interface WorkerSendEmailBindingLike {
  send(message: unknown): Promise<unknown>;
}

export interface WorkerQueueRetryOptionsLike {
  delaySeconds?: number;
}

export interface WorkerQueueMessageLike<Body = unknown> {
  readonly attempts?: number;
  readonly body: Body;
  readonly id?: string;
  readonly timestamp?: Date;
  ack(): void;
  retry(options?: WorkerQueueRetryOptionsLike): void;
}

export interface WorkerQueueMessageBatchLike<Body = unknown> {
  readonly messages: readonly WorkerQueueMessageLike<Body>[];
  readonly queue?: string;
  ackAll?(): void;
  retryAll?(options?: WorkerQueueRetryOptionsLike): void;
}

export interface WorkerUserRunnerStubLike {
  bindUser?(userId: string): Promise<{ userId: string }>;
  deleteHostedUserData?(userId: string): Promise<unknown>;
  ownsActiveInvocationLease?(input: {
    attemptId: string;
    leaseGeneration: string;
    userId: string;
    workspaceVersion?: string | null;
  }): Promise<boolean>;
  recordActiveInvocationHeartbeat?(input: {
    attemptId: string;
    leaseGeneration: string;
    userId: string;
  }): Promise<
    | {
      inputAvailable: boolean;
      nextAlarmAt: string | null;
      ok: true;
      pendingNudge: boolean;
    }
    | {
      ok: false;
      reason:
        | "no_active_invocation"
        | "stale_attempt"
        | "stale_generation"
        | "wrong_user";
    }
  >;
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
