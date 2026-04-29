import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import {
  normalizeHostedExecutionBaseUrl,
} from "@murphai/hosted-execution/env";

import { HOSTED_WORKER_REQUIRED_SECRET_NAMES } from "./deploy-automation/secrets.ts";
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
] as const;

const REQUIRED_PRODUCTION_DEPLOY_WORKER_ENV_NAMES = [
  "HOSTED_WEB_PRODUCTION_BASE_URL",
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

  if (deployContext !== "production") {
    return errors;
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
