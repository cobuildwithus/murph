import { Buffer } from "node:buffer";

import { getVercelOidcToken } from "@vercel/oidc";
import { afterEach, describe, expect, it, vi } from "vitest";

interface CapturedAuthRequest {
  kind: "iam" | "sts";
  options: Record<PropertyKey, unknown>;
}

interface CapturedKmsCall {
  canceled: boolean;
  method: string;
  options: Record<PropertyKey, unknown>;
  request: Record<PropertyKey, unknown>;
}

type FakeKmsApiCall = (
  request: Record<PropertyKey, unknown>,
  options: Record<PropertyKey, unknown>,
) => Promise<[unknown, null, null]> & { cancel(): void };

const googleSdkMocks = vi.hoisted(() => ({
  authClients: [] as object[],
  authRequest: null as null | ((input: CapturedAuthRequest) => Promise<unknown>),
  authRequests: [] as CapturedAuthRequest[],
  kmsCall: null as null | ((input: CapturedKmsCall) => Promise<unknown>),
  kmsCalls: [] as CapturedKmsCall[],
  kmsClients: [] as Array<{ options: Record<PropertyKey, unknown> }>,
}));

vi.mock("@google-cloud/kms", () => {
  class KeyManagementServiceClient {
    readonly innerApiCalls: Record<string, FakeKmsApiCall>;

    constructor(readonly options: Record<PropertyKey, unknown>) {
      googleSdkMocks.kmsClients.push(this);
      this.innerApiCalls = Object.fromEntries(
        ["asymmetricSign", "decrypt", "encrypt", "macSign"].map((method) => [
          method,
          (request: Record<PropertyKey, unknown>, options: Record<PropertyKey, unknown>) => {
            const captured: CapturedKmsCall = {
              canceled: false,
              method,
              options,
              request,
            };
            googleSdkMocks.kmsCalls.push(captured);
            let rejectCall: (error: unknown) => void = () => undefined;
            let settled = false;
            const promise = new Promise<[unknown, null, null]>((resolve, reject) => {
              rejectCall = reject;
              void (async () => {
                const authClient = this.options.authClient;
                if (!isRecord(authClient) || typeof authClient.getRequestHeaders !== "function") {
                  throw new Error("Fake KMS client requires an auth client.");
                }
                await authClient.getRequestHeaders();
                if (settled) {
                  return;
                }
                const response = googleSdkMocks.kmsCall
                  ? await googleSdkMocks.kmsCall(captured)
                  : defaultKmsResponse(captured);
                if (!settled) {
                  settled = true;
                  resolve([response, null, null]);
                }
              })().catch((error: unknown) => {
                if (!settled) {
                  settled = true;
                  reject(error);
                }
              });
            }) as Promise<[unknown, null, null]> & { cancel(): void };
            promise.cancel = () => {
              if (!settled) {
                captured.canceled = true;
                settled = true;
                rejectCall(Object.assign(new Error("cancelled"), { code: 1 }));
              }
            };
            return promise;
          },
        ]),
      );
    }

    async initialize(): Promise<Record<string, FakeKmsApiCall>> {
      return this.innerApiCalls;
    }
  }

  return { KeyManagementServiceClient, protos: {} };
});

vi.mock("google-auth-library", () => {
  function createTransport(kind: "iam" | "sts") {
    const requestInterceptors: Array<{
      resolved(request: Record<PropertyKey, unknown>): Promise<Record<PropertyKey, unknown>>;
    }> = [];
    const responseInterceptors: Array<{
      rejected?(error: unknown): void;
      resolved?(response: unknown): Promise<unknown>;
    }> = [];
    return {
      interceptors: {
        request: {
          add(interceptor: typeof requestInterceptors[number]) {
            requestInterceptors.push(interceptor);
          },
        },
        response: {
          add(interceptor: typeof responseInterceptors[number]) {
            responseInterceptors.push(interceptor);
          },
        },
      },
      async request(options: Record<PropertyKey, unknown>) {
        let resolved = options;
        for (const interceptor of requestInterceptors) {
          resolved = await interceptor.resolved(resolved);
        }
        const captured = { kind, options: resolved } satisfies CapturedAuthRequest;
        googleSdkMocks.authRequests.push(captured);
        try {
          let response: unknown = googleSdkMocks.authRequest
            ? await googleSdkMocks.authRequest(captured)
            : kind === "sts"
              ? { data: { access_token: "federated-token" } }
              : { data: { accessToken: "impersonated-token" } };
          for (const interceptor of responseInterceptors) {
            if (interceptor.resolved) {
              response = await interceptor.resolved(response);
            }
          }
          return response;
        } catch (error) {
          for (const interceptor of responseInterceptors) {
            interceptor.rejected?.(error);
          }
          throw error;
        }
      },
    };
  }

  class IdentityPoolClient {
    readonly options: Record<PropertyKey, unknown>;
    readonly stsCredential = { transporter: createTransport("sts") };
    readonly transporter = createTransport("iam");
    readonly universeDomain = "googleapis.com";
    private accessToken: string | null = null;
    private pendingAccessToken: Promise<{ token: string }> | null = null;

    constructor(options: Record<PropertyKey, unknown>) {
      this.options = options;
      googleSdkMocks.authClients.push(this);
    }

    getAccessToken(): Promise<{ token: string }> {
      if (this.accessToken) {
        return Promise.resolve({ token: this.accessToken });
      }
      if (!this.pendingAccessToken) {
        this.pendingAccessToken = this.refreshAccessToken().finally(() => {
          this.pendingAccessToken = null;
        });
      }
      return this.pendingAccessToken;
    }

    async getRequestHeaders(): Promise<Headers> {
      const accessToken = await this.getAccessToken();
      return new Headers({ authorization: `Bearer ${accessToken.token}` });
    }

    private async refreshAccessToken(): Promise<{ token: string }> {
      const supplier = this.options.subject_token_supplier;
      if (!isRecord(supplier) || typeof supplier.getSubjectToken !== "function") {
        throw new Error("Fake IdentityPoolClient requires a subject-token supplier.");
      }
      await supplier.getSubjectToken({
        audience: this.options.audience,
        subjectTokenType: this.options.subject_token_type,
      });
      await this.stsCredential.transporter.request({
        method: "POST",
        retry: true,
        retryConfig: { retry: 3 },
      });
      const response = await this.transporter.request({
        method: "POST",
        retry: true,
        retryConfig: { retry: 3 },
      });
      if (!isRecord(response) || !isRecord(response.data) || typeof response.data.accessToken !== "string") {
        throw new Error("Fake IAM response is invalid.");
      }
      this.accessToken = response.data.accessToken;
      return { token: this.accessToken };
    }
  }

  class OAuth2Client {
    readonly transporter = createTransport("iam");
    readonly universeDomain = "googleapis.com";
    private accessToken = "";

    constructor(readonly options: Record<PropertyKey, unknown>) {
      googleSdkMocks.authClients.push(this);
    }

    setCredentials(credentials: Record<PropertyKey, unknown>): void {
      this.accessToken = String(credentials.access_token ?? "");
    }

    async getRequestHeaders(): Promise<Headers> {
      return new Headers({ authorization: `Bearer ${this.accessToken}` });
    }
  }

  return { IdentityPoolClient, OAuth2Client };
});

vi.mock("@vercel/oidc", () => ({
  getVercelOidcToken: vi.fn(async () =>
    "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJob3N0ZWQtdGVzdCJ9.synthetic-signature"),
}));

import {
  createHostedGcpKmsClientFromEnv,
  HostedGcpKmsIntegrityError,
} from "../src/lib/hosted-crypto/gcp-kms";

const KMS_KEY_NAME =
  "projects/murph-test/locations/global/keyRings/hosted-test/cryptoKeys/web-wrap";
const SIGN_KEY_VERSION_NAME =
  "projects/murph-test/locations/global/keyRings/hosted-test/cryptoKeys/authority-sign/cryptoKeyVersions/3";
const MAC_KEY_VERSION_NAME =
  "projects/murph-test/locations/global/keyRings/hosted-test/cryptoKeys/address-book-mac/cryptoKeyVersions/5";
const STATIC_ENV = {
  HOSTED_CRYPTO_ALLOW_STATIC_GCP_ACCESS_TOKEN_FOR_DEV: "1",
  HOSTED_CRYPTO_ENV: "dev",
  HOSTED_CRYPTO_GCP_ACCESS_TOKEN: "ya29.synthetic-static-token",
  NODE_ENV: "test",
} satisfies NodeJS.ProcessEnv;
const WORKLOAD_IDENTITY_ENV = {
  HOSTED_CRYPTO_ENV: "production",
  HOSTED_CRYPTO_GCP_PROJECT_NUMBER: "123456789012",
  HOSTED_CRYPTO_GCP_SERVICE_ACCOUNT_EMAIL:
    "hosted-crypto@murph-test.iam.gserviceaccount.com",
  HOSTED_CRYPTO_GCP_WORKLOAD_IDENTITY_POOL_ID: "vercel-pool",
  HOSTED_CRYPTO_GCP_WORKLOAD_IDENTITY_PROVIDER_ID: "vercel-provider",
  NODE_ENV: "test",
} satisfies NodeJS.ProcessEnv;
const mockedGetVercelOidcToken = vi.mocked(getVercelOidcToken);

afterEach(() => {
  vi.restoreAllMocks();
  mockedGetVercelOidcToken.mockReset();
  mockedGetVercelOidcToken.mockResolvedValue(
    "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJob3N0ZWQtdGVzdCJ9.synthetic-signature",
  );
  googleSdkMocks.authClients.length = 0;
  googleSdkMocks.authRequest = null;
  googleSdkMocks.authRequests.length = 0;
  googleSdkMocks.kmsCall = null;
  googleSdkMocks.kmsCalls.length = 0;
});

describe("official Google Cloud KMS SDK boundary", () => {
  it("uses the official client resources with cancellable no-retry unary calls and CRC wrappers", async () => {
    const client = createHostedGcpKmsClientFromEnv(STATIC_ENV);

    await expect(client.encrypt({
      additionalAuthenticatedData: "domain=control",
      keyName: KMS_KEY_NAME,
      plaintext: new Uint8Array([1, 2, 3]),
    })).resolves.toEqual({
      ciphertext: Buffer.from(new Uint8Array([4, 5, 6])).toString("base64"),
      keyName: KMS_KEY_NAME,
    });
    await client.decrypt({
      additionalAuthenticatedData: "domain=control",
      ciphertext: Buffer.from(new Uint8Array([7, 8, 9])).toString("base64"),
      keyName: KMS_KEY_NAME,
    });
    await client.asymmetricSign({
      keyVersionName: SIGN_KEY_VERSION_NAME,
      message: new Uint8Array([1, 2, 3]),
    });
    await client.macSign({
      data: new Uint8Array([1, 2, 3]),
      keyVersionName: MAC_KEY_VERSION_NAME,
    });

    expect(googleSdkMocks.kmsClients).toHaveLength(1);
    expect(googleSdkMocks.kmsClients[0]?.options).toMatchObject({
      apiEndpoint: "cloudkms.googleapis.com",
      fallback: false,
      port: 443,
      scopes: ["https://www.googleapis.com/auth/cloudkms"],
      universeDomain: "googleapis.com",
    });
    expect(googleSdkMocks.kmsCalls.map((call) => call.method)).toEqual([
      "encrypt",
      "decrypt",
      "asymmetricSign",
      "macSign",
    ]);
    expect(googleSdkMocks.kmsCalls.every((call) =>
      call.options.retry === null
      && typeof call.options.timeout === "number"
      && call.options.timeout > 0
      && !call.canceled
    )).toBe(true);
    const encryptRequest = googleSdkMocks.kmsCalls[0]?.request;
    expect(googleSdkMocks.kmsCalls[0]?.options.otherArgs).toEqual({
      headers: {
        "x-goog-request-params": `name=${encodeURIComponent(KMS_KEY_NAME)}`,
      },
    });
    expect(encryptRequest?.plaintextCrc32c).toEqual({ value: 0xf130f21e });
    expect(encryptRequest?.additionalAuthenticatedDataCrc32c).toEqual({ value: 0x481d3603 });
  });

  it("rejects malformed high-bit CRC wrappers and missing provider verification flags", async () => {
    const responseBytes = new Uint8Array([4, 5, 6]);
    for (const response of [
      {
        ciphertext: responseBytes,
        ciphertextCrc32c: { high: 1, low: crc32c(responseBytes) | 0 },
        name: `${KMS_KEY_NAME}/cryptoKeyVersions/1`,
        verifiedAdditionalAuthenticatedDataCrc32c: true,
        verifiedPlaintextCrc32c: true,
      },
      {
        ciphertext: responseBytes,
        ciphertextCrc32c: { high: 0, low: crc32c(responseBytes) | 0 },
        name: `${KMS_KEY_NAME}/cryptoKeyVersions/1`,
        verifiedAdditionalAuthenticatedDataCrc32c: true,
        verifiedPlaintextCrc32c: null,
      },
    ]) {
      googleSdkMocks.kmsCall = async () => response;
      const client = createHostedGcpKmsClientFromEnv(STATIC_ENV);
      await expect(client.encrypt({
        additionalAuthenticatedData: "domain=control",
        keyName: KMS_KEY_NAME,
        plaintext: new Uint8Array([1, 2, 3]),
      })).rejects.toBeInstanceOf(HostedGcpKmsIntegrityError);
    }
  });

  it("bounds and disables retries on both internal STS and IAM impersonation transports", async () => {
    const client = createHostedGcpKmsClientFromEnv(WORKLOAD_IDENTITY_ENV);
    await client.encrypt({
      additionalAuthenticatedData: "domain=control",
      keyName: KMS_KEY_NAME,
      plaintext: new Uint8Array([1, 2, 3]),
    });

    expect(googleSdkMocks.authRequests.map((request) => request.kind)).toEqual(["sts", "iam"]);
    for (const request of googleSdkMocks.authRequests) {
      expect(request.options).toMatchObject({
        retry: false,
        retryConfig: { retry: 0 },
      });
      expect(request.options.timeout).toEqual(expect.any(Number));
      expect(Number(request.options.timeout)).toBeGreaterThan(0);
      expect(Number(request.options.timeout)).toBeLessThanOrEqual(10_000);
      expect(request.options.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("retries one transient Decrypt call without repeating cold Workload Identity refresh", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const recoveryLog = vi.spyOn(console, "info").mockImplementation(() => undefined);
    let decryptCalls = 0;
    googleSdkMocks.kmsCall = async (call) => {
      if (call.method !== "decrypt") {
        return defaultKmsResponse(call);
      }
      decryptCalls += 1;
      if (decryptCalls === 1) {
        throw { code: 14 };
      }
      return defaultKmsResponse(call);
    };

    try {
      const client = createHostedGcpKmsClientFromEnv(WORKLOAD_IDENTITY_ENV);
      await expect(client.decrypt({
        additionalAuthenticatedData: "domain=control",
        ciphertext: Buffer.from(new Uint8Array([7, 8, 9])).toString("base64"),
        keyName: KMS_KEY_NAME,
      })).resolves.toEqual({ plaintext: new Uint8Array([1, 2, 3]) });

      expect(decryptCalls).toBe(2);
      expect(googleSdkMocks.authRequests.map((request) => request.kind)).toEqual(["sts", "iam"]);
      expect(googleSdkMocks.kmsCalls).toHaveLength(2);
      expect(googleSdkMocks.kmsCalls.every((call) =>
        call.method === "decrypt"
        && call.options.retry === null
        && typeof call.options.timeout === "number"
        && Number(call.options.timeout) > 0
        && Number(call.options.timeout) <= 10_000
      )).toBe(true);
      expect(warning).toHaveBeenCalledWith(
        "Hosted Google Cloud KMS decrypt retrying after a transient failure.",
        expect.objectContaining({
          failureStage: "kms_rpc",
          providerReason: "UNAVAILABLE",
          workloadIdentityRefreshObserved: true,
        }),
      );
      expect(recoveryLog).toHaveBeenCalledWith(
        "Hosted Google Cloud KMS decrypt recovered after retry.",
        expect.objectContaining({
          outcome: "recovered",
          providerReason: "RECOVERED",
        }),
      );
      expect(recoveryLog.mock.calls[0]?.[1]).not.toHaveProperty("failureStage");
      expect(recoveryLog.mock.calls[0]?.[1]).not.toHaveProperty("completionStage");
    } finally {
      random.mockRestore();
      recoveryLog.mockRestore();
      warning.mockRestore();
    }
  });

  it.each([
    { failureStage: "sts_exchange", kind: "sts" as const },
    { failureStage: "service_account_impersonation", kind: "iam" as const },
  ])("identifies a terminal $kind authentication failure", async ({
    failureStage,
    kind,
  }) => {
    const failureLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    googleSdkMocks.authRequest = async (request) => {
      if (request.kind === kind) {
        throw Object.assign(new Error("secret provider detail"), {
          code: "PERMISSION_DENIED",
          response: { status: 403 },
        });
      }
      return { data: { access_token: "federated-token" } };
    };

    const client = createHostedGcpKmsClientFromEnv(WORKLOAD_IDENTITY_ENV);
    await expect(client.decrypt({
      additionalAuthenticatedData: "domain=control",
      ciphertext: Buffer.from(new Uint8Array([7, 8, 9])).toString("base64"),
      keyName: KMS_KEY_NAME,
    })).rejects.toMatchObject({ providerReason: "PERMISSION_DENIED" });

    expect(failureLog).toHaveBeenCalledWith(
      "Hosted Google Cloud KMS operation failed.",
      expect.objectContaining({
        additionalAuthenticatedDataBytes: Buffer.byteLength("domain=control"),
        attempt: 1,
        failureStage,
        operation: "decrypt",
        outcome: "failed",
        providerPayloadBytes: 3,
        providerReason: "PERMISSION_DENIED",
        workloadIdentityRefreshObserved: true,
      }),
    );
    expect(JSON.stringify(failureLog.mock.calls)).not.toContain("secret provider detail");
    expect(JSON.stringify(failureLog.mock.calls)).not.toContain(KMS_KEY_NAME);
  });

  it("identifies a terminal subject-token failure without logging token material", async () => {
    const failureLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockedGetVercelOidcToken.mockRejectedValueOnce(
      Object.assign(new Error("secret oidc material"), { code: "PERMISSION_DENIED" }),
    );

    const client = createHostedGcpKmsClientFromEnv(WORKLOAD_IDENTITY_ENV);
    await expect(client.decrypt({
      additionalAuthenticatedData: "domain=control",
      ciphertext: Buffer.from(new Uint8Array([7, 8, 9])).toString("base64"),
      keyName: KMS_KEY_NAME,
    })).rejects.toMatchObject({ providerReason: "PERMISSION_DENIED" });

    expect(failureLog).toHaveBeenCalledWith(
      "Hosted Google Cloud KMS operation failed.",
      expect.objectContaining({
        failureStage: "subject_token",
        outcome: "failed",
        providerReason: "PERMISSION_DENIED",
        subjectTokenElapsedMs: expect.any(Number),
        workloadIdentityRefreshObserved: true,
      }),
    );
    expect(JSON.stringify(failureLog.mock.calls)).not.toContain("secret oidc material");
  });

  it("cancels a timed-out official Decrypt call before retrying within the aggregate deadline", async () => {
    const aggregateDeadline = new AbortController();
    const firstAttemptDeadline = new AbortController();
    const secondAttemptDeadline = new AbortController();
    const deadlineSignals = [
      aggregateDeadline.signal,
      firstAttemptDeadline.signal,
      secondAttemptDeadline.signal,
    ];
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      const signal = deadlineSignals.shift();
      if (!signal) {
        throw new Error("Unexpected Google KMS deadline allocation.");
      }
      return signal;
    });
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let decryptCalls = 0;
    googleSdkMocks.kmsCall = async (call) => {
      if (call.method !== "decrypt") {
        return defaultKmsResponse(call);
      }
      decryptCalls += 1;
      if (decryptCalls === 1) {
        return new Promise<never>(() => undefined);
      }
      return defaultKmsResponse(call);
    };

    try {
      const client = createHostedGcpKmsClientFromEnv(STATIC_ENV);
      const operation = client.decrypt({
        additionalAuthenticatedData: "domain=control",
        ciphertext: Buffer.from(new Uint8Array([7, 8, 9])).toString("base64"),
        keyName: KMS_KEY_NAME,
      });

      await vi.waitFor(() => expect(googleSdkMocks.kmsCalls).toHaveLength(1));
      firstAttemptDeadline.abort();

      await expect(operation).resolves.toEqual({ plaintext: new Uint8Array([1, 2, 3]) });
      expect(decryptCalls).toBe(2);
      expect(googleSdkMocks.kmsCalls).toHaveLength(2);
      expect(googleSdkMocks.kmsCalls[0]?.canceled).toBe(true);
      expect(googleSdkMocks.kmsCalls[1]?.canceled).toBe(false);
      expect(aggregateDeadline.signal.aborted).toBe(false);
      expect(secondAttemptDeadline.signal.aborted).toBe(false);
      expect(deadlineSignals).toHaveLength(0);
      expect(timeout).toHaveBeenCalledTimes(3);
      expect(warning).toHaveBeenCalledWith(
        "Hosted Google Cloud KMS decrypt retrying after a transient failure.",
        expect.objectContaining({ providerReason: "DEADLINE_EXCEEDED" }),
      );
    } finally {
      timeout.mockRestore();
      random.mockRestore();
      warning.mockRestore();
    }
  });

  it("does not let one caller abort cancel a shared cold Workload Identity refresh", async () => {
    let releaseSts: (value: unknown) => void = () => undefined;
    const pendingSts = new Promise<unknown>((resolve) => {
      releaseSts = resolve;
    });
    googleSdkMocks.authRequest = async (request) => {
      if (request.kind === "sts") {
        return pendingSts;
      }
      return { data: { accessToken: "impersonated-token" } };
    };
    const client = createHostedGcpKmsClientFromEnv(WORKLOAD_IDENTITY_ENV);
    const caller = new AbortController();
    const first = client.encrypt({
      additionalAuthenticatedData: "domain=control",
      keyName: KMS_KEY_NAME,
      plaintext: new Uint8Array([1]),
      signal: caller.signal,
    });
    await vi.waitFor(() => expect(googleSdkMocks.authRequests).toHaveLength(1));
    const second = client.encrypt({
      additionalAuthenticatedData: "domain=control",
      keyName: KMS_KEY_NAME,
      plaintext: new Uint8Array([2]),
    });

    caller.abort(new Error("caller-only cancellation"));
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    const authSignal = googleSdkMocks.authRequests[0]?.options.signal;
    if (!(authSignal instanceof AbortSignal)) {
      throw new Error("Expected a bounded authentication signal.");
    }
    expect(authSignal.aborted).toBe(false);
    releaseSts({ data: { access_token: "federated-token" } });
    await expect(second).resolves.toMatchObject({ keyName: KMS_KEY_NAME });
    expect(googleSdkMocks.kmsCalls[0]?.canceled).toBe(true);
    expect(googleSdkMocks.authRequests.map((request) => request.kind)).toEqual(["sts", "iam"]);
  });

  it("retains the exact stage when a shared cold authentication refresh fails", async () => {
    const failureLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const stsControl: { reject: ((reason?: unknown) => void) | null } = {
      reject: null,
    };
    const pendingSts = new Promise<unknown>((_resolve, reject) => {
      stsControl.reject = reject;
    });
    googleSdkMocks.authRequest = async (request) => {
      if (request.kind === "sts") {
        return await pendingSts;
      }
      return { data: { accessToken: "impersonated-token" } };
    };
    const client = createHostedGcpKmsClientFromEnv(WORKLOAD_IDENTITY_ENV);
    const caller = new AbortController();
    const first = client.encrypt({
      additionalAuthenticatedData: "domain=control",
      keyName: KMS_KEY_NAME,
      plaintext: new Uint8Array([1]),
      signal: caller.signal,
    });
    await vi.waitFor(() => expect(googleSdkMocks.authRequests).toHaveLength(1));
    const second = client.encrypt({
      additionalAuthenticatedData: "domain=control",
      keyName: KMS_KEY_NAME,
      plaintext: new Uint8Array([2]),
    });

    caller.abort(new Error("caller-only cancellation"));
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    const rejectSts = stsControl.reject;
    if (!rejectSts) {
      throw new Error("Expected a pending shared STS request.");
    }
    rejectSts(Object.assign(new Error("redacted shared STS failure"), {
      code: "UNAVAILABLE",
    }));

    await expect(second).rejects.toMatchObject({ providerReason: "UNAVAILABLE" });
    expect(failureLog).toHaveBeenCalledWith(
      "Hosted Google Cloud KMS operation failed.",
      expect.objectContaining({
        failureStage: "sts_exchange",
        outcome: "failed",
        providerReason: "UNAVAILABLE",
        workloadIdentityRefreshObserved: true,
      }),
    );
  });
});

function defaultKmsResponse(call: CapturedKmsCall): Record<PropertyKey, unknown> {
  if (call.method === "encrypt") {
    const ciphertext = new Uint8Array([4, 5, 6]);
    return {
      ciphertext,
      ciphertextCrc32c: { high: 0, low: crc32c(ciphertext) | 0 },
      name: `${String(call.request.name)}/cryptoKeyVersions/1`,
      verifiedAdditionalAuthenticatedDataCrc32c: true,
      verifiedPlaintextCrc32c: true,
    };
  }
  if (call.method === "decrypt") {
    const plaintext = new Uint8Array([1, 2, 3]);
    return {
      plaintext,
      plaintextCrc32c: { high: 0, low: crc32c(plaintext) | 0 },
      usedPrimary: true,
    };
  }
  if (call.method === "asymmetricSign") {
    const signature = new Uint8Array([8, 9, 10]);
    return {
      name: call.request.name,
      signature,
      signatureCrc32c: { high: 0, low: crc32c(signature) | 0 },
      verifiedDigestCrc32c: true,
    };
  }
  const mac = new Uint8Array(32).fill(7);
  return {
    mac,
    macCrc32c: { high: 0, low: crc32c(mac) | 0 },
    name: call.request.name,
    verifiedDataCrc32c: true,
  };
}

function crc32c(value: Uint8Array): number {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let entry = index;
    for (let bit = 0; bit < 8; bit += 1) {
      entry = (entry & 1) === 1
        ? 0x82f63b78 ^ (entry >>> 1)
        : entry >>> 1;
    }
    table[index] = entry >>> 0;
  }
  let crc = 0xffffffff;
  for (const byte of value) {
    crc = table[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
