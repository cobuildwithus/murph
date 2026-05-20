import { describe, expect, it } from "vitest";

import {
  createHostedR2PresignedGetUrl,
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

  it("derives the default account-scoped R2 endpoint from deploy environment", () => {
    expect(readHostedR2PresignEnvironment({
      HOSTED_R2_PRESIGN_ACCESS_KEY_ID: "access-key",
      HOSTED_R2_PRESIGN_ACCOUNT_ID: "account-id",
      HOSTED_R2_PRESIGN_BUCKET_NAME: "bucket",
      HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY: "secret-key",
    })).toEqual({
      accessKeyId: "access-key",
      bucketName: "bucket",
      endpoint: "https://account-id.r2.cloudflarestorage.com",
      secretAccessKey: "secret-key",
    });
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
