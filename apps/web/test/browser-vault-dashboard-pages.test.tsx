import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, test, vi } from "vitest";

import {
  createBrowserVaultQueryClient,
  createBrowserVaultReplica,
  createVaultReadModel,
  type BrowserVaultMetricRow,
} from "@murphai/query/browser";

const mocks = vi.hoisted(() => ({
  useBrowserVault: vi.fn(),
}));

vi.mock("@/src/lib/browser-vault/context", () => ({
  BrowserVaultProvider: ({ children }: { children: React.ReactNode }) => children,
  useBrowserVault: mocks.useBrowserVault,
}));

import ExperimentsPage, { metadata as experimentsMetadata } from "../app/(dashboard)/experiments/page";
import HistoryPage from "../app/(dashboard)/history/page";
import { metadata as historyMetadata } from "../app/(dashboard)/history/layout";
import OverviewPage from "../app/(dashboard)/overview/page";
import { metadata as overviewMetadata } from "../app/(dashboard)/overview/layout";
import SignalsPage from "../app/(dashboard)/signals/page";
import { metadata as signalsMetadata } from "../app/(dashboard)/signals/layout";

type BrowserVaultEntity = Parameters<typeof createVaultReadModel>[0]["entities"][number];

let clientFixture: Awaited<ReturnType<typeof createFixtureClient>>;

beforeEach(async () => {
  clientFixture = await createFixtureClient();
  mocks.useBrowserVault.mockReturnValue({
    client: clientFixture,
    dataVersion: clientFixture.replica.source.dataVersion,
    error: null,
    ref: null,
    refreshPending: false,
    refresh: async () => {},
    status: "ready",
  });
});

test("dashboard routes define page-specific metadata with the shared preview image", () => {
  assert.equal(overviewMetadata.title, "Overview — Murph");
  assert.equal(
    overviewMetadata.description,
    "A quick read on your recent notes, experiments, and tracked trends.",
  );
  assert.equal(historyMetadata.title, "History — Murph");
  assert.equal(
    historyMetadata.description,
    "Recent notes, events, assessments, and daily summaries from your vault.",
  );
  assert.equal(signalsMetadata.title, "Signals — Murph");
  assert.equal(
    signalsMetadata.description,
    "Sleep, recovery, activity, and body metrics from connected health data.",
  );
  assert.equal(experimentsMetadata.title, "Experiments — Murph");
  assert.equal(
    experimentsMetadata.description,
    "Browse evidence-backed health experiments and compare what changes against your own baseline.",
  );

  for (const routeMetadata of [
    overviewMetadata,
    historyMetadata,
    signalsMetadata,
    experimentsMetadata,
  ]) {
    assert.deepEqual(routeMetadata.openGraph?.images, [
      {
        alt: "Murph — Wearable data, made useful.",
        height: 630,
        type: "image/png",
        url: "/opengraph-image",
        width: 1200,
      },
    ]);
    assert.deepEqual(routeMetadata.twitter?.images, [
      {
        alt: "Murph — Wearable data, made useful.",
        height: 630,
        type: "image/png",
        url: "/opengraph-image",
        width: 1200,
      },
    ]);
  }
});

test("OverviewPage renders the dashboard overview", () => {
  const markup = renderToStaticMarkup(createElement(OverviewPage));

  assert.match(markup, /A quick read on your recent notes, experiments, and tracked trends\./);
  assert.match(markup, /Morning walk/);
  assert.match(markup, /Travel recovery note/);
  assert.match(markup, /Weekly sample deltas/);
});

test("OverviewPage counts all tracked experiments while listing the most recent ones", async () => {
  const activeExperiments = Array.from({ length: 25 }, (_, index) => {
    const day = String(30 - index).padStart(2, "0");
    return createEntity("experiment", `active_extra_${index}`, {
      body: `Active experiment ${index}.\n`,
      date: `2026-04-${day}`,
      experimentSlug: `active-extra-${index}`,
      occurredAt: `2026-04-${day}T08:00:00.000Z`,
      status: "active",
      title: `Active extra ${index}`,
    });
  });
  const overviewClient = await createFixtureClient({
    extraEntities: [
      ...activeExperiments,
      createEntity("experiment", "finished_old", {
        body: "Finished hydration experiment.\n",
        date: "2026-04-01",
        experimentSlug: "finished-hydration",
        occurredAt: "2026-04-01T08:00:00.000Z",
        status: "completed",
        title: "Finished hydration",
      }),
      createEntity("experiment", "paused_old", {
        body: "Paused experiment.\n",
        date: "2026-03-31",
        experimentSlug: "paused-baseline",
        occurredAt: "2026-03-31T08:00:00.000Z",
        status: "paused",
        title: "Paused baseline",
      }),
    ],
  });
  mocks.useBrowserVault.mockReturnValue({
    client: overviewClient,
    dataVersion: overviewClient.replica.source.dataVersion,
    error: null,
    ref: null,
    refresh: async () => {},
    status: "ready",
  });

  const markup = renderToStaticMarkup(createElement(OverviewPage));

  assert.match(markup, /Active now[\s\S]*>27<\/div>/);
  assert.match(markup, /Recently finished[\s\S]*>1<\/div>/);
  assert.match(markup, /Finished hydration started/);
  const recentExperimentsMarkup =
    markup.match(/Recent experiments[\s\S]*?Weekly sample deltas/)?.[0] ?? "";
  assert.match(recentExperimentsMarkup, /Active extra 0/);
  assert.doesNotMatch(recentExperimentsMarkup, /Finished hydration/);
  assert.doesNotMatch(recentExperimentsMarkup, /Paused baseline/);
});

test("HistoryPage renders recent timeline entries", () => {
  const markup = renderToStaticMarkup(createElement(HistoryPage));

  assert.match(markup, /Travel recovery note/);
  assert.match(markup, /Recent notes, events, assessments, and daily summaries/);
  assert.match(markup, /sleep_duration_minutes daily summary/);
  assert.doesNotMatch(markup, /history\/sample\/sample_1\.md/);
});

test("ExperimentsPage renders the public library with private browser-vault overlays", () => {
  const markup = renderToStaticMarkup(createElement(ExperimentsPage));

  assert.match(markup, /Browse the public protocol library\./);
  assert.match(markup, /Hyperbaric Oxygen Therapy/);
  assert.match(markup, /Finnish Dry Sauna/);
  assert.match(markup, /Morning walk/);
  assert.match(markup, /Private only run/);
  assert.doesNotMatch(markup, /with data/);
  assert.doesNotMatch(markup, /shown/);
  assert.match(markup, /Short walks are helping with afternoon energy\./);
});

test("ExperimentsPage keeps the public library visible when browser-vault is unauthenticated", () => {
  mocks.useBrowserVault.mockReturnValue({
    client: null,
    dataVersion: null,
    error: null,
    ref: null,
    refresh: async () => {},
    status: "ready",
  });

  const markup = renderToStaticMarkup(createElement(ExperimentsPage));

  assert.match(markup, /Finnish Dry Sauna/);
  assert.match(markup, /Hyperbaric Oxygen Therapy/);
  assert.match(markup, /Red Light Glasses Before Bed/);
  const featuredMarkup = markup.split("Browse all").at(0) ?? markup;
  assert.match(featuredMarkup, /Finnish Dry Sauna/);
  assert.match(featuredMarkup, /Norwegian 4x4/);
  assert.doesNotMatch(featuredMarkup, /Bryan Johnson Sauna/);
  assert.doesNotMatch(markup, /Could not load your experiment data/);
});

test("ExperimentsPage merges protocol-shaped private runs into the matching public protocol card", async () => {
  const protocolVariantClient = await createFixtureClient({
    experimentSlug: "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
  });
  mocks.useBrowserVault.mockReturnValue({
    client: protocolVariantClient,
    dataVersion: protocolVariantClient.replica.source.dataVersion,
    error: null,
    ref: null,
    refresh: async () => {},
    status: "ready",
  });

  const markup = renderToStaticMarkup(createElement(ExperimentsPage));

  assert.match(markup, /Finnish Dry Sauna/);
  assert.match(markup, /Started Apr 18, 2026 · 14 days · 150 studies/);
  assert.doesNotMatch(markup, /protocol_variant:dry-sauna\/murph-finnish-standard-3x-week/);
  assert.doesNotMatch(markup, /Morning walk/);
});

test("ExperimentsPage shows private-only tracked experiments as non-link cards", async () => {
  const clientWithPrivateOnlyExperiment = await createFixtureClient();
  mocks.useBrowserVault.mockReturnValue({
    client: clientWithPrivateOnlyExperiment,
    dataVersion: clientWithPrivateOnlyExperiment.replica.source.dataVersion,
    error: null,
    ref: null,
    refresh: async () => {},
    status: "ready",
  });

  const markup = renderToStaticMarkup(createElement(ExperimentsPage));

  assert.match(markup, /Private/);
  assert.match(markup, /<article[^>]*>[\s\S]*Private only run[\s\S]*Started Apr 19, 2026 · Private run only[\s\S]*Private run only[\s\S]*<\/article>/);
  assert.doesNotMatch(markup, /href="\/experiments\/private-only-run"/);
});

test("ExperimentsPage keeps the public library visible when browser-vault loading fails", () => {
  mocks.useBrowserVault.mockReturnValue({
    client: null,
    dataVersion: null,
    error: "The latest refresh failed.",
    ref: null,
    refresh: async () => {},
    status: "error",
  });

  const markup = renderToStaticMarkup(createElement(ExperimentsPage));

  assert.match(markup, /Private overlays could not be refreshed/);
  assert.match(markup, /The latest refresh failed\./);
  assert.match(markup, /The public experiment library is still available below\./);
  assert.match(markup, /Finnish Dry Sauna/);
  assert.match(markup, /Red Light Glasses Before Bed/);
});

test("OverviewPage preserves stale data when a refresh fails", () => {
  mocks.useBrowserVault.mockReturnValue({
    client: clientFixture,
    dataVersion: clientFixture.replica.source.dataVersion,
    error: "The latest refresh failed.",
    ref: null,
    refresh: async () => {},
    status: "error",
  });

  const markup = renderToStaticMarkup(createElement(OverviewPage));

  assert.match(markup, /Could not load your overview/);
  assert.match(markup, /The latest refresh failed\./);
  assert.match(markup, /Morning walk/);
  assert.match(markup, /Travel recovery note/);
});

test("SignalsPage renders the empty signals state", () => {
  const markup = renderToStaticMarkup(createElement(SignalsPage));

  assert.match(markup, /No wearable signals yet/);
  assert.match(markup, /Connect a source or sync more recent data/i);
});

test("dashboard empty pages show preparing copy while a replica refresh is pending", () => {
  mocks.useBrowserVault.mockReturnValue({
    client: null,
    dataVersion: null,
    error: null,
    ref: null,
    refreshPending: true,
    refresh: async () => {},
    status: "empty",
  });

  const overviewMarkup = renderToStaticMarkup(createElement(OverviewPage));
  const historyMarkup = renderToStaticMarkup(createElement(HistoryPage));
  const signalsMarkup = renderToStaticMarkup(createElement(SignalsPage));

  assert.match(overviewMarkup, /Preparing overview\./);
  assert.match(overviewMarkup, /Preparing your dashboard/);
  assert.match(overviewMarkup, /role="status"/);
  assert.match(overviewMarkup, /aria-live="polite"/);
  assert.doesNotMatch(overviewMarkup, /Your dashboard is ready for data/);
  assert.doesNotMatch(overviewMarkup, /No overview available yet/);

  assert.match(historyMarkup, /Preparing timeline\./);
  assert.match(historyMarkup, /Preparing your timeline/);
  assert.match(historyMarkup, /role="status"/);
  assert.match(historyMarkup, /aria-live="polite"/);
  assert.doesNotMatch(historyMarkup, /No timeline entries yet/);
  assert.doesNotMatch(historyMarkup, /No history available yet/);

  assert.match(signalsMarkup, /Preparing signals\./);
  assert.match(signalsMarkup, /Preparing your signals/);
  assert.match(signalsMarkup, /role="status"/);
  assert.match(signalsMarkup, /aria-live="polite"/);
  assert.doesNotMatch(signalsMarkup, /No wearable signals yet/);
  assert.doesNotMatch(signalsMarkup, /No signals available yet/);
});

test("SignalsPage renders secondary-only signal days and body-state history", async () => {
  const signalClient = await createFixtureClient({
    metricRows: [
      createMetricRow({
        confidence: "high",
        date: "2026-04-20",
        id: "metric-row:sleep-score:2026-04-20",
        metricKey: "sleep-score",
        observedAt: "2026-04-20T08:00:00.000Z",
        unit: null,
        value: 86,
      }),
      createMetricRow({
        confidence: "medium",
        date: "2026-04-20",
        id: "metric-row:body-weight:2026-04-20",
        metricKey: "body-weight",
        observedAt: "2026-04-20T08:00:00.000Z",
        unit: "lb",
        value: 170,
      }),
      createMetricRow({
        confidence: "medium",
        date: "2026-04-20",
        id: "metric-row:body-fat-percentage:2026-04-20",
        metricKey: "body-fat-percentage",
        observedAt: "2026-04-20T08:00:00.000Z",
        unit: "%",
        value: 18,
      }),
    ],
  });
  mocks.useBrowserVault.mockReturnValue({
    client: signalClient,
    dataVersion: signalClient.replica.source.dataVersion,
    error: null,
    ref: null,
    refresh: async () => {},
    status: "ready",
  });

  const markup = renderToStaticMarkup(createElement(SignalsPage));

  assert.match(markup, /Recent sleep[\s\S]*86/);
  assert.match(markup, /Recent body state[\s\S]*170 lb/);
  assert.match(markup, /Body fat 18 %/);
});

test("OverviewPage renders an error state instead of an empty state when the hosted snapshot is unavailable", () => {
  mocks.useBrowserVault.mockReturnValue({
    client: null,
    dataVersion: null,
    error: "Your dashboard data is not available right now.",
    ref: null,
    refresh: async () => {},
    status: "error",
  });

  const markup = renderToStaticMarkup(createElement(OverviewPage));

  assert.match(markup, /Could not load your overview/);
  assert.match(markup, /Your dashboard data is not available right now\./);
  assert.doesNotMatch(markup, /Your dashboard is ready for data/);
});

function createEntity(
  family: BrowserVaultEntity["family"],
  entityId: string,
  overrides: Partial<BrowserVaultEntity> = {},
): BrowserVaultEntity {
  const title = overrides.title ?? entityId;
  const kind = overrides.kind ?? `${family}_entry`;
  const stream = overrides.stream ?? null;
  const lookupId = overrides.primaryLookupId ?? entityId;

  return {
    attributes: overrides.attributes ?? {},
    body: overrides.body ?? null,
    date: overrides.date ?? "2026-04-20",
    entityId,
    experimentSlug: overrides.experimentSlug ?? null,
    family,
    frontmatter: overrides.frontmatter ?? null,
    kind,
    links: overrides.links ?? [],
    lookupIds: overrides.lookupIds ?? [lookupId],
    occurredAt: overrides.occurredAt ?? "2026-04-20T00:00:00.000Z",
    path: overrides.path ?? `history/${family}/${entityId}.md`,
    primaryLookupId: lookupId,
    recordClass: overrides.recordClass ?? resolveRecordClass(family),
    relatedIds: overrides.relatedIds ?? [],
    status: overrides.status ?? null,
    stream,
    tags: overrides.tags ?? [],
    title,
  };
}

async function createFixtureClient(input: {
  experimentSlug?: string;
  extraEntities?: BrowserVaultEntity[];
  metricRows?: BrowserVaultMetricRow[];
} = {}) {
  const replica = await createBrowserVaultReplica({
    metricPoints: [],
    generatedAt: "2026-04-20T12:00:00.000Z",
    sourceBundleHash: "fixture-source",
    vault: createVaultReadModel({
      entities: [
        createEntity("experiment", "exp_1", {
          body: "Short walks are helping with afternoon energy.\n",
          frontmatter: {
            summary: "Short walks are helping with afternoon energy.",
          } satisfies NonNullable<BrowserVaultEntity["frontmatter"]>,
          date: "2026-04-18",
          experimentSlug: input.experimentSlug ?? "light-morning-walk",
          occurredAt: "2026-04-18T08:00:00.000Z",
          status: "active",
          tags: ["movement"],
          title: "Morning walk",
        }),
        createEntity("experiment", "exp_private_only", {
          body: "This experiment only exists in browser vault state.\n",
          date: "2026-04-19",
          experimentSlug: "private-only-run",
          occurredAt: "2026-04-19T08:00:00.000Z",
          status: "active",
          tags: ["breathwork"],
          title: "Private only run",
        }),
        createEntity("journal", "journal_1", {
          body: "# Note\n\nFelt steadier after a full night of sleep.\n",
          date: "2026-04-20",
          occurredAt: "2026-04-20T07:30:00.000Z",
          tags: ["sleep", "travel"],
          title: "Travel recovery note",
        }),
        createEntity("sample", "sample_1", {
          attributes: {
            metric: "sleep_duration_minutes",
            source: "manual",
            unit: "min",
            value: 430,
          },
          date: "2026-04-20",
          kind: "metric_sample",
          occurredAt: "2026-04-20T08:30:00.000Z",
          stream: "sleep_duration_minutes",
          title: "Sleep duration",
        }),
        createEntity("sample", "sample_2", {
          attributes: {
            metric: "sleep_duration_minutes",
            source: "manual",
            unit: "min",
            value: 400,
          },
          date: "2026-04-13",
          kind: "metric_sample",
          occurredAt: "2026-04-13T08:30:00.000Z",
          stream: "sleep_duration_minutes",
          title: "Sleep duration",
        }),
        ...(input.extraEntities ?? []),
      ],
      metadata: {
        title: "Browser vault fixture",
      },
      vaultRoot: "browser://vault",
    }),
  });

  return createBrowserVaultQueryClient({
    ...replica,
    metricRows: [
      ...replica.metricRows,
      ...(input.metricRows ?? []),
    ],
  });
}

function createMetricRow(
  input: Pick<BrowserVaultMetricRow, "date" | "id" | "metricKey" | "observedAt" | "unit" | "value">
    & Partial<BrowserVaultMetricRow>,
): BrowserVaultMetricRow {
  return {
    biomarkerKey: input.biomarkerKey ?? null,
    confidence: input.confidence ?? "none",
    context: input.context ?? {},
    date: input.date,
    grain: input.grain ?? "day",
    id: input.id,
    metricKey: input.metricKey,
    observedAt: input.observedAt,
    pointIds: input.pointIds ?? [],
    recordIds: input.recordIds ?? [],
    rowSchema: "murph.browser-vault.metric-row.v1",
    sourceFamily: input.sourceFamily ?? null,
    sourceKind: input.sourceKind ?? null,
    sourceLabel: input.sourceLabel ?? null,
    statistic: input.statistic ?? "value",
    unit: input.unit,
    value: input.value,
    valueLabel: input.valueLabel ?? null,
  };
}

function resolveRecordClass(family: BrowserVaultEntity["family"]): BrowserVaultEntity["recordClass"] {
  switch (family) {
    case "experiment":
      return "bank";
    case "journal":
      return "ledger";
    case "sample":
      return "sample";
    default:
      throw new Error(`Unsupported browser-vault test family: ${family}`);
  }
}
