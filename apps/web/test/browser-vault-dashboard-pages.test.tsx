import assert from "node:assert/strict";
import { access } from "node:fs/promises";

import { act, createElement } from "react";
import type { BrowserVaultContextValue } from "@/src/lib/browser-vault/context";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, test, vi } from "vitest";

import {
  createBrowserVaultQueryClient,
  createBrowserVaultReplica,
  createVaultReadModel,
} from "@murphai/query/browser";
import { listHealthCommonsExperimentBrowseProtocols } from "@/src/lib/health-commons/experiment-browse";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn<BrowserVaultContextValue["refresh"]>(async () => undefined),
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
import JournalPageClient from "../app/(dashboard)/journal/journal-page-client";
import { metadata as journalMetadata } from "../app/(dashboard)/journal/layout";
import { EnvironmentPrintStudy } from "../app/design/environment-print-study";
import { JournalViewContent } from "../src/components/journal/journal-view";
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
    assert.doesNotMatch(markup, /href="\/patterns"|Weekly insights|See evidence/u);
  } finally {
    vi.useRealTimers();
  }
});

test("JournalPage requests one automatic refresh and keeps the refreshed page free of refresh controls", async () => {
  const ref: NonNullable<BrowserVaultContextValue["ref"]> = {
    byteLength: 100, dataVersion: "a".repeat(64), generatedAt: clientFixture.replica.generatedAt,
    generation: clientFixture.replica.generation, keyId: "browser-vault-replica:test",
    objectKey: "synthetic/replica.json", replicaSchema: "murph.browser-vault-replica",
    runtimeRootKeyId: "udrk:runtime:test", schema: "murph.hosted-browser-vault-replica-ref.v1",
    sourceBundleHash: "b".repeat(64),
  };
  const context = { client: clientFixture, ref, refresh: mocks.refresh, refreshPending: false, status: "ready" };
  mocks.useBrowserVault.mockReturnValue(context);
  const rendered = await renderClientComponent(createElement(JournalPageClient), { requireButton: false });
  try {
    assert.equal(mocks.refresh.mock.calls.length, 1);
    const options = mocks.refresh.mock.calls[0]?.[0];
    assert.equal(options?.background, true);
    assert.ok(options?.requestRuntimeRefreshUntil);
    assert.equal(options.requestRuntimeRefreshUntil(clientFixture, ref), false);
    const nextRef = { ...ref, generatedAt: "2026-04-20T12:01:00.000Z" };
    assert.equal(options.requestRuntimeRefreshUntil(clientFixture, nextRef), true);
    const legacyClient = createBrowserVaultQueryClient({ ...clientFixture.replica, journal: undefined });
    assert.equal(options.requestRuntimeRefreshUntil(legacyClient, nextRef), false);
    mocks.useBrowserVault.mockReturnValue({ ...context, ref: nextRef });
    await rendered.rerender(createElement(JournalPageClient));
    assert.equal(mocks.refresh.mock.calls.length, 1);
    const buttonText = [...rendered.container.querySelectorAll("button")].map((button) => button.textContent).join(" ");
    assert.doesNotMatch(buttonText, /refresh/iu);
  } finally {
    await rendered.cleanup();
  }
});

test("Journal renders honest note timing, selected artwork, and non-repeating detail", async () => {
  const client = await createFixtureClient({
    includeHabitat: false,
    extraEntities: [
      createEntity("event", "evt_context", {
        kind: "note", title: "Recovery context", occurredAt: "2026-04-20T12:00:00Z", date: "2026-04-20",
        attributes: { note: "Recovery context", noteType: "journal-context", timeZone: "UTC" },
        tags: ["timing-all-day", "journal-icon-note"],
      }),
      createEntity("event", "evt_stretch", {
        kind: "note", title: "Stretch", occurredAt: "2026-04-20T12:00:00Z", date: "2026-04-20",
        attributes: { note: "6 min", noteType: "journal-factor", timeZone: "UTC" },
        tags: ["timing-evening", "journal-icon-mobility"],
      }),
      createEntity("event", "evt_rest", {
        kind: "note", title: "Quiet rest", occurredAt: "2026-04-20T12:00:00Z", date: "2026-04-20",
        attributes: { note: "Quiet rest", noteType: "journal-context", timeZone: "UTC" },
        tags: ["timing-unknown", "journal-icon-does-not-exist"],
      }),
    ],
  });
  assert.ok(client.replica.journal);
  const rendered = await renderClientComponent(createElement(JournalViewContent, {
    asOfDate: "2026-04-20", journal: client.replica.journal,
  }), { requireButton: false, location: { href: "http://localhost/journal" } });
  try {
    const times = [...rendered.container.querySelectorAll("time")].map((time) => time.textContent);
    assert.ok(times.includes("All day"));
    assert.ok(times.includes("Evening"));
    assert.ok(rendered.container.querySelector('time[aria-label="Time not specified"]'));
    assert.ok(rendered.container.querySelector('img[src="/design-assets/patterns/mobility.svg"]'));
    assert.doesNotMatch(rendered.container.innerHTML, /journal-icon-does-not-exist|12:00/);
    assert.match(rendered.container.textContent ?? "", /6 min/);
    assert.equal((rendered.container.textContent?.match(/Recovery context/g) ?? []).length, 1);
    assert.equal((rendered.container.textContent?.match(/Quiet rest/g) ?? []).length, 1);
  } finally {
    await rendered.cleanup();
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
