import assert from "node:assert/strict";
import { access } from "node:fs/promises";

import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, test, vi } from "vitest";

import {
  createBrowserVaultQueryClient,
  createBrowserVaultReplica,
  createVaultReadModel,
} from "@murphai/query/browser";
import { listHealthCommonsExperimentBrowseProtocols } from "@/src/lib/health-commons/experiment-browse";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(async () => undefined),
  resolveHostedMurphContactOptions: vi.fn(),
  useBrowserVault: vi.fn(),
}));

vi.mock("@/src/components/murph/hosted-murph-contact-action", () => ({
  resolveHostedMurphContactOptions: mocks.resolveHostedMurphContactOptions,
}));

vi.mock("@/src/lib/browser-vault/context", () => ({
  BrowserVaultProvider: ({ children }: { children: React.ReactNode }) =>
    children,
  useBrowserVault: mocks.useBrowserVault,
}));

import { metadata as experimentsMetadata } from "../app/(dashboard)/experiments/page";
import { ExperimentsPageClient } from "../app/(dashboard)/experiments/experiments-page-client";
import { metadata as environmentMetadata } from "../app/(dashboard)/environment/page";
import EnvironmentPage from "../app/(dashboard)/environment/page";
import { EnvironmentPrintPageClient } from "../app/(dashboard)/environment/print/environment-print-page-client";
import HistoryPageClient from "../app/(dashboard)/history/history-page-client";
import { metadata as historyMetadata } from "../app/(dashboard)/history/layout";
import OverviewPageClient from "../app/(dashboard)/overview/overview-page-client";
import { metadata as overviewMetadata } from "../app/(dashboard)/overview/layout";
import PatternsPageClient from "../app/(dashboard)/patterns/patterns-page-client";
import { metadata as patternsMetadata } from "../app/(dashboard)/patterns/layout";
import { EnvironmentPrintStudy } from "../app/design/environment-print-study";
import { PersonalPatternsComponentStudy } from "../app/design/personal-patterns-study";
import { renderClientComponent } from "./render-client-component";

type BrowserVaultEntity = Parameters<
  typeof createVaultReadModel
>[0]["entities"][number];

let clientFixture: Awaited<ReturnType<typeof createFixtureClient>>;
const experimentProtocols = listHealthCommonsExperimentBrowseProtocols();

beforeEach(async () => {
  clientFixture = await createFixtureClient();
  mocks.refresh.mockClear();
  mocks.resolveHostedMurphContactOptions.mockResolvedValue([
    {
      href: "sms:+15555550100?body=I%20want%20to%20update%20my%20environment.",
      kind: "text",
      label: "Text Murph",
    },
  ]);
  mocks.useBrowserVault.mockReturnValue({
    client: clientFixture,
    dataVersion: clientFixture.replica.source.dataVersion,
    error: null,
    ref: null,
    refreshPending: false,
    refresh: mocks.refresh,
    status: "ready",
  });
});

test("dashboard routes define page-specific metadata with the shared preview image", () => {
  assert.equal(overviewMetadata.title, "Overview — Murph");
  assert.equal(
    overviewMetadata.description,
    "A quick read on your recent notes, experiments, and tracked trends.",
  );
  assert.equal(patternsMetadata.title, "Patterns — Murph");
  assert.equal(
    patternsMetadata.description,
    "See which repeated actions and next-day outcomes tend to move together.",
  );
  assert.equal(historyMetadata.title, "History — Murph");
  assert.equal(
    historyMetadata.description,
    "Recent notes, events, assessments, and daily summaries.",
  );
  assert.equal(experimentsMetadata.title, "Experiments — Murph");
  assert.equal(
    experimentsMetadata.description,
    "Browse evidence-backed health experiments and compare what changes against your own baseline.",
  );
  assert.equal(environmentMetadata.title, "Environment — Murph");
  assert.equal(
    environmentMetadata.description,
    "What Murph knows about your home, and what to check next.",
  );

  const environmentImage = {
    alt: "Map your environment with Murph",
    height: 630,
    type: "image/png",
    url: "/environment/opengraph-image",
    width: 1200,
  };
  assert.deepEqual(environmentMetadata.openGraph?.images, [environmentImage]);
  assert.deepEqual(environmentMetadata.twitter?.images, [environmentImage]);

  for (const routeMetadata of [
    overviewMetadata,
    patternsMetadata,
    historyMetadata,
    experimentsMetadata,
  ]) {
    assert.deepEqual(routeMetadata.openGraph?.images, [
      {
        alt: "Health is hard. Don’t do it alone.",
        height: 630,
        type: "image/png",
        url: "/opengraph-image",
        width: 1200,
      },
    ]);
    assert.deepEqual(routeMetadata.twitter?.images, [
      {
        alt: "Health is hard. Don’t do it alone.",
        height: 630,
        type: "image/png",
        url: "/opengraph-image",
        width: 1200,
      },
    ]);
  }
});

test("dashboard no longer ships a signals app route", async () => {
  await assert.rejects(
    access(new URL("../app/(dashboard)/signals/page.tsx", import.meta.url)),
    { code: "ENOENT" },
  );
  await assert.rejects(
    access(new URL("../app/(dashboard)/signals/layout.tsx", import.meta.url)),
    { code: "ENOENT" },
  );
});

test("OverviewPage renders the dashboard overview", () => {
  const markup = renderToStaticMarkup(createElement(OverviewPageClient));

  assert.match(
    markup,
    /A quick read on your recent notes, experiments, and tracked trends\./,
  );
  assert.match(markup, /Morning walk/);
  assert.match(markup, /Travel recovery note/);
  assert.doesNotMatch(markup, /What tends to move together/);
  assert.match(markup, /Weekly changes/);
});

test("PatternsPage renders personal comparisons on their own route", () => {
  const markup = renderToStaticMarkup(createElement(PatternsPageClient));

  assert.match(markup, /Personal patterns/);
  assert.match(markup, /What tends to move together/);
  assert.match(markup, /No clear comparison is ready yet/);
  assert.doesNotMatch(markup, /Weekly changes/);
});

test("Personal Patterns comparison controls name their factor and next-day outcome", () => {
  const markup = renderToStaticMarkup(createElement(PersonalPatternsComponentStudy));

  assert.match(markup, /aria-label="Running, next-day HRV\./);
  assert.match(markup, /aria-label="Sauna, next-day Total sleep\./);
  assert.match(markup, /data-patterns-layout="mobile"/u);
  assert.match(markup, /data-patterns-layout="desktop"/u);
  assert.match(markup, />14 days</u);
  assert.doesNotMatch(markup, /Scroll sideways/u);
});

test("PatternsPage explains the bounded wait when a legacy replica has no patterns projection", async () => {
  const legacyReplica = { ...clientFixture.replica };
  delete legacyReplica.personalPatterns;
  const legacyClient = createBrowserVaultQueryClient(legacyReplica);
  mocks.useBrowserVault.mockReturnValue({
    client: legacyClient,
    dataVersion: legacyClient.replica.source.dataVersion,
    error: null,
    ref: null,
    refreshPending: false,
    refresh: mocks.refresh,
    status: "ready",
  });
  const rendered = await renderClientComponent(
    createElement(PatternsPageClient),
    { requireButton: false },
  );

  try {
    assert.match(rendered.container.textContent ?? "", /Patterns are getting ready/u);
    assert.match(rendered.container.textContent ?? "", /within 24 hours/u);
    assert.doesNotMatch(rendered.container.textContent ?? "", /No clear comparison is ready/u);
    assert.doesNotMatch(rendered.container.textContent ?? "", /Refresh now/u);
  } finally {
    await rendered.cleanup();
  }
});

test("PatternsPage keeps a legacy replica in the preparing state during refresh", () => {
  const legacyReplica = { ...clientFixture.replica };
  delete legacyReplica.personalPatterns;
  const legacyClient = createBrowserVaultQueryClient(legacyReplica);
  mocks.useBrowserVault.mockReturnValue({
    client: legacyClient,
    dataVersion: legacyClient.replica.source.dataVersion,
    error: null,
    ref: null,
    refreshPending: true,
    refresh: mocks.refresh,
    status: "ready",
  });
  const markup = renderToStaticMarkup(createElement(PatternsPageClient));

  assert.match(markup, /Preparing your patterns/u);
  assert.doesNotMatch(markup, /No clear comparison is ready/u);
});

test("PatternsPage exposes the existing retry action after a load failure", async () => {
  mocks.useBrowserVault.mockReturnValue({
    client: null,
    dataVersion: null,
    error: "The private replica could not be opened.",
    ref: null,
    refreshPending: false,
    refresh: mocks.refresh,
    status: "error",
  });
  const rendered = await renderClientComponent(createElement(PatternsPageClient));

  try {
    assert.match(rendered.container.textContent ?? "", /Could not load your patterns/u);
    const retryButton = [...rendered.container.querySelectorAll("button")].find(
      (button) => button.textContent === "Retry",
    );
    assert.ok(retryButton);
    await act(async () => {
      retryButton.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
    });
    assert.equal(mocks.refresh.mock.calls.length, 1);
  } finally {
    await rendered.cleanup();
  }
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

  const markup = renderToStaticMarkup(createElement(OverviewPageClient));

  assert.match(markup, /Active now[\s\S]*>27<\/div>/);
  assert.match(markup, /Recently finished[\s\S]*>1<\/div>/);
  assert.match(markup, /Finished hydration started/);
  const recentExperimentsMarkup =
    markup.match(/Recent experiments[\s\S]*?Weekly changes/)?.[0] ?? "";
  assert.match(recentExperimentsMarkup, /Active extra 0/);
  assert.doesNotMatch(recentExperimentsMarkup, /Finished hydration/);
  assert.doesNotMatch(recentExperimentsMarkup, /Paused baseline/);
});

test("HistoryPage renders recent timeline entries", () => {
  const markup = renderToStaticMarkup(createElement(HistoryPageClient));

  assert.match(markup, /Travel recovery note/);
  assert.match(
    markup,
    /Recent notes, events, assessments, and daily summaries/,
  );
  assert.match(markup, /sleep_duration_minutes daily summary/);
  assert.doesNotMatch(markup, /history\/sample\/sample_1\.md/);
});

test("EnvironmentPage renders private habitat facts from Browser Vault", async () => {
  const markup = renderToStaticMarkup(await EnvironmentPage());

  assert.match(markup, /Your environment/);
  assert.match(markup, /Environment grade/);
  assert.match(markup, /Murph knows 6 of 16/);
  assert.match(markup, /Lisbon/);
  assert.match(markup, /Not enough information for a fair grade/);
  assert.match(markup, /Air &amp; water/);
  assert.match(markup, /Night temperature/);
  assert.match(markup, /Recovery &amp; devices/);
  assert.match(markup, /href="\/environment\/print"/);
  assert.match(markup, /Print report/);
  assert.match(markup, /group\/category/);
  assert.doesNotMatch(markup, /fixture data|mock/i);
  assert.doesNotMatch(markup, /Overall picture/);
  assert.doesNotMatch(markup, /Target score/);
});

test("Environment print report renders the signed-in member's Browser Vault facts", () => {
  const markup = renderToStaticMarkup(
    createElement(EnvironmentPrintPageClient, {
      generatedOn: "July 31, 2026",
    }),
  );

  assert.match(markup, /Environment report/);
  assert.match(markup, /Private to you/);
  assert.match(markup, /Generated July 31, 2026/);
  assert.match(markup, /Lisbon/);
  assert.match(markup, /Night temperature/);
  assert.match(markup, /20°C/);
  assert.match(markup, /blackout/);
  assert.match(markup, /href="\/environment"/);
  assert.doesNotMatch(markup, /fixture data|mock/i);
});

test("Environment print report uses a report-shaped accessible loading state", () => {
  mocks.useBrowserVault.mockReturnValue({
    client: null,
    dataVersion: null,
    error: null,
    ref: null,
    refreshPending: false,
    refresh: mocks.refresh,
    status: "loading",
  });

  const markup = renderToStaticMarkup(
    createElement(EnvironmentPrintPageClient, {
      generatedOn: "July 31, 2026",
    }),
  );

  assert.match(markup, /data-environment-print-state="loading"/);
  assert.match(markup, /aria-busy="true"/);
  assert.match(markup, /aria-live="polite"/);
  assert.match(markup, /role="status"/);
  assert.match(markup, /Putting your report together/);
  assert.match(
    markup,
    /Opening your private records and arranging the printable view\./,
  );
  assert.match(markup, /Preparing/);
  assert.doesNotMatch(markup, /Unlocking your private Environment report/);

  const animatedCount = markup.match(/animate-pulse/g)?.length ?? 0;
  const motionSafeAnimatedCount =
    markup.match(/motion-safe:animate-pulse/g)?.length ?? 0;
  assert.ok(animatedCount > 0);
  assert.equal(motionSafeAnimatedCount, animatedCount);
});

test("Environment print design study renders the real loading and ready states", () => {
  const markup = renderToStaticMarkup(createElement(EnvironmentPrintStudy));

  assert.match(markup, /data-design-state="loading"/);
  assert.match(markup, /data-environment-print-state="loading"/);
  assert.match(markup, /data-design-state="ready"/);
  assert.match(markup, /data-environment-print-page="true"/);
});

test("EnvironmentPage gives zero-data members one clear start and previews the report", async () => {
  const emptyClient = await createFixtureClient({ includeHabitat: false });
  mocks.useBrowserVault.mockReturnValue({
    client: emptyClient,
    dataVersion: emptyClient.replica.source.dataVersion,
    error: null,
    ref: null,
    refreshPending: false,
    refresh: async () => {},
    status: "ready",
  });

  const markup = renderToStaticMarkup(await EnvironmentPage());

  assert.match(markup, /See how your home supports your sleep, air and focus/);
  assert.match(markup, /Start the 2-minute walkthrough/);
  assert.match(markup, /Prefer typing\? Use chat/);
  assert.match(markup, /Murph will turn the clear details/);
  assert.match(markup, /Your report will cover/);
  assert.match(markup, /class="flex w-full flex-col gap-10"/);
  assert.doesNotMatch(
    markup,
    /Missing answers and optional equipment never lower your grade/,
  );
  assert.match(markup, />Sleep</);
  assert.match(markup, /Air &amp; water/);
  assert.match(markup, /Recovery &amp; devices/);
  assert.match(markup, />Workspace</);
  assert.match(markup, /href="sms:\+15555550100\?body=/);
  assert.doesNotMatch(markup, /Environment grade/);
  assert.doesNotMatch(markup, /Coverage/);
  assert.doesNotMatch(markup, /What to check next/);
  assert.doesNotMatch(markup, /Not known/);
  assert.doesNotMatch(markup, />Share</);
  assert.doesNotMatch(markup, /t\.me|telegram/i);
});

test("ExperimentsPage renders the public library with private browser-vault overlays", () => {
  const markup = renderToStaticMarkup(createExperimentsPageClientElement());

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

  const markup = renderToStaticMarkup(createExperimentsPageClientElement());

  assert.match(markup, /Finnish Dry Sauna/);
  assert.match(markup, /Hyperbaric Oxygen Therapy/);
  assert.doesNotMatch(markup, /Red Light Glasses Before Bed/);
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

  const markup = renderToStaticMarkup(createExperimentsPageClientElement());

  assert.match(markup, /Finnish Dry Sauna/);
  assert.match(markup, /Started Apr 18, 2026 · 14 days · 150 studies/);
  assert.doesNotMatch(
    markup,
    /protocol_variant:dry-sauna\/murph-finnish-standard-3x-week/,
  );
  assert.doesNotMatch(markup, /Morning walk/);
});

test("ExperimentsPage links private-only tracked experiments to their private results", async () => {
  const clientWithPrivateOnlyExperiment = await createFixtureClient();
  mocks.useBrowserVault.mockReturnValue({
    client: clientWithPrivateOnlyExperiment,
    dataVersion: clientWithPrivateOnlyExperiment.replica.source.dataVersion,
    error: null,
    ref: null,
    refresh: async () => {},
    status: "ready",
  });

  const markup = renderToStaticMarkup(createExperimentsPageClientElement());

  assert.match(markup, /Private/);
  assert.match(markup, /href="\/experiments\/runs\/exp_private_only"/);
  assert.match(markup, /Private only run/);
  assert.match(markup, /Started Apr 19, 2026 · Private run only/);
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

  const markup = renderToStaticMarkup(createExperimentsPageClientElement());

  assert.match(markup, /Your experiments couldn/);
  assert.match(markup, /The latest refresh failed\./);
  assert.match(
    markup,
    /The public experiment library is still available below\./,
  );
  assert.match(markup, /Finnish Dry Sauna/);
  assert.doesNotMatch(markup, /Red Light Glasses Before Bed/);
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

  const markup = renderToStaticMarkup(createElement(OverviewPageClient));

  assert.match(markup, /Could not load your overview/);
  assert.match(markup, /The latest refresh failed\./);
  assert.match(markup, /Morning walk/);
  assert.match(markup, /Travel recovery note/);
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

  const overviewMarkup = renderToStaticMarkup(
    createElement(OverviewPageClient),
  );
  const historyMarkup = renderToStaticMarkup(createElement(HistoryPageClient));

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

  const markup = renderToStaticMarkup(createElement(OverviewPageClient));

  assert.match(markup, /Could not load your overview/);
  assert.match(markup, /Your dashboard data is not available right now\./);
  assert.doesNotMatch(markup, /Your dashboard is ready for data/);
});

function createExperimentsPageClientElement() {
  return createElement(ExperimentsPageClient, {
    protocols: experimentProtocols,
  });
}

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

async function createFixtureClient(
  input: {
    experimentSlug?: string;
    extraEntities?: BrowserVaultEntity[];
    includeHabitat?: boolean;
  } = {},
) {
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
        createEntity("regimen", "regimen_creatine", {
          body: "Creatine monohydrate 5 g daily.\n",
          date: "2026-04-17",
          kind: "supplement",
          occurredAt: "2026-04-17T08:00:00.000Z",
          status: "active",
          tags: ["supplement"],
          title: "Creatine monohydrate",
        }),
        createEntity("goal", "goal_rhr", {
          body: "Bring resting heart rate under 45 bpm.\n",
          date: "2026-04-16",
          kind: "metric_goal",
          occurredAt: "2026-04-16T08:00:00.000Z",
          status: "active",
          tags: ["cardio"],
          title: "Improve resting heart rate",
        }),
        ...(input.includeHabitat === false ? [] : createHabitatEntities()),
        ...(input.extraEntities ?? []),
      ],
      metadata: {
        title: "Browser vault fixture",
      },
      vaultRoot: "browser://vault",
    }),
  });

  return createBrowserVaultQueryClient(replica);
}

function resolveRecordClass(
  family: BrowserVaultEntity["family"],
): BrowserVaultEntity["recordClass"] {
  switch (family) {
    case "experiment":
    case "goal":
    case "habitat":
    case "regimen":
      return "bank";
    case "journal":
      return "ledger";
    case "sample":
      return "sample";
    default:
      throw new Error(`Unsupported browser-vault test family: ${family}`);
  }
}

function createHabitatEntities(): BrowserVaultEntity[] {
  return [
    createEntity("habitat", "hab_home-location", {
      attributes: {
        aspect: "home-location",
        domain: "environment",
        indicators: {
          area_type: "urban_center",
          location: "Lisbon",
        },
      },
      kind: "habitat",
      path: "bank/habitat/home-location.md",
      status: "active",
      title: "Location & climate",
    }),
    createEntity("habitat", "hab_sleep-environment", {
      attributes: {
        aspect: "sleep-environment",
        domain: "environment",
        indicators: {
          co2_meter: "aranet",
          darkness: "blackout",
          mattress_satisfaction: "good",
          night_noise: "quiet",
          night_temp_c: 20,
          phone_by_bed: false,
          tv_in_bedroom: false,
        },
      },
      kind: "habitat",
      path: "bank/habitat/sleep-environment.md",
      status: "active",
      title: "Bedroom & sleep",
    }),
  ];
}
