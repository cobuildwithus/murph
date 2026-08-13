import { Buffer } from "node:buffer";

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
    readonly innerApiCalls: Record<string, Function>;

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

    async initialize(): Promise<Record<string, Function>> {
      return this.innerApiCalls;
    }
  }

  return { KeyManagementServiceClient, protos: {} };
});

vi.mock("google-auth-library", () => {
  function createTransport(kind: "iam" | "sts") {
    const interceptors: Array<{
      resolved(request: Record<PropertyKey, unknown>): Promise<Record<PropertyKey, unknown>>;
    }> = [];
    return {
      interceptors: {
        request: {
          add(interceptor: typeof interceptors[number]) {
            interceptors.push(interceptor);
          },
        },
      },
      async request(options: Record<PropertyKey, unknown>) {
        let resolved = options;
        for (const interceptor of interceptors) {
          resolved = await interceptor.resolved(resolved);
        }
        const captured = { kind, options: resolved } satisfies CapturedAuthRequest;
        googleSdkMocks.authRequests.push(captured);
        if (googleSdkMocks.authRequest) {
          return googleSdkMocks.authRequest(captured);
        }
        return kind === "sts"
          ? { data: { access_token: "federated-token" } }
          : { data: { accessToken: "impersonated-token" } };
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

afterEach(() => {
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
