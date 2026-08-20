import { AsyncLocalStorage } from "node:async_hooks";
import { Buffer } from "node:buffer";

import { KeyManagementServiceClient, protos } from "@google-cloud/kms";
import { getVercelOidcToken } from "@vercel/oidc";
import {
  IdentityPoolClient,
  OAuth2Client,
  type IdentityPoolClientOptions,
} from "google-auth-library";

const GCP_CLOUD_KMS_SCOPE = "https://www.googleapis.com/auth/cloudkms";
const GCP_EXTERNAL_ACCOUNT_TYPE = "external_account";
const GCP_SUBJECT_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:jwt";
const DEFAULT_KMS_API_ENDPOINT = "cloudkms.googleapis.com";
const DEFAULT_KMS_API_PORT = 443;
const DEFAULT_STS_TOKEN_URI = "https://sts.googleapis.com/v1/token";
const DEFAULT_IAM_CREDENTIALS_API_ROOT = "https://iamcredentials.googleapis.com/v1";
const LOCAL_KMS_API_ROOT = "local://murph-hosted-kms";
const LOCAL_KMS_CIPHERTEXT_PREFIX = "local-kms-v1:";
const LOCAL_KMS_IV_BYTES = 12;
const LOCAL_KMS_KEY_BYTES = 32;
const GCP_KMS_MAX_PLAINTEXT_AND_AAD_BYTES = 64 * 1024;
const GCP_KMS_MAX_CIPHERTEXT_BYTES = 66 * 1024;
const GCP_KMS_MAX_MESSAGE_BYTES = 64 * 1024;
const GCP_KMS_MAX_SIGNATURE_BYTES = 16 * 1024;
const GCP_KMS_MAC_BYTES = 32;
const GCP_TOKEN_MAX_BYTES = 16 * 1024;
const GCP_PROJECT_NUMBER_PATTERN = /^[1-9][0-9]{5,29}$/u;
const GCP_WORKLOAD_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{2,30}[a-z0-9])$/u;
const GCP_RESERVED_WORKLOAD_ID_PREFIX = "gcp-";
const GCP_SERVICE_ACCOUNT_EMAIL_PATTERN =
  /^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/u;
const GCP_KMS_CRYPTO_KEY_NAME_PATTERN =
  /^projects\/([a-z][a-z0-9-]{4,28}[a-z0-9]|[1-9][0-9]{5,29})\/locations\/[a-z][a-z0-9-]{0,62}\/keyRings\/[A-Za-z0-9_-]{1,63}\/cryptoKeys\/[A-Za-z0-9_-]{1,63}$/u;
const GCP_KMS_CRYPTO_KEY_VERSION_NAME_PATTERN =
  /^(projects\/(?:[a-z][a-z0-9-]{4,28}[a-z0-9]|[1-9][0-9]{5,29})\/locations\/[a-z][a-z0-9-]{0,62}\/keyRings\/[A-Za-z0-9_-]{1,63}\/cryptoKeys\/[A-Za-z0-9_-]{1,63})\/cryptoKeyVersions\/([1-9][0-9]*)$/u;
const COMPACT_JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
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
const GRPC_STATUS_REASONS = new Map<number, string>([
  [1, "CANCELLED"],
  [2, "UNKNOWN"],
  [3, "INVALID_ARGUMENT"],
  [4, "DEADLINE_EXCEEDED"],
  [5, "NOT_FOUND"],
  [6, "ALREADY_EXISTS"],
  [7, "PERMISSION_DENIED"],
  [8, "RESOURCE_EXHAUSTED"],
  [9, "FAILED_PRECONDITION"],
  [10, "ABORTED"],
  [11, "OUT_OF_RANGE"],
  [12, "UNIMPLEMENTED"],
  [13, "INTERNAL"],
  [14, "UNAVAILABLE"],
  [15, "DATA_LOSS"],
  [16, "UNAUTHENTICATED"],
]);

// One attempt deadline owns subject-token acquisition, Google authentication,
// and the KMS RPC. Decrypt alone may make one idempotent transient retry under
// the separate aggregate deadline below; every other operation remains
// single-attempt and fail-closed.
export const HOSTED_GCP_KMS_OPERATION_TIMEOUT_MS = 10_000;
export const HOSTED_GCP_KMS_DECRYPT_TIMEOUT_MS = 25_000;
const HOSTED_GCP_KMS_DECRYPT_MAX_ATTEMPTS = 2;
const HOSTED_GCP_KMS_DECRYPT_RETRY_MIN_DELAY_MS = 100;
const HOSTED_GCP_KMS_DECRYPT_RETRY_JITTER_MS = 200;

type OwnedBytes = Uint8Array<ArrayBuffer>;
type HostedGcpKmsOperation = "asymmetricSign" | "decrypt" | "encrypt" | "macSign";
type HostedGcpKmsFailureStage =
  | "auth_refresh_wait"
  | "kms_rpc"
  | "retry_backoff"
  | "sdk_initialize"
  | "service_account_impersonation"
  | "sts_exchange"
  | "subject_token";

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

export interface HostedGcpKmsSdkCallOptions {
  retry: false;
  signal: AbortSignal;
  timeoutMs: number;
}

export interface HostedGcpKmsSdkEncryptRequest {
  additionalAuthenticatedData: Uint8Array;
  additionalAuthenticatedDataCrc32c: number;
  name: string;
  plaintext: Uint8Array;
  plaintextCrc32c: number;
}

export interface HostedGcpKmsSdkEncryptResponse {
  ciphertext: Uint8Array | null;
  ciphertextCrc32c: number | null;
  name: string | null;
  verifiedAdditionalAuthenticatedDataCrc32c: boolean | null;
  verifiedPlaintextCrc32c: boolean | null;
}

export interface HostedGcpKmsSdkDecryptRequest {
  additionalAuthenticatedData: Uint8Array;
  additionalAuthenticatedDataCrc32c: number;
  ciphertext: Uint8Array;
  ciphertextCrc32c: number;
  name: string;
}

export interface HostedGcpKmsSdkDecryptResponse {
  plaintext: Uint8Array | null;
  plaintextCrc32c: number | null;
  usedPrimary: boolean | null;
}

export interface HostedGcpKmsSdkAsymmetricSignRequest {
  digest: Uint8Array;
  digestCrc32c: number;
  name: string;
}

export interface HostedGcpKmsSdkAsymmetricSignResponse {
  name: string | null;
  signature: Uint8Array | null;
  signatureCrc32c: number | null;
  verifiedDigestCrc32c: boolean | null;
}

export interface HostedGcpKmsSdkMacSignRequest {
  data: Uint8Array;
  dataCrc32c: number;
  name: string;
}

export interface HostedGcpKmsSdkMacSignResponse {
  mac: Uint8Array | null;
  macCrc32c: number | null;
  name: string | null;
  verifiedDataCrc32c: boolean | null;
}

export interface HostedGcpKmsSdkTransport {
  asymmetricSign(
    request: HostedGcpKmsSdkAsymmetricSignRequest,
    options: HostedGcpKmsSdkCallOptions,
  ): Promise<HostedGcpKmsSdkAsymmetricSignResponse>;
  decrypt(
    request: HostedGcpKmsSdkDecryptRequest,
    options: HostedGcpKmsSdkCallOptions,
  ): Promise<HostedGcpKmsSdkDecryptResponse>;
  encrypt(
    request: HostedGcpKmsSdkEncryptRequest,
    options: HostedGcpKmsSdkCallOptions,
  ): Promise<HostedGcpKmsSdkEncryptResponse>;
  macSign(
    request: HostedGcpKmsSdkMacSignRequest,
    options: HostedGcpKmsSdkCallOptions,
  ): Promise<HostedGcpKmsSdkMacSignResponse>;
}

export interface HostedGcpKmsStaticCredentialConfiguration {
  accessToken: string;
  kind: "static-access-token";
}

export interface HostedGcpKmsWorkloadIdentityCredentialConfiguration {
  audience: string;
  getSubjectToken(signal?: AbortSignal): Promise<string>;
  kind: "workload-identity";
  scopes: readonly string[];
  serviceAccountImpersonationUrl: string;
  subjectTokenType: string;
  tokenUrl: string;
}

export type HostedGcpKmsCredentialConfiguration =
  | HostedGcpKmsStaticCredentialConfiguration
  | HostedGcpKmsWorkloadIdentityCredentialConfiguration;

export interface HostedGcpKmsSdkClientConfiguration {
  apiEndpoint: string;
  credentials: HostedGcpKmsCredentialConfiguration;
  fallback: boolean;
  port: number;
  scopes: readonly string[];
}

export interface HostedGcpKmsClientDependencies {
  createSdkTransport(config: HostedGcpKmsSdkClientConfiguration): HostedGcpKmsSdkTransport;
}

export class HostedGcpKmsProviderError extends Error {
  readonly code = "HOSTED_GCP_KMS_PROVIDER_ERROR";
  readonly operation: HostedGcpKmsOperation;
  readonly providerReason: string;
  readonly retryable = false;
  readonly status: number | null;

  constructor(input: {
    operation: HostedGcpKmsOperation;
    providerReason: string;
    status: number | null;
  }) {
    super(`Google Cloud KMS ${input.operation} failed (${input.providerReason}).`);
    this.name = "HostedGcpKmsProviderError";
    this.operation = input.operation;
    this.providerReason = input.providerReason;
    this.status = input.status;
  }

  toJSON(): Record<string, boolean | number | string | null> {
    return {
      code: this.code,
      name: this.name,
      operation: this.operation,
      providerReason: this.providerReason,
      retryable: this.retryable,
      status: this.status,
    };
  }
}

export class HostedGcpKmsIntegrityError extends Error {
  readonly check: string;
  readonly code = "HOSTED_GCP_KMS_INTEGRITY_ERROR";
  readonly operation: HostedGcpKmsOperation;

  constructor(input: { check: string; operation: HostedGcpKmsOperation }) {
    super(`Google Cloud KMS ${input.operation} integrity verification failed (${input.check}).`);
    this.name = "HostedGcpKmsIntegrityError";
    this.check = input.check;
    this.operation = input.operation;
  }

  toJSON(): Record<string, string> {
    return {
      check: this.check,
      code: this.code,
      name: this.name,
      operation: this.operation,
    };
  }
}

interface HostedGcpKmsOperationContext {
  callerSignal: AbortSignal | undefined;
  deadlineAtMs: number;
  deadlineSignal: AbortSignal;
  signal: AbortSignal;
  startedAtMs: number;
  timeoutMs: number;
}

interface HostedGcpKmsAttemptContext {
  deadlineSignal: AbortSignal;
  diagnostics: HostedGcpKmsAttemptDiagnostics;
  signal: AbortSignal;
  timeoutMs: number;
}

interface HostedGcpKmsAttemptDiagnostics {
  lastFailureStage: HostedGcpKmsFailureStage | null;
  stageDurationsMs: Record<HostedGcpKmsFailureStage, number>;
  stageStartedAtMs: Record<HostedGcpKmsFailureStage, number[]>;
  startedAtMs: number;
  workloadIdentityRefreshObserved: boolean;
}

interface HostedGcpKmsRequestMetrics {
  additionalAuthenticatedDataBytes?: number;
  providerPayloadBytes: number;
}

interface HostedGcpAuthRefreshContext {
  deadlineAtMs: number;
  signal: AbortSignal;
}

interface CancellablePromise<T> extends Promise<T> {
  cancel(): void;
}

interface HostedGcpKmsEndpointConfiguration {
  apiEndpoint: string;
  fallback: boolean;
  port: number;
}

const hostedGcpAuthRefreshContext = new AsyncLocalStorage<HostedGcpAuthRefreshContext>();
const hostedGcpKmsAttemptDiagnosticsContext =
  new AsyncLocalStorage<HostedGcpKmsAttemptDiagnostics>();
const hostedGcpKmsSharedFailureStages = new WeakMap<object, HostedGcpKmsFailureStage>();
const defaultHostedGcpKmsDependencies: HostedGcpKmsClientDependencies = {
  createSdkTransport: createOfficialGcpKmsSdkTransport,
};

export function createHostedGcpKmsClientFromEnv(
  source: NodeJS.ProcessEnv = process.env,
  dependencies: HostedGcpKmsClientDependencies = defaultHostedGcpKmsDependencies,
): HostedGcpKmsClient {
  const apiRoot = readOptionalExactEnv(source, "HOSTED_CRYPTO_GCP_KMS_API_ROOT");
  const localKmsEnabled =
    apiRoot === LOCAL_KMS_API_ROOT
    || readOptionalEnv(source, "HOSTED_CRYPTO_LOCAL_KMS") === "1";

  if (localKmsEnabled) {
    if (isHostedCryptoProductionEnvironment(source)) {
      throw new TypeError("Hosted local KMS is not allowed in production.");
    }

    return new HostedLocalGcpKmsClient({
      authoritySignPrivateJwk: parseLocalP256PrivateJwk(
        readRequiredExactEnv(source, "HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK"),
        "HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK",
      ),
      wrapKey: decodeFixedBase64Key(
        readRequiredExactEnv(source, "HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY"),
        "HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY",
      ),
    });
  }

  assertHostedGcpEndpointOverridesAllowed(source);
  assertGoogleSdkLoggingDisabled(source);

  const endpoint = readHostedGcpKmsEndpointConfiguration(apiRoot);
  const config: HostedGcpKmsSdkClientConfiguration = {
    apiEndpoint: endpoint.apiEndpoint,
    credentials: readHostedGcpKmsCredentialConfiguration(source),
    fallback: endpoint.fallback,
    port: endpoint.port,
    scopes: [GCP_CLOUD_KMS_SCOPE],
  };
  return new HostedGcpKmsSdkClient(dependencies.createSdkTransport(config));
}

class HostedGcpKmsSdkClient implements HostedGcpKmsClient {
  constructor(private readonly transport: HostedGcpKmsSdkTransport) {}

  async encrypt(input: GcpKmsEncryptInput): Promise<{ ciphertext: string; keyName: string }> {
    throwIfCallerAborted(input.signal);
    const keyName = requireKmsCryptoKeyName(input.keyName, "GCP KMS Encrypt keyName");
    const plaintext = copyBoundedBytes(
      input.plaintext,
      GCP_KMS_MAX_PLAINTEXT_AND_AAD_BYTES,
      "GCP KMS Encrypt plaintext",
    );
    let additionalAuthenticatedData: OwnedBytes | null = null;
    let responseCiphertext: OwnedBytes | null = null;

    try {
      additionalAuthenticatedData = encodeBoundedUtf8(
        input.additionalAuthenticatedData,
        GCP_KMS_MAX_PLAINTEXT_AND_AAD_BYTES,
        "GCP KMS Encrypt additionalAuthenticatedData",
      );
      if (
        plaintext.byteLength + additionalAuthenticatedData.byteLength
        > GCP_KMS_MAX_PLAINTEXT_AND_AAD_BYTES
      ) {
        throw new TypeError(
          "GCP KMS Encrypt plaintext and additionalAuthenticatedData exceed 65536 bytes.",
        );
      }

      const request: HostedGcpKmsSdkEncryptRequest = {
        additionalAuthenticatedData,
        additionalAuthenticatedDataCrc32c: crc32c(additionalAuthenticatedData),
        name: keyName,
        plaintext,
        plaintextCrc32c: crc32c(plaintext),
      };
      const response = await this.callProvider(
        "encrypt",
        input.signal,
        (options) => this.transport.encrypt(request, options),
        {
          additionalAuthenticatedDataBytes: additionalAuthenticatedData.byteLength,
          providerPayloadBytes: plaintext.byteLength,
        },
      );
      responseCiphertext = claimResponseBytes(
        response.ciphertext,
        GCP_KMS_MAX_CIPHERTEXT_BYTES,
        false,
        "GCP KMS Encrypt ciphertext",
        "encrypt",
      );

      requireVerifiedFlag(
        response.verifiedPlaintextCrc32c,
        "encrypt",
        "verified_plaintext_crc32c",
      );
      requireVerifiedFlag(
        response.verifiedAdditionalAuthenticatedDataCrc32c,
        "encrypt",
        "verified_additional_authenticated_data_crc32c",
      );
      const responseKeyVersionName = requireResponseKmsCryptoKeyVersionName(
        response.name,
        "encrypt",
      );
      if (cryptoKeyParentName(responseKeyVersionName) !== keyName) {
        throw new HostedGcpKmsIntegrityError({
          check: "response_key_version_binding",
          operation: "encrypt",
        });
      }
      requireMatchingCrc32c(
        responseCiphertext,
        response.ciphertextCrc32c,
        "encrypt",
        "ciphertext_crc32c",
      );

      return {
        ciphertext: encodeBase64(responseCiphertext),
        keyName,
      };
    } finally {
      plaintext.fill(0);
      additionalAuthenticatedData?.fill(0);
      responseCiphertext?.fill(0);
    }
  }

  async decrypt(input: GcpKmsDecryptInput): Promise<{ plaintext: Uint8Array }> {
    throwIfCallerAborted(input.signal);
    const keyName = normalizeKmsCryptoKeyName(input.keyName, "GCP KMS Decrypt keyName");
    const ciphertext = decodeBoundedBase64(
      input.ciphertext,
      GCP_KMS_MAX_CIPHERTEXT_BYTES,
      "GCP KMS Decrypt ciphertext",
    );
    let additionalAuthenticatedData: OwnedBytes | null = null;
    let responsePlaintext: OwnedBytes | null = null;

    try {
      additionalAuthenticatedData = encodeBoundedUtf8(
        input.additionalAuthenticatedData,
        GCP_KMS_MAX_PLAINTEXT_AND_AAD_BYTES,
        "GCP KMS Decrypt additionalAuthenticatedData",
      );
      const request: HostedGcpKmsSdkDecryptRequest = {
        additionalAuthenticatedData,
        additionalAuthenticatedDataCrc32c: crc32c(additionalAuthenticatedData),
        ciphertext,
        ciphertextCrc32c: crc32c(ciphertext),
        name: keyName,
      };
      const response = await this.callProvider(
        "decrypt",
        input.signal,
        (options) => this.transport.decrypt(request, options),
        {
          additionalAuthenticatedDataBytes: additionalAuthenticatedData.byteLength,
          providerPayloadBytes: ciphertext.byteLength,
        },
      );
      responsePlaintext = claimResponseBytes(
        response.plaintext,
        GCP_KMS_MAX_PLAINTEXT_AND_AAD_BYTES,
        true,
        "GCP KMS Decrypt plaintext",
        "decrypt",
      );
      requireMatchingCrc32c(
        responsePlaintext,
        response.plaintextCrc32c,
        "decrypt",
        "plaintext_crc32c",
      );
      return { plaintext: new Uint8Array(responsePlaintext) };
    } finally {
      ciphertext.fill(0);
      additionalAuthenticatedData?.fill(0);
      responsePlaintext?.fill(0);
    }
  }

  async asymmetricSign(
    input: GcpKmsAsymmetricSignInput,
  ): Promise<{ keyVersionName: string; signature: string }> {
    throwIfCallerAborted(input.signal);
    const keyVersionName = requireKmsCryptoKeyVersionName(
      input.keyVersionName,
      "GCP KMS Sign keyVersionName",
    );
    const message = copyBoundedBytes(
      input.message,
      GCP_KMS_MAX_MESSAGE_BYTES,
      "GCP KMS Sign message",
    );
    let digest: OwnedBytes | null = null;
    let responseSignature: OwnedBytes | null = null;

    try {
      digest = new Uint8Array(await crypto.subtle.digest("SHA-256", message));
      const request: HostedGcpKmsSdkAsymmetricSignRequest = {
        digest,
        digestCrc32c: crc32c(digest),
        name: keyVersionName,
      };
      const response = await this.callProvider(
        "asymmetricSign",
        input.signal,
        (options) => this.transport.asymmetricSign(request, options),
        { providerPayloadBytes: digest.byteLength },
      );
      responseSignature = claimResponseBytes(
        response.signature,
        GCP_KMS_MAX_SIGNATURE_BYTES,
        false,
        "GCP KMS Sign signature",
        "asymmetricSign",
      );

      requireVerifiedFlag(
        response.verifiedDigestCrc32c,
        "asymmetricSign",
        "verified_digest_crc32c",
      );
      const responseKeyVersionName = requireResponseKmsCryptoKeyVersionName(
        response.name,
        "asymmetricSign",
      );
      if (responseKeyVersionName !== keyVersionName) {
        throw new HostedGcpKmsIntegrityError({
          check: "response_key_version_binding",
          operation: "asymmetricSign",
        });
      }
      requireMatchingCrc32c(
        responseSignature,
        response.signatureCrc32c,
        "asymmetricSign",
        "signature_crc32c",
      );
      return {
        keyVersionName,
        signature: encodeBase64(responseSignature),
      };
    } finally {
      message.fill(0);
      digest?.fill(0);
      responseSignature?.fill(0);
    }
  }

  async macSign(
    input: GcpKmsMacSignInput,
  ): Promise<{ keyVersionName: string; mac: Uint8Array }> {
    throwIfCallerAborted(input.signal);
    const keyVersionName = requireKmsCryptoKeyVersionName(
      input.keyVersionName,
      "GCP KMS MAC keyVersionName",
    );
    const data = copyBoundedBytes(
      input.data,
      GCP_KMS_MAX_PLAINTEXT_AND_AAD_BYTES,
      "GCP KMS MAC data",
    );
    let responseMac: OwnedBytes | null = null;

    try {
      const request: HostedGcpKmsSdkMacSignRequest = {
        data,
        dataCrc32c: crc32c(data),
        name: keyVersionName,
      };
      const response = await this.callProvider(
        "macSign",
        input.signal,
        (options) => this.transport.macSign(request, options),
        { providerPayloadBytes: data.byteLength },
      );
      responseMac = claimResponseBytes(
        response.mac,
        GCP_KMS_MAC_BYTES,
        false,
        "GCP KMS MAC value",
        "macSign",
      );
      if (responseMac.byteLength !== GCP_KMS_MAC_BYTES) {
        throw new HostedGcpKmsIntegrityError({
          check: "mac_length",
          operation: "macSign",
        });
      }
      requireVerifiedFlag(
        response.verifiedDataCrc32c,
        "macSign",
        "verified_data_crc32c",
      );
      const responseKeyVersionName = requireResponseKmsCryptoKeyVersionName(
        response.name,
        "macSign",
      );
      if (responseKeyVersionName !== keyVersionName) {
        throw new HostedGcpKmsIntegrityError({
          check: "response_key_version_binding",
          operation: "macSign",
        });
      }
      requireMatchingCrc32c(
        responseMac,
        response.macCrc32c,
        "macSign",
        "mac_crc32c",
      );
      return {
        keyVersionName,
        mac: new Uint8Array(responseMac),
      };
    } finally {
      data.fill(0);
      responseMac?.fill(0);
    }
  }

  private async callProvider<TResponse>(
    operation: HostedGcpKmsOperation,
    callerSignal: AbortSignal | undefined,
    invoke: (options: HostedGcpKmsSdkCallOptions) => Promise<TResponse>,
    requestMetrics: HostedGcpKmsRequestMetrics,
  ): Promise<TResponse> {
    const retryTransientDecrypt = operation === "decrypt";
    const maxAttempts = retryTransientDecrypt
      ? HOSTED_GCP_KMS_DECRYPT_MAX_ATTEMPTS
      : 1;
    const context = createOperationContext(
      callerSignal,
      retryTransientDecrypt
        ? HOSTED_GCP_KMS_DECRYPT_TIMEOUT_MS
        : HOSTED_GCP_KMS_OPERATION_TIMEOUT_MS,
    );

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      throwIfOperationAborted(context);
      const attemptContext = createProviderAttemptContext(context);
      const options: HostedGcpKmsSdkCallOptions = {
        retry: false,
        signal: attemptContext.signal,
        timeoutMs: attemptContext.timeoutMs,
      };
      try {
        const response = await hostedGcpKmsAttemptDiagnosticsContext.run(
          attemptContext.diagnostics,
          async () => await invoke(options),
        );
        throwIfProviderAttemptAborted(context, attemptContext);
        if (attempt > 1) {
          console.info("Hosted Google Cloud KMS decrypt recovered after retry.", {
            ...buildHostedGcpKmsAttemptLogDetails({
              attempt,
              attemptContext,
              context,
              maxAttempts,
              operation,
              providerReason: "RECOVERED",
              requestMetrics,
            }),
            outcome: "recovered",
          });
        }
        return response;
      } catch (error) {
        if (context.callerSignal?.aborted) {
          throw createCallerAbortError();
        }
        const failureStage = attemptContext.diagnostics.lastFailureStage
          ?? readHostedGcpKmsSharedFailureStage(error)
          ?? "kms_rpc";
        if (context.deadlineSignal.aborted) {
          console.error("Hosted Google Cloud KMS operation failed.", {
            ...buildHostedGcpKmsAttemptLogDetails({
              attempt,
              attemptContext,
              context,
              failureStage,
              maxAttempts,
              operation,
              providerReason: "DEADLINE_EXCEEDED",
              requestMetrics,
            }),
            outcome: "failed",
          });
          throw createOperationTimeoutError();
        }
        const attemptTimedOut = attemptContext.deadlineSignal.aborted || isTimeoutError(error);
        const unavailable = isUnavailableError(error);
        const providerReason = attemptTimedOut
          ? "DEADLINE_EXCEEDED"
          : readProviderReason(error, readProviderHttpStatus(error));
        if (
          retryTransientDecrypt
          && attempt < maxAttempts
          && (attemptTimedOut || unavailable)
        ) {
          const delayMs = createDecryptRetryDelayMs();
          console.warn("Hosted Google Cloud KMS decrypt retrying after a transient failure.", {
            ...buildHostedGcpKmsAttemptLogDetails({
              attempt,
              attemptContext,
              context,
              failureStage,
              maxAttempts,
              operation,
              providerReason,
              requestMetrics,
            }),
            delayMs,
            outcome: "retrying",
          });
          try {
            await hostedGcpKmsAttemptDiagnosticsContext.run(
              attemptContext.diagnostics,
              async () => await runHostedGcpKmsFailureStage(
                "retry_backoff",
                async () => await waitForOperationRetryDelay({ context, delayMs }),
              ),
            );
          } catch (delayError) {
            if (context.callerSignal?.aborted) {
              throw createCallerAbortError();
            }
            console.error("Hosted Google Cloud KMS operation failed.", {
              ...buildHostedGcpKmsAttemptLogDetails({
                attempt,
                attemptContext,
                context,
                failureStage: "retry_backoff",
                maxAttempts,
                operation,
                providerReason: isTimeoutError(delayError)
                  ? "DEADLINE_EXCEEDED"
                  : readProviderReason(delayError, readProviderHttpStatus(delayError)),
                requestMetrics,
              }),
              outcome: "failed",
            });
            throw delayError;
          }
          continue;
        }
        console.error("Hosted Google Cloud KMS operation failed.", {
          ...buildHostedGcpKmsAttemptLogDetails({
            attempt,
            attemptContext,
            context,
            failureStage,
            maxAttempts,
            operation,
            providerReason,
            requestMetrics,
          }),
          outcome: "failed",
        });
        if (attemptTimedOut) {
          throw createOperationTimeoutError();
        }
        throw createProviderError(operation, error);
      }
    }

    throw new TypeError("Google Cloud KMS retry loop exhausted without a result.");
  }
}

class HostedLocalGcpKmsClient implements HostedGcpKmsClient {
  private readonly authoritySignKey: Promise<CryptoKey>;
  private readonly localKeys: Promise<{ mac: CryptoKey; wrap: CryptoKey }>;

  constructor(config: { authoritySignPrivateJwk: JsonWebKey; wrapKey: OwnedBytes }) {
    const authoritySignPrivateJwk = config.authoritySignPrivateJwk;
    this.authoritySignKey = crypto.subtle.importKey(
      "jwk",
      authoritySignPrivateJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    ).finally(() => {
      delete authoritySignPrivateJwk.d;
      delete authoritySignPrivateJwk.x;
      delete authoritySignPrivateJwk.y;
    });

    const wrapMaterial = new Uint8Array(config.wrapKey);
    const macMaterial = new Uint8Array(config.wrapKey);
    config.wrapKey.fill(0);
    const wrapKey = crypto.subtle.importKey(
      "raw",
      wrapMaterial,
      "AES-GCM",
      false,
      ["decrypt", "encrypt"],
    ).finally(() => wrapMaterial.fill(0));
    const macKey = crypto.subtle.importKey(
      "raw",
      macMaterial,
      { hash: "SHA-256", name: "HMAC" },
      false,
      ["sign"],
    ).finally(() => macMaterial.fill(0));
    this.localKeys = Promise.all([wrapKey, macKey]).then(([wrap, mac]) => ({ mac, wrap }));
  }

  async encrypt(input: GcpKmsEncryptInput): Promise<{ ciphertext: string; keyName: string }> {
    throwIfCallerAborted(input.signal);
    const keyName = requireKmsCryptoKeyName(input.keyName, "Local KMS Encrypt keyName");
    const plaintext = copyBoundedBytes(
      input.plaintext,
      GCP_KMS_MAX_PLAINTEXT_AND_AAD_BYTES,
      "Local KMS Encrypt plaintext",
    );
    let aad: OwnedBytes | null = null;
    let ciphertext: OwnedBytes | null = null;
    let iv: OwnedBytes | null = null;
    let packed: OwnedBytes | null = null;

    try {
      aad = localKmsAad({
        additionalAuthenticatedData: input.additionalAuthenticatedData,
        keyName,
      });
      if (plaintext.byteLength + aad.byteLength > GCP_KMS_MAX_PLAINTEXT_AND_AAD_BYTES) {
        throw new TypeError(
          "Local KMS Encrypt plaintext and additionalAuthenticatedData exceed 65536 bytes.",
        );
      }
      const { wrap } = await this.localKeys;
      throwIfCallerAborted(input.signal);
      iv = crypto.getRandomValues(new Uint8Array(LOCAL_KMS_IV_BYTES));
      ciphertext = new Uint8Array(await crypto.subtle.encrypt(
        {
          additionalData: aad,
          iv,
          name: "AES-GCM",
        },
        wrap,
        plaintext,
      ));
      throwIfCallerAborted(input.signal);
      packed = concatBytes(iv, ciphertext);
      return {
        ciphertext: `${LOCAL_KMS_CIPHERTEXT_PREFIX}${encodeBase64(packed)}`,
        keyName,
      };
    } finally {
      plaintext.fill(0);
      aad?.fill(0);
      ciphertext?.fill(0);
      iv?.fill(0);
      packed?.fill(0);
    }
  }

  async decrypt(input: GcpKmsDecryptInput): Promise<{ plaintext: Uint8Array }> {
    throwIfCallerAborted(input.signal);
    const keyName = normalizeKmsCryptoKeyName(input.keyName, "Local KMS Decrypt keyName");
    if (!input.ciphertext.startsWith(LOCAL_KMS_CIPHERTEXT_PREFIX)) {
      throw new Error(
        "Local KMS ciphertext must use the local-kms-v1 envelope.",
      );
    }

    const packed = decodeBoundedBase64(
      input.ciphertext.slice(LOCAL_KMS_CIPHERTEXT_PREFIX.length),
      GCP_KMS_MAX_CIPHERTEXT_BYTES,
      "Local KMS ciphertext",
    );
    let aad: OwnedBytes | null = null;
    let ciphertext: OwnedBytes | null = null;
    let iv: OwnedBytes | null = null;
    let plaintext: OwnedBytes | null = null;

    try {
      if (packed.byteLength <= LOCAL_KMS_IV_BYTES) {
        throw new TypeError("Local KMS ciphertext is malformed.");
      }
      iv = packed.slice(0, LOCAL_KMS_IV_BYTES);
      ciphertext = packed.slice(LOCAL_KMS_IV_BYTES);
      aad = localKmsAad({
        additionalAuthenticatedData: input.additionalAuthenticatedData,
        keyName,
      });
      const { wrap } = await this.localKeys;
      throwIfCallerAborted(input.signal);
      plaintext = new Uint8Array(await crypto.subtle.decrypt(
        {
          additionalData: aad,
          iv,
          name: "AES-GCM",
        },
        wrap,
        ciphertext,
      ));
      throwIfCallerAborted(input.signal);
      return { plaintext: new Uint8Array(plaintext) };
    } finally {
      packed.fill(0);
      aad?.fill(0);
      ciphertext?.fill(0);
      iv?.fill(0);
      plaintext?.fill(0);
    }
  }

  async asymmetricSign(
    input: GcpKmsAsymmetricSignInput,
  ): Promise<{ keyVersionName: string; signature: string }> {
    throwIfCallerAborted(input.signal);
    const keyVersionName = requireKmsCryptoKeyVersionName(
      input.keyVersionName,
      "Local KMS Sign keyVersionName",
    );
    const message = copyBoundedBytes(
      input.message,
      GCP_KMS_MAX_MESSAGE_BYTES,
      "Local KMS Sign message",
    );
    let signature: OwnedBytes | null = null;

    try {
      const key = await this.authoritySignKey;
      throwIfCallerAborted(input.signal);
      signature = new Uint8Array(await crypto.subtle.sign(
        { hash: "SHA-256", name: "ECDSA" },
        key,
        message,
      ));
      throwIfCallerAborted(input.signal);
      return {
        keyVersionName,
        signature: encodeBase64(signature),
      };
    } finally {
      message.fill(0);
      signature?.fill(0);
    }
  }

  async macSign(
    input: GcpKmsMacSignInput,
  ): Promise<{ keyVersionName: string; mac: Uint8Array }> {
    throwIfCallerAborted(input.signal);
    const keyVersionName = requireKmsCryptoKeyVersionName(
      input.keyVersionName,
      "Local KMS MAC keyVersionName",
    );
    const data = copyBoundedBytes(
      input.data,
      GCP_KMS_MAX_PLAINTEXT_AND_AAD_BYTES,
      "Local KMS MAC data",
    );
    let macInput: OwnedBytes | null = null;
    let mac: OwnedBytes | null = null;

    try {
      const keys = await this.localKeys;
      throwIfCallerAborted(input.signal);
      macInput = localKmsMacInput({ data, keyVersionName });
      mac = new Uint8Array(await crypto.subtle.sign("HMAC", keys.mac, macInput));
      throwIfCallerAborted(input.signal);
      return {
        keyVersionName,
        mac: new Uint8Array(mac),
      };
    } finally {
      data.fill(0);
      macInput?.fill(0);
      mac?.fill(0);
    }
  }
}

class OfficialHostedGcpKmsSdkTransport implements HostedGcpKmsSdkTransport {
  constructor(private readonly client: KeyManagementServiceClient) {}

  async encrypt(
    request: HostedGcpKmsSdkEncryptRequest,
    options: HostedGcpKmsSdkCallOptions,
  ): Promise<HostedGcpKmsSdkEncryptResponse> {
    const sdkRequest: protos.google.cloud.kms.v1.IEncryptRequest = {
      additionalAuthenticatedData: request.additionalAuthenticatedData,
      additionalAuthenticatedDataCrc32c: { value: request.additionalAuthenticatedDataCrc32c },
      name: request.name,
      plaintext: request.plaintext,
      plaintextCrc32c: { value: request.plaintextCrc32c },
    };
    const response = await this.callUnary<protos.google.cloud.kms.v1.IEncryptResponse>(
      "encrypt",
      sdkRequest,
      options,
    );
    return {
      ciphertext: normalizeSdkBytes(response.ciphertext),
      ciphertextCrc32c: normalizeSdkCrc32c(response.ciphertextCrc32c),
      name: normalizeSdkString(response.name),
      verifiedAdditionalAuthenticatedDataCrc32c:
        normalizeSdkBoolean(response.verifiedAdditionalAuthenticatedDataCrc32c),
      verifiedPlaintextCrc32c: normalizeSdkBoolean(response.verifiedPlaintextCrc32c),
    };
  }

  async decrypt(
    request: HostedGcpKmsSdkDecryptRequest,
    options: HostedGcpKmsSdkCallOptions,
  ): Promise<HostedGcpKmsSdkDecryptResponse> {
    const sdkRequest: protos.google.cloud.kms.v1.IDecryptRequest = {
      additionalAuthenticatedData: request.additionalAuthenticatedData,
      additionalAuthenticatedDataCrc32c: { value: request.additionalAuthenticatedDataCrc32c },
      ciphertext: request.ciphertext,
      ciphertextCrc32c: { value: request.ciphertextCrc32c },
      name: request.name,
    };
    const response = await this.callUnary<protos.google.cloud.kms.v1.IDecryptResponse>(
      "decrypt",
      sdkRequest,
      options,
    );
    return {
      plaintext: normalizeSdkBytes(response.plaintext),
      plaintextCrc32c: normalizeSdkCrc32c(response.plaintextCrc32c),
      usedPrimary: normalizeSdkBoolean(response.usedPrimary),
    };
  }

  async asymmetricSign(
    request: HostedGcpKmsSdkAsymmetricSignRequest,
    options: HostedGcpKmsSdkCallOptions,
  ): Promise<HostedGcpKmsSdkAsymmetricSignResponse> {
    const sdkRequest: protos.google.cloud.kms.v1.IAsymmetricSignRequest = {
      digest: { sha256: request.digest },
      digestCrc32c: { value: request.digestCrc32c },
      name: request.name,
    };
    const response = await this.callUnary<protos.google.cloud.kms.v1.IAsymmetricSignResponse>(
      "asymmetricSign",
      sdkRequest,
      options,
    );
    return {
      name: normalizeSdkString(response.name),
      signature: normalizeSdkBytes(response.signature),
      signatureCrc32c: normalizeSdkCrc32c(response.signatureCrc32c),
      verifiedDigestCrc32c: normalizeSdkBoolean(response.verifiedDigestCrc32c),
    };
  }

  async macSign(
    request: HostedGcpKmsSdkMacSignRequest,
    options: HostedGcpKmsSdkCallOptions,
  ): Promise<HostedGcpKmsSdkMacSignResponse> {
    const sdkRequest: protos.google.cloud.kms.v1.IMacSignRequest = {
      data: request.data,
      dataCrc32c: { value: request.dataCrc32c },
      name: request.name,
    };
    const response = await this.callUnary<protos.google.cloud.kms.v1.IMacSignResponse>(
      "macSign",
      sdkRequest,
      options,
    );
    return {
      mac: normalizeSdkBytes(response.mac),
      macCrc32c: normalizeSdkCrc32c(response.macCrc32c),
      name: normalizeSdkString(response.name),
      verifiedDataCrc32c: normalizeSdkBoolean(response.verifiedDataCrc32c),
    };
  }

  private async callUnary<TResponse>(
    method: HostedGcpKmsOperation,
    request: object,
    options: HostedGcpKmsSdkCallOptions,
  ): Promise<TResponse> {
    await runHostedGcpKmsFailureStage(
      "sdk_initialize",
      async () => await waitForAbortablePromise(this.client.initialize(), options.signal),
    );
    const invoke = this.client.innerApiCalls[method];
    if (typeof invoke !== "function") {
      throw new TypeError(`Google Cloud KMS SDK method ${method} is unavailable.`);
    }
    const name = Reflect.get(request, "name");
    if (typeof name !== "string" || name.length === 0) {
      throw new TypeError(`Google Cloud KMS SDK method ${method} requires a resource name.`);
    }
    const call = requireCancellablePromise<[TResponse, unknown, unknown]>(
      Reflect.apply(invoke, this.client.innerApiCalls, [
        request,
        {
          otherArgs: {
            headers: { "x-goog-request-params": `name=${encodeURIComponent(name)}` },
          },
          retry: null,
          timeout: options.timeoutMs,
        },
      ]),
      method,
    );
    const [response] = await runHostedGcpKmsFailureStage(
      "kms_rpc",
      async () => await waitForAbortablePromise(call, options.signal),
    );
    return response;
  }
}

class HostedGcpIdentityPoolClient extends IdentityPoolClient {
  override getAccessToken(): ReturnType<IdentityPoolClient["getAccessToken"]> {
    if (hostedGcpAuthRefreshContext.getStore()) {
      return runHostedGcpKmsFailureStage(
        "auth_refresh_wait",
        async () => await super.getAccessToken(),
      );
    }
    return hostedGcpAuthRefreshContext.run(
      createAuthRefreshContext(),
      () => runHostedGcpKmsFailureStage(
        "auth_refresh_wait",
        async () => await super.getAccessToken(),
      ),
    );
  }
}

function createOfficialGcpKmsSdkTransport(
  config: HostedGcpKmsSdkClientConfiguration,
): HostedGcpKmsSdkTransport {
  const authClient = createOfficialGoogleAuthClient(config.credentials);
  configureOfficialGoogleAuthTransport(authClient);
  const clientOptions: NonNullable<ConstructorParameters<typeof KeyManagementServiceClient>[0]> = {
    apiEndpoint: config.apiEndpoint,
    authClient,
    fallback: config.fallback,
    port: config.port,
    scopes: Array.from(config.scopes),
    universeDomain: "googleapis.com",
  };
  return new OfficialHostedGcpKmsSdkTransport(
    new KeyManagementServiceClient(clientOptions),
  );
}

function createOfficialGoogleAuthClient(
  credentials: HostedGcpKmsCredentialConfiguration,
): IdentityPoolClient | OAuth2Client {
  if (credentials.kind === "static-access-token") {
    const client = new OAuth2Client({
      forceRefreshOnFailure: false,
      transporterOptions: {
        retry: false,
        timeout: HOSTED_GCP_KMS_OPERATION_TIMEOUT_MS,
      },
    });
    client.setCredentials({
      access_token: credentials.accessToken,
      expiry_date: Number.MAX_SAFE_INTEGER,
      token_type: "Bearer",
    });
    return client;
  }

  const options: IdentityPoolClientOptions = {
    audience: credentials.audience,
    forceRefreshOnFailure: false,
    scopes: Array.from(credentials.scopes),
    service_account_impersonation: { token_lifetime_seconds: 3600 },
    service_account_impersonation_url: credentials.serviceAccountImpersonationUrl,
    subject_token_supplier: {
      getSubjectToken: async (context) => {
        if (
          context.audience !== credentials.audience
          || context.subjectTokenType !== credentials.subjectTokenType
        ) {
          throw new TypeError("GCP Workload Identity subject-token binding is invalid.");
        }
        return runHostedGcpKmsFailureStage(
          "subject_token",
          async () => await credentials.getSubjectToken(
            hostedGcpAuthRefreshContext.getStore()?.signal,
          ),
        );
      },
    },
    subject_token_type: credentials.subjectTokenType,
    token_url: credentials.tokenUrl,
    transporterOptions: {
      retry: false,
      timeout: HOSTED_GCP_KMS_OPERATION_TIMEOUT_MS,
    },
    type: GCP_EXTERNAL_ACCOUNT_TYPE,
  };
  return new HostedGcpIdentityPoolClient(options);
}

function configureOfficialGoogleAuthTransport(
  authClient: IdentityPoolClient | OAuth2Client,
): void {
  if (authClient instanceof IdentityPoolClient) {
    addBoundedGoogleAuthTransportInterceptor(
      authClient.transporter,
      "service_account_impersonation",
    );
    const stsCredential = Reflect.get(authClient, "stsCredential");
    if (!isRecord(stsCredential)) {
      throw new TypeError("Google Workload Identity STS transport is unavailable.");
    }
    const stsTransport = Reflect.get(stsCredential, "transporter");
    if (!isGoogleAuthTransport(stsTransport)) {
      throw new TypeError("Google Workload Identity STS transport is unavailable.");
    }
    addBoundedGoogleAuthTransportInterceptor(stsTransport, "sts_exchange");
    return;
  }
  addBoundedGoogleAuthTransportInterceptor(authClient.transporter, "auth_refresh_wait");
}

function addBoundedGoogleAuthTransportInterceptor(
  transport: OAuth2Client["transporter"],
  failureStage: Extract<
    HostedGcpKmsFailureStage,
    "auth_refresh_wait" | "service_account_impersonation" | "sts_exchange"
  >,
): void {
  transport.interceptors.request.add({
    resolved: async (request) => {
      request.retry = false;
      request.retryConfig = { retry: 0 };
      const context = hostedGcpAuthRefreshContext.getStore();
      if (!context) {
        throw new TypeError("Google authentication request started outside its bounded lifecycle.");
      }
      request.signal = context.signal;
      request.timeout = remainingAuthRefreshTimeoutMs(context);
      startHostedGcpKmsStage(failureStage);
      return request;
    },
  });
  transport.interceptors.response.add({
    rejected: (error) => {
      finishHostedGcpKmsStage(failureStage);
      rememberHostedGcpKmsSharedFailureStage(error, failureStage);
      markHostedGcpKmsFailureStage(failureStage);
      throw error;
    },
    resolved: async (response) => {
      finishHostedGcpKmsStage(failureStage);
      return response;
    },
  });
}

function readHostedGcpKmsCredentialConfiguration(
  source: NodeJS.ProcessEnv,
): HostedGcpKmsCredentialConfiguration {
  const staticAccessToken = readOptionalExactEnv(source, "HOSTED_CRYPTO_GCP_ACCESS_TOKEN");
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
    return {
      accessToken: requireOpaqueCredential(staticAccessToken, "HOSTED_CRYPTO_GCP_ACCESS_TOKEN"),
      kind: "static-access-token",
    };
  }

  const projectNumber = requirePattern(
    readRequiredExactEnv(source, "HOSTED_CRYPTO_GCP_PROJECT_NUMBER"),
    GCP_PROJECT_NUMBER_PATTERN,
    "HOSTED_CRYPTO_GCP_PROJECT_NUMBER",
  );
  const workloadIdentityPoolId = requireWorkloadIdentityId(
    readRequiredExactEnv(source, "HOSTED_CRYPTO_GCP_WORKLOAD_IDENTITY_POOL_ID"),
    "HOSTED_CRYPTO_GCP_WORKLOAD_IDENTITY_POOL_ID",
  );
  const workloadIdentityProviderId = requireWorkloadIdentityId(
    readRequiredExactEnv(source, "HOSTED_CRYPTO_GCP_WORKLOAD_IDENTITY_PROVIDER_ID"),
    "HOSTED_CRYPTO_GCP_WORKLOAD_IDENTITY_PROVIDER_ID",
  );
  const serviceAccountEmail = requirePattern(
    readRequiredExactEnv(source, "HOSTED_CRYPTO_GCP_SERVICE_ACCOUNT_EMAIL"),
    GCP_SERVICE_ACCOUNT_EMAIL_PATTERN,
    "HOSTED_CRYPTO_GCP_SERVICE_ACCOUNT_EMAIL",
  );
  const tokenUrl = readExactHttpsUrl(
    readOptionalExactEnv(source, "HOSTED_CRYPTO_GCP_STS_TOKEN_URI") ?? DEFAULT_STS_TOKEN_URI,
    "/v1/token",
    "HOSTED_CRYPTO_GCP_STS_TOKEN_URI",
  ).toString();
  const iamCredentialsApiRoot = readExactHttpsUrl(
    readOptionalExactEnv(source, "HOSTED_CRYPTO_GCP_IAM_CREDENTIALS_API_ROOT")
      ?? DEFAULT_IAM_CREDENTIALS_API_ROOT,
    "/v1",
    "HOSTED_CRYPTO_GCP_IAM_CREDENTIALS_API_ROOT",
  ).toString().replace(/\/$/u, "");
  const audience =
    `//iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/`
    + `${workloadIdentityPoolId}/providers/${workloadIdentityProviderId}`;

  return {
    audience,
    getSubjectToken: async (signal?: AbortSignal) => {
      const timeoutSignal = AbortSignal.timeout(HOSTED_GCP_KMS_OPERATION_TIMEOUT_MS);
      const combinedSignal = signal
        ? AbortSignal.any([signal, timeoutSignal])
        : timeoutSignal;
      try {
        const token = await waitForAbortablePromise(getVercelOidcToken(), combinedSignal);
        if (signal?.aborted) {
          throw createCallerAbortError();
        }
        if (timeoutSignal.aborted) {
          throw createOperationTimeoutError();
        }
        return requireCompactJwt(token, "Vercel OIDC subject token");
      } catch (error) {
        rememberHostedGcpKmsSharedFailureStage(error, "subject_token");
        markHostedGcpKmsFailureStage("subject_token");
        if (signal?.aborted) {
          throw createCallerAbortError();
        }
        if (timeoutSignal.aborted) {
          throw createOperationTimeoutError();
        }
        throw error;
      }
    },
    kind: "workload-identity",
    scopes: [GCP_CLOUD_KMS_SCOPE],
    serviceAccountImpersonationUrl:
      `${iamCredentialsApiRoot}/projects/-/serviceAccounts/`
      + `${encodeURIComponent(serviceAccountEmail)}:generateAccessToken`,
    subjectTokenType: GCP_SUBJECT_TOKEN_TYPE,
    tokenUrl,
  };
}

function readHostedGcpKmsEndpointConfiguration(
  configuredApiRoot: string | null,
): HostedGcpKmsEndpointConfiguration {
  if (!configuredApiRoot) {
    return {
      apiEndpoint: DEFAULT_KMS_API_ENDPOINT,
      fallback: false,
      port: DEFAULT_KMS_API_PORT,
    };
  }
  const url = readExactHttpsUrl(
    configuredApiRoot,
    "/v1",
    "HOSTED_CRYPTO_GCP_KMS_API_ROOT",
  );
  return {
    apiEndpoint: url.hostname,
    fallback: true,
    port: url.port ? requirePort(url.port, "HOSTED_CRYPTO_GCP_KMS_API_ROOT") : 443,
  };
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
  const configured = overrideKeys.find((key) => readOptionalExactEnv(source, key) !== null);
  if (configured) {
    throw new TypeError(`${configured} is not allowed in production.`);
  }
}

function assertGoogleSdkLoggingDisabled(source: NodeJS.ProcessEnv): void {
  if (
    hasConfiguredEnvValue(source, "GOOGLE_SDK_NODE_LOGGING")
    || hasConfiguredEnvValue(process.env, "GOOGLE_SDK_NODE_LOGGING")
  ) {
    throw new TypeError(
      "GOOGLE_SDK_NODE_LOGGING must be unset for hosted crypto Google clients.",
    );
  }
}

function createOperationContext(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
): HostedGcpKmsOperationContext {
  const startedAtMs = Date.now();
  const deadlineSignal = AbortSignal.timeout(timeoutMs);
  return {
    callerSignal,
    deadlineAtMs: startedAtMs + timeoutMs,
    deadlineSignal,
    signal: callerSignal
      ? AbortSignal.any([callerSignal, deadlineSignal])
      : deadlineSignal,
    startedAtMs,
    timeoutMs,
  };
}

function createProviderAttemptContext(
  context: HostedGcpKmsOperationContext,
): HostedGcpKmsAttemptContext {
  const timeoutMs = Math.min(
    HOSTED_GCP_KMS_OPERATION_TIMEOUT_MS,
    remainingOperationTimeoutMs(context),
  );
  const deadlineSignal = AbortSignal.timeout(timeoutMs);
  return {
    deadlineSignal,
    diagnostics: createHostedGcpKmsAttemptDiagnostics(),
    signal: AbortSignal.any([context.signal, deadlineSignal]),
    timeoutMs,
  };
}

function createHostedGcpKmsAttemptDiagnostics(): HostedGcpKmsAttemptDiagnostics {
  const startedAtMs = Date.now();
  return {
    lastFailureStage: null,
    stageDurationsMs: {
      auth_refresh_wait: 0,
      kms_rpc: 0,
      retry_backoff: 0,
      sdk_initialize: 0,
      service_account_impersonation: 0,
      sts_exchange: 0,
      subject_token: 0,
    },
    stageStartedAtMs: {
      auth_refresh_wait: [],
      kms_rpc: [],
      retry_backoff: [],
      sdk_initialize: [],
      service_account_impersonation: [],
      sts_exchange: [],
      subject_token: [],
    },
    startedAtMs,
    workloadIdentityRefreshObserved: false,
  };
}

async function runHostedGcpKmsFailureStage<T>(
  stage: HostedGcpKmsFailureStage,
  operation: () => Promise<T>,
): Promise<T> {
  const diagnostics = hostedGcpKmsAttemptDiagnosticsContext.getStore();
  if (!diagnostics) {
    return operation();
  }
  startHostedGcpKmsStage(stage);
  try {
    return await operation();
  } catch (error) {
    // The innermost failing stage wins, so an STS or impersonation failure is
    // not replaced by the surrounding auth-refresh or SDK initialization wait.
    diagnostics.lastFailureStage ??=
      readHostedGcpKmsSharedFailureStage(error) ?? stage;
    throw error;
  } finally {
    finishHostedGcpKmsStage(stage);
  }
}

function markHostedGcpKmsFailureStage(
  stage: HostedGcpKmsFailureStage,
): void {
  const diagnostics = hostedGcpKmsAttemptDiagnosticsContext.getStore();
  if (diagnostics) {
    diagnostics.lastFailureStage = stage;
  }
}

function rememberHostedGcpKmsSharedFailureStage(
  error: unknown,
  stage: HostedGcpKmsFailureStage,
): void {
  if (error && typeof error === "object") {
    hostedGcpKmsSharedFailureStages.set(error, stage);
  }
}

function readHostedGcpKmsSharedFailureStage(
  error: unknown,
): HostedGcpKmsFailureStage | null {
  return error && typeof error === "object"
    ? hostedGcpKmsSharedFailureStages.get(error) ?? null
    : null;
}

function startHostedGcpKmsStage(stage: HostedGcpKmsFailureStage): void {
  const diagnostics = hostedGcpKmsAttemptDiagnosticsContext.getStore();
  if (!diagnostics) {
    return;
  }
  diagnostics.stageStartedAtMs[stage].push(Date.now());
  if (stage === "subject_token") {
    diagnostics.workloadIdentityRefreshObserved = true;
  }
}

function finishHostedGcpKmsStage(stage: HostedGcpKmsFailureStage): void {
  const diagnostics = hostedGcpKmsAttemptDiagnosticsContext.getStore();
  if (!diagnostics) {
    return;
  }
  const startedAtMs = diagnostics.stageStartedAtMs[stage].pop();
  if (startedAtMs === undefined) {
    return;
  }
  diagnostics.stageDurationsMs[stage] +=
    readHostedGcpKmsBoundedElapsedMs(startedAtMs, Date.now());
}

function buildHostedGcpKmsAttemptLogDetails(input: {
  attempt: number;
  attemptContext: HostedGcpKmsAttemptContext;
  context: HostedGcpKmsOperationContext;
  failureStage?: HostedGcpKmsFailureStage;
  maxAttempts: number;
  operation: HostedGcpKmsOperation;
  providerReason: string;
  requestMetrics: HostedGcpKmsRequestMetrics;
}): Record<string, boolean | number | string> {
  const now = Date.now();
  const stageDurationsMs = {
    ...input.attemptContext.diagnostics.stageDurationsMs,
  };
  for (const stage of Object.keys(stageDurationsMs) as HostedGcpKmsFailureStage[]) {
    for (const startedAtMs of input.attemptContext.diagnostics.stageStartedAtMs[stage]) {
      stageDurationsMs[stage] += readHostedGcpKmsBoundedElapsedMs(startedAtMs, now);
    }
  }
  return {
    additionalAuthenticatedDataBytes:
      input.requestMetrics.additionalAuthenticatedDataBytes ?? 0,
    aggregateRemainingMs: Math.max(0, input.context.deadlineAtMs - now),
    aggregateTimeoutMs: input.context.timeoutMs,
    attempt: input.attempt,
    attemptElapsedMs: readHostedGcpKmsBoundedElapsedMs(
      input.attemptContext.diagnostics.startedAtMs,
      now,
    ),
    attemptTimeoutMs: input.attemptContext.timeoutMs,
    authRefreshWaitElapsedMs: stageDurationsMs.auth_refresh_wait,
    ...(input.failureStage ? { failureStage: input.failureStage } : {}),
    kmsRpcElapsedMs: stageDurationsMs.kms_rpc,
    maxAttempts: input.maxAttempts,
    operation: input.operation,
    operationElapsedMs: readHostedGcpKmsBoundedElapsedMs(input.context.startedAtMs, now),
    providerReason: input.providerReason,
    providerPayloadBytes: input.requestMetrics.providerPayloadBytes,
    retryBackoffElapsedMs: stageDurationsMs.retry_backoff,
    sdkInitializeElapsedMs: stageDurationsMs.sdk_initialize,
    serviceAccountImpersonationElapsedMs:
      stageDurationsMs.service_account_impersonation,
    stsExchangeElapsedMs: stageDurationsMs.sts_exchange,
    subjectTokenElapsedMs: stageDurationsMs.subject_token,
    workloadIdentityRefreshObserved:
      input.attemptContext.diagnostics.workloadIdentityRefreshObserved,
  };
}

function readHostedGcpKmsBoundedElapsedMs(startedAtMs: number, now: number): number {
  const elapsedMs = now - startedAtMs;
  return Number.isSafeInteger(elapsedMs) && elapsedMs > 0
    ? Math.min(elapsedMs, HOSTED_GCP_KMS_DECRYPT_TIMEOUT_MS)
    : 0;
}

function createAuthRefreshContext(): HostedGcpAuthRefreshContext {
  const signal = AbortSignal.timeout(HOSTED_GCP_KMS_OPERATION_TIMEOUT_MS);
  return {
    deadlineAtMs: Date.now() + HOSTED_GCP_KMS_OPERATION_TIMEOUT_MS,
    signal,
  };
}

function remainingAuthRefreshTimeoutMs(context: HostedGcpAuthRefreshContext): number {
  const remaining = context.deadlineAtMs - Date.now();
  if (remaining <= 0 || context.signal.aborted) {
    throw createOperationTimeoutError();
  }
  return Math.max(1, remaining);
}

function remainingOperationTimeoutMs(context: HostedGcpKmsOperationContext): number {
  const remaining = context.deadlineAtMs - Date.now();
  if (remaining <= 0 || context.deadlineSignal.aborted) {
    throw createOperationTimeoutError();
  }
  return Math.max(1, remaining);
}

function throwIfOperationAborted(context: HostedGcpKmsOperationContext): void {
  if (context.callerSignal?.aborted) {
    throw createCallerAbortError();
  }
  if (context.deadlineSignal.aborted) {
    throw createOperationTimeoutError();
  }
}

function throwIfProviderAttemptAborted(
  context: HostedGcpKmsOperationContext,
  attempt: HostedGcpKmsAttemptContext,
): void {
  throwIfOperationAborted(context);
  if (attempt.deadlineSignal.aborted) {
    throw createOperationTimeoutError();
  }
}

function throwIfCallerAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw createCallerAbortError();
  }
}

function createCallerAbortError(): DOMException {
  return new DOMException("Google Cloud KMS operation was aborted by the caller.", "AbortError");
}

function createOperationTimeoutError(): DOMException {
  return new DOMException("Google Cloud KMS operation exceeded its deadline.", "TimeoutError");
}

function isTimeoutError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return true;
  }
  if (!isRecord(error)) {
    return false;
  }
  return error.code === 4
    || error.code === "DEADLINE_EXCEEDED"
    || error.status === "DEADLINE_EXCEEDED";
}

function isUnavailableError(error: unknown): boolean {
  if (!isRecord(error)) {
    return false;
  }
  return error.code === 14
    || error.code === "UNAVAILABLE"
    || error.status === "UNAVAILABLE";
}

function createDecryptRetryDelayMs(): number {
  return HOSTED_GCP_KMS_DECRYPT_RETRY_MIN_DELAY_MS
    + Math.floor(Math.random() * (HOSTED_GCP_KMS_DECRYPT_RETRY_JITTER_MS + 1));
}

async function waitForOperationRetryDelay(input: {
  context: HostedGcpKmsOperationContext;
  delayMs: number;
}): Promise<void> {
  throwIfOperationAborted(input.context);
  if (remainingOperationTimeoutMs(input.context) <= input.delayMs) {
    throw createOperationTimeoutError();
  }

  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      input.context.signal.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      try {
        throwIfOperationAborted(input.context);
        reject(createOperationTimeoutError());
      } catch (error) {
        reject(error);
      }
    };
    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, input.delayMs);
    input.context.signal.addEventListener("abort", onAbort, { once: true });
  });
  throwIfOperationAborted(input.context);
}

function createProviderError(
  operation: HostedGcpKmsOperation,
  error: unknown,
): HostedGcpKmsProviderError {
  const status = readProviderHttpStatus(error);
  return new HostedGcpKmsProviderError({
    operation,
    providerReason: readProviderReason(error, status),
    status,
  });
}

function readProviderReason(error: unknown, status: number | null): string {
  if (!isRecord(error)) {
    return status === null ? "UNKNOWN" : `http_${status}`;
  }
  if (typeof error.code === "number") {
    const reason = GRPC_STATUS_REASONS.get(error.code);
    if (reason) {
      return reason;
    }
  }
  for (const candidate of [error.code, error.status]) {
    if (typeof candidate === "string") {
      const normalized = candidate.trim().toUpperCase();
      if (GOOGLE_RPC_STATUS_REASONS.has(normalized)) {
        return normalized;
      }
    }
  }
  return status === null ? "UNKNOWN" : `http_${status}`;
}

function readProviderHttpStatus(error: unknown): number | null {
  if (!isRecord(error)) {
    return null;
  }
  const directStatus = normalizeHttpStatus(error.status);
  if (directStatus !== null) {
    return directStatus;
  }
  if (isRecord(error.response)) {
    return normalizeHttpStatus(error.response.status);
  }
  return null;
}

function normalizeHttpStatus(value: unknown): number | null {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= 100
    && value <= 599
    ? value
    : null;
}

async function waitForAbortablePromise<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    cancelPromise(promise);
    throw new DOMException("Google operation was aborted.", "AbortError");
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      cancelPromise(promise);
      reject(new DOMException("Google operation was aborted.", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error);
      },
    );
  });
}

function cancelPromise<T>(promise: Promise<T>): void {
  if ("cancel" in promise && typeof promise.cancel === "function") {
    promise.cancel();
  }
}

function requireCancellablePromise<T>(
  value: unknown,
  operation: HostedGcpKmsOperation,
): CancellablePromise<T> {
  if (!isCancellablePromise<T>(value)) {
    throw new TypeError(`Google Cloud KMS SDK method ${operation} is not cancellable.`);
  }
  return value;
}

function isCancellablePromise<T>(value: unknown): value is CancellablePromise<T> {
  return isRecord(value)
    && typeof value.then === "function"
    && typeof value.cancel === "function";
}

function requireVerifiedFlag(
  value: boolean | null,
  operation: HostedGcpKmsOperation,
  check: string,
): void {
  if (value !== true) {
    throw new HostedGcpKmsIntegrityError({ check, operation });
  }
}

function requireMatchingCrc32c(
  value: Uint8Array,
  reportedCrc32c: number | null,
  operation: HostedGcpKmsOperation,
  check: string,
): void {
  if (reportedCrc32c === null || reportedCrc32c !== crc32c(value)) {
    throw new HostedGcpKmsIntegrityError({ check, operation });
  }
}

function crc32c(value: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc = CRC32C_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC32C_TABLE = createCrc32cTable();

function createCrc32cTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1
        ? 0x82f63b78 ^ (value >>> 1)
        : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

function normalizeSdkBytes(value: Uint8Array | string | null | undefined): Uint8Array | null {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (
    typeof value !== "string"
    || value.length > Math.ceil(GCP_KMS_MAX_CIPHERTEXT_BYTES / 3) * 4
    || !BASE64_PATTERN.test(value)
  ) {
    return null;
  }
  const decoded = new Uint8Array(Buffer.from(value, "base64"));
  if (encodeBase64(decoded) !== value) {
    decoded.fill(0);
    return null;
  }
  return decoded;
}

function normalizeSdkCrc32c(value: unknown): number | null {
  if (isRecord(value) && "value" in value) {
    return normalizeSdkCrc32c(value.value);
  }
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 && value <= 0xffffffff
      ? value
      : null;
  }
  if (typeof value === "bigint") {
    return value >= 0n && value <= 0xffffffffn ? Number(value) : null;
  }
  if (typeof value === "string" && /^[0-9]{1,10}$/u.test(value)) {
    const parsed = Number(value);
    return parsed <= 0xffffffff ? parsed : null;
  }
  if (
    isRecord(value)
    && typeof value.low === "number"
    && typeof value.high === "number"
    && value.high === 0
  ) {
    return value.low >>> 0;
  }
  return null;
}

function normalizeSdkString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizeSdkBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function claimResponseBytes(
  value: Uint8Array | null,
  maxBytes: number,
  allowEmpty: boolean,
  label: string,
  operation: HostedGcpKmsOperation,
): OwnedBytes {
  if (!(value instanceof Uint8Array)) {
    throw new HostedGcpKmsIntegrityError({
      check: `${label.replaceAll(" ", "_").toLowerCase()}_missing`,
      operation,
    });
  }
  try {
    if ((!allowEmpty && value.byteLength === 0) || value.byteLength > maxBytes) {
      throw new HostedGcpKmsIntegrityError({
        check: `${label.replaceAll(" ", "_").toLowerCase()}_size`,
        operation,
      });
    }
    return new Uint8Array(value);
  } finally {
    value.fill(0);
  }
}

export function normalizeGcpKmsCryptoKeyName(value: string): string {
  return normalizeKmsCryptoKeyName(value, "GCP KMS keyName");
}

function normalizeKmsCryptoKeyName(value: string, label: string): string {
  const trimmed = requireExactString(value, label);
  if (GCP_KMS_CRYPTO_KEY_NAME_PATTERN.test(trimmed)) {
    return trimmed;
  }
  const versionMatch = GCP_KMS_CRYPTO_KEY_VERSION_NAME_PATTERN.exec(trimmed);
  if (versionMatch?.[1]) {
    return versionMatch[1];
  }
  throw new TypeError(`${label} must be an exact CryptoKey or CryptoKeyVersion resource name.`);
}

function requireKmsCryptoKeyName(value: unknown, label: string): string {
  const exact = requireExactString(value, label);
  if (!GCP_KMS_CRYPTO_KEY_NAME_PATTERN.test(exact)) {
    throw new TypeError(`${label} must be an exact CryptoKey resource name.`);
  }
  return exact;
}

function requireKmsCryptoKeyVersionName(value: unknown, label: string): string {
  const exact = requireExactString(value, label);
  if (!GCP_KMS_CRYPTO_KEY_VERSION_NAME_PATTERN.test(exact)) {
    throw new TypeError(`${label} must be an exact CryptoKeyVersion resource name.`);
  }
  return exact;
}

function requireResponseKmsCryptoKeyVersionName(
  value: unknown,
  operation: HostedGcpKmsOperation,
): string {
  try {
    return requireKmsCryptoKeyVersionName(value, "GCP KMS response name");
  } catch {
    throw new HostedGcpKmsIntegrityError({
      check: "response_key_version_name",
      operation,
    });
  }
}

function cryptoKeyParentName(versionName: string): string {
  const match = GCP_KMS_CRYPTO_KEY_VERSION_NAME_PATTERN.exec(versionName);
  if (!match?.[1]) {
    throw new TypeError("GCP KMS CryptoKeyVersion resource name is invalid.");
  }
  return match[1];
}

function readRequiredExactEnv(source: NodeJS.ProcessEnv, key: string): string {
  const value = readOptionalExactEnv(source, key);
  if (!value) {
    throw new TypeError(`${key} must be configured for hosted crypto GCP KMS.`);
  }
  return value;
}

function readOptionalExactEnv(source: NodeJS.ProcessEnv, key: string): string | null {
  const value = source[key];
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  return requireExactString(value, key);
}

function hasConfiguredEnvValue(source: NodeJS.ProcessEnv, key: string): boolean {
  const value = source[key];
  return typeof value === "string" && value.length > 0;
}

function readOptionalEnv(source: NodeJS.ProcessEnv, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function requireExactString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    throw new TypeError(`${label} must be a non-empty exact string without surrounding whitespace.`);
  }
  return value;
}

function requirePattern(value: string, pattern: RegExp, label: string): string {
  const exact = requireExactString(value, label);
  if (!pattern.test(exact)) {
    throw new TypeError(`${label} is invalid.`);
  }
  return exact;
}

function requireWorkloadIdentityId(value: string, label: string): string {
  const id = requirePattern(value, GCP_WORKLOAD_ID_PATTERN, label);
  if (id.startsWith(GCP_RESERVED_WORKLOAD_ID_PREFIX)) {
    throw new TypeError(`${label} uses a reserved Google prefix.`);
  }
  return id;
}

function requireOpaqueCredential(value: string, label: string): string {
  const exact = requireExactString(value, label);
  if (Buffer.byteLength(exact, "utf8") > GCP_TOKEN_MAX_BYTES || /[\u0000-\u0020\u007f]/u.test(exact)) {
    throw new TypeError(`${label} is invalid.`);
  }
  return exact;
}

function requireCompactJwt(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} is invalid.`);
  }
  const exact = requireOpaqueCredential(value, label);
  if (!COMPACT_JWT_PATTERN.test(exact)) {
    throw new TypeError(`${label} must be a compact JWT.`);
  }
  return exact;
}

function readExactHttpsUrl(value: string, pathname: string, label: string): URL {
  const exact = requireExactString(value, label);
  let url: URL;
  try {
    url = new URL(exact);
  } catch {
    throw new TypeError(`${label} must be an exact HTTPS URL.`);
  }
  if (
    url.protocol !== "https:"
    || url.username.length > 0
    || url.password.length > 0
    || url.hostname.length === 0
    || url.pathname !== pathname
    || url.search.length > 0
    || url.hash.length > 0
  ) {
    throw new TypeError(`${label} must be an exact HTTPS URL with path ${pathname}.`);
  }
  return url;
}

function requirePort(value: string, label: string): number {
  if (!/^[0-9]{1,5}$/u.test(value)) {
    throw new TypeError(`${label} port is invalid.`);
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError(`${label} port is invalid.`);
  }
  return port;
}

function encodeBoundedUtf8(value: unknown, maxBytes: number, label: string): OwnedBytes {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string.`);
  }
  if (Buffer.byteLength(value, "utf8") > maxBytes) {
    throw new TypeError(`${label} exceeds ${maxBytes} bytes.`);
  }
  return new TextEncoder().encode(value);
}

function copyBoundedBytes(value: unknown, maxBytes: number, label: string): OwnedBytes {
  if (!(value instanceof Uint8Array)) {
    throw new TypeError(`${label} must be bytes.`);
  }
  if (value.byteLength > maxBytes) {
    throw new TypeError(`${label} exceeds ${maxBytes} bytes.`);
  }
  return new Uint8Array(value);
}

function encodeBase64(value: Uint8Array): string {
  return Buffer.from(value).toString("base64");
}

function decodeBoundedBase64(value: unknown, maxBytes: number, label: string): OwnedBytes {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be canonical base64.`);
  }
  if (value.length > Math.ceil(maxBytes / 3) * 4) {
    throw new TypeError(`${label} exceeds ${maxBytes} bytes.`);
  }
  if (!BASE64_PATTERN.test(value)) {
    throw new TypeError(`${label} must be canonical base64.`);
  }
  const decoded = new Uint8Array(Buffer.from(value, "base64"));
  if (decoded.byteLength === 0 || decoded.byteLength > maxBytes) {
    decoded.fill(0);
    throw new TypeError(`${label} exceeds ${maxBytes} bytes.`);
  }
  if (encodeBase64(decoded) !== value) {
    decoded.fill(0);
    throw new TypeError(`${label} must be canonical base64.`);
  }
  return decoded;
}

function parseLocalP256PrivateJwk(value: string, label: string): JsonWebKey {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new TypeError(`${label} must be valid P-256 EC private JWK JSON.`);
  }
  if (!isRecord(parsed)) {
    throw new TypeError(`${label} must be a P-256 EC private JWK.`);
  }
  if (
    parsed.kty !== "EC"
    || parsed.crv !== "P-256"
    || typeof parsed.x !== "string"
    || typeof parsed.y !== "string"
    || typeof parsed.d !== "string"
    || parsed.x.length === 0
    || parsed.y.length === 0
    || parsed.d.length === 0
  ) {
    throw new TypeError(`${label} must be a P-256 EC private JWK.`);
  }
  return {
    crv: "P-256",
    d: parsed.d,
    kty: "EC",
    x: parsed.x,
    y: parsed.y,
  };
}

function decodeFixedBase64Key(value: string, label: string): OwnedBytes {
  const decoded = decodeBoundedBase64(value, LOCAL_KMS_KEY_BYTES, label);
  if (decoded.byteLength !== LOCAL_KMS_KEY_BYTES) {
    decoded.fill(0);
    throw new TypeError(`${label} must decode to exactly ${LOCAL_KMS_KEY_BYTES} bytes.`);
  }
  return decoded;
}

function localKmsAad(input: {
  additionalAuthenticatedData: string;
  keyName: string;
}): OwnedBytes {
  return encodeBoundedUtf8(
    JSON.stringify({
      additionalAuthenticatedData: input.additionalAuthenticatedData,
      keyName: input.keyName,
      schema: "murph.hosted-local-kms.v1",
    }),
    GCP_KMS_MAX_PLAINTEXT_AND_AAD_BYTES,
    "Local KMS additionalAuthenticatedData",
  );
}

function localKmsMacInput(input: {
  data: Uint8Array;
  keyVersionName: string;
}): OwnedBytes {
  const domain = new TextEncoder().encode(
    `${input.keyVersionName}\u0000murph.hosted-local-kms.mac.v1\u0000`,
  );
  try {
    return concatBytes(domain, input.data);
  } finally {
    domain.fill(0);
  }
}

function concatBytes(left: Uint8Array, right: Uint8Array): OwnedBytes {
  const out = new Uint8Array(left.byteLength + right.byteLength);
  out.set(left, 0);
  out.set(right, left.byteLength);
  return out;
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGoogleAuthTransport(value: unknown): value is OAuth2Client["transporter"] {
  if (!isRecord(value)) {
    return false;
  }
  const interceptors = Reflect.get(value, "interceptors");
  if (!isRecord(interceptors)) {
    return false;
  }
  const request = Reflect.get(interceptors, "request");
  return isRecord(request) && typeof Reflect.get(request, "add") === "function";
}
