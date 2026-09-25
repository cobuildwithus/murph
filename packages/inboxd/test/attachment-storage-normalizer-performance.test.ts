import assert from "node:assert/strict";
import sharp from "sharp";
import { describe, test, vi } from "vitest";

import { normalizeAttachmentForStorage } from "../src/indexing/attachment-storage-normalizer.ts";

async function createSyntheticGif(frameCount: number, transparent: boolean): Promise<Buffer> {
  const width = 480;
  const height = 320;
  const frames: Buffer[] = [];
  for (let frame = 0; frame < frameCount; frame += 1) {
    const pixels = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        pixels[offset] = (x + frame * 31) % 256;
        pixels[offset + 1] = (y + frame * 17) % 256;
        pixels[offset + 2] = (x + y) % 256;
        pixels[offset + 3] = transparent && x < frame * 40 ? 0 : 255;
      }
    }
    frames.push(await sharp(pixels, {
      raw: { width, height, channels: 4 },
    }).png().toBuffer());
  }
  return await sharp(frames, { join: { animated: true } })
    .gif({ effort: 1, delay: Array.from({ length: frameCount }, () => 100) })
    .toBuffer();
}

function normalizeImage(bytes: Buffer, fileName: string, mediaType: string) {
  return normalizeAttachmentForStorage({
    attachment: { kind: "image", fileName, mime: mediaType },
    bytes,
    fileName,
    mediaType,
  });
}

// The native PNG method is spied on, so keep these cases sequential even when
// suite-level concurrency is enabled. Both passes execute the real image pipeline.
describe.sequential("attachment storage intermediate encoding", () => {
  for (const [frameCount, transparent] of [[8, false], [4, true]] as const) {
    test(`skips temporary PNG compression for ${frameCount} ${transparent ? "transparent" : "opaque"} GIF frames without changing evidence`, async () => {
      const bytes = await createSyntheticGif(frameCount, transparent);
      assert.equal((await sharp(bytes).metadata()).pages, frameCount);
      const prototype: Pick<sharp.Sharp, "png"> = sharp.prototype;
      const originalPng = prototype.png;
      let useOriginalCompression = true;
      const compressionLevels: Array<number | undefined> = [];
      const pngSpy = vi.spyOn(prototype, "png").mockImplementation(function (
        this: sharp.Sharp,
        options?: sharp.PngOptions,
      ) {
        compressionLevels.push(options?.compressionLevel);
        return useOriginalCompression
          ? originalPng.call(this)
          : originalPng.call(this, options);
      });

      try {
        // Emulate the previous default PNG compression, not a second storyboard implementation.
        const reference = await normalizeImage(bytes, "synthetic.gif", "image/gif");
        assert.ok(reference);
        compressionLevels.length = 0;
        useOriginalCompression = false;

        const result = await normalizeImage(bytes, "synthetic.gif", "image/gif");
        assert.ok(result);
        const selectedFrameCount = Math.min(frameCount, 6);
        assert.deepEqual(compressionLevels, Array.from({ length: selectedFrameCount }, () => 0));
        // Includes final bytes, filename, MIME type, and normalization status.
        assert.deepEqual(result, reference);
        const metadata = await sharp(result.bytes).metadata();
        assert.equal(metadata.format, "webp");
        assert.equal(metadata.width, selectedFrameCount * 320 + (selectedFrameCount - 1) * 8);
        assert.equal(metadata.height, 213);
        assert.equal(metadata.exif, undefined);
        assert.equal(metadata.icc, undefined);
      } finally {
        pngSpy.mockRestore();
      }
    });
  }
});
