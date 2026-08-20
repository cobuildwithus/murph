import { createRequire } from "node:module";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/oidc", () => ({
  getVercelOidcToken: vi.fn(async () =>
    "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJob3N0ZWQtdGVzdCJ9.synthetic-signature"
  ),
}));

import { createHostedGcpKmsClientFromEnv } from "../src/lib/hosted-crypto/gcp-kms";

interface CapturedAuthRequest {
  retry?: unknown;
  retryConfig?: unknown;
  signal?: unknown;
  timeout?: unknown;
  url?: unknown;
}

interface PrototypeStub {
  descriptor: PropertyDescriptor;
  property: string;
  target: object;
}

const KMS_KEY_NAME =
  "projects/murph-test/locations/global/keyRings/hosted-test/cryptoKeys/web-wrap";
const SECRET_PROVIDER_DETAIL = "secret-real-sdk-provider-detail";
const WORKLOAD_IDENTITY_ENV = {
  HOSTED_CRYPTO_ENV: "production",
  HOSTED_CRYPTO_GCP_PROJECT_NUMBER: "123456789012",
  HOSTED_CRYPTO_GCP_SERVICE_ACCOUNT_EMAIL:
    "hosted-crypto@murph-test.iam.gserviceaccount.com",
  HOSTED_CRYPTO_GCP_WORKLOAD_IDENTITY_POOL_ID: "vercel-pool",
  HOSTED_CRYPTO_GCP_WORKLOAD_IDENTITY_PROVIDER_ID: "vercel-provider",
  NODE_ENV: "test",
} satisfies NodeJS.ProcessEnv;
const requireFromTest = createRequire(import.meta.url);
const requireFromGoogleAuth = createRequire(requireFromTest.resolve("google-auth-library"));
const requireFromKms = createRequire(requireFromTest.resolve("@google-cloud/kms"));
const prototypeStubs: PrototypeStub[] = [];

afterEach(() => {
  while (prototypeStubs.length > 0) {
    const stub = prototypeStubs.pop();
    if (stub) {
      Object.defineProperty(stub.target, stub.property, stub.descriptor);
    }
  }
  vi.restoreAllMocks();
});

describe("installed Google Cloud KMS SDK boundary", () => {
  it("retains shared STS failure provenance through the real auth wrapper", async () => {
    const authRequests: CapturedAuthRequest[] = [];
    const failureLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let authHeaderRequests = 0;
    const stsControl: { release: (() => void) | null } = { release: null };
    const pendingSts = new Promise<void>((resolve) => {
      stsControl.release = resolve;
    });

    installPrototypeStub(
      requireConstructorPrototype(requireFromGoogleAuth("gaxios"), "Gaxios"),
      "_defaultAdapter",
      async (config: unknown) => {
        if (!isRecord(config)) {
          throw new TypeError("Expected a prepared Gaxios request.");
        }
        authRequests.push(config);
        await pendingSts;
        const data = {
          error: "temporarily_unavailable",
          error_description: SECRET_PROVIDER_DETAIL,
        };
        return Object.assign(
          new Response(JSON.stringify(data), {
            headers: { "content-type": "application/json" },
            status: 503,
          }),
          { config, data },
        );
      },
    );
    installPrototypeStub(
      requireConstructorPrototype(requireFromKms("google-gax"), "GrpcClient"),
      "createStub",
      async function(this: object) {
        const googleAuth = Reflect.get(this, "auth");
        if (!isRecord(googleAuth)) {
          throw new TypeError("Expected the real Google KMS auth owner.");
        }
        const getClient = googleAuth.getClient;
        if (typeof getClient !== "function") {
          throw new TypeError("Expected the real Google KMS auth owner.");
        }
        const makeCall = () => (...args: unknown[]) => {
          const callback = args.at(-1);
          if (typeof callback !== "function") {
            throw new TypeError("Expected a Google GAX unary callback.");
          }
          let canceled = false;
          void Promise.resolve(Reflect.apply(getClient, googleAuth, []))
            .then((authClient: unknown) => {
              if (!isRecord(authClient)) {
                throw new TypeError("Expected the configured Google auth client.");
              }
              const getRequestHeaders = authClient.getRequestHeaders;
              if (typeof getRequestHeaders !== "function") {
                throw new TypeError("Expected the configured Google auth client.");
              }
              const request = Reflect.apply(getRequestHeaders, authClient, []);
              authHeaderRequests += 1;
              return request;
            })
            .then(
              () => {
                if (!canceled) {
                  Reflect.apply(callback, undefined, [null, {}]);
                }
              },
              (error: unknown) => {
                if (!canceled) {
                  Reflect.apply(callback, undefined, [error]);
                }
              },
            );
          return {
            cancel() {
              canceled = true;
            },
          };
        };
        return {
          asymmetricSign: makeCall(),
          decrypt: makeCall(),
          encrypt: makeCall(),
          macSign: makeCall(),
        };
      },
    );

    const client = createHostedGcpKmsClientFromEnv(WORKLOAD_IDENTITY_ENV);
    const caller = new AbortController();
    const first = client.encrypt({
      additionalAuthenticatedData: "domain=control",
      keyName: KMS_KEY_NAME,
      plaintext: new Uint8Array([1]),
      signal: caller.signal,
    });
    await vi.waitFor(() => expect(authRequests).toHaveLength(1));
    const second = client.encrypt({
      additionalAuthenticatedData: "domain=control",
      keyName: KMS_KEY_NAME,
      plaintext: new Uint8Array([2]),
    });
    await vi.waitFor(() => expect(authHeaderRequests).toBe(2));

    caller.abort(new Error("synthetic caller-only cancellation"));
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    const release = stsControl.release;
    if (!release) {
      throw new Error("Expected a pending real-SDK STS request.");
    }
    release();
    await expect(second).rejects.toMatchObject({ providerReason: "http_503" });

    expect(authRequests).toHaveLength(1);
    expect(authRequests[0]).toMatchObject({
      retry: false,
      retryConfig: { retry: 0 },
      signal: expect.any(AbortSignal),
      timeout: expect.any(Number),
    });
    expect(Number(authRequests[0]?.timeout)).toBeGreaterThan(0);
    expect(Number(authRequests[0]?.timeout)).toBeLessThanOrEqual(10_000);
    expect(failureLog).toHaveBeenCalledWith(
      "Hosted Google Cloud KMS operation failed.",
      expect.objectContaining({
        failureStage: "sts_exchange",
        outcome: "failed",
        providerReason: "http_503",
        workloadIdentityRefreshObserved: true,
      }),
    );
    const serializedLogs = JSON.stringify(failureLog.mock.calls);
    expect(serializedLogs).not.toContain(SECRET_PROVIDER_DETAIL);
    expect(serializedLogs).not.toContain("synthetic-signature");
    expect(serializedLogs).not.toContain(KMS_KEY_NAME);
  });
});

function installPrototypeStub(
  target: object,
  property: string,
  replacement: unknown,
): void {
  const descriptor = Object.getOwnPropertyDescriptor(target, property);
  if (!descriptor || typeof descriptor.value !== "function") {
    throw new TypeError(`Expected ${property} to be a configurable SDK method.`);
  }
  if (typeof replacement !== "function") {
    throw new TypeError(`Expected a callable ${property} replacement.`);
  }
  prototypeStubs.push({ descriptor, property, target });
  Object.defineProperty(target, property, {
    ...descriptor,
    value: replacement,
  });
}

function requireConstructorPrototype(source: unknown, name: string): object {
  if (!isRecord(source)) {
    throw new TypeError(`Expected the installed ${name} package.`);
  }
  const constructor = Reflect.get(source, name);
  if (typeof constructor !== "function") {
    throw new TypeError(`Expected the installed ${name} constructor.`);
  }
  const prototype = Reflect.get(constructor, "prototype");
  if (!isRecord(prototype)) {
    throw new TypeError(`Expected the installed ${name} prototype.`);
  }
  return prototype;
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
