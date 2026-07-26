import { json, jsonError, methodNotAllowed, readJsonObject, unauthorized } from "../json.ts";
import {
  parseHostedRunnerPrivateImageUrlPublishRequest,
} from "../runner-effects-contract.ts";
import {
  requireRunnerRuntimeWriteFenceWrite,
  RunnerRuntimeWriteFenceError,
} from "./write-fence.ts";
import type {
  RunnerOutboundEnvironmentSource,
} from "./shared.ts";

const PRIVATE_IMAGE_PUBLISH_BODY_LIMIT_BYTES = 14 * 1024 * 1024;
const PRIVATE_IMAGE_FILE_LIMIT_BYTES = 10 * 1024 * 1024;
const PRIVATE_IMAGE_METADATA_LIMIT_BYTES = 1024;
const PRIVATE_IMAGE_URL_LIFETIME_SECONDS = 24 * 60 * 60;

export async function handleRunnerPrivateImageUrlPublishRequest(input: {
  env: RunnerOutboundEnvironmentSource;
  nowMs?: number;
  request: Request;
  userId: string;
}): Promise<Response> {
  if (input.request.method !== "POST") {
    return methodNotAllowed();
  }

  try {
    await requireRunnerRuntimeWriteFenceWrite({
      env: input.env,
      request: input.request,
      userId: input.userId,
    });
  } catch (error) {
    if (error instanceof RunnerRuntimeWriteFenceError) {
      return unauthorized();
    }
    throw error;
  }

  let request;
  try {
    request = parseHostedRunnerPrivateImageUrlPublishRequest(
      await readJsonObject(input.request, {
        limitBytes: PRIVATE_IMAGE_PUBLISH_BODY_LIMIT_BYTES,
      }),
    );
  } catch (error) {
    if (
      error instanceof SyntaxError
      || error instanceof TypeError
      || error instanceof RangeError
    ) {
      return jsonError("Malformed private image URL publish request.", 400);
    }
    throw error;
  }

  const signingKey = readRequiredEnvString(
    input.env,
    "CLOUDFLARE_IMAGES_SIGNING_KEY",
  );
  if (!input.env.IMAGES || !signingKey) {
    return jsonError("Private image URL publishing is not configured.", 503);
  }

  let bytes: Uint8Array;
  let metadata: Record<string, string>;
  try {
    bytes = decodeBase64Image(request.bytesBase64);
    assertPrivateImageBytes({
      bytes,
      contentType: request.contentType,
    });
    metadata = {
      ...request.metadata,
      source: request.source,
    };
    assertPrivateImageMetadata(metadata);
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) {
      return jsonError("Malformed private image URL publish request.", 400);
    }
    throw error;
  }

  let uploadedImage;
  try {
    uploadedImage = await input.env.IMAGES.hosted.upload(
      copyBytesToArrayBuffer(bytes),
      {
        filename: normalizePrivateImageFilename(
          request.filename,
          request.contentType,
        ),
        metadata,
        requireSignedURLs: true,
      },
    );
  } catch {
    return jsonError("Private image upload failed.", 502);
  }
  if (uploadedImage.requireSignedURLs !== true) {
    return jsonError("Private image upload failed.", 502);
  }

  try {
    const unsignedUrl = readCloudflareImageVariantUrl(
      uploadedImage.variants,
      readOptionalEnvString(input.env, "CLOUDFLARE_IMAGES_VARIANT") ?? "public",
    );
    const signed = await signCloudflareImageDeliveryUrl({
      expiresAtUnixSeconds: Math.floor((input.nowMs ?? Date.now()) / 1_000)
        + PRIVATE_IMAGE_URL_LIFETIME_SECONDS,
      signingKey,
      unsignedUrl,
    });
    return json(signed);
  } catch {
    return jsonError("Private image URL publishing failed.", 502);
  }
}

export async function signCloudflareImageDeliveryUrl(input: {
  expiresAtUnixSeconds: number;
  signingKey: string;
  unsignedUrl: string;
}): Promise<{ expiresAt: string; url: string }> {
  const expiresAtUnixSeconds = Math.floor(input.expiresAtUnixSeconds);
  if (!Number.isSafeInteger(expiresAtUnixSeconds) || expiresAtUnixSeconds <= 0) {
    throw new TypeError("Private image URL expiry is invalid.");
  }
  const url = new URL(input.unsignedUrl);
  assertUnsignedCloudflareImageDeliveryUrl(url);
  url.searchParams.set("exp", String(expiresAtUnixSeconds));
  const valueToSign = `${url.pathname}?${url.searchParams.toString()}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(input.signingKey),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(valueToSign),
  );
  url.searchParams.set(
    "sig",
    [...new Uint8Array(signature)]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join(""),
  );
  return {
    expiresAt: new Date(expiresAtUnixSeconds * 1_000).toISOString(),
    url: url.toString(),
  };
}

function assertUnsignedCloudflareImageDeliveryUrl(url: URL): void {
  if (
    url.protocol !== "https:"
    || url.hostname !== "imagedelivery.net"
    || url.port
    || url.username
    || url.password
    || url.search
    || url.hash
    || url.pathname.split("/").filter(Boolean).length < 3
  ) {
    throw new TypeError("Cloudflare Images upload returned an invalid URL.");
  }
}

function decodeBase64Image(value: string): Uint8Array {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(normalized) || normalized.length === 0) {
    throw new TypeError("Private image bytes must be base64.");
  }
  let binary: string;
  try {
    binary = atob(normalized);
  } catch {
    throw new TypeError("Private image bytes must be base64.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function assertPrivateImageBytes(input: {
  bytes: Uint8Array;
  contentType: "image/jpeg" | "image/png" | "image/webp";
}): void {
  if (
    input.bytes.byteLength === 0
    || input.bytes.byteLength > PRIVATE_IMAGE_FILE_LIMIT_BYTES
  ) {
    throw new RangeError("Private image size is invalid.");
  }
  if (!privateImageBytesMatchContentType(input.bytes, input.contentType)) {
    throw new TypeError("Private image content type is invalid.");
  }
}

function privateImageBytesMatchContentType(
  bytes: Uint8Array,
  contentType: "image/jpeg" | "image/png" | "image/webp",
): boolean {
  switch (contentType) {
    case "image/jpeg":
      return bytes[0] === 0xff && bytes[1] === 0xd8
        && bytes[bytes.length - 2] === 0xff
        && bytes[bytes.length - 1] === 0xd9;
    case "image/png":
      return bytes[0] === 0x89 && bytes[1] === 0x50
        && bytes[2] === 0x4e && bytes[3] === 0x47
        && bytes[4] === 0x0d && bytes[5] === 0x0a
        && bytes[6] === 0x1a && bytes[7] === 0x0a;
    case "image/webp":
      return bytes[0] === 0x52 && bytes[1] === 0x49
        && bytes[2] === 0x46 && bytes[3] === 0x46
        && bytes[8] === 0x57 && bytes[9] === 0x45
        && bytes[10] === 0x42 && bytes[11] === 0x50;
  }
}

function assertPrivateImageMetadata(metadata: Record<string, string>): void {
  if (
    new TextEncoder().encode(JSON.stringify(metadata)).byteLength
    > PRIVATE_IMAGE_METADATA_LIMIT_BYTES
  ) {
    throw new RangeError("Private image metadata is too large.");
  }
}

function normalizePrivateImageFilename(
  filename: string,
  contentType: "image/jpeg" | "image/png" | "image/webp",
): string {
  const fallback =
    `private-image.${contentType === "image/jpeg" ? "jpg" : contentType.slice(6)}`;
  const normalized = filename.trim();
  return /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u.test(normalized)
    ? normalized
    : fallback;
}

function readCloudflareImageVariantUrl(
  variants: readonly string[],
  variant: string,
): string {
  const preferred = variants.find((entry) =>
    entry.endsWith(`/${variant}`)
  );
  if (!preferred) {
    throw new TypeError("Cloudflare Images upload did not return a URL.");
  }
  const url = new URL(preferred);
  assertUnsignedCloudflareImageDeliveryUrl(url);
  return url.toString();
}

function readRequiredEnvString(
  env: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  return readOptionalEnvString(env, key);
}

function readOptionalEnvString(
  env: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  const value = env[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}
