import assert from "node:assert/strict";

import { beforeEach, expect, test, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  imageResponse: vi.fn(),
  readFile: vi.fn(async (path: string | URL) => {
    const value = String(path);
    if (value.includes("Fraunces-400.ttf")) return Buffer.from([1, 2, 3]);
    if (value.includes("Fraunces-600.ttf")) return Buffer.from([4, 5, 6]);
    if (value.includes("DMSans-400.ttf")) return Buffer.from([7, 8, 9]);
    if (value.endsWith("public/logo.svg")) return Buffer.from("<svg />");
    throw new Error("Unexpected experiment card asset read.");
  }),
  requireActiveHostedAppSessionFromRequest: vi.fn(),
}));

type MockImageResponseInit = {
  fonts?: Array<{ data: ArrayBuffer; name: string; weight: number }>;
  headers?: HeadersInit;
  height?: number;
  width?: number;
};

vi.mock("node:fs/promises", () => ({
  readFile: mocks.readFile,
}));

vi.mock("next/font/local", () => ({
  default() {
    return {
      variable: "font-local",
    };
  },
}));

vi.mock("next/og", () => ({
  ImageResponse: class ImageResponse extends Response {
    constructor(input: unknown, init: MockImageResponseInit) {
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

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireActiveHostedAppSessionFromRequest:
    mocks.requireActiveHostedAppSessionFromRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin:
    mocks.assertHostedOnboardingMutationOrigin,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertHostedOnboardingMutationOrigin.mockReturnValue(undefined);
  mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue({
    member: { id: "member_example" },
  });
});

test("listVisibleConnectSources covers every hosted-visible device source with UI metadata", async () => {
  const { listVisibleConnectSources } = await import("../app/(dashboard)/connect/connect-page-content");
  const { DEVICE_CONNECT_SOURCES } = await import("@murphai/device-syncd/connect-config");

  const displayOnlySourceIds = new Set([
    "apple-health",
    "coros",
    "huawei-health",
    "ringconn",
    "suunto",
    "xiaomi-mi-fitness",
    "zepp",
  ]);
  const expectedVisibleSourceIds = [
    ...DEVICE_CONNECT_SOURCES
    .filter((source) =>
      displayOnlySourceIds.has(source.connectSourceId)
      || source.routes.some((route) => route.kind === "direct" || route.kind === "junction_link"),
    )
    .map((source) => source.connectSourceId),
  ]
    .sort();

  const actualVisibleSources = listVisibleConnectSources();
  const actualVisibleSourceIds = actualVisibleSources.map((source) => source.id).sort();

  assert.deepEqual(actualVisibleSourceIds, expectedVisibleSourceIds);
  const connectionSourceIds = new Set<string>(
    DEVICE_CONNECT_SOURCES.map((source) => source.connectSourceId),
  );
  assert.equal(connectionSourceIds.has("mobvoi-health"), false);
  assert.equal(
    listVisibleConnectSources({ MURPH_ANDROID_APP_ENABLED: "1" })
      .some((source) => source.id === "mobvoi-health"),
    true,
  );

  const sourceIdsWithMissingUi = actualVisibleSources
    .filter((source) => !source.name || !source.description || !source.logo.src)
    .map((source) => source.id);
  assert.deepEqual(sourceIdsWithMissingUi, []);
});

test("experiment share-card GET fails closed without reading private data", async () => {
  const { GET } = await import("../app/(dashboard)/experiments/[experimentId]/card/route");

  const response = await GET();

  assert.equal(response.status, 410);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(
    await response.text(),
    "URL-encoded experiment cards are no longer available.",
  );
  expect(mocks.imageResponse).not.toHaveBeenCalled();
  expect(mocks.readFile).not.toHaveBeenCalled();
});

test("experiment share-card POST renders authenticated body data without caching", async () => {
  const { POST } = await import("../app/(dashboard)/experiments/[experimentId]/card/route");
  const request = new Request("https://example.test/experiments/example/card", {
    body: JSON.stringify({
      title: "Evening magnesium test",
      protocol: "Magnesium glycinate after dinner for 14 nights.",
      signals: [
        {
          label: "Sleep score",
          value: "82",
          unit: "%",
          delta: "+7",
          direction: "up",
          sentiment: "positive",
          baseline: "75%",
        },
        {
          label: "Wakeups",
          value: "1.2",
          delta: "-0.6",
          direction: "down",
          sentiment: "positive",
        },
        {
          label: "Resting HR",
          value: "58",
          unit: "bpm",
          delta: "-2",
          direction: "down",
          sentiment: "neutral",
        },
        {
          label: "Hidden overflow",
          value: "not rendered",
          delta: "0",
          direction: "neutral",
        },
      ],
      chart: {
        label: "Sleep score",
        unit: "%",
        baselineCount: 3,
        values: [72, 75, 78, 80, 82],
        baselineAvg: 75,
      },
    }),
    headers: {
      "Content-Type": "application/json",
      Origin: "https://example.test",
    },
    method: "POST",
  });

  const response = await POST(request);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "image/png");
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(request);
  expect(mocks.requireActiveHostedAppSessionFromRequest).toHaveBeenCalledWith(request);
  expect(mocks.readFile).toHaveBeenCalledTimes(4);

  expect(mocks.imageResponse).toHaveBeenCalledTimes(1);
  const [imageTree, init] = getImageResponseCall();
  assert.equal(init.width, 1200);
  assert.equal(init.height, 780);
  assert.equal(headersInitToRecord(init.headers)["Cache-Control"], "private, no-store");
  assert.deepEqual(
    init.fonts?.map((font) => [font.name, font.weight]),
    [
      ["Fraunces", 400],
      ["Fraunces", 600],
      ["DM Sans", 400],
    ],
  );

  const serializedImageTree = JSON.stringify(imageTree);
  assert.match(serializedImageTree, /Evening magnesium test/u);
  assert.match(serializedImageTree, /Magnesium glycinate after dinner for 14 nights\./u);
  assert.match(serializedImageTree, /Sleep score/u);
  assert.match(serializedImageTree, /Wakeups/u);
  assert.match(serializedImageTree, /Resting HR/u);
  assert.doesNotMatch(serializedImageTree, /Hidden overflow/u);
});

test("experiment share-card POST rejects invalid body data without asset reads", async () => {
  const { POST } = await import("../app/(dashboard)/experiments/[experimentId]/card/route");
  const response = await POST(
    new Request("https://example.test/experiments/example/card", {
      body: JSON.stringify({ title: "Missing signals" }),
      headers: {
        "Content-Type": "application/json",
        Origin: "https://example.test",
      },
      method: "POST",
    }),
  );

  assert.equal(response.status, 400);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(await response.text(), "Invalid or missing card data.");
  expect(mocks.imageResponse).not.toHaveBeenCalled();
  expect(mocks.readFile).not.toHaveBeenCalled();
});

test("experiment share-card POST rejects oversized private card data", async () => {
  const { POST } = await import("../app/(dashboard)/experiments/[experimentId]/card/route");
  const response = await POST(
    new Request("https://example.test/experiments/example/card", {
      body: JSON.stringify({
        signals: [],
        title: "x".repeat(65 * 1024),
      }),
      headers: {
        "Content-Type": "application/json",
        Origin: "https://example.test",
      },
      method: "POST",
    }),
  );

  assert.equal(response.status, 413);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  expect(mocks.imageResponse).not.toHaveBeenCalled();
  expect(mocks.readFile).not.toHaveBeenCalled();
});

test("experiment share-card POST checks same-origin before authenticating", async () => {
  mocks.assertHostedOnboardingMutationOrigin.mockImplementationOnce(() => {
    throw hostedOnboardingError({
      code: "HOSTED_ONBOARDING_ORIGIN_REQUIRED",
      httpStatus: 403,
      message: "Hosted browser mutation routes require an Origin header.",
    });
  });
  const { POST } = await import("../app/(dashboard)/experiments/[experimentId]/card/route");

  const response = await POST(
    new Request("https://example.test/experiments/example/card", {
      body: JSON.stringify({ title: "Private", signals: [] }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );

  assert.equal(response.status, 403);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  expect(mocks.requireActiveHostedAppSessionFromRequest).not.toHaveBeenCalled();
  expect(mocks.imageResponse).not.toHaveBeenCalled();
  expect(mocks.readFile).not.toHaveBeenCalled();
});

test("experiment progress-card GET is a no-store tombstone", async () => {
  const { GET } = await import("../app/(dashboard)/experiments/[experimentId]/progress-card/[payload]/route");

  const response = await GET();

  assert.equal(response.status, 410);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(
    await response.text(),
    "URL-encoded experiment progress cards are no longer available.",
  );
  expect(mocks.imageResponse).not.toHaveBeenCalled();
  expect(mocks.readFile).not.toHaveBeenCalled();
});

function getImageResponseCall(): [unknown, MockImageResponseInit] {
  const call = mocks.imageResponse.mock.calls[0];
  assert.ok(call, "Expected ImageResponse to be constructed.");
  const [imageTree, init] = call;
  assertImageResponseInit(init);
  return [imageTree, init];
}

function assertImageResponseInit(value: unknown): asserts value is MockImageResponseInit {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
}

function headersInitToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return headers;
}
