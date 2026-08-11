import assert from "node:assert/strict";
import { Buffer } from "node:buffer";

import type {
  ChallengeStandingsResponseCardV1,
  CompactTablePresentationCardV1,
  DailyNutritionResponseCardV1,
  DailyNutritionResponseCardV2,
} from "@murphai/contracts";
import {
  buildWorkoutSessionAppCardEnvelopeV4,
  IMESSAGE_APP_CARD_IMAGE_PAYLOAD_MAX_LENGTH,
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

const TABLE_CARD: CompactTablePresentationCardV1 = {
  kind: "compact_table",
  version: 1,
  title: "Weekly plan",
  subtitle: "Three focused sessions",
  rowHeader: "Day",
  columns: ["Focus", "Sets"],
  rows: [
    { label: "Monday", values: ["Upper body", "14"] },
    { label: "Wednesday", values: ["Lower body", "16"] },
    { label: "Saturday", values: ["Full body", "12"] },
  ],
  footer: "Adjust load when form slows down.",
};

const DENSE_TABLE_CARD: CompactTablePresentationCardV1 = {
  kind: "compact_table",
  version: 1,
  title: "Eight-exercise workout",
  subtitle: "Verified canonical workout snapshot for today",
  rowHeader: "Exercise",
  columns: ["Set 1", "Set 2", "Set 3", "Set 4"],
  rows: Array.from({ length: 8 }, (_, rowIndex) => ({
    label: `Exercise ${rowIndex + 1} movement pattern`,
    values: Array.from({ length: 4 }, (_, columnIndex) => {
      if (rowIndex === 7 && columnIndex === 3) {
        return "Bodyweight × 16";
      }
      const cellLength = 22;
      return `${rowIndex + columnIndex + 1}`.padEnd(cellLength, "x");
    }),
  })),
  footer: "Assists and spotted reps remain on the exact set note.",
};

const FONT_METRIC_TABLE_CARD: CompactTablePresentationCardV1 = {
  kind: "compact_table",
  version: 1,
  title: "Recovery signals",
  subtitle: null,
  rowHeader: "Metric",
  columns: ["Today", "Week", "Trend", "Note"],
  rows: [{
    label: "Recovery",
    values: ["deep sleep and mood guidance", "Stable", "Up", "Review"],
  }],
  footer: null,
};

const POSITIVE_KERNING_TABLE_CARD: CompactTablePresentationCardV1 = {
  kind: "compact_table",
  version: 1,
  title: "Recovery signals",
  subtitle: null,
  rowHeader: "Metric",
  columns: ["Today", "Week", "Trend", "Note"],
  rows: [{
    label: "Recovery",
    values: ["slow gait, ankle impact, or load", "Stable", "Up", "Review"],
  }],
  footer: null,
};

const WORKOUT_CARD: Extract<
  CompactTablePresentationCardV1,
  { workout: unknown }
> = {
  kind: "compact_table",
  version: 1,
  title: "Push day",
  subtitle: null,
  footer: "Reply with the exercise, set, and result to log or correct it.",
  workout: {
    version: 1,
    state: "active",
    exercises: [
      {
        name: "Bench press",
        sets: [
          { status: "completed", target: "185 lb × 8", actual: "185 lb × 8" },
          { status: "completed", target: "185 lb × 8", actual: "185 lb × 7" },
          { status: "completed", target: "185 lb × 6–8", actual: "185 lb × 6" },
        ],
      },
      {
        name: "Incline dumbbell press",
        sets: [
          { status: "completed", target: "55 lb × 10", actual: "55 lb × 10" },
          { status: "pending", target: "55 lb × 8–10", actual: null },
          { status: "pending", target: null, actual: null },
        ],
      },
    ],
  },
};

const STANDINGS_CARD: ChallengeStandingsResponseCardV1 = {
  kind: "challenge_standings",
  version: 1,
  format: "teams",
  title: "Summer movement challenge",
  subtitle: "Day 4 of 7",
  objective: { kind: "target", targetPoints: 250 },
  entries: [
    {
      label: "North team",
      points: 210,
      coverage: "complete",
      detail: null,
    },
    {
      label: "South team",
      points: 180,
      coverage: "partial",
      detail: null,
    },
    {
      label: "West team",
      points: null,
      coverage: "unscored",
      detail: null,
    },
  ],
  footer: null,
};

const COLLECTIVE_STANDINGS_CARD: ChallengeStandingsResponseCardV1 = {
  kind: "challenge_standings",
  version: 1,
  format: "collective",
  title: "Move together",
  subtitle: "Weekly progress",
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
  assert.match(serialized, /data-calorie-goal-status="under_target"/u);
  assert.match(serialized, /top:146px/u);
  assert.match(serialized, />UNDER</u);
  assert.match(serialized, /color:#995E08/u);
  assert.match(serialized, /data-goal-status="unavailable"/u);
  assert.match(serialized, /color:#666163/u);
  assert.doesNotMatch(serialized, /border-radius:105px/u);
  assert.doesNotMatch(serialized, /box-shadow/u);
  assert.doesNotMatch(
    serialized,
    /Jun 18|PARTIAL TOTALS|2 of 3 meals|2,200|Goal unavailable|Complete total/u,
  );
});

test("nutrition card image renders every assessed goal direction without target amounts", async () => {
  const { NutritionCardImage } = await import(
    "@/src/components/imessage/nutrition-card-image"
  );
  const directionalCard: DailyNutritionResponseCardV2 = {
    ...CARD,
    goals: {
      calories: { target: 3_000, status: "far_under_target" },
      proteinGrams: { target: 130, status: "under_target" },
      carbsGrams: { target: 210, status: "on_target" },
      fatGrams: { target: 50, status: "over_target" },
      fiberGrams: { target: 10, status: "far_over_target" },
    },
  };
  const serialized = renderToStaticMarkup(
    <NutritionCardImage card={directionalCard} />,
  );

  for (const label of [
    "FAR UNDER",
    "UNDER",
    "ON TARGET",
    "OVER",
    "FAR OVER",
  ]) {
    assert.match(serialized, new RegExp(`>${label}<`, "u"));
  }
  assert.doesNotMatch(serialized, /3,000|130g|210g|50g|10g/u);
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

test("response-card image route renders the exact V3 generic table snapshot", async () => {
  const { GET } = await import("../app/imessage/card/v1/[payload]/route");
  const payload = encodePayload({ schemaVersion: 3, card: TABLE_CARD });
  const response = await GET(
    new Request(`https://www.withmurph.ai/imessage/card/v1/${payload}`),
    { params: Promise.resolve({ payload }) },
  );

  assert.equal(response.status, 200);
  const [imageTree, init] = getImageResponseCall();
  assert.equal(init.width, 1_200);
  assert.equal(init.height, 670);
  const serialized = renderToStaticMarkup(imageTree);
  assert.match(serialized, /imessage-native-compact-table-card/u);
  assert.match(serialized, /Weekly plan/u);
  assert.match(serialized, /Upper body/u);
  assert.match(serialized, /Wednesday/u);
  assert.match(serialized, />16</u);
  assert.doesNotMatch(serialized, /border-radius:105px/u);
  assert.doesNotMatch(serialized, /box-shadow/u);
  assert.match(serialized, /data-provider-icon-clearance="155"/u);
  assert.match(serialized, /margin-left:155px/u);
});

test("response-card image route restores and renders the exact compact V4 workout snapshot", async () => {
  const { GET } = await import("../app/imessage/card/v1/[payload]/route");
  const payload = encodePayload(buildWorkoutSessionAppCardEnvelopeV4({
    title: WORKOUT_CARD.title,
    subtitle: WORKOUT_CARD.subtitle,
    footer: WORKOUT_CARD.footer,
    workout: WORKOUT_CARD.workout,
  }));
  const response = await GET(
    new Request(`https://www.withmurph.ai/imessage/card/v1/${payload}`),
    { params: Promise.resolve({ payload }) },
  );

  assert.equal(response.status, 200);
  const [imageTree, init] = getImageResponseCall();
  assert.equal(init.width, 1_200);
  assert.equal(init.height, 580);
  const serialized = renderToStaticMarkup(imageTree);
  assert.match(serialized, /Push day/u);
  assert.match(serialized, /IN PROGRESS/u);
  assert.match(serialized, /Bench press/u);
  assert.match(serialized, /Next: 55 lb × 8–10/u);
  assert.match(
    serialized,
    /Reply with the exercise, set, and result to\s+log or correct it\./u,
  );
  assert.doesNotMatch(serialized, /Tap an exercise/u);
  assert.match(serialized, /data-workout-progress="0\.6667"/u);
  assert.match(serialized, /data-exercise-state="resolved"/u);
  assert.match(serialized, /data-exercise-state="in-progress"/u);
  assert.doesNotMatch(serialized, /4 of 6 sets complete|TODAY/u);
  assert.match(serialized, /data-exercise-checkmark="true"/u);
  assert.doesNotMatch(serialized, /✓/u);
  assert.doesNotMatch(serialized, /border-radius:105px/u);
  assert.doesNotMatch(serialized, /box-shadow/u);
  assert.match(serialized, /data-provider-icon-clearance="155"/u);
  assert.match(serialized, /margin-left:155px/u);
  assert.doesNotMatch(serialized, /evt_|snapshotAt/u);
  assert.doesNotMatch(serialized, /border-radius:105px/u);
  assert.doesNotMatch(serialized, /box-shadow/u);
});

test("workout images ignore legacy subtitles in both pixels and height", async () => {
  const {
    CompactTableCardImage,
    getCompactTableCardImageSize,
  } = await import("@/src/components/imessage/compact-table-card-image");
  const legacySubtitleCard: typeof WORKOUT_CARD = {
    ...WORKOUT_CARD,
    subtitle: "Legacy progress copy that must not affect the workout image layout",
  };
  const currentCard: typeof WORKOUT_CARD = {
    ...WORKOUT_CARD,
    subtitle: null,
  };

  assert.deepEqual(
    getCompactTableCardImageSize(legacySubtitleCard),
    getCompactTableCardImageSize(currentCard),
  );
  const serialized = renderToStaticMarkup(
    <CompactTableCardImage card={legacySubtitleCard} />,
  );
  assert.doesNotMatch(serialized, /Legacy progress copy/u);
});

test("workout image keeps Next on the first pending set when it has no target", async () => {
  const { GET } = await import("../app/imessage/card/v1/[payload]/route");
  const targetlessNextCard = {
    ...WORKOUT_CARD,
    workout: {
      ...WORKOUT_CARD.workout,
      exercises: [
        {
          name: "Bench press",
          sets: [
            { status: "pending", target: null, actual: null },
            { status: "pending", target: "135 lb × 8", actual: null },
          ],
        },
      ],
    },
  } satisfies typeof WORKOUT_CARD;
  const payload = encodePayload(buildWorkoutSessionAppCardEnvelopeV4({
    title: targetlessNextCard.title,
    subtitle: targetlessNextCard.subtitle,
    footer: targetlessNextCard.footer,
    workout: targetlessNextCard.workout,
  }));
  const response = await GET(
    new Request(`https://www.withmurph.ai/imessage/card/v1/${payload}`),
    { params: Promise.resolve({ payload }) },
  );

  assert.equal(response.status, 200);
  const [imageTree] = getImageResponseCall();
  const serialized = renderToStaticMarkup(imageTree);

  assert.match(serialized, /Next set: no target/u);
  assert.doesNotMatch(serialized, /Next: 135 lb × 8/u);
});

test("dense contract-valid tables wrap every value into measured row height", async () => {
  const { GET } = await import("../app/imessage/card/v1/[payload]/route");
  const { getCompactTableCardImageSize } = await import(
    "@/src/components/imessage/compact-table-card-image"
  );
  const payload = encodePayload({ schemaVersion: 3, card: DENSE_TABLE_CARD });
  const response = await GET(
    new Request(`https://www.withmurph.ai/imessage/card/v1/${payload}`),
    { params: Promise.resolve({ payload }) },
  );

  assert.equal(response.status, 200);
  const [imageTree, init] = getImageResponseCall();
  const expectedSize = getCompactTableCardImageSize(DENSE_TABLE_CARD);
  assert.equal(init.height, expectedSize.height);
  assert.ok(expectedSize.height > 1_000);
  const serialized = renderToStaticMarkup(imageTree);
  assert.match(serialized, /data-card-text-lines="2"/u);
  assert.match(serialized, /white-space:pre-wrap/u);
  assert.match(serialized, /Bodyweight ×\n16/u);
  assert.doesNotMatch(serialized, /Bodywe\night/u);
  assert.match(serialized, /1xxxxxxxxxxxxx\nxxxxxxxx/u);
});

test("four-column rows use exact DM Sans advances for word breaks and height", async () => {
  const { GET } = await import("../app/imessage/card/v1/[payload]/route");
  const payload = encodePayload({
    schemaVersion: 3,
    card: FONT_METRIC_TABLE_CARD,
  });
  const response = await GET(
    new Request(`https://www.withmurph.ai/imessage/card/v1/${payload}`),
    { params: Promise.resolve({ payload }) },
  );

  assert.equal(response.status, 200);
  const [imageTree] = getImageResponseCall();
  const serialized = renderToStaticMarkup(imageTree);
  assert.match(serialized, /deep sleep\nand mood\nguidance/u);
  assert.match(serialized, /height:100px/u);
  assert.match(serialized, /data-card-text-lines="3"[^>]*>deep sleep/u);
});

test("positive DM Sans kerning cannot reflow text beyond its measured row", async () => {
  const { GET } = await import("../app/imessage/card/v1/[payload]/route");
  const payload = encodePayload({
    schemaVersion: 3,
    card: POSITIVE_KERNING_TABLE_CARD,
  });
  const response = await GET(
    new Request(`https://www.withmurph.ai/imessage/card/v1/${payload}`),
    { params: Promise.resolve({ payload }) },
  );

  assert.equal(response.status, 200);
  const [imageTree] = getImageResponseCall();
  const serialized = renderToStaticMarkup(imageTree);
  assert.match(serialized, /slow gait,\nankle impact,\nor load/u);
  assert.match(serialized, /height:100px/u);
  assert.match(serialized, /data-card-text-lines="3"[^>]*>slow gait,/u);
  assert.doesNotMatch(serialized, /slow gait, ankle\nimpact, or load/u);
});

test("response-card image route renders the exact V5 standings snapshot", async () => {
  const { GET } = await import("../app/imessage/card/v1/[payload]/route");
  const payload = encodePayload({ schemaVersion: 5, card: STANDINGS_CARD });
  const response = await GET(
    new Request(`https://www.withmurph.ai/imessage/card/v1/${payload}`),
    { params: Promise.resolve({ payload }) },
  );

  assert.equal(response.status, 200);
  const [imageTree, init] = getImageResponseCall();
  assert.equal(init.width, 1_200);
  assert.equal(init.height, 614);
  const serialized = renderToStaticMarkup(imageTree);
  assert.match(serialized, /imessage-native-challenge-standings-card/u);
  assert.match(serialized, /Summer movement challenge/u);
  assert.match(serialized, /North team/u);
  assert.match(serialized, /210/u);
  assert.match(serialized, /OF 250 PTS/u);
  assert.match(serialized, /data-entry-progress="0\.8400"/u);
  assert.match(serialized, /Ranks appear when every score is complete\./u);
  const rootTag = serialized.match(
    /<div data-design-contract="imessage-native-challenge-standings-card"[^>]*>/u,
  );
  assert.ok(rootTag);
  assert.doesNotMatch(rootTag[0], /border-radius|overflow:hidden/u);
  assert.match(serialized, /margin-left:155px/u);
  assert.doesNotMatch(serialized, /box-shadow:/u);
  assert.doesNotMatch(
    serialized,
    /VERIFIED STANDINGS|TEAM STANDINGS|GROUP GOAL|LEADERBOARD|verified minimum|waiting for data/u,
  );
});

test("standings image keeps collective progress collective", async () => {
  const {
    ChallengeStandingsCardImage,
    getChallengeStandingsCardImageSize,
  } = await import(
    "@/src/components/imessage/challenge-standings-card-image"
  );
  const serialized = renderToStaticMarkup(
    <ChallengeStandingsCardImage card={COLLECTIVE_STANDINGS_CARD} />,
  );

  assert.match(serialized, /640\+/u);
  assert.match(serialized, /\/ 1,000 pts/u);
  assert.match(serialized, /data-collective-progress="0\.6400"/u);
  assert.match(serialized, /More progress may be pending/u);
  assert.match(serialized, /2\/3 SCORED/u);
  assert.doesNotMatch(serialized, /North team|South team|West team/u);

  const unscoredCard: ChallengeStandingsResponseCardV1 = {
    ...COLLECTIVE_STANDINGS_CARD,
    collectivePoints: null,
    coverage: "unscored",
    coverageCounts: {
      completeParticipants: 0,
      partialParticipants: 0,
      totalParticipants: 3,
      unscoredParticipants: 3,
    },
  };
  const unscoredSerialized = renderToStaticMarkup(
    <ChallengeStandingsCardImage card={unscoredCard} />,
  );
  assert.match(unscoredSerialized, /Waiting for shared data/u);
  assert.match(unscoredSerialized, /0\/3 SCORED/u);
  assert.doesNotMatch(unscoredSerialized, /data-collective-progress/u);

  expect(getChallengeStandingsCardImageSize({
    ...COLLECTIVE_STANDINGS_CARD,
    title: "T".repeat(60),
    subtitle: "S".repeat(120),
  })).toEqual({ width: 1_200, height: 654 });
});

test("response-card image route rejects malformed, incomplete, and query-bearing URLs before asset reads", async () => {
  const { GET } = await import("../app/imessage/card/v1/[payload]/route");
  const invalidPayloads = [
    "not-base64.png",
    encodePayload({ schemaVersion: 3, card: { kind: "compact_table" } }),
    encodePayload({
      schemaVersion: 3,
      card: { ...TABLE_CARD, tracking: null },
    }),
    encodePayload({ schemaVersion: 2, card: CARD, extra: true }),
    encodePayload({
      schemaVersion: 5,
      card: { ...STANDINGS_CARD, format: "leaderboard" },
    }),
    `${"a".repeat(IMESSAGE_APP_CARD_IMAGE_PAYLOAD_MAX_LENGTH + 1)}.png`,
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
