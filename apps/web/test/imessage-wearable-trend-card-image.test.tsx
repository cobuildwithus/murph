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

test("wearable trend image keeps one shared seven-day axis and the direct metric blocks", async () => {
  const { WearableTrendCardImage, getWearableTrendCardImageSize } = await import(
    "@/src/components/imessage/wearable-trend-card-image"
  );
  const markup = renderToStaticMarkup(
    <WearableTrendCardImage card={COMPLETE_CARD} />,
  );

  expect(getWearableTrendCardImageSize(COMPLETE_CARD)).toEqual({
    height: 860,
    width: 1_200,
  });
  expect(markup.match(/data-wearable-trend-day-axis="shared"/gu)).toHaveLength(1);
  for (const weekday of ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]) {
    expect(markup.match(new RegExp(`>${weekday}<`, "gu"))).toHaveLength(1);
  }
  expect(markup).toContain("7-day health");
  expect(markup).toContain("Aug 24–30");
  expect(markup).toContain("AVG · VS PRIOR 7D");
  expect(markup).toContain("STEPS");
  expect(markup).toContain("8.6k · higher");
  expect(markup).toContain("SLEEP");
  expect(markup).toContain("7h15m · steady");
  expect(markup).toContain("HRV (RMSSD)");
  expect(markup).toContain("43 ms · higher");
  expect(markup).toContain("10.2k");
  expect(markup).toContain("data-sparkline=\"▁▃▆▅█▂▇\"");
  expect(markup.match(/data-sparkline=/gu)).toHaveLength(3);
  expect(markup).toContain('data-murph-card-badge="svg"');
  expect(markup).not.toMatch(/<(?:button|footer|legend|svg)\b/u);
  expect(markup).not.toMatch(/pill|tooltip|tap|reply|better|worse/iu);
});

test("wearable trend image preserves sparse and unavailable calendar slots", async () => {
  const { WearableTrendCardImage } = await import(
    "@/src/components/imessage/wearable-trend-card-image"
  );
  const sparseMarkup = renderToStaticMarkup(
    <WearableTrendCardImage card={SPARSE_CARD} />,
  );
  const missingMarkup = renderToStaticMarkup(
    <WearableTrendCardImage card={ALL_MISSING_CARD} />,
  );

  expect(sparseMarkup.match(/data-day-value="missing"/gu)).toHaveLength(9);
  expect(sparseMarkup).toContain("8.4k · unavailable");
  expect(sparseMarkup).toContain("data-sparkline=\"▁··▅··█\"");
  expect(sparseMarkup).toContain("Tue no data");
  expect(missingMarkup.match(/data-day-value="missing"/gu)).toHaveLength(21);
  expect(missingMarkup.match(/data-sparkline="·······"/gu)).toHaveLength(3);
  expect(missingMarkup.match(/>— · unavailable</gu)).toHaveLength(3);
  expect(missingMarkup).not.toContain(">0 ·");
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
  assert.equal(init.height, 860);
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
