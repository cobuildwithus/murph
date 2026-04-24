import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, test, vi } from "vitest";

import {
  createBrowserVaultQueryClient,
  createBrowserVaultReplica,
  createVaultReadModel,
} from "@murphai/query/browser";

const mocks = vi.hoisted(() => ({
  useBrowserVault: vi.fn(),
}));

vi.mock("@/src/lib/browser-vault/context", () => ({
  BrowserVaultProvider: ({ children }: { children: React.ReactNode }) => children,
  useBrowserVault: mocks.useBrowserVault,
}));

import ExperimentsPage from "../app/(dashboard)/experiments/page";
import HistoryPage from "../app/(dashboard)/history/page";
import OverviewPage from "../app/(dashboard)/overview/page";
import SignalsPage from "../app/(dashboard)/signals/page";

type BrowserVaultEntity = Parameters<typeof createVaultReadModel>[0]["entities"][number];

let clientFixture: Awaited<ReturnType<typeof createFixtureClient>>;

beforeEach(async () => {
  clientFixture = await createFixtureClient();
  mocks.useBrowserVault.mockReturnValue({
    client: clientFixture,
    dataVersion: clientFixture.replica.source.dataVersion,
    error: null,
    ref: null,
    refresh: async () => {},
    status: "ready",
  });
});

test("OverviewPage renders the dashboard overview", () => {
  const markup = renderToStaticMarkup(createElement(OverviewPage));

  assert.match(markup, /A quick read on your recent notes, experiments, and tracked trends\./);
  assert.match(markup, /Morning walk/);
  assert.match(markup, /Travel recovery note/);
  assert.match(markup, /Weekly sample deltas/);
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

  assert.match(markup, /Browse the public library\. When Murph has browser-vault data, your private run state appears on the matching cards\./);
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
  assert.match(markup, /Red-Light Glasses Before Bed/);
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
  assert.match(markup, /Started Apr 18, 2026 · 14 days · 93 studies/);
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
  assert.match(markup, /Red-Light Glasses Before Bed/);
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
} = {}) {
  const replica = await createBrowserVaultReplica({
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
            unit: "min",
            value: 430,
          },
          date: "2026-04-20",
          occurredAt: "2026-04-20T08:30:00.000Z",
          stream: "sleep_duration_minutes",
          title: "Sleep duration",
        }),
        createEntity("sample", "sample_2", {
          attributes: {
            unit: "min",
            value: 400,
          },
          date: "2026-04-13",
          occurredAt: "2026-04-13T08:30:00.000Z",
          stream: "sleep_duration_minutes",
          title: "Sleep duration",
        }),
      ],
      metadata: {
        title: "Browser vault fixture",
      },
      vaultRoot: "browser://vault",
    }),
  });

  return createBrowserVaultQueryClient(replica);
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
