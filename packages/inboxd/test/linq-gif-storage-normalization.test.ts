import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { initializeVault } from "@murphai/core";
import { test } from "vitest";

import {
  createInboxPipeline,
  normalizeLinqWebhookEvent,
  openInboxRuntime,
} from "../src/index.ts";
import type { StoredAttachment } from "../src/contracts/capture.ts";
import {
  normalizeAttachmentForStorage,
  type NormalizedAttachmentForStorage,
} from "../src/indexing/attachment-storage-normalizer.ts";
import { buildV2026LinqWebhookEvent } from "./linq-test-helpers.ts";

const ANIMATED_GIF_FRAME_COLORS = [
  [255, 0, 0],
  [255, 128, 0],
  [255, 255, 0],
  [0, 255, 0],
  [0, 255, 255],
  [0, 0, 255],
  [128, 0, 255],
  [255, 0, 255],
] as const;
const STORYBOARD_FRAME_WIDTH = 320;
const STORYBOARD_FRAME_HEIGHT = 213;
const STORYBOARD_GAP = 8;
const STORYBOARD_BACKGROUND_CHANNEL = 127;

async function makeTempDirectory(name: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

const ANIMATED_GIF_FIXTURE_BASE64 = [
  "R0lGODlhGAAQAIEAAP8AAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQICAAAACwAAAAAGAAQAAAIIgABCBxIsKDBgwgTKlzIsKHDhxAjSpxIsaLF",
  "ixgzatxoMCAAIfkECAgAAAAsAAAAABgAEACB/4AAAAAAAAAAAAAACCIAAQgcSLCgwYMIEypcyLChw4cQI0qcSLGixYsYM2rcaDAgACH5BAgIAAAALAAAAAAY",
  "ABAAgf//AAAAAAAAAAAAAAgiAAEIHEiwoMGDCBMqXMiwocOHECNKnEixosWLGDNq3GgwIAAh+QQICAAAACwAAAAAGAAQAIEA/wAAAAAAAAAAAAAIIgABCBxI",
  "sKDBgwgTKlzIsKHDhxAjSpxIsaLFixgzatxoMCAAIfkECAgAAAAsAAAAABgAEACBAP//AAAAAAAAAAAACCIAAQgcSLCgwYMIEypcyLChw4cQI0qcSLGixYsY",
  "M2rcaDAgACH5BAgIAAAALAAAAAAYABAAgQAA/wAAAAAAAAAAAAgiAAEIHEiwoMGDCBMqXMiwocOHECNKnEixosWLGDNq3GgwIAAh+QQICAAAACwAAAAAGAAQ",
  "AIGAAP8AAAAAAAAAAAAIIgABCBxIsKDBgwgTKlzIsKHDhxAjSpxIsaLFixgzatxoMCAAIfkECAgAAAAsAAAAABgAEACB/wD/AAAAAAAAAAAACCIAAQgcSLCg",
  "wYMIEypcyLChw4cQI0qcSLGixYsYM2rcaDAgADs=",
].join("");

async function createAnimatedGifBytes(input: {
  frameCount?: number;
  height?: number;
  width?: number;
} = {}): Promise<Uint8Array> {
  const sharp = (await import("sharp")).default;
  const frameCount = input.frameCount ?? ANIMATED_GIF_FRAME_COLORS.length;
  return new Uint8Array(
    await sharp(Buffer.from(ANIMATED_GIF_FIXTURE_BASE64, "base64"), {
      page: 0,
      pages: frameCount,
    })
      .resize({
        width: input.width ?? 480,
        height: input.height ?? 320,
        fit: "fill",
      })
      .gif({ effort: 1 })
      .toBuffer(),
  );
}

async function normalizeGifBytes(
  bytes: Uint8Array,
  fileName = "reaction.gif",
): Promise<NormalizedAttachmentForStorage | null> {
  return await normalizeAttachmentForStorage({
    attachment: {
      kind: "image",
      mime: "image/gif",
      fileName,
      byteSize: bytes.byteLength,
    },
    bytes,
    fileName,
    mediaType: "image/gif",
  });
}

function expectStoredAttachment(
  attachment: StoredAttachment | undefined,
): StoredAttachment & { storedPath: string; byteSize: number; sha256: string } {
  assert.ok(attachment);
  assert.equal(typeof attachment.storedPath, "string");
  assert.equal(typeof attachment.byteSize, "number");
  assert.equal(typeof attachment.sha256, "string");
  return attachment as StoredAttachment & {
    storedPath: string;
    byteSize: number;
    sha256: string;
  };
}

function assertRgbNear(
  actual: readonly number[],
  expected: readonly number[],
  tolerance = 20,
): void {
  for (const [index, expectedChannel] of expected.entries()) {
    const actualChannel = actual[index];
    assert.ok(typeof actualChannel === "number");
    assert.ok(
      Math.abs(actualChannel - expectedChannel) <= tolerance,
      `expected channel ${index} to be within ${tolerance} of ${expectedChannel}, received ${actualChannel}`,
    );
  }
}

async function readImagePixel(input: {
  bytes: Uint8Array | Buffer;
  x: number;
  y: number;
}): Promise<number[]> {
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(input.bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const offset = (input.y * info.width + input.x) * info.channels;
  return Array.from(data.subarray(offset, offset + 3));
}

function expectStoryboardWidth(frameCount: number): number {
  return frameCount * STORYBOARD_FRAME_WIDTH + (frameCount - 1) * STORYBOARD_GAP;
}

function findFirstGifFrame(input: Uint8Array): {
  frame: Buffer;
  prefix: Buffer;
} {
  const bytes = Buffer.from(input);
  let offset = readGifContentStart(bytes);
  let frameStart: number | null = null;

  while (offset < bytes.byteLength) {
    const marker = bytes[offset];
    if (marker === 0x3b) {
      break;
    }
    if (marker === 0x21) {
      const extensionStart = offset;
      const label = bytes[offset + 1];
      offset += 2;
      offset = skipGifSubBlocks(bytes, offset);
      if (label === 0xf9) {
        frameStart = extensionStart;
      }
      continue;
    }
    if (marker === 0x2c) {
      const imageStart = offset;
      const packed = readRequiredByte(bytes, imageStart + 9);
      offset += 10;
      if ((packed & 0x80) !== 0) {
        offset += 3 * (2 ** ((packed & 0x07) + 1));
      }
      offset += 1;
      offset = skipGifSubBlocks(bytes, offset);
      const start = frameStart ?? imageStart;
      return {
        frame: bytes.subarray(start, offset),
        prefix: bytes.subarray(0, start),
      };
    }
    throw new TypeError(`Unexpected GIF block marker 0x${String(marker?.toString(16))}.`);
  }

  throw new TypeError("GIF fixture did not contain an image frame.");
}

function repeatFirstGifFrame(input: Uint8Array, frameCount: number): Uint8Array {
  const { frame, prefix } = findFirstGifFrame(input);
  return new Uint8Array(Buffer.concat([
    prefix,
    ...Array.from({ length: frameCount }, () => frame),
    Buffer.from([0x3b]),
  ]));
}

function patchGifDimensions(
  input: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const bytes = Buffer.from(input);
  bytes.writeUInt16LE(width, 6);
  bytes.writeUInt16LE(height, 8);
  let offset = readGifContentStart(bytes);

  while (offset < bytes.byteLength) {
    const marker = bytes[offset];
    if (marker === 0x3b) {
      return new Uint8Array(bytes);
    }
    if (marker === 0x21) {
      offset += 2;
      offset = skipGifSubBlocks(bytes, offset);
      continue;
    }
    if (marker === 0x2c) {
      bytes.writeUInt16LE(width, offset + 5);
      bytes.writeUInt16LE(height, offset + 7);
      const packed = readRequiredByte(bytes, offset + 9);
      offset += 10;
      if ((packed & 0x80) !== 0) {
        offset += 3 * (2 ** ((packed & 0x07) + 1));
      }
      offset += 1;
      offset = skipGifSubBlocks(bytes, offset);
      continue;
    }
    throw new TypeError(`Unexpected GIF block marker 0x${String(marker?.toString(16))}.`);
  }

  throw new TypeError("GIF fixture ended before its trailer.");
}

function readGifContentStart(bytes: Buffer): number {
  if (bytes.subarray(0, 3).toString("ascii") !== "GIF") {
    throw new TypeError("GIF fixture is missing its signature.");
  }
  const packed = readRequiredByte(bytes, 10);
  return 13 + ((packed & 0x80) !== 0
    ? 3 * (2 ** ((packed & 0x07) + 1))
    : 0);
}

function skipGifSubBlocks(bytes: Buffer, startOffset: number): number {
  let offset = startOffset;
  for (;;) {
    const size = readRequiredByte(bytes, offset);
    offset += 1;
    if (size === 0) {
      return offset;
    }
    offset += size;
    if (offset > bytes.byteLength) {
      throw new RangeError("GIF fixture contains a truncated data block.");
    }
  }
}

function readRequiredByte(bytes: Buffer, offset: number): number {
  const value = bytes[offset];
  if (typeof value !== "number") {
    throw new RangeError("GIF fixture ended unexpectedly.");
  }
  return value;
}

test("Linq animated GIFs become compact left-to-right WebP filmstrips", async () => {
  const vaultRoot = await makeTempDirectory("murph-linq-gif-storyboard");
  await initializeVault({ vaultRoot, createdAt: "2026-07-29T11:59:00.000Z" });

  const gifBytes = await createAnimatedGifBytes();
  const sharp = (await import("sharp")).default;
  const sourceMetadata = await sharp(gifBytes, { animated: true }).metadata();
  assert.equal(sourceMetadata.hasAlpha, true);
  const attachmentUrl = "https://cdn.linqapp.com/media/reaction.gif";
  const capture = await normalizeLinqWebhookEvent({
    event: buildV2026LinqWebhookEvent({
      createdAt: "2026-07-29T12:00:01.000Z",
      data: {
        chat: {
          id: "chat_gif_storyboard",
          owner_handle: {
            handle: "+15557654321",
            id: "handle_owner_gif_storyboard",
            is_me: true,
            service: "iMessage",
          },
        },
        id: "msg_gif_storyboard",
        parts: [
          {
            filename: "reaction.gif",
            id: "att_gif_storyboard",
            mime_type: "image/gif",
            size_bytes: gifBytes.byteLength,
            type: "media",
            url: attachmentUrl,
          },
        ],
        sender_handle: {
          handle: "+15551234567",
          id: "handle_sender_gif_storyboard",
          service: "iMessage",
        },
        sent_at: "2026-07-29T12:00:00.000Z",
        service: "iMessage",
      },
      eventId: "evt_gif_storyboard",
    }),
    downloadDriver: {
      async downloadUrl(url) {
        assert.equal(url, attachmentUrl);
        return gifBytes;
      },
    },
  });

  assert.equal(capture.attachments.length, 1);
  assert.equal(capture.attachments[0]?.kind, "image");
  assert.equal(capture.attachments[0]?.mime, "image/gif");
  assert.equal(capture.attachments[0]?.fileName, "reaction.gif");
  assert.equal(capture.attachments[0]?.data?.byteLength, gifBytes.byteLength);

  const runtime = await openInboxRuntime({ vaultRoot });
  const pipeline = await createInboxPipeline({ vaultRoot, runtime });
  try {
    const persisted = await pipeline.processCapture(capture);
    const storedCapture = runtime.getCapture(persisted.captureId);
    assert.ok(storedCapture);
    const attachment = expectStoredAttachment(storedCapture.attachments[0]);

    assert.equal(attachment.mime, "image/webp");
    assert.equal(
      attachment.fileName,
      "reaction-gif-frames-left-to-right.webp",
    );
    assert.match(
      attachment.storedPath,
      /\/attachments\/01__reaction-gif-frames-left-to-right\.webp$/u,
    );
    assert.equal(runtime.listAttachmentParseJobs({ limit: 10 }).length, 0);

    const storedBytes = await fs.readFile(
      path.join(vaultRoot, attachment.storedPath),
    );
    assert.equal(storedBytes.byteLength, attachment.byteSize);
    assert.ok(storedBytes.byteLength < gifBytes.byteLength);

    const metadata = await sharp(storedBytes).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width, expectStoryboardWidth(6));
    assert.equal(metadata.height, STORYBOARD_FRAME_HEIGHT);
    assert.equal(metadata.pages ?? 1, 1);
    assert.equal(metadata.hasAlpha, false);

    const expectedSampledColors = [
      ANIMATED_GIF_FRAME_COLORS[0],
      ANIMATED_GIF_FRAME_COLORS[1],
      ANIMATED_GIF_FRAME_COLORS[3],
      ANIMATED_GIF_FRAME_COLORS[4],
      ANIMATED_GIF_FRAME_COLORS[6],
      ANIMATED_GIF_FRAME_COLORS[7],
    ] as const;
    for (const [index, expectedColor] of expectedSampledColors.entries()) {
      assertRgbNear(
        await readImagePixel({
          bytes: storedBytes,
          x: index * (STORYBOARD_FRAME_WIDTH + STORYBOARD_GAP) +
            Math.floor(STORYBOARD_FRAME_WIDTH / 2),
          y: Math.floor(STORYBOARD_FRAME_HEIGHT / 2),
        }),
        expectedColor,
      );
    }
    assertRgbNear(
      await readImagePixel({
        bytes: storedBytes,
        x: STORYBOARD_FRAME_WIDTH + Math.floor(STORYBOARD_GAP / 2),
        y: Math.floor(STORYBOARD_FRAME_HEIGHT / 2),
      }),
      [
        STORYBOARD_BACKGROUND_CHANNEL,
        STORYBOARD_BACKGROUND_CHANNEL,
        STORYBOARD_BACKGROUND_CHANNEL,
      ],
      8,
    );
  } finally {
    pipeline.close();
  }
});

test("short animated GIFs preserve every frame in left-to-right order", async () => {
  const gifBytes = await createAnimatedGifBytes({ frameCount: 4 });
  const normalized = await normalizeGifBytes(gifBytes);
  assert.ok(normalized);

  const sharp = (await import("sharp")).default;
  const metadata = await sharp(normalized.bytes).metadata();
  assert.equal(metadata.width, expectStoryboardWidth(4));
  assert.equal(metadata.height, STORYBOARD_FRAME_HEIGHT);
  for (const [index, expectedColor] of ANIMATED_GIF_FRAME_COLORS.slice(0, 4).entries()) {
    assertRgbNear(
      await readImagePixel({
        bytes: normalized.bytes,
        x: index * (STORYBOARD_FRAME_WIDTH + STORYBOARD_GAP) +
          Math.floor(STORYBOARD_FRAME_WIDTH / 2),
        y: Math.floor(STORYBOARD_FRAME_HEIGHT / 2),
      }),
      expectedColor,
    );
  }
});

test("animated GIFs beyond the source frame budget fail closed", async () => {
  const gifBytes = repeatFirstGifFrame(
    Buffer.from(ANIMATED_GIF_FIXTURE_BASE64, "base64"),
    121,
  );
  await assert.doesNotReject(async () => {
    assert.equal(await normalizeGifBytes(gifBytes), null);
  });
});

test("animated GIFs beyond the aggregate source pixel budget fail closed", async () => {
  const twoFrameGif = repeatFirstGifFrame(
    Buffer.from(ANIMATED_GIF_FIXTURE_BASE64, "base64"),
    2,
  );
  const oversizedGif = patchGifDimensions(twoFrameGif, 3_000, 3_000);
  await assert.doesNotReject(async () => {
    assert.equal(await normalizeGifBytes(oversizedGif), null);
  });
});

test("truncated animated GIFs fail closed", async () => {
  const gifBytes = await createAnimatedGifBytes();
  const truncated = gifBytes.subarray(0, Math.min(400, gifBytes.byteLength));
  await assert.doesNotReject(async () => {
    assert.equal(await normalizeGifBytes(truncated), null);
  });
});

test("single-frame GIFs use the ordinary bounded static WebP path", async () => {
  const sharp = (await import("sharp")).default;
  const gifBytes = new Uint8Array(
    await sharp({
      create: {
        width: 640,
        height: 360,
        channels: 3,
        background: { r: 24, g: 128, b: 176 },
      },
    })
      .gif()
      .toBuffer(),
  );
  const normalized = await normalizeGifBytes(gifBytes, "still.gif");

  assert.ok(normalized);
  assert.equal(normalized.mediaType, "image/webp");
  assert.equal(normalized.fileName, "still.webp");
  const metadata = await sharp(normalized.bytes).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 640);
  assert.equal(metadata.height, 360);
  assert.equal(metadata.pages ?? 1, 1);
});
