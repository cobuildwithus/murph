import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import {
  HOSTED_AI_USAGE_ALLOWANCE_ACCEPTED_MODEL_IDS,
  HOSTED_RUNTIME_PRIVATE_MEDIA_DELIVERY_ORIGIN,
} from "@murphai/hosted-execution/runtime-control";
import {
  normalizeHostedExecutionBaseUrl,
} from "@murphai/hosted-execution/env";
import {
  assertHostedCryptoStandbyKeyringJsons,
} from "@murphai/runtime-state";

import { readHostedDeployAutomationTimeouts } from "./deploy-automation/environment.ts";
import { HOSTED_WORKER_REQUIRED_SECRET_NAMES } from "./deploy-automation/secrets.ts";
import {
  HOSTED_WORKER_REQUIRED_VAR_NAMES,
} from "./deploy-automation/worker-optional-vars.ts";
import {
  normalizeOptionalString,
  readBooleanEnv,
} from "./deploy-automation/shared.ts";
import {
  assertHostedR2Bucket,
  createWranglerR2BucketInfoReader,
  type R2BucketInfo,
} from "./r2-bucket.ts";

type EnvSource = Readonly<Record<string, string | undefined>>;
type HostedDeployContext = "development" | "preview" | "production";
type ProductionDeployRequiredUrlLabel = (typeof PRODUCTION_DEPLOY_URL_INVARIANT_LABELS)[number];
type ProductionDeployOptionalUrlLabel = (typeof PRODUCTION_DEPLOY_OPTIONAL_CALLBACK_URL_LABELS)[number];
type ProductionDeployUrlLabel = ProductionDeployRequiredUrlLabel | ProductionDeployOptionalUrlLabel;
type HostnameAddressResolver = (hostname: string) => Promise<readonly string[]>;
type R2BucketInfoReader = (bucketName: string) => Promise<R2BucketInfo>;

interface HostedDeployAsyncDependencies {
  readR2BucketInfo?: R2BucketInfoReader;
  resolveHostnameAddresses?: HostnameAddressResolver;
}

interface ProductionDeployUrlValidation {
  hostname: string;
  normalized: string;
}

const HOSTED_DEPLOY_CONTEXTS = [
  "development",
  "preview",
  "production",
] as const;
const REQUIRED_HOSTED_ASSISTANT_PROVIDER = "openai";
const PRODUCTION_HOSTED_ASSISTANT_REASONING_EFFORT = "low";
const STATE_ISOLATION_CONTAINER_ROLLOUT = "immediate";
const HOSTED_DEPLOY_CONTEXT_SET = new Set<string>(HOSTED_DEPLOY_CONTEXTS);

const REQUIRED_DEPLOY_ENV_NAMES = [
  "CF_WORKER_NAME",
  "CF_BUNDLES_BUCKET",
  "CF_BUNDLES_PREVIEW_BUCKET",
] as const;

const REQUIRED_DEPLOY_WORKER_ENV_NAMES = [
  "CF_PUBLIC_BASE_URL",
  "HOSTED_EXECUTION_DEPLOY_CONTEXT",
  "HOSTED_WEB_BASE_URL",
  "HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG",
  "HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME",
  ...HOSTED_WORKER_REQUIRED_VAR_NAMES.filter((name) =>
    name !== "CF_PUBLIC_BASE_URL"
  ),
] as const;

const REQUIRED_NON_PRODUCTION_DEPLOY_WORKER_ENV_NAMES = [
  "HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT",
] as const;

const REQUIRED_PREVIEW_DEPLOY_WORKER_ENV_NAMES = [
  "HOSTED_WEB_PRODUCTION_BASE_URL",
] as const;

const REQUIRED_PRODUCTION_DEPLOY_WORKER_ENV_NAMES = [
  "HOSTED_WEB_PRODUCTION_BASE_URL",
  "HOSTED_DATABASE_ALERT_ENABLED",
  "HOSTED_DATABASE_ALERT_PLANETSCALE_BRANCH_ID",
  "HOSTED_DATABASE_ALERT_PLANETSCALE_BRANCH_NAME",
  "HOSTED_DATABASE_ALERT_PLANETSCALE_DATABASE_NAME",
  "HOSTED_DATABASE_ALERT_PLANETSCALE_ORGANIZATION",
  "HOSTED_DATABASE_ALERT_LINQ_CHAT_ID",
  "HOSTED_DATABASE_ALERT_LINQ_SECONDARY_CHAT_ID",
  "HOSTED_DATABASE_ALERT_PLANETSCALE_SERVICE_TOKEN",
  "HOSTED_DATABASE_ALERT_PLANETSCALE_SERVICE_TOKEN_ID",
  "LINQ_API_TOKEN",
] as const;

const JUNCTION_RUNTIME_REQUIRED_ENV_NAMES = [
  "JUNCTION_API_KEY",
  "JUNCTION_CLIENT_USER_ID_SECRET",
  "JUNCTION_ENV",
  "JUNCTION_REGION",
] as const;

const PRODUCTION_DEPLOY_URL_INVARIANT_LABELS = [
  "CF_PUBLIC_BASE_URL",
  "HOSTED_WEB_BASE_URL",
  "HOSTED_WEB_PRODUCTION_BASE_URL",
] as const;

const PRODUCTION_DEPLOY_OPTIONAL_CALLBACK_URL_LABELS = [
  "DEVICE_SYNC_PUBLIC_BASE_URL",
] as const;

const PREVIEW_DEPLOY_URL_INVARIANT_LABELS = [
  "CF_PUBLIC_BASE_URL",
  "HOSTED_WEB_BASE_URL",
] as const;

const PREVIEW_DEPLOY_RESOURCE_LABELS = [
  "CF_WORKER_NAME",
  "CF_BUNDLES_BUCKET",
  "CF_BUNDLES_PREVIEW_BUCKET",
] as const;

const LOOPBACK_OR_PRIVATE_HOSTS = new Set([
  "0.0.0.0",
  "localhost",
  "localhost.localdomain",
  "127.0.0.1",
  "::",
  "::1",
  "[::]",
  "[::1]",
  "host.docker.internal",
]);
const IPV4_PATTERN = /^\d{1,3}(?:\.\d{1,3}){3}$/u;

export function listMissingHostedDeployEnvironment(
  source: EnvSource = process.env,
  input: {
    deployWorker: boolean;
  },
): string[] {
  const deployContext = normalizeHostedDeployContext(source.HOSTED_EXECUTION_DEPLOY_CONTEXT);
  const requiredEnvNames: readonly string[] = [
    ...REQUIRED_DEPLOY_ENV_NAMES,
    ...(input.deployWorker
      ? [
          ...REQUIRED_DEPLOY_WORKER_ENV_NAMES,
          ...(deployContext && deployContext !== "production"
            ? REQUIRED_NON_PRODUCTION_DEPLOY_WORKER_ENV_NAMES
            : []),
          ...(deployContext === "preview" ? REQUIRED_PREVIEW_DEPLOY_WORKER_ENV_NAMES : []),
          ...(deployContext === "production" ? REQUIRED_PRODUCTION_DEPLOY_WORKER_ENV_NAMES : []),
          ...HOSTED_WORKER_REQUIRED_SECRET_NAMES,
        ]
      : []),
  ];

  return listMissingRequiredEnvNames(source, requiredEnvNames);
}

export function assertHostedDeployEnvironment(
  source: EnvSource = process.env,
  input: {
    deployWorker: boolean;
  },
): void {
  const missing = listMissingHostedDeployEnvironment(source, input);

  if (missing.length > 0) {
    throw new Error(
      `Missing required GitHub environment variables for deploy workflow: ${missing.join(" ")}`,
    );
  }

  const invariantErrors = listHostedDeployEnvironmentInvariantErrors(source, input);

  if (invariantErrors.length > 0) {
    throw new Error(
      `Invalid GitHub environment variables for deploy workflow: ${invariantErrors.join(" ")}`,
    );
  }
}

export async function assertHostedDeployEnvironmentAsync(
  source: EnvSource = process.env,
  input: {
    deployWorker: boolean;
  },
  dependencies: HostedDeployAsyncDependencies = {},
): Promise<void> {
  const missing = listMissingHostedDeployEnvironment(source, input);

  if (missing.length > 0) {
    throw new Error(
      `Missing required GitHub environment variables for deploy workflow: ${missing.join(" ")}`,
    );
  }

  const invariantErrors = await listHostedDeployEnvironmentInvariantErrorsAsync(
    source,
    input,
    dependencies,
  );

  if (invariantErrors.length > 0) {
    throw new Error(
      `Invalid GitHub environment variables for deploy workflow: ${invariantErrors.join(" ")}`,
    );
  }
}

export function parseDeployWorkerFlag(value: string | undefined): boolean {
  return readBooleanEnv(value, false);
}

export function listHostedDeployEnvironmentInvariantErrors(
  source: EnvSource = process.env,
  input: {
    deployWorker: boolean;
  },
): string[] {
  if (!input.deployWorker) {
    return [];
  }

  const errors: string[] = [];
  const deployContext = normalizeHostedDeployContext(source.HOSTED_EXECUTION_DEPLOY_CONTEXT);

  try {
    readHostedDeployAutomationTimeouts(source);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  if (
    normalizeOptionalString(source.HOSTED_EXECUTION_DEPLOY_CONTEXT)
    && !deployContext
  ) {
    errors.push(
      "HOSTED_EXECUTION_DEPLOY_CONTEXT must be one of development, preview, or production.",
    );
    return errors;
  }

  if (!deployContext) {
    return errors;
  }

  const databaseAlertEnabled = normalizeOptionalString(
    source.HOSTED_DATABASE_ALERT_ENABLED,
  );
  if (
    deployContext === "production"
    && databaseAlertEnabled
    && databaseAlertEnabled !== "1"
  ) {
    errors.push(
      "HOSTED_DATABASE_ALERT_ENABLED must be 1 for production deploys.",
    );
  } else if (
    deployContext !== "production"
    && databaseAlertEnabled
  ) {
    errors.push(
      "HOSTED_DATABASE_ALERT_ENABLED must be unset outside production.",
    );
  }
  const primaryDatabaseAlertChatId = normalizeOptionalString(
    source.HOSTED_DATABASE_ALERT_LINQ_CHAT_ID,
  );
  const secondaryDatabaseAlertChatId = normalizeOptionalString(
    source.HOSTED_DATABASE_ALERT_LINQ_SECONDARY_CHAT_ID,
  );
  if (
    primaryDatabaseAlertChatId
    && secondaryDatabaseAlertChatId
    && primaryDatabaseAlertChatId === secondaryDatabaseAlertChatId
  ) {
    errors.push("Database health alert chat IDs must be distinct.");
  }

  const privateMediaCapabilitySecret = normalizeOptionalString(
    source.HOSTED_PRIVATE_MEDIA_CAPABILITY_SECRET,
  );
  if (
    privateMediaCapabilitySecret
    && privateMediaCapabilitySecret.length < 32
  ) {
    errors.push(
      "HOSTED_PRIVATE_MEDIA_CAPABILITY_SECRET must contain at least 32 characters.",
    );
  }

  const bundlesBucket = normalizeOptionalString(source.CF_BUNDLES_BUCKET);
  const presignBucket = normalizeOptionalString(source.HOSTED_R2_PRESIGN_BUCKET_NAME);
  if (bundlesBucket && presignBucket && presignBucket !== bundlesBucket) {
    errors.push("HOSTED_R2_PRESIGN_BUCKET_NAME must match CF_BUNDLES_BUCKET.");
  }
  const cloudflareAccountId = normalizeOptionalString(source.CLOUDFLARE_ACCOUNT_ID);
  const presignAccountId = normalizeOptionalString(source.HOSTED_R2_PRESIGN_ACCOUNT_ID);
  if (cloudflareAccountId && presignAccountId && presignAccountId !== cloudflareAccountId) {
    errors.push("HOSTED_R2_PRESIGN_ACCOUNT_ID must match CLOUDFLARE_ACCOUNT_ID.");
  }
  if (normalizeOptionalString(source.HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT)) {
    errors.push("HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT must not be set for deploys.");
  }
  if (normalizeOptionalString(source.HOSTED_R2_PRESIGN_CONTROL_ENDPOINT)) {
    errors.push("HOSTED_R2_PRESIGN_CONTROL_ENDPOINT must not be set for deploys.");
  }
  const endpointError = readHostedR2PresignEndpointInvariantError({
    accountId: presignAccountId ?? cloudflareAccountId,
    endpoint: source.HOSTED_R2_PRESIGN_ENDPOINT,
  });
  if (endpointError) {
    errors.push(endpointError);
  }

  const hostedAssistantModel = normalizeOptionalString(source.HOSTED_ASSISTANT_MODEL);
  const hostedAssistantProvider = normalizeOptionalString(source.HOSTED_ASSISTANT_PROVIDER);
  const hostedAssistantReasoningEffort = normalizeOptionalString(
    source.HOSTED_ASSISTANT_REASONING_EFFORT,
  );
  const hostedExecutionContainerRollout = readHostedExecutionContainerRollout(
    source.HOSTED_EXECUTION_CONTAINER_ROLLOUT,
    deployContext,
  );
  const hostedAssistantModelIsAccepted = hostedAssistantModel
    ? HOSTED_AI_USAGE_ALLOWANCE_ACCEPTED_MODEL_IDS.some(
        (model) => model === hostedAssistantModel,
      )
    : false;
  if (hostedAssistantProvider !== REQUIRED_HOSTED_ASSISTANT_PROVIDER) {
    errors.push(
      `HOSTED_ASSISTANT_PROVIDER must be ${REQUIRED_HOSTED_ASSISTANT_PROVIDER} for hosted runner execution.`,
    );
  }

  if (!hostedAssistantModel) {
    errors.push(
      `HOSTED_ASSISTANT_MODEL must be one of ${HOSTED_AI_USAGE_ALLOWANCE_ACCEPTED_MODEL_IDS.join(", ")} for hosted AI usage allowance pricing.`,
    );
  } else if (!hostedAssistantModelIsAccepted) {
    errors.push(
      `HOSTED_ASSISTANT_MODEL must be one of ${HOSTED_AI_USAGE_ALLOWANCE_ACCEPTED_MODEL_IDS.join(", ")} for hosted AI usage allowance pricing.`,
    );
  }

  const hostedCryptoEnv = normalizeOptionalString(source.HOSTED_CRYPTO_ENV);
  if (
    hostedCryptoEnv
    && !HOSTED_DEPLOY_CONTEXT_SET.has(hostedCryptoEnv as HostedDeployContext)
  ) {
    errors.push("HOSTED_CRYPTO_ENV must be one of development, preview, or production.");
  }
  if (hostedCryptoEnv && hostedCryptoEnv !== deployContext) {
    errors.push(`${deployContext} deploys must set HOSTED_CRYPTO_ENV=${deployContext}.`);
  }
  appendHostedCryptoKeyringInvariantErrors(source, errors);

  const oidcEnvironment = normalizeHostedOidcEnvironment(
    source.HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT,
  );
  if (
    normalizeOptionalString(source.HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT)
    && !oidcEnvironment
  ) {
    errors.push(
      "HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT must be one of development, preview, or production.",
    );
  }
  if (oidcEnvironment && oidcEnvironment !== deployContext) {
    errors.push(
      `${deployContext} deploys must set HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT=${deployContext}.`,
    );
  }

  const missingJunctionEnv = listMissingPartialGroupEnvNames(
    source,
    JUNCTION_RUNTIME_REQUIRED_ENV_NAMES,
  );
  if (
    missingJunctionEnv.length > 0
    && missingJunctionEnv.length < JUNCTION_RUNTIME_REQUIRED_ENV_NAMES.length
  ) {
    errors.push(
      `Junction runtime env must set ${JUNCTION_RUNTIME_REQUIRED_ENV_NAMES.join(", ")} together.`,
    );
  }

  if (deployContext === "preview") {
    appendPreviewDeployInvariantErrors(source, errors);
    return errors;
  }

  if (deployContext !== "production") {
    return errors;
  }

  if (
    hostedAssistantReasoningEffort
    !== PRODUCTION_HOSTED_ASSISTANT_REASONING_EFFORT
  ) {
    errors.push(
      `production hosted assistant deploys must set HOSTED_ASSISTANT_REASONING_EFFORT=${PRODUCTION_HOSTED_ASSISTANT_REASONING_EFFORT}.`,
    );
  }

  if (hostedExecutionContainerRollout !== STATE_ISOLATION_CONTAINER_ROLLOUT) {
    errors.push(
      `production state-isolation deploys must use HOSTED_EXECUTION_CONTAINER_ROLLOUT=${STATE_ISOLATION_CONTAINER_ROLLOUT}; rollback floor is the audience-key, selector-scope, and runner-schema-v16 media-effect bundle.`,
    );
  }

  const productionUrls = new Map<ProductionDeployUrlLabel, ProductionDeployUrlValidation>();

  for (const label of PRODUCTION_DEPLOY_URL_INVARIANT_LABELS) {
    const result = readProductionDeployUrl(source, label, {
      requireOriginOnly: true,
      errors,
    });
    if (result) {
      productionUrls.set(label, result);
    }
  }

  for (const label of PRODUCTION_DEPLOY_OPTIONAL_CALLBACK_URL_LABELS) {
    if (!normalizeOptionalString(source[label])) {
      continue;
    }

    const result = readProductionDeployUrl(source, label, {
      requireOriginOnly: false,
      errors,
    });
    if (result) {
      productionUrls.set(label, result);
    }
  }

  const publicWorkerOrigin = productionUrls.get("CF_PUBLIC_BASE_URL")?.normalized;
  if (
    publicWorkerOrigin
    && publicWorkerOrigin !== HOSTED_RUNTIME_PRIVATE_MEDIA_DELIVERY_ORIGIN
  ) {
    errors.push(
      `production deploys must set CF_PUBLIC_BASE_URL=${HOSTED_RUNTIME_PRIVATE_MEDIA_DELIVERY_ORIGIN} for private-media capability delivery.`,
    );
  }

  const hostedWebUrl = productionUrls.get("HOSTED_WEB_BASE_URL");
  const productionWebUrl = productionUrls.get("HOSTED_WEB_PRODUCTION_BASE_URL");
  if (
    hostedWebUrl
    && productionWebUrl
    && hostedWebUrl.normalized !== productionWebUrl.normalized
  ) {
    errors.push(
      "production deploys must set HOSTED_WEB_BASE_URL to HOSTED_WEB_PRODUCTION_BASE_URL.",
    );
  }
  appendHostedDeviceSyncCallbackHostnameInvariantError({
    callbackUrl: productionUrls.get("DEVICE_SYNC_PUBLIC_BASE_URL"),
    deployContext: "production",
    errors,
    hostedWebUrl,
  });

  return errors;
}

function appendHostedCryptoKeyringInvariantErrors(
  source: EnvSource,
  errors: string[],
): void {
  try {
    assertHostedCryptoStandbyKeyringJsons({
      activeAuthorityKeyVersionName:
        source.HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION,
      activeCloudflareRecipientKeyId:
        source.HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID,
      authorityVerifyKeyringJson:
        source.HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON,
      cloudflarePrivateKeyringJson:
        source.HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_KEYRING_JSON,
    });
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Hosted crypto standby keyrings are invalid.");
  }
}

function readHostedR2PresignEndpointInvariantError(input: {
  accountId: string | null;
  endpoint: string | undefined;
}): string | null {
  const endpoint = normalizeOptionalString(input.endpoint);
  if (!endpoint) {
    return null;
  }
  const expectedHostname = input.accountId
    ? `${input.accountId}.r2.cloudflarestorage.com`
    : null;
  try {
    const url = new URL(endpoint);
    if (
      url.protocol !== "https:"
      || url.pathname !== "/"
      || url.search
      || url.hash
      || (expectedHostname !== null && url.hostname !== expectedHostname)
    ) {
      return "HOSTED_R2_PRESIGN_ENDPOINT must be the account-level R2 HTTPS origin.";
    }
  } catch {
    return "HOSTED_R2_PRESIGN_ENDPOINT must be the account-level R2 HTTPS origin.";
  }
  return null;
}

export async function listHostedDeployEnvironmentInvariantErrorsAsync(
  source: EnvSource = process.env,
  input: {
    deployWorker: boolean;
  },
  dependencies: HostedDeployAsyncDependencies = {},
): Promise<string[]> {
  const errors = listHostedDeployEnvironmentInvariantErrors(source, input);

  if (!input.deployWorker) {
    return errors;
  }

  const deployContext = normalizeHostedDeployContext(source.HOSTED_EXECUTION_DEPLOY_CONTEXT);
  if (!deployContext) {
    return errors;
  }
  const r2Errors = await listHostedDeployR2BucketInvariantErrors(
    source,
    dependencies.readR2BucketInfo ?? createDefaultR2BucketInfoReader(source),
  );
  if (deployContext === "preview") {
    const dnsErrors = await listPreviewDeployDnsInvariantErrors(
      source,
      dependencies.resolveHostnameAddresses ?? resolveHostnameAddresses,
    );
    return [...errors, ...r2Errors, ...dnsErrors];
  }

  if (deployContext !== "production") {
    return [...errors, ...r2Errors];
  }

  const dnsErrors = await listProductionDeployDnsInvariantErrors(
    source,
    dependencies.resolveHostnameAddresses ?? resolveHostnameAddresses,
  );
  return [...errors, ...r2Errors, ...dnsErrors];
}

async function listHostedDeployR2BucketInvariantErrors(
  source: EnvSource,
  readR2BucketInfo: R2BucketInfoReader,
): Promise<string[]> {
  const runtimeName = normalizeOptionalString(source.CF_BUNDLES_BUCKET);
  const previewName = normalizeOptionalString(source.CF_BUNDLES_PREVIEW_BUCKET);
  if (!runtimeName || !previewName) {
    return [];
  }

  const buckets = [
    { label: "Runtime R2", location: "ENAM", name: runtimeName },
    { label: "Preview R2", location: "ENAM", name: previewName },
  ] as const;
  const bucketInfoByName = new Map<string, Promise<R2BucketInfo>>();
  const readBucketInfo = (bucketName: string): Promise<R2BucketInfo> => {
    const existing = bucketInfoByName.get(bucketName);
    if (existing) {
      return existing;
    }
    const pending = readR2BucketInfo(bucketName);
    bucketInfoByName.set(bucketName, pending);
    return pending;
  };

  try {
    await Promise.all(buckets.map(async (bucket) => {
      assertHostedR2Bucket({
        bucket: await readBucketInfo(bucket.name),
        bucketName: bucket.name,
        label: bucket.label,
        location: bucket.location,
      });
    }));
    return [];
  } catch (error) {
    return [
      `R2 bucket metadata validation failed: ${
        error instanceof Error ? error.message : "unknown bucket metadata error"
      }`,
    ];
  }
}

function createDefaultR2BucketInfoReader(source: EnvSource): R2BucketInfoReader {
  return createWranglerR2BucketInfoReader(source);
}

function listMissingRequiredEnvNames(
  source: EnvSource,
  names: readonly string[],
): string[] {
  return names.filter((name) => normalizeOptionalString(source[name]) === null);
}

function listMissingPartialGroupEnvNames(
  source: EnvSource,
  names: readonly string[],
): string[] {
  const configured = names.filter((name) => normalizeOptionalString(source[name]) !== null);
  return configured.length === 0
    ? [...names]
    : names.filter((name) => normalizeOptionalString(source[name]) === null);
}

function normalizeHostedDeployContext(value: string | undefined): HostedDeployContext | null {
  const normalized = normalizeOptionalString(value);
  if (!normalized || !HOSTED_DEPLOY_CONTEXT_SET.has(normalized)) {
    return null;
  }

  return normalized as HostedDeployContext;
}

function normalizeHostedOidcEnvironment(value: string | undefined): HostedDeployContext | null {
  const normalized = normalizeOptionalString(value);
  if (!normalized || !HOSTED_DEPLOY_CONTEXT_SET.has(normalized)) {
    return null;
  }

  return normalized as HostedDeployContext;
}

function readHostedExecutionContainerRollout(
  value: string | undefined,
  deployContext: HostedDeployContext | null,
): string {
  return normalizeOptionalString(value)
    ?? (deployContext === "production" ? STATE_ISOLATION_CONTAINER_ROLLOUT : "gradual");
}

function readProductionDeployUrl(
  source: EnvSource,
  label: ProductionDeployUrlLabel,
  input: {
    requireOriginOnly: boolean;
    errors: string[];
  },
): ProductionDeployUrlValidation | null {
  try {
    const normalized = normalizeHostedExecutionBaseUrl(source[label], {
      requireOriginOnly: input.requireOriginOnly,
    });

    if (!normalized) {
      return null;
    }

    const url = new URL(normalized);
    const unsafeHostReason = readUnsafeProductionDeployHostnameReason(url.hostname);
    if (unsafeHostReason) {
      input.errors.push(`${label} must not use ${unsafeHostReason} in production deploys.`);
      return {
        hostname: url.hostname,
        normalized,
      };
    }

    if (isPreviewOrDevelopmentDeployHostname(url.hostname)) {
      input.errors.push(
        `${label} must not use a preview or development origin in production deploys.`,
      );
    }

    return {
      hostname: url.hostname,
      normalized,
    };
  } catch (error) {
    input.errors.push(`${label} must be a valid production HTTPS URL.`);
    return null;
  }
}

function appendPreviewDeployInvariantErrors(
  source: EnvSource,
  errors: string[],
): void {
  for (const label of PREVIEW_DEPLOY_RESOURCE_LABELS) {
    const value = normalizeOptionalString(source[label]);
    if (value && !hasPreviewDeployMarker(value)) {
      errors.push(`${label} must contain a preview or staging name segment for preview deploys.`);
    }
  }

  const previewUrls = new Map<
    (typeof PREVIEW_DEPLOY_URL_INVARIANT_LABELS)[number],
    ProductionDeployUrlValidation
  >();
  for (const label of PREVIEW_DEPLOY_URL_INVARIANT_LABELS) {
    const result = readPreviewDeployUrl(source, label, {
      requireOriginOnly: true,
      errors,
    });
    if (result) {
      previewUrls.set(label, result);
    }
  }

  const productionWebUrl = readProductionDeployUrl(source, "HOSTED_WEB_PRODUCTION_BASE_URL", {
    requireOriginOnly: true,
    errors,
  });
  const previewWorkerUrl = previewUrls.get("CF_PUBLIC_BASE_URL");
  const previewWebUrl = previewUrls.get("HOSTED_WEB_BASE_URL");
  if (
    previewWorkerUrl
    && previewWebUrl
    && previewWorkerUrl.normalized === previewWebUrl.normalized
  ) {
    errors.push(
      "preview deploys must keep CF_PUBLIC_BASE_URL distinct from HOSTED_WEB_BASE_URL.",
    );
  }
  if (
    previewWebUrl
    && productionWebUrl
    && previewWebUrl.normalized === productionWebUrl.normalized
  ) {
    errors.push(
      "preview deploys must not set HOSTED_WEB_BASE_URL to HOSTED_WEB_PRODUCTION_BASE_URL.",
    );
  }

  for (const label of PRODUCTION_DEPLOY_OPTIONAL_CALLBACK_URL_LABELS) {
    if (!normalizeOptionalString(source[label])) {
      continue;
    }
    const callbackUrl = readPreviewDeployUrl(source, label, {
      requireOriginOnly: false,
      errors,
    });
    appendHostedDeviceSyncCallbackHostnameInvariantError({
      callbackUrl: callbackUrl ?? undefined,
      deployContext: "preview",
      errors,
      hostedWebUrl: previewWebUrl,
    });
  }
}

function appendHostedDeviceSyncCallbackHostnameInvariantError(input: {
  callbackUrl: ProductionDeployUrlValidation | undefined;
  deployContext: "preview" | "production";
  errors: string[];
  hostedWebUrl: ProductionDeployUrlValidation | undefined;
}): void {
  if (
    input.callbackUrl
    && input.hostedWebUrl
    && input.callbackUrl.hostname !== input.hostedWebUrl.hostname
  ) {
    input.errors.push(
      `DEVICE_SYNC_PUBLIC_BASE_URL must use the HOSTED_WEB_BASE_URL hostname in ${input.deployContext} deploys.`,
    );
  }
}

function readPreviewDeployUrl(
  source: EnvSource,
  label: ProductionDeployUrlLabel,
  input: {
    requireOriginOnly: boolean;
    errors: string[];
  },
): ProductionDeployUrlValidation | null {
  try {
    const normalized = normalizeHostedExecutionBaseUrl(source[label], {
      requireOriginOnly: input.requireOriginOnly,
    });
    if (!normalized) {
      return null;
    }

    const url = new URL(normalized);
    const unsafeHostReason = readUnsafeProductionDeployHostnameReason(url.hostname);
    if (unsafeHostReason) {
      input.errors.push(`${label} must not use ${unsafeHostReason} in preview deploys.`);
    }
    if (!hasPreviewDeployMarker(url.hostname)) {
      input.errors.push(`${label} must use a preview or staging origin in preview deploys.`);
    }

    return {
      hostname: url.hostname,
      normalized,
    };
  } catch (error) {
    input.errors.push(`${label} must be a valid preview HTTPS URL.`);
    return null;
  }
}

async function listPreviewDeployDnsInvariantErrors(
  source: EnvSource,
  resolveHostnameAddresses: HostnameAddressResolver,
): Promise<string[]> {
  const errors: string[] = [];

  for (const label of PREVIEW_DEPLOY_URL_INVARIANT_LABELS) {
    const parsed = readPreviewDeployUrl(source, label, {
      requireOriginOnly: true,
      errors: [],
    });
    if (parsed) {
      await appendDeployDnsErrors(
        label,
        parsed.hostname,
        "preview",
        resolveHostnameAddresses,
        errors,
      );
    }
  }

  for (const label of PRODUCTION_DEPLOY_OPTIONAL_CALLBACK_URL_LABELS) {
    if (!normalizeOptionalString(source[label])) {
      continue;
    }
    const parsed = readPreviewDeployUrl(source, label, {
      requireOriginOnly: false,
      errors: [],
    });
    if (parsed) {
      await appendDeployDnsErrors(
        label,
        parsed.hostname,
        "preview",
        resolveHostnameAddresses,
        errors,
      );
    }
  }

  return errors;
}

async function listProductionDeployDnsInvariantErrors(
  source: EnvSource,
  resolveHostnameAddresses: HostnameAddressResolver,
): Promise<string[]> {
  const errors: string[] = [];

  for (const label of PRODUCTION_DEPLOY_URL_INVARIANT_LABELS) {
    const parsed = readProductionDeployUrl(source, label, {
      requireOriginOnly: true,
      errors: [],
    });
    if (parsed) {
      await appendDeployDnsErrors(
        label,
        parsed.hostname,
        "production",
        resolveHostnameAddresses,
        errors,
      );
    }
  }

  for (const label of PRODUCTION_DEPLOY_OPTIONAL_CALLBACK_URL_LABELS) {
    if (!normalizeOptionalString(source[label])) {
      continue;
    }

    const parsed = readProductionDeployUrl(source, label, {
      requireOriginOnly: false,
      errors: [],
    });
    if (parsed) {
      await appendDeployDnsErrors(
        label,
        parsed.hostname,
        "production",
        resolveHostnameAddresses,
        errors,
      );
    }
  }

  return errors;
}

async function appendDeployDnsErrors(
  label: ProductionDeployUrlLabel,
  hostname: string,
  deployContext: "preview" | "production",
  resolveHostnameAddresses: HostnameAddressResolver,
  errors: string[],
): Promise<void> {
  const normalized = normalizeHostnameForProductionCheck(hostname).replace(/^\[/u, "").replace(/\]$/u, "");
  if (!normalized || isIP(normalized) !== 0 || LOOPBACK_OR_PRIVATE_HOSTS.has(normalized) || normalized.endsWith(".local")) {
    return;
  }

  let addresses: readonly string[];
  try {
    addresses = await resolveHostnameAddresses(normalized);
  } catch (error) {
    errors.push(`${label} must resolve to public DNS addresses in ${deployContext} deploys.`);
    return;
  }

  if (addresses.length === 0) {
    errors.push(`${label} must resolve to public DNS addresses in ${deployContext} deploys.`);
    return;
  }

  if (addresses.some((address) => readUnsafeProductionDeployHostnameReason(address))) {
    errors.push(
      `${label} must not resolve to private-network addresses in ${deployContext} deploys.`,
    );
  }
}

async function resolveHostnameAddresses(hostname: string): Promise<readonly string[]> {
  const records = await lookup(hostname, {
    all: true,
    verbatim: true,
  });
  return records.map((record) => record.address);
}

function readUnsafeProductionDeployHostnameReason(hostname: string): string | null {
  const normalized = normalizeHostnameForProductionCheck(hostname);
  if (!normalized) {
    return "a blank host";
  }

  if (LOOPBACK_OR_PRIVATE_HOSTS.has(normalized)) {
    return "a local or private-network host";
  }

  if (normalized.endsWith(".local")) {
    return "a local network host";
  }

  if (isPrivateIpv4Host(normalized) || isPrivateIpv6Host(normalized)) {
    return "a private-network host";
  }

  return null;
}

function normalizeHostnameForProductionCheck(hostname: string): string {
  let normalized = hostname.trim().toLowerCase();

  if (normalized.endsWith(".")) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

function isPrivateIpv4Host(hostname: string): boolean {
  if (!IPV4_PATTERN.test(hostname)) {
    return false;
  }

  const octets = hostname.split(".").map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }

  const [first = 0, second = 0] = octets;
  return (
    first === 0
    || first === 10
    || first === 127
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 198 && (second === 18 || second === 19))
  );
}

function isPrivateIpv6Host(hostname: string): boolean {
  const normalized = hostname.replace(/^\[/u, "").replace(/\]$/u, "");
  if (isIP(normalized) !== 6) {
    return false;
  }

  const dottedIpv4MappedAddress = normalized.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/u);
  if (dottedIpv4MappedAddress) {
    return isPrivateIpv4Host(dottedIpv4MappedAddress[1] ?? "");
  }

  const ipv4MappedAddress = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u);
  if (ipv4MappedAddress) {
    const [, highWord = "", lowWord = ""] = ipv4MappedAddress;
    const high = Number.parseInt(highWord, 16);
    const low = Number.parseInt(lowWord, 16);
    const mappedIpv4Host = [
      (high >> 8) & 255,
      high & 255,
      (low >> 8) & 255,
      low & 255,
    ].join(".");
    return isPrivateIpv4Host(mappedIpv4Host);
  }

  return (
    normalized === "::"
    || normalized === "::1"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || normalized.startsWith("fe8")
    || normalized.startsWith("fe9")
    || normalized.startsWith("fea")
    || normalized.startsWith("feb")
  );
}

function isPreviewOrDevelopmentDeployHostname(hostname: string): boolean {
  const labels = normalizeHostnameForProductionCheck(hostname).split(".");
  const labelsBeforeTld = labels.slice(0, -1);
  return labelsBeforeTld.some((label) =>
    label === "preview"
    || label === "dev"
    || label === "development"
    || label === "staging"
    || label.startsWith("preview-")
    || label.endsWith("-preview")
    || label.startsWith("dev-")
    || label.endsWith("-dev")
    || label.includes("-git-")
  );
}

function hasPreviewDeployMarker(value: string): boolean {
  return value
    .trim()
    .toLowerCase()
    .split(/[-_.]/u)
    .some((segment) => segment === "preview" || segment === "staging");
}
