import { createHash, createPrivateKey, createPublicKey, randomBytes } from "node:crypto";
import { lstat, readFile, readlink } from "node:fs/promises";
import path from "node:path";
import {
  cloudflareDir,
  cloudflareDevVarsPath,
  DEFAULT_DATABASE_URL,
  DEFAULT_STRIPE_ENV_FILE,
  HOSTED_WORKER_OPTIONAL_SECRET_NAMES,
  HOSTED_WORKER_REQUIRED_SECRET_NAMES,
  HOSTED_LOCAL_DEV_CRYPTO_STATE_FILE,
  HOSTED_LOCAL_PERSISTED_STATE_ENV_NAMES,
  HOSTED_LOCAL_R2_PRESIGN_ACCESS_KEY_ID,
  HOSTED_LOCAL_R2_PRESIGN_ACCOUNT_ID,
  HOSTED_LOCAL_R2_PRESIGN_BUCKET_NAME,
  HOSTED_LOCAL_R2_PRESIGN_SECRET_ACCESS_KEY,
  HOSTED_LOCAL_WORKTREE_SCOPE_ENV,
  HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV,
  HOSTED_RUNNER_LOCAL_BUILD_ID_ENV,
  repoRoot,
  USE_REMOTE_HOSTED_CRYPTO_KEYS_ENV,
  WRANGLER_LOCAL_ENV_FILE_ONLY_NAMES,
  WRANGLER_VAR_ALLOWLIST,
  webDir,
} from "./constants.ts";
import { assertNoDeprecatedHostedLocalCodexBridgeEnv } from "./config.ts";
import {
  createEcP256JwkPairJson,
  createEcP256SigningKeyJson,
  parsePrivateEcP256Jwk,
  type EcP256JwkPairJson,
  type EcP256SigningKeyJson,
  toPublicEcP256Jwk,
} from "./crypto.ts";
import type {
  HostedExecutionOidcIdentity,
  HostedLocalDevConfig,
} from "./types.ts";

const HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL_ENV =
  "HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL";
const HOSTED_LOCAL_KMS_API_ROOT = "local://murph-hosted-kms";
const HOSTED_LOCAL_WEB_WRAP_KEY_NAME =
  "projects/murph-local/locations/global/keyRings/hosted-local/cryptoKeys/web-wrap";
const HOSTED_LOCAL_AUTHORITY_SIGN_KEY_VERSION_PREFIX =
  "projects/murph-local/locations/global/keyRings/hosted-local/cryptoKeys/authority-sign/cryptoKeyVersions/local-";
const HOSTED_LOCAL_MAILBOX_FINGERPRINT_KEY =
  "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc";
const HOSTED_LOCAL_CONTACT_PRIVACY_KEY_VERSION = "v1";
const HOSTED_LOCAL_CONTACT_PRIVACY_KEYS =
  `${HOSTED_LOCAL_CONTACT_PRIVACY_KEY_VERSION}:${HOSTED_LOCAL_MAILBOX_FINGERPRINT_KEY}`;
const HOSTED_LOCAL_WORKER_NAME = "murph-hosted";
const HOSTED_LOCAL_E2E_WORKER_NAME_PREFIX = "murph-hosted-e2e";
const HOSTED_LOCAL_WORKTREE_WORKER_NAME_PREFIX = "murph-worktree";
const LEGACY_HOSTED_EXECUTION_CRYPTO_ENV_RE =
  /^HOSTED_EXECUTION_(?:PLATFORM_ENVELOPE|AUTOMATION_RECIPIENT|RECOVERY_RECIPIENT|TEE_AUTOMATION_RECIPIENT)(?:_|$)/u;

export async function resolveCloudflareLocalEnv(input: {
  config: HostedLocalDevConfig;
  oidcIdentity: HostedExecutionOidcIdentity;
  overrides?: Record<string, string | undefined>;
}): Promise<Record<string, string>> {
  const normalizedOverrides = normalizeOptionalEnvOverrides(input.overrides);
  const useRemoteHostedCryptoKeys =
    isHostedLocalTruthyEnvValue(normalizedOverrides[USE_REMOTE_HOSTED_CRYPTO_KEYS_ENV]);
  const originalContents = await readHostedLocalDevVarsText(cloudflareDevVarsPath);
  const existing = originalContents === null ? {} : parseEnvText(originalContents);
  if (!useRemoteHostedCryptoKeys) {
    stripHostedLocalGeneratedStateEnv(existing);
  }
  const persistentCryptoStatePath = resolveHostedLocalPersistentCryptoStatePath(
    normalizedOverrides,
  );
  const persistentCryptoStateText = persistentCryptoStatePath === null
    ? null
    : await tryReadTextFile(persistentCryptoStatePath);
  if (persistentCryptoStateText !== null) {
    Object.assign(existing, parseEnvText(persistentCryptoStateText));
  }

  return mergeCloudflareLocalEnv({
    config: input.config,
    existing,
    oidcIdentity: input.oidcIdentity,
    overrides: input.overrides,
  });
}

export function resolveHostedLocalPersistentCryptoStatePath(
  env: Readonly<Record<string, string | undefined>>,
): string | null {
  if (isHostedLocalE2eEnvironment(env)) {
    return null;
  }

  const configuredPath = normalizeOptionalString(
    env.MURPH_DEV_HOSTED_LOCAL_CRYPTO_STATE_PATH,
  );
  if (configuredPath) {
    return resolveHostedLocalTmpPath(
      configuredPath,
      "MURPH_DEV_HOSTED_LOCAL_CRYPTO_STATE_PATH",
    );
  }

  return path.join(repoRoot, HOSTED_LOCAL_DEV_CRYPTO_STATE_FILE);
}

function resolveHostedLocalTmpPath(value: string, envName: string): string {
  const tmpRoot = path.join(repoRoot, ".tmp");
  const resolved = path.resolve(repoRoot, value);
  const relative = path.relative(tmpRoot, resolved);

  if (
    relative.length === 0
    || relative === "."
    || relative.startsWith("..")
    || path.isAbsolute(relative)
  ) {
    throw new Error(`${envName} must resolve inside the repo-local .tmp directory.`);
  }

  return resolved;
}

export async function readHostedLocalDevVarsText(
  devVarsPath: string = cloudflareDevVarsPath,
): Promise<string | null> {
  const symlinkTarget = await tryReadSymlinkTarget(devVarsPath);
  if (symlinkTarget) {
    const resolvedTarget = path.resolve(path.dirname(devVarsPath), symlinkTarget);
    const interruptedStatePath = path.join(
      path.dirname(resolvedTarget),
      "hosted-local-state.dev.vars",
    );
    const interruptedStateText = await tryReadTextFile(interruptedStatePath);
    if (interruptedStateText !== null) {
      return interruptedStateText;
    }
  }

  return await tryReadTextFile(devVarsPath);
}

export async function loadHostedLocalBaseEnvironment(
  input: {
    source?: NodeJS.ProcessEnv;
  } = {},
): Promise<NodeJS.ProcessEnv> {
  const source = input.source ?? process.env;
  const [repoEnv, webEnv, webLocalEnv, stripeEnv] = await Promise.all([
    readOptionalSimpleEnvFile(path.join(repoRoot, ".env")),
    readOptionalSimpleEnvFile(path.join(webDir, ".env")),
    readOptionalSimpleEnvFile(path.join(webDir, ".env.local")),
    readHostedLocalStripeEnvFile(source),
  ]);

  return normalizeHostedLocalBaseEnvironment({
    ...repoEnv,
    ...webEnv,
    ...webLocalEnv,
    ...stripeEnv,
    ...source,
  });
}

export async function readHostedLocalStripeEnvFile(
  env: NodeJS.ProcessEnv,
): Promise<Record<string, string>> {
  const stripeEnvPath = resolveHostedLocalStripeEnvFilePath(env);
  if (stripeEnvPath === null) {
    return {};
  }

  return await readOptionalSimpleEnvFile(stripeEnvPath);
}

export function resolveHostedLocalStripeEnvFilePath(
  env: NodeJS.ProcessEnv,
  options: {
    root?: string;
  } = {},
): string | null {
  const root = options.root ?? repoRoot;
  const configuredPath = env.MURPH_DEV_STRIPE_ENV_FILE?.trim();

  if (
    configuredPath
    && ["0", "false", "off", "none"].includes(configuredPath.toLowerCase())
  ) {
    return null;
  }

  const candidate = configuredPath || DEFAULT_STRIPE_ENV_FILE;
  const resolved = path.resolve(root, candidate);
  const relative = path.relative(root, resolved);

  if (
    relative.length === 0
    || relative === "."
    || relative.startsWith("..")
    || path.isAbsolute(relative)
  ) {
    throw new Error("MURPH_DEV_STRIPE_ENV_FILE must resolve inside the repo.");
  }

  return resolved;
}

export function mergeCloudflareLocalEnv(input: {
  config: HostedLocalDevConfig;
  existing: Record<string, string>;
  oidcIdentity: HostedExecutionOidcIdentity;
  overrides?: Record<string, string | undefined>;
  createEnvelopeKey?: () => string;
  createJwkPair?: () => EcP256JwkPairJson;
  createSigningKey?: () => EcP256SigningKeyJson;
}): Record<string, string> {
  const createEnvelopeKey = input.createEnvelopeKey ?? (() => randomBytes(32).toString("base64"));
  const createJwkPair = input.createJwkPair ?? createEcP256JwkPairJson;
  const createSigningKey = input.createSigningKey ?? createEcP256SigningKeyJson;
  const normalizedOverrides = normalizeOptionalEnvOverrides(input.overrides);
  const resolvedExisting = {
    ...input.existing,
    ...normalizedOverrides,
  };
  delete resolvedExisting.HOSTED_APP_SESSION_HMAC_KEY;
  assertNoDeprecatedHostedLocalCodexBridgeEnv(input.existing);
  assertNoDeprecatedHostedLocalCodexBridgeEnv(normalizedOverrides);
  stripStaleHostedLocalOidcJwksOverride({
    env: resolvedExisting,
    overrides: normalizedOverrides,
  });
  stripStaleHostedLocalCodexModelProviderBaseUrlEnv({
    env: resolvedExisting,
    overrides: normalizedOverrides,
  });
  stripStaleHostedLocalInternalProxyEnv(resolvedExisting);

  assertLocalWorkerOidcEnvironment(resolvedExisting);

  const useRemoteHostedCryptoKeys =
    isHostedLocalTruthyEnvValue(normalizedOverrides[USE_REMOTE_HOSTED_CRYPTO_KEYS_ENV]);
  const hostedLocalKeySource = useRemoteHostedCryptoKeys
    ? resolvedExisting
    : resolveExistingHostedLocalKeySource(input.existing);
  const readHostedLocalKey = (key: string): string | null =>
    normalizeOptionalString(hostedLocalKeySource[key]);

  const cloudflareAutomationKeys =
    readHostedLocalKey("HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK")
      ? {
        privateJwkJson: readHostedLocalKey("HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK")!,
        publicJwkJson: JSON.stringify(toPublicEcP256Jwk(parsePrivateEcP256Jwk(
          readHostedLocalKey("HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK")!,
          "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK",
        ))),
      }
      : createJwkPair();
  const cloudflareAutomationKeyId =
    readHostedLocalKey("HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID")
    ?? "cloudflare-automation:local";
  const callbackSigningPrivateJwkJson =
    readHostedLocalKey("HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK")
    ?? createJwkPair().privateJwkJson;
  const callbackSigningKeyId =
    readHostedLocalKey("HOSTED_WEB_CALLBACK_SIGNING_KEY_ID")
    ?? "v1";
  const callbackSigningPublicJwkJson = JSON.stringify(
    toPublicEcP256Jwk(parsePrivateEcP256Jwk(callbackSigningPrivateJwkJson)),
  );
  const callbackSigningPublicKeyringJson = buildCallbackSigningPublicKeyringJson({
    currentKeyId: callbackSigningKeyId,
    currentPublicJwkJson: callbackSigningPublicJwkJson,
    existingKeyringJson: readHostedLocalKey("HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_KEYRING_JSON"),
  });
  const hostedDeviceRoutingIndexKey =
    readHostedLocalKey("HOSTED_DEVICE_ROUTING_INDEX_KEY") ?? createEnvelopeKey();
  const hostedLogFingerprintSecret =
    normalizeOptionalString(resolvedExisting.HOSTED_LOG_FINGERPRINT_SECRET)
    ?? createEnvelopeKey();
  const hostedProviderEgressCredentialSigningSecret =
    normalizeOptionalString(resolvedExisting.HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET)
    ?? createEnvelopeKey();
  const hostedPrivateMediaCapabilitySecret =
    normalizeOptionalString(resolvedExisting.HOSTED_PRIVATE_MEDIA_CAPABILITY_SECRET)
    ?? createEnvelopeKey();
  const webOrigin = `http://${input.config.webHost}:${input.config.webPort}`;
  const workerOrigin =
    `${input.config.workerProtocol}://${input.config.workerHost}:${input.config.workerPort}`;
  const authoritySigningKey = resolveHostedLocalAuthoritySigningKey({
    createSigningKey,
    readHostedLocalKey,
    useRemoteHostedCryptoKeys,
  });
  const authoritySignPublicKeyPem =
    authoritySigningKey.publicKeyPem
    ?? readRequiredRemoteHostedCryptoKey("HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM");
  const authoritySignKeyVersion =
    readHostedLocalKey("HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION")
    ?? readHostedLocalKey("HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION")
    ?? (useRemoteHostedCryptoKeys
      ? readRequiredRemoteHostedCryptoKey("HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION")
      : buildHostedLocalAuthoritySignKeyVersion(authoritySignPublicKeyPem));
  const authorityVerifyKeyringJson = buildHostedAuthorityVerifyKeyringJson({
    currentKeyVersionName: authoritySignKeyVersion,
    currentPublicKeyPem: authoritySignPublicKeyPem,
    existingKeyringJson: readHostedLocalKey("HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON"),
  });
  const hostedCryptoEnv =
    readHostedLocalKey("HOSTED_CRYPTO_ENV") ?? (useRemoteHostedCryptoKeys ? "development" : "local");
  const gcpKmsApiRoot =
    readHostedLocalKey("HOSTED_CRYPTO_GCP_KMS_API_ROOT")
    ?? (useRemoteHostedCryptoKeys ? null : HOSTED_LOCAL_KMS_API_ROOT);
  const webWrapKmsKeyName =
    readHostedLocalKey("HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME")
    ?? (useRemoteHostedCryptoKeys
      ? readRequiredRemoteHostedCryptoKey("HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME")
      : HOSTED_LOCAL_WEB_WRAP_KEY_NAME);
  const localKmsWrapKey =
    readHostedLocalKey("HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY")
    ?? (useRemoteHostedCryptoKeys ? null : createEnvelopeKey());
  const hostedLocalR2PresignEnv = resolveHostedLocalR2PresignEnvironment(resolvedExisting);
  stripLegacyHostedCryptoAuthorityEnv(resolvedExisting);
  if (!useRemoteHostedCryptoKeys) {
    stripHostedLocalGeneratedStateEnv(resolvedExisting);
  }

  return {
    ...resolvedExisting,
    HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION: authoritySignKeyVersion,
    HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM: authoritySignPublicKeyPem,
    HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON: authorityVerifyKeyringJson,
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: cloudflareAutomationKeyId,
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK:
      cloudflareAutomationKeys.privateJwkJson,
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_JWK:
      cloudflareAutomationKeys.publicJwkJson,
    HOSTED_CRYPTO_ENV: hostedCryptoEnv,
    HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION: authoritySignKeyVersion,
    HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM: authoritySignPublicKeyPem,
    ...(gcpKmsApiRoot ? { HOSTED_CRYPTO_GCP_KMS_API_ROOT: gcpKmsApiRoot } : {}),
    HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME: webWrapKmsKeyName,
    ...(authoritySigningKey.privateJwkJson
      ? { HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK: authoritySigningKey.privateJwkJson }
      : {}),
    ...(localKmsWrapKey ? { HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY: localKmsWrapKey } : {}),
    ...hostedLocalR2PresignEnv,
    HOSTED_DEVICE_ROUTING_INDEX_KEY: hostedDeviceRoutingIndexKey,
    HOSTED_LOG_FINGERPRINT_SECRET: hostedLogFingerprintSecret,
    HOSTED_PRIVATE_MEDIA_CAPABILITY_SECRET: hostedPrivateMediaCapabilitySecret,
    HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
      hostedProviderEgressCredentialSigningSecret,
    HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG: input.oidcIdentity.teamSlug,
    HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME: input.oidcIdentity.projectName,
    HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT: input.oidcIdentity.environment,
    ...(normalizedOverrides.HOSTED_EXECUTION_RUNNER_HOST_ALIAS?.trim()
      ? {
          HOSTED_EXECUTION_RUNNER_HOST_ALIAS:
            normalizedOverrides.HOSTED_EXECUTION_RUNNER_HOST_ALIAS.trim(),
        }
      : {}),
    HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: callbackSigningPrivateJwkJson,
    HOSTED_WEB_CALLBACK_SIGNING_KEY_ID: callbackSigningKeyId,
    HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_KEYRING_JSON: callbackSigningPublicKeyringJson,
    HOSTED_WEB_BASE_URL: webOrigin,
  };

  function readRequiredRemoteHostedCryptoKey(key: string): string {
    const value = readHostedLocalKey(key);
    if (!value) {
      throw new Error(
        `${key} must be configured when ${USE_REMOTE_HOSTED_CRYPTO_KEYS_ENV}=1.`,
      );
    }
    return value;
  }
}

function resolveHostedLocalR2PresignEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const testRoutesEnabled = usesWranglerLocalDevTestRoutes(env);
  const allowLocalEndpoint = normalizeOptionalString(env.HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT);
  const controlEndpoint = normalizeOptionalString(env.HOSTED_R2_PRESIGN_CONTROL_ENDPOINT);
  const dockerBridgeHost = normalizeOptionalString(env.MURPH_HOSTED_LOCAL_R2_DOCKER_BRIDGE_HOST);
  const endpoint = normalizeOptionalString(env.HOSTED_R2_PRESIGN_ENDPOINT);
  const localPresignConfigured = Boolean(
    allowLocalEndpoint
      || controlEndpoint
      || dockerBridgeHost
      || endpoint,
  );
  if (
    !testRoutesEnabled
    && !isHostedLocalE2eEnvironment(env)
    && !(isHostedLocalDevProfile(env) && localPresignConfigured)
    && !(isHostedLocalWorktreeEnvironment(env) && localPresignConfigured)
  ) {
    return {};
  }

  return {
    HOSTED_R2_PRESIGN_ACCESS_KEY_ID:
      normalizeOptionalString(env.HOSTED_R2_PRESIGN_ACCESS_KEY_ID)
      ?? HOSTED_LOCAL_R2_PRESIGN_ACCESS_KEY_ID,
    HOSTED_R2_PRESIGN_ACCOUNT_ID:
      normalizeOptionalString(env.HOSTED_R2_PRESIGN_ACCOUNT_ID)
      ?? HOSTED_LOCAL_R2_PRESIGN_ACCOUNT_ID,
    ...(allowLocalEndpoint ? { HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT: allowLocalEndpoint } : {}),
    HOSTED_R2_PRESIGN_BUCKET_NAME:
      normalizeOptionalString(env.HOSTED_R2_PRESIGN_BUCKET_NAME)
      ?? HOSTED_LOCAL_R2_PRESIGN_BUCKET_NAME,
    ...(controlEndpoint ? { HOSTED_R2_PRESIGN_CONTROL_ENDPOINT: controlEndpoint } : {}),
    ...(endpoint ? { HOSTED_R2_PRESIGN_ENDPOINT: endpoint } : {}),
    ...(dockerBridgeHost ? { MURPH_HOSTED_LOCAL_R2_DOCKER_BRIDGE_HOST: dockerBridgeHost } : {}),
    HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY:
      normalizeOptionalString(env.HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY)
      ?? HOSTED_LOCAL_R2_PRESIGN_SECRET_ACCESS_KEY,
  };
}

function resolveHostedLocalAuthoritySigningKey(input: {
  createSigningKey: () => EcP256SigningKeyJson;
  readHostedLocalKey: (key: string) => string | null;
  useRemoteHostedCryptoKeys: boolean;
}): { privateJwkJson: string | null; publicKeyPem: string | null } {
  const existingPrivateJwk = input.readHostedLocalKey(
    "HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK",
  );
  const existingPublicPem =
    input.readHostedLocalKey("HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM")
    ?? input.readHostedLocalKey("HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM");

  if (
    existingPrivateJwk
    && existingPublicPem
  ) {
    if (
      input.useRemoteHostedCryptoKeys
      || hostedLocalAuthoritySigningPairMatches({
        privateJwkJson: existingPrivateJwk,
        publicKeyPem: existingPublicPem,
      })
    ) {
      return {
        privateJwkJson: existingPrivateJwk,
        publicKeyPem: existingPublicPem,
      };
    }

    throw new Error(
      "Persisted local hosted crypto authority state is inconsistent. Restore the local crypto state file, or reset the local hosted database and crypto state together.",
    );
  }

  if (!input.useRemoteHostedCryptoKeys && (existingPrivateJwk || existingPublicPem)) {
    throw new Error(
      "Persisted local hosted crypto authority state is incomplete. Restore the local crypto state file, or reset the local hosted database and crypto state together.",
    );
  }

  if (input.useRemoteHostedCryptoKeys) {
    return {
      privateJwkJson: existingPrivateJwk,
      publicKeyPem: existingPublicPem,
    };
  }

  return input.createSigningKey();
}

function hostedLocalAuthoritySigningPairMatches(input: {
  privateJwkJson: string;
  publicKeyPem: string;
}): boolean {
  try {
    const privateJwk = parsePrivateEcP256Jwk(
      input.privateJwkJson,
      "HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK",
    );
    const privateKey = createPrivateKey({
      format: "jwk",
      key: {
        crv: privateJwk.crv,
        d: privateJwk.d,
        kty: privateJwk.kty,
        x: privateJwk.x,
        y: privateJwk.y,
      } satisfies JsonWebKey,
    });
    const derivedPublicPem = createPublicKey(privateKey)
      .export({ format: "pem", type: "spki" })
      .toString();

    return normalizePublicKeyPem(derivedPublicPem) === normalizePublicKeyPem(input.publicKeyPem);
  } catch {
    return false;
  }
}

function normalizePublicKeyPem(value: string): string {
  return value.replace(/\\n/g, "\n").trim();
}

function buildHostedLocalAuthoritySignKeyVersion(publicKeyPem: string): string {
  const publicKeyFingerprint = createHash("sha256")
    .update(normalizePublicKeyPem(publicKeyPem))
    .digest("hex")
    .slice(0, 16);
  return `${HOSTED_LOCAL_AUTHORITY_SIGN_KEY_VERSION_PREFIX}${publicKeyFingerprint}`;
}

function buildHostedAuthorityVerifyKeyringJson(input: {
  currentKeyVersionName: string;
  currentPublicKeyPem: string;
  existingKeyringJson: string | null;
}): string {
  const keyring = parseOptionalJsonObject(input.existingKeyringJson) ?? {};
  for (const [keyVersionName, entry] of Object.entries(keyring)) {
    if (
      keyVersionName !== input.currentKeyVersionName
      && isJsonRecord(entry)
      && entry.status === "active"
    ) {
      entry.status = "verify_only";
    }
  }

  keyring[input.currentKeyVersionName] = {
    publicKeyPem: normalizePublicKeyPem(input.currentPublicKeyPem),
    status: "active",
  };
  return JSON.stringify(keyring);
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function resolveExistingHostedLocalKeySource(source: Record<string, string>): Record<string, string> {
  return isPersistedHostedLocalGeneratedCryptoState(source) ? source : {};
}

function isPersistedHostedLocalGeneratedCryptoState(source: Record<string, string | undefined>): boolean {
  const hostedCryptoEnv = normalizeOptionalString(source.HOSTED_CRYPTO_ENV)?.toLowerCase();
  return hostedCryptoEnv === "local";
}

function stripHostedLocalGeneratedStateEnv(env: Record<string, string | undefined>): void {
  for (const key of Object.keys(env)) {
    if (
      key.startsWith("HOSTED_CRYPTO_")
      || key.startsWith("HOSTED_WEB_CALLBACK_SIGNING_")
      || key.startsWith("HOSTED_WEB_ENCRYPTION_")
      || key.startsWith("HOSTED_WAKE_ENCRYPTION_")
      || LEGACY_HOSTED_EXECUTION_CRYPTO_ENV_RE.test(key)
    ) {
      delete env[key];
    }
  }
}

export function isHostedLocalTruthyEnvValue(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized !== undefined && ["1", "true", "yes", "on"].includes(normalized);
}

function isHostedLocalE2eEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const profile = normalizeOptionalString(env.MURPH_HOSTED_LOCAL_PROFILE);
  return env.MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED === "1"
    || profile === "e2e:stub"
    || profile === "e2e:live";
}

function isHostedLocalDevProfile(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const profile = normalizeOptionalString(env.MURPH_HOSTED_LOCAL_PROFILE);
  return profile === "dev" || profile === "worker-only";
}

function isHostedLocalWorktreeEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return normalizeOptionalString(env[HOSTED_LOCAL_WORKTREE_SCOPE_ENV]) !== null;
}

function buildCallbackSigningPublicKeyringJson(input: {
  currentKeyId: string;
  currentPublicJwkJson: string;
  existingKeyringJson: string | null;
}): string {
  const keyring = parseOptionalJsonObject(input.existingKeyringJson) ?? {};
  keyring[input.currentKeyId] = JSON.parse(input.currentPublicJwkJson);
  return JSON.stringify(keyring);
}

function parseOptionalJsonObject(value: string | null): Record<string, unknown> | null {
  if (!value) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function normalizeOptionalEnvOverrides(
  input: Record<string, string | undefined> | undefined,
): Record<string, string> {
  if (!input) {
    return {};
  }

  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== "string") {
      continue;
    }

    values[key] = value;
  }

  return values;
}

function stripLegacyHostedCryptoAuthorityEnv(
  env: Record<string, string | undefined>,
): void {
  for (const key of Object.keys(env)) {
    if (LEGACY_HOSTED_EXECUTION_CRYPTO_ENV_RE.test(key)) {
      delete env[key];
    }
  }
}

function stripStaleHostedLocalCodexModelProviderBaseUrlEnv(input: {
  env: Record<string, string | undefined>;
  overrides: Record<string, string | undefined>;
}): void {
  if (input.overrides[HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV]?.trim()) {
    return;
  }

  delete input.env[HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV];
}

function stripStaleHostedLocalOidcJwksOverride(input: {
  env: Record<string, string | undefined>;
  overrides: Record<string, string | undefined>;
}): void {
  if (input.overrides[HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL_ENV]?.trim()) {
    return;
  }

  delete input.env[HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL_ENV];
}

function stripStaleHostedLocalInternalProxyEnv(
  env: Record<string, string | undefined>,
): void {
  delete env.HOSTED_EXECUTION_INTERNAL_PROXY_UPSTREAM_BASE_URL;
  delete env.HOSTED_EXECUTION_LOCAL_LOOPBACK_PROXY_TOKEN;
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

function normalizeHostedLocalBaseEnvironment(
  input: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  assertNoDeprecatedHostedLocalCodexBridgeEnv(input);
  const environment = {
    ...input,
  };
  stripLegacyHostedCryptoAuthorityEnv(environment);
  return environment;
}

export function buildHostedLocalDevOverrides(
  config: HostedLocalDevConfig,
  cloudflareDevVars: Record<string, string>,
  input: {
    retellWebhookPublicBaseUrl?: string | null;
  } = {},
): NodeJS.ProcessEnv {
  const webOrigin = `http://${config.webHost}:${config.webPort}`;
  const deviceSyncPublicBaseUrl = `${webOrigin}/api/device-sync`;
  const retellWebhookPublicBaseUrl =
    normalizeOptionalString(input.retellWebhookPublicBaseUrl);
  const workerBaseUrl =
    `${config.workerProtocol}://${resolveHostedLocalClientWorkerHost(config.workerHost)}:${config.workerPort}`;
  const callbackPrivateJwkJson = cloudflareDevVars.HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK;
  const callbackKeyId = cloudflareDevVars.HOSTED_WEB_CALLBACK_SIGNING_KEY_ID?.trim();
  const cloudflareAutomationPrivateJwkJson =
    cloudflareDevVars.HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK?.trim();
  const cryptoAuthoritySignKeyVersion =
    cloudflareDevVars.HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION?.trim();
  const cryptoAuthoritySignPublicKeyPem =
    cloudflareDevVars.HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM?.trim();
  const cloudflareAutomationKeyId =
    cloudflareDevVars.HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID?.trim();
  const hostedCryptoEnv = cloudflareDevVars.HOSTED_CRYPTO_ENV?.trim();
  const callbackPublicJwkJson = callbackPrivateJwkJson
    ? JSON.stringify(toPublicEcP256Jwk(parsePrivateEcP256Jwk(callbackPrivateJwkJson)))
    : null;
  const callbackPublicKeyringJson =
    callbackPublicJwkJson && callbackKeyId
      ? buildCallbackSigningPublicKeyringJson({
        currentKeyId: callbackKeyId,
        currentPublicJwkJson: callbackPublicJwkJson,
        existingKeyringJson:
          cloudflareDevVars.HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_KEYRING_JSON?.trim()
          ?? null,
      })
      : null;

  return {
    DEVICE_SYNC_PUBLIC_BASE_URL: deviceSyncPublicBaseUrl,
    HOSTED_EXECUTION_CONTROL_URL: workerBaseUrl,
    HOSTED_EXECUTION_DISPATCH_URL: workerBaseUrl,
    HOSTED_ONBOARDING_PUBLIC_BASE_URL: webOrigin,
    ...(retellWebhookPublicBaseUrl
      ? { RETELL_WEBHOOK_PUBLIC_BASE_URL: retellWebhookPublicBaseUrl }
      : {}),
    ...copyNonEmptyEnv(cloudflareDevVars, "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID"),
    ...copyNonEmptyEnv(cloudflareDevVars, "HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON"),
    ...copyNonEmptyEnv(cloudflareDevVars, "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_JWK"),
    ...copyNonEmptyEnv(cloudflareDevVars, "HOSTED_CRYPTO_ENV"),
    ...copyNonEmptyEnv(cloudflareDevVars, "HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION"),
    ...copyNonEmptyEnv(cloudflareDevVars, "HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM"),
    ...copyNonEmptyEnv(cloudflareDevVars, "HOSTED_CRYPTO_GCP_KMS_API_ROOT"),
    ...copyNonEmptyEnv(cloudflareDevVars, "HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME"),
    ...copyNonEmptyEnv(cloudflareDevVars, "HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK"),
    ...copyNonEmptyEnv(cloudflareDevVars, "HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY"),
    ...copyNonEmptyEnv(cloudflareDevVars, "HOSTED_DEVICE_ROUTING_INDEX_KEY"),
    ...resolveHostedLocalContactPrivacyEnv(cloudflareDevVars),
    HOSTED_MAILBOX_FINGERPRINT_KEY:
      cloudflareDevVars.HOSTED_MAILBOX_FINGERPRINT_KEY?.trim()
      || HOSTED_LOCAL_MAILBOX_FINGERPRINT_KEY,
    HOSTED_WEB_BASE_URL: webOrigin,
    ...(!cloudflareDevVars.HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_JWK?.trim()
      && cloudflareAutomationPrivateJwkJson
      ? {
        HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_JWK: JSON.stringify(
          toPublicEcP256Jwk(parsePrivateEcP256Jwk(
            cloudflareAutomationPrivateJwkJson,
            "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK",
          )),
        ),
      }
      : {}),
    ...(cloudflareAutomationKeyId ? { HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: cloudflareAutomationKeyId } : {}),
    ...(cryptoAuthoritySignKeyVersion ? { HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION: cryptoAuthoritySignKeyVersion } : {}),
    ...(cryptoAuthoritySignPublicKeyPem ? { HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM: cryptoAuthoritySignPublicKeyPem } : {}),
    ...(hostedCryptoEnv ? { HOSTED_CRYPTO_ENV: hostedCryptoEnv } : {}),
    ...(callbackPublicJwkJson ? { HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_JWK: callbackPublicJwkJson } : {}),
    ...(callbackPublicKeyringJson
      ? { HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_KEYRING_JSON: callbackPublicKeyringJson }
      : {}),
    ...(callbackKeyId ? { HOSTED_WEB_CALLBACK_SIGNING_KEY_ID: callbackKeyId } : {}),
    VERCEL_PROJECT_PRODUCTION_URL: `${config.webHost}:${config.webPort}`,
  };
}

function copyNonEmptyEnv(source: Record<string, string>, key: string): NodeJS.ProcessEnv {
  const value = source[key]?.trim();
  return value ? { [key]: value } : {};
}

function resolveHostedLocalContactPrivacyEnv(source: Record<string, string>): NodeJS.ProcessEnv {
  const keys = source.HOSTED_CONTACT_PRIVACY_KEYS?.trim();
  const currentVersion = source.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION?.trim();

  if (keys && currentVersion && isValidHostedLocalContactPrivacyKeyring(keys, currentVersion)) {
    return {
      HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION: currentVersion,
      HOSTED_CONTACT_PRIVACY_KEYS: keys,
    };
  }

  return {
    HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION: HOSTED_LOCAL_CONTACT_PRIVACY_KEY_VERSION,
    HOSTED_CONTACT_PRIVACY_KEYS: HOSTED_LOCAL_CONTACT_PRIVACY_KEYS,
  };
}

function isValidHostedLocalContactPrivacyKeyring(
  keys: string,
  currentVersion: string,
): boolean {
  const entries = keys
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (entries.length === 0) {
    return false;
  }

  let hasCurrentVersion = false;
  for (const entry of entries) {
    const separatorIndex = entry.indexOf(":");
    if (separatorIndex < 1 || separatorIndex === entry.length - 1) {
      return false;
    }

    const version = entry.slice(0, separatorIndex).trim();
    const value = entry.slice(separatorIndex + 1).trim();
    hasCurrentVersion ||= version === currentVersion;

    if (!/^v[0-9]+$/u.test(version) || !hostedLocalContactPrivacyKeyDecodesTo32Bytes(value)) {
      return false;
    }
  }

  return hasCurrentVersion;
}

function hostedLocalContactPrivacyKeyDecodesTo32Bytes(value: string): boolean {
  const normalized = value.trim();

  if (/^[0-9a-f]{64}$/iu.test(normalized)) {
    return true;
  }

  const base64 = normalized.replace(/-/gu, "+").replace(/_/gu, "/");
  const remainder = base64.length % 4;
  const padded = remainder === 0 ? base64 : base64.padEnd(base64.length + (4 - remainder), "=");

  if (
    padded.length === 0
    || padded.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(padded)
  ) {
    return false;
  }

  const decoded = Buffer.from(padded, "base64");

  return decoded.length === 32 && decoded.toString("base64") === padded;
}

export function resolveHostedLocalClientWorkerHost(workerHost: string): string {
  const normalized = workerHost.trim().toLowerCase();

  if (normalized === "0.0.0.0") {
    return "127.0.0.1";
  }

  if (normalized === "::" || normalized === "::1") {
    return "[::1]";
  }

  return workerHost;
}

export function normalizeLocalDatabaseUrl(
  value: string | undefined,
  fallbackUrl: string = DEFAULT_DATABASE_URL,
): string {
  const normalized = value?.trim();

  if (!normalized) {
    return fallbackUrl;
  }

  let parsed: URL;
  let fallback: URL;
  try {
    parsed = new URL(normalized);
    fallback = new URL(fallbackUrl);
  } catch {
    return normalized;
  }

  if (!isPostgresProtocol(parsed.protocol) || !isLoopbackHost(parsed.hostname)) {
    return normalized;
  }

  if (hasExplicitDatabaseName(parsed.pathname) || !hasExplicitDatabaseName(fallback.pathname)) {
    return normalized;
  }

  parsed.pathname = fallback.pathname;
  return parsed.toString();
}

export function resolveHostedLocalDatabaseUrl(input: {
  databaseUrlOverride?: string | null;
  fallbackUrl?: string;
  pulledDatabaseUrl?: string;
  repoDatabaseUrl?: string;
  shellDatabaseUrl?: string;
  useVercelDatabaseUrl?: boolean;
}): string {
  const fallbackUrl = input.fallbackUrl ?? DEFAULT_DATABASE_URL;
  const explicitOverride = normalizeOptionalString(input.databaseUrlOverride);
  if (explicitOverride) {
    return normalizeLocalDatabaseUrl(explicitOverride, fallbackUrl);
  }

  const shellDatabaseUrl = normalizeOptionalString(input.shellDatabaseUrl);
  if (shellDatabaseUrl) {
    return normalizeLocalDatabaseUrl(shellDatabaseUrl, fallbackUrl);
  }

  if (input.useVercelDatabaseUrl === true) {
    const vercelDatabaseUrl = normalizeOptionalString(input.pulledDatabaseUrl)
      ?? normalizeOptionalString(input.repoDatabaseUrl)
      ?? undefined;
    return normalizeLocalDatabaseUrl(
      vercelDatabaseUrl,
      fallbackUrl,
    );
  }

  const repoDatabaseUrl = normalizeOptionalString(input.repoDatabaseUrl);
  if (repoDatabaseUrl && shouldSyncLocalDatabaseSchema(repoDatabaseUrl)) {
    return normalizeLocalDatabaseUrl(repoDatabaseUrl, fallbackUrl);
  }

  return normalizeLocalDatabaseUrl(undefined, fallbackUrl);
}

export function shouldSyncLocalDatabaseSchema(value: string | undefined): boolean {
  return isLoopbackPostgresUrl(normalizeLocalDatabaseUrl(value));
}

export function buildWranglerVarArgs(
  cloudflareDevVars: Readonly<Record<string, string | undefined>>,
): string[] {
  const args: string[] = [];

  for (const key of new Set(WRANGLER_VAR_ALLOWLIST)) {
    const value = cloudflareDevVars[key];

    if (!value?.trim()) {
      continue;
    }

    args.push("--var", `${key}:${value}`);
  }

  return args;
}

export function buildWranglerEnvFileText(
  source: Readonly<Record<string, string | undefined>>,
): string {
  const entries = new Map<string, string>();

  for (const key of [
    ...HOSTED_WORKER_REQUIRED_SECRET_NAMES,
    ...HOSTED_WORKER_OPTIONAL_SECRET_NAMES,
    ...WRANGLER_LOCAL_ENV_FILE_ONLY_NAMES,
    ...WRANGLER_VAR_ALLOWLIST,
  ]) {
    const value = resolveWranglerEnvValue(key, source);

    if (!value) {
      continue;
    }

    entries.set(key, value);
  }

  return [...entries.entries()]
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join("\n");
}

export function buildHostedLocalStateEnvFileText(
  source: Readonly<Record<string, string | undefined>>,
): string {
  const entries = new Map<string, string>();
  const shouldPersistGeneratedCryptoState =
    isPersistedHostedLocalGeneratedCryptoState(source);
  for (const key of HOSTED_LOCAL_PERSISTED_STATE_ENV_NAMES) {
    if (
      !shouldPersistGeneratedCryptoState
      && (
        key.startsWith("HOSTED_CRYPTO_")
        || key === "HOSTED_LOG_FINGERPRINT_SECRET"
        || key === "HOSTED_PRIVATE_MEDIA_CAPABILITY_SECRET"
        || key === "HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET"
        || key.startsWith("HOSTED_WEB_CALLBACK_SIGNING_")
      )
    ) {
      continue;
    }
    const value = source[key]?.trim();
    if (!value) {
      continue;
    }

    entries.set(key, value);
  }

  return [...entries.entries()]
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join("\n");
}

export function buildWranglerLocalDevConfig(
  source: Readonly<Record<string, string | undefined>>,
  options: {
    configDir?: string;
    cloudflareAppDir?: string;
    workspaceRoot?: string;
  } = {},
): Record<string, unknown> {
  const cloudflareAppDir = options.cloudflareAppDir ?? cloudflareDir;
  const workspaceRoot = options.workspaceRoot ?? repoRoot;
  const configDir = options.configDir ?? path.join(cloudflareAppDir, ".wrangler");
  const hostedRunnerLocalBuildId =
    buildHostedRunnerLocalBuildId(source[HOSTED_RUNNER_LOCAL_BUILD_ID_ENV]);
  const workerName = resolveWranglerLocalDevWorkerName(source);
  const vars: Record<string, string> = {
    HOSTED_EXECUTION_MAX_EVENT_ATTEMPTS: resolveWranglerEnvValue("HOSTED_EXECUTION_MAX_EVENT_ATTEMPTS", source) ?? "3",
    HOSTED_EXECUTION_RETRY_DELAY_MS: resolveWranglerEnvValue("HOSTED_EXECUTION_RETRY_DELAY_MS", source) ?? "30000",
    HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: resolveWranglerEnvValue("HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS", source) ?? "45000",
    // Local Cloudflare container cold starts are materially slower than the hosted runtime.
    HOSTED_EXECUTION_RUNNER_READY_TIMEOUT_MS: resolveWranglerEnvValue("HOSTED_EXECUTION_RUNNER_READY_TIMEOUT_MS", source) ?? "60000",
    HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT: resolveWranglerEnvValue("HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT", source) ?? "development",
  };

  for (const key of new Set(WRANGLER_VAR_ALLOWLIST)) {
    const value = resolveWranglerEnvValue(key, source);
    if (value) {
      vars[key] = value;
    }
  }

  const requiredSecrets = [...new Set([
    ...HOSTED_WORKER_REQUIRED_SECRET_NAMES,
    ...HOSTED_WORKER_OPTIONAL_SECRET_NAMES.filter((key) => Boolean(resolveWranglerEnvValue(key, source))),
    ...WRANGLER_LOCAL_ENV_FILE_ONLY_NAMES.filter((key) => Boolean(resolveWranglerEnvValue(key, source))),
  ])];
  const runnerContainerImage = toWranglerConfigRelativePath(
    configDir,
    path.join(workspaceRoot, "Dockerfile.cloudflare-hosted-runner"),
  );
  const runnerContainerImageBuildContext = toWranglerConfigRelativePath(configDir, cloudflareAppDir);
  const buildRunnerContainerConfig = (input: {
    className: string;
    maxInstances: number;
  }): Record<string, unknown> => ({
    class_name: input.className,
    image: runnerContainerImage,
    image_build_context: runnerContainerImageBuildContext,
    image_vars: {
      // The per-class build arg keeps the two class images' Docker image IDs
      // distinct. Without it, wrangler dev's duplicate-tag cleanup
      // (`cleanupDuplicateImageTags`) untags the runner image right after the
      // deploy-smoke image build (both tags point at one image ID), and hosted
      // cold starts then fail with "No such image available named
      // cloudflare-dev/runnercontainer:<tag>" until the harness times out.
      HOSTED_RUNNER_CONTAINER_CLASS: input.className,
      HOSTED_RUNNER_LOCAL_BUILD_ID: hostedRunnerLocalBuildId,
    },
    instance_type: "standard-1",
    max_instances: input.maxInstances,
  });

  return {
    name: workerName,
    main: toWranglerConfigRelativePath(
      configDir,
      path.join(cloudflareAppDir, "src", resolveWranglerLocalDevWorkerEntrypoint(source)),
    ),
    compatibility_date: "2026-03-27",
    compatibility_flags: ["nodejs_compat"],
    containers: [
      buildRunnerContainerConfig({ className: "RunnerContainer", maxInstances: 50 }),
      buildRunnerContainerConfig({ className: "DeploySmokeRunnerContainer", maxInstances: 1 }),
    ],
    durable_objects: {
      bindings: [
        {
          name: "USER_RUNNER",
          class_name: "UserRunnerDurableObject",
        },
        {
          name: "DATABASE_HEALTH_MONITOR",
          class_name: "DatabaseHealthDurableObject",
        },
        {
          name: "RUNNER_CONTAINER",
          class_name: "RunnerContainer",
        },
        {
          name: "RUNNER_CONTAINER_SMOKE",
          class_name: "DeploySmokeRunnerContainer",
        },
      ],
    },
    migrations: [
      {
        tag: "v1",
        new_sqlite_classes: ["UserRunnerDurableObject"],
      },
      {
        tag: "v2",
        new_sqlite_classes: ["RunnerContainer"],
      },
      {
        tag: "v3",
        new_sqlite_classes: ["DeploySmokeRunnerContainer"],
      },
      {
        tag: "v4",
        new_sqlite_classes: ["DatabaseHealthDurableObject"],
      },
    ],
    triggers: {
      crons: ["*/5 * * * *"],
    },
    r2_buckets: [
      {
        binding: "BUNDLES",
        bucket_name: "murph-hosted-bundles",
        preview_bucket_name: "murph-hosted-bundles-preview",
      },
    ],
    analytics_engine_datasets: [
      {
        binding: "HOSTED_RUNTIME_RETRY_ANALYTICS",
        dataset: "murph_hosted_runtime_retries",
      },
    ],
    // Wrangler proxies the Workers AI binding through a remote session. The
    // Cloudflare dev wrapper strips CLOUDFLARE_API_TOKEN from the final
    // `wrangler dev` child when this binding is active, so local dev uses
    // `wrangler login` OAuth and would call live Workers AI. Hosted-local test
    // routes must keep `env.AI` unset so the deterministic fake binding in
    // apps/cloudflare/src/hosted-local-test/runner-container.ts composes, and
    // MURPH_DEV_SKIP_WORKERS_AI=1 lets unauthenticated dev stacks start with
    // hosted transcription failing closed at use time instead of `wrangler
    // dev` failing at startup.
    ...(includesWranglerLocalDevAiBinding(source) ? { ai: { binding: "AI" } } : {}),
    send_email: [
      {
        name: "HOSTED_EMAIL",
      },
    ],
    version_metadata: {
      binding: "CF_VERSION_METADATA",
    },
    observability: {
      enabled: true,
      head_sampling_rate: 1,
      logs: {
        enabled: true,
        invocation_logs: true,
        persist: true,
        head_sampling_rate: 1,
      },
      traces: {
        enabled: true,
        persist: true,
        head_sampling_rate: 1,
      },
    },
    secrets: {
      required: requiredSecrets,
    },
    vars,
  };
}

export function usesWranglerLocalDevTestRoutes(
  source: Readonly<Record<string, string | undefined>>,
): boolean {
  return source.NODE_ENV === "test" && source.MURPH_HOSTED_LOCAL_TEST_ROUTES === "1";
}

export function includesWranglerLocalDevAiBinding(
  source: Readonly<Record<string, string | undefined>>,
): boolean {
  return !usesWranglerLocalDevTestRoutes(source)
    && source.MURPH_DEV_SKIP_WORKERS_AI !== "1";
}

function resolveWranglerLocalDevWorkerEntrypoint(
  source: Readonly<Record<string, string | undefined>>,
): string {
  return usesWranglerLocalDevTestRoutes(source)
    ? "hosted-local-test-index.ts"
    : "index.ts";
}

export function resolveWranglerLocalDevWorkerName(
  source: Readonly<Record<string, string | undefined>>,
): string {
  if (!requiresIsolatedWranglerLocalDevWorkerName(source)) {
    return HOSTED_LOCAL_WORKER_NAME;
  }

  const localBuildId = buildHostedRunnerLocalBuildId(source[HOSTED_RUNNER_LOCAL_BUILD_ID_ENV]);
  const suffix = localBuildId.replace(/^sha256-/u, "");
  const prefix = isHostedLocalWorktreeEnvironment(source)
    ? HOSTED_LOCAL_WORKTREE_WORKER_NAME_PREFIX
    : HOSTED_LOCAL_E2E_WORKER_NAME_PREFIX;
  return `${prefix}-${suffix}`;
}

function requiresIsolatedWranglerLocalDevWorkerName(
  source: Readonly<Record<string, string | undefined>>,
): boolean {
  const profile = normalizeOptionalString(source.MURPH_HOSTED_LOCAL_PROFILE);
  return source.MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED === "1"
    || profile === "e2e:stub"
    || profile === "e2e:live"
    || isHostedLocalWorktreeEnvironment(source);
}

export function buildHostedRunnerLocalBuildId(value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) {
    return "local";
  }

  if (/^sha256-[a-f0-9]{24}$/u.test(normalized)) {
    return normalized;
  }

  return `sha256-${createHash("sha256").update(normalized).digest("hex").slice(0, 24)}`;
}

function toWranglerConfigRelativePath(configDir: string, targetPath: string): string {
  return toPosixPath(path.relative(configDir, targetPath)) || ".";
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join(path.posix.sep);
}

export async function readSimpleEnvFile(filePath: string): Promise<Record<string, string>> {
  const raw = await readFile(filePath, "utf8");
  return parseEnvText(raw);
}

export async function readOptionalSimpleEnvFile(filePath: string): Promise<Record<string, string>> {
  const raw = await tryReadTextFile(filePath);
  return raw === null ? {} : parseEnvText(raw);
}

export function parseEnvText(raw: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  let index = 0;

  while (index < raw.length) {
    index = skipWhitespaceAndComments(raw, index);

    if (index >= raw.length) {
      break;
    }

    const keyStart = index;
    while (index < raw.length && raw[index] !== "=" && raw[index] !== "\n" && raw[index] !== "\r") {
      index += 1;
    }

    if (index >= raw.length || raw[index] !== "=") {
      index = skipLine(raw, index);
      continue;
    }

    const key = raw.slice(keyStart, index).trim();
    index += 1;

    if (!key) {
      index = skipLine(raw, index);
      continue;
    }

    const parsedValue = readEnvValue(raw, index);
    parsed[key] = parsedValue.value;
    index = parsedValue.nextIndex;
  }

  return parsed;
}

export function assertLocalWorkerOidcEnvironment(cloudflareDevVars: Record<string, string>): void {
  const environment = cloudflareDevVars.HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT?.trim();

  if (environment && environment !== "development") {
    throw new Error(
      [
        "apps/cloudflare/.dev.vars must set HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT=development for local `pnpm dev`.",
        `Current value: ${JSON.stringify(environment)}`,
      ].join(" "),
    );
  }
}

export function requireEnvValue(label: string, value: string | undefined, help: string): string {
  const normalized = value?.trim();

  if (!normalized) {
    throw new Error(`${label} is required for local hosted dev. ${help}`);
  }

  return normalized;
}

export function warnForMissingEnv(label: string, value: string | undefined): void {
  if (value?.trim()) {
    return;
  }

  process.stderr.write(
    `[setup] Warning: ${label} is not configured. The full hosted signup flow will stay incomplete until it is added.\n`,
  );
}

function resolveWranglerEnvValue(
  key: string,
  source: Readonly<Record<string, string | undefined>>,
): string | null {
  const value = source[key]?.trim();

  if (value) {
    return value;
  }

  if (key === "HOSTED_EXECUTION_RUNNER_ENV_PROFILES") {
    return "device-sync,exa,hosted-email,linq,mapbox,telegram";
  }

  return null;
}

function skipWhitespaceAndComments(raw: string, startIndex: number): number {
  let index = startIndex;

  while (index < raw.length) {
    while (index < raw.length && (raw[index] === " " || raw[index] === "\t")) {
      index += 1;
    }

    if (raw[index] === "#") {
      index = skipLine(raw, index);
      continue;
    }

    if (raw[index] === "\n") {
      index += 1;
      continue;
    }

    if (raw[index] === "\r") {
      index += 1;
      if (raw[index] === "\n") {
        index += 1;
      }
      continue;
    }

    break;
  }

  return index;
}

function skipLine(raw: string, startIndex: number): number {
  let index = startIndex;

  while (index < raw.length && raw[index] !== "\n" && raw[index] !== "\r") {
    index += 1;
  }

  if (raw[index] === "\r") {
    index += 1;
  }
  if (raw[index] === "\n") {
    index += 1;
  }

  return index;
}

function readEnvValue(raw: string, startIndex: number): { nextIndex: number; value: string } {
  if (startIndex >= raw.length) {
    return { nextIndex: startIndex, value: "" };
  }

  const quote = raw[startIndex];
  if (quote === "\"" || quote === "'") {
    return readQuotedEnvValue(raw, startIndex + 1, quote);
  }

  let endIndex = startIndex;
  while (endIndex < raw.length && raw[endIndex] !== "\n" && raw[endIndex] !== "\r") {
    endIndex += 1;
  }

  const value = raw.slice(startIndex, endIndex).trim();
  return {
    nextIndex: skipLine(raw, endIndex),
    value,
  };
}

function readQuotedEnvValue(
  raw: string,
  startIndex: number,
  quote: "\"" | "'",
): { nextIndex: number; value: string } {
  let index = startIndex;
  let value = "";

  while (index < raw.length) {
    const character = raw[index];

    if (character === "\\") {
      const escaped = readEscapedCharacter(raw, index + 1, quote);
      value += escaped.value;
      index = escaped.nextIndex;
      continue;
    }

    if (character === quote) {
      const nextIndex = skipLine(raw, index + 1);
      return {
        nextIndex,
        value,
      };
    }

    value += character;
    index += 1;
  }

  return {
    nextIndex: index,
    value,
  };
}

function readEscapedCharacter(
  raw: string,
  startIndex: number,
  quote: "\"" | "'",
): { nextIndex: number; value: string } {
  if (startIndex >= raw.length) {
    return { nextIndex: startIndex, value: "\\" };
  }

  const character = raw[startIndex];

  if (character === quote || character === "\\") {
    return {
      nextIndex: startIndex + 1,
      value: character,
    };
  }

  if (quote === "\"") {
    if (character === "n") {
      return { nextIndex: startIndex + 1, value: "\n" };
    }

    if (character === "r") {
      return { nextIndex: startIndex + 1, value: "\r" };
    }

    if (character === "t") {
      return { nextIndex: startIndex + 1, value: "\t" };
    }
  }

  return {
    nextIndex: startIndex + 1,
    value: `\\${character}`,
  };
}

function isLoopbackHost(hostname: string): boolean {
  const normalizedHostname =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;
  return normalizedHostname === "127.0.0.1"
    || normalizedHostname === "localhost"
    || normalizedHostname === "::1";
}

function isPostgresProtocol(protocol: string): boolean {
  return protocol === "postgres:" || protocol === "postgresql:";
}

function isLoopbackPostgresUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return isPostgresProtocol(parsed.protocol) && isLoopbackHost(parsed.hostname);
  } catch {
    return false;
  }
}

function hasExplicitDatabaseName(pathname: string): boolean {
  return pathname !== "" && pathname !== "/";
}

async function tryReadTextFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      return null;
    }

    throw error;
  }
}

async function tryReadSymlinkTarget(filePath: string): Promise<string | null> {
  try {
    const stat = await lstat(filePath);
    if (!stat.isSymbolicLink()) {
      return null;
    }

    return await readlink(filePath);
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      return null;
    }

    throw error;
  }
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === code
  );
}
