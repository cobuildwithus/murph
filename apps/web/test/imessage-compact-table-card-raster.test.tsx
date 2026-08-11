import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { inflateSync } from "node:zlib";

import type { CompactTablePresentationCardV1 } from "@murphai/contracts";
import { test } from "vitest";

const KERNING_BOUNDARY_CARD: CompactTablePresentationCardV1 = {
  kind: "compact_table",
  version: 1,
  title: "Recovery signals",
  subtitle: null,
  rowHeader: "Metric",
  columns: ["Today", "Week", "Trend", "Note"],
  rows: [
    {
      label: "Recovery",
      values: ["slow gait, ankle impact, or load", "Stable", "Up", "Review"],
    },
    {
      label: "Plan",
      values: ["Easy walk", "Tomorrow", "Flat", "Ready"],
    },
  ],
  footer: null,
};

test("real-font route keeps positive-kerning text above the stacked-row divider", async () => {
  const { GET } = await import("../app/imessage/card/v1/[payload]/route");
  const payload = encodePayload({
    schemaVersion: 3,
    card: KERNING_BOUNDARY_CARD,
  });
  const response = await GET(
    new Request(`https://www.withmurph.ai/imessage/card/v1/${payload}`),
    { params: Promise.resolve({ payload }) },
  );

  assert.equal(response.status, 200);
  const png = Buffer.from(await response.arrayBuffer());
  const image = decodePng(png);
  assert.deepEqual([image.width, image.height], [1_200, 1_366]);

  const dividerBands = findHorizontalDividerBands(image);
  assert.ok(dividerBands.length >= 1);
  const divider = dividerBands.at(-1);
  assert.ok(divider !== undefined);
  assert.equal(
    hasDarkPixel(image, {
      left: 45,
      right: 1_155,
      top: divider.end + 2,
      bottom: divider.end + 28,
    }),
    false,
  );
});

function encodePayload(value: unknown): string {
  return `${Buffer.from(JSON.stringify(value), "utf8").toString("base64url")}.png`;
}

type DecodedPng = {
  height: number;
  pixels: Uint8Array;
  width: number;
};

function decodePng(png: Buffer): DecodedPng {
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  let width = 0;
  let height = 0;
  let channels = 0;
  const compressedChunks: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    offset += length + 12;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8);
      channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      assert.ok(channels > 0);
      assert.equal(data[12], 0);
    } else if (type === "IDAT") {
      compressedChunks.push(data);
    } else if (type === "IEND") {
      break;
    }
  }
  assert.ok(width > 0 && height > 0 && compressedChunks.length > 0);

  const scanlines = inflateSync(Buffer.concat(compressedChunks));
  const rowLength = width * channels;
  assert.equal(scanlines.length, height * (rowLength + 1));
  const pixels = new Uint8Array(width * height * 4);
  let sourceOffset = 0;
  let previous = new Uint8Array(rowLength);
  for (let y = 0; y < height; y += 1) {
    const filter = scanlines[sourceOffset];
    sourceOffset += 1;
    const row = new Uint8Array(rowLength);
    for (let x = 0; x < rowLength; x += 1) {
      const raw = scanlines[sourceOffset + x] ?? 0;
      const left = x >= channels ? row[x - channels] ?? 0 : 0;
      const above = previous[x] ?? 0;
      const upperLeft = x >= channels ? previous[x - channels] ?? 0 : 0;
      row[x] = (raw + unfilterPngByte(filter, left, above, upperLeft)) & 0xFF;
    }
    sourceOffset += rowLength;
    for (let x = 0; x < width; x += 1) {
      const source = x * channels;
      const target = (y * width + x) * 4;
      pixels[target] = row[source] ?? 0;
      pixels[target + 1] = row[source + 1] ?? 0;
      pixels[target + 2] = row[source + 2] ?? 0;
      pixels[target + 3] = channels === 4 ? row[source + 3] ?? 0 : 255;
    }
    previous = row;
  }
  return { height, pixels, width };
}

function unfilterPngByte(
  filter: number,
  left: number,
  above: number,
  upperLeft: number,
): number {
  if (filter === 0) return 0;
  if (filter === 1) return left;
  if (filter === 2) return above;
  if (filter === 3) return Math.floor((left + above) / 2);
  assert.equal(filter, 4);
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) {
    return left;
  }
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function findHorizontalDividerBands(
  image: DecodedPng,
): Array<{ end: number; start: number }> {
  const rows: number[] = [];
  for (let y = 0; y < image.height; y += 1) {
    let nonBackgroundPixels = 0;
    for (let x = 45; x < 1_155; x += 1) {
      const offset = (y * image.width + x) * 4;
      if (
        image.pixels[offset] !== 255
        || image.pixels[offset + 1] !== 245
        || image.pixels[offset + 2] !== 230
      ) {
        nonBackgroundPixels += 1;
      }
    }
    if (nonBackgroundPixels > 1_000) rows.push(y);
  }

  return rows.reduce<Array<{ end: number; start: number }>>((bands, row) => {
    const current = bands.at(-1);
    if (current !== undefined && row === current.end + 1) {
      current.end = row;
    } else {
      bands.push({ end: row, start: row });
    }
    return bands;
  }, []);
}

function hasDarkPixel(
  image: DecodedPng,
  rect: { bottom: number; left: number; right: number; top: number },
): boolean {
  for (let y = rect.top; y < rect.bottom; y += 1) {
    for (let x = rect.left; x < rect.right; x += 1) {
      const offset = (y * image.width + x) * 4;
      if (
        (image.pixels[offset] ?? 255) < 120
        && (image.pixels[offset + 1] ?? 255) < 120
        && (image.pixels[offset + 2] ?? 255) < 120
      ) {
        return true;
      }
    }
  }
  return false;
}
