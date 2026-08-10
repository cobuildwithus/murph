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
  matchHostedPrivateMediaCapabilityPath,
  readHostedPrivateMedia,
  stageHostedPrivateMedia,
} from "../src/private-media.ts";
import {
  privateMediaRoutes,
} from "../src/worker/route-handlers/private-media.ts";
import {
  parseHostedRunnerPrivateImageUrlPublishResponse,
} from "../src/runner-effects-contract.ts";
import {
  redactWorkerRoutePathname,
} from "../src/worker/route-utils/log-details.ts";
import {
  handleDeclarativeRoute,
} from "../src/worker/routes.ts";

const CAPABILITY_SECRET = "private-media-capability-secret-fixture";
const PREVIEW_DELIVERY_ORIGIN = "https://hosted-runner-staging.example.test";
const USER_ID = "member_private_media_fixture";
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47,
  0x0d, 0x0a, 0x1a, 0x0a,
]);
const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46,
  0x00, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50,
]);

const NON_PNG_PRIVATE_MEDIA_FORMATS = [
  { bytes: JPEG_BYTES, contentType: "image/jpeg", extension: "jpg" },
  { bytes: WEBP_BYTES, contentType: "image/webp", extension: "webp" },
] as const;

describe("hosted private media", () => {
  it("stores application-encrypted bytes and serves them through the opaque capability", async () => {
    const nowMs = Date.parse("2026-07-27T12:00:00.000Z");
    const bucket = createPrivateMediaBucket({ nowMs });
    const staged = await stageHostedPrivateMedia({
      bucket: bucket.api,
      bytes: PNG_BYTES,
      capabilitySecret: CAPABILITY_SECRET,
      contentType: "image/png",
      deliveryOrigin: HOSTED_PRIVATE_MEDIA_DELIVERY_ORIGIN,
      nowMs,
      userId: USER_ID,
    });

    expect(staged.url).toMatch(
      new RegExp(`^${HOSTED_PRIVATE_MEDIA_DELIVERY_ORIGIN.replace(/\./gu, "\\.")}/private-media/v1/v1\\..+/group-avatar\\.png\\?exp=`),
    );
    expect(staged.url).not.toContain(USER_ID);
    expect(staged.url).not.toContain(staged.objectKey);
    expect(
      redactWorkerRoutePathname(new URL(staged.url).pathname),
    ).toBe("/private-media/v1/<REDACTED_CAPABILITY>/group-avatar.png");
    expect(bucket.put).toHaveBeenCalledOnce();
    expect(new TextDecoder().decode(bucket.objects[0]?.[1])).not.toContain(
      Buffer.from(PNG_BYTES).toString("base64"),
    );

    const url = new URL(staged.url);
    const matched = matchHostedPrivateMediaCapabilityPath(url.pathname);
    expect(matched).not.toBeNull();
    const media = await readHostedPrivateMedia({
      bucket: bucket.api,
      capability: matched?.capability ?? "",
      capabilitySecret: CAPABILITY_SECRET,
      expiresAtUnixSeconds: Number(url.searchParams.get("exp")),
      nowMs,
    });
    expect(media).toEqual({
      bytes: PNG_BYTES,
      contentType: "image/png",
    });
  });

  it.each(NON_PNG_PRIVATE_MEDIA_FORMATS)(
    "mints and serves the MIME-derived .$extension filename for $contentType",
    async ({ bytes, contentType, extension }) => {
      const bucket = createPrivateMediaBucket();
      const staged = await stageHostedPrivateMedia({
        bucket: bucket.api,
        bytes,
        capabilitySecret: CAPABILITY_SECRET,
        contentType,
        deliveryOrigin: HOSTED_PRIVATE_MEDIA_DELIVERY_ORIGIN,
        userId: USER_ID,
      });
      const url = new URL(staged.url);

      expect(url.pathname.endsWith(`/group-avatar.${extension}`)).toBe(true);
      expect(matchHostedPrivateMediaCapabilityPath(url.pathname)?.extension)
        .toBe(extension);

      const request = new Request(url);
      const response = await handleDeclarativeRoute(privateMediaRoutes, {
        env: {
          BUNDLES: bucket.api,
          HOSTED_PRIVATE_MEDIA_CAPABILITY_SECRET: CAPABILITY_SECRET,
        },
        request,
        url,
      });
      expect(response?.status).toBe(200);
      if (!response) {
        throw new Error("Expected private media response.");
      }
      expect(response.headers.get("content-type")).toBe(contentType);
      expect(response.headers.get("content-disposition")).toBe(
        `inline; filename="group-avatar.${extension}"`,
      );
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    },
  );

  it("caps a late retry at the existing object's R2 lifecycle boundary", async () => {
    const nowMs = Date.parse("2026-07-27T12:00:00.000Z");
    const lateRetryMs = nowMs
      + (HOSTED_PRIVATE_MEDIA_LIFETIME_SECONDS - 60 * 60) * 1_000;
    const bucket = createPrivateMediaBucket({ nowMs });
    const input = {
      bucket: bucket.api,
      bytes: PNG_BYTES,
      capabilitySecret: CAPABILITY_SECRET,
      contentType: "image/png" as const,
      deliveryOrigin: HOSTED_PRIVATE_MEDIA_DELIVERY_ORIGIN,
      nowMs,
      userId: USER_ID,
    };

    const first = await stageHostedPrivateMedia(input);
    const retry = await stageHostedPrivateMedia({
      ...input,
      nowMs: lateRetryMs,
    });

    expect(first.objectKey).toBe(retry.objectKey);
    expect(first.url).not.toBe(retry.url);
    expect(retry.expiresAt).toBe(first.expiresAt);
    expect(new URL(retry.url).searchParams.get("exp")).toBe(
      new URL(first.url).searchParams.get("exp"),
    );
    expect(bucket.put).toHaveBeenCalledOnce();
    expect(bucket.objects).toHaveLength(1);
  });

  it("refreshes the deterministic object only after its R2 lifecycle boundary", async () => {
    const nowMs = Date.parse("2026-07-27T12:00:00.000Z");
    const boundaryMs = nowMs + HOSTED_PRIVATE_MEDIA_LIFETIME_SECONDS * 1_000;
    const bucket = createPrivateMediaBucket({ nowMs });
    const input = {
      bucket: bucket.api,
      bytes: PNG_BYTES,
      capabilitySecret: CAPABILITY_SECRET,
      contentType: "image/png" as const,
      deliveryOrigin: HOSTED_PRIVATE_MEDIA_DELIVERY_ORIGIN,
      userId: USER_ID,
    };

    const first = await stageHostedPrivateMedia({ ...input, nowMs });
    bucket.setNowMs(boundaryMs);
    const refreshed = await stageHostedPrivateMedia({
      ...input,
      nowMs: boundaryMs,
    });

    expect(refreshed.objectKey).toBe(first.objectKey);
    expect(bucket.put).toHaveBeenCalledTimes(2);
    expect(bucket.objects).toHaveLength(1);
    expect(bucket.uploadedAt(first.objectKey)?.toISOString()).toBe(
      new Date(boundaryMs).toISOString(),
    );
    expect(new URL(refreshed.url).searchParams.get("exp")).toBe(
      String(
        Math.floor(boundaryMs / 1_000)
          + HOSTED_PRIVATE_MEDIA_LIFETIME_SECONDS,
      ),
    );

    const firstUrl = new URL(first.url);
    const firstMatch = matchHostedPrivateMediaCapabilityPath(firstUrl.pathname);
    await expect(readHostedPrivateMedia({
      bucket: bucket.api,
      capability: firstMatch?.capability ?? "",
      capabilitySecret: CAPABILITY_SECRET,
      expiresAtUnixSeconds: Number(firstUrl.searchParams.get("exp")),
      nowMs: boundaryMs,
    })).resolves.toBeNull();

    const refreshedUrl = new URL(refreshed.url);
    const refreshedMatch = matchHostedPrivateMediaCapabilityPath(
      refreshedUrl.pathname,
    );
    await expect(readHostedPrivateMedia({
      bucket: bucket.api,
      capability: refreshedMatch?.capability ?? "",
      capabilitySecret: CAPABILITY_SECRET,
      expiresAtUnixSeconds: Number(refreshedUrl.searchParams.get("exp")),
      nowMs: boundaryMs,
    })).resolves.toEqual({
      bytes: PNG_BYTES,
      contentType: "image/png",
    });
  });

  it("keeps the largest accepted member id within the provider URL contract", async () => {
    const staged = await stageHostedPrivateMedia({
      bucket: createPrivateMediaBucket().api,
      bytes: PNG_BYTES,
      capabilitySecret: CAPABILITY_SECRET,
      contentType: "image/png",
      deliveryOrigin: HOSTED_PRIVATE_MEDIA_DELIVERY_ORIGIN,
      userId: "m".repeat(512),
    });

    expect(staged.url.length).toBeLessThanOrEqual(
      HOSTED_RUNTIME_GROUP_CHAT_ICON_URL_MAX_LENGTH,
    );
    expect(isHostedRuntimePrivateImageDeliveryUrl(new URL(staged.url))).toBe(
      true,
    );
  });

  it("keeps preview and production capability origins isolated", async () => {
    const bucket = createPrivateMediaBucket();
    const preview = await stageHostedPrivateMedia({
      bucket: bucket.api,
      bytes: PNG_BYTES,
      capabilitySecret: CAPABILITY_SECRET,
      contentType: "image/png",
      deliveryOrigin: PREVIEW_DELIVERY_ORIGIN,
      userId: USER_ID,
    });
    const previewUrl = new URL(preview.url);

    expect(previewUrl.origin).toBe(PREVIEW_DELIVERY_ORIGIN);
    expect(
      isHostedRuntimePrivateImageDeliveryUrl(
        previewUrl,
        PREVIEW_DELIVERY_ORIGIN,
      ),
    ).toBe(true);
    expect(isHostedRuntimePrivateImageDeliveryUrl(previewUrl)).toBe(false);
    expect(parseHostedRunnerPrivateImageUrlPublishResponse(
      {
        expiresAt: preview.expiresAt,
        url: preview.url,
      },
      PREVIEW_DELIVERY_ORIGIN,
    )).toEqual({
      expiresAt: preview.expiresAt,
      url: preview.url,
    });
    expect(() => parseHostedRunnerPrivateImageUrlPublishResponse({
      expiresAt: preview.expiresAt,
      url: preview.url,
    })).toThrow(/publish response is invalid/u);

    const request = new Request(preview.url);
    const response = await handleDeclarativeRoute(privateMediaRoutes, {
      env: {
        BUNDLES: bucket.api,
        HOSTED_PRIVATE_MEDIA_CAPABILITY_SECRET: CAPABILITY_SECRET,
      },
      request,
      url: previewUrl,
    });
    expect(response?.status).toBe(200);
    if (!response) {
      throw new Error("Expected preview private media response.");
    }
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG_BYTES);
  });

  it("fails closed for expired, tampered, or wrong-secret capabilities", async () => {
    const nowMs = Date.parse("2026-07-27T12:00:00.000Z");
    const bucket = createPrivateMediaBucket({ nowMs });
    const staged = await stageHostedPrivateMedia({
      bucket: bucket.api,
      bytes: PNG_BYTES,
      capabilitySecret: CAPABILITY_SECRET,
      contentType: "image/png",
      deliveryOrigin: HOSTED_PRIVATE_MEDIA_DELIVERY_ORIGIN,
      nowMs,
      userId: USER_ID,
    });
    const url = new URL(staged.url);
    const capability =
      matchHostedPrivateMediaCapabilityPath(url.pathname)?.capability ?? "";
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
      capability: `${capability.slice(0, -1)}${capability.endsWith("x") ? "y" : "x"}`,
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

  it("serves canonical GET and HEAD requests with matching headers and no HEAD body", async () => {
    const bucket = createPrivateMediaBucket();
    const staged = await stageHostedPrivateMedia({
      bucket: bucket.api,
      bytes: PNG_BYTES,
      capabilitySecret: CAPABILITY_SECRET,
      contentType: "image/png",
      deliveryOrigin: HOSTED_PRIVATE_MEDIA_DELIVERY_ORIGIN,
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

    const headRequest = new Request(staged.url, { method: "HEAD" });
    const head = await handleDeclarativeRoute(privateMediaRoutes, {
      env,
      request: headRequest,
      url: new URL(headRequest.url),
    });
    expect(head).not.toBeNull();
    if (!head) {
      throw new Error("Expected private media HEAD response.");
    }
    expect(head.status).toBe(response.status);
    for (const header of [
      "cache-control",
      "content-disposition",
      "content-length",
      "content-type",
      "x-content-type-options",
    ]) {
      expect(head.headers.get(header)).toBe(response.headers.get(header));
    }
    expect((await head.arrayBuffer()).byteLength).toBe(0);

    const legacyUrl = new URL(staged.url);
    legacyUrl.pathname = legacyUrl.pathname.replace(
      /\/group-avatar\.png$/u,
      "",
    );
    const legacyRequest = new Request(legacyUrl);
    const legacy = await handleDeclarativeRoute(privateMediaRoutes, {
      env,
      request: legacyRequest,
      url: legacyUrl,
    });
    expect(legacy).not.toBeNull();
    if (!legacy) {
      throw new Error("Expected legacy private media response.");
    }
    expect(legacy.status).toBe(200);
    expect(new Uint8Array(await legacy.arrayBuffer())).toEqual(PNG_BYTES);

    const legacyHeadRequest = new Request(legacyUrl, { method: "HEAD" });
    const legacyHead = await handleDeclarativeRoute(privateMediaRoutes, {
      env,
      request: legacyHeadRequest,
      url: legacyUrl,
    });
    expect(legacyHead).not.toBeNull();
    if (!legacyHead) {
      throw new Error("Expected legacy private media HEAD response.");
    }
    expect(legacyHead.status).toBe(legacy.status);
    for (const header of [
      "cache-control",
      "content-disposition",
      "content-length",
      "content-type",
      "x-content-type-options",
    ]) {
      expect(legacyHead.headers.get(header)).toBe(legacy.headers.get(header));
    }
    expect((await legacyHead.arrayBuffer()).byteLength).toBe(0);

    const mismatchedExtension = new URL(staged.url);
    mismatchedExtension.pathname = mismatchedExtension.pathname.replace(
      /\.png$/u,
      ".jpg",
    );
    const mismatchRequest = new Request(mismatchedExtension);
    const mismatch = await handleDeclarativeRoute(privateMediaRoutes, {
      env,
      request: mismatchRequest,
      url: mismatchedExtension,
    });
    expect(mismatch?.status).toBe(404);

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

    const tampered = new URL(staged.url);
    tampered.pathname = tampered.pathname.replace(/v1\./u, "v1.x");
    const tamperedRequest = new Request(tampered);
    const tamperedResponse = await handleDeclarativeRoute(privateMediaRoutes, {
      env,
      request: tamperedRequest,
      url: tampered,
    });
    expect(tamperedResponse).toBeNull();
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
      deliveryOrigin: HOSTED_PRIVATE_MEDIA_DELIVERY_ORIGIN,
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
        deliveryOrigin: HOSTED_PRIVATE_MEDIA_DELIVERY_ORIGIN,
        userId: USER_ID,
      })).rejects.toThrow("fixture capability seal failure");
    } finally {
      encrypt.mockRestore();
    }
    expect(bucket.put).not.toHaveBeenCalled();
    expect(bucket.objects).toHaveLength(0);
  });

  it("does not overwrite an expired object when replacement capability sealing fails", async () => {
    const nowMs = Date.parse("2026-07-27T12:00:00.000Z");
    const boundaryMs = nowMs + HOSTED_PRIVATE_MEDIA_LIFETIME_SECONDS * 1_000;
    const bucket = createPrivateMediaBucket({ nowMs });
    const input = {
      bucket: bucket.api,
      bytes: PNG_BYTES,
      capabilitySecret: CAPABILITY_SECRET,
      contentType: "image/png" as const,
      deliveryOrigin: HOSTED_PRIVATE_MEDIA_DELIVERY_ORIGIN,
      userId: USER_ID,
    };
    const staged = await stageHostedPrivateMedia({ ...input, nowMs });
    bucket.setNowMs(boundaryMs);
    const encrypt = vi.spyOn(crypto.subtle, "encrypt")
      .mockRejectedValueOnce(new Error("fixture replacement seal failure"));
    try {
      await expect(stageHostedPrivateMedia({
        ...input,
        nowMs: boundaryMs,
      })).rejects.toThrow("fixture replacement seal failure");
    } finally {
      encrypt.mockRestore();
    }

    expect(bucket.put).toHaveBeenCalledOnce();
    expect(bucket.objects).toHaveLength(1);
    expect(bucket.objects[0]?.[0]).toBe(staged.objectKey);
  });
});

function createPrivateMediaBucket(input: {
  nowMs?: number;
  putError?: Error;
} = {}) {
  const values = new Map<string, { bytes: Uint8Array; uploaded: Date }>();
  let nowMs = input.nowMs ?? Date.now();
  const put = vi.fn(async (key: string, value: R2PutValueLike) => {
    if (input.putError) {
      throw input.putError;
    }
    values.set(key, {
      bytes: await readPutValue(value),
      uploaded: new Date(nowMs),
    });
  });
  return {
    api: {
      async get(key: string) {
        const value = values.get(key);
        return value
          ? {
              async arrayBuffer() {
                return toArrayBuffer(value.bytes);
              },
              key,
              size: value.bytes.byteLength,
              uploaded: value.uploaded,
            }
          : null;
      },
      async head(key: string) {
        const value = values.get(key);
        return value
          ? {
              key,
              size: value.bytes.byteLength,
              uploaded: value.uploaded,
            }
          : null;
      },
      put,
    },
    get objects() {
      return [...values.entries()].map(
        ([key, value]) => [key, value.bytes] as const,
      );
    },
    put,
    setNowMs(value: number) {
      nowMs = value;
    },
    uploadedAt(key: string): Date | null {
      return values.get(key)?.uploaded ?? null;
    },
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
