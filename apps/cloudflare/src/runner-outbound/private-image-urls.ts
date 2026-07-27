import { json, jsonError, methodNotAllowed, readJsonObject, unauthorized } from "../json.ts";
import {
  parseHostedRunnerPrivateImageUrlPublishRequest,
} from "../runner-effects-contract.ts";
import {
  readHostedPrivateMediaCapabilitySecret,
  stageHostedPrivateMedia,
} from "../private-media.ts";
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

  const capabilitySecret = readHostedPrivateMediaCapabilitySecret(input.env);
  if (!capabilitySecret) {
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

  try {
    const staged = await stageHostedPrivateMedia({
      bucket: input.env.BUNDLES,
      bytes,
      capabilitySecret,
      contentType: request.contentType,
      nowMs: input.nowMs,
      userId: input.userId,
    });
    return json({
      expiresAt: staged.expiresAt,
      url: staged.url,
    });
  } catch {
    return jsonError("Private image URL publishing failed.", 502);
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
