import assert from "node:assert/strict";
import { Buffer } from "node:buffer";

import type {
  DailyNutritionResponseCardV1,
  DailyNutritionResponseCardV2,
} from "@murphai/contracts";
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
    throw new Error("Unexpected nutrition card asset read.");
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

const CARD: DailyNutritionResponseCardV2 = {
  kind: "daily_nutrition",
  version: 2,
  localDate: "2026-06-18",
  mealCount: 3,
  totals: {
    calories: { total: 1_840, mealCount: 3 },
    proteinGrams: { total: 112, mealCount: 3 },
    carbsGrams: { total: 206, mealCount: 3 },
    fatGrams: { total: 61, mealCount: 3 },
    fiberGrams: { total: 24, mealCount: 2 },
  },
  goals: {
    calories: { target: 2_200, status: "under_target" },
    proteinGrams: { target: 120, status: "under_target" },
    carbsGrams: null,
    fatGrams: null,
    fiberGrams: { target: 30, status: "unavailable" },
  },
};

const CARD_V1: DailyNutritionResponseCardV1 = {
  kind: "daily_nutrition",
  localDate: "2026-06-17",
  mealCount: 2,
  totals: {
    calories: { total: 1_420, mealCount: 2 },
    proteinGrams: { total: 98, mealCount: 2 },
    carbsGrams: { total: 164, mealCount: 2 },
    fatGrams: { total: 52, mealCount: 2 },
  },
};

const CARD_WITHOUT_CALORIE_GOAL: DailyNutritionResponseCardV2 = {
  ...CARD,
  goals: { ...CARD.goals, calories: null },
};

const CARD_WITH_PARTIAL_UNAVAILABLE_CALORIES: DailyNutritionResponseCardV2 = {
  ...CARD,
  totals: {
    ...CARD.totals,
    calories: { total: 1_840, mealCount: 2 },
  },
  goals: {
    ...CARD.goals,
    calories: { target: 2_200, status: "unavailable" },
  },
};

const CARD_WITH_COMPLETE_UNAVAILABLE_CALORIES: DailyNutritionResponseCardV2 = {
  ...CARD,
  goals: {
    ...CARD.goals,
    calories: { target: 2_200, status: "unavailable" },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

test("nutrition card image route renders the bounded V2 snapshot without caching", async () => {
  const { GET } = await import("../app/imessage/card/v1/[payload]/route");
  const payload = encodePayload({ schemaVersion: 2, card: CARD });
  const request = new Request(
    `https://www.withmurph.ai/imessage/card/v1/${payload}`,
  );

  const response = await GET(request, {
    params: Promise.resolve({ payload }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "image/png");
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response.headers.get("X-Robots-Tag"), "noindex, nofollow, noarchive");
  expect(mocks.readFile).toHaveBeenCalledTimes(1);
  expect(mocks.imageResponse).toHaveBeenCalledTimes(1);

  const [imageTree, init] = getImageResponseCall();
  assert.equal(init.width, 1_200);
  assert.equal(init.height, 568);
  assert.deepEqual(
    init.fonts?.map((font) => [font.name, font.weight]),
    [["DM Sans", 400]],
  );
  assert.match(JSON.stringify(imageTree), /2026-06-18/u);
  assert.match(JSON.stringify(imageTree), /1840/u);
});

test("nutrition card image mirrors the native default-state composition", async () => {
  const { NutritionCardImage } = await import(
    "@/src/components/imessage/nutrition-card-image"
  );
  const serialized = renderToStaticMarkup(
    <NutritionCardImage card={CARD} />,
  );

  assert.match(serialized, /imessage-native-nutrition-card/u);
  assert.match(serialized, /1,840/u);
  assert.match(serialized, /112/u);
  assert.match(serialized, /206/u);
  assert.match(serialized, /61/u);
  assert.match(serialized, /24/u);
  assert.match(serialized, /data-calorie-progress="0\.8364"/u);
  assert.match(serialized, /data-goal-status="under_target"/u);
  assert.match(serialized, /color:#995E08/u);
  assert.match(serialized, /data-goal-status="unavailable"/u);
  assert.match(serialized, /color:#666163/u);
  assert.doesNotMatch(
    serialized,
    /Jun 18|PARTIAL TOTALS|2 of 3 meals|2,200|Under target|Goal unavailable|Complete total/u,
  );
});

test("nutrition card image route and component retain truthful V1 compatibility", async () => {
  const { GET } = await import("../app/imessage/card/v1/[payload]/route");
  const { NutritionCardImage } = await import(
    "@/src/components/imessage/nutrition-card-image"
  );
  const payload = encodePayload({ schemaVersion: 1, card: CARD_V1 });
  const response = await GET(
    new Request(`https://www.withmurph.ai/imessage/card/v1/${payload}`),
    { params: Promise.resolve({ payload }) },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "image/png");
  expect(mocks.imageResponse).toHaveBeenCalledTimes(1);

  const serialized = renderToStaticMarkup(
    <NutritionCardImage card={CARD_V1} />,
  );
  assert.match(serialized, /1,420/u);
  assert.match(serialized, /98/u);
  assert.match(serialized, /164/u);
  assert.match(serialized, /52/u);
  assert.match(serialized, /FIBER/u);
  assert.match(serialized, />—</u);
  assert.match(serialized, /data-calorie-progress="unavailable"/u);
  assert.doesNotMatch(serialized, /Jun 17|No goal|Goal unavailable/u);
});

test.each([
  ["a null calorie goal", CARD_WITHOUT_CALORIE_GOAL],
  [
    "a partial unavailable calorie total",
    CARD_WITH_PARTIAL_UNAVAILABLE_CALORIES,
  ],
  [
    "a complete unavailable calorie total",
    CARD_WITH_COMPLETE_UNAVAILABLE_CALORIES,
  ],
])(
  "nutrition card image uses a neutral calorie ring for %s",
  async (_label, card) => {
    const { NutritionCardImage } = await import(
      "@/src/components/imessage/nutrition-card-image"
    );
    const serialized = renderToStaticMarkup(
      <NutritionCardImage card={card} />,
    );

    assert.match(serialized, /data-calorie-progress="unavailable"/u);
    assert.doesNotMatch(serialized, /stroke-dasharray/u);
  },
);

test("nutrition card image route preserves the neutral ring for partial unavailable calories", async () => {
  const { GET } = await import("../app/imessage/card/v1/[payload]/route");
  const payload = encodePayload({
    schemaVersion: 2,
    card: CARD_WITH_PARTIAL_UNAVAILABLE_CALORIES,
  });
  const response = await GET(
    new Request(`https://www.withmurph.ai/imessage/card/v1/${payload}`),
    { params: Promise.resolve({ payload }) },
  );

  assert.equal(response.status, 200);
  const [imageTree] = getImageResponseCall();
  assert.match(
    renderToStaticMarkup(imageTree),
    /data-calorie-progress="unavailable"/u,
  );
});

test("nutrition card image route rejects malformed, non-nutrition, and query-bearing URLs before asset reads", async () => {
  const { GET } = await import("../app/imessage/card/v1/[payload]/route");
  const invalidPayloads = [
    "not-base64.png",
    encodePayload({ schemaVersion: 3, card: { kind: "compact_table" } }),
    encodePayload({ schemaVersion: 2, card: CARD, extra: true }),
    `${"a".repeat(1_901)}.png`,
  ];

  for (const payload of invalidPayloads) {
    const response = await GET(
      new Request(`https://www.withmurph.ai/imessage/card/v1/${payload}`),
      { params: Promise.resolve({ payload }) },
    );
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  }

  const validPayload = encodePayload({ schemaVersion: 2, card: CARD });
  const queryResponse = await GET(
    new Request(
      `https://www.withmurph.ai/imessage/card/v1/${validPayload}?source=test`,
    ),
    { params: Promise.resolve({ payload: validPayload }) },
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
