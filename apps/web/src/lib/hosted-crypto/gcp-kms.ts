import { Buffer } from "node:buffer";

import { getVercelOidcToken } from "@vercel/oidc";

const GCP_CLOUD_KMS_SCOPE = "https://www.googleapis.com/auth/cloudkms";
const GCP_IAM_CREDENTIALS_SCOPE = "https://www.googleapis.com/auth/iam";
const DEFAULT_KMS_API_ROOT = "https://cloudkms.googleapis.com/v1";
const LOCAL_KMS_API_ROOT = "local://murph-hosted-kms";
const LOCAL_KMS_CIPHERTEXT_PREFIX = "local-kms-v1:";
const LOCAL_KMS_IV_BYTES = 12;
const LOCAL_KMS_KEY_BYTES = 32;
const DEFAULT_STS_TOKEN_URI = "https://sts.googleapis.com/v1/token";
const DEFAULT_IAM_CREDENTIALS_API_ROOT = "https://iamcredentials.googleapis.com/v1";
const GCP_KMS_CRYPTO_KEY_NAME_PATTERN =
  /^projects\/[A-Za-z0-9][A-Za-z0-9._:-]*\/locations\/[A-Za-z0-9_-]+\/keyRings\/[A-Za-z0-9_-]+\/cryptoKeys\/[A-Za-z0-9_-]+$/u;
const GCP_KMS_CRYPTO_KEY_VERSION_NAME_PATTERN =
  /^(projects\/[A-Za-z0-9][A-Za-z0-9._:-]*\/locations\/[A-Za-z0-9_-]+\/keyRings\/[A-Za-z0-9_-]+\/cryptoKeys\/[A-Za-z0-9_-]+)\/cryptoKeyVersions\/[1-9][0-9]*$/u;
// One deadline owns the complete token + KMS operation. Callers may abort
// earlier. Provider failures are fail-closed and are never retried here.
export const HOSTED_GCP_KMS_OPERATION_TIMEOUT_MS = 10_000;
const GOOGLE_RPC_STATUS_REASONS = new Set([
  "ABORTED",
  "ALREADY_EXISTS",
  "CANCELLED",
  "DATA_LOSS",
  "DEADLINE_EXCEEDED",
  "FAILED_PRECONDITION",
  "INTERNAL",
  "INVALID_ARGUMENT",
  "NOT_FOUND",
  "OUT_OF_RANGE",
  "PERMISSION_DENIED",
  "RESOURCE_EXHAUSTED",
  "UNAUTHENTICATED",
  "UNAVAILABLE",
  "UNIMPLEMENTED",
  "UNKNOWN",
]);

export interface HostedGcpKmsClient {
  asymmetricSign(input: GcpKmsAsymmetricSignInput): Promise<{
    keyVersionName: string;
    signature: string;
  }>;
  decrypt(input: GcpKmsDecryptInput): Promise<{ plaintext: Uint8Array }>;
  encrypt(input: GcpKmsEncryptInput): Promise<{ ciphertext: string; keyName: string }>;
  macSign(input: GcpKmsMacSignInput): Promise<{
    keyVersionName: string;
    mac: Uint8Array;
  }>;
}

export interface GcpKmsEncryptInput {
  additionalAuthenticatedData: string;
  keyName: string;
  plaintext: Uint8Array;
  signal?: AbortSignal;
}

export interface GcpKmsDecryptInput {
  additionalAuthenticatedData: string;
  ciphertext: string;
  keyName: string;
  signal?: AbortSignal;
}

export interface GcpKmsAsymmetricSignInput {
  keyVersionName: string;
  message: Uint8Array;
  signal?: AbortSignal;
}

export interface GcpKmsMacSignInput {
  data: Uint8Array;
  keyVersionName: string;
  signal?: AbortSignal;
}

interface HostedGcpKmsJsonClientConfig {
  accessTokenProvider: HostedGcpAccessTokenProvider;
  apiRoot?: string | null;
}

interface HostedGcpAccessTokenProvider {
  getAccessToken(signal?: AbortSignal): Promise<string>;
}

interface GcpEncryptResponse {
  ciphertext?: string;
  name?: string;
}

interface GcpDecryptResponse {
  plaintext?: string;
}

interface GcpAsymmetricSignResponse {
  name?: string;
  signature?: string;
}

interface GcpMacSignResponse {
  mac?: string;
  name?: string;
}

interface StsTokenExchangeResponse {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
}

interface IamGenerateAccessTokenResponse {
  accessToken?: string;
  expireTime?: string;
}

interface GoogleCloudErrorBody {
  error?: {
    code?: number;
    message?: string;
    status?: string;
  } | string;
}

class GoogleCloudApiError extends Error {
  readonly code = "GOOGLE_CLOUD_API_ERROR";
  readonly googleCloudOperation: string;
  readonly googleCloudReason: string;
  readonly status: number;

  constructor(input: { operation: string; reason: string; status: number }) {
    super(`Google Cloud ${input.operation} failed (${input.status}): ${input.reason}`);
    this.name = "GoogleCloudApiError";
    this.googleCloudOperation = input.operation;
    this.googleCloudReason = input.reason;
    this.status = input.status;
  }
}

export function createHostedGcpKmsClientFromEnv(
  source: NodeJS.ProcessEnv = process.env,
): HostedGcpKmsClient {
  const apiRoot = readOptionalEnv(source, "HOSTED_CRYPTO_GCP_KMS_API_ROOT");
  const localKmsEnabled =
    apiRoot === LOCAL_KMS_API_ROOT
    || readOptionalEnv(source, "HOSTED_CRYPTO_LOCAL_KMS") === "1";

  if (localKmsEnabled) {
    if (isHostedCryptoProductionEnvironment(source)) {
      throw new TypeError("Hosted local KMS is not allowed in production.");
    }

    return new HostedLocalGcpKmsClient({
      authoritySignPrivateJwk: parseLocalP256PrivateJwk(
        readRequiredEnv(source, "HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK"),
        "HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK",
      ),
      wrapKey: decodeFixedBase64Key(
        readRequiredEnv(source, "HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY"),
        "HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY",
      ),
    });
  }

  assertHostedGcpEndpointOverridesAllowed(source);

  return new HostedGcpKmsJsonClient({
    accessTokenProvider: createHostedGcpAccessTokenProviderFromEnv(source),
    apiRoot,
  });
}

class HostedLocalGcpKmsClient implements HostedGcpKmsClient {
  constructor(
    private readonly config: {
      authoritySignPrivateJwk: JsonWebKey;
      wrapKey: Uint8Array;
    },
  ) {}

  async encrypt(input: GcpKmsEncryptInput): Promise<{ ciphertext: string; keyName: string }> {
    const keyName = requireKmsCryptoKeyName(input.keyName, "Local KMS Encrypt keyName");
    const iv = crypto.getRandomValues(new Uint8Array(LOCAL_KMS_IV_BYTES));
    const key = await this.importWrapKey(["encrypt"]);
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          additionalData: toArrayBuffer(
            localKmsAad({
              additionalAuthenticatedData: input.additionalAuthenticatedData,
              keyName,
            }),
          ),
          iv,
          name: "AES-GCM",
        },
        key,
        toArrayBuffer(input.plaintext),
      ),
    );

    return {
      ciphertext: `${LOCAL_KMS_CIPHERTEXT_PREFIX}${encodeBase64(concatBytes(iv, ciphertext))}`,
      keyName,
    };
  }

  async decrypt(input: GcpKmsDecryptInput): Promise<{ plaintext: Uint8Array }> {
    const keyName = normalizeKmsCryptoKeyName(input.keyName, "Local KMS Decrypt keyName");
    if (!input.ciphertext.startsWith(LOCAL_KMS_CIPHERTEXT_PREFIX)) {
      throw new Error(
        "Local KMS ciphertext must use the local-kms-v1 envelope.",
      );
    }

    const packed = decodeBase64(input.ciphertext.slice(LOCAL_KMS_CIPHERTEXT_PREFIX.length));
    if (packed.byteLength <= LOCAL_KMS_IV_BYTES) {
      throw new Error(
        "Local KMS ciphertext is malformed.",
      );
    }

    const iv = packed.slice(0, LOCAL_KMS_IV_BYTES);
    const ciphertext = packed.slice(LOCAL_KMS_IV_BYTES);
    const key = await this.importWrapKey(["decrypt"]);
    let plaintext: ArrayBuffer;
    try {
      plaintext = await crypto.subtle.decrypt(
        {
          additionalData: toArrayBuffer(
            localKmsAad({
              additionalAuthenticatedData: input.additionalAuthenticatedData,
              keyName,
            }),
          ),
          iv,
          name: "AES-GCM",
        },
        key,
        toArrayBuffer(ciphertext),
      );
    } catch (error) {
      if (
        error instanceof DOMException
        && (error.name === "DataError" || error.name === "OperationError")
      ) {
        throw new Error(
          "Local KMS ciphertext could not be authenticated.",
          { cause: error },
        );
      }
      throw error;
    }

    return { plaintext: new Uint8Array(plaintext) };
  }

  async asymmetricSign(
    input: GcpKmsAsymmetricSignInput,
  ): Promise<{ keyVersionName: string; signature: string }> {
    const keyVersionName = requireKmsResourceName(
      input.keyVersionName,
      "Local KMS Sign keyVersionName",
    );
    const key = await crypto.subtle.importKey(
      "jwk",
      this.config.authoritySignPrivateJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
    const signature = new Uint8Array(
      await crypto.subtle.sign(
        { hash: "SHA-256", name: "ECDSA" },
        key,
        toArrayBuffer(input.message),
      ),
    );

    return {
      keyVersionName,
      signature: encodeBase64(signature),
    };
  }

  async macSign(
    input: GcpKmsMacSignInput,
  ): Promise<{ keyVersionName: string; mac: Uint8Array }> {
    input.signal?.throwIfAborted();
    const keyVersionName = requireKmsResourceName(
      input.keyVersionName,
      "Local KMS MAC keyVersionName",
    );
    const key = await crypto.subtle.importKey(
      "raw",
      toArrayBuffer(this.config.wrapKey),
      { hash: "SHA-256", name: "HMAC" },
      false,
      ["sign"],
    );
    const mac = new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        key,
        toArrayBuffer(localKmsMacInput({
          data: input.data,
          keyVersionName,
        })),
      ),
    );
    return { keyVersionName, mac };
  }

  private importWrapKey(keyUsages: KeyUsage[]): Promise<CryptoKey> {
    return crypto.subtle.importKey(
      "raw",
      toArrayBuffer(this.config.wrapKey),
      "AES-GCM",
      false,
      keyUsages,
    );
  }
}

class HostedGcpKmsJsonClient implements HostedGcpKmsClient {
  private readonly accessTokenProvider: HostedGcpAccessTokenProvider;
  private readonly apiRoot: string;

  constructor(config: HostedGcpKmsJsonClientConfig) {
    this.accessTokenProvider = config.accessTokenProvider;
    this.apiRoot = readOptionalString(config.apiRoot) ?? DEFAULT_KMS_API_ROOT;
  }

  async encrypt(input: GcpKmsEncryptInput): Promise<{ ciphertext: string; keyName: string }> {
    const keyName = requireKmsCryptoKeyName(input.keyName, "GCP KMS Encrypt keyName");
    const response = await this.call<GcpEncryptResponse>({
      body: {
        additionalAuthenticatedData: encodeBase64(utf8(input.additionalAuthenticatedData)),
        plaintext: encodeBase64(input.plaintext),
      },
      operation: "cloudkms/encrypt",
      resource: `${keyName}:encrypt`,
      signal: input.signal,
    });
    const responseKeyName = requireKmsCryptoKeyVersionParentName(
      response.name,
      "GCP KMS Encrypt name",
    );
    if (responseKeyName !== keyName) {
      throw new Error(
        "GCP KMS Encrypt response key version did not match the requested CryptoKey.",
      );
    }
    return {
      ciphertext: requireNonEmptyString(response.ciphertext, "GCP KMS Encrypt ciphertext"),
      keyName,
    };
  }

  async decrypt(input: GcpKmsDecryptInput): Promise<{ plaintext: Uint8Array }> {
    const keyName = normalizeKmsCryptoKeyName(input.keyName, "GCP KMS Decrypt keyName");
    const response = await this.call<GcpDecryptResponse>({
      body: {
        additionalAuthenticatedData: encodeBase64(utf8(input.additionalAuthenticatedData)),
        ciphertext: requireNonEmptyString(input.ciphertext, "GCP KMS Decrypt ciphertext"),
      },
      operation: "cloudkms/decrypt",
      resource: `${keyName}:decrypt`,
      signal: input.signal,
    });
    return {
      plaintext: decodeBase64(
        requireNonEmptyString(response.plaintext, "GCP KMS Decrypt plaintext"),
      ),
    };
  }

  async asymmetricSign(
    input: GcpKmsAsymmetricSignInput,
  ): Promise<{ keyVersionName: string; signature: string }> {
    const digest = await sha256(input.message);
    const response = await this.call<GcpAsymmetricSignResponse>({
      body: {
        digest: { sha256: encodeBase64(digest) },
      },
      operation: "cloudkms/asymmetricSign",
      resource: `${requireKmsResourceName(
        input.keyVersionName,
        "GCP KMS Sign keyVersionName",
      )}:asymmetricSign`,
      signal: input.signal,
    });
    return {
      keyVersionName: requireNonEmptyString(
        response.name ?? input.keyVersionName,
        "GCP KMS Sign name",
      ),
      signature: requireNonEmptyString(response.signature, "GCP KMS Sign signature"),
    };
  }

  async macSign(
    input: GcpKmsMacSignInput,
  ): Promise<{ keyVersionName: string; mac: Uint8Array }> {
    const keyVersionName = requireKmsResourceName(
      input.keyVersionName,
      "GCP KMS MAC keyVersionName",
    );
    const response = await this.call<GcpMacSignResponse>({
      body: {
        data: encodeBase64(input.data),
      },
      operation: "cloudkms/macSign",
      resource: `${keyVersionName}:macSign`,
      signal: input.signal,
    });
    const responseName = requireNonEmptyString(response.name, "GCP KMS MAC name");
    if (responseName !== keyVersionName) {
      throw new Error("GCP KMS MAC response key version did not match the request.");
    }
    const mac = decodeBase64(requireNonEmptyString(response.mac, "GCP KMS MAC value"));
    if (mac.byteLength !== 32) {
      throw new Error("GCP KMS MAC value must be exactly 32 bytes.");
    }
    return { keyVersionName, mac };
  }

  private async call<TResponse>(input: {
    body: Record<string, unknown>;
    operation: string;
    resource: string;
    signal?: AbortSignal;
  }): Promise<TResponse> {
    const deadline = AbortSignal.timeout(HOSTED_GCP_KMS_OPERATION_TIMEOUT_MS);
    const signal = input.signal ? AbortSignal.any([input.signal, deadline]) : deadline;
    signal.throwIfAborted();
    const token = await this.accessTokenProvider.getAccessToken(signal);
    const response = await fetch(`${this.apiRoot}/${input.resource}`, {
      body: JSON.stringify(input.body),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal,
    });
    return parseGoogleJsonResponse<TResponse>(response, input.operation);
  }
}

function localKmsAad(input: {
  additionalAuthenticatedData: string;
  keyName: string;
}): Uint8Array {
  return utf8(
    JSON.stringify({
      additionalAuthenticatedData: input.additionalAuthenticatedData,
      keyName: input.keyName,
      schema: "murph.hosted-local-kms.v1",
    }),
  );
}

function localKmsMacInput(input: {
  data: Uint8Array;
  keyVersionName: string;
}): Uint8Array {
  return concatBytes(
    utf8(`${input.keyVersionName}\u0000murph.hosted-local-kms.mac.v1\u0000`),
    input.data,
  );
}

function parseLocalP256PrivateJwk(value: string, label: string): JsonWebKey {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new TypeError(
      `${label} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError(`${label} must be a P-256 EC private JWK.`);
  }

  const jwk = parsed as JsonWebKey;
  if (
    jwk.kty !== "EC"
    || jwk.crv !== "P-256"
    || typeof jwk.x !== "string"
    || typeof jwk.y !== "string"
    || typeof jwk.d !== "string"
    || jwk.x.length === 0
    || jwk.y.length === 0
    || jwk.d.length === 0
  ) {
    throw new TypeError(`${label} must be a P-256 EC private JWK.`);
  }

  return {
    crv: "P-256",
    d: jwk.d,
    kty: "EC",
    x: jwk.x,
    y: jwk.y,
  };
}

function decodeFixedBase64Key(value: string, label: string): Uint8Array {
  const decoded = decodeBase64(value);
  if (decoded.byteLength !== LOCAL_KMS_KEY_BYTES) {
    throw new TypeError(`${label} must decode to exactly ${LOCAL_KMS_KEY_BYTES} bytes.`);
  }
  return decoded;
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const out = new Uint8Array(left.byteLength + right.byteLength);
  out.set(left, 0);
  out.set(right, left.byteLength);
  return out;
}

function createHostedGcpAccessTokenProviderFromEnv(
  source: NodeJS.ProcessEnv,
): HostedGcpAccessTokenProvider {
  const staticAccessToken = readOptionalEnv(source, "HOSTED_CRYPTO_GCP_ACCESS_TOKEN");
  if (staticAccessToken) {
    if (isHostedCryptoProductionEnvironment(source)) {
      throw new TypeError(
        "HOSTED_CRYPTO_GCP_ACCESS_TOKEN is not allowed in production; use Vercel OIDC / GCP Workload Identity Federation.",
      );
    }
    if (readOptionalEnv(source, "HOSTED_CRYPTO_ALLOW_STATIC_GCP_ACCESS_TOKEN_FOR_DEV") !== "1") {
      throw new TypeError(
        "HOSTED_CRYPTO_GCP_ACCESS_TOKEN requires HOSTED_CRYPTO_ALLOW_STATIC_GCP_ACCESS_TOKEN_FOR_DEV=1.",
      );
    }
    return new StaticHostedGcpAccessTokenProvider(staticAccessToken);
  }
  return new VercelOidcGcpWorkloadIdentityAccessTokenProvider({
    iamCredentialsApiRoot: readOptionalEnv(source, "HOSTED_CRYPTO_GCP_IAM_CREDENTIALS_API_ROOT"),
    projectNumber: readRequiredEnv(source, "HOSTED_CRYPTO_GCP_PROJECT_NUMBER"),
    serviceAccountEmail: readRequiredEnv(source, "HOSTED_CRYPTO_GCP_SERVICE_ACCOUNT_EMAIL"),
    stsTokenUri: readOptionalEnv(source, "HOSTED_CRYPTO_GCP_STS_TOKEN_URI"),
    workloadIdentityPoolId: readRequiredEnv(source, "HOSTED_CRYPTO_GCP_WORKLOAD_IDENTITY_POOL_ID"),
    workloadIdentityProviderId: readRequiredEnv(
      source,
      "HOSTED_CRYPTO_GCP_WORKLOAD_IDENTITY_PROVIDER_ID",
    ),
  });
}

function isHostedCryptoProductionEnvironment(source: NodeJS.ProcessEnv): boolean {
  const hostedCryptoEnv = readOptionalEnv(source, "HOSTED_CRYPTO_ENV")?.toLowerCase();
  return source.NODE_ENV === "production"
    || source.VERCEL_ENV === "production"
    || hostedCryptoEnv === "prod"
    || hostedCryptoEnv === "production";
}

function assertHostedGcpEndpointOverridesAllowed(source: NodeJS.ProcessEnv): void {
  if (!isHostedCryptoProductionEnvironment(source)) {
    return;
  }

  const overrideKeys = [
    "HOSTED_CRYPTO_GCP_IAM_CREDENTIALS_API_ROOT",
    "HOSTED_CRYPTO_GCP_KMS_API_ROOT",
    "HOSTED_CRYPTO_GCP_STS_TOKEN_URI",
  ] as const;
  const configured = overrideKeys.find((key) => readOptionalEnv(source, key) !== null);
  if (configured) {
    throw new TypeError(`${configured} is not allowed in production.`);
  }
}

class StaticHostedGcpAccessTokenProvider implements HostedGcpAccessTokenProvider {
  constructor(private readonly accessToken: string) {}

  async getAccessToken(): Promise<string> {
    return this.accessToken;
  }
}

class VercelOidcGcpWorkloadIdentityAccessTokenProvider implements HostedGcpAccessTokenProvider {
  private readonly audience: string;
  private readonly iamCredentialsApiRoot: string;
  private readonly serviceAccountEmail: string;
  private readonly stsTokenUri: string;
  private cachedAccessToken: { expiresAtMs: number; token: string } | null = null;

  constructor(input: {
    iamCredentialsApiRoot?: string | null;
    projectNumber: string;
    serviceAccountEmail: string;
    stsTokenUri?: string | null;
    workloadIdentityPoolId: string;
    workloadIdentityProviderId: string;
  }) {
    this.audience = `//iam.googleapis.com/projects/${requireNonEmptyString(
      input.projectNumber,
      "GCP project number",
    )}/locations/global/workloadIdentityPools/${requireNonEmptyString(
      input.workloadIdentityPoolId,
      "GCP workload identity pool id",
    )}/providers/${requireNonEmptyString(
      input.workloadIdentityProviderId,
      "GCP workload identity provider id",
    )}`;
    this.iamCredentialsApiRoot =
      readOptionalString(input.iamCredentialsApiRoot) ?? DEFAULT_IAM_CREDENTIALS_API_ROOT;
    this.serviceAccountEmail = requireNonEmptyString(
      input.serviceAccountEmail,
      "GCP service account email",
    );
    this.stsTokenUri = readOptionalString(input.stsTokenUri) ?? DEFAULT_STS_TOKEN_URI;
  }

  async getAccessToken(signal?: AbortSignal): Promise<string> {
    const nowMs = Date.now();
    if (this.cachedAccessToken && this.cachedAccessToken.expiresAtMs - 60_000 > nowMs) {
      return this.cachedAccessToken.token;
    }
    const subjectToken = await getVercelOidcToken();
    const federatedToken = await this.exchangeSubjectToken(subjectToken, signal);
    const accessToken = await this.generateServiceAccountAccessToken(federatedToken, signal);
    this.cachedAccessToken = accessToken;
    return accessToken.token;
  }

  private async exchangeSubjectToken(
    subjectToken: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const response = await fetch(this.stsTokenUri, {
      body: new URLSearchParams({
        audience: this.audience,
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
        scope: GCP_IAM_CREDENTIALS_SCOPE,
        subject_token: subjectToken,
        subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
      }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
      signal,
    });
    const parsed = await parseGoogleJsonResponse<StsTokenExchangeResponse>(
      response,
      "sts/token",
    );
    return requireNonEmptyString(parsed.access_token, "GCP STS access_token");
  }

  private async generateServiceAccountAccessToken(
    federatedAccessToken: string,
    signal?: AbortSignal,
  ): Promise<{ expiresAtMs: number; token: string }> {
    const response = await fetch(
      `${this.iamCredentialsApiRoot}/projects/-/serviceAccounts/${encodeURIComponent(
        this.serviceAccountEmail,
      )}:generateAccessToken`,
      {
        body: JSON.stringify({
          lifetime: "3600s",
          scope: [GCP_CLOUD_KMS_SCOPE],
        }),
        headers: {
          Authorization: `Bearer ${federatedAccessToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
        signal,
      },
    );
    const parsed = await parseGoogleJsonResponse<IamGenerateAccessTokenResponse>(
      response,
      "iamcredentials/generateAccessToken",
    );
    const token = requireNonEmptyString(parsed.accessToken, "GCP IAM accessToken");
    const expireTimeMs = parsed.expireTime ? Date.parse(parsed.expireTime) : NaN;
    return {
      expiresAtMs: Number.isFinite(expireTimeMs) ? expireTimeMs : Date.now() + 3600 * 1000,
      token,
    };
  }
}

async function parseGoogleJsonResponse<TResponse>(
  response: Response,
  label: string,
): Promise<TResponse> {
  const text = await response.text();
  let parsed: unknown = {};
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      if (!response.ok) {
        throw new GoogleCloudApiError({
          operation: label,
          reason: `http_${response.status}`,
          status: response.status,
        });
      }
      throw error;
    }
  }
  if (!response.ok) {
    throw new GoogleCloudApiError({
      operation: label,
      reason: getGoogleCloudErrorReason(parsed, response),
      status: response.status,
    });
  }
  return parsed as TResponse;
}

function getGoogleCloudErrorReason(parsed: unknown, response: Response): string {
  const error = (parsed as GoogleCloudErrorBody).error;

  if (error && typeof error === "object") {
    const status = typeof error.status === "string" ? error.status.trim().toUpperCase() : null;
    if (status && GOOGLE_RPC_STATUS_REASONS.has(status)) {
      return status;
    }

    if (typeof error.code === "number" && Number.isFinite(error.code)) {
      return `google_error_${error.code}`;
    }
  }

  return `http_${response.status}`;
}

async function sha256(value: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBuffer(value)));
}

export function normalizeGcpKmsCryptoKeyName(value: string): string {
  return normalizeKmsCryptoKeyName(value, "GCP KMS keyName");
}

function normalizeKmsCryptoKeyName(value: string, label: string): string {
  const trimmed = requireNonEmptyString(value, label);
  if (GCP_KMS_CRYPTO_KEY_NAME_PATTERN.test(trimmed)) {
    return trimmed;
  }
  const versionMatch = GCP_KMS_CRYPTO_KEY_VERSION_NAME_PATTERN.exec(trimmed);
  if (versionMatch) {
    return versionMatch[1]!;
  }
  throw new TypeError(
    `${label} must be a CryptoKey or CryptoKeyVersion resource name.`,
  );
}

function requireKmsCryptoKeyName(value: string, label: string): string {
  const trimmed = requireNonEmptyString(value, label);
  if (!GCP_KMS_CRYPTO_KEY_NAME_PATTERN.test(trimmed)) {
    throw new TypeError(`${label} must be a CryptoKey resource name.`);
  }
  return trimmed;
}

function requireKmsCryptoKeyVersionParentName(value: unknown, label: string): string {
  const trimmed = requireNonEmptyString(value, label);
  const versionMatch = GCP_KMS_CRYPTO_KEY_VERSION_NAME_PATTERN.exec(trimmed);
  if (!versionMatch) {
    throw new TypeError(`${label} must be a CryptoKeyVersion resource name.`);
  }
  return versionMatch[1]!;
}

function requireKmsResourceName(value: string, label: string): string {
  const trimmed = requireNonEmptyString(value, label).trim();
  if (!trimmed.startsWith("projects/")) {
    throw new TypeError(`${label} must be a full Google Cloud KMS resource name.`);
  }
  return trimmed;
}

function readRequiredEnv(source: NodeJS.ProcessEnv, key: string): string {
  const value = readOptionalEnv(source, key);
  if (!value) {
    throw new TypeError(`${key} must be configured for hosted crypto GCP KMS.`);
  }
  return value;
}

function readOptionalEnv(source: NodeJS.ProcessEnv, key: string): string | null {
  return readOptionalString(source[key]);
}

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function encodeBase64(value: Uint8Array): string {
  return Buffer.from(value).toString("base64");
}

function decodeBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}
