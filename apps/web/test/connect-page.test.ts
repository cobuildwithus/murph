import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";

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

const mocks = vi.hoisted(() => ({
  buildHostedDeviceSyncSettingsResponse: vi.fn(),
  getHostedPageAuthSnapshot: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/settings-service", () => ({
  buildHostedDeviceSyncSettingsResponse: mocks.buildHostedDeviceSyncSettingsResponse,
}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
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
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("ConnectPage renders source search, source names, and logo marks", async () => {
  const { default: ConnectPage, metadata } = await import("../app/(dashboard)/connect/page");
  const markup = renderToStaticMarkup(await ConnectPage());

  assert.equal(metadata.title, "Connect Devices — Murph");
  assert.match(markup, /Connect your health/);
  assert.match(markup, /Live Well/);
  assert.match(markup, /placeholder="Search sources"/);
  assert.match(markup, /aria-label="Search sources"/);
  assert.match(markup, />32 of 32 sources</);
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
      assetPath: "/brand-logos/connect/samsung-health.png",
      description: "Samsung phone and watch activity, sleep, heart, and wellness metrics.",
      name: "Samsung Health",
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
      assetPath: "/brand-logos/connect/freestyle-libre-ble.png",
      description: "Bluetooth Libre glucose readings, trends, and sensor status in near real time.",
      name: "Freestyle Libre BLE",
    },
    {
      assetPath: "/brand-logos/connect/omron.png",
      description: "Blood pressure, pulse, weight, and connected home measurements from Omron.",
      name: "Omron",
    },
    {
      assetPath: "/brand-logos/connect/accuchek.svg",
      description: "Accu-Chek glucose readings, meter history, and diabetes tracking context records.",
      name: "Accu-Chek",
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
      assetPath: "/brand-logos/connect/contour-ble.png",
      description: "Bluetooth Contour glucose meter readings and diabetes tracking history records.",
      name: "Contour BLE",
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
      assetPath: "/brand-logos/connect/onetouch.png",
      description: "OneTouch glucose readings, meter history, and diabetes tracking record context.",
      name: "OneTouch",
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

  assert.equal(sources.length, 32);
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
  assert.doesNotMatch(markup, />Manual</u);
  assert.doesNotMatch(markup, /Whoop V2/u);

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

test("ConnectPage enables every source exposed by the shared Junction defaults", async () => {
  vi.stubEnv("JUNCTION_API_KEY", "sk_us_junction-test");
  vi.stubEnv("JUNCTION_CLIENT_USER_ID_SECRET", "junction-client-user-id-secret");
  vi.stubEnv("JUNCTION_ENV", "sandbox");
  vi.stubEnv("JUNCTION_PROVIDER_FILTER", "");
  vi.stubEnv("JUNCTION_REGION", "us");

  const { default: ConnectPage, resolveConfiguredConnectSources } = await import(
    "../app/(dashboard)/connect/page"
  );
  const markup = renderToStaticMarkup(await ConnectPage());

  assert.equal(markup.match(/>Connect<\/button>/gu)?.length, 32);
  assert.doesNotMatch(markup, />Not available<\/button>/u);

  const logo = { className: "size-11 object-contain", height: 44, src: "/logo.png", width: 44 };
  assert.deepEqual(
    resolveConfiguredConnectSources([
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
    ]).map((source) => source.connectTarget),
    ["dexcom", "dexcom_v3", "map_my_fitness"],
  );
});

test("ConnectPage enables mapped Junction source slugs", async () => {
  vi.stubEnv("JUNCTION_API_KEY", "sk_us_junction-test");
  vi.stubEnv("JUNCTION_CLIENT_USER_ID_SECRET", "junction-client-user-id-secret");
  vi.stubEnv("JUNCTION_ENV", "sandbox");
  vi.stubEnv("JUNCTION_PROVIDER_FILTER", "map_my_fitness,accuchek_ble");
  vi.stubEnv("JUNCTION_REGION", "us");

  const { default: ConnectPage } = await import("../app/(dashboard)/connect/page");
  const markup = renderToStaticMarkup(await ConnectPage());

  assert.match(markup, /aria-label="Connect MapMyFitness"/u);
  assert.match(markup, /aria-label="Connect Accu-Chek"/u);
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

  assert.equal(fetch.mock.calls[0]?.[0], "/api/settings/device-sync/providers/dexcom_v3/connect");
  assert.deepEqual(fetch.mock.calls[0]?.[1], {
    body: JSON.stringify({ returnTo: "/connect?connectTarget=dexcom_v3" }),
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
  assert.equal(markup.match(/>Connected<\/span>/gu)?.length, 2);
  assert.doesNotMatch(markup, /aria-label="Connect Oura"/u);
  assert.doesNotMatch(markup, /aria-label="Connect Whoop"/u);
});

test("ConnectPage ignores stale Junction upstream sources when the parent connection is not active", async () => {
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
  assert.match(markup, /aria-label="Connect Oura"/u);
});

test("ConnectPage keeps configured sources visible but disables connect actions when signed out", async () => {
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

  assert.match(markup, /Sign in first/);
  assert.match(markup, /Sign in to connect Garmin/);
  assert.match(markup, /Sign in to connect your health data sources\./);
  expectSettingResponseNotLoaded();
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

  assert.equal(fetch.mock.calls[0]?.[0], "/api/settings/device-sync/providers/garmin/connect");
  assert.deepEqual(fetch.mock.calls[0]?.[1], {
    body: JSON.stringify({ returnTo: "/connect?connectTarget=garmin" }),
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
  const { default: ConnectPage } = await import("../app/(dashboard)/connect/page");
  const markup = renderToStaticMarkup(await ConnectPage({
    searchParams: Promise.resolve({
      connectTarget: "oura",
      deviceSyncProvider: "junction",
      deviceSyncStatus: "connected",
    }),
  }));

  assert.match(markup, /Connected Oura\./);
});

test("ConnectPage shows callback errors with the original source label", async () => {
  const { default: ConnectPage } = await import("../app/(dashboard)/connect/page");
  const markup = renderToStaticMarkup(await ConnectPage({
    searchParams: Promise.resolve({
      connectTarget: "oura",
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

function expectSettingResponseNotLoaded() {
  assert.equal(mocks.buildHostedDeviceSyncSettingsResponse.mock.calls.length, 0);
}
