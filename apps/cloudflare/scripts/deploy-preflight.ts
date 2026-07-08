import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import {
  HOSTED_AI_USAGE_ALLOWANCE_ACCEPTED_MODEL_IDS,
  isHostedAiUsageAllowancePricedModelId,
} from "@murphai/hosted-execution/runtime-control";
import {
  normalizeHostedExecutionBaseUrl,
} from "@murphai/hosted-execution/env";

import { HOSTED_WORKER_REQUIRED_SECRET_NAMES } from "./deploy-automation/secrets.ts";
import {
  HOSTED_WORKER_REQUIRED_VAR_NAMES,
} from "./deploy-automation/worker-optional-vars.ts";
import {
  normalizeOptionalString,
  readBooleanEnv,
} from "./deploy-automation/shared.ts";

type EnvSource = Readonly<Record<string, string | undefined>>;
type HostedDeployContext = "development" | "preview" | "production";
type ProductionDeployRequiredUrlLabel = (typeof PRODUCTION_DEPLOY_URL_INVARIANT_LABELS)[number];
type ProductionDeployOptionalUrlLabel = (typeof PRODUCTION_DEPLOY_OPTIONAL_CALLBACK_URL_LABELS)[number];
type ProductionDeployUrlLabel = ProductionDeployRequiredUrlLabel | ProductionDeployOptionalUrlLabel;
type HostnameAddressResolver = (hostname: string) => Promise<readonly string[]>;

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
const PRODUCTION_HOSTED_ASSISTANT_ROLLBACK_MODEL = "gpt-5.5";
const PRODUCTION_HOSTED_ASSISTANT_REASONING_EFFORT = "low";
const FUTURE_HOSTED_ASSISTANT_MODEL_CONTAINER_ROLLOUT = "immediate";
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
  ...HOSTED_WORKER_REQUIRED_VAR_NAMES,
] as const;

const REQUIRED_PRODUCTION_DEPLOY_WORKER_ENV_NAMES = [
  "HOSTED_WEB_PRODUCTION_BASE_URL",
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
  dependencies: {
    resolveHostnameAddresses?: HostnameAddressResolver;
  } = {},
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
  const hostedExecutionContainerRollout = normalizeOptionalString(
    source.HOSTED_EXECUTION_CONTAINER_ROLLOUT,
  ) ?? "gradual";
  const hostedAssistantModelIsPriced = hostedAssistantModel
    ? isHostedAiUsageAllowancePricedModelId(hostedAssistantModel)
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
  } else if (!hostedAssistantModelIsPriced) {
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

  if (
    hostedAssistantModelIsPriced
    && hostedAssistantModel
    && hostedAssistantModel !== PRODUCTION_HOSTED_ASSISTANT_ROLLBACK_MODEL
    && hostedExecutionContainerRollout
      !== FUTURE_HOSTED_ASSISTANT_MODEL_CONTAINER_ROLLOUT
  ) {
    errors.push(
      `production hosted assistant future-model deploys must set HOSTED_EXECUTION_CONTAINER_ROLLOUT=${FUTURE_HOSTED_ASSISTANT_MODEL_CONTAINER_ROLLOUT}; rollback floor is HOSTED_ASSISTANT_MODEL=${PRODUCTION_HOSTED_ASSISTANT_ROLLBACK_MODEL}.`,
    );
  }

  if (hostedCryptoEnv && hostedCryptoEnv !== "production") {
    errors.push("production deploys must set HOSTED_CRYPTO_ENV=production.");
  }

  if (oidcEnvironment && oidcEnvironment !== "production") {
    errors.push(
      "production deploys must set HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT=production.",
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

  const hostedWebBaseUrl = productionUrls.get("HOSTED_WEB_BASE_URL")?.normalized;
  const productionWebBaseUrl = productionUrls.get("HOSTED_WEB_PRODUCTION_BASE_URL")?.normalized;
  if (hostedWebBaseUrl && productionWebBaseUrl && hostedWebBaseUrl !== productionWebBaseUrl) {
    errors.push(
      "production deploys must set HOSTED_WEB_BASE_URL to HOSTED_WEB_PRODUCTION_BASE_URL.",
    );
  }

  return errors;
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
  dependencies: {
    resolveHostnameAddresses?: HostnameAddressResolver;
  } = {},
): Promise<string[]> {
  const errors = listHostedDeployEnvironmentInvariantErrors(source, input);

  if (!input.deployWorker) {
    return errors;
  }

  const deployContext = normalizeHostedDeployContext(source.HOSTED_EXECUTION_DEPLOY_CONTEXT);
  if (deployContext !== "production") {
    return errors;
  }

  const dnsErrors = await listProductionDeployDnsInvariantErrors(
    source,
    dependencies.resolveHostnameAddresses ?? resolveHostnameAddresses,
  );
  return [...errors, ...dnsErrors];
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
      await appendProductionDnsErrors(label, parsed.hostname, resolveHostnameAddresses, errors);
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
      await appendProductionDnsErrors(label, parsed.hostname, resolveHostnameAddresses, errors);
    }
  }

  return errors;
}

async function appendProductionDnsErrors(
  label: ProductionDeployUrlLabel,
  hostname: string,
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
    errors.push(`${label} must resolve to public DNS addresses in production deploys.`);
    return;
  }

  if (addresses.length === 0) {
    errors.push(`${label} must resolve to public DNS addresses in production deploys.`);
    return;
  }

  if (addresses.some((address) => readUnsafeProductionDeployHostnameReason(address))) {
    errors.push(`${label} must not resolve to private-network addresses in production deploys.`);
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
