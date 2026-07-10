import assert from "node:assert/strict";

import { afterEach, expect, test, vi } from "vitest";

const { imageResponseSpy, readFileMock } = vi.hoisted(() => ({
  imageResponseSpy: vi.fn(),
  readFileMock: vi.fn(async (path: string | URL) => {
    const value = String(path);
    if (value.includes("Fraunces-400.ttf")) return Buffer.from([1, 2, 3]);
    if (value.includes("Fraunces-600.ttf")) return Buffer.from([4, 5, 6]);
    if (value.includes("DMSans-400.ttf")) return Buffer.from([7, 8, 9]);
    if (value.endsWith("public/logo.svg")) return Buffer.from("<svg />");
    throw new Error("Unexpected experiment card asset read.");
  }),
}));

type MockImageResponseInit = {
  fonts?: Array<{ data: ArrayBuffer; name: string; weight: number }>;
  headers?: HeadersInit;
  height?: number;
  width?: number;
};

vi.mock("node:fs/promises", () => ({
  readFile: readFileMock,
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
      imageResponseSpy(input, init);
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

afterEach(() => {
  imageResponseSpy.mockClear();
  readFileMock.mockClear();
});

test("listVisibleConnectSources covers every hosted-visible device source with UI metadata", async () => {
  const { listVisibleConnectSources } = await import("../app/(dashboard)/connect/page");
  const { DEVICE_CONNECT_SOURCES } = await import("@murphai/device-syncd/connect-config");

  const expectedVisibleSourceIds = DEVICE_CONNECT_SOURCES
    .filter((source) =>
      source.connectSourceId === "apple-health"
      || source.routes.some((route) => route.kind === "direct" || route.kind === "junction_link"),
    )
    .map((source) => source.connectSourceId)
    .sort();

  const actualVisibleSources = listVisibleConnectSources();
  const actualVisibleSourceIds = actualVisibleSources.map((source) => source.id).sort();

  assert.deepEqual(actualVisibleSourceIds, expectedVisibleSourceIds);

  const sourceIdsWithMissingUi = actualVisibleSources
    .filter((source) => !source.name || !source.description || !source.logo.src)
    .map((source) => source.id);
  assert.deepEqual(sourceIdsWithMissingUi, []);
});

test("experiment share-card route rejects missing card data", async () => {
  const { GET } = await import("../app/(dashboard)/experiments/[experimentId]/card/route");

  const response = await GET(new Request("https://example.test/experiments/example/card"));

  assert.equal(response.status, 400);
  assert.equal(await response.text(), "Invalid or missing card data.");
  expect(imageResponseSpy).not.toHaveBeenCalled();
  expect(readFileMock).not.toHaveBeenCalled();
});

test("experiment share-card route rejects invalid encoded card data", async () => {
  const { EXPERIMENT_CARD_PARAM } = await import("@/src/lib/experiments/share-card");
  const { GET } = await import("../app/(dashboard)/experiments/[experimentId]/card/route");

  const response = await GET(
    new Request(`https://example.test/experiments/example/card?${EXPERIMENT_CARD_PARAM}=not-json`),
  );

  assert.equal(response.status, 400);
  assert.equal(await response.text(), "Invalid or missing card data.");
  expect(imageResponseSpy).not.toHaveBeenCalled();
  expect(readFileMock).not.toHaveBeenCalled();
});

test("experiment share-card route renders a valid encoded card snapshot", async () => {
  const {
    encodeExperimentCardData,
    EXPERIMENT_CARD_MAX_SIGNALS,
    EXPERIMENT_CARD_PARAM,
  } = await import("@/src/lib/experiments/share-card");
  const { GET } = await import("../app/(dashboard)/experiments/[experimentId]/card/route");

  const encodedCardData = encodeExperimentCardData({
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
  });

  const response = await GET(
    new Request(`https://example.test/experiments/example/card?${EXPERIMENT_CARD_PARAM}=${encodedCardData}`),
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "image/png");
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
  expect(readFileMock).toHaveBeenCalledTimes(4);

  expect(imageResponseSpy).toHaveBeenCalledTimes(1);
  const [imageTree, init] = getImageResponseCall();
  assert.equal(init.width, 1200);
  assert.equal(init.height, 780);
  assert.equal(headersInitToRecord(init.headers)["Cache-Control"], "public, max-age=31536000, immutable");
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
  assert.equal((serializedImageTree.match(/label/gu)?.length ?? 0) >= EXPERIMENT_CARD_MAX_SIGNALS, true);
});

test("experiment progress-card route returns a static-like PNG response for media fetchers", async () => {
  const {
    EXPERIMENT_PROGRESS_CARD_VERSION,
    buildExperimentProgressCardPath,
  } = await import("@murphai/contracts");
  const { GET } = await import("../app/(dashboard)/experiments/[experimentId]/progress-card/[payload]/route");

  const path = buildExperimentProgressCardPath(
    "exp_01JNV4458HYPP53JDQCBP1QJFM",
    {
      v: EXPERIMENT_PROGRESS_CARD_VERSION,
      title: "Bedtime silent meditation",
      asOf: "2026-06-16",
      phase: { day: 19, totalDays: 21 },
      sessions: { logged: 5, assumed: 2, target: null },
      weeks: [
        { start: "2026-06-05", cells: "CMAMMCP" },
        { start: "2026-06-12", cells: "MMCCSSS" },
      ],
      movers: [],
      confounders: [],
    },
  );
  const payload = path.split("/").at(-1);
  assert.ok(payload);

  const response = await GET(
    new Request(`https://example.test${path}`),
    { params: Promise.resolve({ payload }) },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "image/png");
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
  assert.equal(response.headers.get("Content-Disposition"), 'inline; filename="experiment-progress-card.png"');
  assert.equal(response.headers.get("Content-Length"), String(Buffer.byteLength("mock image")));
  assert.equal(await response.text(), "mock image");
  expect(readFileMock).toHaveBeenCalledTimes(4);

  expect(imageResponseSpy).toHaveBeenCalledTimes(1);
  const [imageTree, init] = getImageResponseCall();
  assert.equal(init.width, 1200);
  assert.equal(init.height, 630);
  assert.equal(headersInitToRecord(init.headers)["Cache-Control"], "public, max-age=31536000, immutable");
  const serializedImageTree = JSON.stringify(renderReactTree(imageTree));
  assert.match(serializedImageTree, /Bedtime silent meditation/u);
  assert.match(serializedImageTree, /5 done \(2 assumed\)/u);
  assert.doesNotMatch(serializedImageTree, /5 logged \(2 assumed\)/u);
  assert.match(serializedImageTree, /rgba\(90,110,50,0\.18\)/u);
});

function getImageResponseCall(): [unknown, MockImageResponseInit] {
  const call = imageResponseSpy.mock.calls[0];
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

function renderReactTree(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(renderReactTree);
  }
  if (!isRecord(value)) {
    return value;
  }

  const type = value.type;
  const props = isRecord(value.props) ? value.props : {};
  if (typeof type === "function") {
    const render = type as (props: Record<string, unknown>) => unknown;
    return renderReactTree(render(props));
  }

  return {
    type: typeof type === "string" ? type : String(type),
    props,
    children: renderReactTree(props.children),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
