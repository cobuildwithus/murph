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
const GIF_STORYBOARD_BACKGROUND = {
  r: 127,
  g: 127,
  b: 127,
} as const;
const ALLOWED_STATIC_RASTER_INPUT_FORMATS = new Set([
  "gif",
  "heif",
  "jpeg",
  "png",
  "webp",
]);
type SharpFactory = typeof import("sharp");

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
        frameDelaysMs: metadata.delay,
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
  frameDelaysMs: number[] | undefined;
  pageCount: number;
  sharp: SharpFactory;
}): Promise<Buffer> {
  const frames: Buffer[] = [];
  for (
    const page of selectStoryboardPages(input.pageCount, input.frameDelaysMs)
  ) {
    const frame = await input.sharp(input.bytes, {
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
      .png()
      .toBuffer();
    frames.push(frame);
  }

  return await input.sharp(frames, {
    join: {
      across: frames.length,
      shim: GIF_STORYBOARD_GAP_PX,
      background: GIF_STORYBOARD_BACKGROUND,
    },
  })
    .flatten({
      background: GIF_STORYBOARD_BACKGROUND,
    })
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

function selectStoryboardPages(
  pageCount: number,
  frameDelaysMs: readonly number[] | undefined,
): number[] {
  const frameCount = Math.min(
    pageCount,
    GIF_STORYBOARD_MAX_FRAMES,
  );
  if (frameCount === pageCount) {
    return Array.from({ length: frameCount }, (_, index) => index);
  }

  const ordinalPages = Array.from({ length: frameCount }, (_, index) =>
    Math.round((index * (pageCount - 1)) / (frameCount - 1))
  );
  if (
    frameDelaysMs?.length !== pageCount ||
    frameDelaysMs.some(
      (delay) => !Number.isSafeInteger(delay) || delay < 0,
    )
  ) {
    return ordinalPages;
  }

  const totalDurationMs = frameDelaysMs.reduce(
    (total, delay) => total + delay,
    0,
  );
  if (!Number.isSafeInteger(totalDurationMs) || totalDurationMs < 1) {
    return ordinalPages;
  }

  const selectedPages = new Set([0, pageCount - 1]);
  for (let index = 1; index < frameCount - 1; index += 1) {
    const targetTimeMs = (index * totalDurationMs) / (frameCount - 1);
    const targetPage = findPageAtTime(frameDelaysMs, targetTimeMs);
    selectedPages.add(
      findNearestUnselectedPage({
        pageCount,
        selectedPages,
        targetPage,
      }),
    );
  }

  return [...selectedPages].sort((left, right) => left - right);
}

function findPageAtTime(
  frameDelaysMs: readonly number[],
  targetTimeMs: number,
): number {
  let elapsedMs = 0;
  for (const [page, delayMs] of frameDelaysMs.entries()) {
    elapsedMs += delayMs;
    if (targetTimeMs < elapsedMs) {
      return page;
    }
  }
  return frameDelaysMs.length - 1;
}

function findNearestUnselectedPage(input: {
  pageCount: number;
  selectedPages: ReadonlySet<number>;
  targetPage: number;
}): number {
  for (let distance = 0; distance < input.pageCount; distance += 1) {
    const before = input.targetPage - distance;
    if (before >= 0 && !input.selectedPages.has(before)) {
      return before;
    }

    const after = input.targetPage + distance;
    if (after < input.pageCount && !input.selectedPages.has(after)) {
      return after;
    }
  }

  throw new RangeError("Animated image did not yield enough storyboard pages.");
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
