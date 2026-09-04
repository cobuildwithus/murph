import assert from "node:assert/strict";
import { Buffer } from "node:buffer";

import type { WearableTrendResponseCardV1 } from "@murphai/contracts";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

type MockImageResponseInit = {
  fonts?: Array<{ data: ArrayBuffer; name: string; weight: number }>;
  headers?: HeadersInit;
  height?: number;
  width?: number;
};

const mocks = vi.hoisted(() => ({
  imageResponse: vi.fn<
    (input: ReactElement, init: MockImageResponseInit) => void
  >(),
  readFile: vi.fn(async (path: string | URL) => {
    const value = String(path);
    if (value.includes("DMSans-400.ttf")) return Buffer.from([4, 5, 6]);
    if (value.includes("DMSans-600.ttf")) return Buffer.from([7, 8, 9]);
    if (value.includes("murph-mark.svg")) {
      return Buffer.from('<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>');
    }
    throw new Error("Unexpected wearable trend card asset read.");
  }),
}));

vi.mock("node:fs/promises", () => ({
  readFile: mocks.readFile,
}));

vi.mock("next/og", () => ({
  ImageResponse: class ImageResponse extends Response {
    constructor(input: ReactElement, init: MockImageResponseInit) {
      mocks.imageResponse(input, init);
      super("mock image", {
        headers: {
          "Content-Type": "image/png",
          ...headersInitToRecord(init.headers),
        },
        status: 200,
      });
    }
  },
}));

const LOCAL_DATES = [
  "2026-08-24",
  "2026-08-25",
  "2026-08-26",
  "2026-08-27",
  "2026-08-28",
  "2026-08-29",
  "2026-08-30",
] as const;

const COMPLETE_CARD: WearableTrendResponseCardV1 = {
  kind: "wearable_trend",
  version: 1,
  localDates: [...LOCAL_DATES],
  metrics: [
    {
      metricKey: "steps",
      values: [6_800, 7_900, 9_400, 8_700, 10_200, 7_100, 9_800],
      trend: "higher",
    },
    {
      metricKey: "total-sleep-minutes",
      values: [432, 438, 428, 441, 435, 439, 434],
      trend: "steady",
    },
    {
      metricKey: "hrv-rmssd",
      values: [37, 41, 39, 45, 47, 44, 50],
      trend: "higher",
    },
  ],
};

const SPARSE_CARD: WearableTrendResponseCardV1 = {
  ...COMPLETE_CARD,
  metrics: [
    {
      metricKey: "steps",
      values: [6_800, null, null, 8_700, null, null, 9_800],
      trend: "not_enough_data",
    },
    {
      metricKey: "total-sleep-minutes",
      values: [432, 438, null, 441, null, null, 434],
      trend: "not_enough_data",
    },
    {
      metricKey: "hrv-rmssd",
      values: [37, null, 39, 45, null, 44, 50],
      trend: "higher",
    },
  ],
};

const ALL_MISSING_CARD: WearableTrendResponseCardV1 = {
  ...COMPLETE_CARD,
  metrics: COMPLETE_CARD.metrics.map((metric) => ({
    ...metric,
    values: [null, null, null, null, null, null, null],
    trend: "not_enough_data",
  })),
};

beforeEach(() => {
  vi.clearAllMocks();
});

test("wearable trend image leads each row with its average and neutral direction over one shared day axis", async () => {
  const { WearableTrendCardImage, getWearableTrendCardImageSize } = await import(
    "@/src/components/imessage/wearable-trend-card-image"
  );
  const markup = renderToStaticMarkup(
    <WearableTrendCardImage card={COMPLETE_CARD} />,
  );

  expect(getWearableTrendCardImageSize(COMPLETE_CARD)).toEqual({
    height: 815,
    width: 1_200,
  });
  expect(markup.match(/data-wearable-trend-day-axis="shared"/gu)).toHaveLength(1);
  expect(markup.match(/>AVERAGE</gu)).toHaveLength(1);
  // Single-letter day axis in calendar order: Mon..Sun.
  const axisMarkup = markup.slice(
    markup.indexOf('data-wearable-trend-day-axis="shared"'),
    markup.indexOf('data-metric-key='),
  );
  expect(
    Array.from(axisMarkup.matchAll(/>([A-Z])</gu), (match) => match[1]).join(""),
  ).toBe("MTWTFSS");
  expect(markup).toContain("7-day health");
  // The date range sits on the title row, not beneath it.
  expect(markup).toContain('data-card-date-range="Aug 24–30"');
  expect(markup).not.toContain('data-card-text-lines="1">Aug');

  expect(markup).toContain(">STEPS<");
  expect(markup).toContain('data-metric-average="8.6k"');
  expect(markup).toContain('data-metric-direction="higher"');
  expect(markup.match(/>↑</gu)).toHaveLength(2);
  expect(markup).toContain(">SLEEP<");
  expect(markup).toContain('data-metric-average="7h15m"');
  expect(markup).toContain('data-metric-direction="steady"');
  expect(markup.match(/>→</gu)).toHaveLength(1);
  // Direction is one arrow beside the average, never a word.
  expect(markup).not.toMatch(/>[^<]*(?:Higher|Lower|Steady)[^<]*</u);
  expect(markup).toContain(">HRV (RMSSD)<");
  expect(markup).toContain('data-metric-average="43"');
  expect(markup).toContain(">ms<");
  expect(markup).not.toContain("prior week");

  // The chart carries no value labels; the average is the row's only number.
  for (const dayValue of ["10.2k", "6.8k", "7h21m", "7h08m", "7h12m", "50", "37", "41"]) {
    expect(markup).not.toContain(`>${dayValue}<`);
  }
  // One continuous fitted line per complete row, with a point on every day.
  expect(markup.match(/<svg\b/gu)).toHaveLength(3);
  expect(markup.match(/<path\b/gu)).toHaveLength(3);
  expect(markup.match(/data-day-value="observed"/gu)).toHaveLength(21);
  expect(markup).not.toContain('data-day-value="missing"');
  // A week that moves more than the metric's minimum span fills the chart
  // (steps: 3,400 of a 3,000 floor), while a quiet week stays near the
  // middle so small differences are not exaggerated (sleep: 13 minutes of a
  // 90-minute floor draws within a fraction of the height).
  const rowPointHeights = (metricKey: string): number[] => {
    const start = markup.indexOf(`data-metric-key="${metricKey}"`);
    const rest = markup.slice(start + 1);
    const next = rest.indexOf('data-metric-key="');
    const row = next === -1 ? rest : rest.slice(0, next);
    return Array.from(row.matchAll(/cy="([\d.]+)"/gu), (match) => Number(match[1]));
  };
  const stepHeights = rowPointHeights("steps");
  expect(Math.min(...stepHeights)).toBe(14);
  expect(Math.max(...stepHeights)).toBe(136);
  const sleepHeights = rowPointHeights("total-sleep-minutes");
  expect(Math.max(...sleepHeights) - Math.min(...sleepHeights)).toBeLessThan(0.2 * 122);
  expect(Math.min(...sleepHeights)).toBeGreaterThan(14);
  expect(Math.max(...sleepHeights)).toBeLessThan(136);
  expect(markup).toContain("data-sparkline=\"▁▃▆▅█▂▇\"");
  expect(markup.match(/data-sparkline=/gu)).toHaveLength(3);
  expect(markup).toContain('data-murph-card-badge="svg"');
  expect(markup).not.toMatch(/<(?:button|footer|legend)\b/u);
  expect(markup).not.toMatch(/pill|tooltip|tap|reply|better|worse/iu);
});

test("wearable trend image preserves sparse and unavailable calendar slots", async () => {
  const { WearableTrendCardImage, getWearableTrendCardImageSize } = await import(
    "@/src/components/imessage/wearable-trend-card-image"
  );
  const sparseMarkup = renderToStaticMarkup(
    <WearableTrendCardImage card={SPARSE_CARD} />,
  );
  const missingMarkup = renderToStaticMarkup(
    <WearableTrendCardImage card={ALL_MISSING_CARD} />,
  );

  expect(sparseMarkup.match(/data-day-value="missing"/gu)).toHaveLength(9);
  expect(sparseMarkup).toContain('data-metric-average="8.4k"');
  // Rows that cannot be compared show only their label and average.
  expect(sparseMarkup.match(/data-metric-direction="not_enough_data"/gu)).toHaveLength(2);
  // Only visible text is checked; accessibility labels still say unavailable.
  expect(sparseMarkup).not.toMatch(/>[^<]*(?:too few|unavailable|not enough)[^<]*</iu);
  expect(sparseMarkup.match(/>(?:↑|↓|→)</gu)).toHaveLength(1);
  expect(sparseMarkup).toContain("data-sparkline=\"▁··▅··█\"");
  expect(sparseMarkup).toContain("Tue no data");
  // A missing day keeps its column marker but never a text placeholder, and
  // the line breaks around it instead of bridging the gap.
  expect(sparseMarkup).not.toContain(">—<");
  expect(sparseMarkup.match(/<path\b/gu)).toHaveLength(3);
  expect(sparseMarkup.match(/data-day-value="observed"/gu)).toHaveLength(12);

  // Metrics with no observed days collapse to a shorter row and never show a
  // zero, a placeholder average, or a day label.
  expect(getWearableTrendCardImageSize(ALL_MISSING_CARD)).toEqual({
    height: 629,
    width: 1_200,
  });
  expect(missingMarkup.match(/data-day-value="missing"/gu)).toHaveLength(21);
  expect(missingMarkup.match(/data-sparkline="·······"/gu)).toHaveLength(3);
  expect(missingMarkup.match(/data-metric-direction="no_data"/gu)).toHaveLength(3);
  expect(missingMarkup.match(/>No data</gu)).toHaveLength(3);
  expect(missingMarkup).not.toContain("data-metric-average=");
  expect(missingMarkup).not.toContain("<path");
  expect(missingMarkup).not.toContain(">—<");
  expect(missingMarkup).not.toContain(">0<");
  expect(missingMarkup).not.toContain(">0 ");
});

test("response-card image route accepts only the exact schema-seven wearable envelope", async () => {
  const { GET } = await import("../app/imessage/card/v1/[payload]/route");
  const payload = encodePayload({ schemaVersion: 7, card: COMPLETE_CARD });
  const response = await GET(
    new Request(`https://www.withmurph.ai/imessage/card/v1/${payload}`),
    { params: Promise.resolve({ payload }) },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "image/png");
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response.headers.get("X-Robots-Tag"), "noindex, nofollow, noarchive");
  expect(mocks.readFile).toHaveBeenCalledTimes(3);
  expect(mocks.imageResponse).toHaveBeenCalledTimes(1);

  const [imageTree, init] = getImageResponseCall();
  assert.equal(init.width, 1_200);
  assert.equal(init.height, 815);
  const markup = renderToStaticMarkup(imageTree);
  assert.match(markup, /imessage-native-wearable-trend-card/u);
  assert.match(markup, /10\.2k/u);

  vi.clearAllMocks();
  const invalidPayloads = [
    encodePayload({ schemaVersion: 7, card: { ...COMPLETE_CARD, extra: true } }),
    encodePayload({ schemaVersion: 7, card: { ...COMPLETE_CARD, localDates: LOCAL_DATES.slice(0, 6) } }),
    encodePayload({ schemaVersion: 7, card: { ...COMPLETE_CARD, metrics: [] } }),
  ];
  for (const invalidPayload of invalidPayloads) {
    const invalidResponse = await GET(
      new Request(`https://www.withmurph.ai/imessage/card/v1/${invalidPayload}`),
      { params: Promise.resolve({ payload: invalidPayload }) },
    );
    assert.equal(invalidResponse.status, 404);
  }
  const queryResponse = await GET(
    new Request(`https://www.withmurph.ai/imessage/card/v1/${payload}?source=test`),
    { params: Promise.resolve({ payload }) },
  );
  assert.equal(queryResponse.status, 404);
  expect(mocks.imageResponse).not.toHaveBeenCalled();
  expect(mocks.readFile).not.toHaveBeenCalled();
});

function encodePayload(value: unknown): string {
  return `${Buffer.from(JSON.stringify(value), "utf8").toString("base64url")}.png`;
}

function getImageResponseCall(): [ReactElement, MockImageResponseInit] {
  const call = mocks.imageResponse.mock.calls[0];
  assert.ok(call, "Expected ImageResponse to be constructed.");
  return call;
}

function headersInitToRecord(headers: HeadersInit | undefined): Record<string, string> {
  return Object.fromEntries(new Headers(headers).entries());
}
