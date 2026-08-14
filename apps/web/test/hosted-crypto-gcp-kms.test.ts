import { Buffer } from "node:buffer";

import { getVercelOidcToken } from "@vercel/oidc";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createHostedGcpKmsClientFromEnv,
  HostedGcpKmsIntegrityError,
  HostedGcpKmsProviderError,
  HOSTED_GCP_KMS_OPERATION_TIMEOUT_MS,
  type HostedGcpKmsClient,
  type HostedGcpKmsClientDependencies,
  type HostedGcpKmsSdkAsymmetricSignRequest,
  type HostedGcpKmsSdkCallOptions,
  type HostedGcpKmsSdkClientConfiguration,
  type HostedGcpKmsSdkDecryptRequest,
  type HostedGcpKmsSdkEncryptRequest,
  type HostedGcpKmsSdkMacSignRequest,
  type HostedGcpKmsSdkTransport,
} from "../src/lib/hosted-crypto/gcp-kms";

vi.mock("@vercel/oidc", () => ({
  getVercelOidcToken: vi.fn(async () =>
    "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJob3N0ZWQtdGVzdCJ9.synthetic-signature"),
}));

const LOCAL_KMS_API_ROOT = "local://murph-hosted-kms";
const KMS_KEY_NAME =
  "projects/murph-test/locations/global/keyRings/hosted-test/cryptoKeys/web-wrap";
const KMS_KEY_VERSION_NAME = `${KMS_KEY_NAME}/cryptoKeyVersions/7`;
const OTHER_KMS_KEY_VERSION_NAME =
  "projects/murph-test/locations/global/keyRings/hosted-test/cryptoKeys/other/cryptoKeyVersions/1";
const SIGN_KEY_VERSION_NAME =
  "projects/murph-test/locations/global/keyRings/hosted-test/cryptoKeys/authority-sign/cryptoKeyVersions/3";
const MAC_KEY_VERSION_NAME =
  "projects/murph-test/locations/global/keyRings/hosted-test/cryptoKeys/address-book-mac/cryptoKeyVersions/5";
const VALID_SUBJECT_TOKEN =
  "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJob3N0ZWQtdGVzdCJ9.synthetic-signature";
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
  mockedGetVercelOidcToken.mockResolvedValue(VALID_SUBJECT_TOKEN);
});

describe("hosted crypto Google client configuration", () => {
  it("keeps static access tokens behind the explicit non-production test boundary", () => {
    expect(() => createClientHarness({
      HOSTED_CRYPTO_ENV: "prod",
      HOSTED_CRYPTO_GCP_ACCESS_TOKEN: "ya29.synthetic-static-token",
      NODE_ENV: "test",
    })).toThrow(/GCP_ACCESS_TOKEN is not allowed in production/u);

    expect(() => createClientHarness({
      HOSTED_CRYPTO_ENV: "dev",
      HOSTED_CRYPTO_GCP_ACCESS_TOKEN: "ya29.synthetic-static-token",
      NODE_ENV: "test",
    })).toThrow(/ALLOW_STATIC_GCP_ACCESS_TOKEN_FOR_DEV=1/u);

    expect(() => createClientHarness({
      ...STATIC_ENV,
      HOSTED_CRYPTO_GCP_ACCESS_TOKEN: " ya29.synthetic-static-token",
    })).toThrow(/exact string without surrounding whitespace/u);

    const harness = createClientHarness(STATIC_ENV);
    expect(harness.config.credentials).toEqual({
      accessToken: "ya29.synthetic-static-token",
      kind: "static-access-token",
    });
  });

  it("binds Workload Identity Federation to the exact audience, token type, scope, and service account", async () => {
    const harness = createClientHarness(WORKLOAD_IDENTITY_ENV);

    expect(harness.config).toMatchObject({
      apiEndpoint: "cloudkms.googleapis.com",
      fallback: false,
      port: 443,
      scopes: ["https://www.googleapis.com/auth/cloudkms"],
    });
    expect(harness.config.credentials.kind).toBe("workload-identity");
    if (harness.config.credentials.kind !== "workload-identity") {
      throw new Error("Expected Workload Identity credentials.");
    }
    expect(harness.config.credentials).toMatchObject({
      audience:
        "//iam.googleapis.com/projects/123456789012/locations/global/"
        + "workloadIdentityPools/vercel-pool/providers/vercel-provider",
      scopes: ["https://www.googleapis.com/auth/cloudkms"],
      serviceAccountImpersonationUrl:
        "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/"
        + "hosted-crypto%40murph-test.iam.gserviceaccount.com:generateAccessToken",
      subjectTokenType: "urn:ietf:params:oauth:token-type:jwt",
      tokenUrl: "https://sts.googleapis.com/v1/token",
    });
    await expect(harness.config.credentials.getSubjectToken()).resolves.toBe(
      VALID_SUBJECT_TOKEN,
    );
    expect(mockedGetVercelOidcToken).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed Workload Identity identifiers before constructing a client", () => {
    for (const [key, value] of [
      ["HOSTED_CRYPTO_GCP_PROJECT_NUMBER", "project-id"],
      ["HOSTED_CRYPTO_GCP_WORKLOAD_IDENTITY_POOL_ID", "Pool_With_Underscore"],
      ["HOSTED_CRYPTO_GCP_WORKLOAD_IDENTITY_POOL_ID", "gcp-reserved-pool"],
      ["HOSTED_CRYPTO_GCP_WORKLOAD_IDENTITY_PROVIDER_ID", "provider/child"],
      ["HOSTED_CRYPTO_GCP_WORKLOAD_IDENTITY_PROVIDER_ID", "gcp-reserved-provider"],
      ["HOSTED_CRYPTO_GCP_SERVICE_ACCOUNT_EMAIL", "hosted-crypto@example.test"],
      [
        "HOSTED_CRYPTO_GCP_SERVICE_ACCOUNT_EMAIL",
        " other@murph-test.iam.gserviceaccount.com",
      ],
    ] as const) {
      expect(() => createClientHarness({
        ...WORKLOAD_IDENTITY_ENV,
        [key]: value,
      })).toThrow(new RegExp(key, "u"));
    }
  });

  it("uses REST fallback only for an exact non-production custom KMS endpoint", () => {
    const harness = createClientHarness({
      ...STATIC_ENV,
      HOSTED_CRYPTO_GCP_KMS_API_ROOT: "https://kms.example.test:8443/v1",
    });
    expect(harness.config).toMatchObject({
      apiEndpoint: "kms.example.test",
      fallback: true,
      port: 8443,
    });

    for (const value of [
      "http://kms.example.test/v1",
      "https://kms.example.test/v1/",
      "https://kms.example.test/v1?target=other",
      "https://user@kms.example.test/v1",
    ]) {
      expect(() => createClientHarness({
        ...STATIC_ENV,
        HOSTED_CRYPTO_GCP_KMS_API_ROOT: value,
      })).toThrow(/exact HTTPS URL with path \/v1/u);
    }
  });

  it("rejects every endpoint override in production", () => {
    for (const [key, value] of [
      ["HOSTED_CRYPTO_GCP_IAM_CREDENTIALS_API_ROOT", "https://iam.example.test/v1"],
      ["HOSTED_CRYPTO_GCP_KMS_API_ROOT", "https://kms.example.test/v1"],
      ["HOSTED_CRYPTO_GCP_STS_TOKEN_URI", "https://sts.example.test/v1/token"],
    ] as const) {
      expect(() => createClientHarness({
        ...WORKLOAD_IDENTITY_ENV,
        [key]: value,
      })).toThrow(new RegExp(`${key}.*not allowed in production`, "u"));
    }
  });

  it("refuses Google SDK request logging at the crypto boundary", () => {
    expect(() => createClientHarness({
      ...STATIC_ENV,
      GOOGLE_SDK_NODE_LOGGING: "debug",
    })).toThrow(/GOOGLE_SDK_NODE_LOGGING must be unset/u);
  });

  it("rejects malformed or oversized Vercel subject tokens", async () => {
    const malformed = createClientHarness(WORKLOAD_IDENTITY_ENV);
    if (malformed.config.credentials.kind !== "workload-identity") {
      throw new Error("Expected Workload Identity credentials.");
    }
    mockedGetVercelOidcToken.mockResolvedValueOnce("not-a-jwt");
    await expect(malformed.config.credentials.getSubjectToken()).rejects.toThrow(
      /compact JWT/u,
    );

    mockedGetVercelOidcToken.mockResolvedValueOnce(
      `a.${"b".repeat(16 * 1024)}.c`,
    );
    await expect(malformed.config.credentials.getSubjectToken()).rejects.toThrow(
      /subject token is invalid/u,
    );
  });
});

describe("hosted crypto Google KMS integrity transport", () => {
  it("sends exact Encrypt request CRCs and clears request and response buffers", async () => {
    const plaintext = new Uint8Array([1, 2, 3]);
    const responseCiphertext = new Uint8Array([9, 8, 7, 6]);
    const captured: {
      options?: HostedGcpKmsSdkCallOptions;
      request?: HostedGcpKmsSdkEncryptRequest;
    } = {};
    let requestPlaintext = new Uint8Array();
    let requestAad = new Uint8Array();
    const transport = createTransport({
      encrypt: async (request, options) => {
        captured.request = request;
        captured.options = options;
        requestPlaintext = new Uint8Array(request.plaintext);
        requestAad = new Uint8Array(request.additionalAuthenticatedData);
        return {
          ciphertext: responseCiphertext,
          ciphertextCrc32c: crc32c(responseCiphertext),
          name: KMS_KEY_VERSION_NAME,
          verifiedAdditionalAuthenticatedDataCrc32c: true,
          verifiedPlaintextCrc32c: true,
        };
      },
    });
    const client = createClientHarness(STATIC_ENV, transport).client;

    await expect(client.encrypt({
      additionalAuthenticatedData: "domain=control",
      keyName: KMS_KEY_NAME,
      plaintext,
    })).resolves.toEqual({
      ciphertext: Buffer.from(new Uint8Array([9, 8, 7, 6])).toString("base64"),
      keyName: KMS_KEY_NAME,
    });

    const request = requireValue(captured.request, "Encrypt request");
    const options = requireValue(captured.options, "Encrypt options");
    expect(request.name).toBe(KMS_KEY_NAME);
    expect(requestPlaintext).toEqual(new Uint8Array([1, 2, 3]));
    expect(new TextDecoder().decode(requestAad)).toBe("domain=control");
    expect(request.plaintextCrc32c).toBe(0xf130f21e);
    expect(request.additionalAuthenticatedDataCrc32c).toBe(0x481d3603);
    expect(options.retry).toBe(false);
    expect(options.timeoutMs).toBeGreaterThan(0);
    expect(options.timeoutMs).toBeLessThanOrEqual(HOSTED_GCP_KMS_OPERATION_TIMEOUT_MS);
    expect(options.signal.aborted).toBe(false);
    expect(plaintext).toEqual(new Uint8Array([1, 2, 3]));
    expectAllZero(request.plaintext);
    expectAllZero(request.additionalAuthenticatedData);
    expectAllZero(responseCiphertext);
  });

  it("fails closed on every Encrypt integrity mismatch and still clears buffers", async () => {
    for (const response of [
      {
        ciphertextCrc32c: crc32c(new Uint8Array([4, 5, 6])),
        name: KMS_KEY_VERSION_NAME,
        verifiedAdditionalAuthenticatedDataCrc32c: true,
        verifiedPlaintextCrc32c: false,
      },
      {
        ciphertextCrc32c: crc32c(new Uint8Array([4, 5, 6])),
        name: OTHER_KMS_KEY_VERSION_NAME,
        verifiedAdditionalAuthenticatedDataCrc32c: true,
        verifiedPlaintextCrc32c: true,
      },
      {
        ciphertextCrc32c: 0,
        name: KMS_KEY_VERSION_NAME,
        verifiedAdditionalAuthenticatedDataCrc32c: true,
        verifiedPlaintextCrc32c: true,
      },
    ]) {
      const responseCiphertext = new Uint8Array([4, 5, 6]);
      const captured: { request?: HostedGcpKmsSdkEncryptRequest } = {};
      const client = createClientHarness(STATIC_ENV, createTransport({
        encrypt: async (request) => {
          captured.request = request;
          return {
            ciphertext: responseCiphertext,
            ciphertextCrc32c: response.ciphertextCrc32c,
            name: response.name,
            verifiedAdditionalAuthenticatedDataCrc32c:
              response.verifiedAdditionalAuthenticatedDataCrc32c,
            verifiedPlaintextCrc32c: response.verifiedPlaintextCrc32c,
          };
        },
      })).client;

      await expect(client.encrypt({
        additionalAuthenticatedData: "domain=control",
        keyName: KMS_KEY_NAME,
        plaintext: new Uint8Array([1, 2, 3]),
      })).rejects.toBeInstanceOf(HostedGcpKmsIntegrityError);
      expectAllZero(requireValue(captured.request, "Encrypt request").plaintext);
      expectAllZero(responseCiphertext);
    }
  });

  it("normalizes a versioned Decrypt name to its exact CryptoKey and accepts old-version ciphertext", async () => {
    const ciphertext = new TextEncoder().encode("encrypted-root-key");
    const responsePlaintext = new Uint8Array([4, 5, 6]);
    const captured: { request?: HostedGcpKmsSdkDecryptRequest } = {};
    const client = createClientHarness(STATIC_ENV, createTransport({
      decrypt: async (request) => {
        captured.request = request;
        return {
          plaintext: responsePlaintext,
          plaintextCrc32c: crc32c(responsePlaintext),
          usedPrimary: false,
        };
      },
    })).client;

    const result = await client.decrypt({
      additionalAuthenticatedData: "domain=control",
      ciphertext: Buffer.from(ciphertext).toString("base64"),
      keyName: KMS_KEY_VERSION_NAME,
    });

    const request = requireValue(captured.request, "Decrypt request");
    expect(result.plaintext).toEqual(new Uint8Array([4, 5, 6]));
    expect(request.name).toBe(KMS_KEY_NAME);
    expect(request.ciphertextCrc32c).toBe(0x2d1c0717);
    expect(request.additionalAuthenticatedDataCrc32c).toBe(0x481d3603);
    expectAllZero(request.ciphertext);
    expectAllZero(request.additionalAuthenticatedData);
    expectAllZero(responsePlaintext);
  });

  it("returns an authenticated empty plaintext without treating it as missing", async () => {
    const responsePlaintext = new Uint8Array();
    const client = createClientHarness(STATIC_ENV, createTransport({
      decrypt: async () => ({
        plaintext: responsePlaintext,
        plaintextCrc32c: crc32c(responsePlaintext),
        usedPrimary: true,
      }),
    })).client;

    await expect(client.decrypt({
      additionalAuthenticatedData: "",
      ciphertext: Buffer.from(new Uint8Array([1])).toString("base64"),
      keyName: KMS_KEY_NAME,
    })).resolves.toEqual({ plaintext: new Uint8Array() });
    expect(responsePlaintext).toHaveLength(0);
  });

  it("hashes Sign messages locally, verifies CRCs and exact version binding, and clears buffers", async () => {
    const message = new TextEncoder().encode("sign this envelope");
    const expectedDigest = new Uint8Array(await crypto.subtle.digest("SHA-256", message));
    const responseSignature = new Uint8Array([7, 8, 9, 10]);
    const captured: { request?: HostedGcpKmsSdkAsymmetricSignRequest } = {};
    let digestBeforeClear = new Uint8Array();
    const client = createClientHarness(STATIC_ENV, createTransport({
      asymmetricSign: async (request) => {
        captured.request = request;
        digestBeforeClear = new Uint8Array(request.digest);
        return {
          name: SIGN_KEY_VERSION_NAME,
          signature: responseSignature,
          signatureCrc32c: crc32c(responseSignature),
          verifiedDigestCrc32c: true,
        };
      },
    })).client;

    await expect(client.asymmetricSign({
      keyVersionName: SIGN_KEY_VERSION_NAME,
      message,
    })).resolves.toEqual({
      keyVersionName: SIGN_KEY_VERSION_NAME,
      signature: Buffer.from(new Uint8Array([7, 8, 9, 10])).toString("base64"),
    });

    const request = requireValue(captured.request, "Sign request");
    expect(digestBeforeClear).toEqual(expectedDigest);
    expect(request.digestCrc32c).toBe(crc32c(expectedDigest));
    expect(message).toEqual(new TextEncoder().encode("sign this envelope"));
    expectAllZero(request.digest);
    expectAllZero(responseSignature);
  });

  it("requires an exact 32-byte MAC with matching data and response CRCs", async () => {
    const responseMac = new Uint8Array(32).fill(7);
    const captured: { request?: HostedGcpKmsSdkMacSignRequest } = {};
    const client = createClientHarness(STATIC_ENV, createTransport({
      macSign: async (request) => {
        captured.request = request;
        return {
          mac: responseMac,
          macCrc32c: crc32c(responseMac),
          name: MAC_KEY_VERSION_NAME,
          verifiedDataCrc32c: true,
        };
      },
    })).client;

    const result = await client.macSign({
      data: new Uint8Array([1, 2, 3, 4]),
      keyVersionName: MAC_KEY_VERSION_NAME,
    });

    const request = requireValue(captured.request, "MAC request");
    expect(result).toEqual({
      keyVersionName: MAC_KEY_VERSION_NAME,
      mac: new Uint8Array(32).fill(7),
    });
    expect(request.dataCrc32c).toBe(crc32c(new Uint8Array([1, 2, 3, 4])));
    expectAllZero(request.data);
    expectAllZero(responseMac);
  });

  it("rejects malformed MAC responses and clears the returned bytes", async () => {
    for (const response of [
      {
        mac: new Uint8Array(31).fill(7),
        name: MAC_KEY_VERSION_NAME,
        verified: true,
      },
      {
        mac: new Uint8Array(32).fill(7),
        name: OTHER_KMS_KEY_VERSION_NAME,
        verified: true,
      },
      {
        mac: new Uint8Array(32).fill(7),
        name: MAC_KEY_VERSION_NAME,
        verified: false,
      },
    ]) {
      const client = createClientHarness(STATIC_ENV, createTransport({
        macSign: async () => ({
          mac: response.mac,
          macCrc32c: crc32c(response.mac),
          name: response.name,
          verifiedDataCrc32c: response.verified,
        }),
      })).client;

      await expect(client.macSign({
        data: new Uint8Array([1]),
        keyVersionName: MAC_KEY_VERSION_NAME,
      })).rejects.toBeInstanceOf(HostedGcpKmsIntegrityError);
      expectAllZero(response.mac);
    }
  });

  it("rejects generic, wildcard, and wrong-resource KMS names before transport", async () => {
    const transport = createTransport();
    const harness = createClientHarness(STATIC_ENV, transport);

    for (const keyName of [
      "projects/test/locations/global/keyRings/ring/cryptoKeys/key",
      "projects/murph-test/locations/*/keyRings/ring/cryptoKeys/key",
      `${KMS_KEY_NAME}/cryptoKeyVersions/latest`,
      `${KMS_KEY_VERSION_NAME}/extra`,
      ` ${KMS_KEY_NAME}`,
    ]) {
      await expect(harness.client.decrypt({
        additionalAuthenticatedData: "domain=control",
        ciphertext: Buffer.from(new Uint8Array([1])).toString("base64"),
        keyName,
      })).rejects.toThrow(/exact (?:string without surrounding whitespace|CryptoKey or CryptoKeyVersion)/u);
    }
    await expect(harness.client.encrypt({
      additionalAuthenticatedData: "domain=control",
      keyName: KMS_KEY_VERSION_NAME,
      plaintext: new Uint8Array([1]),
    })).rejects.toThrow(/exact CryptoKey resource/u);
    await expect(harness.client.asymmetricSign({
      keyVersionName: KMS_KEY_NAME,
      message: new Uint8Array([1]),
    })).rejects.toThrow(/exact CryptoKeyVersion/u);
  });

  it("enforces request and response size bounds before provider work", async () => {
    let calls = 0;
    const transport = createTransport({
      encrypt: async () => {
        calls += 1;
        throw new Error("Unexpected provider call.");
      },
      macSign: async () => {
        calls += 1;
        throw new Error("Unexpected provider call.");
      },
    });
    const client = createClientHarness(STATIC_ENV, transport).client;

    await expect(client.encrypt({
      additionalAuthenticatedData: "",
      keyName: KMS_KEY_NAME,
      plaintext: new Uint8Array(64 * 1024 + 1),
    })).rejects.toThrow(/exceeds 65536 bytes/u);
    await expect(client.encrypt({
      additionalAuthenticatedData: "x",
      keyName: KMS_KEY_NAME,
      plaintext: new Uint8Array(64 * 1024),
    })).rejects.toThrow(/plaintext and additionalAuthenticatedData exceed/u);
    await expect(client.macSign({
      data: new Uint8Array(64 * 1024 + 1),
      keyVersionName: MAC_KEY_VERSION_NAME,
    })).rejects.toThrow(/exceeds 65536 bytes/u);
    await expect(client.decrypt({
      additionalAuthenticatedData: "",
      ciphertext: Buffer.alloc(66 * 1024 + 1).toString("base64"),
      keyName: KMS_KEY_NAME,
    })).rejects.toThrow(/exceeds 67584 bytes/u);
    expect(calls).toBe(0);
  });
});

describe("hosted crypto Google KMS aborts and redacted errors", () => {
  it("honors caller abort without retrying or exposing the caller reason", async () => {
    const caller = new AbortController();
    let calls = 0;
    const captured: { request?: HostedGcpKmsSdkEncryptRequest } = {};
    const client = createClientHarness(STATIC_ENV, createTransport({
      encrypt: (currentRequest, options) => {
        calls += 1;
        captured.request = currentRequest;
        return pendingUntilAbort(options.signal);
      },
    })).client;
    const operation = client.encrypt({
      additionalAuthenticatedData: "domain=control",
      keyName: KMS_KEY_NAME,
      plaintext: new Uint8Array([1, 2, 3]),
      signal: caller.signal,
    });

    await vi.waitFor(() => expect(calls).toBe(1));
    caller.abort(new Error(`secret caller reason for ${KMS_KEY_NAME}`));
    await expect(operation).rejects.toMatchObject({
      message: "Google Cloud KMS operation was aborted by the caller.",
      name: "AbortError",
    });
    expect(calls).toBe(1);
    expectAllZero(requireValue(captured.request, "aborted Encrypt request").plaintext);
  });

  it("owns one deadline across the operation and never retries", async () => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    let calls = 0;
    const client = createClientHarness(STATIC_ENV, createTransport({
      decrypt: (_request, options) => {
        calls += 1;
        return pendingUntilAbort(options.signal);
      },
    })).client;
    const operation = client.decrypt({
      additionalAuthenticatedData: "domain=control",
      ciphertext: Buffer.from(new Uint8Array([1, 2, 3])).toString("base64"),
      keyName: KMS_KEY_NAME,
    });

    await vi.waitFor(() => expect(calls).toBe(1));
    deadline.abort(new Error(`secret timeout reason for ${KMS_KEY_NAME}`));
    await expect(operation).rejects.toMatchObject({
      message: "Google Cloud KMS operation exceeded its deadline.",
      name: "TimeoutError",
    });
    expect(calls).toBe(1);
  });

  it("returns a structured provider error without raw messages, payloads, resources, or causes", async () => {
    const client = createClientHarness(STATIC_ENV, createTransport({
      encrypt: async () => {
        throw {
          code: "PERMISSION_DENIED",
          message: `KMS denied ${KMS_KEY_NAME} using secret-provider-token`,
          response: {
            data: { privatePayload: "secret-provider-payload" },
            status: 403,
          },
        };
      },
    })).client;

    let thrown: unknown;
    try {
      await client.encrypt({
        additionalAuthenticatedData: "domain=control",
        keyName: KMS_KEY_NAME,
        plaintext: new Uint8Array([1, 2, 3]),
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(HostedGcpKmsProviderError);
    expect(thrown).toMatchObject({
      code: "HOSTED_GCP_KMS_PROVIDER_ERROR",
      message: "Google Cloud KMS encrypt failed (PERMISSION_DENIED).",
      operation: "encrypt",
      providerReason: "PERMISSION_DENIED",
      retryable: false,
      status: 403,
    });
    const serialized = JSON.stringify(thrown);
    expect(serialized).not.toMatch(
      /projects\/|keyRings|secret-provider|privatePayload|KMS denied/u,
    );
    expect(isObjectWithProperty(thrown, "cause")).toBe(false);
  });
});

describe("hosted crypto local KMS", () => {
  it("accepts the hosted authority-signing key version", async () => {
    const signingKey = await createLocalSigningKey();
    const client = createLocalClient(signingKey.privateJwkJson, 6);

    await expect(client.asymmetricSign({
      keyVersionName: SIGN_KEY_VERSION_NAME,
      message: new TextEncoder().encode("hosted authority-signing fixture"),
    })).resolves.toMatchObject({
      keyVersionName: SIGN_KEY_VERSION_NAME,
    });
  });

  it("encrypts, decrypts, signs, and MACs without Google credentials", async () => {
    const signingKey = await createLocalSigningKey();
    const client = createLocalClient(signingKey.privateJwkJson, 7);
    const plaintext = new TextEncoder().encode("local hosted root");

    const encrypted = await client.encrypt({
      additionalAuthenticatedData: "domain=control",
      keyName: KMS_KEY_NAME,
      plaintext,
    });
    const decrypted = await client.decrypt({
      additionalAuthenticatedData: "domain=control",
      ciphertext: encrypted.ciphertext,
      keyName: KMS_KEY_VERSION_NAME,
    });
    const signed = await client.asymmetricSign({
      keyVersionName: SIGN_KEY_VERSION_NAME,
      message: new TextEncoder().encode("sign me"),
    });
    const mac = await client.macSign({
      data: new TextEncoder().encode("member seed"),
      keyVersionName: MAC_KEY_VERSION_NAME,
    });

    expect(encrypted.ciphertext).toMatch(/^local-kms-v1:/u);
    expect(new TextDecoder().decode(decrypted.plaintext)).toBe("local hosted root");
    expect(plaintext).toEqual(new TextEncoder().encode("local hosted root"));
    expect(mac.mac).toHaveLength(32);
    await expect(crypto.subtle.verify(
      { hash: "SHA-256", name: "ECDSA" },
      signingKey.publicKey,
      Buffer.from(signed.signature, "base64"),
      new TextEncoder().encode("sign me"),
    )).resolves.toBe(true);
  });

  it("keeps local ciphertext and MACs bound to AAD, exact key versions, and data", async () => {
    const signingKey = await createLocalSigningKey();
    const client = createLocalClient(signingKey.privateJwkJson, 8);
    const encrypted = await client.encrypt({
      additionalAuthenticatedData: "expected-aad",
      keyName: KMS_KEY_NAME,
      plaintext: new Uint8Array([1, 2, 3]),
    });

    await expect(client.decrypt({
      additionalAuthenticatedData: "wrong-aad",
      ciphertext: encrypted.ciphertext,
      keyName: KMS_KEY_NAME,
    })).rejects.toThrow();

    const first = await client.macSign({
      data: new TextEncoder().encode("member seed"),
      keyVersionName: MAC_KEY_VERSION_NAME,
    });
    const replay = await client.macSign({
      data: new TextEncoder().encode("member seed"),
      keyVersionName: MAC_KEY_VERSION_NAME,
    });
    const changed = await client.macSign({
      data: new TextEncoder().encode("different seed"),
      keyVersionName: MAC_KEY_VERSION_NAME,
    });
    expect(first.mac).toEqual(replay.mac);
    expect(first.mac).not.toEqual(changed.mac);
  });

  it("rejects local KMS in every production environment", async () => {
    const signingKey = await createLocalSigningKey();
    const baseEnv = localEnv(signingKey.privateJwkJson, 9);
    const productionEnvironments: NodeJS.ProcessEnv[] = [
      { ...baseEnv, NODE_ENV: "production" },
      { ...baseEnv, VERCEL_ENV: "production" },
      { ...baseEnv, HOSTED_CRYPTO_ENV: "prod" },
      { ...baseEnv, HOSTED_CRYPTO_ENV: "production" },
    ];
    for (const env of productionEnvironments) {
      expect(() => createHostedGcpKmsClientFromEnv(env)).toThrow(
        /local KMS is not allowed in production/u,
      );
    }
  });
});

interface TransportOverrides {
  asymmetricSign?: HostedGcpKmsSdkTransport["asymmetricSign"];
  decrypt?: HostedGcpKmsSdkTransport["decrypt"];
  encrypt?: HostedGcpKmsSdkTransport["encrypt"];
  macSign?: HostedGcpKmsSdkTransport["macSign"];
}

function createTransport(overrides: TransportOverrides = {}): HostedGcpKmsSdkTransport {
  return {
    asymmetricSign: overrides.asymmetricSign ?? (async () => {
      throw new Error("Unexpected asymmetricSign transport call.");
    }),
    decrypt: overrides.decrypt ?? (async () => {
      throw new Error("Unexpected decrypt transport call.");
    }),
    encrypt: overrides.encrypt ?? (async () => {
      throw new Error("Unexpected encrypt transport call.");
    }),
    macSign: overrides.macSign ?? (async () => {
      throw new Error("Unexpected macSign transport call.");
    }),
  };
}

function createClientHarness(
  env: NodeJS.ProcessEnv,
  transport: HostedGcpKmsSdkTransport = createTransport(),
): { client: HostedGcpKmsClient; config: HostedGcpKmsSdkClientConfiguration } {
  const captured: { config?: HostedGcpKmsSdkClientConfiguration } = {};
  const dependencies: HostedGcpKmsClientDependencies = {
    createSdkTransport: (config) => {
      captured.config = config;
      return transport;
    },
  };
  const client = createHostedGcpKmsClientFromEnv(env, dependencies);
  return {
    client,
    config: requireValue(captured.config, "Google client configuration"),
  };
}

function pendingUntilAbort<T>(signal: AbortSignal): Promise<T> {
  return new Promise<T>((_resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
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

function expectAllZero(value: Uint8Array): void {
  expect(value.every((byte) => byte === 0)).toBe(true);
}

function requireValue<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) {
    throw new Error(`${label} was not captured.`);
  }
  return value;
}

function isObjectWithProperty(value: unknown, property: PropertyKey): boolean {
  return typeof value === "object" && value !== null && property in value;
}

async function createLocalSigningKey(): Promise<{
  privateJwkJson: string;
  publicKey: CryptoKey;
}> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  return {
    privateJwkJson: JSON.stringify(await crypto.subtle.exportKey("jwk", keyPair.privateKey)),
    publicKey: keyPair.publicKey,
  };
}

function createLocalClient(privateJwkJson: string, wrapByte: number): HostedGcpKmsClient {
  return createHostedGcpKmsClientFromEnv(localEnv(privateJwkJson, wrapByte));
}

function localEnv(privateJwkJson: string, wrapByte: number): NodeJS.ProcessEnv {
  return {
    HOSTED_CRYPTO_GCP_KMS_API_ROOT: LOCAL_KMS_API_ROOT,
    HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK: privateJwkJson,
    HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY: Buffer.alloc(32, wrapByte).toString("base64"),
    NODE_ENV: "test",
  };
}
