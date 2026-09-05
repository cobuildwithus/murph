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
import type {
  PersonalPatternCell,
  PersonalPatternFactor,
  PersonalPatternReport,
  PersonalPatternStage,
} from "@murphai/query/browser-overview";
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
import JournalPageClient from "../app/(dashboard)/journal/journal-page-client";
import { metadata as journalMetadata } from "../app/(dashboard)/journal/layout";
import OverviewPageClient from "../app/(dashboard)/overview/overview-page-client";
import { metadata as overviewMetadata } from "../app/(dashboard)/overview/layout";
import PatternsPageClient from "../app/(dashboard)/patterns/patterns-page-client";
import { metadata as patternsMetadata } from "../app/(dashboard)/patterns/layout";
import { EnvironmentPrintStudy } from "../app/design/environment-print-study";
import { PersonalPatternsComponentStudy } from "../app/design/personal-patterns-study";
import { JournalViewContent } from "../src/components/journal/journal-view";
import {
  getOutcomeDescription,
  sortPersonalPatternReport,
} from "../src/components/overview/personal-patterns-section";
import { renderClientComponent } from "./render-client-component";

type BrowserVaultEntity = Parameters<
  typeof createVaultReadModel
>[0]["entities"][number];

let clientFixture: Awaited<ReturnType<typeof createFixtureClient>>;
const experimentProtocols = listHealthCommonsExperimentBrowseProtocols();

const staticMatchMedia: typeof window.matchMedia = (query) => ({
  addEventListener() {},
  addListener() {},
  dispatchEvent: () => false,
  matches: false,
  media: query,
  onchange: null,
  removeEventListener() {},
  removeListener() {},
});

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
  assert.equal(journalMetadata.title, "Journal | Murph");
  assert.equal(
    journalMetadata.description,
    "Review your health events, context, and connected data in one timeline.",
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
    journalMetadata,
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

  assert.match(markup, />Patterns</);
  assert.doesNotMatch(markup, /What tends to move together/);
  assert.match(markup, /Find what changes your sleep and recovery/);
  assert.match(markup, /Connect a device/);
  assert.doesNotMatch(markup, /Connect health data/);
  assert.doesNotMatch(markup, /Weekly changes/);
});

test("JournalPage renders the derived private health timeline", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-12T12:00:00.000Z"));
  try {
    const journalClient = createBrowserVaultQueryClient({
      ...clientFixture.replica,
      generatedAt: "2026-08-11T23:30:00.000Z",
      journal: {
        days: [
          {
            date: "2026-08-12",
            events: [
              {
                date: "2026-08-12",
                details: [],
                id: "morning-walk",
                kind: "activity",
                metrics: {
                  activityMinutes: 30,
                  deepSleepMinutes: null,
                  hrvMs: null,
                  readinessScore: null,
                  recoveryScore: null,
                  remSleepMinutes: null,
                  respiratoryRate: null,
                  restingHeartRateBpm: null,
                  sleepEfficiencyPercent: null,
                  sleepMinutes: null,
                  sleepScore: null,
                  spo2Percent: null,
                },
                occurredAt: "2026-08-12T08:00:00.000Z",
                records: [
                  {
                    id: "morning-walk-record",
                    kind: "activity_session",
                    label: "Morning walk",
                    occurredAt: "2026-08-12T08:00:00.000Z",
                    source: "Apple Health",
                    summary: "30 min",
                    tags: [],
                    timeZone: "Europe/Warsaw",
                  },
                ],
                summary: "30 min",
                timing: "timed",
                timeZone: "Europe/Warsaw",
                title: "Morning walk",
              },
            ],
          },
        ],
        eventCount: 1,
        recordCount: 1,
        weeks: [
          {
            activityMinutes: 30,
            averageSleepMinutes: null,
            averageSleepScore: null,
            endDate: "2026-08-16",
            sleepNights: 0,
            startDate: "2026-08-10",
          },
        ],
        windowDays: 120,
      },
    });
    mocks.useBrowserVault.mockReturnValue({
      client: journalClient,
      dataVersion: journalClient.replica.source.dataVersion,
      error: null,
      ref: null,
      refreshPending: false,
      refresh: mocks.refresh,
      status: "ready",
    });
    const markup = renderToStaticMarkup(createElement(JournalPageClient));

    assert.doesNotMatch(markup, /Your Journal/u);
    assert.match(markup, /Journal/u);
    assert.doesNotMatch(markup, /10–16 August 2026/u);
    assert.match(markup, /Morning walk/u);
    assert.match(markup, /Last 7 days/u);
    assert.match(markup, /Update your journal in private chat with Murph/u);
    assert.match(markup, /flex items-center gap-\[11px\] px-1 text-left/u);
    assert.match(markup, /journal-day-2026-08-12/u);
    assert.doesNotMatch(markup, /journal-day-2026-08-13/u);
    assert.doesNotMatch(markup, /No data/u);
  } finally {
    vi.useRealTimers();
  }
});

test("JournalPage shows the seven days ending today and disables future dates", async () => {
  const journal = {
    days: [
      { date: "2026-08-12", events: [] },
      { date: "2026-07-30", events: [] },
    ],
    eventCount: 0,
    recordCount: 0,
    weeks: [
      {
        activityMinutes: 0,
        averageSleepMinutes: null,
        averageSleepScore: null,
        endDate: "2026-08-16",
        sleepNights: 0,
        startDate: "2026-08-10",
      },
    ],
    windowDays: 120,
  };
  const rendered = await renderClientComponent(
    createElement(JournalViewContent, {
      asOfDate: "2026-08-12",
      journal,
    }),
    { matchMedia: staticMatchMedia, requireButton: false },
  );

  const visibleDayIds = () =>
    Array.from(
      rendered.container.querySelectorAll<HTMLElement>('[id^="journal-day-"]'),
      (element) => element.id,
    );

  assert.deepEqual(visibleDayIds(), [
    "journal-day-2026-08-12",
    "journal-day-2026-08-11",
    "journal-day-2026-08-10",
    "journal-day-2026-08-09",
    "journal-day-2026-08-08",
    "journal-day-2026-08-07",
    "journal-day-2026-08-06",
  ]);
  assert.doesNotMatch(rendered.container.innerHTML, /journal-day-2026-08-05/u);
  assert.doesNotMatch(rendered.container.innerHTML, /journal-day-2026-08-13/u);
  assert.match(
    rendered.container.innerHTML,
    /Good (morning|afternoon|evening)\./u,
  );

  const futureDateButton = rendered.container.querySelector(
    'button[aria-label="Monday, August 17, 2026"]',
  );
  assert.ok(futureDateButton instanceof rendered.window.HTMLButtonElement);
  assert.equal(futureDateButton.disabled, true);

  const previousButton = rendered.container.querySelector(
    'button[aria-label="Previous 7 days"]',
  );
  assert.ok(previousButton instanceof rendered.window.HTMLButtonElement);
  await act(async () => previousButton.click());
  assert.deepEqual(visibleDayIds(), [
    "journal-day-2026-08-05",
    "journal-day-2026-08-04",
    "journal-day-2026-08-03",
    "journal-day-2026-08-02",
    "journal-day-2026-08-01",
    "journal-day-2026-07-31",
    "journal-day-2026-07-30",
  ]);
  assert.doesNotMatch(rendered.container.innerHTML, /journal-day-2026-08-06/u);

  const mobileCalendarButton = rendered.container.querySelector(
    'button[aria-label="Choose a Journal date. Showing Jul 30–Aug 5"]',
  );
  assert.ok(mobileCalendarButton instanceof rendered.window.HTMLButtonElement);
  assert.equal(mobileCalendarButton.getAttribute("aria-expanded"), "false");
  await act(async () => mobileCalendarButton.click());
  assert.equal(mobileCalendarButton.getAttribute("aria-expanded"), "true");

  const previousMonthButtons = Array.from(
    rendered.window.document.querySelectorAll(
      'button[aria-label="Previous month"]',
    ),
  );
  const drawerPreviousMonthButton = previousMonthButtons.at(-1);
  assert.ok(
    drawerPreviousMonthButton instanceof rendered.window.HTMLButtonElement,
  );
  await act(async () => drawerPreviousMonthButton.click());
  assert.match(rendered.window.document.body.textContent ?? "", /July 2026/u);

  await rendered.cleanup();
});

test("JournalPage keeps secondary sleep metrics off the main timeline", async () => {
  const rendered = await renderClientComponent(
    createElement(JournalViewContent, {
      asOfDate: "2026-08-12",
      journal: {
        days: [
          {
            date: "2026-08-12",
            events: [
              {
                date: "2026-08-12",
                details: [],
                id: "sleep",
                kind: "sleep",
                metrics: {
                  activityMinutes: 0,
                  deepSleepMinutes: null,
                  hrvMs: 68,
                  readinessScore: 71,
                  recoveryScore: null,
                  remSleepMinutes: null,
                  respiratoryRate: null,
                  restingHeartRateBpm: null,
                  sleepEfficiencyPercent: 89,
                  sleepMinutes: 450,
                  sleepScore: 78,
                  spo2Percent: null,
                },
                occurredAt: "2026-08-12T07:00:00.000Z",
                records: [
                  {
                    id: "sleep-record",
                    kind: "sleep_session",
                    label: "Sleep",
                    occurredAt: "2026-08-12T07:00:00.000Z",
                    source: "oura",
                    summary: "7 h 30",
                    tags: [],
                    timeZone: "Europe/Warsaw",
                  },
                ],
                summary: "7 h 30 · sleep score 78",
                timing: "night",
                timeZone: "Europe/Warsaw",
                title: "Sleep",
              },
            ],
          },
        ],
        eventCount: 1,
        recordCount: 4,
        weeks: [],
        windowDays: 120,
      },
    }),
    { matchMedia: staticMatchMedia, requireButton: false },
  );

  try {
    assert.doesNotMatch(rendered.container.textContent ?? "", /efficiency/u);
    const mobileDetailsButton = rendered.container.querySelector(
      'button[data-journal-detail-trigger="mobile"]',
    );
    assert.ok(mobileDetailsButton instanceof rendered.window.HTMLButtonElement);
    assert.ok(mobileDetailsButton.querySelector('svg[aria-hidden="true"]'));
    assert.equal(mobileDetailsButton.getAttribute("aria-expanded"), "false");

    await act(async () => mobileDetailsButton.click());

    assert.equal(mobileDetailsButton.getAttribute("aria-expanded"), "true");
  } finally {
    await rendered.cleanup();
  }
});

test("JournalPage renders its empty state after Browser Vault finishes without data", () => {
  mocks.useBrowserVault.mockReturnValue({
    client: null,
    dataVersion: null,
    error: null,
    ref: null,
    refreshPending: false,
    refresh: mocks.refresh,
    status: "empty",
  });

  const markup = renderToStaticMarkup(createElement(JournalPageClient));

  assert.match(markup, /Build your health timeline/u);
  assert.doesNotMatch(markup, /Preparing your Journal/u);
});

test("JournalPage renders a structural skeleton while its first timeline is prepared", () => {
  mocks.useBrowserVault.mockReturnValue({
    client: null,
    dataVersion: null,
    deviceSyncImportPending: true,
    error: null,
    freshness: "stale",
    ref: null,
    refreshPending: true,
    refresh: mocks.refresh,
    status: "empty",
  });

  const markup = renderToStaticMarkup(createElement(JournalPageClient));

  assert.match(markup, /Preparing your Journal/u);
  assert.match(markup, /aria-busy="true"/u);
  assert.doesNotMatch(markup, /See the story behind your health data/u);
});

test("JournalPage renders its empty state while an empty vault refreshes", () => {
  mocks.useBrowserVault.mockReturnValue({
    client: null,
    dataVersion: null,
    deviceSyncImportPending: false,
    error: null,
    freshness: "stale",
    ref: null,
    refreshPending: true,
    refresh: mocks.refresh,
    status: "empty",
  });

  const markup = renderToStaticMarkup(createElement(JournalPageClient));

  assert.match(markup, /Build your health timeline/u);
  assert.doesNotMatch(markup, /Preparing your Journal/u);
});

test("JournalPage keeps its page context and recovery action when loading fails", () => {
  mocks.useBrowserVault.mockReturnValue({
    client: null,
    dataVersion: null,
    error: "Internal implementation detail",
    freshness: "stale",
    ref: null,
    refreshPending: false,
    refresh: mocks.refresh,
    status: "error",
  });

  const markup = renderToStaticMarkup(createElement(JournalPageClient));

  assert.doesNotMatch(markup, /Your Journal/u);
  assert.match(markup, /Journal could not load/u);
  assert.match(markup, /Try again/u);
  assert.doesNotMatch(markup, /Internal implementation detail/u);
});

test("JournalPage offers recovery when an old replica has no Journal view", () => {
  const legacyReplica = { ...clientFixture.replica };
  delete legacyReplica.journal;
  const legacyClient = createBrowserVaultQueryClient(legacyReplica);
  mocks.useBrowserVault.mockReturnValue({
    client: legacyClient,
    dataVersion: legacyClient.replica.source.dataVersion,
    error: null,
    freshness: "stale",
    ref: null,
    refreshPending: false,
    refresh: mocks.refresh,
    status: "ready",
  });

  const markup = renderToStaticMarkup(createElement(JournalPageClient));

  assert.match(markup, /Journal is not ready yet/u);
  assert.match(markup, /Refresh Journal/u);
  assert.doesNotMatch(markup, /See the story behind your health data/u);
});

test("Personal Patterns comparison controls use plain result language", () => {
  const markup = renderToStaticMarkup(
    createElement(PersonalPatternsComponentStudy),
  );

  assert.match(markup, /aria-label="Your HRV was higher after running\./);
  assert.match(markup, /aria-label="You slept longer after sauna\./);
  assert.match(markup, /data-patterns-layout="mobile"/u);
  assert.match(markup, /data-patterns-layout="desktop"/u);
  assert.equal((markup.match(/data-pattern-outcome-group=/gu) ?? []).length, 1);
  assert.equal(
    (markup.match(/data-pattern-factor-row="running"/gu) ?? []).length,
    1,
  );
  assert.match(
    markup,
    /aria-label="Pattern results\. Swipe horizontally to compare health measures\."/u,
  );
  assert.equal(
    (markup.match(/data-pattern-outcome-column="sleep-quality"/gu) ?? [])
      .length,
    2,
  );
  assert.doesNotMatch(
    markup,
    /data-pattern-outcome-column="sleep-(?:score|efficiency)"/u,
  );
  assert.match(markup, /data-pattern-outcome-column="total-sleep"/u);
  assert.match(markup, />Sleep duration</u);
  assert.match(markup, />Sleep quality</u);
  assert.match(markup, /aria-label="Sort by Sleep quality/u);
  assert.doesNotMatch(markup, /lucide-arrow-up-down/u);
  assert.doesNotMatch(markup, /aria-label="About Sleep quality"/u);
  assert.doesNotMatch(markup, /lucide-circle-help/u);
  assert.match(markup, />SpO₂</u);
  assert.equal(
    getOutcomeDescription("spo2"),
    "Blood oxygen saturation. It estimates how much oxygen your red blood cells carry, usually while you sleep.",
  );
  assert.match(markup, /\/design-assets\/patterns\/housework\.svg/u);
  assert.match(markup, /\/design-assets\/patterns\/mobility\.svg/u);
  assert.match(markup, /\/design-assets\/habitat\/night-temp\.svg/u);
  assert.match(markup, /\/design-assets\/patterns\/activity\.svg/u);
  assert.doesNotMatch(markup, />Score<\/span>/u);
  assert.doesNotMatch(markup, />Efficiency<\/span>/u);
  assert.match(markup, /sleep efficiency/u);
  assert.doesNotMatch(markup, /Unsupported outcome/u);
  assert.doesNotMatch(markup, /Sparse factor/u);
  assert.match(
    markup,
    /aria-label="Good coverage: based on 14 recorded cases"/u,
  );
  assert.match(markup, /data-observed-days="14"/u);
  assert.match(markup, /Early signal, grade D/u);
  assert.match(markup, /Pattern, grade A/u);
  assert.match(markup, /Your HRV was higher after running\./u);
  assert.match(markup, /9 days with running averaged 48 ms\./u);
  assert.match(markup, /similar comparison days averaged/u);
  assert.equal(
    (markup.match(/Results show associations, not proof of cause/gu) ?? [])
      .length,
    1,
  );
  assert.match(markup, /Custom tag/u);
  assert.match(
    markup,
    /No clear pattern was found between custom tag and HRV\./u,
  );
  assert.match(markup, /bg-red-700\/10 text-red-700/u);
  assert.match(markup, /data-pattern-state="no-clear-pattern"/u);
  assert.match(markup, /data-pattern-state="insufficient"/u);
  assert.match(markup, /aria-label="Not enough comparable data/u);
  assert.match(markup, /data-slot="popover-trigger"/u);
  assert.doesNotMatch(markup, />~</u);
  assert.doesNotMatch(markup, /font-mono font-semibold tabular-nums/u);
  assert.doesNotMatch(markup, /Scroll sideways/u);
});

test("Personal Patterns sorts comparable results and keeps missing results last", () => {
  const report: PersonalPatternReport = {
    asOfDate: "2026-09-02",
    cells: [
      patternCell("lower", -12, "no_clear_pattern"),
      patternCell("higher", 18, "seen_again"),
      patternCell("missing", null, "insufficient"),
    ],
    factors: [
      patternFactor("missing", 30),
      patternFactor("lower", 8),
      patternFactor("higher", 7),
    ],
    lagDays: 1,
    notes: [],
    outcomes: [{ id: "hrv", label: "HRV", unit: "ms" }],
    repeatableCellCount: 1,
    testedCellCount: 2,
    windowDays: 120,
  };

  assert.deepEqual(
    sortPersonalPatternReport(report, {
      columnId: "hrv",
      direction: "descending",
    }).factors.map((factor) => factor.id),
    ["higher", "lower", "missing"],
  );
  assert.deepEqual(
    sortPersonalPatternReport(report, {
      columnId: "hrv",
      direction: "ascending",
    }).factors.map((factor) => factor.id),
    ["lower", "higher", "missing"],
  );
});

test("a saved synthetic Journal factor reaches Patterns and disappears after correction", async () => {
  const start = "2026-01-05";
  const yardWorkDates = Array.from({ length: 8 }, (_, index) =>
    addIsoDays(start, index * 14),
  );
  const entities = yardWorkDates.map((date, index) =>
    createEntity("event", `yard_work_${index}`, {
      attributes: { activityType: "yard_work" },
      date,
      kind: "activity_session",
      occurredAt: `${date}T12:00:00.000Z`,
      title: "Yard work",
    }),
  );
  const metricPoints = Array.from({ length: 112 }, (_, index) => {
    const date = addIsoDays(start, index);
    const value = yardWorkDates.includes(addIsoDays(date, -1)) ? 70 : 50;
    return {
      biomarkerKey: null,
      canonicalUnit: "ms",
      canonicalValue: value,
      comparator: null,
      confidence: "high" as const,
      context: {},
      effectiveDate: date,
      grain: "day" as const,
      id: `yard_work_hrv_${index}`,
      metricKey: "hrv-rmssd",
      observedAt: `${date}T07:00:00.000Z`,
      provenance: {
        dataOrigin: null,
        externalRef: null,
        labName: null,
        provider: "whoop",
        rawRefs: [],
        sourceLabel: "Synthetic wearable summary",
      },
      recordedAt: null,
      reportedAt: null,
      schemaVersion: "murph.metric-point.v1" as const,
      source: {
        family: "derived" as const,
        kind: "wearable-summary",
        path: "",
        recordId: `record:yard_work_hrv_${index}`,
        resultIndex: null,
      },
      statistic: "value" as const,
      textValue: null,
      unit: "ms",
      value,
    };
  });
  const buildReplica = async (
    sourceBundleHash: string,
    sourceEntities: BrowserVaultEntity[],
  ) =>
    await createBrowserVaultReplica({
      generatedAt: "2026-04-27T13:00:00.000Z",
      metricPoints,
      sourceBundleHash,
      vault: createVaultReadModel({
        entities: sourceEntities,
        vaultRoot: "browser://synthetic-pattern-cycle",
      }),
    });

  const savedReplica = await buildReplica("s".repeat(64), entities);
  assert.equal(savedReplica.source.sourceBundleHash, "s".repeat(64));
  assert.equal(savedReplica.personalPatterns?.factors[0]?.id, "yard-work");
  const savedClient = createBrowserVaultQueryClient(savedReplica);
  mocks.useBrowserVault.mockReturnValue({
    client: savedClient,
    dataVersion: savedClient.replica.source.dataVersion,
    error: null,
    ref: null,
    refreshPending: false,
    refresh: mocks.refresh,
    status: "ready",
  });

  const savedMarkup = renderToStaticMarkup(createElement(PatternsPageClient));
  assert.match(savedMarkup, /Yard work/u);
  assert.match(savedMarkup, /HRV/u);

  const correctedReplica = await buildReplica("c".repeat(64), []);
  assert.equal(correctedReplica.personalPatterns?.factors.length, 0);
  const correctedClient = createBrowserVaultQueryClient(correctedReplica);
  mocks.useBrowserVault.mockReturnValue({
    client: correctedClient,
    dataVersion: correctedClient.replica.source.dataVersion,
    error: null,
    ref: null,
    refreshPending: false,
    refresh: mocks.refresh,
    status: "ready",
  });

  const correctedMarkup = renderToStaticMarkup(
    createElement(PatternsPageClient),
  );
  assert.doesNotMatch(correctedMarkup, /Yard work/u);
  assert.match(correctedMarkup, /Give your health data some context/u);
});

test("Personal Patterns reveals factors after the first 15 on request", async () => {
  const rendered = await renderClientComponent(
    createElement(PersonalPatternsComponentStudy),
    {
      location: {
        hash: "",
        href: "https://local.withmurph.ai/patterns",
        origin: "https://local.withmurph.ai",
        pathname: "/patterns",
        search: "",
      },
      requireButton: false,
    },
  );

  try {
    assert.match(
      rendered.container.textContent ?? "",
      /Showing 15 of 19 factors/u,
    );
    assert.doesNotMatch(rendered.container.textContent ?? "", /Yoga/u);
    assert.doesNotMatch(rendered.container.textContent ?? "", /Reading/u);

    const showMore = Array.from(
      rendered.window.document.querySelectorAll("button"),
    ).find((button) => button.textContent === "Show more");
    assert.ok(showMore instanceof rendered.window.HTMLButtonElement);
    await act(async () => {
      showMore.click();
    });

    assert.match(
      rendered.container.textContent ?? "",
      /Showing 19 of 19 factors/u,
    );
    assert.match(rendered.container.textContent ?? "", /Yoga/u);
    assert.match(rendered.container.textContent ?? "", /Reading/u);
    assert.equal(showMore.getAttribute("aria-expanded"), "true");

    await act(async () => {
      showMore.click();
    });
    assert.doesNotMatch(rendered.container.textContent ?? "", /Yoga/u);
    assert.equal(showMore.getAttribute("aria-expanded"), "false");
  } finally {
    await rendered.cleanup();
  }
});

test("PatternsPage renders its prepared report without scanning unrelated vault entities", () => {
  mocks.useBrowserVault.mockReturnValue({
    client: {
      ...clientFixture,
      replica: {
        ...clientFixture.replica,
        get entities() { throw new Error("Patterns must not rebuild the overview."); },
      },
    },
    refresh: mocks.refresh,
    refreshPending: false,
    status: "ready",
  });
  const markup = renderToStaticMarkup(createElement(PatternsPageClient));
  assert.match(markup, /patterns/iu);
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
    assert.match(
      rendered.container.textContent ?? "",
      /Patterns are not ready yet/u,
    );
    assert.match(rendered.container.textContent ?? "", /Refresh Patterns/u);
    assert.doesNotMatch(
      rendered.container.textContent ?? "",
      /No clear comparison is ready/u,
    );
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

test("PatternsPage keeps its heading and recovery action when loading fails", async () => {
  mocks.useBrowserVault.mockReturnValue({
    client: null,
    dataVersion: null,
    error: "The private replica could not be opened.",
    ref: null,
    refreshPending: false,
    refresh: mocks.refresh,
    status: "error",
  });
  const rendered = await renderClientComponent(
    createElement(PatternsPageClient),
    { requireButton: false },
  );

  try {
    assert.match(
      rendered.container.textContent ?? "",
      /Patterns could not load/u,
    );
    assert.match(rendered.container.textContent ?? "", /^Patterns/u);
    assert.equal(
      [...rendered.container.querySelectorAll("button")].some(
        (button) => button.textContent === "Try again",
      ),
      true,
    );
    assert.equal(mocks.refresh.mock.calls.length, 0);
  } finally {
    await rendered.cleanup();
  }
});

test("PatternsPage local diagnostics explain why a selected factor is hidden", () => {
  const personalPatterns = createPersonalPatternDiagnosticFixture();
  const diagnosticsClient = createBrowserVaultQueryClient({
    ...clientFixture.replica,
    personalPatterns,
  });
  mocks.useBrowserVault.mockReturnValue({
    client: diagnosticsClient,
    dataVersion: diagnosticsClient.replica.source.dataVersion,
    error: null,
    ref: null,
    refreshPending: false,
    refresh: mocks.refresh,
    status: "ready",
  });

  const markup = renderToStaticMarkup(
    createElement(PatternsPageClient, { debugFactor: "trail-running" }),
  );

  assert.match(markup, /Local pattern diagnostics/u);
  assert.match(markup, /4 recorded days, 5 sessions/u);
  assert.match(markup, /Not enough matched days/u);
  assert.match(markup, /Shown in matrix/u);
  assert.match(markup, />No</u);
});

test("PatternsPage local diagnostics distinguishes a factor missing before selection", () => {
  const personalPatterns = createPersonalPatternDiagnosticFixture();
  const diagnosticsClient = createBrowserVaultQueryClient({
    ...clientFixture.replica,
    entities: [
      ...clientFixture.replica.entities,
      {
        attributes: {
          activityType: "workout",
        },
        bodyPreview: null,
        date: "2026-08-28",
        experimentSlug: null,
        family: "event",
        id: "trail-running-activity",
        kind: "activity_session",
        links: [],
        lookupIds: ["trail-running-activity"],
        occurredAt: "2026-08-28T19:27:00.000Z",
        recordClass: "ledger",
        status: null,
        stream: null,
        tags: [],
        title: "Trail running",
      },
    ],
    journal: {
      ...clientFixture.replica.journal,
      days: [
        ...(clientFixture.replica.journal?.days ?? []),
        {
          date: "2026-08-28",
          events: [
            {
              date: "2026-08-28",
              details: ["2 h 45 across 2 sessions"],
              id: "trail-running-activity",
              kind: "activity_session",
              metrics: {
                activityMinutes: 165,
                deepSleepMinutes: null,
                hrvMs: null,
                readinessScore: null,
                recoveryScore: null,
                remSleepMinutes: null,
                respiratoryRate: null,
                restingHeartRateBpm: null,
                sleepEfficiencyPercent: null,
                sleepMinutes: null,
                sleepScore: null,
                spo2Percent: null,
              },
              occurredAt: "2026-08-28T19:27:00.000Z",
              records: [
                {
                  id: "trail-running-activity",
                  kind: "activity_session",
                  label: "Oura workout",
                  occurredAt: "2026-08-28T19:27:00.000Z",
                  source: "device",
                  summary: null,
                  tags: [],
                  timeZone: null,
                },
              ],
              summary: "2 h 45 across 2 sessions",
              timing: "timed",
              timeZone: null,
              title: "Trail running",
            },
          ],
        },
      ],
      eventCount: (clientFixture.replica.journal?.eventCount ?? 0) + 1,
      recordCount: (clientFixture.replica.journal?.recordCount ?? 0) + 1,
      weeks: clientFixture.replica.journal?.weeks ?? [],
      windowDays: clientFixture.replica.journal?.windowDays ?? 14,
    },
    personalPatterns: {
      ...personalPatterns,
      cells: [],
      factors: [],
    },
  });
  mocks.useBrowserVault.mockReturnValue({
    client: diagnosticsClient,
    dataVersion: diagnosticsClient.replica.source.dataVersion,
    error: null,
    ref: null,
    refreshPending: false,
    refresh: mocks.refresh,
    status: "ready",
  });

  const markup = renderToStaticMarkup(
    createElement(PatternsPageClient, { debugFactor: "trail-running" }),
  );

  assert.match(markup, /Factor is not in the selected report/u);
  assert.match(markup, /Matching Journal events exist/u);
  assert.match(markup, /activityType=workout/u);
  assert.match(markup, />None</u);
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
  assert.match(markup, /What to review next/);
  assert.doesNotMatch(markup, /What to check next/);
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

  assert.match(markup, /Review how your home supports you/);
  assert.match(markup, /Fill in my report/);
  assert.match(markup, /Prefer typing\? Use chat/);
  assert.match(
    markup,
    /Murph will grade your setup and show what to check next/,
  );
  assert.doesNotMatch(markup, /Habitat/);
  assert.doesNotMatch(markup, /Private to you/);
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

function createPersonalPatternDiagnosticFixture(): PersonalPatternReport {
  return {
    asOfDate: "2026-08-29",
    cells: [
      {
        classification: null,
        comparisonBasis: "unobserved_baseline",
        comparisonDates: [],
        comparisonDays: 0,
        comparisonMean: null,
        delta: null,
        deltaPercent: null,
        direction: "flat",
        exposedDates: [],
        exposedDays: 0,
        exposedMean: null,
        factorId: "trail-running",
        firstExposedDate: null,
        grade: null,
        lastExposedDate: null,
        outcomeId: "sleep-duration",
        repeatedDirection: false,
        stage: "insufficient",
      },
    ],
    factors: [
      {
        episodeCount: 5,
        id: "trail-running",
        kind: "activity",
        label: "Trail running",
        observedDays: 4,
      },
    ],
    lagDays: 1,
    notes: [],
    outcomes: [
      {
        id: "sleep-duration",
        label: "Sleep duration",
        lagDays: 1,
        unit: "min",
      },
    ],
    repeatableCellCount: 0,
    testedCellCount: 0,
    windowDays: 120,
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
    case "event":
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

function addIsoDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function patternFactor(id: string, observedDays: number): PersonalPatternFactor {
  return {
    id,
    kind: "activity",
    label: id,
    observedDays,
  };
}

function patternCell(
  factorId: string,
  deltaPercent: number | null,
  stage: PersonalPatternStage,
): PersonalPatternCell {
  return {
    comparisonDays: stage === "insufficient" ? 0 : 5,
    comparisonMean: null,
    delta: deltaPercent,
    deltaPercent,
    direction:
      deltaPercent === null ? "flat" : deltaPercent > 0 ? "higher" : "lower",
    exposedDays: stage === "insufficient" ? 0 : 5,
    exposedMean: null,
    factorId,
    firstExposedDate: null,
    lastExposedDate: null,
    outcomeId: "hrv",
    repeatedDirection: false,
    stage,
  };
}
