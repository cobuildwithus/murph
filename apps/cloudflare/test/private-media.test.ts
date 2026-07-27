import {
  HOSTED_RUNTIME_GROUP_CHAT_ICON_URL_MAX_LENGTH,
  isHostedRuntimePrivateImageDeliveryUrl,
} from "@murphai/hosted-execution/runtime-control";
import { describe, expect, it, vi } from "vitest";

import type {
  R2PutValueLike,
} from "../src/crypto.ts";
import {
  HOSTED_PRIVATE_MEDIA_DELIVERY_ORIGIN,
  HOSTED_PRIVATE_MEDIA_LIFETIME_SECONDS,
  readHostedPrivateMedia,
  stageHostedPrivateMedia,
} from "../src/private-media.ts";
import {
  privateMediaRoutes,
} from "../src/worker/route-handlers/private-media.ts";
import {
  redactWorkerRoutePathname,
} from "../src/worker/route-utils/log-details.ts";
import {
  handleDeclarativeRoute,
} from "../src/worker/routes.ts";

const CAPABILITY_SECRET = "private-media-capability-secret-fixture";
const USER_ID = "member_private_media_fixture";
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47,
  0x0d, 0x0a, 0x1a, 0x0a,
]);

describe("hosted private media", () => {
  it("stores application-encrypted bytes and serves them through the opaque capability", async () => {
    const bucket = createPrivateMediaBucket();
    const nowMs = Date.parse("2026-07-27T12:00:00.000Z");
    const staged = await stageHostedPrivateMedia({
      bucket: bucket.api,
      bytes: PNG_BYTES,
      capabilitySecret: CAPABILITY_SECRET,
      contentType: "image/png",
      nowMs,
      userId: USER_ID,
    });

    expect(staged.url).toMatch(
      new RegExp(`^${HOSTED_PRIVATE_MEDIA_DELIVERY_ORIGIN.replace(/\./gu, "\\.")}/private-media/v1/v1\\.`),
    );
    expect(staged.url).not.toContain(USER_ID);
    expect(staged.url).not.toContain(staged.objectKey);
    expect(
      redactWorkerRoutePathname(new URL(staged.url).pathname),
    ).toBe("/private-media/v1/<REDACTED_CAPABILITY>");
    expect(bucket.put).toHaveBeenCalledOnce();
    expect(new TextDecoder().decode(bucket.objects[0]?.[1])).not.toContain(
      Buffer.from(PNG_BYTES).toString("base64"),
    );

    const url = new URL(staged.url);
    const media = await readHostedPrivateMedia({
      bucket: bucket.api,
      capability: url.pathname.split("/").at(-1) ?? "",
      capabilitySecret: CAPABILITY_SECRET,
      expiresAtUnixSeconds: Number(url.searchParams.get("exp")),
      nowMs,
    });
    expect(media).toEqual({
      bytes: PNG_BYTES,
      contentType: "image/png",
    });
  });

  it("keeps retry cardinality at one object without extending its upload age", async () => {
    const bucket = createPrivateMediaBucket();
    const input = {
      bucket: bucket.api,
      bytes: PNG_BYTES,
      capabilitySecret: CAPABILITY_SECRET,
      contentType: "image/png" as const,
      nowMs: Date.parse("2026-07-27T12:00:00.000Z"),
      userId: USER_ID,
    };

    const first = await stageHostedPrivateMedia(input);
    const retry = await stageHostedPrivateMedia({
      ...input,
      nowMs: input.nowMs + 30_000,
    });

    expect(first.objectKey).toBe(retry.objectKey);
    expect(first.url).not.toBe(retry.url);
    expect(bucket.put).toHaveBeenCalledOnce();
    expect(bucket.objects).toHaveLength(1);
  });

  it("keeps the largest accepted member id within the provider URL contract", async () => {
    const staged = await stageHostedPrivateMedia({
      bucket: createPrivateMediaBucket().api,
      bytes: PNG_BYTES,
      capabilitySecret: CAPABILITY_SECRET,
      contentType: "image/png",
      userId: "m".repeat(512),
    });

    expect(staged.url.length).toBeLessThanOrEqual(
      HOSTED_RUNTIME_GROUP_CHAT_ICON_URL_MAX_LENGTH,
    );
    expect(isHostedRuntimePrivateImageDeliveryUrl(new URL(staged.url))).toBe(
      true,
    );
  });

  it("fails closed for expired, tampered, or wrong-secret capabilities", async () => {
    const bucket = createPrivateMediaBucket();
    const nowMs = Date.parse("2026-07-27T12:00:00.000Z");
    const staged = await stageHostedPrivateMedia({
      bucket: bucket.api,
      bytes: PNG_BYTES,
      capabilitySecret: CAPABILITY_SECRET,
      contentType: "image/png",
      nowMs,
      userId: USER_ID,
    });
    const url = new URL(staged.url);
    const capability = url.pathname.split("/").at(-1) ?? "";
    const expiresAtUnixSeconds = Number(url.searchParams.get("exp"));

    await expect(readHostedPrivateMedia({
      bucket: bucket.api,
      capability,
      capabilitySecret: CAPABILITY_SECRET,
      expiresAtUnixSeconds,
      nowMs: nowMs + HOSTED_PRIVATE_MEDIA_LIFETIME_SECONDS * 1_000,
    })).resolves.toBeNull();
    await expect(readHostedPrivateMedia({
      bucket: bucket.api,
      capability: `${capability.slice(0, -1)}x`,
      capabilitySecret: CAPABILITY_SECRET,
      expiresAtUnixSeconds,
      nowMs,
    })).resolves.toBeNull();
    await expect(readHostedPrivateMedia({
      bucket: bucket.api,
      capability,
      capabilitySecret: "different-private-media-secret-value",
      expiresAtUnixSeconds,
      nowMs,
    })).resolves.toBeNull();
  });

  it("serves only valid GET capabilities with no-store response headers", async () => {
    const bucket = createPrivateMediaBucket();
    const staged = await stageHostedPrivateMedia({
      bucket: bucket.api,
      bytes: PNG_BYTES,
      capabilitySecret: CAPABILITY_SECRET,
      contentType: "image/png",
      userId: USER_ID,
    });
    const env = {
      BUNDLES: bucket.api,
      HOSTED_PRIVATE_MEDIA_CAPABILITY_SECRET: CAPABILITY_SECRET,
    };

    const request = new Request(staged.url);
    const response = await handleDeclarativeRoute(privateMediaRoutes, {
      env,
      request,
      url: new URL(request.url),
    });
    expect(response).not.toBeNull();
    if (!response) {
      throw new Error("Expected private media response.");
    }
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG_BYTES);

    const wrongMethodRequest = new Request(staged.url, { method: "POST" });
    const wrongMethod = await handleDeclarativeRoute(privateMediaRoutes, {
      env,
      request: wrongMethodRequest,
      url: new URL(wrongMethodRequest.url),
    });
    expect(wrongMethod).not.toBeNull();
    if (!wrongMethod) {
      throw new Error("Expected wrong-method response.");
    }
    expect(wrongMethod.status).toBe(404);
    const extraQuery = new URL(staged.url);
    extraQuery.searchParams.set("tracking", "1");
    const invalidRequest = new Request(extraQuery);
    const invalid = await handleDeclarativeRoute(privateMediaRoutes, {
      env,
      request: invalidRequest,
      url: new URL(invalidRequest.url),
    });
    expect(invalid).not.toBeNull();
    if (!invalid) {
      throw new Error("Expected invalid-capability response.");
    }
    expect(invalid.status).toBe(404);
  });

  it("leaves no object when the encrypted R2 write fails before URL return", async () => {
    const bucket = createPrivateMediaBucket({
      putError: new Error("fixture write failure"),
    });

    await expect(stageHostedPrivateMedia({
      bucket: bucket.api,
      bytes: PNG_BYTES,
      capabilitySecret: CAPABILITY_SECRET,
      contentType: "image/png",
      userId: USER_ID,
    })).rejects.toThrow("fixture write failure");
    expect(bucket.objects).toHaveLength(0);
  });

  it("seals the capability before creating an R2 object", async () => {
    const bucket = createPrivateMediaBucket();
    const encrypt = vi.spyOn(crypto.subtle, "encrypt")
      .mockRejectedValueOnce(new Error("fixture capability seal failure"));
    try {
      await expect(stageHostedPrivateMedia({
        bucket: bucket.api,
        bytes: PNG_BYTES,
        capabilitySecret: CAPABILITY_SECRET,
        contentType: "image/png",
        userId: USER_ID,
      })).rejects.toThrow("fixture capability seal failure");
    } finally {
      encrypt.mockRestore();
    }
    expect(bucket.put).not.toHaveBeenCalled();
    expect(bucket.objects).toHaveLength(0);
  });
});

function createPrivateMediaBucket(input: {
  putError?: Error;
} = {}) {
  const values = new Map<string, Uint8Array>();
  const put = vi.fn(async (key: string, value: R2PutValueLike) => {
    if (input.putError) {
      throw input.putError;
    }
    values.set(key, await readPutValue(value));
  });
  return {
    api: {
      async get(key: string) {
        const value = values.get(key);
        return value
          ? {
              async arrayBuffer() {
                return toArrayBuffer(value);
              },
              key,
              size: value.byteLength,
            }
          : null;
      },
      put,
    },
    get objects() {
      return [...values.entries()];
    },
    put,
  };
}

async function readPutValue(value: R2PutValueLike): Promise<Uint8Array> {
  if (typeof value === "string") {
    return new TextEncoder().encode(value);
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(
      value.buffer.slice(
        value.byteOffset,
        value.byteOffset + value.byteLength,
      ) as ArrayBuffer,
    );
  }
  if (value instanceof Blob) {
    return new Uint8Array(await value.arrayBuffer());
  }
  return new Uint8Array(await new Response(value).arrayBuffer());
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}
