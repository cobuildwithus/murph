import { createHash, createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  HOSTED_R2_CHECKSUM_MODE_ENABLED,
  HOSTED_R2_CHECKSUM_MODE_HEADER,
  createHostedR2PresignedDeleteUrl,
  createHostedR2PresignedGetUrl,
  createHostedR2PresignedHeadUrl,
  createHostedR2PresignedPutUrl,
  readHostedR2PresignEnvironment,
} from "../src/r2-presigned-url.js";

describe("R2 presigned URL helpers", () => {
  it("creates a deterministic signed PUT URL for a workspace snapshot object", async () => {
    const result = await createHostedR2PresignedPutUrl({
      contentType: "application/octet-stream",
      environment: {
        accessKeyId: "AKIDEXAMPLE",
        bucketName: "snapshot-bucket",
        endpoint: "https://example-account.r2.cloudflarestorage.com",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      },
      expiresSeconds: 600,
      key: "users/ns/workspace-snapshots/snapshot-1.snapshot.enc",
      now: new Date("2026-05-20T12:34:56.000Z"),
    });

    expect(result).toEqual({
      expiresAt: "2026-05-20T12:44:56.000Z",
      url: "https://example-account.r2.cloudflarestorage.com/snapshot-bucket/users/ns/workspace-snapshots/snapshot-1.snapshot.enc?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=AKIDEXAMPLE%2F20260520%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260520T123456Z&X-Amz-Expires=600&X-Amz-Signature=ff81363eaa336701687b06aa0bf4715400cdb902de9fa3c7da90a491b58ec2ed&X-Amz-SignedHeaders=content-type%3Bhost%3Bif-none-match",
    });
  });

  it("includes signed object metadata headers when requested", async () => {
    const result = await createHostedR2PresignedPutUrl({
      checksumSha256Base64: Buffer.from("a".repeat(64), "hex").toString("base64"),
      contentType: "application/octet-stream",
      environment: {
        accessKeyId: "AKIDEXAMPLE",
        bucketName: "snapshot-bucket",
        endpoint: "https://example-account.r2.cloudflarestorage.com",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      },
      expiresSeconds: 600,
      key: "users/ns/workspace-snapshots/snapshot-1.snapshot.enc",
      metadata: {
        encryptedsha256: "a".repeat(64),
        schema: "murph.hosted-workspace-snapshot.v2",
        snapshotid: "snapshot-1",
      },
      now: new Date("2026-05-20T12:34:56.000Z"),
    });
    const url = new URL(result.url);

    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe(
      "content-type;host;if-none-match;x-amz-checksum-sha256;x-amz-meta-encryptedsha256;x-amz-meta-schema;x-amz-meta-snapshotid",
    );
    expect(url.searchParams.get("X-Amz-Signature")).toEqual(expect.stringMatching(/^[0-9a-f]{64}$/u));
  });

  it("binds signed checksum header values into the PUT signature", async () => {
    const baseInput = {
      contentType: "application/octet-stream",
      environment: {
        accessKeyId: "AKIDEXAMPLE",
        bucketName: "snapshot-bucket",
        endpoint: "https://example-account.r2.cloudflarestorage.com",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      },
      expiresSeconds: 600,
      key: "users/ns/workspace-snapshots/snapshot-1.snapshot.enc",
      metadata: {
        encryptedsha256: "a".repeat(64),
        schema: "murph.hosted-workspace-snapshot.v2",
        snapshotid: "snapshot-1",
      },
      now: new Date("2026-05-20T12:34:56.000Z"),
    } as const;
    const left = await createHostedR2PresignedPutUrl({
      ...baseInput,
      checksumSha256Base64: Buffer.from("a".repeat(64), "hex").toString("base64"),
    });
    const right = await createHostedR2PresignedPutUrl({
      ...baseInput,
      checksumSha256Base64: Buffer.from("b".repeat(64), "hex").toString("base64"),
    });

    expect(new URL(left.url).searchParams.get("X-Amz-Signature")).not.toBe(
      new URL(right.url).searchParams.get("X-Amz-Signature"),
    );
  });

  it("creates presigned GET URLs with only the host header signed", async () => {
    const result = await createHostedR2PresignedGetUrl({
      environment: {
        accessKeyId: "AKIDEXAMPLE",
        bucketName: "snapshot-bucket",
        endpoint: "https://example-account.r2.cloudflarestorage.com",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      },
      expiresSeconds: 600,
      key: "users/ns/workspace-snapshots/snapshot-1.snapshot.enc",
      now: new Date("2026-05-20T12:34:56.000Z"),
    });
    const url = new URL(result.url);

    expect(url.pathname).toBe("/snapshot-bucket/users/ns/workspace-snapshots/snapshot-1.snapshot.enc");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect(url.searchParams.get("X-Amz-Signature")).toEqual(expect.stringMatching(/^[0-9a-f]{64}$/u));
  });

  it("can bind S3 checksum mode into presigned HEAD URLs", async () => {
    const result = await createHostedR2PresignedHeadUrl({
      checksumMode: HOSTED_R2_CHECKSUM_MODE_ENABLED,
      environment: {
        accessKeyId: "AKIDEXAMPLE",
        bucketName: "snapshot-bucket",
        endpoint: "https://example-account.r2.cloudflarestorage.com",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      },
      expiresSeconds: 600,
      key: "users/ns/workspace-snapshots/snapshot-1.snapshot.enc",
      now: new Date("2026-05-20T12:34:56.000Z"),
    });
    const url = new URL(result.url);

    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe(
      `host;${HOSTED_R2_CHECKSUM_MODE_HEADER}`,
    );
    expect(url.searchParams.get("X-Amz-Signature")).toEqual(expect.stringMatching(/^[0-9a-f]{64}$/u));
  });

  it("derives the default account-scoped R2 endpoint from deploy environment", () => {
    expect(readHostedR2PresignEnvironment({
      HOSTED_R2_PRESIGN_ACCESS_KEY_ID: "access-key",
      HOSTED_R2_PRESIGN_ACCOUNT_ID: "account-id",
      HOSTED_R2_PRESIGN_BUCKET_NAME: "bucket",
      HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY: "secret-key",
    })).toEqual({
      accessKeyId: "access-key",
      bucketName: "bucket",
      controlEndpoint: null,
      endpoint: "https://account-id.r2.cloudflarestorage.com",
      localEndpointAllowed: false,
      secretAccessKey: "secret-key",
    });
  });

  it("allows explicit hosted-local MinIO endpoints without loosening production defaults", async () => {
    const environment = readHostedR2PresignEnvironment({
      HOSTED_R2_PRESIGN_ACCESS_KEY_ID: "access-key",
      HOSTED_R2_PRESIGN_ACCOUNT_ID: "account-id",
      HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT: "1",
      HOSTED_R2_PRESIGN_BUCKET_NAME: "bucket",
      HOSTED_R2_PRESIGN_CONTROL_ENDPOINT: "http://127.0.0.1:9000",
      HOSTED_R2_PRESIGN_ENDPOINT: "http://host.docker.internal:9000",
      HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY: "secret-key",
      MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
    });

    expect(environment).toEqual({
      accessKeyId: "access-key",
      bucketName: "bucket",
      controlEndpoint: "http://127.0.0.1:9000",
      endpoint: "http://host.docker.internal:9000",
      localEndpointAllowed: true,
      secretAccessKey: "secret-key",
    });

    const head = await createHostedR2PresignedHeadUrl({
      environment,
      key: "users/ns/workspace-snapshots/snapshot-1.snapshot.enc",
      now: new Date("2026-05-20T12:34:56.000Z"),
    });
    const deleted = await createHostedR2PresignedDeleteUrl({
      environment,
      key: "users/ns/workspace-snapshots/snapshot-1.snapshot.enc",
      now: new Date("2026-05-20T12:34:56.000Z"),
    });
    const checksumHead = await createHostedR2PresignedHeadUrl({
      checksumMode: HOSTED_R2_CHECKSUM_MODE_ENABLED,
      environment,
      key: "users/ns/workspace-snapshots/snapshot-1.snapshot.enc",
      now: new Date("2026-05-20T12:34:56.000Z"),
    });
    verifyLocalS3SigV4QueryUrl({
      accessKeyId: "access-key",
      amzDate: "20260520T123456Z",
      bucketName: "bucket",
      endpoint: "http://host.docker.internal:9000",
      expiresSeconds: 600,
      key: "users/ns/workspace-snapshots/snapshot-1.snapshot.enc",
      method: "HEAD",
      secretAccessKey: "secret-key",
      url: head.url,
    });
    verifyLocalS3SigV4QueryUrl({
      accessKeyId: "access-key",
      amzDate: "20260520T123456Z",
      bucketName: "bucket",
      checksumMode: HOSTED_R2_CHECKSUM_MODE_ENABLED,
      endpoint: "http://host.docker.internal:9000",
      expiresSeconds: 600,
      key: "users/ns/workspace-snapshots/snapshot-1.snapshot.enc",
      method: "HEAD",
      secretAccessKey: "secret-key",
      url: checksumHead.url,
    });
    verifyLocalS3SigV4QueryUrl({
      accessKeyId: "access-key",
      amzDate: "20260520T123456Z",
      bucketName: "bucket",
      endpoint: "http://host.docker.internal:9000",
      expiresSeconds: 600,
      key: "users/ns/workspace-snapshots/snapshot-1.snapshot.enc",
      method: "DELETE",
      secretAccessKey: "secret-key",
      url: deleted.url,
    });
    expect(new URL(deleted.url).searchParams.get("X-Amz-Signature"))
      .not.toBe(new URL(head.url).searchParams.get("X-Amz-Signature"));
    expect(new URL(checksumHead.url).searchParams.get("X-Amz-Signature"))
      .not.toBe(new URL(head.url).searchParams.get("X-Amz-Signature"));
  });

  it("allows hosted-local dev profiles to use local MinIO endpoints", () => {
    const environment = readHostedR2PresignEnvironment({
      HOSTED_R2_PRESIGN_ACCESS_KEY_ID: "access-key",
      HOSTED_R2_PRESIGN_ACCOUNT_ID: "account-id",
      HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT: "1",
      HOSTED_R2_PRESIGN_BUCKET_NAME: "bucket",
      HOSTED_R2_PRESIGN_CONTROL_ENDPOINT: "http://127.0.0.1:9000",
      HOSTED_R2_PRESIGN_ENDPOINT: "http://host.docker.internal:9000",
      HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY: "secret-key",
      MURPH_HOSTED_LOCAL_PROFILE: "dev",
    });

    expect(environment).toEqual(expect.objectContaining({
      bucketName: "bucket",
      controlEndpoint: "http://127.0.0.1:9000",
      endpoint: "http://host.docker.internal:9000",
      localEndpointAllowed: true,
    }));
  });

  it("allows only the exact discovered Docker bridge host for hosted-local MinIO", () => {
    expect(readHostedR2PresignEnvironment({
      HOSTED_R2_PRESIGN_ACCESS_KEY_ID: "access-key",
      HOSTED_R2_PRESIGN_ACCOUNT_ID: "account-id",
      HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT: "1",
      HOSTED_R2_PRESIGN_BUCKET_NAME: "bucket",
      HOSTED_R2_PRESIGN_CONTROL_ENDPOINT: "http://172.17.0.1:9000",
      HOSTED_R2_PRESIGN_ENDPOINT: "http://172.17.0.1:9000",
      HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY: "secret-key",
      MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
      MURPH_HOSTED_LOCAL_R2_DOCKER_BRIDGE_HOST: "172.17.0.1",
    })).toEqual({
      accessKeyId: "access-key",
      bucketName: "bucket",
      controlEndpoint: "http://172.17.0.1:9000",
      endpoint: "http://172.17.0.1:9000",
      localEndpointAllowed: true,
      secretAccessKey: "secret-key",
    });

    expect(() => readHostedR2PresignEnvironment({
      HOSTED_R2_PRESIGN_ACCESS_KEY_ID: "access-key",
      HOSTED_R2_PRESIGN_ACCOUNT_ID: "account-id",
      HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT: "1",
      HOSTED_R2_PRESIGN_BUCKET_NAME: "bucket",
      HOSTED_R2_PRESIGN_CONTROL_ENDPOINT: "http://172.17.0.2:9000",
      HOSTED_R2_PRESIGN_ENDPOINT: "http://172.17.0.1:9000",
      HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY: "secret-key",
      MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
      MURPH_HOSTED_LOCAL_R2_DOCKER_BRIDGE_HOST: "172.17.0.1",
    })).toThrow("HOSTED_R2_PRESIGN_CONTROL_ENDPOINT must be a hosted-local S3-compatible origin");
  });

  it("rejects hosted-local MinIO endpoints in production-shaped environments", () => {
    expect(() => readHostedR2PresignEnvironment({
      HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT: "Production",
      HOSTED_R2_PRESIGN_ACCESS_KEY_ID: "access-key",
      HOSTED_R2_PRESIGN_ACCOUNT_ID: "account-id",
      HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT: "1",
      HOSTED_R2_PRESIGN_BUCKET_NAME: "bucket",
      HOSTED_R2_PRESIGN_ENDPOINT: "http://127.0.0.1:9000",
      HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY: "secret-key",
      MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
    })).toThrow("HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT is not supported in production environments");
  });

  it("rejects hosted-local MinIO endpoints without hosted-local isolation markers", () => {
    expect(() => readHostedR2PresignEnvironment({
      HOSTED_R2_PRESIGN_ACCESS_KEY_ID: "access-key",
      HOSTED_R2_PRESIGN_ACCOUNT_ID: "account-id",
      HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT: "1",
      HOSTED_R2_PRESIGN_BUCKET_NAME: "bucket",
      HOSTED_R2_PRESIGN_ENDPOINT: "http://127.0.0.1:9000",
      HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY: "secret-key",
    })).toThrow("HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT requires a hosted-local profile or test isolation");

    expect(() => readHostedR2PresignEnvironment({
      HOSTED_R2_PRESIGN_ACCESS_KEY_ID: "access-key",
      HOSTED_R2_PRESIGN_ACCOUNT_ID: "account-id",
      HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT: "1",
      HOSTED_R2_PRESIGN_BUCKET_NAME: "bucket",
      HOSTED_R2_PRESIGN_ENDPOINT: "http://127.0.0.1:9000",
      HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY: "secret-key",
      NODE_ENV: "test",
    })).toThrow("HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT requires a hosted-local profile or test isolation");
  });

  it("does not treat hosted-local test routes as local R2 isolation outside NODE_ENV=test", () => {
    for (const nodeEnv of [undefined, "development"] as const) {
      expect(() => readHostedR2PresignEnvironment({
        HOSTED_R2_PRESIGN_ACCESS_KEY_ID: "access-key",
        HOSTED_R2_PRESIGN_ACCOUNT_ID: "account-id",
        HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT: "1",
        HOSTED_R2_PRESIGN_BUCKET_NAME: "bucket",
        HOSTED_R2_PRESIGN_ENDPOINT: "http://host.docker.internal:9000",
        HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY: "secret-key",
        MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
        ...(nodeEnv === undefined ? {} : { NODE_ENV: nodeEnv }),
      })).toThrow("HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT requires a hosted-local profile or test isolation");
    }
  });

  it("rejects public local endpoint hosts and real R2 control endpoints", () => {
    expect(() => readHostedR2PresignEnvironment({
      HOSTED_R2_PRESIGN_ACCESS_KEY_ID: "access-key",
      HOSTED_R2_PRESIGN_ACCOUNT_ID: "account-id",
      HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT: "1",
      HOSTED_R2_PRESIGN_BUCKET_NAME: "bucket",
      HOSTED_R2_PRESIGN_ENDPOINT: "http://203.0.113.10:9000",
      HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY: "secret-key",
      MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
    })).toThrow("HOSTED_R2_PRESIGN_ENDPOINT must be the account-level R2 HTTPS origin");

    expect(() => readHostedR2PresignEnvironment({
      HOSTED_R2_PRESIGN_ACCESS_KEY_ID: "access-key",
      HOSTED_R2_PRESIGN_ACCOUNT_ID: "account-id",
      HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT: "1",
      HOSTED_R2_PRESIGN_BUCKET_NAME: "bucket",
      HOSTED_R2_PRESIGN_CONTROL_ENDPOINT: "https://account-id.r2.cloudflarestorage.com",
      HOSTED_R2_PRESIGN_ENDPOINT: "http://127.0.0.1:9000",
      HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY: "secret-key",
      MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
    })).toThrow("HOSTED_R2_PRESIGN_CONTROL_ENDPOINT must be a hosted-local S3-compatible origin");
  });

  it.each([
    ["10.x RFC1918", "10.1.2.3"],
    ["172.16.x RFC1918", "172.16.2.3"],
    ["172.31.x RFC1918", "172.31.2.3"],
    ["192.168.x RFC1918", "192.168.2.3"],
    ["IPv4 link-local", "169.254.2.3"],
  ] as const)("rejects %s hosts as hosted-local R2 presign endpoints", (_label, host) => {
    expect(() => readHostedR2PresignEnvironment({
      HOSTED_R2_PRESIGN_ACCESS_KEY_ID: "access-key",
      HOSTED_R2_PRESIGN_ACCOUNT_ID: "account-id",
      HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT: "1",
      HOSTED_R2_PRESIGN_BUCKET_NAME: "bucket",
      HOSTED_R2_PRESIGN_ENDPOINT: `http://${host}:9000`,
      HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY: "secret-key",
      MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
    })).toThrow("HOSTED_R2_PRESIGN_ENDPOINT must be the account-level R2 HTTPS origin");
  });

  it.each([
    ["10.x RFC1918", "10.1.2.3"],
    ["172.16.x RFC1918", "172.16.2.3"],
    ["172.31.x RFC1918", "172.31.2.3"],
    ["192.168.x RFC1918", "192.168.2.3"],
    ["IPv4 link-local", "169.254.2.3"],
  ] as const)("rejects %s hosts as hosted-local R2 control endpoints", (_label, host) => {
    expect(() => readHostedR2PresignEnvironment({
      HOSTED_R2_PRESIGN_ACCESS_KEY_ID: "access-key",
      HOSTED_R2_PRESIGN_ACCOUNT_ID: "account-id",
      HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT: "1",
      HOSTED_R2_PRESIGN_BUCKET_NAME: "bucket",
      HOSTED_R2_PRESIGN_CONTROL_ENDPOINT: `http://${host}:9000`,
      HOSTED_R2_PRESIGN_ENDPOINT: "http://host.docker.internal:9000",
      HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY: "secret-key",
      MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
    })).toThrow("HOSTED_R2_PRESIGN_CONTROL_ENDPOINT must be a hosted-local S3-compatible origin");
  });

  it("canonicalizes metadata whitespace before signing", async () => {
    const environment = readHostedR2PresignEnvironment({
      HOSTED_R2_PRESIGN_ACCESS_KEY_ID: "access-key",
      HOSTED_R2_PRESIGN_ACCOUNT_ID: "account-id",
      HOSTED_R2_PRESIGN_BUCKET_NAME: "bucket",
      HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY: "secret-key",
    });
    const first = await createHostedR2PresignedPutUrl({
      checksumSha256Base64: Buffer.from("a".repeat(64), "hex").toString("base64"),
      contentType: "application/octet-stream",
      environment,
      key: "snapshots/a.enc",
      metadata: {
        label: "a  b\tc",
      },
      now: new Date("2026-05-20T12:34:56.000Z"),
    });
    const second = await createHostedR2PresignedPutUrl({
      checksumSha256Base64: Buffer.from("a".repeat(64), "hex").toString("base64"),
      contentType: "application/octet-stream",
      environment,
      key: "snapshots/a.enc",
      metadata: {
        label: "a b c",
      },
      now: new Date("2026-05-20T12:34:56.000Z"),
    });

    expect(first.url).toBe(second.url);
  });

  it("rejects non-account-level R2 endpoint overrides", () => {
    expect(() => readHostedR2PresignEnvironment({
      HOSTED_R2_PRESIGN_ACCESS_KEY_ID: "access-key",
      HOSTED_R2_PRESIGN_ACCOUNT_ID: "account-id",
      HOSTED_R2_PRESIGN_BUCKET_NAME: "bucket",
      HOSTED_R2_PRESIGN_ENDPOINT: "http://example.test/r2",
      HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY: "secret-key",
    })).toThrow("HOSTED_R2_PRESIGN_ENDPOINT must be the account-level R2 HTTPS origin");

    expect(() => readHostedR2PresignEnvironment({
      HOSTED_R2_PRESIGN_ACCESS_KEY_ID: "access-key",
      HOSTED_R2_PRESIGN_ACCOUNT_ID: "account-id",
      HOSTED_R2_PRESIGN_BUCKET_NAME: "bucket",
      HOSTED_R2_PRESIGN_ENDPOINT: "https://bucket.account-id.r2.cloudflarestorage.com",
      HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY: "secret-key",
    })).toThrow("HOSTED_R2_PRESIGN_ENDPOINT must be the account-level R2 HTTPS origin");
  });
});

function verifyLocalS3SigV4QueryUrl(input: {
  accessKeyId: string;
  amzDate: string;
  bucketName: string;
  checksumMode?: typeof HOSTED_R2_CHECKSUM_MODE_ENABLED;
  endpoint: string;
  expiresSeconds: number;
  key: string;
  method: "DELETE" | "HEAD";
  secretAccessKey: string;
  url: string;
}): void {
  const url = new URL(input.url);
  const endpoint = new URL(input.endpoint);
  const canonicalUri = `/${encodeSigV4PathSegment(input.bucketName)}/${encodeSigV4ObjectKey(input.key)}`;
  const credentialScope = `${input.amzDate.slice(0, 8)}/auto/s3/aws4_request`;
  const credential = `${input.accessKeyId}/${credentialScope}`;
  const signedHeaders = [
    "host",
    ...(input.checksumMode === undefined ? [] : [HOSTED_R2_CHECKSUM_MODE_HEADER]),
  ].join(";");
  const expectedQuery = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Content-Sha256": "UNSIGNED-PAYLOAD",
    "X-Amz-Credential": credential,
    "X-Amz-Date": input.amzDate,
    "X-Amz-Expires": String(input.expiresSeconds),
    "X-Amz-SignedHeaders": signedHeaders,
  });
  const canonicalQuery = canonicalizeSigV4SearchParams(expectedQuery);
  const canonicalHeaders = [
    `host:${url.host}`,
    ...(input.checksumMode === undefined
      ? []
      : [`${HOSTED_R2_CHECKSUM_MODE_HEADER}:${input.checksumMode}`]),
    "",
  ].join("\n");
  const canonicalRequest = [
    input.method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    input.amzDate,
    credentialScope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");
  const signature = createHmac("sha256", deriveSigV4SigningKey({
    dateStamp: input.amzDate.slice(0, 8),
    secretAccessKey: input.secretAccessKey,
  })).update(stringToSign).digest("hex");

  expect(url.origin).toBe(endpoint.origin);
  expect(url.pathname).toBe(canonicalUri);
  expect(url.host).toBe(endpoint.host);
  expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
  expect(url.searchParams.get("X-Amz-Content-Sha256")).toBe("UNSIGNED-PAYLOAD");
  expect(url.searchParams.get("X-Amz-Credential")).toBe(credential);
  expect(url.searchParams.get("X-Amz-Date")).toBe(input.amzDate);
  expect(url.searchParams.get("X-Amz-Expires")).toBe(String(input.expiresSeconds));
  expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe(signedHeaders);
  expect(canonicalizeSigV4SearchParamsWithoutSignature(url.searchParams)).toBe(canonicalQuery);
  expect(url.searchParams.get("X-Amz-Signature")).toBe(signature);
}

function deriveSigV4SigningKey(input: {
  dateStamp: string;
  secretAccessKey: string;
}): Buffer {
  const dateKey = createHmac("sha256", `AWS4${input.secretAccessKey}`).update(input.dateStamp).digest();
  const regionKey = createHmac("sha256", dateKey).update("auto").digest();
  const serviceKey = createHmac("sha256", regionKey).update("s3").digest();
  return createHmac("sha256", serviceKey).update("aws4_request").digest();
}

function canonicalizeSigV4SearchParamsWithoutSignature(params: URLSearchParams): string {
  const unsignedParams = new URLSearchParams();
  for (const [key, value] of params.entries()) {
    if (key !== "X-Amz-Signature") {
      unsignedParams.append(key, value);
    }
  }
  return canonicalizeSigV4SearchParams(unsignedParams);
}

function canonicalizeSigV4SearchParams(params: URLSearchParams): string {
  return [...params.entries()]
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey ? leftValue.localeCompare(rightValue) : leftKey.localeCompare(rightKey))
    .map(([key, value]) => `${encodeSigV4PathSegment(key)}=${encodeSigV4PathSegment(value)}`)
    .join("&");
}

function encodeSigV4ObjectKey(key: string): string {
  return key.split("/").map(encodeSigV4PathSegment).join("/");
}

function encodeSigV4PathSegment(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()*]/gu, (character) =>
      `%${character.charCodeAt(0).toString(16).padStart(2, "0").toUpperCase()}`);
}
