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
// Bound animation replay cost and keep the model-facing filmstrip below one megapixel.
const GIF_STORYBOARD_MAX_FRAMES = 6;
const GIF_STORYBOARD_FRAME_MAX_EDGE_PX = 320;
const GIF_STORYBOARD_GAP_PX = 8;
const GIF_STORYBOARD_WEBP_QUALITY = 72;
const GIF_STORYBOARD_MAX_SOURCE_FRAMES = 120;
const GIF_STORYBOARD_MAX_SOURCE_PIXELS = 16 * 1_000_000;
const GIF_STORYBOARD_BACKGROUND_CHANNEL = 127;
const ALLOWED_STATIC_RASTER_INPUT_FORMATS = new Set([
  "gif",
  "heif",
  "jpeg",
  "png",
  "webp",
]);
type SharpFactory = typeof import("sharp");

interface StoryboardFrame {
  bytes: Buffer;
  height: number;
  width: number;
}

export async function normalizeAttachmentForStorage(
  input: NormalizeAttachmentForStorageInput,
): Promise<NormalizedAttachmentForStorage | null> {
  if (input.attachment.kind !== "image") {
    return {
      bytes: input.bytes,
      fileName: input.fileName,
      mediaType: input.mediaType,
      normalized: false,
    };
  }

  try {
    const sharp = (await import("sharp")).default;
    const image = sharp(input.bytes, {
      limitInputPixels: IMAGE_NORMALIZATION_MAX_INPUT_PIXELS,
    });
    const metadata = await image.metadata();
    const pageCount = normalizePageCount(metadata.pages);

    if (pageCount > 1) {
      if (
        metadata.format !== "gif" ||
        !isGifWithinBudget({
          frameHeight: metadata.pageHeight ?? metadata.height,
          pageCount,
          width: metadata.width,
        })
      ) {
        return null;
      }

      const output = await buildGifStoryboard({
        bytes: input.bytes,
        pageCount,
        sharp,
      });
      return {
        bytes: new Uint8Array(output),
        fileName: appendFileNameSuffix(
          input.fileName,
          "-gif-frames-left-to-right",
          ".webp",
        ),
        mediaType: "image/webp",
        normalized: true,
      };
    }

    if (!isAllowedStaticRasterInputFormat(metadata.format)) {
      return null;
    }

    const output = await image
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

async function buildGifStoryboard(input: {
  bytes: Uint8Array;
  pageCount: number;
  sharp: SharpFactory;
}): Promise<Buffer> {
  const frames: StoryboardFrame[] = [];
  for (const page of selectStoryboardPages(input.pageCount)) {
    const { data, info } = await input.sharp(input.bytes, {
      limitInputPixels: IMAGE_NORMALIZATION_MAX_INPUT_PIXELS,
      page,
      pages: 1,
    })
      .rotate()
      .resize({
        width: GIF_STORYBOARD_FRAME_MAX_EDGE_PX,
        height: GIF_STORYBOARD_FRAME_MAX_EDGE_PX,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png({
        adaptiveFiltering: true,
        compressionLevel: 9,
      })
      .toBuffer({ resolveWithObject: true });

    if (info.width < 1 || info.height < 1) {
      throw new RangeError("Animated image frame has invalid dimensions.");
    }

    frames.push({
      bytes: data,
      height: info.height,
      width: info.width,
    });
  }

  if (frames.length === 0) {
    throw new RangeError("Animated image did not yield any storyboard frames.");
  }

  const canvasWidth =
    frames.reduce((total, frame) => total + frame.width, 0) +
    (frames.length - 1) * GIF_STORYBOARD_GAP_PX;
  const canvasHeight = Math.max(...frames.map((frame) => frame.height));
  let nextLeft = 0;
  const composites = frames.map((frame) => {
    const left = nextLeft;
    nextLeft += frame.width + GIF_STORYBOARD_GAP_PX;
    return {
      input: frame.bytes,
      left,
      top: Math.floor((canvasHeight - frame.height) / 2),
    };
  });

  return await input.sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 3,
      background: {
        r: GIF_STORYBOARD_BACKGROUND_CHANNEL,
        g: GIF_STORYBOARD_BACKGROUND_CHANNEL,
        b: GIF_STORYBOARD_BACKGROUND_CHANNEL,
      },
    },
  })
    .composite(composites)
    .webp({
      quality: GIF_STORYBOARD_WEBP_QUALITY,
      effort: 4,
      smartSubsample: true,
    })
    .toBuffer();
}

function isGifWithinBudget(input: {
  frameHeight: number | undefined;
  pageCount: number;
  width: number | undefined;
}): boolean {
  if (
    input.pageCount > GIF_STORYBOARD_MAX_SOURCE_FRAMES ||
    typeof input.width !== "number" ||
    !Number.isSafeInteger(input.width) ||
    input.width < 1 ||
    typeof input.frameHeight !== "number" ||
    !Number.isSafeInteger(input.frameHeight) ||
    input.frameHeight < 1
  ) {
    return false;
  }

  const totalPixels = input.width * input.frameHeight * input.pageCount;
  return (
    Number.isSafeInteger(totalPixels) &&
    totalPixels <= GIF_STORYBOARD_MAX_SOURCE_PIXELS
  );
}

function selectStoryboardPages(pageCount: number): number[] {
  const frameCount = Math.min(
    pageCount,
    GIF_STORYBOARD_MAX_FRAMES,
  );
  if (frameCount === pageCount) {
    return Array.from({ length: frameCount }, (_, index) => index);
  }

  return Array.from({ length: frameCount }, (_, index) =>
    Math.round((index * (pageCount - 1)) / (frameCount - 1))
  );
}

function normalizePageCount(value: number | undefined): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : 1;
}

function isAllowedStaticRasterInputFormat(format: string | undefined): boolean {
  return (
    typeof format === "string" &&
    ALLOWED_STATIC_RASTER_INPUT_FORMATS.has(format)
  );
}

function replaceExtension(fileName: string, extension: string): string {
  return appendFileNameSuffix(fileName, "", extension);
}

function appendFileNameSuffix(
  fileName: string,
  suffix: string,
  extension: string,
): string {
  const parsed = path.posix.parse(fileName.trim());
  const stem = parsed.name || parsed.base || "attachment";
  return `${stem}${suffix}${extension}`;
}
