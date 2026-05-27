import path from "node:path";

import type { InboundAttachment } from "../contracts/capture.ts";

export interface NormalizeAttachmentForStorageInput {
  attachment: InboundAttachment;
  bytes: Uint8Array;
  fileName: string;
  mediaType: string;
}

export interface NormalizedAttachmentForStorage {
  bytes: Uint8Array;
  fileName: string;
  mediaType: string;
  normalized: boolean;
}

const IMAGE_NORMALIZATION_MAX_EDGE_PX = 3072;
const IMAGE_NORMALIZATION_WEBP_QUALITY = 88;
const IMAGE_NORMALIZATION_MAX_INPUT_PIXELS = 64 * 1_000_000;

export async function normalizeAttachmentForStorage(
  input: NormalizeAttachmentForStorageInput,
): Promise<NormalizedAttachmentForStorage | null> {
  if (!isEligibleStillImage(input.attachment, input.mediaType, input.fileName)) {
    return {
      bytes: input.bytes,
      fileName: input.fileName,
      mediaType: input.mediaType,
      normalized: false,
    };
  }

  const sharp = (await import("sharp")).default;

  try {
    const output = await sharp(input.bytes, {
      limitInputPixels: IMAGE_NORMALIZATION_MAX_INPUT_PIXELS,
    })
      .rotate()
      .resize({
        width: IMAGE_NORMALIZATION_MAX_EDGE_PX,
        height: IMAGE_NORMALIZATION_MAX_EDGE_PX,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({
        quality: IMAGE_NORMALIZATION_WEBP_QUALITY,
        effort: 4,
      })
      .toBuffer();

    return {
      bytes: new Uint8Array(output),
      fileName: replaceExtension(input.fileName, ".webp"),
      mediaType: "image/webp",
      normalized: true,
    };
  } catch {
    return null;
  }
}

function isEligibleStillImage(
  attachment: InboundAttachment,
  mediaType: string,
  fileName: string,
): boolean {
  if (attachment.kind !== "image") {
    return false;
  }

  const normalizedMediaType = normalizeMediaType(mediaType);
  if (
    normalizedMediaType === "image/jpeg" ||
    normalizedMediaType === "image/png" ||
    normalizedMediaType === "image/webp"
  ) {
    return true;
  }

  return [".jpg", ".jpeg", ".png", ".webp"].includes(
    path.posix.extname(fileName).toLowerCase(),
  );
}

function normalizeMediaType(mediaType: string): string {
  return mediaType.trim().toLowerCase().split(";", 1)[0] ?? "";
}

function replaceExtension(fileName: string, extension: string): string {
  const parsed = path.posix.parse(fileName.trim());
  const stem = parsed.name || parsed.base || "attachment";
  return `${stem}${extension}`;
}
