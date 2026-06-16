import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";

import type { HTMLAttributes, ReactNode } from "react";
import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

vi.mock("next/image", () => ({
  default: (props: {
    alt?: string;
    className?: string;
    height?: number;
    src: string;
    width?: number;
  }) =>
    createElement("img", {
      alt: props.alt ?? "",
      className: props.className,
      height: props.height,
      src: props.src,
      width: props.width,
  }),
}));

vi.mock("@/src/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children?: ReactNode; open?: boolean }) =>
    open ? createElement("div", { "data-dialog-open": "true" }, children) : null,
  DialogContent: ({ children, className }: HTMLAttributes<HTMLDivElement>) =>
    createElement("div", {
      className,
      "data-dialog-content": "true",
    }, children),
  DialogDescription: (props: HTMLAttributes<HTMLParagraphElement>) =>
    createElement("p", props),
  DialogHeader: (props: HTMLAttributes<HTMLDivElement>) =>
    createElement("div", props),
  DialogTitle: (props: HTMLAttributes<HTMLHeadingElement>) =>
    createElement("h2", props),
}));

vi.mock("@/src/components/legal/hosted-legal-consent-card", () => ({
  HostedLegalConsentCard: (props: {
    mode?: string;
    onAccepted?: () => void | Promise<void>;
    preferredScope?: string;
    source: string;
  }) =>
    createElement(
      "button",
      {
        "data-consent-mode": props.mode,
        "data-consent-scope": props.preferredScope,
        "data-consent-source": props.source,
        "data-hosted-legal-consent-card": "true",
        onClick: () => void props.onAccepted?.(),
        type: "button",
      },
      "Accept consent",
    ),
}));

const mocks = vi.hoisted(() => ({
  authDialogProps: null as { open?: boolean } | null,
  buildHostedDeviceSyncSettingsResponse: vi.fn(),
  getHostedPageAuthSnapshot: vi.fn(),
  resolveHostedMurphContactOption: vi.fn(),
}));

vi.mock("@/src/components/hosted-onboarding/auth-dialog", () => ({
  AuthDialog(props: { open?: boolean }) {
    mocks.authDialogProps = props;
    return props.open
      ? createElement("div", { "data-auth-dialog-open": "true" }, "Auth dialog")
      : null;
  },
  preloadHostedAuthPanelIsland: vi.fn(),
  useHostedAuthPanelIslandIdlePreload: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/settings-service", () => ({
  buildHostedDeviceSyncSettingsResponse: mocks.buildHostedDeviceSyncSettingsResponse,
}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
}));

vi.mock("@/src/components/murph/hosted-murph-contact-action", () => ({
  resolveHostedMurphContactOption: mocks.resolveHostedMurphContactOption,
}));

beforeEach(() => {
  mocks.buildHostedDeviceSyncSettingsResponse.mockResolvedValue({
    generatedAt: "2026-05-01T00:00:00.000Z",
    ok: true,
    sources: [],
  });
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: {
      billingStatus: "active",
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    },
    linkedAccounts: [],
    memberLookup: null,
    session: null,
  });
  mocks.resolveHostedMurphContactOption.mockResolvedValue(null);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  mocks.authDialogProps = null;
});

test("ConnectPage renders source search, source names, and logo marks", async () => {
  const { default: ConnectPage, metadata } = await import("../app/(dashboard)/connect/page");
  const markup = renderToStaticMarkup(await ConnectPage());

  assert.equal(metadata.title, "Connect Devices — Murph");
  assert.match(markup, /Sync your biomarkers/);
  assert.match(markup, /Live Well/);
  assert.match(markup, /placeholder="Search sources"/);
  assert.match(markup, /aria-label="Search sources"/);
  assert.match(markup, />27 of 27 sources</);
  assert.match(markup, /lg:grid-cols-2 xl:grid-cols-4/);
  assert.doesNotMatch(markup, /data-priority list/);
  assert.doesNotMatch(markup, /Priority/u);
  assert.doesNotMatch(markup, /Health data source from the Just Cobuild priority catalog/u);

  const sources = [
    {
      assetPath: "/brand-logos/connect/whoop.svg",
      description: "Recovery, strain, sleep, heart rate, and daily readiness from Whoop.",
      name: "Whoop",
    },
    {
      assetPath: "/brand-logos/connect/mapmyfitness.png",
      description: "Logged workouts, routes, pace, distance, and activity history from MapMyFitness.",
      name: "MapMyFitness",
    },
    {
      assetPath: "/brand-logos/connect/ultrahuman.png",
      description: "Ring-based sleep, recovery, temperature, movement, and metabolic insight signals from Ultrahuman.",
      name: "Ultrahuman",
    },
    {
      assetPath: "/brand-logos/connect/dexcom-g6-and-older.png",
      description: "Legacy Dexcom glucose readings and sensor trends from G6-era devices.",
      name: "Dexcom (G6 and older)",
    },
    {
      assetPath: "/brand-logos/connect/renpho.svg",
      description: "Smart-scale weight, body composition, and measurement trends from Renpho devices.",
      name: "Renpho",
    },
    {
      assetPath: "/brand-logos/connect/runkeeper.svg",
      description: "Runs, walks, routes, duration, pace, and training history from Runkeeper.",
      name: "Runkeeper",
    },
    {
      assetPath: "/brand-logos/connect/tandem-source.svg",
      description: "Insulin pump, CGM, therapy, and diabetes device records from Tandem.",
      name: "Tandem Source",
    },
    {
      assetPath: "/brand-logos/connect/beurer.png",
      description: "Blood pressure, scale, glucose, and home health measurements from Beurer.",
      name: "Beurer",
    },
    {
      assetPath: "/brand-logos/connect/strava.svg",
      description: "Rides, runs, workouts, route context, power, and training load from Strava.",
      name: "Strava",
    },
    {
      assetPath: "/brand-logos/connect/omron.png",
      description: "Blood pressure, pulse, weight, and connected home measurements from Omron.",
      name: "Omron",
    },
    {
      assetPath: "/brand-logos/connect/eight-sleep.svg",
      description: "Mattress-based sleep, temperature, heart rate, and nightly recovery signal trends.",
      name: "Eight Sleep",
    },
    {
      assetPath: "/brand-logos/connect/fitbit.svg",
      description: "Fitbit sleep, activity, heart rate, exercise, and daily readiness-style trends.",
      name: "Fitbit",
    },
    {
      assetPath: "/brand-logos/connect/freestyle-libre.png",
      description: "Libre glucose history, sensor trends, and daily time-in-range context patterns.",
      name: "Freestyle Libre",
    },
    {
      assetPath: "/brand-logos/connect/garmin.png",
      description: "Garmin workouts, sleep, stress, heart, body battery, and activity data.",
      name: "Garmin",
    },
    {
      assetPath: "/brand-logos/connect/hammerhead.png",
      description: "Hammerhead cycling rides, route data, distance, elevation, and performance metrics.",
      name: "Hammerhead",
    },
    {
      assetPath: "/brand-logos/connect/ihealth.png",
      description: "iHealth blood pressure, glucose, weight, oxygen, and home measurement records.",
      name: "iHealth",
    },
    {
      assetPath: "/brand-logos/connect/oura.png",
      description: "Oura sleep, readiness, activity, temperature, heart, and nightly recovery trends.",
      name: "Oura",
    },
    {
      assetPath: "/brand-logos/connect/peloton.svg",
      description: "Peloton rides, runs, strength sessions, output, and performance training history.",
      name: "Peloton",
    },
    {
      assetPath: "/brand-logos/connect/wahoo.svg",
      description: "Wahoo cycling, running, heart rate, power, and trainer workout data.",
      name: "Wahoo",
    },
    {
      assetPath: "/brand-logos/connect/withings.png",
      description: "Withings scale, sleep, blood pressure, temperature, and activity measurement trends.",
      name: "Withings",
    },
    {
      assetPath: "/brand-logos/connect/google-fit.svg",
      description: "Android activity, steps, heart points, workouts, and wellness record context.",
      name: "Google Fit",
    },
    {
      assetPath: "/brand-logos/connect/zwift.png",
      description: "Indoor rides, runs, power, distance, elevation, and virtual training sessions.",
      name: "Zwift",
    },
    {
      assetPath: "/brand-logos/connect/abbott-libreview.svg",
      description: "Abbott LibreView glucose reports, trends, sensor history, and sharing data.",
      name: "Abbott LibreView",
    },
    {
      assetPath: "/brand-logos/connect/dexcom.png",
      description: "Current Dexcom CGM glucose readings, trend arrows, and sensor sessions.",
      name: "Dexcom",
    },
    {
      assetPath: "/brand-logos/connect/kardia.svg",
      description: "Kardia ECG recordings, rhythm summaries, and heart health observation history.",
      name: "Kardia",
    },
    {
      assetPath: "/brand-logos/connect/cronometer.png",
      description: "Nutrition logs, calories, macros, micronutrients, and meal timing from Cronometer.",
      name: "Cronometer",
    },
    {
      assetPath: "/brand-logos/connect/polar.svg",
      description: "Polar training, sleep, heart rate, recovery, and cardio load data.",
      name: "Polar",
    },
  ];

  assert.equal(sources.length, 27);
  assert.equal(markup.match(/data-connection-state="idle"/gu)?.length, sources.length);
  assert.equal(markup.match(/>Not available<\/button>/gu)?.length, sources.length);
  assert.match(markup, /disabled=""/);
  assert.match(markup, /aria-label="Oura connection is not available yet"/);
  assert.match(markup, /Oura not connected/);
  assert.doesNotMatch(markup, /Coming soon/u);
  assert.doesNotMatch(markup, /Not connected/u);
  assert.doesNotMatch(markup, />Connected</u);
  assert.doesNotMatch(markup, />Apple Health</u);
  assert.doesNotMatch(markup, />Health Connect</u);
  assert.doesNotMatch(markup, />Samsung Health</u);
  assert.doesNotMatch(markup, />Freestyle Libre BLE</u);
  assert.doesNotMatch(markup, />Accu-Chek</u);
  assert.doesNotMatch(markup, />Contour BLE</u);
  assert.doesNotMatch(markup, />OneTouch</u);
  assert.doesNotMatch(markup, />Manual</u);
  assert.doesNotMatch(markup, /Whoop V2/u);
  assert.ok(sourceHeadingIndex(markup, "Garmin") < sourceHeadingIndex(markup, "Fitbit"));
  assert.ok(sourceHeadingIndex(markup, "Fitbit") < sourceHeadingIndex(markup, "Google Fit"));
  assert.ok(sourceHeadingIndex(markup, "Google Fit") < sourceHeadingIndex(markup, "Strava"));
  assert.ok(sourceHeadingIndex(markup, "Strava") < sourceHeadingIndex(markup, "Withings"));
  assert.ok(sourceHeadingIndex(markup, "Withings") < sourceHeadingIndex(markup, "Oura"));
  assert.ok(sourceHeadingIndex(markup, "Oura") < sourceHeadingIndex(markup, "Whoop"));
  assert.ok(sourceHeadingIndex(markup, "Whoop") < sourceHeadingIndex(markup, "Dexcom"));
  assert.ok(
    sourceHeadingIndex(markup, "Dexcom (G6 and older)") < sourceHeadingIndex(markup, "Freestyle Libre"),
  );
  assert.ok(
    sourceHeadingIndex(markup, "Freestyle Libre") < sourceHeadingIndex(markup, "Abbott LibreView"),
  );

  for (const source of sources) {
    assert.match(markup, new RegExp(escapeRegExp(source.name)));
    assert.match(markup, new RegExp(`src="${escapeRegExp(source.assetPath)}"`));
    assert.match(
      markup,
      new RegExp(`<img(?=[^>]*alt="")(?=[^>]*src="${escapeRegExp(source.assetPath)}")[^>]*>`, "u"),
    );
    assert.ok(
      existsSync(path.join(process.cwd(), "apps/web/public", source.assetPath)),
      `${source.assetPath} should exist under apps/web/public`,
    );

    assert.notEqual(source.description.split(/\s+/u)[0], "Sync");
    assert.notEqual(source.description.split(/\s+/u)[0], "Import");
  }

  for (const staleDescription of [
    "Health data source from the Just Cobuild priority catalog.",
    "Sync recovery, strain, sleep, heart rate, and daily readiness trends.",
    "Import logged workouts, routes, pace, distance, and activity history from MapMyFitness.",
  ]) {
    assert.doesNotMatch(markup, new RegExp(escapeRegExp(staleDescription)));
  }

  assert.doesNotMatch(markup, />St</);
  assert.doesNotMatch(markup, />Ap</);
});

test("filterConnectSourcesForSearch matches source names, ids, and descriptions", async () => {
  const { filterConnectSourcesForSearch } = await import(
    "../app/(dashboard)/connect/connect-page-client"
  );
  const sources = [
    {
      id: "oura",
      name: "Oura",
      description: "Oura sleep, readiness, activity, temperature, heart, and nightly recovery trends.",
      logo: { className: "size-11 object-contain", height: 44, src: "/oura.png", width: 44 },
    },
    {
      id: "freestyle-libre",
      name: "Freestyle Libre",
      description: "Libre glucose history, sensor trends, and daily time-in-range context patterns.",
      logo: { className: "size-11 object-contain", height: 44, src: "/libre.png", width: 44 },
    },
  ];

  assert.deepEqual(
    filterConnectSourcesForSearch(sources, "sleep").map((source) => source.id),
    ["oura"],
  );
  assert.deepEqual(
    filterConnectSourcesForSearch(sources, "freeStyle").map((source) => source.id),
    ["freestyle-libre"],
  );
  assert.deepEqual(filterConnectSourcesForSearch(sources, "  ").map((source) => source.id), [
    "oura",
    "freestyle-libre",
  ]);
});

test("sortConnectSourcesByConnectionState keeps connected sources first, then popularity order", async () => {
  const { sortConnectSourcesByConnectionState } = await import(
    "../app/(dashboard)/connect/connect-source-order"
  );
  const logo = { className: "size-11 object-contain", height: 44, src: "/logo.png", width: 44 };
  const sources = [
    {
      id: "whoop",
      name: "Whoop",
      description: "Recovery.",
      logo,
    },
    {
      id: "freestyle-libre",
      name: "Freestyle Libre",
      description: "Glucose.",
      logo,
    },
    {
      id: "abbott-libreview",
      name: "Abbott LibreView",
      description: "Glucose reports.",
      logo,
    },
    {
      connected: true,
      id: "oura",
      name: "Oura",
      description: "Sleep.",
      logo,
    },
    {
      id: "garmin",
      name: "Garmin",
      description: "Training.",
      logo,
    },
    {
      id: "dexcom",
      name: "Dexcom",
      description: "Glucose.",
      logo,
    },
    {
      id: "dexcom-g6-and-older",
      name: "Dexcom (G6 and older)",
      description: "Legacy glucose.",
      logo,
    },
    {
      id: "polar",
      name: "Polar",
      description: "Training.",
      logo,
    },
    {
      connected: true,
      id: "strava",
      name: "Strava",
      description: "Workouts.",
      logo,
    },
  ];

  assert.deepEqual(
    sortConnectSourcesByConnectionState(sources).map((source) => source.id),
    [
      "strava",
      "oura",
      "garmin",
      "whoop",
      "dexcom",
      "dexcom-g6-and-older",
      "freestyle-libre",
      "abbott-libreview",
      "polar",
    ],
  );
});

test("ConnectSourcesGrid shows an empty-state alert when no sources are available", async () => {
  const { ConnectSourcesGrid } = await import("../app/(dashboard)/connect/connect-page-client");
  const markup = renderToStaticMarkup(createElement(ConnectSourcesGrid, { sources: [] }));

  assert.match(markup, /Sources/);
  assert.match(markup, />0 of 0 sources</);
  assert.match(markup, /No sources matched/);
  assert.match(markup, /Try a different search to get back to the full source list\./);
  assert.doesNotMatch(markup, />Connect<\/button>/u);
});

test("ConnectPage enables Garmin when Junction exposes Garmin as a connect target", async () => {
  vi.stubEnv("JUNCTION_API_KEY", "sk_us_junction-test");
  vi.stubEnv("JUNCTION_CLIENT_USER_ID_SECRET", "junction-client-user-id-secret");
  vi.stubEnv("JUNCTION_ENV", "sandbox");
  vi.stubEnv("JUNCTION_PROVIDER_FILTER", "garmin");
  vi.stubEnv("JUNCTION_REGION", "us");

  const { default: ConnectPage } = await import("../app/(dashboard)/connect/page");
  const markup = renderToStaticMarkup(await ConnectPage());

  assert.match(markup, /aria-label="Connect Garmin"/u);
  assert.match(markup, />Connect<\/button>/u);
  assert.equal(markup.match(/>Connect<\/button>/gu)?.length, 1);
});

test("ConnectPage enables every Link source exposed by the shared Junction defaults", async () => {
  vi.stubEnv("JUNCTION_API_KEY", "sk_us_junction-test");
  vi.stubEnv("JUNCTION_CLIENT_USER_ID_SECRET", "junction-client-user-id-secret");
  vi.stubEnv("JUNCTION_ENV", "sandbox");
  vi.stubEnv("JUNCTION_PROVIDER_FILTER", "");
  vi.stubEnv("JUNCTION_REGION", "us");

  const { default: ConnectPage, resolveConfiguredConnectSources } = await import(
    "../app/(dashboard)/connect/page"
  );
  const { JUNCTION_DEFAULT_PROVIDER_FILTER } = await import("@murphai/device-syncd/config");
  const markup = renderToStaticMarkup(await ConnectPage());

  assert.equal(markup.match(/>Connect<\/button>/gu)?.length, JUNCTION_DEFAULT_PROVIDER_FILTER.length);
  assert.equal(markup.match(/>Not available<\/button>/gu)?.length ?? 0, 0);
  assert.doesNotMatch(markup, />Accu-Chek</u);
  assert.doesNotMatch(markup, />Samsung Health</u);

  const { listVisibleConnectSources } = await import("../app/(dashboard)/connect/page");
  const visibleSourceIds = new Set(listVisibleConnectSources().map((source) => source.id));
  const configuredSourceIds = new Set(
    (await import("@murphai/device-syncd/config")).DEVICE_CONNECT_SOURCES
      .filter((source) => visibleSourceIds.has(source.connectSourceId))
      .map((source) => source.connectSourceId),
  );
  assert.deepEqual([...visibleSourceIds].sort(), [...configuredSourceIds].sort());

  const logo = { className: "size-11 object-contain", height: 44, src: "/logo.png", width: 44 };
  const resolvedConnectSources = resolveConfiguredConnectSources([
    {
      id: "dexcom-g6-and-older",
      name: "Dexcom (G6 and older)",
      description: "Legacy Dexcom.",
      logo,
    },
    {
      id: "dexcom",
      name: "Dexcom",
      description: "Current Dexcom.",
      logo,
    },
    {
      id: "mapmyfitness",
      name: "MapMyFitness",
      description: "Workouts.",
      logo,
    },
    {
      id: "accuchek",
      name: "Accu-Chek",
      description: "Glucose meter.",
      logo,
    },
  ]);
  assert.deepEqual(resolvedConnectSources.map((source) => source.id), [
    "dexcom",
    "dexcom-g6-and-older",
    "mapmyfitness",
    "accuchek",
  ]);
  assert.deepEqual(
    Object.fromEntries(resolvedConnectSources.map((source) => [source.id, source.connectTarget])),
    {
      accuchek: undefined,
      dexcom: "dexcom_v3",
      "dexcom-g6-and-older": "dexcom",
      mapmyfitness: "map_my_fitness",
    },
  );
});

test("ConnectPage enables mapped Junction Link source slugs only", async () => {
  vi.stubEnv("JUNCTION_API_KEY", "sk_us_junction-test");
  vi.stubEnv("JUNCTION_CLIENT_USER_ID_SECRET", "junction-client-user-id-secret");
  vi.stubEnv("JUNCTION_ENV", "sandbox");
  vi.stubEnv("JUNCTION_PROVIDER_FILTER", "map_my_fitness,beurer_api");
  vi.stubEnv("JUNCTION_REGION", "us");

  const { default: ConnectPage } = await import("../app/(dashboard)/connect/page");
  const markup = renderToStaticMarkup(await ConnectPage());

  assert.match(markup, /aria-label="Connect MapMyFitness"/u);
  assert.match(markup, /aria-label="Connect Beurer"/u);
  assert.match(markup, /aria-label="Garmin connection is not available yet"/u);
  assert.doesNotMatch(markup, />Accu-Chek</u);
  assert.doesNotMatch(markup, /aria-label="Connect Accu-Chek"/u);
  assert.equal(markup.match(/>Connect<\/button>/gu)?.length, 2);
});

test("ConnectSourcesGrid posts mapped Junction connect targets", async () => {
  vi.stubEnv("JUNCTION_API_KEY", "sk_us_junction-test");
  vi.stubEnv("JUNCTION_CLIENT_USER_ID_SECRET", "junction-client-user-id-secret");
  vi.stubEnv("JUNCTION_ENV", "sandbox");
  vi.stubEnv("JUNCTION_PROVIDER_FILTER", "dexcom_v3");
  vi.stubEnv("JUNCTION_REGION", "us");

  const fetch = vi.fn(async (
    _input: RequestInfo | URL,
    _init?: RequestInit,
  ) => {
    void _input;
    void _init;
    return Response.json({
      authorizationUrl: "https://junction.example.test/link/dexcom-v3",
    });
  });
  vi.stubGlobal("fetch", fetch);

  const { resolveConfiguredConnectSources } = await import("../app/(dashboard)/connect/page");
  const { ConnectSourcesGrid } = await import("../app/(dashboard)/connect/connect-page-client");
  const logo = { className: "size-11 object-contain", height: 44, src: "/logo.png", width: 44 };
  const [source] = resolveConfiguredConnectSources([
    {
      id: "dexcom",
      name: "Dexcom",
      description: "Current Dexcom.",
      logo,
    },
  ]);
  assert.ok(source);
  assert.equal(source.connectTarget, "dexcom_v3");

  const rendered = await renderClientComponent(createElement(ConnectSourcesGrid, {
    sources: [source],
  }));

  await act(async () => {
    rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });

  assert.equal(fetch.mock.calls[0]?.[0], "/api/connect-sources/dexcom/start");
  assert.deepEqual(fetch.mock.calls[0]?.[1], {
    body: JSON.stringify({ connectTarget: "dexcom_v3" }),
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
    keepalive: false,
  });
  assert.equal(rendered.assign.mock.calls[0]?.[0], "https://junction.example.test/link/dexcom-v3");

  await rendered.cleanup();
});

test("ConnectPage marks direct and Junction upstream sources connected from hosted state", async () => {
  vi.stubEnv("JUNCTION_API_KEY", "sk_us_junction-test");
  vi.stubEnv("JUNCTION_CLIENT_USER_ID_SECRET", "junction-client-user-id-secret");
  vi.stubEnv("JUNCTION_ENV", "sandbox");
  vi.stubEnv("JUNCTION_PROVIDER_FILTER", "oura,strava");
  vi.stubEnv("JUNCTION_REGION", "us");
  vi.stubEnv("WHOOP_CLIENT_ID", "whoop-client-id");
  vi.stubEnv("WHOOP_CLIENT_SECRET", "whoop-client-secret");

  mocks.buildHostedDeviceSyncSettingsResponse.mockResolvedValueOnce({
    generatedAt: "2026-05-01T00:00:00.000Z",
    ok: true,
    sources: [
      {
        connectionId: "dsc_junction_123",
        provider: "junction",
        state: "active",
        upstreamSources: [
          {
            providerLabel: "Oura",
            resourceCount: 3,
            sourceProviderSlug: "oura",
            status: "connected",
          },
        ],
      },
      {
        connectionId: "dsc_whoop_123",
        provider: "whoop",
        state: "active",
        upstreamSources: [],
      },
    ],
  });

  const { default: ConnectPage } = await import("../app/(dashboard)/connect/page");
  const markup = renderToStaticMarkup(await ConnectPage());

  assert.match(markup, /Oura connected/);
  assert.match(markup, /Whoop connected/);
  assert.equal(markup.match(/data-connection-state="connected"/gu)?.length, 2);
  assert.match(markup, /aria-label="Disconnect Oura"/u);
  assert.match(markup, /aria-label="Disconnect Whoop"/u);
  assert.ok(sourceHeadingIndex(markup, "Oura") < sourceHeadingIndex(markup, "Whoop"));
  assert.ok(sourceHeadingIndex(markup, "Whoop") < sourceHeadingIndex(markup, "Garmin"));
  assert.doesNotMatch(markup, /aria-label="Connect Oura"/u);
  assert.doesNotMatch(markup, /aria-label="Connect Whoop"/u);
});

test("ConnectPage ignores disconnected Junction upstream projections on active connections", async () => {
  vi.stubEnv("JUNCTION_API_KEY", "sk_us_junction-test");
  vi.stubEnv("JUNCTION_CLIENT_USER_ID_SECRET", "junction-client-user-id-secret");
  vi.stubEnv("JUNCTION_ENV", "sandbox");
  vi.stubEnv("JUNCTION_PROVIDER_FILTER", "garmin,oura");
  vi.stubEnv("JUNCTION_REGION", "us");

  mocks.buildHostedDeviceSyncSettingsResponse.mockResolvedValueOnce({
    generatedAt: "2026-05-01T00:00:00.000Z",
    ok: true,
    sources: [
      {
        connectionId: "dsc_junction_123",
        provider: "junction",
        state: "active",
        upstreamSources: [
          {
            providerLabel: "Garmin",
            resourceCount: 2,
            sourceProviderSlug: "garmin",
            status: "disconnected",
          },
          {
            providerLabel: "Oura",
            resourceCount: 3,
            sourceProviderSlug: "oura",
            status: "connected",
          },
        ],
      },
    ],
  });

  const { default: ConnectPage } = await import("../app/(dashboard)/connect/page");
  const markup = renderToStaticMarkup(await ConnectPage());

  assert.match(markup, /Oura connected/u);
  assert.match(markup, /Garmin not connected/u);
  assert.match(markup, /aria-label="Disconnect Oura"/u);
  assert.match(markup, /aria-label="Connect Garmin"/u);
  assert.equal(markup.match(/data-connection-state="connected"/gu)?.length, 1);
  assert.ok(sourceHeadingIndex(markup, "Oura") < sourceHeadingIndex(markup, "Garmin"));
  assert.doesNotMatch(markup, /Garmin connected/u);
  assert.doesNotMatch(markup, /aria-label="Disconnect Garmin"/u);
});

test("ConnectPage surfaces reauthorization-required sources as reconnectable", async () => {
  vi.stubEnv("WHOOP_CLIENT_ID", "whoop-client-id");
  vi.stubEnv("WHOOP_CLIENT_SECRET", "whoop-client-secret");

  mocks.buildHostedDeviceSyncSettingsResponse.mockResolvedValueOnce({
    generatedAt: "2026-05-01T00:00:00.000Z",
    ok: true,
    sources: [
      {
        connectionId: "dsc_whoop_123",
        provider: "whoop",
        state: "reauthorization_required",
        upstreamSources: [],
      },
    ],
  });

  const { default: ConnectPage } = await import("../app/(dashboard)/connect/page");
  const markup = renderToStaticMarkup(await ConnectPage());

  assert.match(markup, /Whoop needs reconnect/);
  assert.match(markup, /Please reconnect Whoop to resume syncing\./u);
  assert.match(markup, /data-connection-state="needs-access"/u);
  assert.match(markup, /aria-label="Reconnect Whoop"/u);
  assert.doesNotMatch(markup, /aria-label="Disconnect Whoop"/u);
  assert.doesNotMatch(markup, /aria-label="Connect Whoop"/u);
});

test("ConnectPage keeps disconnected sources quiet and connectable", async () => {
  vi.stubEnv("WHOOP_CLIENT_ID", "whoop-client-id");
  vi.stubEnv("WHOOP_CLIENT_SECRET", "whoop-client-secret");

  mocks.buildHostedDeviceSyncSettingsResponse.mockResolvedValueOnce({
    generatedAt: "2026-05-01T00:00:00.000Z",
    ok: true,
    sources: [
      {
        connectionId: "dsc_whoop_123",
        provider: "whoop",
        state: "disconnected",
        upstreamSources: [],
      },
    ],
  });

  const { default: ConnectPage } = await import("../app/(dashboard)/connect/page");
  const markup = renderToStaticMarkup(await ConnectPage());

  assert.match(markup, /Whoop not connected/);
  assert.match(markup, /data-connection-state="idle"/u);
  assert.match(markup, /aria-label="Connect Whoop"/u);
  assert.doesNotMatch(markup, /Please reconnect Whoop to resume syncing\./u);
  assert.doesNotMatch(markup, /aria-label="Reconnect Whoop"/u);
  assert.doesNotMatch(markup, /aria-label="Disconnect Whoop"/u);
});

test("ConnectPage surfaces active sources with reconnect action as reconnectable", async () => {
  vi.stubEnv("WHOOP_CLIENT_ID", "whoop-client-id");
  vi.stubEnv("WHOOP_CLIENT_SECRET", "whoop-client-secret");

  mocks.buildHostedDeviceSyncSettingsResponse.mockResolvedValueOnce({
    generatedAt: "2026-05-01T00:00:00.000Z",
    ok: true,
    sources: [
      {
        connectionId: "dsc_whoop_123",
        primaryAction: {
          kind: "reconnect",
          label: "Reconnect",
        },
        provider: "whoop",
        state: "active",
        upstreamSources: [],
      },
    ],
  });

  const { default: ConnectPage } = await import("../app/(dashboard)/connect/page");
  const markup = renderToStaticMarkup(await ConnectPage());

  assert.match(markup, /Whoop needs reconnect/);
  assert.match(markup, /Please reconnect Whoop to resume syncing\./u);
  assert.match(markup, /data-connection-state="needs-access"/u);
  assert.match(markup, /aria-label="Reconnect Whoop"/u);
  assert.doesNotMatch(markup, /aria-label="Disconnect Whoop"/u);
  assert.doesNotMatch(markup, /Whoop connected/u);
  assert.doesNotMatch(markup, /aria-label="Connect Whoop"/u);
});

test("ConnectPage lets active state win when duplicate rows mention the same source", async () => {
  const { resolveConnectSourceConnectionStates } = await import("../app/(dashboard)/connect/page");

  assert.deepEqual(
    resolveConnectSourceConnectionStates([{ id: "whoop" }], [
      {
        connectionId: "dsc_whoop_reauth",
        provider: "whoop",
        state: "reauthorization_required",
        upstreamSources: [],
      },
      {
        connectionId: "dsc_whoop_disconnected",
        provider: "whoop",
        state: "disconnected",
        upstreamSources: [],
      },
      {
        connectionId: "dsc_whoop_active",
        provider: "whoop",
        state: "active",
        upstreamSources: [],
      },
    ]),
    [{
      connectionId: "dsc_whoop_active",
      connectProvider: "whoop",
      connectTarget: null,
      requiresReconnect: false,
      sourceId: "whoop",
      state: "active",
    }],
  );
});

test("ConnectPage preserves reconnect action on active source matches", async () => {
  const { resolveConnectSourceConnectionStates } = await import("../app/(dashboard)/connect/page");

  assert.deepEqual(
    resolveConnectSourceConnectionStates([{ id: "whoop" }], [
      {
        connectionId: "dsc_whoop_active_error",
        primaryAction: {
          kind: "reconnect",
          label: "Reconnect",
        },
        provider: "whoop",
        state: "active",
        upstreamSources: [],
      },
    ]),
    [{
      connectionId: "dsc_whoop_active_error",
      connectProvider: "whoop",
      connectTarget: null,
      requiresReconnect: true,
      sourceId: "whoop",
      state: "active",
    }],
  );
});

test("ConnectPage lets Junction source reconnect win over healthy duplicate direct source", async () => {
  const { resolveConnectSourceConnectionStates } = await import("../app/(dashboard)/connect/page");

  assert.deepEqual(
    resolveConnectSourceConnectionStates([{ id: "whoop" }], [
      {
        connectionId: "dsc_direct_whoop",
        provider: "whoop",
        state: "active",
        upstreamSources: [],
      },
      {
        connectionId: "dsc_junction_whoop",
        provider: "junction",
        state: "active",
        upstreamSources: [
          {
            connectProvider: "junction",
            connectSourceId: "whoop",
            connectTarget: "whoop",
            providerLabel: "WHOOP",
            requiresReconnect: true,
            resourceCount: 3,
            sourceProviderSlug: "whoop_v2",
            status: "error",
          },
        ],
      },
    ]),
    [{
      connectionId: "dsc_junction_whoop",
      connectProvider: "junction",
      connectTarget: "whoop",
      requiresReconnect: true,
      sourceId: "whoop",
      state: "active",
    }],
  );
});

test("ConnectPage keeps healthy Junction child sources connected when another child needs reconnect", async () => {
  const { resolveConnectSourceConnectionStates } = await import("../app/(dashboard)/connect/page");

  assert.deepEqual(
    resolveConnectSourceConnectionStates([{ id: "garmin" }, { id: "whoop" }], [
      {
        connectionId: "dsc_junction_multi",
        connectSourceId: "whoop",
        connectTarget: "whoop",
        primaryAction: {
          kind: "reconnect",
          label: "Reconnect",
        },
        provider: "junction",
        state: "active",
        upstreamSources: [
          {
            providerLabel: "Garmin",
            resourceCount: 2,
            sourceProviderSlug: "garmin",
            status: "connected",
          },
          {
            providerLabel: "WHOOP",
            requiresReconnect: true,
            resourceCount: 3,
            sourceProviderSlug: "whoop_v2",
            status: "error",
          },
        ],
      },
    ]),
    [
      {
        connectionId: "dsc_junction_multi",
        connectProvider: "junction",
        connectTarget: "whoop",
        requiresReconnect: true,
        sourceId: "whoop",
        state: "active",
      },
      {
        connectionId: "dsc_junction_multi",
        connectProvider: "junction",
        connectTarget: null,
        requiresReconnect: false,
        sourceId: "garmin",
        state: "active",
      },
    ],
  );
});

test("ConnectPage gives each reconnect-required Junction child its own target", async () => {
  const { resolveConnectSourceConnectionStates } = await import("../app/(dashboard)/connect/page");

  assert.deepEqual(
    resolveConnectSourceConnectionStates([{ id: "garmin" }, { id: "whoop" }], [
      {
        connectionId: "dsc_junction_multi",
        connectSourceId: "whoop",
        connectTarget: "whoop",
        primaryAction: {
          kind: "reconnect",
          label: "Reconnect",
        },
        provider: "junction",
        state: "active",
        upstreamSources: [
          {
            connectProvider: "junction",
            connectSourceId: "garmin",
            connectTarget: "garmin",
            providerLabel: "Garmin",
            requiresReconnect: true,
            resourceCount: 2,
            sourceProviderSlug: "garmin",
            status: "error",
          },
          {
            connectProvider: "junction",
            connectSourceId: "whoop",
            connectTarget: "whoop",
            providerLabel: "WHOOP",
            requiresReconnect: true,
            resourceCount: 3,
            sourceProviderSlug: "whoop_v2",
            status: "error",
          },
        ],
      },
    ]),
    [
      {
        connectionId: "dsc_junction_multi",
        connectProvider: "junction",
        connectTarget: "whoop",
        requiresReconnect: true,
        sourceId: "whoop",
        state: "active",
      },
      {
        connectionId: "dsc_junction_multi",
        connectProvider: "junction",
        connectTarget: "garmin",
        requiresReconnect: true,
        sourceId: "garmin",
        state: "active",
      },
    ],
  );
});

test("ConnectPage lets active reconnect rows win over stale reconnectable rows", async () => {
  const { resolveConnectSourceConnectionStates } = await import("../app/(dashboard)/connect/page");

  assert.deepEqual(
    resolveConnectSourceConnectionStates([{ id: "whoop" }], [
      {
        connectionId: "dsc_whoop_reauth",
        provider: "whoop",
        state: "reauthorization_required",
        upstreamSources: [],
      },
      {
        connectionId: "dsc_whoop_active_error",
        primaryAction: {
          kind: "reconnect",
          label: "Reconnect",
        },
        provider: "whoop",
        state: "active",
        upstreamSources: [],
      },
    ]),
    [{
      connectionId: "dsc_whoop_active_error",
      connectProvider: "whoop",
      connectTarget: null,
      requiresReconnect: true,
      sourceId: "whoop",
      state: "active",
    }],
  );
});

test("ConnectPage treats Junction reauthorization as reconnectable even when upstream status is stale", async () => {
  vi.stubEnv("JUNCTION_API_KEY", "sk_us_junction-test");
  vi.stubEnv("JUNCTION_CLIENT_USER_ID_SECRET", "junction-client-user-id-secret");
  vi.stubEnv("JUNCTION_ENV", "sandbox");
  vi.stubEnv("JUNCTION_PROVIDER_FILTER", "oura");
  vi.stubEnv("JUNCTION_REGION", "us");

  mocks.buildHostedDeviceSyncSettingsResponse.mockResolvedValueOnce({
    generatedAt: "2026-05-01T00:00:00.000Z",
    ok: true,
    sources: [
      {
        connectionId: "dsc_junction_123",
        provider: "junction",
        state: "reauthorization_required",
        upstreamSources: [
          {
            providerLabel: "Oura",
            resourceCount: 1,
            sourceProviderSlug: "oura",
            status: "unavailable",
          },
        ],
      },
    ],
  });

  const { default: ConnectPage } = await import("../app/(dashboard)/connect/page");
  const markup = renderToStaticMarkup(await ConnectPage());

  assert.match(markup, /Oura needs reconnect/);
  assert.match(markup, /aria-label="Reconnect Oura"/u);
});

test("resolveConnectedConnectSourceConnections carries connection ids for direct and Junction matches", async () => {
  const { resolveConnectedConnectSourceConnections } = await import("../app/(dashboard)/connect/page");
  const sources = [
    { id: "oura" },
    { id: "whoop" },
    { id: "garmin" },
  ];

  assert.deepEqual(
    resolveConnectedConnectSourceConnections(sources, [
      {
        connectionId: "dsc_junction_123",
        provider: "junction",
        state: "active",
        upstreamSources: [
          {
            providerLabel: "Oura",
            resourceCount: 1,
            sourceProviderSlug: "oura",
            status: "connected",
          },
          {
            providerLabel: "Garmin",
            resourceCount: 1,
            sourceProviderSlug: "garmin",
            status: "unavailable",
          },
        ],
      },
      {
        connectionId: "dsc_whoop_123",
        provider: "whoop",
        state: "active",
        upstreamSources: [],
      },
    ]),
    [
      { connectionId: "dsc_junction_123", sourceId: "oura" },
      { connectionId: "dsc_whoop_123", sourceId: "whoop" },
    ],
  );
});

test("ConnectPage keeps disconnected Junction sources quiet and connectable", async () => {
  vi.stubEnv("JUNCTION_API_KEY", "sk_us_junction-test");
  vi.stubEnv("JUNCTION_CLIENT_USER_ID_SECRET", "junction-client-user-id-secret");
  vi.stubEnv("JUNCTION_ENV", "sandbox");
  vi.stubEnv("JUNCTION_PROVIDER_FILTER", "oura");
  vi.stubEnv("JUNCTION_REGION", "us");

  mocks.buildHostedDeviceSyncSettingsResponse.mockResolvedValueOnce({
    generatedAt: "2026-05-01T00:00:00.000Z",
    ok: true,
    sources: [
      {
        connectionId: "dsc_junction_disconnected",
        provider: "junction",
        state: "disconnected",
        upstreamSources: [
          {
            providerLabel: "Oura",
            resourceCount: 3,
            sourceProviderSlug: "oura",
            status: "connected",
          },
        ],
      },
    ],
  });

  const { default: ConnectPage } = await import("../app/(dashboard)/connect/page");
  const markup = renderToStaticMarkup(await ConnectPage());

  assert.match(markup, /Oura not connected/);
  assert.match(markup, /data-connection-state="idle"/u);
  assert.match(markup, /aria-label="Connect Oura"/u);
  assert.doesNotMatch(markup, /Oura needs reconnect/u);
  assert.doesNotMatch(markup, /aria-label="Reconnect Oura"/u);
  assert.doesNotMatch(markup, /aria-label="Disconnect Oura"/u);
});

test("ConnectPage keeps configured sources visible but renders sign-in actions when signed out", async () => {
  vi.stubEnv("JUNCTION_API_KEY", "sk_us_junction-test");
  vi.stubEnv("JUNCTION_CLIENT_USER_ID_SECRET", "junction-client-user-id-secret");
  vi.stubEnv("JUNCTION_ENV", "sandbox");
  vi.stubEnv("JUNCTION_PROVIDER_FILTER", "garmin");
  vi.stubEnv("JUNCTION_REGION", "us");
  mocks.getHostedPageAuthSnapshot.mockResolvedValueOnce({
    authenticated: false,
    authenticatedMember: null,
    linkedAccounts: [],
    memberLookup: null,
    session: null,
  });

  const { default: ConnectPage } = await import("../app/(dashboard)/connect/page");
  const markup = renderToStaticMarkup(await ConnectPage());

  assert.match(markup, />Sign in<\/button>/);
  assert.match(markup, /Sign in to connect Garmin/);
  assert.doesNotMatch(markup, /aria-label="Connect Garmin"/u);
  expectSettingResponseNotLoaded();
});

test("ConnectSourcesGrid opens auth for a pending device connect intent while signed out without a pre-auth source target", async () => {
  const claim = "dc_12345678901234567890123456789012";
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);

  const { AuthProvider } = await import(
    "@/src/components/hosted-onboarding/auth-dialog-provider"
  );
  const { ConnectSourcesGrid } = await import("../app/(dashboard)/connect/connect-page-client");
  const rendered = await renderClientComponent(
    createElement(AuthProvider, { authenticated: false },
      createElement(ConnectSourcesGrid, {
        authenticated: false,
        sources: [
          {
            description: "Recovery, strain, sleep, and heart rate.",
            id: "whoop",
            logo: {
              className: "h-auto max-h-7 w-auto max-w-[8rem] object-contain",
              height: 15,
              src: "/brand-logos/connect/whoop.svg",
              width: 96,
            },
            name: "Whoop",
          },
        ],
      }),
    ),
    {
      location: {
        hash: `#deviceConnectIntent=${claim}&connectSource=whoop`,
        href: `https://join.example.test/connect#deviceConnectIntent=${claim}&connectSource=whoop`,
        pathname: "/connect",
        search: "",
      },
      requireButton: false,
    },
  );

  await vi.waitFor(() => {
    assert.equal(mocks.authDialogProps?.open, true);
    assert.match(rendered.container.textContent ?? "", /Auth dialog/);
  });

  assert.equal(fetch.mock.calls.length, 0);

  await rendered.cleanup();
});

test("ConnectSourcesGrid ignores malformed pending device connect intents while signed out", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);

  const { AuthProvider } = await import(
    "@/src/components/hosted-onboarding/auth-dialog-provider"
  );
  const { ConnectSourcesGrid } = await import("../app/(dashboard)/connect/connect-page-client");
  const rendered = await renderClientComponent(
    createElement(AuthProvider, { authenticated: false },
      createElement(ConnectSourcesGrid, {
        authenticated: false,
        sources: [
          {
            connectTarget: "whoop",
            description: "Recovery, strain, sleep, and heart rate.",
            id: "whoop",
            logo: {
              className: "h-auto max-h-7 w-auto max-w-[8rem] object-contain",
              height: 15,
              src: "/brand-logos/connect/whoop.svg",
              width: 96,
            },
            name: "Whoop",
          },
        ],
      }),
    ),
    {
      location: {
        hash: "#deviceConnectIntent=not-a-claim&connectSource=whoop",
        href: "https://join.example.test/connect#deviceConnectIntent=not-a-claim&connectSource=whoop",
        pathname: "/connect",
        search: "",
      },
      requireButton: false,
    },
  );

  assert.equal(mocks.authDialogProps?.open, false);
  assert.doesNotMatch(rendered.container.textContent ?? "", /Auth dialog/);
  assert.equal(fetch.mock.calls.length, 0);

  await rendered.cleanup();
});

test("ConnectSourcesGrid ignores unmatched pending device connect intents while signed out", async () => {
  const claim = "dc_12345678901234567890123456789012";
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);

  const { AuthProvider } = await import(
    "@/src/components/hosted-onboarding/auth-dialog-provider"
  );
  const { ConnectSourcesGrid } = await import("../app/(dashboard)/connect/connect-page-client");
  const rendered = await renderClientComponent(
    createElement(AuthProvider, { authenticated: false },
      createElement(ConnectSourcesGrid, {
        authenticated: false,
        sources: [
          {
            connectTarget: "whoop",
            description: "Recovery, strain, sleep, and heart rate.",
            id: "whoop",
            logo: {
              className: "h-auto max-h-7 w-auto max-w-[8rem] object-contain",
              height: 15,
              src: "/brand-logos/connect/whoop.svg",
              width: 96,
            },
            name: "Whoop",
          },
        ],
      }),
    ),
    {
      location: {
        hash: `#deviceConnectIntent=${claim}&connectSource=garmin`,
        href: `https://join.example.test/connect#deviceConnectIntent=${claim}&connectSource=garmin`,
        pathname: "/connect",
        search: "",
      },
      requireButton: false,
    },
  );

  assert.equal(mocks.authDialogProps?.open, false);
  assert.doesNotMatch(rendered.container.textContent ?? "", /Auth dialog/);
  assert.equal(fetch.mock.calls.length, 0);

  await rendered.cleanup();
});

test("ConnectSourcesGrid starts a configured Garmin target and redirects to the returned link", async () => {
  const fetch = vi.fn(async (
    _input: RequestInfo | URL,
    _init?: RequestInit,
  ) => {
    void _input;
    void _init;
    return Response.json({
      authorizationUrl: "https://junction.example.test/link/garmin",
    });
  });
  vi.stubGlobal("fetch", fetch);
  const { ConnectSourcesGrid } = await import("../app/(dashboard)/connect/connect-page-client");
  const rendered = await renderClientComponent(createElement(ConnectSourcesGrid, {
    sources: [
      {
        connectTarget: "garmin",
        description: "Workouts, sleep, stress, heart rate, and body battery.",
        id: "garmin",
        logo: {
          className: "size-11 object-contain",
          height: 44,
          src: "/brand-logos/connect/garmin.png",
          width: 44,
        },
        name: "Garmin",
      },
    ],
  }));

  assert.equal(rendered.button.disabled, false);
  assert.equal(rendered.button.textContent, "Connect");

  await act(async () => {
    rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });

  assert.equal(fetch.mock.calls[0]?.[0], "/api/connect-sources/garmin/start");
  assert.deepEqual(fetch.mock.calls[0]?.[1], {
    body: JSON.stringify({ connectTarget: "garmin" }),
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
    keepalive: false,
  });
  assert.equal(rendered.assign.mock.calls[0]?.[0], "https://junction.example.test/link/garmin");

  await rendered.cleanup();
});

test("ConnectSourcesGrid redeems an initial device connect intent through the app page", async () => {
  const claim = "dc_12345678901234567890123456789012";
  const fetch = vi.fn(async (
    _input: RequestInfo | URL,
    _init?: RequestInit,
  ) => {
    void _input;
    void _init;
    return Response.json({
      authorizationUrl: "https://provider.example.test/oauth/start",
    });
  });
  vi.stubGlobal("fetch", fetch);

  const { ConnectSourcesGrid } = await import("../app/(dashboard)/connect/connect-page-client");
  const rendered = await renderClientComponent(createElement(ConnectSourcesGrid, {
    sources: [
      {
        description: "Recovery, strain, sleep, and heart rate.",
        id: "whoop",
        logo: {
          className: "h-auto max-h-7 w-auto max-w-[8rem] object-contain",
          height: 15,
          src: "/brand-logos/connect/whoop.svg",
          width: 96,
        },
        name: "Whoop",
      },
    ],
  }), {
    location: {
      hash: `#deviceConnectIntent=${claim}&connectSource=whoop`,
      href: `https://join.example.test/connect#deviceConnectIntent=${claim}&connectSource=whoop`,
    },
  });

  await vi.waitFor(() => {
    assert.equal(fetch.mock.calls.length, 1);
    assert.equal(rendered.assign.mock.calls[0]?.[0], "https://provider.example.test/oauth/start");
  });

  assert.equal(fetch.mock.calls[0]?.[0], `/device/connect/${claim}`);
  assert.deepEqual(fetch.mock.calls[0]?.[1], {
    body: undefined,
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      accept: "application/json",
    },
    method: "POST",
    keepalive: false,
  });

  await rendered.cleanup();
});

test("ConnectSourcesGrid shows a recovery dialog when a device connect intent is unavailable", async () => {
  const claim = "dc_12345678901234567890123456789012";
  const fetch = vi.fn(async () =>
    Response.json({
      error: {
        code: "HOSTED_DEVICE_CONNECT_INTENT_MISSING",
        message: "This connection link could not be found. Ask Murph for a new one.",
        retryable: false,
      },
    }, { status: 410 }));
  vi.stubGlobal("fetch", fetch);

  const { ConnectSourcesGrid } = await import("../app/(dashboard)/connect/connect-page-client");
  const rendered = await renderClientComponent(createElement(ConnectSourcesGrid, {
    deviceConnectRecoveryContactAction: {
      href: "sms:+15550100001?body=Can%20you%20send%20me%20a%20fresh%20device%20connection%20link%3F",
      kind: "text",
      label: "Messages",
    },
    sources: [
      {
        description: "Recovery, strain, sleep, and heart rate.",
        id: "whoop",
        logo: {
          className: "h-auto max-h-7 w-auto max-w-[8rem] object-contain",
          height: 15,
          src: "/brand-logos/connect/whoop.svg",
          width: 96,
        },
        name: "Whoop",
      },
    ],
  }), {
    location: {
      hash: `#deviceConnectIntent=${claim}&connectSource=whoop`,
      href: `https://join.example.test/connect#deviceConnectIntent=${claim}&connectSource=whoop`,
    },
  });

  await vi.waitFor(() => {
    assert.equal(fetch.mock.calls.length, 1);
    assert.match(rendered.container.textContent ?? "", /Connection link unavailable/);
    assert.match(
      rendered.container.textContent ?? "",
      /This connection link could not be found\. Ask Murph for a new one\./,
    );
  });

  const contactLink = rendered.container.querySelector("a[href^='sms:']");
  assert.ok(contactLink instanceof rendered.window.HTMLAnchorElement);
  assert.equal(contactLink.textContent, "Text Murph");
  assert.match(
    contactLink.getAttribute("aria-label") ?? "",
    /fresh Whoop connection link/,
  );
  assert.equal(rendered.assign.mock.calls.length, 0);

  await rendered.cleanup();
});

test("ConnectSourcesGrid falls back to email when no preferred recovery contact action is available", async () => {
  const claim = "dc_12345678901234567890123456789012";
  const fetch = vi.fn(async () =>
    Response.json({
      error: {
        code: "HOSTED_DEVICE_CONNECT_INTENT_EXPIRED",
        message: "This connection link has expired. Ask Murph for a new one.",
        retryable: false,
      },
    }, { status: 410 }));
  vi.stubGlobal("fetch", fetch);

  const { ConnectSourcesGrid } = await import("../app/(dashboard)/connect/connect-page-client");
  const rendered = await renderClientComponent(createElement(ConnectSourcesGrid, {
    sources: [
      {
        description: "Recovery, strain, sleep, and heart rate.",
        id: "whoop",
        logo: {
          className: "h-auto max-h-7 w-auto max-w-[8rem] object-contain",
          height: 15,
          src: "/brand-logos/connect/whoop.svg",
          width: 96,
        },
        name: "Whoop",
      },
    ],
  }), {
    location: {
      hash: `#deviceConnectIntent=${claim}&connectSource=whoop`,
      href: `https://join.example.test/connect#deviceConnectIntent=${claim}&connectSource=whoop`,
    },
  });

  await vi.waitFor(() => {
    assert.match(rendered.container.textContent ?? "", /Connection link unavailable/);
  });

  const contactLink = rendered.container.querySelector("a[href^='mailto:']");
  assert.ok(contactLink instanceof rendered.window.HTMLAnchorElement);
  assert.equal(contactLink.textContent, "Email Murph");
  assert.match(contactLink.href, /Fresh%20device%20connection%20link/);
  assert.doesNotMatch(rendered.container.textContent ?? "", /Set up contact/);

  await rendered.cleanup();
});

test("ConnectSourcesGrid shows a pending-redirect dialog while an initial connect intent resolves", async () => {
  const claim = "dc_12345678901234567890123456789012";
  let resolveFetch: ((response: Response) => void) | undefined;
  const fetch = vi.fn(async () =>
    new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }));
  vi.stubGlobal("fetch", fetch);

  const { ConnectSourcesGrid } = await import("../app/(dashboard)/connect/connect-page-client");
  const rendered = await renderClientComponent(createElement(ConnectSourcesGrid, {
    sources: [
      {
        connectTarget: "whoop",
        description: "Recovery, strain, sleep, and heart rate.",
        id: "whoop",
        logo: {
          className: "h-auto max-h-7 w-auto max-w-[8rem] object-contain",
          height: 15,
          src: "/brand-logos/connect/whoop.svg",
          width: 96,
        },
        name: "Whoop",
      },
    ],
  }), {
    location: {
      hash: `#deviceConnectIntent=${claim}&connectSource=whoop`,
      href: `https://join.example.test/connect#deviceConnectIntent=${claim}&connectSource=whoop`,
    },
  });

  await vi.waitFor(() => {
    assert.equal(fetch.mock.calls.length, 1);
    assert.match(rendered.container.textContent ?? "", /Connecting Whoop/);
  });

  await act(async () => {
    resolveFetch?.(Response.json({
      authorizationUrl: "https://provider.example.test/oauth/start",
    }));
  });

  await vi.waitFor(() => {
    assert.equal(rendered.assign.mock.calls[0]?.[0], "https://provider.example.test/oauth/start");
  });

  await rendered.cleanup();
});

test("ConnectSourcesGrid hides the pending-redirect dialog when a connect intent needs consent", async () => {
  const claim = "dc_12345678901234567890123456789012";
  const fetch = vi.fn(async () =>
    Response.json({
      error: {
        code: "HOSTED_CONSENT_REQUIRED",
        message: "Accept the current Murph legal consent before continuing.",
      },
    }, { status: 403 }));
  vi.stubGlobal("fetch", fetch);

  const { ConnectSourcesGrid } = await import("../app/(dashboard)/connect/connect-page-client");
  const rendered = await renderClientComponent(createElement(ConnectSourcesGrid, {
    initialConnectIntent: {
      claim,
      connectSource: "whoop",
    },
    sources: [
      {
        connectTarget: "whoop",
        description: "Recovery, strain, sleep, and heart rate.",
        id: "whoop",
        logo: {
          className: "h-auto max-h-7 w-auto max-w-[8rem] object-contain",
          height: 15,
          src: "/brand-logos/connect/whoop.svg",
          width: 96,
        },
        name: "Whoop",
      },
    ],
  }));

  await vi.waitFor(() => {
    assert.equal(fetch.mock.calls.length, 1);
    assert.match(rendered.container.textContent ?? "", /Before you connect Whoop/);
  });

  assert.doesNotMatch(rendered.container.textContent ?? "", /Connecting Whoop/);

  await rendered.cleanup();
});

test("ConnectSourcesGrid preserves a device connect intent after consent acceptance", async () => {
  const claim = "dc_12345678901234567890123456789012";
  let attempts = 0;
  const fetch = vi.fn(async (
    input: RequestInfo | URL,
    _init?: RequestInit,
  ) => {
    void _init;
    if (input !== `/device/connect/${claim}`) {
      throw new Error(`Unexpected fetch: ${String(input)}`);
    }

    attempts += 1;
    if (attempts > 1) {
      return Response.json({
        authorizationUrl: "https://provider.example.test/oauth/start",
      });
    }

    return Response.json({
      error: {
        code: "HOSTED_CONSENT_REQUIRED",
        details: {
          missingScopes: ["launch.health-data"],
        },
        message: "Accept the current Murph legal consent before continuing.",
      },
    }, { status: 403 });
  });
  vi.stubGlobal("fetch", fetch);

  const { ConnectSourcesGrid } = await import("../app/(dashboard)/connect/connect-page-client");
  const rendered = await renderClientComponent(createElement(ConnectSourcesGrid, {
    initialConnectIntent: {
      claim,
      connectSource: "whoop",
    },
    sources: [
      {
        description: "Recovery, strain, sleep, and heart rate.",
        id: "whoop",
        logo: {
          className: "h-auto max-h-7 w-auto max-w-[8rem] object-contain",
          height: 15,
          src: "/brand-logos/connect/whoop.svg",
          width: 96,
        },
        name: "Whoop",
      },
    ],
  }));

  await vi.waitFor(() => {
    assert.equal(fetch.mock.calls.length, 1);
    assert.match(rendered.container.textContent ?? "", /Before you connect Whoop/);
  });

  const consentButton = rendered.container.querySelector("[data-hosted-legal-consent-card='true']");
  assert.ok(consentButton instanceof rendered.window.HTMLButtonElement);

  await act(async () => {
    consentButton.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });

  await vi.waitFor(() => {
    assert.equal(fetch.mock.calls.length, 2);
    assert.equal(rendered.assign.mock.calls[0]?.[0], "https://provider.example.test/oauth/start");
  });

  assert.equal(fetch.mock.calls[1]?.[0], `/device/connect/${claim}`);

  await rendered.cleanup();
});

test("ConnectSourcesGrid disconnects a connected source after confirmation", async () => {
  const fetch = vi.fn(async (
    _input: RequestInfo | URL,
    _init?: RequestInit,
  ) => {
    void _input;
    void _init;
    return Response.json({});
  });
  vi.stubGlobal("fetch", fetch);

  const { ConnectSourcesGrid } = await import("../app/(dashboard)/connect/connect-page-client");
  const rendered = await renderClientComponent(createElement(ConnectSourcesGrid, {
    sources: [
      {
        connectTarget: "whoop",
        connected: true,
        description: "Recovery, strain, sleep, and heart rate.",
        disconnectConnectionId: "dsc_whoop_123",
        id: "whoop",
        logo: {
          className: "h-auto max-h-7 w-auto max-w-[8rem] object-contain",
          height: 15,
          src: "/brand-logos/connect/whoop.svg",
          width: 96,
        },
        name: "Whoop",
      },
    ],
  }));

  const disconnectButton = rendered.container.querySelector("button[aria-label='Disconnect Whoop']");
  assert.ok(disconnectButton instanceof rendered.window.HTMLButtonElement);
  assert.equal(disconnectButton.textContent, "Disconnect");

  await act(async () => {
    disconnectButton.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });

  assert.match(rendered.container.textContent ?? "", /Disconnect Whoop\?/);
  const confirmButton = [...rendered.container.querySelectorAll("button")]
    .filter((button) => button.textContent === "Disconnect")
    .at(-1);
  assert.ok(confirmButton instanceof rendered.window.HTMLButtonElement);
  assert.equal(confirmButton.textContent, "Disconnect");

  await act(async () => {
    confirmButton.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });

  await vi.waitFor(() => {
    assert.equal(fetch.mock.calls.length, 1);
    assert.match(rendered.container.textContent ?? "", /Disconnected Whoop\. Your history is still saved\./);
  });

  assert.equal(fetch.mock.calls[0]?.[0], "/api/settings/device-sync/connections/dsc_whoop_123/disconnect");
  assert.deepEqual(fetch.mock.calls[0]?.[1], {
    body: undefined,
    cache: "no-store",
    credentials: "same-origin",
    headers: {},
    method: "POST",
    keepalive: false,
  });
  assert.match(rendered.container.textContent ?? "", /Whoop not connected/);
  assert.equal(rendered.container.querySelector("button[aria-label='Connect Whoop']")?.textContent, "Connect");

  await rendered.cleanup();
});

test("ConnectSourcesGrid shows reconnect guidance without a disconnect action", async () => {
  const fetch = vi.fn(async (
    _input: RequestInfo | URL,
    _init?: RequestInit,
  ) => {
    void _input;
    void _init;
    return Response.json({
      authorizationUrl: "https://provider.example.test/oauth/start",
    });
  });
  vi.stubGlobal("fetch", fetch);

  const { ConnectSourcesGrid } = await import("../app/(dashboard)/connect/connect-page-client");
  const rendered = await renderClientComponent(createElement(ConnectSourcesGrid, {
    sources: [
      {
        connectTarget: "whoop",
        description: "Recovery, strain, sleep, and heart rate.",
        disconnectConnectionId: "dsc_whoop_123",
        id: "whoop",
        logo: {
          className: "h-auto max-h-7 w-auto max-w-[8rem] object-contain",
          height: 15,
          src: "/brand-logos/connect/whoop.svg",
          width: 96,
        },
        name: "Whoop",
        requiresReconnect: true,
      },
    ],
  }));

  assert.match(rendered.container.textContent ?? "", /Please reconnect Whoop to resume syncing\./);
  assert.equal(rendered.container.querySelector("button[aria-label='Disconnect Whoop']"), null);
  const reconnectButton = rendered.container.querySelector("button[aria-label='Reconnect Whoop']");
  assert.ok(reconnectButton instanceof rendered.window.HTMLButtonElement);
  assert.equal(reconnectButton.textContent, "Reconnect");

  await act(async () => {
    reconnectButton.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });

  await vi.waitFor(() => {
    assert.equal(fetch.mock.calls.length, 1);
    assert.equal(rendered.assign.mock.calls[0]?.[0], "https://provider.example.test/oauth/start");
  });

  assert.equal(fetch.mock.calls[0]?.[0], "/api/connect-sources/whoop/start");
  assert.deepEqual(fetch.mock.calls[0]?.[1], {
    body: JSON.stringify({ connectTarget: "whoop" }),
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
    keepalive: false,
  });

  await rendered.cleanup();
});

test("ConnectSourcesGrid shows disconnect failures inside the confirmation dialog", async () => {
  const fetch = vi.fn(async (
    _input: RequestInfo | URL,
    _init?: RequestInit,
  ) => {
    void _input;
    void _init;
    return Response.json({
      error: {
        code: "DEVICE_SYNC_DISCONNECT_FAILED",
        message: "We could not disconnect Whoop right now.",
      },
    }, { status: 502 });
  });
  vi.stubGlobal("fetch", fetch);

  const { ConnectSourcesGrid } = await import("../app/(dashboard)/connect/connect-page-client");
  const rendered = await renderClientComponent(createElement(ConnectSourcesGrid, {
    sources: [
      {
        connectTarget: "whoop",
        connected: true,
        description: "Recovery, strain, sleep, and heart rate.",
        disconnectConnectionId: "dsc_whoop_123",
        id: "whoop",
        logo: {
          className: "h-auto max-h-7 w-auto max-w-[8rem] object-contain",
          height: 15,
          src: "/brand-logos/connect/whoop.svg",
          width: 96,
        },
        name: "Whoop",
      },
    ],
  }));

  const disconnectButton = rendered.container.querySelector("button[aria-label='Disconnect Whoop']");
  assert.ok(disconnectButton instanceof rendered.window.HTMLButtonElement);

  await act(async () => {
    disconnectButton.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });

  const confirmButton = [...rendered.container.querySelectorAll("button")]
    .filter((button) => button.textContent === "Disconnect")
    .at(-1);
  assert.ok(confirmButton instanceof rendered.window.HTMLButtonElement);

  await act(async () => {
    confirmButton.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });

  await vi.waitFor(() => {
    const alert = rendered.container.querySelector("[role='alert']");
    assert.ok(alert);
    assert.equal(alert.textContent, "We could not disconnect Whoop right now.");
  });
  assert.match(rendered.container.textContent ?? "", /Disconnect Whoop\?/);
  assert.match(rendered.container.textContent ?? "", /Whoop connected/);
  assert.equal(rendered.container.querySelector("button[aria-label='Connect Whoop']"), null);

  await rendered.cleanup();
});

test("ConnectSourcesGrid opens the consent dialog when connect start needs consent", async () => {
  let connectAttempts = 0;
  const fetch = vi.fn(async (
    input: RequestInfo | URL,
    _init?: RequestInit,
  ) => {
    void _init;
    if (input === "/api/connect-sources/garmin/start") {
      connectAttempts += 1;
      if (connectAttempts > 1) {
        return Response.json({
          authorizationUrl: "https://junction.example.test/link/garmin",
        });
      }

      return Response.json({
        error: {
          code: "HOSTED_CONSENT_REQUIRED",
          details: {
            missingScopes: ["launch.health-data"],
          },
          message: "Accept the current Murph legal consent before continuing.",
        },
      }, { status: 403 });
    }

    throw new Error(`Unexpected fetch: ${String(input)}`);
  });
  vi.stubGlobal("fetch", fetch);

  const { ConnectSourcesGrid } = await import("../app/(dashboard)/connect/connect-page-client");
  const rendered = await renderClientComponent(createElement(ConnectSourcesGrid, {
    sources: [
      {
        connectTarget: "garmin",
        description: "Workouts, sleep, stress, heart rate, and body battery.",
        id: "garmin",
        logo: {
          className: "size-11 object-contain",
          height: 44,
          src: "/brand-logos/connect/garmin.png",
          width: 44,
        },
        name: "Garmin",
      },
    ],
  }));

  await act(async () => {
    rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });

  await vi.waitFor(() => {
    assert.equal(fetch.mock.calls.length, 1);
    assert.match(rendered.container.textContent ?? "", /Before you connect Garmin/);
  });

  assert.equal(rendered.assign.mock.calls.length, 0);
  assert.match(
    rendered.container.innerHTML,
    /data-dialog-content="true"[^>]*class="max-w-md gap-6 p-6 md:p-7"/u,
  );
  assert.match(
    rendered.container.textContent ?? "",
    /Review Murph's current legal and health-data consent before continuing\./,
  );
  const consentButton = rendered.container.querySelector("[data-hosted-legal-consent-card='true']");
  assert.ok(consentButton instanceof rendered.window.HTMLButtonElement);
  assert.equal(consentButton.getAttribute("data-consent-mode"), "compact");
  assert.equal(consentButton.getAttribute("data-consent-scope"), null);
  assert.equal(consentButton.getAttribute("data-consent-source"), "connect-page");

  await act(async () => {
    consentButton.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });

  await vi.waitFor(() => {
    assert.equal(fetch.mock.calls.length, 2);
    assert.equal(rendered.assign.mock.calls[0]?.[0], "https://junction.example.test/link/garmin");
  });

  await rendered.cleanup();
});

test("ConnectSourcesGrid rejects malformed connect responses before redirecting", async () => {
  const fetch = vi.fn(async (
    _input: RequestInfo | URL,
    _init?: RequestInit,
  ) => {
    void _input;
    void _init;
    return Response.json({
      authorizationUrl: 42,
    });
  });
  vi.stubGlobal("fetch", fetch);
  const { ConnectSourcesGrid } = await import("../app/(dashboard)/connect/connect-page-client");
  const rendered = await renderClientComponent(createElement(ConnectSourcesGrid, {
    sources: [
      {
        connectTarget: "garmin",
        description: "Workouts, sleep, stress, heart rate, and body battery.",
        id: "garmin",
        logo: {
          className: "size-11 object-contain",
          height: 44,
          src: "/brand-logos/connect/garmin.png",
          width: 44,
        },
        name: "Garmin",
      },
    ],
  }));

  await act(async () => {
    rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });

  assert.equal(rendered.assign.mock.calls.length, 0);
  assert.match(rendered.container.textContent ?? "", /Connection could not be started\./);

  await rendered.cleanup();
});

test("ConnectSourcesGrid rejects unsafe connect response URLs before redirecting", async () => {
  const fetch = vi.fn(async (
    _input: RequestInfo | URL,
    _init?: RequestInit,
  ) => {
    void _input;
    void _init;
    return Response.json({
      authorizationUrl: "javascript:alert(1)",
    });
  });
  vi.stubGlobal("fetch", fetch);
  const { ConnectSourcesGrid } = await import("../app/(dashboard)/connect/connect-page-client");
  const rendered = await renderClientComponent(createElement(ConnectSourcesGrid, {
    sources: [
      {
        connectTarget: "garmin",
        description: "Workouts, sleep, stress, heart rate, and body battery.",
        id: "garmin",
        logo: {
          className: "size-11 object-contain",
          height: 44,
          src: "/brand-logos/connect/garmin.png",
          width: 44,
        },
        name: "Garmin",
      },
    ],
  }));

  await act(async () => {
    rendered.button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });

  assert.equal(rendered.assign.mock.calls.length, 0);
  assert.match(rendered.container.textContent ?? "", /Connection could not be started\./);

  await rendered.cleanup();
});

test("ConnectPage shows callback success with the original source label", async () => {
  mocks.buildHostedDeviceSyncSettingsResponse.mockResolvedValueOnce({
    generatedAt: "2026-05-01T00:00:00.000Z",
    ok: true,
    sources: [
      {
        connectionId: "dsc_junction_oura",
        provider: "junction",
        state: "active",
        upstreamSources: [
          {
            providerLabel: "Oura",
            resourceCount: 1,
            sourceProviderSlug: "oura",
            status: "connected",
          },
        ],
      },
    ],
  });

  const { default: ConnectPage } = await import("../app/(dashboard)/connect/page");
  const markup = renderToStaticMarkup(await ConnectPage({
    searchParams: Promise.resolve({
      connectSource: "oura",
      deviceSyncProvider: "junction",
      deviceSyncStatus: "connected",
    }),
  }));

  assert.match(markup, /Connected Oura\./);
  assert.match(markup, /data-connection-state="connected"/u);
  assert.ok(sourceHeadingIndex(markup, "Oura") < sourceHeadingIndex(markup, "Whoop"));
  assert.doesNotMatch(markup, /aria-label="Connect Oura"/u);
});

test("ConnectPage suppresses unverified connected callbacks from query params", async () => {
  const { default: ConnectPage } = await import("../app/(dashboard)/connect/page");
  const markup = renderToStaticMarkup(await ConnectPage({
    searchParams: Promise.resolve({
      connectSource: "oura",
      deviceSyncProvider: "junction",
      deviceSyncStatus: "connected",
    }),
  }));

  assert.doesNotMatch(markup, /Connected Oura\./);
  assert.match(markup, /Oura not connected/);
});

test("ConnectPage ignores connected callback status when callback source metadata is missing", async () => {
  const { default: ConnectPage } = await import("../app/(dashboard)/connect/page");
  const markup = renderToStaticMarkup(await ConnectPage({
    searchParams: Promise.resolve({
      deviceSyncProvider: "junction",
      deviceSyncStatus: "connected",
    }),
  }));

  assert.doesNotMatch(markup, /Connected your wearable source\./);
  assert.doesNotMatch(markup, /Junction/u);
});

test("ConnectPage shows callback errors with the original source label", async () => {
  const { default: ConnectPage } = await import("../app/(dashboard)/connect/page");
  const markup = renderToStaticMarkup(await ConnectPage({
    searchParams: Promise.resolve({
      connectSource: "oura",
      deviceSyncError: "OAUTH_STATE_INVALID",
      deviceSyncProvider: "junction",
      deviceSyncStatus: "error",
    }),
  }));

  assert.match(markup, /Unable to finish connection/);
  assert.match(markup, /Oura gave us an expired or invalid return from the last attempt\./);
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sourceHeadingIndex(markup: string, sourceName: string): number {
  const index = markup.indexOf(`>${sourceName}</h2>`);
  assert.notEqual(index, -1, `${sourceName} heading should exist`);
  return index;
}

function expectSettingResponseNotLoaded() {
  assert.equal(mocks.buildHostedDeviceSyncSettingsResponse.mock.calls.length, 0);
}
