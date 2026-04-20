import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, test, vi } from "vitest";

import { createBrowserVaultSnapshot, createVaultReadModel } from "@murphai/query/browser";

const mocks = vi.hoisted(() => ({
  useBrowserVault: vi.fn(),
}));

vi.mock("@/src/lib/browser-vault/context", () => ({
  useBrowserVault: mocks.useBrowserVault,
}));

import ExperimentsPage from "../app/(dashboard)/experiments/page";
import HistoryPage from "../app/(dashboard)/history/page";
import OverviewPage from "../app/(dashboard)/overview/page";
import SignalsPage from "../app/(dashboard)/signals/page";

type BrowserVaultEntity = Parameters<typeof createVaultReadModel>[0]["entities"][number];

const snapshotFixture = createBrowserVaultSnapshot({
  generatedAt: "2026-04-20T12:00:00.000Z",
  sourceVersion: "snapshot-source",
  vault: createVaultReadModel({
    entities: [
      createEntity("experiment", "exp_1", {
        body: "# Trial\n\nShort walks are helping with afternoon energy.\n",
        date: "2026-04-18",
        experimentSlug: "light-morning-walk",
        occurredAt: "2026-04-18T08:00:00.000Z",
        status: "active",
        tags: ["movement"],
        title: "Morning walk",
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

beforeEach(() => {
  mocks.useBrowserVault.mockReturnValue({
    error: null,
    refresh: async () => {},
    snapshot: snapshotFixture,
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

test("ExperimentsPage renders tracked experiments", () => {
  const markup = renderToStaticMarkup(createElement(ExperimentsPage));

  assert.match(markup, /tracked experiments/i);
  assert.match(markup, /Morning walk/);
  assert.match(markup, /Short walks are helping with afternoon energy\./);
});

test("SignalsPage renders the empty signals state", () => {
  const markup = renderToStaticMarkup(createElement(SignalsPage));

  assert.match(markup, /No wearable signals yet/);
  assert.match(markup, /Connect a source or sync more recent data/i);
});

test("OverviewPage renders an error state instead of an empty state when the hosted snapshot is unavailable", () => {
  mocks.useBrowserVault.mockReturnValue({
    error: "Your dashboard data is not available right now.",
    refresh: async () => {},
    snapshot: null,
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
