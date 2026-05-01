import { Buffer } from "node:buffer";

import { getVercelOidcToken } from "@vercel/oidc";

const CLOUD_KMS_SCOPE = "https://www.googleapis.com/auth/cloudkms";
const DEFAULT_KMS_API_ROOT = "https://cloudkms.googleapis.com/v1";
const DEFAULT_STS_TOKEN_URI = "https://sts.googleapis.com/v1/token";
const DEFAULT_IAM_CREDENTIALS_API_ROOT = "https://iamcredentials.googleapis.com/v1";

export interface HostedGcpKmsClient {
  asymmetricSign(input: GcpKmsAsymmetricSignInput): Promise<{
    keyVersionName: string;
    signature: string;
  }>;
  decrypt(input: GcpKmsDecryptInput): Promise<{ plaintext: Uint8Array }>;
  encrypt(input: GcpKmsEncryptInput): Promise<{ ciphertext: string; keyName: string }>;
}

export interface GcpKmsEncryptInput {
  additionalAuthenticatedData: string;
  keyName: string;
  plaintext: Uint8Array;
}

export interface GcpKmsDecryptInput {
  additionalAuthenticatedData: string;
  ciphertext: string;
  keyName: string;
}

export interface GcpKmsAsymmetricSignInput {
  keyVersionName: string;
  message: Uint8Array;
}

interface HostedGcpKmsJsonClientConfig {
  accessTokenProvider: HostedGcpAccessTokenProvider;
  apiRoot?: string | null;
}

interface HostedGcpAccessTokenProvider {
  getAccessToken(): Promise<string>;
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

interface StsTokenExchangeResponse {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
}

interface IamGenerateAccessTokenResponse {
  accessToken?: string;
  expireTime?: string;
}

export function createHostedGcpKmsClientFromEnv(
  source: NodeJS.ProcessEnv = process.env,
): HostedGcpKmsClient {
  return new HostedGcpKmsJsonClient({
    accessTokenProvider: createHostedGcpAccessTokenProviderFromEnv(source),
    apiRoot: readOptionalEnv(source, "HOSTED_CRYPTO_GCP_KMS_API_ROOT"),
  });
}

class HostedGcpKmsJsonClient implements HostedGcpKmsClient {
  private readonly accessTokenProvider: HostedGcpAccessTokenProvider;
  private readonly apiRoot: string;

  constructor(config: HostedGcpKmsJsonClientConfig) {
    this.accessTokenProvider = config.accessTokenProvider;
    this.apiRoot = readOptionalString(config.apiRoot) ?? DEFAULT_KMS_API_ROOT;
  }

  async encrypt(input: GcpKmsEncryptInput): Promise<{ ciphertext: string; keyName: string }> {
    const response = await this.call<GcpEncryptResponse>(
      `${requireKmsResourceName(input.keyName, "GCP KMS Encrypt keyName")}:encrypt`,
      {
        additionalAuthenticatedData: encodeBase64(utf8(input.additionalAuthenticatedData)),
        plaintext: encodeBase64(input.plaintext),
      },
    );
    return {
      ciphertext: requireNonEmptyString(response.ciphertext, "GCP KMS Encrypt ciphertext"),
      keyName: requireNonEmptyString(response.name ?? input.keyName, "GCP KMS Encrypt name"),
    };
  }

  async decrypt(input: GcpKmsDecryptInput): Promise<{ plaintext: Uint8Array }> {
    const response = await this.call<GcpDecryptResponse>(
      `${requireKmsResourceName(input.keyName, "GCP KMS Decrypt keyName")}:decrypt`,
      {
        additionalAuthenticatedData: encodeBase64(utf8(input.additionalAuthenticatedData)),
        ciphertext: requireNonEmptyString(input.ciphertext, "GCP KMS Decrypt ciphertext"),
      },
    );
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
    const response = await this.call<GcpAsymmetricSignResponse>(
      `${requireKmsResourceName(input.keyVersionName, "GCP KMS Sign keyVersionName")}:asymmetricSign`,
      {
        digest: { sha256: encodeBase64(digest) },
      },
    );
    return {
      keyVersionName: requireNonEmptyString(
        response.name ?? input.keyVersionName,
        "GCP KMS Sign name",
      ),
      signature: requireNonEmptyString(response.signature, "GCP KMS Sign signature"),
    };
  }

  private async call<TResponse>(resource: string, body: Record<string, unknown>): Promise<TResponse> {
    const token = await this.accessTokenProvider.getAccessToken();
    const response = await fetch(`${this.apiRoot}/${resource}`, {
      body: JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    return parseGoogleJsonResponse<TResponse>(response, resource);
  }
}

function createHostedGcpAccessTokenProviderFromEnv(
  source: NodeJS.ProcessEnv,
): HostedGcpAccessTokenProvider {
  const staticAccessToken = readOptionalEnv(source, "HOSTED_CRYPTO_GCP_ACCESS_TOKEN");
  if (staticAccessToken) {
    if (
      source.NODE_ENV === "production"
      && readOptionalEnv(source, "HOSTED_CRYPTO_ALLOW_STATIC_GCP_ACCESS_TOKEN") !== "1"
    ) {
      throw new TypeError(
        "HOSTED_CRYPTO_GCP_ACCESS_TOKEN is only allowed in production when HOSTED_CRYPTO_ALLOW_STATIC_GCP_ACCESS_TOKEN=1.",
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

  async getAccessToken(): Promise<string> {
    const nowMs = Date.now();
    if (this.cachedAccessToken && this.cachedAccessToken.expiresAtMs - 60_000 > nowMs) {
      return this.cachedAccessToken.token;
    }
    const subjectToken = await getVercelOidcToken();
    const federatedToken = await this.exchangeSubjectToken(subjectToken);
    const accessToken = await this.generateServiceAccountAccessToken(federatedToken);
    this.cachedAccessToken = accessToken;
    return accessToken.token;
  }

  private async exchangeSubjectToken(subjectToken: string): Promise<string> {
    const response = await fetch(this.stsTokenUri, {
      body: new URLSearchParams({
        audience: this.audience,
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
        scope: CLOUD_KMS_SCOPE,
        subject_token: subjectToken,
        subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
      }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    const parsed = await parseGoogleJsonResponse<StsTokenExchangeResponse>(
      response,
      "sts/token",
    );
    return requireNonEmptyString(parsed.access_token, "GCP STS access_token");
  }

  private async generateServiceAccountAccessToken(
    federatedAccessToken: string,
  ): Promise<{ expiresAtMs: number; token: string }> {
    const response = await fetch(
      `${this.iamCredentialsApiRoot}/projects/-/serviceAccounts/${encodeURIComponent(
        this.serviceAccountEmail,
      )}:generateAccessToken`,
      {
        body: JSON.stringify({
          lifetime: "3600s",
          scope: [CLOUD_KMS_SCOPE],
        }),
        headers: {
          Authorization: `Bearer ${federatedAccessToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
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
  const parsed = text.length > 0 ? JSON.parse(text) : {};
  if (!response.ok) {
    const error = parsed as { error?: { message?: string } | string };
    const message =
      typeof error.error === "object" && typeof error.error.message === "string"
        ? error.error.message
        : typeof error.error === "string"
          ? error.error
          : response.statusText;
    throw new Error(`Google Cloud ${label} failed (${response.status}): ${message}`);
  }
  return parsed as TResponse;
}

async function sha256(value: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBuffer(value)));
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
    throw new TypeError(`${key} must be configured for hosted crypto GCP Workload Identity.`);
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
