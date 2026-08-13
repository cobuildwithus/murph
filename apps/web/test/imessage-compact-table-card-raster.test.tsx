import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { inflateSync } from "node:zlib";

import type {
  ChallengeStandingsResponseCardV1,
  CompactTablePresentationCardV1,
  DailyNutritionResponseCardV2,
} from "@murphai/contracts";
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

const PARTIAL_COLLECTIVE_CARD: ChallengeStandingsResponseCardV1 = {
  kind: "challenge_standings",
  version: 1,
  format: "collective",
  title: "Challenge standings",
  subtitle: null,
  objective: { kind: "target", targetPoints: 1_000 },
  collectivePoints: 640,
  coverage: "partial",
  coverageCounts: {
    completeParticipants: 1,
    partialParticipants: 1,
    totalParticipants: 3,
    unscoredParticipants: 1,
  },
  footer: null,
};

const SEMIBOLD_BOUNDARY_CARD: ChallengeStandingsResponseCardV1 = {
  kind: "challenge_standings",
  version: 1,
  format: "individual",
  title: "standings progress challenge morning",
  subtitle: null,
  objective: { kind: "target", targetPoints: 1_000_000 },
  entries: [{
    label: "Participant with a semibold boundary label",
    points: 875_000,
    coverage: "complete",
    detail: null,
  }],
  footer: null,
};

const MAX_TARGET_CARD: ChallengeStandingsResponseCardV1 = {
  ...SEMIBOLD_BOUNDARY_CARD,
  title: "Challenge standings",
  objective: { kind: "target", targetPoints: Number.MAX_SAFE_INTEGER },
  entries: [{
    label: "Participant 1",
    points: Number.MAX_SAFE_INTEGER - 1,
    coverage: "complete",
    detail: null,
  }],
};

const DIRECTIONAL_NUTRITION_CARD: DailyNutritionResponseCardV2 = {
  kind: "daily_nutrition",
  version: 2,
  localDate: "2026-08-11",
  mealCount: 3,
  totals: {
    calories: { total: 1_400, mealCount: 3 },
    proteinGrams: { total: 100, mealCount: 3 },
    carbsGrams: { total: 220, mealCount: 3 },
    fatGrams: { total: 80, mealCount: 3 },
    fiberGrams: { total: 50, mealCount: 3 },
  },
  goals: {
    calories: { target: 2_200, status: "far_under_target" },
    proteinGrams: { target: 140, status: "under_target" },
    carbsGrams: { target: 220, status: "on_target" },
    fatGrams: { target: 70, status: "over_target" },
    fiberGrams: { target: 30, status: "far_over_target" },
  },
};

const PARTIAL_NUTRITION_CARD: DailyNutritionResponseCardV2 = {
  ...DIRECTIONAL_NUTRITION_CARD,
  totals: {
    calories: { total: 1_400, mealCount: 2 },
    proteinGrams: { total: 100, mealCount: 2 },
    carbsGrams: { total: null, mealCount: 0 },
    fatGrams: { total: 80, mealCount: 2 },
    fiberGrams: { total: 20, mealCount: 2 },
  },
  goals: {
    calories: { target: 2_200, status: "unavailable" },
    proteinGrams: { target: 140, status: "unavailable" },
    carbsGrams: { target: 220, status: "unavailable" },
    fatGrams: { target: 70, status: "unavailable" },
    fiberGrams: { target: 30, status: "unavailable" },
  },
};

const MAX_HEADER = "MaximumHeartRatePercentX";
const MAX_VALUE = "CountermovementJumpAsymmetryXXXX";

const NARROW_FOUR_COLUMN_CARD: CompactTablePresentationCardV1 = {
  kind: "compact_table",
  version: 1,
  title: "T",
  subtitle: null,
  rowHeader: "R",
  columns: ["A", "B", "C", "D"],
  rows: Array.from({ length: 8 }, () => ({
    label: "R",
    values: ["1", "2", "3", "4"],
  })),
  footer: null,
};

function getMaximumStackedCard(
  columnCount: number,
): CompactTablePresentationCardV1 {
  return {
    kind: "compact_table",
    version: 1,
    title: "Maximum-width field proof",
    subtitle: null,
    rowHeader: "MaximumMetricLabelField",
    columns: Array.from({ length: columnCount }, () => MAX_HEADER),
    rows: [{
      label: "Contract valid row label with deliberate maximum width text",
      values: Array.from({ length: columnCount }, () => MAX_VALUE),
    }],
    footer: null,
  };
}

test("real-font nutrition omits duplicate status rows and stays contained", async () => {
  const image = await renderCard({
    schemaVersion: 2,
    card: DIRECTIONAL_NUTRITION_CARD,
  });
  assert.deepEqual([image.width, image.height], [1_200, 539]);

  const bounds = findNonBackgroundBounds(image);
  assert.ok(bounds !== null);
  assert.ok(bounds.right <= 1_155);
  assert.ok(bounds.bottom <= image.height - 38);
  assert.equal(
    hasGrayscaleDarkPixel(
      image,
      { left: 45, right: 800, top: 318, bottom: 334 },
    ),
    false,
  );
  assert.equal(
    hasGrayscaleDarkPixel(
      image,
      { left: 45, right: 1_155, top: 485, bottom: 500 },
    ),
    false,
  );
});

test("real-font partial nutrition remains neutral and contained", async () => {
  const image = await renderCard({
    schemaVersion: 2,
    card: PARTIAL_NUTRITION_CARD,
  });
  const bounds = findNonBackgroundBounds(image);
  assert.ok(bounds !== null);
  assert.ok(bounds.right <= 1_155);
  assert.ok(bounds.bottom <= image.height - 38);
  assert.equal(
    hasAccentPixel(image, { left: 45, right: 1_155, top: 250, bottom: 466 }),
    false,
  );
});

test.each([1, 2, 3, 4])(
  "real-font stacked table contains maximum header/value pairs across %i columns",
  async (columnCount) => {
    const image = await renderCard({
      schemaVersion: 3,
      card: getMaximumStackedCard(columnCount),
    });
    const bounds = findNonBackgroundBounds(image);
    assert.ok(bounds !== null);
    assert.ok(bounds.left >= 20);
    assert.ok(bounds.right <= 1_155);
    assert.ok(bounds.bottom <= image.height - 40);
    assert.equal(
      hasDarkPixel(image, {
        left: 45,
        right: 1_155,
        top: 260,
        bottom: image.height - 42,
      }),
      true,
    );
  },
);

test("real-font route keeps a fitting four-column eight-row table compact", async () => {
  const image = await renderCard({
    schemaVersion: 3,
    card: NARROW_FOUR_COLUMN_CARD,
  });
  assert.deepEqual([image.width, image.height], [1_200, 1_046]);

  const bounds = findNonBackgroundBounds(image);
  assert.ok(bounds !== null);
  assert.ok(bounds.left >= 20);
  assert.ok(bounds.right <= 1_155);
  assert.ok(bounds.bottom <= image.height - 40);
});

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
  assert.deepEqual([image.width, image.height], [1_200, 1_712]);

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

test("real-font collective status and coverage retain bottom padding", async () => {
  const image = await renderCard({
    schemaVersion: 5,
    card: PARTIAL_COLLECTIVE_CARD,
  });
  assert.deepEqual([image.width, image.height], [1_200, 630]);

  const bounds = findNonBackgroundBounds(image);
  assert.ok(bounds !== null);
  assert.ok(bounds.bottom <= image.height - 40);
  assert.equal(
    hasDarkPixel(image, {
      left: 45,
      right: 850,
      top: image.height - 180,
      bottom: image.height - 40,
    }),
    true,
  );
  assert.equal(
    hasAccentPixel(image, {
      left: 850,
      right: 1_155,
      top: image.height - 120,
      bottom: image.height - 40,
    }),
    true,
  );
});

test.each([
  ["semibold wrapping", SEMIBOLD_BOUNDARY_CARD],
  ["maximum target sizing", MAX_TARGET_CARD],
])("real-font ranked challenge contains %s", async (_label, card) => {
  const image = await renderCard({ schemaVersion: 5, card });
  const bounds = findNonBackgroundBounds(image);
  assert.ok(bounds !== null);
  assert.ok(bounds.left >= 20);
  assert.ok(bounds.right <= image.width - 30);
  assert.ok(bounds.bottom <= image.height - 40);
  assert.equal(
    hasDarkPixel(image, {
      left: 620,
      right: 1_155,
      top: 220,
      bottom: image.height - 42,
    }),
    true,
  );
});

async function renderCard(envelope: unknown): Promise<DecodedPng> {
  const { GET } = await import("../app/imessage/card/v1/[payload]/route");
  const payload = encodePayload(envelope);
  const response = await GET(
    new Request(`https://www.withmurph.ai/imessage/card/v1/${payload}`),
    { params: Promise.resolve({ payload }) },
  );
  assert.equal(response.status, 200);
  return decodePng(Buffer.from(await response.arrayBuffer()));
}

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

function hasGrayscaleDarkPixel(
  image: DecodedPng,
  rect: { bottom: number; left: number; right: number; top: number },
): boolean {
  for (let y = rect.top; y < rect.bottom; y += 1) {
    for (let x = rect.left; x < rect.right; x += 1) {
      const offset = (y * image.width + x) * 4;
      const luminance =
        (image.pixels[offset] ?? 255) * 0.2126
        + (image.pixels[offset + 1] ?? 255) * 0.7152
        + (image.pixels[offset + 2] ?? 255) * 0.0722;
      if (luminance < 140) return true;
    }
  }
  return false;
}

function hasAccentPixel(
  image: DecodedPng,
  rect: { bottom: number; left: number; right: number; top: number },
): boolean {
  for (let y = rect.top; y < rect.bottom; y += 1) {
    for (let x = rect.left; x < rect.right; x += 1) {
      const offset = (y * image.width + x) * 4;
      if (
        (image.pixels[offset] ?? 0) > 140
        && (image.pixels[offset + 1] ?? 255) < 120
        && (image.pixels[offset + 2] ?? 255) < 80
      ) {
        return true;
      }
    }
  }
  return false;
}

function findNonBackgroundBounds(
  image: DecodedPng,
): { bottom: number; left: number; right: number; top: number } | null {
  let left = image.width;
  let right = -1;
  let top = image.height;
  let bottom = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4;
      const red = image.pixels[offset] ?? 255;
      const green = image.pixels[offset + 1] ?? 245;
      const blue = image.pixels[offset + 2] ?? 230;
      if (red === 255 && green === 245 && blue === 230) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  return right < 0 ? null : { bottom, left, right, top };
}
