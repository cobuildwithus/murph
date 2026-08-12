import { Buffer } from "node:buffer";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createHostedGcpKmsClientFromEnv,
} from "../src/lib/hosted-crypto/gcp-kms";

vi.mock("@vercel/oidc", () => ({
  getVercelOidcToken: vi.fn(async () => "vercel-oidc-token"),
}));

const LOCAL_KMS_API_ROOT = "local://murph-hosted-kms";
const LOCAL_KMS_KEY_NAME =
  "projects/murph-local/locations/global/keyRings/hosted-local/cryptoKeys/web-wrap";
const LOCAL_KMS_KEY_VERSION_NAME =
  `${LOCAL_KMS_KEY_NAME}/cryptoKeyVersions/7`;
const LOCAL_SIGN_KEY_VERSION =
  "projects/murph-local/locations/global/keyRings/hosted-local/cryptoKeys/authority-sign/cryptoKeyVersions/1";
const LOCAL_MAC_KEY_VERSION =
  "projects/murph-local/locations/global/keyRings/hosted-local/cryptoKeys/address-book-mac/cryptoKeyVersions/1";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("hosted crypto GCP KMS access-token guard", () => {
  it("rejects static GCP access tokens in production", () => {
    expect(() => createHostedGcpKmsClientFromEnv({
      HOSTED_CRYPTO_ENV: "prod",
      HOSTED_CRYPTO_GCP_ACCESS_TOKEN: "ya29.static-token",
      NODE_ENV: "test",
    })).toThrow(/HOSTED_CRYPTO_GCP_ACCESS_TOKEN.*not allowed in production/i);
  });

  it("requires an explicit local-dev override for static GCP access tokens", () => {
    expect(() => createHostedGcpKmsClientFromEnv({
      HOSTED_CRYPTO_ENV: "dev",
      HOSTED_CRYPTO_GCP_ACCESS_TOKEN: "ya29.static-token",
      NODE_ENV: "test",
    })).toThrow(/HOSTED_CRYPTO_ALLOW_STATIC_GCP_ACCESS_TOKEN_FOR_DEV=1/i);
  });

  it("allows static GCP access tokens only when explicitly marked as local dev", () => {
    expect(() => createHostedGcpKmsClientFromEnv({
      HOSTED_CRYPTO_ALLOW_STATIC_GCP_ACCESS_TOKEN_FOR_DEV: "1",
      HOSTED_CRYPTO_ENV: "dev",
      HOSTED_CRYPTO_GCP_ACCESS_TOKEN: "ya29.static-token",
      NODE_ENV: "test",
    })).not.toThrow();
  });

  it("rejects custom GCP endpoint overrides in production", () => {
    const productionBase = {
      HOSTED_CRYPTO_ENV: "prod",
      HOSTED_CRYPTO_GCP_PROJECT_NUMBER: "123456789",
      HOSTED_CRYPTO_GCP_SERVICE_ACCOUNT_EMAIL: "hosted-crypto@example.test",
      HOSTED_CRYPTO_GCP_WORKLOAD_IDENTITY_POOL_ID: "pool",
      HOSTED_CRYPTO_GCP_WORKLOAD_IDENTITY_PROVIDER_ID: "provider",
      NODE_ENV: "test",
    } satisfies NodeJS.ProcessEnv;

    for (const [key, value] of [
      ["HOSTED_CRYPTO_GCP_IAM_CREDENTIALS_API_ROOT", "https://iamcredentials.example.test/v1"],
      ["HOSTED_CRYPTO_GCP_KMS_API_ROOT", "https://kms.example.test/v1"],
      ["HOSTED_CRYPTO_GCP_STS_TOKEN_URI", "https://sts.example.test/v1/token"],
    ] as const) {
      expect(() => createHostedGcpKmsClientFromEnv({
        ...productionBase,
        [key]: value,
      })).toThrow(new RegExp(`${key}.*not allowed in production`, "u"));
    }
  });
});

describe("hosted crypto GCP Workload Identity Federation", () => {
  it("surfaces provider decrypt failures without a public permanent classifier", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        error: { status: "INVALID_ARGUMENT" },
      }, { status: 400 }))
      .mockResolvedValueOnce(jsonResponse({
        error: { status: "NOT_FOUND" },
      }, { status: 404 }))
      .mockRejectedValueOnce(new TypeError("temporary network failure"));
    vi.stubGlobal("fetch", fetchMock);
    const client = createHostedGcpKmsClientFromEnv({
      HOSTED_CRYPTO_ALLOW_STATIC_GCP_ACCESS_TOKEN_FOR_DEV: "1",
      HOSTED_CRYPTO_ENV: "dev",
      HOSTED_CRYPTO_GCP_ACCESS_TOKEN: "ya29.static-token",
      NODE_ENV: "test",
    });
    const decrypt = () => client.decrypt({
      additionalAuthenticatedData: "domain=control",
      ciphertext: "encrypted-root-key",
      keyName: LOCAL_KMS_KEY_NAME,
    }).then(() => null, (error: unknown) => error);

    const invalidArgument = await decrypt();
    expect(invalidArgument).toBeInstanceOf(Error);
    expect((invalidArgument as Error).message)
      .toMatch(/cloudkms\/decrypt failed \(400\): INVALID_ARGUMENT/u);
    const notFound = await decrypt();
    expect(notFound).toBeInstanceOf(Error);
    expect((notFound as Error).message)
      .toMatch(/cloudkms\/decrypt failed \(404\): NOT_FOUND/u);
    const network = await decrypt();
    expect(network).toBeInstanceOf(TypeError);
  });

  it("bounds a stalled cold-token exchange with the operation deadline and no retry", async () => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    const fetchMock = vi.fn<typeof fetch>((_input, init) => pendingUntilAbort(init?.signal));
    vi.stubGlobal("fetch", fetchMock);

    const client = createHostedGcpKmsClientFromEnv({
      HOSTED_CRYPTO_ENV: "production",
      HOSTED_CRYPTO_GCP_PROJECT_NUMBER: "123456789012",
      HOSTED_CRYPTO_GCP_SERVICE_ACCOUNT_EMAIL: "hosted-crypto@example.test",
      HOSTED_CRYPTO_GCP_WORKLOAD_IDENTITY_POOL_ID: "vercel",
      HOSTED_CRYPTO_GCP_WORKLOAD_IDENTITY_PROVIDER_ID: "vercel",
      NODE_ENV: "test",
    });
    const operation = client.decrypt({
      additionalAuthenticatedData: "domain=control",
      ciphertext: "encrypted-root-key",
      keyName: LOCAL_KMS_KEY_NAME,
    });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    deadline.abort(new DOMException("operation timed out", "TimeoutError"));
    await expect(operation).rejects.toMatchObject({ name: "TimeoutError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("honors an earlier caller abort during KMS without retrying", async () => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    const fetchMock = vi.fn<typeof fetch>((_input, init) => pendingUntilAbort(init?.signal));
    vi.stubGlobal("fetch", fetchMock);
    const caller = new AbortController();
    const client = createHostedGcpKmsClientFromEnv({
      HOSTED_CRYPTO_ALLOW_STATIC_GCP_ACCESS_TOKEN_FOR_DEV: "1",
      HOSTED_CRYPTO_ENV: "dev",
      HOSTED_CRYPTO_GCP_ACCESS_TOKEN: "ya29.static-token",
      NODE_ENV: "test",
    });
    const operation = client.decrypt({
      additionalAuthenticatedData: "domain=control",
      ciphertext: "encrypted-root-key",
      keyName: LOCAL_KMS_KEY_NAME,
      signal: caller.signal,
    });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    caller.abort(new DOMException("caller disconnected", "AbortError"));
    await expect(operation).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses an IAMCredentials-capable federated token before minting a KMS-scoped service-account token", async () => {
    const seenRequests: Array<{ body: string; headers: Headers; url: string }> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      const url = String(input);
      seenRequests.push({
        body: typeof init?.body === "string" ? init.body : String(init?.body ?? ""),
        headers: new Headers(init?.headers),
        url,
      });

      if (url === "https://sts.googleapis.com/v1/token") {
        return jsonResponse({
          access_token: "federated-access-token",
          expires_in: 3600,
          token_type: "Bearer",
        });
      }

      if (url === "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/hosted-crypto%40example.test:generateAccessToken") {
        return jsonResponse({
          accessToken: "kms-service-account-token",
          expireTime: "2099-01-01T00:00:00Z",
        });
      }

      if (url === `${LOCAL_KMS_KEY_NAME}:encrypt`.replace(
        "projects/",
        "https://cloudkms.googleapis.com/v1/projects/",
      )) {
        return jsonResponse({
          ciphertext: "encrypted-root-key",
          name: LOCAL_KMS_KEY_VERSION_NAME,
        });
      }

      return jsonResponse({ error: { message: `unexpected test URL ${url}` } }, { status: 404 });
    };
    vi.stubGlobal("fetch", fetchMock);

    const client = createHostedGcpKmsClientFromEnv({
      HOSTED_CRYPTO_ENV: "production",
      HOSTED_CRYPTO_GCP_PROJECT_NUMBER: "123456789012",
      HOSTED_CRYPTO_GCP_SERVICE_ACCOUNT_EMAIL: "hosted-crypto@example.test",
      HOSTED_CRYPTO_GCP_WORKLOAD_IDENTITY_POOL_ID: "vercel",
      HOSTED_CRYPTO_GCP_WORKLOAD_IDENTITY_PROVIDER_ID: "vercel",
      NODE_ENV: "test",
    });

    await expect(client.encrypt({
      additionalAuthenticatedData: "domain=control",
      keyName: LOCAL_KMS_KEY_NAME,
      plaintext: new Uint8Array([1, 2, 3]),
    })).resolves.toEqual({
      ciphertext: "encrypted-root-key",
      keyName: LOCAL_KMS_KEY_NAME,
    });

    const stsRequest = seenRequests.find((request) =>
      request.url === "https://sts.googleapis.com/v1/token"
    );
    const iamRequest = seenRequests.find((request) =>
      request.url.includes(":generateAccessToken")
    );
    const kmsRequest = seenRequests.find((request) =>
      request.url.includes(":encrypt")
    );

    expect(stsRequest).toBeDefined();
    expect(new URLSearchParams(stsRequest?.body).get("scope")).toBe(
      "https://www.googleapis.com/auth/iam",
    );
    expect(readBearerToken(iamRequest?.headers)).toBe("federated-access-token");
    expect(JSON.parse(iamRequest?.body ?? "{}")).toMatchObject({
      scope: ["https://www.googleapis.com/auth/cloudkms"],
    });
    expect(readBearerToken(kmsRequest?.headers)).toBe("kms-service-account-token");
  });

  it("uses only exact CryptoKey or CryptoKeyVersion resource names for decrypt", async () => {
    const plaintext = new Uint8Array([4, 5, 6]);
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({
      plaintext: Buffer.from(plaintext).toString("base64"),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createHostedGcpKmsClientFromEnv({
      HOSTED_CRYPTO_ALLOW_STATIC_GCP_ACCESS_TOKEN_FOR_DEV: "1",
      HOSTED_CRYPTO_ENV: "dev",
      HOSTED_CRYPTO_GCP_ACCESS_TOKEN: "ya29.static-token",
      HOSTED_CRYPTO_GCP_KMS_API_ROOT: "https://kms.example.test/v1",
      NODE_ENV: "test",
    });

    await expect(client.decrypt({
      additionalAuthenticatedData: "domain=control",
      ciphertext: "encrypted-root-key",
      keyName: LOCAL_KMS_KEY_VERSION_NAME,
    })).resolves.toEqual({ plaintext });
    expect(fetchMock).toHaveBeenCalledWith(
      `https://kms.example.test/v1/${LOCAL_KMS_KEY_NAME}:decrypt`,
      expect.objectContaining({ method: "POST" }),
    );

    for (const keyName of [
      `${LOCAL_KMS_KEY_NAME}/cryptoKeyVersions/latest`,
      `${LOCAL_KMS_KEY_NAME}:decrypt`,
      `${LOCAL_KMS_KEY_VERSION_NAME}/extra`,
    ]) {
      await expect(client.decrypt({
        additionalAuthenticatedData: "domain=control",
        ciphertext: "encrypted-root-key",
        keyName,
      })).rejects.toThrow(/CryptoKey or CryptoKeyVersion resource name/u);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a CryptoKeyVersion as an encrypt parent before provider I/O", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({
      ciphertext: "unexpected",
      name: LOCAL_KMS_KEY_VERSION_NAME,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createHostedGcpKmsClientFromEnv({
      HOSTED_CRYPTO_ALLOW_STATIC_GCP_ACCESS_TOKEN_FOR_DEV: "1",
      HOSTED_CRYPTO_ENV: "dev",
      HOSTED_CRYPTO_GCP_ACCESS_TOKEN: "ya29.static-token",
      HOSTED_CRYPTO_GCP_KMS_API_ROOT: "https://kms.example.test/v1",
      NODE_ENV: "test",
    });

    await expect(client.encrypt({
      additionalAuthenticatedData: "domain=control",
      keyName: LOCAL_KMS_KEY_VERSION_NAME,
      plaintext: new Uint8Array([1, 2, 3]),
    })).rejects.toThrow(/must be a CryptoKey resource name/u);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed or mismatched EncryptResponse key version names", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        ciphertext: "encrypted-root-key",
        name: `${LOCAL_KMS_KEY_NAME}/cryptoKeyVersions/latest`,
      }))
      .mockResolvedValueOnce(jsonResponse({
        ciphertext: "encrypted-root-key",
        name:
          "projects/murph-local/locations/global/keyRings/hosted-local/cryptoKeys/other/cryptoKeyVersions/1",
      }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createHostedGcpKmsClientFromEnv({
      HOSTED_CRYPTO_ALLOW_STATIC_GCP_ACCESS_TOKEN_FOR_DEV: "1",
      HOSTED_CRYPTO_ENV: "dev",
      HOSTED_CRYPTO_GCP_ACCESS_TOKEN: "ya29.static-token",
      HOSTED_CRYPTO_GCP_KMS_API_ROOT: "https://kms.example.test/v1",
      NODE_ENV: "test",
    });
    const input = {
      additionalAuthenticatedData: "domain=control",
      keyName: LOCAL_KMS_KEY_NAME,
      plaintext: new Uint8Array([1, 2, 3]),
    };

    await expect(client.encrypt(input)).rejects.toThrow(
      /must be a CryptoKeyVersion resource name/u,
    );
    await expect(client.encrypt(input)).rejects.toThrow(
      /did not match the requested CryptoKey/u,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("redacts raw Google provider messages from token exchange failures", async () => {
    const fetchMock: typeof fetch = async (input) => {
      const url = String(input);

      if (url === "https://sts.googleapis.com/v1/token") {
        return jsonResponse({
          access_token: "federated-access-token",
          expires_in: 3600,
          token_type: "Bearer",
        });
      }

      if (url.includes(":generateAccessToken")) {
        return jsonResponse({
          error: {
            code: 403,
            message:
              "Request had insufficient authentication scopes for service-account@example.test at projects/example-project.",
            status: "PERMISSION_DENIED",
          },
        }, { status: 403 });
      }

      return jsonResponse({ error: { status: "NOT_FOUND" } }, { status: 404 });
    };
    vi.stubGlobal("fetch", fetchMock);

    const client = createHostedGcpKmsClientFromEnv({
      HOSTED_CRYPTO_ENV: "production",
      HOSTED_CRYPTO_GCP_PROJECT_NUMBER: "123456789012",
      HOSTED_CRYPTO_GCP_SERVICE_ACCOUNT_EMAIL: "hosted-crypto@example.test",
      HOSTED_CRYPTO_GCP_WORKLOAD_IDENTITY_POOL_ID: "vercel",
      HOSTED_CRYPTO_GCP_WORKLOAD_IDENTITY_PROVIDER_ID: "vercel",
      NODE_ENV: "test",
    });

    let thrown: unknown;
    try {
      await client.encrypt({
        additionalAuthenticatedData: "domain=control",
        keyName: LOCAL_KMS_KEY_NAME,
        plaintext: new Uint8Array([1, 2, 3]),
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      code: "GOOGLE_CLOUD_API_ERROR",
      googleCloudOperation: "iamcredentials/generateAccessToken",
      googleCloudReason: "PERMISSION_DENIED",
      message: "Google Cloud iamcredentials/generateAccessToken failed (403): PERMISSION_DENIED",
      status: 403,
    });
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown instanceof Error ? thrown.message : "").not.toMatch(
      /service-account@example\.test|example-project|insufficient authentication scopes/u,
    );
  });

  it("uses stable operation labels for KMS failures instead of resource names", async () => {
    const fetchMock: typeof fetch = async (input) => {
      const url = String(input);

      if (url === "https://sts.googleapis.com/v1/token") {
        return jsonResponse({
          access_token: "federated-access-token",
          expires_in: 3600,
          token_type: "Bearer",
        });
      }

      if (url.includes(":generateAccessToken")) {
        return jsonResponse({
          accessToken: "kms-service-account-token",
          expireTime: "2099-01-01T00:00:00Z",
        });
      }

      if (url.includes(":encrypt")) {
        return jsonResponse({
          error: {
            code: 403,
            message: `KMS denied ${LOCAL_KMS_KEY_NAME}`,
            status: "projects/example-project/keyRings/hosted",
          },
        }, { status: 403, statusText: `Forbidden ${LOCAL_KMS_KEY_NAME}` });
      }

      return jsonResponse({ error: { status: "NOT_FOUND" } }, { status: 404 });
    };
    vi.stubGlobal("fetch", fetchMock);

    const client = createHostedGcpKmsClientFromEnv({
      HOSTED_CRYPTO_ENV: "production",
      HOSTED_CRYPTO_GCP_PROJECT_NUMBER: "123456789012",
      HOSTED_CRYPTO_GCP_SERVICE_ACCOUNT_EMAIL: "hosted-crypto@example.test",
      HOSTED_CRYPTO_GCP_WORKLOAD_IDENTITY_POOL_ID: "vercel",
      HOSTED_CRYPTO_GCP_WORKLOAD_IDENTITY_PROVIDER_ID: "vercel",
      NODE_ENV: "test",
    });

    let thrown: unknown;
    try {
      await client.encrypt({
        additionalAuthenticatedData: "domain=control",
        keyName: LOCAL_KMS_KEY_NAME,
        plaintext: new Uint8Array([1, 2, 3]),
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      code: "GOOGLE_CLOUD_API_ERROR",
      googleCloudOperation: "cloudkms/encrypt",
      googleCloudReason: "google_error_403",
      message: "Google Cloud cloudkms/encrypt failed (403): google_error_403",
      status: 403,
    });
    expect(JSON.stringify(thrown)).not.toMatch(/projects\/|keyRings|hosted-web-wrap/u);
  });

  it("keeps non-JSON Google error bodies out of KMS failure messages", async () => {
    const fetchMock: typeof fetch = async (input) => {
      const url = String(input);

      if (url === "https://sts.googleapis.com/v1/token") {
        return jsonResponse({
          access_token: "federated-access-token",
          expires_in: 3600,
          token_type: "Bearer",
        });
      }

      if (url.includes(":generateAccessToken")) {
        return jsonResponse({
          accessToken: "kms-service-account-token",
          expireTime: "2099-01-01T00:00:00Z",
        });
      }

      if (url.includes(":encrypt")) {
        return new Response(`KMS denied ${LOCAL_KMS_KEY_NAME}`, {
          headers: { "Content-Type": "text/plain" },
          status: 403,
          statusText: `Forbidden ${LOCAL_KMS_KEY_NAME}`,
        });
      }

      return jsonResponse({ error: { status: "NOT_FOUND" } }, { status: 404 });
    };
    vi.stubGlobal("fetch", fetchMock);

    const client = createHostedGcpKmsClientFromEnv({
      HOSTED_CRYPTO_ENV: "production",
      HOSTED_CRYPTO_GCP_PROJECT_NUMBER: "123456789012",
      HOSTED_CRYPTO_GCP_SERVICE_ACCOUNT_EMAIL: "hosted-crypto@example.test",
      HOSTED_CRYPTO_GCP_WORKLOAD_IDENTITY_POOL_ID: "vercel",
      HOSTED_CRYPTO_GCP_WORKLOAD_IDENTITY_PROVIDER_ID: "vercel",
      NODE_ENV: "test",
    });

    let thrown: unknown;
    try {
      await client.encrypt({
        additionalAuthenticatedData: "domain=control",
        keyName: LOCAL_KMS_KEY_NAME,
        plaintext: new Uint8Array([1, 2, 3]),
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      code: "GOOGLE_CLOUD_API_ERROR",
      googleCloudOperation: "cloudkms/encrypt",
      googleCloudReason: "http_403",
      message: "Google Cloud cloudkms/encrypt failed (403): http_403",
      status: 403,
    });
    expect(JSON.stringify(thrown)).not.toMatch(/projects\/|keyRings|hosted-web-wrap|KMS denied/u);
  });
});

describe("hosted crypto JSON KMS MAC signing", () => {
  it("calls the exact MAC key version and rejects malformed KMS responses", async () => {
    const expectedMac = Buffer.alloc(32, 7);
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        mac: expectedMac.toString("base64"),
        name: LOCAL_MAC_KEY_VERSION,
      }))
      .mockResolvedValueOnce(jsonResponse({
        mac: expectedMac.toString("base64"),
        name:
          "projects/example/locations/global/keyRings/ring/cryptoKeys/other/cryptoKeyVersions/1",
      }))
      .mockResolvedValueOnce(jsonResponse({
        mac: Buffer.alloc(31, 7).toString("base64"),
        name: LOCAL_MAC_KEY_VERSION,
      }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createHostedGcpKmsClientFromEnv({
      HOSTED_CRYPTO_ALLOW_STATIC_GCP_ACCESS_TOKEN_FOR_DEV: "1",
      HOSTED_CRYPTO_ENV: "dev",
      HOSTED_CRYPTO_GCP_ACCESS_TOKEN: "ya29.static-token",
      HOSTED_CRYPTO_GCP_KMS_API_ROOT: "https://kms.example.test/v1",
      NODE_ENV: "test",
    });
    const data = new Uint8Array([1, 2, 3, 4]);

    await expect(client.macSign({
      data,
      keyVersionName: LOCAL_MAC_KEY_VERSION,
    })).resolves.toEqual({
      keyVersionName: LOCAL_MAC_KEY_VERSION,
      mac: new Uint8Array(expectedMac),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `https://kms.example.test/v1/${LOCAL_MAC_KEY_VERSION}:macSign`,
      expect.objectContaining({
        body: JSON.stringify({ data: Buffer.from(data).toString("base64") }),
        method: "POST",
      }),
    );
    const firstHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(firstHeaders.get("authorization")).toBe("Bearer ya29.static-token");
    expect(firstHeaders.get("content-type")).toBe("application/json");

    await expect(client.macSign({
      data,
      keyVersionName: LOCAL_MAC_KEY_VERSION,
    })).rejects.toThrow(/response key version did not match/u);
    await expect(client.macSign({
      data,
      keyVersionName: LOCAL_MAC_KEY_VERSION,
    })).rejects.toThrow(/exactly 32 bytes/u);
  });
});

describe("hosted crypto local KMS", () => {
  it("encrypts, decrypts, and signs without GCP credentials", async () => {
    const signingKey = await createLocalSigningKey();
    const client = createHostedGcpKmsClientFromEnv({
      HOSTED_CRYPTO_GCP_KMS_API_ROOT: LOCAL_KMS_API_ROOT,
      HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK: signingKey.privateJwkJson,
      HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY: Buffer.alloc(32, 7).toString("base64"),
      NODE_ENV: "test",
    });

    const plaintext = new TextEncoder().encode("local hosted root");
    const encrypted = await client.encrypt({
      additionalAuthenticatedData: "domain=control",
      keyName: LOCAL_KMS_KEY_NAME,
      plaintext,
    });
    const decrypted = await client.decrypt({
      additionalAuthenticatedData: "domain=control",
      ciphertext: encrypted.ciphertext,
      keyName: LOCAL_KMS_KEY_NAME,
    });
    const signed = await client.asymmetricSign({
      keyVersionName: LOCAL_SIGN_KEY_VERSION,
      message: new TextEncoder().encode("sign me"),
    });

    expect(encrypted.ciphertext).toMatch(/^local-kms-v1:/u);
    expect(new TextDecoder().decode(decrypted.plaintext)).toBe("local hosted root");
    expect(signed.keyVersionName).toBe(LOCAL_SIGN_KEY_VERSION);
    await expect(
      crypto.subtle.verify(
        { hash: "SHA-256", name: "ECDSA" },
        signingKey.publicKey,
        Buffer.from(signed.signature, "base64"),
        new TextEncoder().encode("sign me"),
      ),
    ).resolves.toBe(true);
  });

  it("binds local ciphertext to the supplied KMS AAD", async () => {
    const signingKey = await createLocalSigningKey();
    const client = createHostedGcpKmsClientFromEnv({
      HOSTED_CRYPTO_GCP_KMS_API_ROOT: LOCAL_KMS_API_ROOT,
      HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK: signingKey.privateJwkJson,
      HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY: Buffer.alloc(32, 8).toString("base64"),
      NODE_ENV: "test",
    });
    const encrypted = await client.encrypt({
      additionalAuthenticatedData: "expected-aad",
      keyName: LOCAL_KMS_KEY_NAME,
      plaintext: new Uint8Array([1, 2, 3]),
    });

    const error = await client.decrypt({
      additionalAuthenticatedData: "wrong-aad",
      ciphertext: encrypted.ciphertext,
      keyName: LOCAL_KMS_KEY_NAME,
    }).then(() => null, (failure: unknown) => failure);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message)
      .toMatch(/Local KMS ciphertext could not be authenticated/u);
  });

  it("derives stable, key-version-bound 256-bit MACs without exposing the key", async () => {
    const signingKey = await createLocalSigningKey();
    const client = createHostedGcpKmsClientFromEnv({
      HOSTED_CRYPTO_GCP_KMS_API_ROOT: LOCAL_KMS_API_ROOT,
      HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK: signingKey.privateJwkJson,
      HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY: Buffer.alloc(32, 9).toString("base64"),
      NODE_ENV: "test",
    });
    const data = new TextEncoder().encode("member-scoped seed");

    const first = await client.macSign({
      data,
      keyVersionName: LOCAL_MAC_KEY_VERSION,
    });
    const replay = await client.macSign({
      data,
      keyVersionName: LOCAL_MAC_KEY_VERSION,
    });
    const changed = await client.macSign({
      data: new TextEncoder().encode("different seed"),
      keyVersionName: LOCAL_MAC_KEY_VERSION,
    });

    expect(first.keyVersionName).toBe(LOCAL_MAC_KEY_VERSION);
    expect(first.mac).toHaveLength(32);
    expect(first.mac).toEqual(replay.mac);
    expect(first.mac).not.toEqual(changed.mac);
  });

  it("rejects the local KMS shim in production", async () => {
    const signingKey = await createLocalSigningKey();
    const baseEnv = {
      HOSTED_CRYPTO_GCP_KMS_API_ROOT: LOCAL_KMS_API_ROOT,
      HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK: signingKey.privateJwkJson,
      HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY: Buffer.alloc(32, 7).toString("base64"),
      NODE_ENV: "test",
    } satisfies NodeJS.ProcessEnv;
    const productionEnvironments: readonly NodeJS.ProcessEnv[] = [
      { ...baseEnv, NODE_ENV: "production" },
      { ...baseEnv, NODE_ENV: "test", VERCEL_ENV: "production" },
      { ...baseEnv, HOSTED_CRYPTO_ENV: "prod", NODE_ENV: "test" },
      { ...baseEnv, HOSTED_CRYPTO_ENV: "production", NODE_ENV: "test" },
    ];

    for (const env of productionEnvironments) {
      expect(() => createHostedGcpKmsClientFromEnv(env)).toThrow(
        /local KMS is not allowed in production/u,
      );
    }
  });
});

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

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: init?.status ?? 200,
    statusText: init?.statusText,
  });
}

function pendingUntilAbort(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    if (!signal) {
      reject(new Error("Expected a provider request abort signal."));
      return;
    }
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

function readBearerToken(headers: Headers | undefined): string | null {
  const authorization = headers?.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }
  return authorization.slice("Bearer ".length);
}
