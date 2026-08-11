import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";

import type { HTMLAttributes, ReactNode } from "react";
import { act, Children, createElement, isValidElement } from "react";
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

vi.mock("@/src/components/ui/dialog", () => {
  let activeOnOpenChange: ((open: boolean) => void) | undefined;

  return {
    Dialog: ({
      children,
      onOpenChange,
      open,
    }: {
      children?: ReactNode;
      onOpenChange?: (open: boolean) => void;
      open?: boolean;
    }) => {
      if (!open) {
        return null;
      }
      activeOnOpenChange = onOpenChange;
      return createElement("div", { "data-dialog-open": "true" }, children);
    },
    DialogContent: ({
      children,
      className,
      showCloseButton = true,
    }: HTMLAttributes<HTMLDivElement> & { showCloseButton?: boolean }) =>
      createElement(
        "div",
        {
          className,
          "data-dialog-content": "true",
        },
        children,
        showCloseButton
          ? createElement(
              "button",
              {
                "aria-label": "Close",
                onClick: () => activeOnOpenChange?.(false),
                type: "button",
              },
              "Close",
            )
          : null,
      ),
    DialogDescription: (props: HTMLAttributes<HTMLParagraphElement>) =>
      createElement("p", props),
    DialogHeader: (props: HTMLAttributes<HTMLDivElement>) =>
      createElement("div", props),
    DialogTitle: (props: HTMLAttributes<HTMLHeadingElement>) =>
      createElement("h2", props),
  };
});

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
  resolveHostedMurphContactOptions: vi.fn(),
  routerRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({
    refresh: mocks.routerRefresh,
  }),
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
  buildHostedDeviceSyncSettingsResponse:
    mocks.buildHostedDeviceSyncSettingsResponse,
}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
  getHostedDashboardPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
}));

vi.mock("@/src/components/murph/hosted-murph-contact-action", () => ({
  resolveHostedMurphContactOption: mocks.resolveHostedMurphContactOption,
  resolveHostedMurphContactOptions: mocks.resolveHostedMurphContactOptions,
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
    session: null,
  });
  mocks.resolveHostedMurphContactOption.mockResolvedValue(null);
  mocks.resolveHostedMurphContactOptions.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  mocks.authDialogProps = null;
});

test("ConnectPage renders source search, source names, and logo marks", async () => {
  const { default: ConnectPage, metadata } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const markup = renderToStaticMarkup(await ConnectPage());

  assert.equal(metadata.title, "Connect Devices — Murph");
  assert.match(markup, /Sync your biomarkers/);
  assert.match(markup, /Live Well/);
  assert.match(markup, /placeholder="Search sources"/);
  assert.match(markup, /aria-label="Search sources"/);
  assert.match(markup, />33 of 33 sources</);
  assert.match(markup, /lg:grid-cols-2 xl:grid-cols-4/);
  assert.doesNotMatch(markup, /data-priority list/);
  assert.doesNotMatch(markup, /Priority/u);
  assert.doesNotMatch(
    markup,
    /Health data source from the Just Cobuild priority catalog/u,
  );
  assert.match(
    markup,
    /Fitbit and Pixel Watch sleep, activity, heart rate, exercise, and workout trends through Google authorization\./u,
  );
  assert.doesNotMatch(
    markup,
    /Sleep, activity, heart rate, and daily readiness\./u,
  );
  assert.doesNotMatch(markup, /Fitbit Sleep Score/u);
  assert.deepEqual(mocks.resolveHostedMurphContactOptions.mock.calls[0]?.[0], {
    message: {
      body: "Help me finish setting up WHOOP through Apple Health.",
    },
  });
  assert.deepEqual(mocks.resolveHostedMurphContactOptions.mock.calls[1]?.[0], {
    message: {
      body: "Help me set up Zepp/Amazfit through Apple Health. Please walk me through it with a voice memo.",
    },
  });
  assert.deepEqual(mocks.resolveHostedMurphContactOptions.mock.calls[2]?.[0], {
    message: {
      body: "Help me set up Xiaomi / Mi Fitness through Apple Health. Please walk me through it with a voice memo.",
    },
  });
  assert.deepEqual(mocks.resolveHostedMurphContactOptions.mock.calls[6]?.[0], {
    message: {
      body: "Help me set up Huawei Health through Apple Health. Please walk me through it with a voice memo.",
    },
  });

  const sources = [
    {
      assetPath: "/brand-logos/connect/apple-health.png",
      description:
        "iPhone and Apple Watch activity, sleep, vitals, and workouts.",
      name: "Apple Health",
    },
    {
      assetPath: "/brand-logos/connect/zepp.png",
      description:
        "Amazfit activity, sleep, heart rate, and workouts through Apple Health.",
      name: "Zepp / Amazfit",
    },
    {
      assetPath: "/brand-logos/connect/mi-fitness.png",
      description:
        "Mi Band, Xiaomi Smart Band, and Redmi Watch activity, sleep, heart rate, and workouts through Apple Health.",
      name: "Xiaomi / Mi Fitness",
    },
    {
      assetPath: "/brand-logos/connect/ringconn.png",
      description:
        "Smart-ring sleep, activity, heart rate, and supported data through Apple Health.",
      name: "RingConn",
    },
    {
      assetPath: "/brand-logos/connect/coros.png",
      description:
        "Activity, sleep, heart rate, and supported workouts through Apple Health.",
      name: "COROS",
    },
    {
      assetPath: "/brand-logos/connect/suunto.png",
      description:
        "Activity, sleep, heart rate, and supported workouts through Apple Health.",
      name: "Suunto",
    },
    {
      assetPath: "/brand-logos/connect/huawei-health.png",
      description:
        "Selected watch and band data through Apple Health, where supported.",
      name: "Huawei Health",
    },
    {
      assetPath: "/brand-logos/connect/whoop.svg",
      description:
        "Recovery, strain, sleep, heart rate, and daily readiness from Whoop.",
      name: "Whoop",
    },
    {
      assetPath: "/brand-logos/connect/mapmyfitness.png",
      description:
        "Logged workouts, routes, pace, distance, and activity history from MapMyFitness.",
      name: "MapMyFitness",
    },
    {
      assetPath: "/brand-logos/connect/ultrahuman.png",
      description:
        "Ring-based sleep, recovery, temperature, movement, and metabolic insight signals from Ultrahuman.",
      name: "Ultrahuman",
    },
    {
      assetPath: "/brand-logos/connect/dexcom-g6-and-older.png",
      description:
        "Legacy Dexcom glucose readings and sensor trends from G6-era devices.",
      name: "Dexcom (G6 and older)",
    },
    {
      assetPath: "/brand-logos/connect/renpho.svg",
      description:
        "Smart-scale weight, body composition, and measurement trends from Renpho devices.",
      name: "Renpho",
    },
    {
      assetPath: "/brand-logos/connect/runkeeper.svg",
      description:
        "Runs, walks, routes, duration, pace, and training history from Runkeeper.",
      name: "Runkeeper",
    },
    {
      assetPath: "/brand-logos/connect/tandem-source.svg",
      description:
        "Insulin pump, CGM, therapy, and diabetes device records from Tandem.",
      name: "Tandem Source",
    },
    {
      assetPath: "/brand-logos/connect/beurer.png",
      description:
        "Blood pressure, scale, glucose, and home health measurements from Beurer.",
      name: "Beurer",
    },
    {
      assetPath: "/brand-logos/connect/omron.png",
      description:
        "Blood pressure, pulse, weight, and connected home measurements from Omron.",
      name: "Omron",
    },
    {
      assetPath: "/brand-logos/connect/eight-sleep.svg",
      description:
        "Mattress-based sleep, temperature, heart rate, and nightly recovery signal trends.",
      name: "Eight Sleep",
    },
    {
      assetPath: "/brand-logos/connect/fitbit.svg",
      description:
        "Fitbit and Pixel Watch sleep, activity, heart rate, exercise, and workout trends through Google authorization.",
      name: "Fitbit",
    },
    {
      assetPath: "/brand-logos/connect/freestyle-libre.png",
      description:
        "Libre glucose history, sensor trends, and daily time-in-range context patterns.",
      name: "Freestyle Libre",
    },
    {
      assetPath: "/brand-logos/connect/garmin.png",
      description:
        "Garmin workouts, sleep, stress, heart, body battery, and activity data.",
      name: "Garmin",
    },
    {
      assetPath: "/brand-logos/connect/hammerhead.png",
      description:
        "Hammerhead cycling rides, route data, distance, elevation, and performance metrics.",
      name: "Hammerhead",
    },
    {
      assetPath: "/brand-logos/connect/ihealth.png",
      description:
        "iHealth blood pressure, glucose, weight, oxygen, and home measurement records.",
      name: "iHealth",
    },
    {
      assetPath: "/brand-logos/connect/oura.png",
      description:
        "Oura sleep, readiness, activity, temperature, heart, and nightly recovery trends.",
      name: "Oura",
    },
    {
      assetPath: "/brand-logos/connect/peloton.svg",
      description:
        "Peloton rides, runs, strength sessions, output, and performance training history.",
      name: "Peloton",
    },
    {
      assetPath: "/brand-logos/connect/wahoo.svg",
      description:
        "Wahoo cycling, running, heart rate, power, and trainer workout data.",
      name: "Wahoo",
    },
    {
      assetPath: "/brand-logos/connect/withings.png",
      description:
        "Withings scale, sleep, blood pressure, temperature, and activity measurement trends.",
      name: "Withings",
    },
    {
      assetPath: "/brand-logos/connect/google-fit.svg",
      description:
        "Android activity, steps, heart points, workouts, and wellness record context.",
      name: "Google Fit",
    },
    {
      assetPath: "/brand-logos/connect/zwift.png",
      description:
        "Indoor rides, runs, power, distance, elevation, and virtual training sessions.",
      name: "Zwift",
    },
    {
      assetPath: "/brand-logos/connect/abbott-libreview.svg",
      description:
        "Abbott LibreView glucose reports, trends, sensor history, and sharing data.",
      name: "Abbott LibreView",
    },
    {
      assetPath: "/brand-logos/connect/dexcom.png",
      description:
        "Current Dexcom CGM glucose readings, trend arrows, and sensor sessions.",
      name: "Dexcom",
    },
    {
      assetPath: "/brand-logos/connect/kardia.svg",
      description:
        "Kardia ECG recordings, rhythm summaries, and heart health observation history.",
      name: "Kardia",
    },
    {
      assetPath: "/brand-logos/connect/cronometer.png",
      description:
        "Nutrition logs, calories, macros, micronutrients, and meal timing from Cronometer.",
      name: "Cronometer",
    },
    {
      assetPath: "/brand-logos/connect/polar.svg",
      description:
        "Polar training, sleep, heart rate, recovery, and cardio load data.",
      name: "Polar",
    },
  ];

  assert.equal(sources.length, 33);
  assert.equal(
    markup.match(/data-connection-state="idle"/gu)?.length,
    sources.length - 6,
  );
  assert.equal(
    markup.match(/>Not available<\/button>/gu)?.length,
    sources.length - 7,
  );
  assert.match(markup, /disabled=""/);
  assert.match(markup, /aria-label="Download app for Apple Health"/);
  assert.match(
    markup,
    /href="https:\/\/apps\.apple\.com\/us\/app\/murph-ai\/id6786145859"/,
  );
  assert.match(markup, /target="_blank"/);
  assert.match(markup, /rel="noopener noreferrer"/);
  assert.doesNotMatch(markup, /Mobvoi \/ TicWatch/u);
  assert.doesNotMatch(markup, /Get Murph for Android/u);
  assert.doesNotMatch(markup, /play\.google\.com/u);
  assert.match(markup, /aria-label="Oura connection is not available yet"/);
  assert.match(markup, /Apple Health not connected/);
  assert.match(markup, /Oura not connected/);
  for (const relayName of [
    "Zepp / Amazfit",
    "Xiaomi / Mi Fitness",
    "RingConn",
    "COROS",
    "Suunto",
    "Huawei Health",
  ]) {
    assert.match(
      markup,
      new RegExp(
        `aria-label="Set up sync for ${escapeRegExp(relayName)}"`,
        "u",
      ),
    );
  }
  assert.equal(markup.match(/>Set up sync<\/button>/gu)?.length, 6);
  assert.doesNotMatch(markup, /Not connected/u);
  assert.doesNotMatch(markup, />Connected</u);
  assert.doesNotMatch(markup, />Health Connect</u);
  assert.doesNotMatch(markup, />Samsung Health</u);
  assert.doesNotMatch(markup, />Freestyle Libre BLE</u);
  assert.doesNotMatch(markup, />Accu-Chek</u);
  assert.doesNotMatch(markup, />Contour BLE</u);
  assert.doesNotMatch(markup, />OneTouch</u);
  assert.doesNotMatch(markup, />Manual</u);
  assert.doesNotMatch(markup, />Strava</u);
  assert.doesNotMatch(markup, /Whoop V2/u);
  assert.ok(
    sourceHeadingIndex(markup, "Apple Health") <
      sourceHeadingIndex(markup, "Garmin"),
  );
  assert.ok(
    sourceHeadingIndex(markup, "Garmin") < sourceHeadingIndex(markup, "Fitbit"),
  );
  assert.ok(
    sourceHeadingIndex(markup, "Fitbit") <
      sourceHeadingIndex(markup, "Google Fit"),
  );
  assert.ok(
    sourceHeadingIndex(markup, "Google Fit") <
      sourceHeadingIndex(markup, "Huawei Health"),
  );
  assert.ok(
    sourceHeadingIndex(markup, "Huawei Health") <
      sourceHeadingIndex(markup, "Xiaomi / Mi Fitness"),
  );
  assert.ok(
    sourceHeadingIndex(markup, "Xiaomi / Mi Fitness") <
      sourceHeadingIndex(markup, "Zepp / Amazfit"),
  );
  assert.ok(
    sourceHeadingIndex(markup, "Zepp / Amazfit") <
      sourceHeadingIndex(markup, "Withings"),
  );
  assert.ok(
    sourceHeadingIndex(markup, "Withings") < sourceHeadingIndex(markup, "Oura"),
  );
  assert.ok(
    sourceHeadingIndex(markup, "Oura") < sourceHeadingIndex(markup, "Whoop"),
  );
  assert.ok(
    sourceHeadingIndex(markup, "Whoop") < sourceHeadingIndex(markup, "COROS"),
  );
  assert.ok(
    sourceHeadingIndex(markup, "COROS") < sourceHeadingIndex(markup, "Suunto"),
  );
  assert.ok(
    sourceHeadingIndex(markup, "Suunto") <
      sourceHeadingIndex(markup, "RingConn"),
  );
  assert.ok(
    sourceHeadingIndex(markup, "RingConn") <
      sourceHeadingIndex(markup, "Dexcom"),
  );
  assert.ok(
    sourceHeadingIndex(markup, "Dexcom (G6 and older)") <
      sourceHeadingIndex(markup, "Freestyle Libre"),
  );
  assert.ok(
    sourceHeadingIndex(markup, "Freestyle Libre") <
      sourceHeadingIndex(markup, "Abbott LibreView"),
  );

  for (const source of sources) {
    assert.match(markup, new RegExp(escapeRegExp(source.name)));
    assert.match(markup, new RegExp(`src="${escapeRegExp(source.assetPath)}"`));
    assert.match(
      markup,
      new RegExp(
        `<img(?=[^>]*alt="")(?=[^>]*src="${escapeRegExp(source.assetPath)}")[^>]*>`,
        "u",
      ),
    );
    assert.ok(
      existsSync(path.join(process.cwd(), "apps/web/public", source.assetPath)),
      `${source.assetPath} should exist under apps/web/public`,
    );

    assert.notEqual(source.description.split(/\s+/u)[0], "Sync");
    assert.notEqual(source.description.split(/\s+/u)[0], "Import");
  }

  for (const relayAssetPath of [
    "/brand-logos/connect/huawei-health.png",
    "/brand-logos/connect/mi-fitness.png",
    "/brand-logos/connect/zepp.png",
    "/brand-logos/connect/coros.png",
    "/brand-logos/connect/suunto.png",
    "/brand-logos/connect/ringconn.png",
  ]) {
    assert.match(
      markup,
      new RegExp(
        `<img(?=[^>]*class="[^"]*rounded-md[^"]*")(?=[^>]*src="${escapeRegExp(relayAssetPath)}")[^>]*>`,
        "u",
      ),
    );
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

test("ConnectPage maps the WHOOP setup Messages option at the server boundary", async () => {
  mocks.resolveHostedMurphContactOptions.mockResolvedValueOnce([
    {
      href: "sms:+15550100001?body=Help%20me%20finish%20setting%20up%20WHOOP",
      kind: "text",
      label: "Messages",
    },
  ]);

  const { default: ConnectPage } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const page = await ConnectPage();

  assert.deepEqual(readWhoopSyncContactAction(page), {
    href: "sms:+15550100001?body=Help%20me%20finish%20setting%20up%20WHOOP",
    kind: "imessage",
    label: "Text Murph",
  });
});

test("ConnectPage preserves the WHOOP setup Telegram option at the server boundary", async () => {
  mocks.resolveHostedMurphContactOptions.mockResolvedValueOnce([
    {
      href: "https://t.me/withmurph_bot?text=Help%20me%20finish%20setting%20up%20WHOOP",
      kind: "telegram",
      label: "Telegram",
      rel: "noopener noreferrer",
      target: "_blank",
    },
  ]);

  const { default: ConnectPage } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const page = await ConnectPage();

  assert.deepEqual(readWhoopSyncContactAction(page), {
    href: "https://t.me/withmurph_bot?text=Help%20me%20finish%20setting%20up%20WHOOP",
    kind: "telegram",
    label: "Text Murph",
    rel: "noopener noreferrer",
    target: "_blank",
  });
});

test("ConnectPage fails open when the WHOOP setup contact route cannot resolve", async () => {
  mocks.resolveHostedMurphContactOptions.mockRejectedValueOnce(
    new Error("contact routing unavailable"),
  );

  const { default: ConnectPage } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const page = await ConnectPage();

  assert.equal(readWhoopSyncContactAction(page), null);
});

test("ConnectPage maps the Zepp setup Messages option at the server boundary", async () => {
  mocks.resolveHostedMurphContactOptions
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      {
        href: "sms:+15550100001?body=Help%20me%20set%20up%20Zepp",
        kind: "text",
        label: "Messages",
      },
    ]);

  const { default: ConnectPage } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const page = await ConnectPage();

  assert.deepEqual(readConnectSourcesGridProp(page, "zeppSyncContactAction"), {
    href: "sms:+15550100001?body=Help%20me%20set%20up%20Zepp",
    kind: "imessage",
    label: "Text Murph",
  });
});

test("ConnectPage maps brand-specific Apple Health relay setup Messages options", async () => {
  mocks.resolveHostedMurphContactOptions
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      {
        href: "sms:+15550100001?body=Help%20me%20set%20up%20my%20wearable",
        kind: "text",
        label: "Messages",
      },
    ]);

  const { default: ConnectPage } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const page = await ConnectPage();

  assert.deepEqual(
    readConnectSourcesGridProp(page, "appleHealthRelaySyncContactActions"),
    {
      "xiaomi-mi-fitness-apple-health": {
        href: "sms:+15550100001?body=Help%20me%20set%20up%20my%20wearable",
        kind: "imessage",
        label: "Text Murph",
      },
      "ringconn-apple-health": null,
      "coros-apple-health": null,
      "suunto-apple-health": null,
      "huawei-health-apple-health": null,
    },
  );
});

test("filterConnectSourcesForSearch matches source names, ids, and descriptions", async () => {
  const { filterConnectSourcesForSearch } = await import(
    "../app/(dashboard)/connect/connect-page-client"
  );
  const sources = [
    {
      id: "oura",
      name: "Oura",
      description:
        "Oura sleep, readiness, activity, temperature, heart, and nightly recovery trends.",
      logo: {
        className: "size-11 object-contain",
        height: 44,
        src: "/oura.png",
        width: 44,
      },
    },
    {
      id: "freestyle-libre",
      name: "Freestyle Libre",
      description:
        "Libre glucose history, sensor trends, and daily time-in-range context patterns.",
      logo: {
        className: "size-11 object-contain",
        height: 44,
        src: "/libre.png",
        width: 44,
      },
    },
    {
      id: "xiaomi-mi-fitness",
      name: "Xiaomi / Mi Fitness",
      description: "Mi Band and Redmi Watch data through Apple Health.",
      logo: {
        className: "size-11 object-contain",
        height: 44,
        src: "/xiaomi.png",
        width: 44,
      },
    },
  ];

  assert.deepEqual(
    filterConnectSourcesForSearch(sources, "sleep").map((source) => source.id),
    ["oura"],
  );
  assert.deepEqual(
    filterConnectSourcesForSearch(sources, "freeStyle").map(
      (source) => source.id,
    ),
    ["freestyle-libre"],
  );
  assert.deepEqual(
    filterConnectSourcesForSearch(sources, "mi band").map(
      (source) => source.id,
    ),
    ["xiaomi-mi-fitness"],
  );
  assert.deepEqual(
    filterConnectSourcesForSearch(sources, "  ").map((source) => source.id),
    ["oura", "freestyle-libre", "xiaomi-mi-fitness"],
  );
});

test("sortConnectSourcesByConnectionState keeps connected sources first, then popularity order", async () => {
  const { sortConnectSourcesByConnectionState } = await import(
    "../app/(dashboard)/connect/connect-source-order"
  );
  const logo = {
    className: "size-11 object-contain",
    height: 44,
    src: "/logo.png",
    width: 44,
  };
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
      id: "zepp",
      name: "Zepp / Amazfit",
      description: "Activity.",
      logo,
    },
    {
      id: "fitbit",
      name: "Fitbit",
      description: "Activity.",
      logo,
    },
    {
      id: "google-fit",
      name: "Google Fit",
      description: "Activity.",
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
      id: "strava",
      name: "Strava",
      description: "Workouts.",
      logo,
    },
    {
      id: "ringconn",
      name: "RingConn",
      description: "Sleep.",
      logo,
    },
    {
      id: "huawei-health",
      name: "Huawei Health",
      description: "Activity.",
      logo,
    },
    {
      id: "coros",
      name: "COROS",
      description: "Training.",
      logo,
    },
    {
      id: "withings",
      name: "Withings",
      description: "Health.",
      logo,
    },
    {
      id: "xiaomi-mi-fitness",
      name: "Xiaomi / Mi Fitness",
      description: "Activity.",
      logo,
    },
    {
      id: "suunto",
      name: "Suunto",
      description: "Training.",
      logo,
    },
  ];

  assert.deepEqual(
    sortConnectSourcesByConnectionState(sources).map((source) => source.id),
    [
      "oura",
      "garmin",
      "fitbit",
      "google-fit",
      "strava",
      "huawei-health",
      "xiaomi-mi-fitness",
      "zepp",
      "withings",
      "whoop",
      "coros",
      "suunto",
      "ringconn",
      "dexcom",
      "dexcom-g6-and-older",
      "freestyle-libre",
      "abbott-libreview",
      "polar",
    ],
  );
});

test("ConnectSourcesGrid shows an empty-state alert when no sources are available", async () => {
  const { ConnectSourcesGrid } = await import(
    "../app/(dashboard)/connect/connect-page-client"
  );
  const markup = renderToStaticMarkup(
    createElement(ConnectSourcesGrid, { sources: [] }),
  );

  assert.match(markup, /Sources/);
  assert.match(markup, />0 of 0 sources</);
  assert.match(markup, /No sources matched/);
  assert.match(
    markup,
    /Try a different search to get back to the full source list\./,
  );
  assert.doesNotMatch(markup, />Connect<\/button>/u);
});

test("ConnectSourcesGrid opens the Zepp Apple Health setup guide without claiming a direct connection", async () => {
  const { ConnectSourcesGrid } = await import(
    "../app/(dashboard)/connect/connect-page-client"
  );
  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [
        {
          connectionAvailable: false,
          connected: true,
          description:
            "Amazfit activity, sleep, heart rate, and workouts through Apple Health.",
          disconnectConnectionId: "impossible-zepp-provider-state",
          historicalResetIncomplete: true,
          id: "zepp",
          logo: {
            className: "size-11 rounded-md object-contain",
            height: 44,
            src: "/brand-logos/connect/zepp.png",
            width: 44,
          },
          name: "Zepp / Amazfit",
          recoveryKind: "connection_reset",
          requiresReconnect: true,
          setupGuideActionLabel: "Set up sync",
          setupGuideId: "zepp-apple-health",
        },
      ],
      zeppSyncContactAction: {
        href: "sms:+15550100001?body=Help%20me%20set%20up%20Zepp",
        kind: "imessage",
        label: "Text Murph",
      },
    }),
  );

  const setupButton = rendered.container.querySelector(
    'button[aria-label="Set up sync for Zepp / Amazfit"]',
  );
  assert.ok(setupButton instanceof rendered.window.HTMLButtonElement);
  assert.equal(
    rendered.container.querySelector("[data-connection-state]"),
    null,
  );
  assert.equal(
    rendered.container.querySelector(
      'button[aria-label="Disconnect Zepp / Amazfit"]',
    ),
    null,
  );
  assert.doesNotMatch(
    rendered.container.textContent ?? "",
    /Zepp \/ Amazfit (?:connected|not connected)/u,
  );
  assert.doesNotMatch(
    rendered.container.textContent ?? "",
    /needs a fresh connection|needs reconnect|Please reconnect/u,
  );

  await act(async () => {
    setupButton.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  assert.match(
    rendered.container.textContent ?? "",
    /Sync Zepp through Apple Health/,
  );
  assert.match(
    rendered.container.textContent ?? "",
    /Turn on Apple Health in Zepp/,
  );
  assert.match(rendered.container.textContent ?? "", /Continue with Murph/);
  assert.doesNotMatch(rendered.container.textContent ?? "", /direct Zepp/u);
  assert.equal(rendered.container.querySelector("audio"), null);
  assert.ok(
    rendered.container.querySelector(
      'a[href="https://apps.apple.com/us/app/murph-ai/id6786145859"]',
    ),
  );

  await rendered.cleanup();
});

test("ConnectSourcesGrid opens a reusable Xiaomi Apple Health setup guide", async () => {
  const { ConnectSourcesGrid } = await import(
    "../app/(dashboard)/connect/connect-page-client"
  );
  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      appleHealthRelaySyncContactActions: {
        "xiaomi-mi-fitness-apple-health": {
          href: "sms:+15550100001?body=Help%20me%20set%20up%20Xiaomi",
          kind: "imessage",
          label: "Text Murph",
        },
      },
      sources: [
        {
          connectionAvailable: false,
          description:
            "Mi Band, Xiaomi Smart Band, and Redmi Watch activity, sleep, heart rate, and workouts through Apple Health.",
          id: "xiaomi-mi-fitness",
          logo: {
            className: "size-11 rounded-md object-contain",
            height: 44,
            src: "/brand-logos/connect/mi-fitness.png",
            width: 44,
          },
          name: "Xiaomi / Mi Fitness",
          setupGuideActionLabel: "Set up sync",
          setupGuideId: "xiaomi-mi-fitness-apple-health",
        },
      ],
    }),
  );

  const setupButton = rendered.container.querySelector(
    'button[aria-label="Set up sync for Xiaomi / Mi Fitness"]',
  );
  assert.ok(setupButton instanceof rendered.window.HTMLButtonElement);
  assert.equal(
    rendered.container.querySelector("[data-connection-state]"),
    null,
  );

  await act(async () => {
    setupButton.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  assert.match(
    rendered.container.textContent ?? "",
    /Sync Xiaomi \/ Mi Fitness through Apple Health/,
  );
  assert.match(
    rendered.container.textContent ?? "",
    /Turn on Apple Health in Mi Fitness/,
  );
  assert.match(rendered.container.textContent ?? "", /Continue with Murph/);
  assert.doesNotMatch(rendered.container.textContent ?? "", /direct Xiaomi/u);

  await rendered.cleanup();
});

test("ConnectSourcesGrid requires account authentication before opening the Zepp guide", async () => {
  const { ConnectSourcesGrid } = await import(
    "../app/(dashboard)/connect/connect-page-client"
  );
  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      authenticated: false,
      sources: [
        {
          connectionAvailable: false,
          description:
            "Amazfit activity, sleep, heart rate, and workouts through Apple Health.",
          id: "zepp",
          logo: {
            className: "size-11 rounded-md object-contain",
            height: 44,
            src: "/brand-logos/connect/zepp.png",
            width: 44,
          },
          name: "Zepp / Amazfit",
          setupGuideActionLabel: "Set up sync",
          setupGuideId: "zepp-apple-health",
        },
      ],
    }),
  );

  assert.ok(
    rendered.container.querySelector(
      'button[aria-label="Log in or sign up to set up Zepp / Amazfit"]',
    ),
  );
  assert.equal(
    rendered.container.querySelector(
      'button[aria-label="Set up sync for Zepp / Amazfit"]',
    ),
    null,
  );
  assert.equal(
    rendered.container.querySelector("[data-connection-state]"),
    null,
  );
  assert.doesNotMatch(
    rendered.container.textContent ?? "",
    /Sync Zepp through Apple Health/u,
  );

  await rendered.cleanup();
});

test("ConnectPage enables Garmin when Junction exposes Garmin as a connect target", async () => {
  vi.stubEnv("JUNCTION_API_KEY", "sk_us_junction-test");
  vi.stubEnv(
    "JUNCTION_CLIENT_USER_ID_SECRET",
    "junction-client-user-id-secret",
  );
  vi.stubEnv("JUNCTION_ENV", "sandbox");
  vi.stubEnv("JUNCTION_PROVIDER_FILTER", "garmin");
  vi.stubEnv("JUNCTION_REGION", "us");

  const { default: ConnectPage } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const markup = renderToStaticMarkup(await ConnectPage());

  assert.match(markup, /aria-label="Connect Garmin"/u);
  assert.match(markup, />Connect<\/button>/u);
  assert.equal(markup.match(/>Connect<\/button>/gu)?.length, 1);
});

test("ConnectPage hides Strava when direct and Junction connection routes are configured", async () => {
  vi.stubEnv("STRAVA_CLIENT_ID", "strava-client-id");
  vi.stubEnv("STRAVA_CLIENT_SECRET", "strava-client-secret");
  vi.stubEnv("JUNCTION_API_KEY", "sk_us_junction-test");
  vi.stubEnv(
    "JUNCTION_CLIENT_USER_ID_SECRET",
    "junction-client-user-id-secret",
  );
  vi.stubEnv("JUNCTION_ENV", "sandbox");
  vi.stubEnv("JUNCTION_PROVIDER_FILTER", "strava");
  vi.stubEnv("JUNCTION_REGION", "us");

  const { default: ConnectPage } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const markup = renderToStaticMarkup(await ConnectPage());

  assert.doesNotMatch(markup, />Strava</u);
  assert.doesNotMatch(markup, /Connect Strava/u);
});

test("ConnectPage preserves an existing Strava connection for status and disconnect only", async () => {
  vi.stubEnv("STRAVA_CLIENT_ID", "strava-client-id");
  vi.stubEnv("STRAVA_CLIENT_SECRET", "strava-client-secret");
  mocks.buildHostedDeviceSyncSettingsResponse.mockResolvedValueOnce({
    generatedAt: "2026-05-01T00:00:00.000Z",
    ok: true,
    sources: [
      {
        connectionId: "dsc_strava_123",
        provider: "strava",
        state: "active",
        upstreamSources: [],
      },
    ],
  });

  const { default: ConnectPage } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const markup = renderToStaticMarkup(await ConnectPage());

  assert.match(markup, /Strava connected/u);
  assert.match(markup, /aria-label="Disconnect Strava"/u);
  assert.doesNotMatch(markup, /aria-label="Connect Strava"/u);
  assert.doesNotMatch(markup, /aria-label="Reconnect Strava"/u);
});

test("ConnectPage does not offer Strava reconnection for an existing account needing access", async () => {
  vi.stubEnv("STRAVA_CLIENT_ID", "strava-client-id");
  vi.stubEnv("STRAVA_CLIENT_SECRET", "strava-client-secret");
  mocks.buildHostedDeviceSyncSettingsResponse.mockResolvedValueOnce({
    generatedAt: "2026-05-01T00:00:00.000Z",
    ok: true,
    sources: [
      {
        connectionId: "dsc_strava_123",
        connectSourceId: "strava",
        connectTarget: "strava",
        primaryAction: {
          kind: "reconnect",
          label: "Reconnect",
        },
        provider: "strava",
        state: "reauthorization_required",
        upstreamSources: [],
      },
    ],
  });

  const { default: ConnectPage } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const markup = renderToStaticMarkup(await ConnectPage());

  assert.match(markup, /Strava needs attention from the connected app/u);
  assert.match(markup, /aria-label="Disconnect Strava"/u);
  assert.doesNotMatch(markup, /aria-label="Reconnect Strava"/u);
});

test("ConnectPage enables every Link source exposed by the shared Junction defaults", async () => {
  vi.stubEnv("JUNCTION_API_KEY", "sk_us_junction-test");
  vi.stubEnv(
    "JUNCTION_CLIENT_USER_ID_SECRET",
    "junction-client-user-id-secret",
  );
  vi.stubEnv("JUNCTION_ENV", "sandbox");
  vi.stubEnv("JUNCTION_PROVIDER_FILTER", "");
  vi.stubEnv("JUNCTION_REGION", "us");

  const { default: ConnectPage, resolveConfiguredConnectSources } =
    await import("../app/(dashboard)/connect/connect-page-content");
  const { JUNCTION_DEFAULT_PROVIDER_FILTER } = await import(
    "@murphai/device-syncd/config"
  );
  const markup = renderToStaticMarkup(await ConnectPage());

  assert.equal(
    markup.match(/>Connect<\/button>/gu)?.length,
    JUNCTION_DEFAULT_PROVIDER_FILTER.filter(
      (providerSlug) => providerSlug !== "strava",
    ).length,
  );
  assert.equal(markup.match(/>Not available<\/button>/gu)?.length ?? 0, 0);
  assert.match(markup, /aria-label="Download app for Apple Health"/u);
  assert.doesNotMatch(markup, />Accu-Chek</u);
  assert.doesNotMatch(markup, />Samsung Health</u);

  const { listVisibleConnectSources } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const visibleSourceIds = new Set(
    listVisibleConnectSources().map((source) => source.id),
  );
  const configuredSourceIds = new Set<string>(
    (
      await import("@murphai/device-syncd/config")
    ).DEVICE_CONNECT_SOURCES.filter((source) =>
      visibleSourceIds.has(source.connectSourceId),
    ).map((source) => source.connectSourceId),
  );
  assert.deepEqual(
    [...visibleSourceIds].sort(),
    [...configuredSourceIds].sort(),
  );
  assert.equal(visibleSourceIds.has("mobvoi-health"), false);
  assert.equal(
    listVisibleConnectSources({ MURPH_ANDROID_APP_ENABLED: "1" })
      .some((source) => source.id === "mobvoi-health"),
    true,
  );

  const logo = {
    className: "size-11 object-contain",
    height: 44,
    src: "/logo.png",
    width: 44,
  };
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
  assert.deepEqual(
    resolvedConnectSources.map((source) => source.id),
    ["dexcom", "dexcom-g6-and-older", "mapmyfitness", "accuchek"],
  );
  assert.deepEqual(
    Object.fromEntries(
      resolvedConnectSources.map((source) => [source.id, source.connectTarget]),
    ),
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
  vi.stubEnv(
    "JUNCTION_CLIENT_USER_ID_SECRET",
    "junction-client-user-id-secret",
  );
  vi.stubEnv("JUNCTION_ENV", "sandbox");
  vi.stubEnv("JUNCTION_PROVIDER_FILTER", "map_my_fitness,beurer_api");
  vi.stubEnv("JUNCTION_REGION", "us");

  const { default: ConnectPage } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
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
  vi.stubEnv(
    "JUNCTION_CLIENT_USER_ID_SECRET",
    "junction-client-user-id-secret",
  );
  vi.stubEnv("JUNCTION_ENV", "sandbox");
  vi.stubEnv("JUNCTION_PROVIDER_FILTER", "dexcom_v3");
  vi.stubEnv("JUNCTION_REGION", "us");

  const fetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return Response.json({
        authorizationUrl: "https://junction.example.test/link/dexcom-v3",
      });
    },
  );
  vi.stubGlobal("fetch", fetch);

  const { resolveConfiguredConnectSources } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const { ConnectSourcesGrid } = await import(
    "../app/(dashboard)/connect/connect-page-client"
  );
  const logo = {
    className: "size-11 object-contain",
    height: 44,
    src: "/logo.png",
    width: 44,
  };
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
  assert.equal(source.requiresJunctionDisclosure, true);

  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [source],
    }),
  );

  await act(async () => {
    rendered.button.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  assert.equal(fetch.mock.calls.length, 0);
  assert.match(
    rendered.container.textContent ?? "",
    /Connect Dexcom to Murph/u,
  );

  const continueButton = [
    ...rendered.container.querySelectorAll("button"),
  ].find((button) => button.textContent === "Continue to Dexcom");
  assert.ok(continueButton instanceof rendered.window.HTMLButtonElement);
  await act(async () => {
    continueButton.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  await vi.waitFor(() => {
    assert.equal(fetch.mock.calls.length, 1);
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
  assert.equal(
    rendered.assign.mock.calls[0]?.[0],
    "https://junction.example.test/link/dexcom-v3",
  );

  await rendered.cleanup();
});

test("ConnectPage marks direct and Junction upstream sources connected from hosted state", async () => {
  vi.stubEnv("JUNCTION_API_KEY", "sk_us_junction-test");
  vi.stubEnv(
    "JUNCTION_CLIENT_USER_ID_SECRET",
    "junction-client-user-id-secret",
  );
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

  const { default: ConnectPage } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const markup = renderToStaticMarkup(await ConnectPage());

  assert.match(markup, /Oura connected/);
  assert.match(markup, /Whoop connected/);
  assert.equal(markup.match(/data-connection-state="connected"/gu)?.length, 2);
  assert.match(markup, /aria-label="Disconnect Oura"/u);
  assert.match(markup, /aria-label="Disconnect Whoop"/u);
  assert.ok(
    sourceHeadingIndex(markup, "Oura") < sourceHeadingIndex(markup, "Whoop"),
  );
  assert.ok(
    sourceHeadingIndex(markup, "Whoop") < sourceHeadingIndex(markup, "Garmin"),
  );
  assert.doesNotMatch(markup, /aria-label="Connect Oura"/u);
  assert.doesNotMatch(markup, /aria-label="Connect Whoop"/u);
});

test("ConnectPage marks iOS Apple Health Junction SDK source connected from hosted state", async () => {
  mocks.buildHostedDeviceSyncSettingsResponse.mockResolvedValueOnce({
    generatedAt: "2026-05-01T00:00:00.000Z",
    ok: true,
    sources: [
      {
        connectionId: "dsc_junction_apple_health",
        provider: "junction",
        state: "active",
        upstreamSources: [
          {
            providerLabel: "Apple Health",
            resourceCount: 4,
            sourceProviderSlug: "apple_health_kit",
            status: "connected",
          },
        ],
      },
    ],
  });

  const { default: ConnectPage } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const markup = renderToStaticMarkup(await ConnectPage());

  assert.match(markup, /Apple Health connected/u);
  assert.match(markup, /aria-label="Disconnect Apple Health"/u);
  assert.doesNotMatch(markup, /aria-label="Connect Apple Health"/u);
  assert.equal(markup.match(/data-connection-state="connected"/gu)?.length, 1);
  assert.ok(
    sourceHeadingIndex(markup, "Apple Health") <
      sourceHeadingIndex(markup, "Garmin"),
  );
});

test("ConnectPage keeps Mobvoi statusless when Health Connect is active", async () => {
  vi.stubEnv("MURPH_ANDROID_APP_ENABLED", "1");
  mocks.buildHostedDeviceSyncSettingsResponse.mockResolvedValueOnce({
    generatedAt: "2026-05-01T00:00:00.000Z",
    ok: true,
    sources: [
      {
        connectionId: "dsc_junction_health_connect",
        provider: "junction",
        state: "active",
        upstreamSources: [
          {
            providerLabel: "Health Connect",
            resourceCount: 4,
            sourceProviderSlug: "health_connect",
            status: "connected",
          },
        ],
      },
    ],
  });

  const { default: ConnectPage } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const markup = renderToStaticMarkup(await ConnectPage());

  assert.match(
    markup,
    /aria-label="Get Murph for Android for Mobvoi \/ TicWatch"/u,
  );
  assert.match(
    markup,
    /Sync through Mobvoi Health or Google Fit, then connect Health Connect in Murph\./u,
  );
  assert.match(markup, /src="\/brand-logos\/connect\/mobvoi-health\.png"/u);
  assert.match(markup, /rounded-full/u);
  assert.doesNotMatch(markup, /Mobvoi \/ TicWatch (?:connected|not connected)/u);
});

test("ConnectPage shows source-scoped disconnects for multi-source Junction accounts", async () => {
  mocks.buildHostedDeviceSyncSettingsResponse.mockResolvedValueOnce({
    generatedAt: "2026-05-01T00:00:00.000Z",
    ok: true,
    sources: [
      {
        connectionId: "dsc_junction_multi_source",
        provider: "junction",
        state: "active",
        upstreamSources: [
          {
            providerLabel: "Apple Health",
            resourceCount: 4,
            sourceProviderSlug: "apple_health_kit",
            status: "connected",
          },
          {
            providerLabel: "WHOOP",
            resourceCount: 3,
            sourceProviderSlug: "whoop_v2",
            status: "connected",
          },
        ],
      },
    ],
  });

  const { default: ConnectPage } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const markup = renderToStaticMarkup(await ConnectPage());

  assert.match(markup, /Apple Health connected/u);
  assert.match(markup, /Whoop connected/u);
  assert.equal(markup.match(/data-connection-state="connected"/gu)?.length, 2);
  assert.match(markup, /aria-label="Disconnect Apple Health"/u);
  assert.match(markup, /aria-label="Disconnect Whoop"/u);
  assert.doesNotMatch(markup, /aria-label="Disconnect account"/u);
});

test("ConnectPage scopes disconnects by every non-disconnected Junction upstream", async () => {
  mocks.buildHostedDeviceSyncSettingsResponse.mockResolvedValueOnce({
    generatedAt: "2026-05-01T00:00:00.000Z",
    ok: true,
    sources: [
      {
        connectionId: "dsc_junction_multi_source",
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
            providerLabel: "Apple Health",
            resourceCount: 4,
            sourceProviderSlug: "apple_health_kit",
            status: "unavailable",
          },
        ],
      },
    ],
  });

  const { default: ConnectPage } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const markup = renderToStaticMarkup(await ConnectPage());

  assert.match(markup, /Garmin connected/u);
  assert.doesNotMatch(markup, /Apple Health connected/u);
  assert.match(markup, /aria-label="Disconnect Garmin"/u);
  assert.doesNotMatch(markup, /aria-label="Disconnect Apple Health"/u);
  assert.doesNotMatch(markup, /aria-label="Disconnect account"/u);
});

test("ConnectPage keeps source disconnects visible for parent-level Junction reauthorization", async () => {
  vi.stubEnv("JUNCTION_API_KEY", "sk_us_junction-test");
  vi.stubEnv(
    "JUNCTION_CLIENT_USER_ID_SECRET",
    "junction-client-user-id-secret",
  );
  vi.stubEnv("JUNCTION_ENV", "sandbox");
  vi.stubEnv("JUNCTION_PROVIDER_FILTER", "garmin");
  vi.stubEnv("JUNCTION_REGION", "us");
  mocks.buildHostedDeviceSyncSettingsResponse.mockResolvedValueOnce({
    generatedAt: "2026-05-01T00:00:00.000Z",
    ok: true,
    sources: [
      {
        connectionId: "dsc_junction_multi",
        provider: "junction",
        state: "reauthorization_required",
        upstreamSources: [
          {
            connectProvider: "junction",
            connectTarget: "garmin",
            providerLabel: "Garmin",
            resourceCount: 2,
            sourceProviderSlug: "garmin",
            status: "unavailable",
          },
          {
            providerLabel: "Apple Health",
            resourceCount: 4,
            sourceProviderSlug: "apple_health_kit",
            status: "unavailable",
          },
        ],
      },
    ],
  });

  const { default: ConnectPage } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const markup = renderToStaticMarkup(await ConnectPage());

  assert.match(markup, /Apple Health needs reconnect/u);
  assert.match(markup, /Garmin needs reconnect/u);
  assert.match(markup, /aria-label="Reconnect Garmin"/u);
  assert.doesNotMatch(markup, /aria-label="Reconnect Apple Health"/u);
  assert.match(markup, /aria-label="Disconnect Apple Health"/u);
  assert.match(markup, /aria-label="Disconnect Garmin"/u);
  assert.doesNotMatch(markup, /aria-label="Disconnect account"/u);
});

test("ConnectPage does not apply parent Junction reauthorization to disconnected upstream projections", async () => {
  vi.stubEnv("JUNCTION_API_KEY", "sk_us_junction-test");
  vi.stubEnv(
    "JUNCTION_CLIENT_USER_ID_SECRET",
    "junction-client-user-id-secret",
  );
  vi.stubEnv("JUNCTION_ENV", "sandbox");
  vi.stubEnv("JUNCTION_PROVIDER_FILTER", "garmin");
  vi.stubEnv("JUNCTION_REGION", "us");
  mocks.buildHostedDeviceSyncSettingsResponse.mockResolvedValueOnce({
    generatedAt: "2026-05-01T00:00:00.000Z",
    ok: true,
    sources: [
      {
        connectionId: "dsc_junction_multi",
        provider: "junction",
        state: "reauthorization_required",
        upstreamSources: [
          {
            connectProvider: "junction",
            connectTarget: "garmin",
            providerLabel: "Garmin",
            resourceCount: 2,
            sourceProviderSlug: "garmin",
            status: "unavailable",
          },
          {
            providerLabel: "Apple Health",
            resourceCount: 4,
            sourceProviderSlug: "apple_health_kit",
            status: "disconnected",
          },
        ],
      },
    ],
  });

  const { default: ConnectPage } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const markup = renderToStaticMarkup(await ConnectPage());

  assert.match(markup, /Garmin needs reconnect/u);
  assert.match(markup, /aria-label="Reconnect Garmin"/u);
  assert.match(markup, /Apple Health not connected/u);
  assert.match(markup, /aria-label="Download app for Apple Health"/u);
  assert.doesNotMatch(markup, /Apple Health needs reconnect/u);
  assert.doesNotMatch(markup, /aria-label="Reconnect Apple Health"/u);
  assert.doesNotMatch(markup, /aria-label="Disconnect Apple Health"/u);
  assert.doesNotMatch(markup, /aria-label="Disconnect account"/u);
});

test("ConnectPage shows mobile-managed guidance for Apple Health reconnect states without web target", async () => {
  mocks.buildHostedDeviceSyncSettingsResponse.mockResolvedValueOnce({
    generatedAt: "2026-05-01T00:00:00.000Z",
    ok: true,
    sources: [
      {
        connectionId: "dsc_junction_apple_health",
        provider: "junction",
        state: "active",
        upstreamSources: [
          {
            providerLabel: "Apple Health",
            requiresReconnect: true,
            resourceCount: 4,
            sourceProviderSlug: "apple_health_kit",
            status: "error",
          },
        ],
      },
    ],
  });

  const { default: ConnectPage } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const markup = renderToStaticMarkup(await ConnectPage());

  assert.match(markup, /Apple Health needs reconnect/u);
  assert.match(
    markup,
    /Apple Health needs attention from the connected app before Murph can keep syncing it\./u,
  );
  assert.match(markup, /aria-label="Disconnect Apple Health"/u);
  assert.match(markup, /aria-label="Download app for Apple Health"/u);
  assert.match(markup, /data-connection-state="needs-access"/u);
  assert.doesNotMatch(
    markup,
    /aria-label="Apple Health connection is not available yet"/u,
  );
  assert.doesNotMatch(
    markup,
    /Please reconnect Apple Health to resume syncing\./u,
  );
});

test("ConnectPage ignores disconnected Junction upstream projections on active connections", async () => {
  vi.stubEnv("JUNCTION_API_KEY", "sk_us_junction-test");
  vi.stubEnv(
    "JUNCTION_CLIENT_USER_ID_SECRET",
    "junction-client-user-id-secret",
  );
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

  const { default: ConnectPage } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const markup = renderToStaticMarkup(await ConnectPage());

  assert.match(markup, /Oura connected/u);
  assert.match(markup, /Garmin not connected/u);
  assert.match(markup, /aria-label="Disconnect Oura"/u);
  assert.match(markup, /aria-label="Connect Garmin"/u);
  assert.equal(markup.match(/data-connection-state="connected"/gu)?.length, 1);
  assert.ok(
    sourceHeadingIndex(markup, "Oura") < sourceHeadingIndex(markup, "Garmin"),
  );
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

  const { default: ConnectPage } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
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

  const { default: ConnectPage } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
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

  const { default: ConnectPage } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const markup = renderToStaticMarkup(await ConnectPage());

  assert.match(markup, /Whoop needs reconnect/);
  assert.match(markup, /Please reconnect Whoop to resume syncing\./u);
  assert.match(markup, /data-connection-state="needs-access"/u);
  assert.match(markup, /aria-label="Reconnect Whoop"/u);
  assert.doesNotMatch(markup, /aria-label="Disconnect Whoop"/u);
  assert.doesNotMatch(markup, /Whoop connected/u);
  assert.doesNotMatch(markup, /aria-label="Connect Whoop"/u);
});

test("ConnectPage preserves unambiguous Junction source reconnects with upstream projections", async () => {
  mocks.buildHostedDeviceSyncSettingsResponse.mockResolvedValueOnce({
    generatedAt: "2026-05-01T00:00:00.000Z",
    ok: true,
    sources: [
      {
        connectionId: "dsc_junction_whoop",
        primaryAction: {
          kind: "reconnect",
          label: "Reconnect",
        },
        provider: "junction",
        state: "active",
        upstreamSources: [
          {
            connectProvider: "junction",
            connectSourceId: "whoop",
            connectTarget: "whoop",
            providerLabel: "WHOOP",
            resourceCount: 3,
            sourceProviderSlug: "whoop_v2",
            status: "connected",
          },
        ],
      },
    ],
  });

  const { default: ConnectPage } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const markup = renderToStaticMarkup(await ConnectPage());

  assert.match(markup, /Whoop needs reconnect/u);
  assert.match(markup, /Please reconnect Whoop to resume syncing\./u);
  assert.match(markup, /aria-label="Reconnect Whoop"/u);
  assert.match(markup, /data-connection-state="needs-access"/u);
  assert.doesNotMatch(markup, /Whoop connected/u);
});

test("ConnectPage lets active state win when duplicate rows mention the same source", async () => {
  const { resolveConnectSourceConnectionStates } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );

  assert.deepEqual(
    resolveConnectSourceConnectionStates(
      [{ id: "whoop" }],
      [
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
      ],
    ),
    [
      {
        connectionId: "dsc_whoop_active",
        connectProvider: "whoop",
        connectTarget: null,
        requiresReconnect: false,
        sourceId: "whoop",
        state: "active",
      },
    ],
  );
});

test("ConnectPage maps Apple Health Junction upstream slugs to the visible source", async () => {
  const { resolveConnectSourceConnectionStates } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );

  for (const sourceProviderSlug of ["apple_health_kit", "apple_health"]) {
    assert.deepEqual(
      resolveConnectSourceConnectionStates(
        [{ id: "apple-health" }],
        [
          {
            connectionId: "dsc_junction_apple_health",
            provider: "junction",
            state: "active",
            upstreamSources: [
              {
                providerLabel: "Apple Health",
                resourceCount: 4,
                sourceProviderSlug,
                status: "connected",
              },
            ],
          },
        ],
      ),
      [
        {
          connectionId: "dsc_junction_apple_health",
          connectProvider: "junction",
          connectTarget: null,
          disconnectSourceProviderSlug: sourceProviderSlug,
          requiresReconnect: false,
          sourceId: "apple-health",
          state: "active",
        },
      ],
    );
  }
});

test("ConnectPage offers one explicit legacy Fitbit migration through Google Health", async () => {
  const { resolveConnectSourceConnectionStates } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );

  assert.deepEqual(
    resolveConnectSourceConnectionStates(
      [{ id: "fitbit" }],
      [{
        connectionId: "dsc_junction_fitbit",
        provider: "junction",
        state: "active",
        upstreamSources: [{
          connectProvider: "junction",
          connectSourceId: "fitbit",
          connectTarget: "fitbit",
          firstSeenAt: "2026-07-01T00:00:00.000Z",
          lastDataAt: "2026-08-10T00:00:00.000Z",
          lastSeenAt: "2026-08-10T00:00:00.000Z",
          providerLabel: "Fitbit",
          resourceCount: 4,
          sourceProviderSlug: "fitbit",
          status: "connected",
        }],
      }],
    ),
    [{
      connectionId: "dsc_junction_fitbit",
      connectProvider: "junction",
      connectTarget: "fitbit",
      migrationState: "authorization_required",
      requiresReconnect: false,
      sourceId: "fitbit",
      state: "active",
    }],
  );
});

test("ConnectPage preserves legacy Fitbit while Google Health is still proving readiness", async () => {
  const { resolveConnectSourceConnectionStates } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );

  const [state] = resolveConnectSourceConnectionStates(
    [{ id: "fitbit" }],
    [{
      connectionId: "dsc_junction_fitbit",
      provider: "junction",
      state: "active",
      upstreamSources: [
        {
          providerLabel: "Fitbit",
          resourceCount: 4,
          sourceProviderSlug: "fitbit",
          status: "connected",
        },
        {
          firstSeenAt: "2026-08-11T10:00:00.000Z",
          lastDataAt: "2026-08-11T10:00:00.000Z",
          lastSeenAt: "2026-08-11T10:00:00.000Z",
          providerLabel: "Fitbit",
          resourceCount: 3,
          sourceProviderSlug: "google_health",
          status: "connected",
        },
      ],
    }],
  );

  assert.deepEqual(state, {
    connectionId: "dsc_junction_fitbit",
    connectProvider: null,
    connectTarget: null,
    migrationState: "verifying_successor",
    requiresReconnect: false,
    sourceId: "fitbit",
    state: "active",
  });
  assert.equal(state?.disconnectSourceProviderSlug, undefined);
});

test("ConnectPage exposes only a targeted legacy disconnect after Google Health is receiving fresh updates", async () => {
  const { resolveConnectSourceConnectionStates } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );

  const [state] = resolveConnectSourceConnectionStates(
    [{ id: "fitbit" }],
    [{
      connectionId: "dsc_junction_fitbit",
      provider: "junction",
      state: "active",
      upstreamSources: [
        {
          providerLabel: "Fitbit",
          resourceCount: 4,
          sourceProviderSlug: "fitbit",
          status: "connected",
        },
        {
          firstSeenAt: "2026-08-11T10:00:00.000Z",
          lastDataAt: "2026-08-11T10:05:00.000Z",
          lastSeenAt: "2026-08-11T10:06:00.000Z",
          providerLabel: "Fitbit",
          resourceCount: 3,
          sourceProviderSlug: "google_health",
          status: "connected",
        },
      ],
    }],
  );

  assert.deepEqual(state, {
    connectionId: "dsc_junction_fitbit",
    connectProvider: null,
    connectTarget: null,
    disconnectSourceProviderSlug: "fitbit",
    migrationState: "cutover_ready",
    requiresReconnect: false,
    sourceId: "fitbit",
    state: "active",
  });
});

test("ConnectPage keeps provider-disconnected Fitbit migrations staged until the user finishes cutover", async () => {
  const { resolveConnectSourceConnectionStates } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );

  const [state] = resolveConnectSourceConnectionStates(
    [{ id: "fitbit" }],
    [{
      connectionId: "dsc_junction_fitbit",
      provider: "junction",
      state: "active",
      upstreamSources: [
        {
          firstSeenAt: "2026-07-01T00:00:00.000Z",
          lastDataAt: "2026-08-10T00:00:00.000Z",
          lastErrorCode: "SOURCE_PROVIDER_DISCONNECTED",
          lastSeenAt: "2026-08-10T00:00:00.000Z",
          providerLabel: "Fitbit",
          resourceCount: 4,
          sourceProviderSlug: "fitbit",
          status: "disconnected",
        },
        {
          firstSeenAt: "2026-08-11T10:00:00.000Z",
          lastDataAt: "2026-08-11T10:05:00.000Z",
          lastSeenAt: "2026-08-11T10:06:00.000Z",
          providerLabel: "Fitbit",
          resourceCount: 3,
          sourceProviderSlug: "google_health",
          status: "connected",
        },
      ],
    }],
  );

  assert.deepEqual(state, {
    connectionId: "dsc_junction_fitbit",
    connectProvider: null,
    connectTarget: null,
    disconnectSourceProviderSlug: "fitbit",
    migrationState: "cutover_ready",
    requiresReconnect: false,
    sourceId: "fitbit",
    state: "active",
  });
});

test("ConnectPage treats user-disconnected legacy Fitbit as migrated to Google Health", async () => {
  const { resolveConnectSourceConnectionStates } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );

  const [state] = resolveConnectSourceConnectionStates(
    [{ id: "fitbit" }],
    [{
      connectionId: "dsc_junction_fitbit",
      provider: "junction",
      state: "active",
      upstreamSources: [
        {
          firstSeenAt: "2026-07-01T00:00:00.000Z",
          lastDataAt: "2026-08-10T00:00:00.000Z",
          lastErrorCode: "SOURCE_USER_DISCONNECTED",
          lastSeenAt: "2026-08-10T00:00:00.000Z",
          providerLabel: "Fitbit",
          resourceCount: 4,
          sourceProviderSlug: "fitbit",
          status: "disconnected",
        },
        {
          firstSeenAt: "2026-08-11T10:00:00.000Z",
          lastDataAt: "2026-08-11T10:05:00.000Z",
          lastSeenAt: "2026-08-11T10:06:00.000Z",
          providerLabel: "Fitbit",
          resourceCount: 3,
          sourceProviderSlug: "google_health",
          status: "connected",
        },
      ],
    }],
  );

  assert.deepEqual(state, {
    connectionId: "dsc_junction_fitbit",
    connectProvider: "junction",
    connectTarget: null,
    disconnectSourceProviderSlug: "google_health",
    requiresReconnect: false,
    sourceId: "fitbit",
    state: "active",
  });
});

test("ConnectPage renders one Fitbit card while legacy and Google Health overlap", async () => {
  vi.stubEnv("JUNCTION_API_KEY", "sk_us_junction-test");
  vi.stubEnv(
    "JUNCTION_CLIENT_USER_ID_SECRET",
    "junction-client-user-id-secret",
  );
  vi.stubEnv("JUNCTION_ENV", "sandbox");
  vi.stubEnv("JUNCTION_PROVIDER_FILTER", "fitbit");
  vi.stubEnv("JUNCTION_REGION", "us");
  mocks.buildHostedDeviceSyncSettingsResponse.mockResolvedValueOnce({
    generatedAt: "2026-08-11T12:10:00.000Z",
    ok: true,
    sources: [{
      connectionId: "dsc_junction_fitbit",
      provider: "junction",
      state: "active",
      upstreamSources: [
        {
          connectProvider: "junction",
          connectSourceId: "fitbit",
          connectTarget: "fitbit",
          firstSeenAt: "2026-07-01T00:00:00.000Z",
          lastDataAt: "2026-08-11T11:00:00.000Z",
          lastSeenAt: "2026-08-11T11:00:00.000Z",
          providerLabel: "Fitbit",
          resourceCount: 4,
          sourceProviderSlug: "fitbit",
          status: "connected",
        },
        {
          connectProvider: "junction",
          connectSourceId: "fitbit",
          connectTarget: "fitbit",
          firstSeenAt: "2026-08-11T12:00:00.000Z",
          lastDataAt: null,
          lastSeenAt: "2026-08-11T12:00:00.000Z",
          providerLabel: "Fitbit",
          resourceCount: 3,
          sourceProviderSlug: "google_health",
          status: "connected",
        },
      ],
    }],
  });

  const { default: ConnectPage } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const markup = renderToStaticMarkup(await ConnectPage());

  assert.equal(markup.match(/<h2[^>]*>Fitbit<\/h2>/gu)?.length, 1);
  assert.equal(
    markup.match(/src="\/brand-logos\/connect\/fitbit\.svg"/gu)?.length,
    1,
  );
  assert.match(markup, /Google Health is authorized/u);
  assert.doesNotMatch(markup, /Daily Readiness|Fitbit Sleep Score/u);
});

test("ConnectPage carries source-scoped disconnect ids for multi-source upstream projections", async () => {
  const { resolveConnectSourceConnectionStates } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );

  assert.deepEqual(
    resolveConnectSourceConnectionStates(
      [{ id: "apple-health" }, { id: "whoop" }],
      [
        {
          connectionId: "dsc_junction_multi_source",
          provider: "junction",
          state: "active",
          upstreamSources: [
            {
              providerLabel: "Apple Health",
              resourceCount: 4,
              sourceProviderSlug: "apple_health_kit",
              status: "connected",
            },
            {
              providerLabel: "WHOOP",
              resourceCount: 3,
              sourceProviderSlug: "whoop_v2",
              status: "connected",
            },
          ],
        },
      ],
    ),
    [
      {
        connectionId: "dsc_junction_multi_source",
        connectProvider: "junction",
        connectTarget: null,
        disconnectSourceProviderSlug: "apple_health_kit",
        requiresReconnect: false,
        sourceId: "apple-health",
        state: "active",
      },
      {
        connectionId: "dsc_junction_multi_source",
        connectProvider: "junction",
        connectTarget: null,
        disconnectSourceProviderSlug: "whoop_v2",
        requiresReconnect: false,
        sourceId: "whoop",
        state: "active",
      },
    ],
  );
});

test("ConnectPage preserves reconnect action on active source matches", async () => {
  const { resolveConnectSourceConnectionStates } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );

  assert.deepEqual(
    resolveConnectSourceConnectionStates(
      [{ id: "whoop" }],
      [
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
      ],
    ),
    [
      {
        connectionId: "dsc_whoop_active_error",
        connectProvider: "whoop",
        connectTarget: null,
        requiresReconnect: true,
        sourceId: "whoop",
        state: "active",
      },
    ],
  );
});

test("ConnectPage lets Junction source reconnect win over healthy duplicate direct source", async () => {
  const { resolveConnectSourceConnectionStates } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );

  assert.deepEqual(
    resolveConnectSourceConnectionStates(
      [{ id: "whoop" }],
      [
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
      ],
    ),
    [
      {
        connectionId: "dsc_junction_whoop",
        connectProvider: "junction",
        connectTarget: "whoop",
        disconnectSourceProviderSlug: "whoop_v2",
        requiresReconnect: true,
        sourceId: "whoop",
        state: "active",
      },
    ],
  );
});

test("ConnectPage keeps healthy Junction child sources connected when another child needs reconnect", async () => {
  const { resolveConnectSourceConnectionStates } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );

  assert.deepEqual(
    resolveConnectSourceConnectionStates(
      [{ id: "garmin" }, { id: "whoop" }],
      [
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
      ],
    ),
    [
      {
        connectionId: "dsc_junction_multi",
        connectProvider: "junction",
        connectTarget: null,
        disconnectSourceProviderSlug: "garmin",
        requiresReconnect: false,
        sourceId: "garmin",
        state: "active",
      },
      {
        connectionId: "dsc_junction_multi",
        connectProvider: "junction",
        connectTarget: null,
        disconnectSourceProviderSlug: "whoop_v2",
        requiresReconnect: true,
        sourceId: "whoop",
        state: "active",
      },
    ],
  );
});

test("ConnectPage gives each reconnect-required Junction child its own target", async () => {
  const { resolveConnectSourceConnectionStates } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );

  assert.deepEqual(
    resolveConnectSourceConnectionStates(
      [{ id: "garmin" }, { id: "whoop" }],
      [
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
      ],
    ),
    [
      {
        connectionId: "dsc_junction_multi",
        connectProvider: "junction",
        connectTarget: "garmin",
        disconnectSourceProviderSlug: "garmin",
        requiresReconnect: true,
        sourceId: "garmin",
        state: "active",
      },
      {
        connectionId: "dsc_junction_multi",
        connectProvider: "junction",
        connectTarget: "whoop",
        disconnectSourceProviderSlug: "whoop_v2",
        requiresReconnect: true,
        sourceId: "whoop",
        state: "active",
      },
    ],
  );
});

test("ConnectPage adds source-scoped disconnects beside Junction reconnect actions", async () => {
  mocks.buildHostedDeviceSyncSettingsResponse.mockResolvedValueOnce({
    generatedAt: "2026-05-01T00:00:00.000Z",
    ok: true,
    sources: [
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
    ],
  });

  const { default: ConnectPage } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const markup = renderToStaticMarkup(await ConnectPage());

  assert.match(markup, /Garmin needs reconnect/u);
  assert.match(markup, /Whoop needs reconnect/u);
  assert.match(markup, /aria-label="Reconnect Garmin"/u);
  assert.match(markup, /aria-label="Reconnect Whoop"/u);
  assert.match(markup, /aria-label="Disconnect Garmin"/u);
  assert.match(markup, /aria-label="Disconnect Whoop"/u);
  assert.doesNotMatch(markup, /aria-label="Disconnect account"/u);
});

test("ConnectPage projects Junction connection-reset sources with account-scoped disconnects", async () => {
  const { resolveConnectSourceConnectionStates } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );

  assert.deepEqual(
    resolveConnectSourceConnectionStates(
      [{ id: "garmin" }],
      [
        {
          connectionId: "dsc_junction_garmin",
          provider: "junction",
          state: "active",
          upstreamSources: [
            {
              providerLabel: "Garmin",
              recoveryKind: "connection_reset",
              resourceCount: 3,
              sourceProviderSlug: "garmin",
              status: "error",
            },
          ],
        },
      ],
    ),
    [
      {
        connectionId: "dsc_junction_garmin",
        connectProvider: "junction",
        connectTarget: null,
        disconnectScope: "junction_account",
        recoveryKind: "connection_reset",
        requiresReconnect: false,
        sourceId: "garmin",
        state: "active",
      },
    ],
  );
});

test("ConnectPage keeps single-source Junction historical recovery on disconnect, never reconnect", async () => {
  vi.stubEnv("JUNCTION_API_KEY", "sk_us_junction-test");
  vi.stubEnv(
    "JUNCTION_CLIENT_USER_ID_SECRET",
    "junction-client-user-id-secret",
  );
  vi.stubEnv("JUNCTION_ENV", "sandbox");
  vi.stubEnv("JUNCTION_PROVIDER_FILTER", "garmin");
  vi.stubEnv("JUNCTION_REGION", "us");

  mocks.buildHostedDeviceSyncSettingsResponse.mockResolvedValueOnce({
    generatedAt: "2026-07-09T00:00:00.000Z",
    ok: true,
    sources: [
      {
        connectionId: "dsc_junction_garmin",
        provider: "junction",
        state: "active",
        upstreamSources: [
          {
            providerLabel: "Garmin",
            recoveryKind: "connection_reset",
            resourceCount: 3,
            sourceProviderSlug: "garmin",
            status: "error",
          },
        ],
      },
    ],
  });

  const { default: ConnectPage } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const markup = renderToStaticMarkup(await ConnectPage());

  assert.match(markup, /Garmin needs a fresh connection/u);
  assert.match(markup, /Disconnect it first, then connect it again\./u);
  assert.match(markup, /data-connection-state="needs-access"/u);
  assert.doesNotMatch(markup, /aria-label="Reconnect Garmin"/u);
  assert.doesNotMatch(markup, /aria-label="Connect Garmin"/u);
  assert.doesNotMatch(markup, /Garmin connected/u);
  assert.match(markup, /aria-label="Disconnect account"/u);
});

test("ConnectPage keeps multi-source Junction historical recovery on disconnect, never reconnect", async () => {
  vi.stubEnv("JUNCTION_API_KEY", "sk_us_junction-test");
  vi.stubEnv(
    "JUNCTION_CLIENT_USER_ID_SECRET",
    "junction-client-user-id-secret",
  );
  vi.stubEnv("JUNCTION_ENV", "sandbox");
  vi.stubEnv("JUNCTION_PROVIDER_FILTER", "garmin");
  vi.stubEnv("JUNCTION_REGION", "us");

  mocks.buildHostedDeviceSyncSettingsResponse.mockResolvedValueOnce({
    generatedAt: "2026-07-09T00:00:00.000Z",
    ok: true,
    sources: [
      {
        connectionId: "dsc_junction_multi",
        provider: "junction",
        state: "active",
        upstreamSources: [
          {
            providerLabel: "Garmin",
            recoveryKind: "connection_reset",
            resourceCount: 3,
            sourceProviderSlug: "garmin",
            status: "error",
          },
          {
            providerLabel: "WHOOP",
            resourceCount: 3,
            sourceProviderSlug: "whoop_v2",
            status: "connected",
          },
        ],
      },
    ],
  });

  const { default: ConnectPage } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const markup = renderToStaticMarkup(await ConnectPage());

  assert.match(markup, /Garmin needs a fresh connection/u);
  assert.match(markup, /Whoop connected/u);
  assert.doesNotMatch(markup, /aria-label="Reconnect Garmin"/u);
  assert.doesNotMatch(markup, /aria-label="Connect Garmin"/u);
  assert.equal(markup.match(/aria-label="Disconnect account"/gu)?.length, 1);
  assert.match(markup, /aria-label="Disconnect Whoop"/u);
});

test("SourceCard stacks connection-reset content vertically at the base breakpoint", async () => {
  const { SourceCard } = await import(
    "../app/(dashboard)/connect/connect-source-card"
  );
  const logo = {
    className: "size-11 object-contain",
    height: 44,
    src: "/logo.png",
    width: 44,
  };
  const cardProps = {
    authenticated: true,
    errorMessage: null,
    onDisconnectTargetChange: () => {},
    onStartConnection: async () => {},
    pending: false,
    pendingDisconnect: false,
  };

  const resetMarkup = renderToStaticMarkup(
    createElement(SourceCard, {
      ...cardProps,
      source: {
        description:
          "Garmin workouts, sleep, stress, heart, body battery, and activity data.",
        disconnectConnectionId: "dsc_junction_garmin",
        disconnectScope: "junction_account" as const,
        id: "garmin",
        logo,
        name: "Garmin",
        recoveryKind: "connection_reset" as const,
      },
    }),
  );

  assert.match(
    resetMarkup,
    /Garmin needs a fresh connection\. Disconnect it first, then connect it again\./u,
  );
  // The reset message can be up to 22rem wide, so the card content must stack at
  // the base breakpoint instead of squeezing the source details in the shared
  // horizontal row under the card's overflow-hidden.
  assert.match(
    resetMarkup,
    /class="flex flex-1 flex-col items-stretch gap-3 sm:gap-0"/u,
  );
  assert.doesNotMatch(resetMarkup, /items-center gap-4/u);
  assert.match(resetMarkup, /aria-label="Disconnect account"/u);
  assert.doesNotMatch(
    resetMarkup,
    /aria-label="(?:Connect|Reconnect) Garmin"/u,
  );

  const ordinaryMarkup = renderToStaticMarkup(
    createElement(SourceCard, {
      ...cardProps,
      source: {
        description:
          "Garmin workouts, sleep, stress, heart, body battery, and activity data.",
        id: "garmin",
        logo,
        name: "Garmin",
      },
    }),
  );

  assert.match(
    ordinaryMarkup,
    /class="flex flex-1 items-end gap-4 sm:flex-col sm:items-stretch sm:gap-0"/u,
  );
  assert.match(
    ordinaryMarkup,
    /class="ml-auto flex shrink-0 flex-col items-stretch gap-2 self-end sm:mt-auto sm:shrink"/u,
  );
  assert.match(ordinaryMarkup, /data-connection-state="idle"/u);
  assert.match(ordinaryMarkup, /Garmin not connected/u);
  assert.match(
    ordinaryMarkup,
    /aria-label="Garmin connection is not available yet"[^>]+self-end/u,
  );

  const connectedMarkup = renderToStaticMarkup(
    createElement(SourceCard, {
      ...cardProps,
      source: {
        connected: true,
        description:
          "Garmin workouts, sleep, stress, heart, body battery, and activity data.",
        disconnectConnectionId: "dsc_garmin",
        id: "garmin",
        logo,
        name: "Garmin",
      },
    }),
  );

  assert.match(
    connectedMarkup,
    /class="ml-auto flex shrink-0 flex-col items-end gap-2 self-end sm:mt-auto sm:shrink"/u,
  );
  assert.match(connectedMarkup, /aria-label="Disconnect Garmin"[^>]+self-end/u);

  const actionErrorMarkup = renderToStaticMarkup(
    createElement(SourceCard, {
      ...cardProps,
      errorMessage: "Garmin could not open. Please try again.",
      source: {
        connectTarget: "garmin",
        description:
          "Garmin workouts, sleep, stress, heart, body battery, and activity data.",
        id: "garmin",
        logo,
        name: "Garmin",
      },
    }),
  );

  assert.match(
    actionErrorMarkup,
    /class="flex flex-1 flex-col items-stretch gap-3 sm:gap-0"/u,
  );
  assert.match(
    actionErrorMarkup,
    /class="flex w-full shrink-0 flex-col items-stretch gap-2 self-stretch sm:mt-auto sm:shrink"/u,
  );
  assert.match(actionErrorMarkup, /aria-label="Connect Garmin"[^>]+self-end/u);
});

test("SourceCard does not promise unavailable Strava recovery connections", async () => {
  const { SourceCard } = await import(
    "../app/(dashboard)/connect/connect-source-card"
  );
  const logo = {
    className: "h-auto max-h-9 w-auto max-w-[8rem] object-contain",
    height: 20,
    src: "/brand-logos/connect/strava.svg",
    width: 96,
  };
  const cardProps = {
    authenticated: true,
    errorMessage: null,
    onDisconnectTargetChange: () => {},
    onStartConnection: async () => {},
    pending: false,
    pendingDisconnect: false,
  };

  const resetMarkup = renderToStaticMarkup(
    createElement(SourceCard, {
      ...cardProps,
      source: {
        connectionAvailable: false,
        description:
          "Rides, runs, workouts, route context, power, and training load.",
        disconnectConnectionId: "dsc_strava_reset",
        id: "strava",
        logo,
        name: "Strava",
        recoveryKind: "connection_reset" as const,
      },
    }),
  );

  assert.match(
    resetMarkup,
    /Strava needs a fresh connection, but reconnecting is temporarily unavailable\./u,
  );
  assert.doesNotMatch(resetMarkup, /then connect it again/u);
  assert.doesNotMatch(
    resetMarkup,
    /aria-label="(?:Connect|Reconnect) Strava"/u,
  );
  assert.doesNotMatch(resetMarkup, />Not available</u);

  const historicalResetMarkup = renderToStaticMarkup(
    createElement(SourceCard, {
      ...cardProps,
      source: {
        connectionAvailable: false,
        description:
          "Rides, runs, workouts, route context, power, and training load.",
        disconnectConnectionId: "dsc_strava_historical_reset",
        disconnectScope: "junction_account" as const,
        historicalResetIncomplete: true,
        id: "strava",
        logo,
        name: "Strava",
      },
    }),
  );

  assert.match(
    historicalResetMarkup,
    /Reconnecting through Murph is temporarily unavailable\./u,
  );
  assert.doesNotMatch(historicalResetMarkup, /connect it again here/u);
  assert.doesNotMatch(
    historicalResetMarkup,
    /aria-label="(?:Connect|Reconnect) Strava"/u,
  );
  assert.doesNotMatch(historicalResetMarkup, />Not available</u);
});

test("SourceCard stacks Apple Health app content vertically at the base breakpoint", async () => {
  const { SourceCard } = await import(
    "../app/(dashboard)/connect/connect-source-card"
  );
  const logo = {
    className: "size-11 object-contain",
    height: 44,
    src: "/logo.png",
    width: 44,
  };

  const appDownloadMarkup = renderToStaticMarkup(
    createElement(SourceCard, {
      authenticated: true,
      errorMessage: null,
      onDisconnectTargetChange: () => {},
      onStartConnection: async () => {},
      pending: false,
      pendingDisconnect: false,
      source: {
        description:
          "iPhone and Apple Watch activity, sleep, vitals, and workouts.",
        id: "apple-health",
        logo,
        name: "Apple Health",
        unavailableActionLabel: "Download app",
        unavailableActionUrl:
          "https://apps.apple.com/us/app/murph-ai/id6786145859",
        unavailableMessage:
          "Download Murph on your iPhone, then connect Apple Health in the app.",
      },
    }),
  );

  assert.match(
    appDownloadMarkup,
    /Download Murph on your iPhone, then connect Apple Health in the app\./u,
  );
  assert.match(appDownloadMarkup, />Download app<\/a>/u);
  assert.match(
    appDownloadMarkup,
    /href="https:\/\/apps\.apple\.com\/us\/app\/murph-ai\/id6786145859"/u,
  );
  // The app-download message can be up to 22rem wide, so the card content must
  // stack at the base breakpoint instead of overlapping the source details in
  // the shared horizontal row under the card's overflow-hidden.
  assert.match(
    appDownloadMarkup,
    /class="flex flex-1 flex-col items-stretch gap-3 sm:gap-0"/u,
  );
  assert.doesNotMatch(appDownloadMarkup, /items-center gap-4/u);
  assert.match(
    appDownloadMarkup,
    /class="flex w-full shrink-0 flex-col items-stretch gap-2 self-stretch sm:mt-auto sm:shrink"/u,
  );
  assert.match(
    appDownloadMarkup,
    /aria-label="Download app for Apple Health"[^>]+self-end/u,
  );
});

test("connect source card design study renders the production action states", async () => {
  const { ConnectSourceCardStudy } = await import(
    "../app/design/connect-source-card-study"
  );
  const markup = renderToStaticMarkup(createElement(ConnectSourceCardStudy));

  assert.match(markup, /id="connect-source-card-actions"/u);
  assert.match(markup, /aria-label="Disconnect Garmin"/u);
  assert.match(markup, /aria-label="Download app for Apple Health"/u);
  assert.match(markup, /aria-label="Connect Fitbit"/u);
  assert.match(markup, /aria-label="Sign in to connect Oura"/u);
  assert.match(markup, /Whoop needs a fresh connection/u);
  assert.match(markup, /aria-label="Disconnect account"/u);
  assert.match(markup, /Peloton could not open\. Please try again\./u);
});

test("ConnectPage lets active reconnect rows win over stale reconnectable rows", async () => {
  const { resolveConnectSourceConnectionStates } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );

  assert.deepEqual(
    resolveConnectSourceConnectionStates(
      [{ id: "whoop" }],
      [
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
      ],
    ),
    [
      {
        connectionId: "dsc_whoop_active_error",
        connectProvider: "whoop",
        connectTarget: null,
        requiresReconnect: true,
        sourceId: "whoop",
        state: "active",
      },
    ],
  );
});

test("ConnectPage treats Junction reauthorization as reconnectable even when upstream status is stale", async () => {
  vi.stubEnv("JUNCTION_API_KEY", "sk_us_junction-test");
  vi.stubEnv(
    "JUNCTION_CLIENT_USER_ID_SECRET",
    "junction-client-user-id-secret",
  );
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

  const { default: ConnectPage } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const markup = renderToStaticMarkup(await ConnectPage());

  assert.match(markup, /Oura needs reconnect/);
  assert.match(markup, /aria-label="Reconnect Oura"/u);
});

test("resolveConnectedConnectSourceConnections carries connection ids for direct and Junction matches", async () => {
  const { resolveConnectedConnectSourceConnections } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const sources = [{ id: "oura" }, { id: "whoop" }, { id: "garmin" }];

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
  vi.stubEnv(
    "JUNCTION_CLIENT_USER_ID_SECRET",
    "junction-client-user-id-secret",
  );
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

  const { default: ConnectPage } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const markup = renderToStaticMarkup(await ConnectPage());

  assert.match(markup, /Oura not connected/);
  assert.match(markup, /data-connection-state="idle"/u);
  assert.match(markup, /aria-label="Connect Oura"/u);
  assert.doesNotMatch(markup, /Oura needs reconnect/u);
  assert.doesNotMatch(markup, /did not finish/u);
  assert.doesNotMatch(markup, /aria-label="Reconnect Oura"/u);
  assert.doesNotMatch(markup, /aria-label="Disconnect Oura"/u);
});

test("ConnectPage keeps unfinished-reset guidance visible on disconnected Junction sources", async () => {
  vi.stubEnv("JUNCTION_API_KEY", "sk_us_junction-test");
  vi.stubEnv(
    "JUNCTION_CLIENT_USER_ID_SECRET",
    "junction-client-user-id-secret",
  );
  vi.stubEnv("JUNCTION_ENV", "sandbox");
  vi.stubEnv("JUNCTION_PROVIDER_FILTER", "garmin");
  vi.stubEnv("JUNCTION_REGION", "us");

  mocks.buildHostedDeviceSyncSettingsResponse.mockResolvedValueOnce({
    generatedAt: "2026-07-10T00:00:00.000Z",
    ok: true,
    sources: [
      {
        connectionId: "dsc_junction_garmin",
        historicalResetIncomplete: true,
        provider: "junction",
        state: "disconnected",
        upstreamSources: [
          {
            providerLabel: "Garmin",
            resourceCount: 0,
            sourceProviderSlug: "garmin",
            status: "disconnected",
          },
        ],
      },
    ],
  });

  const { default: ConnectPage } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const markup = renderToStaticMarkup(await ConnectPage());

  assert.match(
    markup,
    /The last reset for Garmin did not finish\. Remove the old connection in your wearable provider account, then connect it again here\./u,
  );
  assert.match(markup, /aria-label="Connect Garmin"/u);
  assert.match(markup, /data-connection-state="needs-access"/u);
  assert.doesNotMatch(markup, /HISTORICAL_RESET_REVOKE_FAILED/u);
  assert.doesNotMatch(markup, /aria-label="Reconnect Garmin"/u);
  assert.doesNotMatch(markup, /aria-label="Disconnect account"/u);
});

test("resolveHistoricalResetIncompleteConnectSourceIds maps direct and Junction disconnected sources", async () => {
  const { resolveHistoricalResetIncompleteConnectSourceIds } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );

  const sourceIds = resolveHistoricalResetIncompleteConnectSourceIds(
    [{ id: "whoop" }, { id: "garmin" }],
    [
      {
        connectionId: "dsc_whoop_direct",
        historicalResetIncomplete: true,
        provider: "whoop",
        state: "disconnected",
        upstreamSources: [],
      },
      {
        connectionId: "dsc_junction_garmin",
        historicalResetIncomplete: true,
        provider: "junction",
        state: "disconnected",
        upstreamSources: [
          {
            providerLabel: "Garmin",
            resourceCount: 0,
            sourceProviderSlug: "garmin",
            status: "disconnected",
          },
        ],
      },
      {
        connectionId: "dsc_oura_plain",
        provider: "oura",
        state: "disconnected",
        upstreamSources: [],
      },
    ],
  );

  assert.deepEqual([...sourceIds].sort(), ["garmin", "whoop"]);
});

test("ConnectPage keeps configured sources visible but renders sign-in actions when signed out", async () => {
  vi.stubEnv("JUNCTION_API_KEY", "sk_us_junction-test");
  vi.stubEnv(
    "JUNCTION_CLIENT_USER_ID_SECRET",
    "junction-client-user-id-secret",
  );
  vi.stubEnv("JUNCTION_ENV", "sandbox");
  vi.stubEnv("JUNCTION_PROVIDER_FILTER", "garmin");
  vi.stubEnv("JUNCTION_REGION", "us");
  mocks.getHostedPageAuthSnapshot.mockResolvedValueOnce({
    authenticated: false,
    authenticatedMember: null,
    linkedAccounts: [],
    session: null,
  });

  const { default: ConnectPage } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
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
  const { ConnectSourcesGrid } = await import(
    "../app/(dashboard)/connect/connect-page-client"
  );
  const rendered = await renderClientComponent(
    createElement(
      AuthProvider,
      { authenticated: false },
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
  const { ConnectSourcesGrid } = await import(
    "../app/(dashboard)/connect/connect-page-client"
  );
  const rendered = await renderClientComponent(
    createElement(
      AuthProvider,
      { authenticated: false },
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
  const { ConnectSourcesGrid } = await import(
    "../app/(dashboard)/connect/connect-page-client"
  );
  const rendered = await renderClientComponent(
    createElement(
      AuthProvider,
      { authenticated: false },
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

test("ConnectSourcesGrid explains Garmin Historical Data before starting the connection", async () => {
  const fetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return Response.json({
        authorizationUrl: "https://junction.example.test/link/garmin",
      });
    },
  );
  vi.stubGlobal("fetch", fetch);
  const { ConnectSourcesGrid } = await import(
    "../app/(dashboard)/connect/connect-page-client"
  );
  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      garminHistoricalDataVoiceMemoSrc:
        "/audio/garmin-historical-data-memos/grandpa.mp3",
      sources: [
        {
          connectTarget: "garmin",
          requiresJunctionDisclosure: true,
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
    }),
  );

  assert.equal(rendered.button.disabled, false);
  assert.equal(rendered.button.textContent, "Connect");

  await act(async () => {
    rendered.button.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  assert.equal(fetch.mock.calls.length, 0);
  assert.match(rendered.container.textContent ?? "", /Turn on Historical Data/);
  assert.match(
    rendered.container.textContent ?? "",
    /When Garmin opens, turn on Historical Data before approving\./,
  );
  assert.ok(
    rendered.container.querySelector(
      "audio[src='/audio/garmin-historical-data-memos/grandpa.mp3']",
    ),
    "expected the member's picked-voice Garmin reminder",
  );

  const dialogButtons = [...rendered.container.querySelectorAll("button")]
    .map((button) => button.textContent?.trim())
    .filter((label) => label === "Cancel" || label === "Continue to Garmin");
  assert.deepEqual(dialogButtons, ["Continue to Garmin"]);

  const continueButton = [
    ...rendered.container.querySelectorAll("button"),
  ].find((button) => button.textContent === "Continue to Garmin");
  assert.ok(continueButton instanceof rendered.window.HTMLButtonElement);

  await act(async () => {
    continueButton.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  await vi.waitFor(() => {
    assert.equal(fetch.mock.calls.length, 1);
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
  assert.equal(
    rendered.assign.mock.calls[0]?.[0],
    "https://junction.example.test/link/garmin",
  );

  await rendered.cleanup();
});

test("ConnectSourcesGrid redeems an initial device connect intent through the app page", async () => {
  const claim = "dc_12345678901234567890123456789012";
  const fetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return Response.json({
        authorizationUrl: "https://provider.example.test/oauth/start",
      });
    },
  );
  vi.stubGlobal("fetch", fetch);

  const { ConnectSourcesGrid } = await import(
    "../app/(dashboard)/connect/connect-page-client"
  );
  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
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
          requiresJunctionDisclosure: true,
        },
      ],
    }),
    {
      location: {
        hash: `#deviceConnectIntent=${claim}&connectSource=whoop&connectProvider=whoop`,
        href: `https://join.example.test/connect#deviceConnectIntent=${claim}&connectSource=whoop&connectProvider=whoop`,
      },
    },
  );

  await vi.waitFor(() => {
    assert.equal(fetch.mock.calls.length, 1);
    assert.equal(
      rendered.assign.mock.calls[0]?.[0],
      "https://provider.example.test/oauth/start",
    );
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
  assert.doesNotMatch(
    rendered.container.textContent ?? "",
    /Connect Whoop to Murph/u,
  );

  await rendered.cleanup();
});

test("ConnectSourcesGrid explains Junction before redeeming an initial device connect intent", async () => {
  const claim = "dc_12345678901234567890123456789012";
  let resolveAuthorizationResponse:
    | ((response: Response) => void)
    | null = null;
  const fetch = vi.fn(
    (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return new Promise<Response>((resolve) => {
        resolveAuthorizationResponse = resolve;
      });
    },
  );
  vi.stubGlobal("fetch", fetch);

  const { ConnectSourcesGrid } = await import(
    "../app/(dashboard)/connect/connect-page-client"
  );
  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [
        {
          connectTarget: "fitbit",
          description: "Fitbit and Pixel Watch sleep, activity, heart rate, exercise, and workout trends through Google authorization.",
          id: "fitbit",
          logo: {
            className: "size-11 object-contain",
            height: 44,
            src: "/brand-logos/connect/fitbit.svg",
            width: 44,
          },
          name: "Fitbit",
        },
      ],
    }),
    {
      location: {
        hash: `#deviceConnectIntent=${claim}&connectSource=fitbit&connectProvider=junction`,
        href: `https://join.example.test/connect#deviceConnectIntent=${claim}&connectSource=fitbit&connectProvider=junction`,
      },
    },
  );

  await vi.waitFor(() => {
    assert.match(
      rendered.container.textContent ?? "",
      /Connect Fitbit to Murph/u,
    );
  });
  assert.equal(fetch.mock.calls.length, 0);
  assert.equal(rendered.assign.mock.calls.length, 0);

  const continueButton = [
    ...rendered.container.querySelectorAll("button"),
  ].find((button) => button.textContent === "Continue to Google");
  assert.ok(continueButton instanceof rendered.window.HTMLButtonElement);
  await act(async () => {
    continueButton.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  await vi.waitFor(() => {
    assert.equal(fetch.mock.calls.length, 1);
    assert.match(rendered.container.textContent ?? "", /Connecting Fitbit/u);
  });
  assert.equal(rendered.assign.mock.calls.length, 0);
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

  assert.ok(resolveAuthorizationResponse);
  await act(async () => {
    resolveAuthorizationResponse?.(
      Response.json({
        authorizationUrl: "https://junction.example.test/link/fitbit",
      }),
    );
  });
  await vi.waitFor(() => {
    assert.equal(
      rendered.assign.mock.calls[0]?.[0],
      "https://junction.example.test/link/fitbit",
    );
  });
  assert.equal(fetch.mock.calls.length, 1);

  await rendered.cleanup();
});

test("ConnectSourcesGrid clears signed-intent progress when Junction redemption fails", async () => {
  const claim = "dc_12345678901234567890123456789012";
  const fetch = vi.fn(async () =>
    Response.json(
      {
        error: {
          code: "HOSTED_DEVICE_CONNECT_INTENT_MISSING",
          message:
            "This connection link could not be found. Ask Murph for a new one.",
          retryable: false,
        },
      },
      { status: 410 },
    ),
  );
  vi.stubGlobal("fetch", fetch);

  const { ConnectSourcesGrid } = await import(
    "../app/(dashboard)/connect/connect-page-client"
  );
  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [
        {
          description: "Fitbit and Pixel Watch sleep, activity, heart rate, exercise, and workout trends through Google authorization.",
          id: "fitbit",
          logo: {
            className: "size-11 object-contain",
            height: 44,
            src: "/brand-logos/connect/fitbit.svg",
            width: 44,
          },
          name: "Fitbit",
        },
      ],
    }),
    {
      location: {
        hash: `#deviceConnectIntent=${claim}&connectSource=fitbit&connectProvider=junction`,
        href: `https://join.example.test/connect#deviceConnectIntent=${claim}&connectSource=fitbit&connectProvider=junction`,
      },
    },
  );

  await vi.waitFor(() => {
    assert.match(rendered.container.textContent ?? "", /Connect Fitbit to Murph/u);
  });
  const continueButton = [...rendered.container.querySelectorAll("button")]
    .find((button) => button.textContent === "Continue to Google");
  assert.ok(continueButton instanceof rendered.window.HTMLButtonElement);
  await act(async () => {
    continueButton.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  await vi.waitFor(() => {
    assert.match(
      rendered.container.textContent ?? "",
      /Connection link unavailable/u,
    );
  });
  assert.equal(fetch.mock.calls.length, 1);
  assert.doesNotMatch(rendered.container.textContent ?? "", /Connecting Fitbit/u);
  assert.equal(rendered.assign.mock.calls.length, 0);

  await rendered.cleanup();
});

test("ConnectSourcesGrid shows a recovery dialog when a device connect intent is unavailable", async () => {
  const claim = "dc_12345678901234567890123456789012";
  const fetch = vi.fn(async () =>
    Response.json(
      {
        error: {
          code: "HOSTED_DEVICE_CONNECT_INTENT_MISSING",
          message:
            "This connection link could not be found. Ask Murph for a new one.",
          retryable: false,
        },
      },
      { status: 410 },
    ),
  );
  vi.stubGlobal("fetch", fetch);

  const { ConnectSourcesGrid } = await import(
    "../app/(dashboard)/connect/connect-page-client"
  );
  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
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
    }),
    {
      location: {
        hash: `#deviceConnectIntent=${claim}&connectSource=whoop`,
        href: `https://join.example.test/connect#deviceConnectIntent=${claim}&connectSource=whoop`,
      },
    },
  );

  await vi.waitFor(() => {
    assert.equal(fetch.mock.calls.length, 1);
    assert.match(
      rendered.container.textContent ?? "",
      /Connection link unavailable/,
    );
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

test("ConnectSourcesGrid opens the WHOOP setup dialog when an intent reaches capacity", async () => {
  const claim = "dc_12345678901234567890123456789012";
  const fetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return Response.json(
        {
          error: {
            code: "WHOOP_DIRECT_CONNECT_CAP_REACHED",
            message:
              "Direct WHOOP connections are full right now. You can keep WHOOP syncing through Apple Health in the Murph app.",
            retryable: false,
          },
        },
        { status: 409 },
      );
    },
  );
  vi.stubGlobal("fetch", fetch);

  const { ConnectSourcesGrid } = await import(
    "../app/(dashboard)/connect/connect-page-client"
  );
  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
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
    }),
  );

  await vi.waitFor(() => {
    assert.equal(fetch.mock.calls.length, 1);
    assert.match(rendered.container.textContent ?? "", /Get your full sync/);
  });

  assert.equal(fetch.mock.calls[0]?.[0], `/device/connect/${claim}`);
  assert.doesNotMatch(rendered.container.textContent ?? "", /Connecting Whoop/);
  assert.doesNotMatch(
    rendered.container.textContent ?? "",
    /Connection link unavailable/,
  );
  assert.ok(
    rendered.container.querySelector("input[aria-label='Search sources']"),
  );
  assert.match(
    rendered.container.textContent ?? "",
    /Two quick steps and Murph sees everything WHOOP tracks\./,
  );
  assert.match(
    rendered.container.textContent ?? "",
    /Download Murph and sign in/,
  );
  assert.match(
    rendered.container.textContent ?? "",
    /Turn on Apple Health in WHOOP/,
  );
  assert.doesNotMatch(rendered.container.textContent ?? "", /full right now/);
  assert.doesNotMatch(rendered.container.textContent ?? "", /Junction/);

  const memoButton = rendered.container.querySelector(
    "button[aria-label='Play voice memo']",
  );
  assert.ok(memoButton instanceof rendered.window.HTMLButtonElement);
  const memoAudio = rendered.container.querySelector(
    "audio[src='/audio/whoop-sync-memos/upbeat.mp3']",
  );
  assert.ok(memoAudio, "expected the default-voice WHOOP sync memo");

  const appStoreLink = rendered.container.querySelector(
    "a[href='https://apps.apple.com/us/app/murph-ai/id6786145859']",
  );
  assert.ok(appStoreLink instanceof rendered.window.HTMLAnchorElement);
  assert.equal(appStoreLink.target, "_blank");
  assert.equal(appStoreLink.rel, "noopener noreferrer");
  assert.equal(
    appStoreLink.getAttribute("aria-label"),
    "Download App to sync WHOOP through Apple Health",
  );
  assert.equal(rendered.assign.mock.calls.length, 0);

  assert.equal(
    [...rendered.container.querySelectorAll("button")].find(
      (button) => button.textContent === "Continue with Murph",
    ),
    undefined,
  );
  const closeButton = rendered.container.querySelector(
    'button[aria-label="Close"]',
  );
  assert.ok(closeButton instanceof rendered.window.HTMLButtonElement);

  await act(async () => {
    closeButton.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  assert.ok(
    rendered.container.querySelector("input[aria-label='Search sources']"),
  );
  assert.doesNotMatch(
    rendered.container.textContent ?? "",
    /Get your full sync/,
  );

  await rendered.cleanup();
});

test("ConnectSourcesGrid opens the WHOOP setup dialog for a manual start", async () => {
  const fetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return Response.json(
        {
          error: {
            code: "WHOOP_DIRECT_CONNECT_CAP_REACHED",
            message:
              "Direct WHOOP connections are full right now. You can keep WHOOP syncing through Apple Health in the Murph app.",
            retryable: false,
          },
        },
        { status: 409 },
      );
    },
  );
  vi.stubGlobal("fetch", fetch);

  const { ConnectSourcesGrid } = await import(
    "../app/(dashboard)/connect/connect-page-client"
  );
  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
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
      whoopSyncContactAction: {
        href: "https://t.me/withmurph_bot?text=Help%20me%20finish%20setting%20up%20WHOOP",
        kind: "telegram",
        label: "Text Murph",
        rel: "noopener noreferrer",
        target: "_blank",
      },
      whoopSyncVoiceMemoSrc: "/audio/whoop-sync-memos/grandpa.mp3",
    }),
  );

  await act(async () => {
    rendered.button.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  await vi.waitFor(() => {
    assert.match(rendered.container.textContent ?? "", /Get your full sync/);
  });

  assert.equal(fetch.mock.calls[0]?.[0], "/api/connect-sources/whoop/start");
  assert.equal(rendered.assign.mock.calls.length, 0);
  assert.doesNotMatch(
    rendered.container.textContent ?? "",
    /Connection could not be started/,
  );
  assert.ok(
    rendered.container.querySelector(
      "audio[src='/audio/whoop-sync-memos/grandpa.mp3']",
    ),
    "expected the member's picked-voice WHOOP sync memo",
  );
  assert.match(
    rendered.container.textContent ?? "",
    /Download Murph and sign in/,
  );
  assert.match(
    rendered.container.textContent ?? "",
    /Turn on Apple Health in WHOOP/,
  );

  const continueLink = rendered.container.querySelector(
    'a[aria-label="Continue with Murph in Telegram (opens in a new tab)"]',
  );
  assert.ok(continueLink instanceof rendered.window.HTMLAnchorElement);
  assert.equal(continueLink.textContent, "Continue with Murph");
  assert.equal(continueLink.target, "_blank");

  await rendered.cleanup();
});

test("ConnectSourcesGrid gives a no-route manual capacity dialog a truthful close control", async () => {
  const fetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return Response.json(
        {
          error: {
            code: "WHOOP_DIRECT_CONNECT_CAP_REACHED",
            message:
              "Direct WHOOP connections are full right now. You can keep WHOOP syncing through Apple Health in the Murph app.",
            retryable: false,
          },
        },
        { status: 409 },
      );
    },
  );
  vi.stubGlobal("fetch", fetch);

  const { ConnectSourcesGrid } = await import(
    "../app/(dashboard)/connect/connect-page-client"
  );
  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
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
  );

  await act(async () => {
    rendered.button.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  await vi.waitFor(() => {
    assert.match(rendered.container.textContent ?? "", /Get your full sync/);
  });
  assert.equal(fetch.mock.calls[0]?.[0], "/api/connect-sources/whoop/start");
  assert.equal(
    [...rendered.container.querySelectorAll("button")].find(
      (button) => button.textContent === "Continue with Murph",
    ),
    undefined,
  );
  const closeButton = rendered.container.querySelector(
    'button[aria-label="Close"]',
  );
  assert.ok(closeButton instanceof rendered.window.HTMLButtonElement);

  await act(async () => {
    closeButton.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  assert.ok(
    rendered.container.querySelector("input[aria-label='Search sources']"),
  );
  assert.doesNotMatch(
    rendered.container.textContent ?? "",
    /Get your full sync/,
  );

  await rendered.cleanup();
});

test("ConnectSourcesGrid labels Telegram recovery as texting Murph", async () => {
  const claim = "dc_12345678901234567890123456789012";
  const fetch = vi.fn(async () =>
    Response.json(
      {
        error: {
          code: "HOSTED_DEVICE_CONNECT_INTENT_MISSING",
          message:
            "This connection link could not be found. Ask Murph for a new one.",
          retryable: false,
        },
      },
      { status: 410 },
    ),
  );
  vi.stubGlobal("fetch", fetch);

  const { ConnectSourcesGrid } = await import(
    "../app/(dashboard)/connect/connect-page-client"
  );
  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      deviceConnectRecoveryContactAction: {
        href: "https://t.me/murph",
        kind: "telegram",
        label: "Telegram",
        rel: "noreferrer",
        target: "_blank",
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
    }),
    {
      location: {
        hash: `#deviceConnectIntent=${claim}&connectSource=whoop`,
        href: `https://join.example.test/connect#deviceConnectIntent=${claim}&connectSource=whoop`,
      },
    },
  );

  await vi.waitFor(() => {
    assert.equal(fetch.mock.calls.length, 1);
    assert.match(
      rendered.container.textContent ?? "",
      /Connection link unavailable/,
    );
  });

  const contactLink = rendered.container.querySelector(
    "a[href='https://t.me/murph']",
  );
  assert.ok(contactLink instanceof rendered.window.HTMLAnchorElement);
  assert.equal(contactLink.textContent, "Text Murph");
  assert.doesNotMatch(rendered.container.textContent ?? "", /Open Telegram/);
  assert.match(
    contactLink.getAttribute("aria-label") ?? "",
    /\(opens in a new tab\)/,
  );

  await rendered.cleanup();
});

test("ConnectSourcesGrid falls back to email when no preferred recovery contact action is available", async () => {
  const claim = "dc_12345678901234567890123456789012";
  const fetch = vi.fn(async () =>
    Response.json(
      {
        error: {
          code: "HOSTED_DEVICE_CONNECT_INTENT_EXPIRED",
          message: "This connection link has expired. Ask Murph for a new one.",
          retryable: false,
        },
      },
      { status: 410 },
    ),
  );
  vi.stubGlobal("fetch", fetch);

  const { ConnectSourcesGrid } = await import(
    "../app/(dashboard)/connect/connect-page-client"
  );
  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
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
    {
      location: {
        hash: `#deviceConnectIntent=${claim}&connectSource=whoop`,
        href: `https://join.example.test/connect#deviceConnectIntent=${claim}&connectSource=whoop`,
      },
    },
  );

  await vi.waitFor(() => {
    assert.match(
      rendered.container.textContent ?? "",
      /Connection link unavailable/,
    );
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
  const fetch = vi.fn(
    async () =>
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetch);

  const { ConnectSourcesGrid } = await import(
    "../app/(dashboard)/connect/connect-page-client"
  );
  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
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
    {
      location: {
        hash: `#deviceConnectIntent=${claim}&connectSource=whoop`,
        href: `https://join.example.test/connect#deviceConnectIntent=${claim}&connectSource=whoop`,
      },
    },
  );

  await vi.waitFor(() => {
    assert.equal(fetch.mock.calls.length, 1);
    assert.match(rendered.container.textContent ?? "", /Connecting Whoop/);
  });

  await act(async () => {
    resolveFetch?.(
      Response.json({
        authorizationUrl: "https://provider.example.test/oauth/start",
      }),
    );
  });

  await vi.waitFor(() => {
    assert.equal(
      rendered.assign.mock.calls[0]?.[0],
      "https://provider.example.test/oauth/start",
    );
  });

  await rendered.cleanup();
});

test("ConnectSourcesGrid disconnects a connected source after confirmation", async () => {
  const fetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return Response.json({});
    },
  );
  vi.stubGlobal("fetch", fetch);

  const { ConnectSourcesGrid } = await import(
    "../app/(dashboard)/connect/connect-page-client"
  );
  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
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
    }),
  );

  const disconnectButton = rendered.container.querySelector(
    "button[aria-label='Disconnect Whoop']",
  );
  assert.ok(disconnectButton instanceof rendered.window.HTMLButtonElement);
  assert.equal(disconnectButton.textContent, "Disconnect");

  await act(async () => {
    disconnectButton.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  assert.match(rendered.container.textContent ?? "", /Disconnect Whoop\?/);
  const confirmButton = [...rendered.container.querySelectorAll("button")]
    .filter((button) => button.textContent === "Disconnect")
    .at(-1);
  assert.ok(confirmButton instanceof rendered.window.HTMLButtonElement);
  assert.equal(confirmButton.textContent, "Disconnect");

  await act(async () => {
    confirmButton.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  await vi.waitFor(() => {
    assert.equal(fetch.mock.calls.length, 1);
    assert.match(
      rendered.container.textContent ?? "",
      /Disconnected Whoop\. Your history is still saved\./,
    );
  });

  assert.equal(
    fetch.mock.calls[0]?.[0],
    "/api/settings/device-sync/connections/dsc_whoop_123/disconnect",
  );
  assert.deepEqual(fetch.mock.calls[0]?.[1], {
    body: undefined,
    cache: "no-store",
    credentials: "same-origin",
    headers: {},
    method: "POST",
    keepalive: false,
  });
  assert.match(rendered.container.textContent ?? "", /Whoop not connected/);
  assert.equal(
    rendered.container.querySelector("button[aria-label='Connect Whoop']")
      ?.textContent,
    "Connect",
  );

  await rendered.cleanup();
});

test("ConnectSourcesGrid disconnects one reconnect-required Junction source without hiding siblings", async () => {
  const fetch = vi.fn(
    async (input: RequestInfo | URL, _init?: RequestInit) => {
      void _init;
      if (String(input).includes("/disconnect")) {
        return Response.json({
          sourceProviderSlug: "oura",
          status: "disconnected",
        });
      }

      return Response.json({
        authorizationUrl: "https://oura.example.test/oauth/start",
      });
    },
  );
  vi.stubGlobal("fetch", fetch);

  const { ConnectSourcesGrid } = await import(
    "../app/(dashboard)/connect/connect-page-client"
  );
  const sharedConnectionId = "dsc_junction_shared";
  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [
        {
          connected: true,
          connectProvider: "junction",
          connectTarget: "oura",
          description:
            "Sleep, readiness, activity, heart rate, and temperature trends.",
          disconnectConnectionId: sharedConnectionId,
          disconnectSourceProviderSlug: "oura",
          id: "oura",
          logo: {
            className: "size-11 object-contain",
            height: 44,
            src: "/brand-logos/connect/oura.png",
            width: 44,
          },
          name: "Oura",
          requiresReconnect: true,
          requiresJunctionDisclosure: false,
        },
        {
          connected: true,
          description: "Recovery, strain, sleep, and heart rate.",
          disconnectConnectionId: sharedConnectionId,
          disconnectSourceProviderSlug: "whoop_v2",
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
  );

  const reconnectButton = rendered.container.querySelector(
    "button[aria-label='Reconnect Oura']",
  );
  assert.ok(reconnectButton instanceof rendered.window.HTMLButtonElement);

  await act(async () => {
    reconnectButton.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  assert.match(rendered.container.textContent ?? "", /We use Junction/u);
  assert.equal(fetch.mock.calls.length, 0);
  const closeButton = rendered.container.querySelector(
    "button[aria-label='Close']",
  );
  assert.ok(closeButton instanceof rendered.window.HTMLButtonElement);

  await act(async () => {
    closeButton.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  const disconnectButton = rendered.container.querySelector(
    "button[aria-label='Disconnect Oura']",
  );
  assert.ok(disconnectButton instanceof rendered.window.HTMLButtonElement);

  await act(async () => {
    disconnectButton.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  assert.match(rendered.container.textContent ?? "", /Disconnect Oura\?/u);
  assert.match(
    rendered.container.textContent ?? "",
    /Murph will stop syncing new data from Oura\. Your history is kept\./u,
  );
  const confirmButton = [...rendered.container.querySelectorAll("button")]
    .filter((button) => button.textContent === "Disconnect")
    .at(-1);
  assert.ok(confirmButton instanceof rendered.window.HTMLButtonElement);

  await act(async () => {
    confirmButton.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  await vi.waitFor(() => {
    assert.match(rendered.container.textContent ?? "", /Oura not connected/u);
    assert.match(rendered.container.textContent ?? "", /Whoop connected/u);
  });
  assert.equal(
    fetch.mock.calls[0]?.[0],
    `/api/settings/device-sync/connections/${sharedConnectionId}/sources/oura/disconnect`,
  );
  assert.ok(
    rendered.container.querySelector("button[aria-label='Disconnect Whoop']"),
  );
  const connectButton = rendered.container.querySelector(
    "button[aria-label='Connect Oura']",
  );
  assert.ok(connectButton instanceof rendered.window.HTMLButtonElement);

  await act(async () => {
    connectButton.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  await vi.waitFor(() => {
    assert.equal(fetch.mock.calls.length, 2);
    assert.equal(
      rendered.assign.mock.calls[0]?.[0],
      "https://oura.example.test/oauth/start",
    );
  });
  assert.doesNotMatch(rendered.container.textContent ?? "", /We use Junction/u);
  assert.equal(fetch.mock.calls[1]?.[0], "/api/connect-sources/oura/start");
  assert.deepEqual(fetch.mock.calls[1]?.[1], {
    body: JSON.stringify({ connectTarget: "oura" }),
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

test("ConnectSourcesGrid finishes Fitbit migration with a targeted legacy disconnect", async () => {
  const fetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return Response.json({
        sourceProviderSlug: "fitbit",
        status: "disconnected",
      });
    },
  );
  vi.stubGlobal("fetch", fetch);

  const { ConnectSourcesGrid } = await import(
    "../app/(dashboard)/connect/connect-page-client"
  );
  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [{
        description:
          "Fitbit and Pixel Watch sleep, activity, heart rate, exercise, and workout trends through Google authorization.",
        disconnectConnectionId: "dsc_junction_fitbit",
        disconnectSourceProviderSlug: "fitbit",
        id: "fitbit",
        logo: {
          className: "size-11 object-contain",
          height: 44,
          src: "/brand-logos/connect/fitbit.svg",
          width: 44,
        },
        migrationState: "cutover_ready",
        name: "Fitbit",
      }],
    }),
  );

  const finishButton = rendered.container.querySelector(
    "button[aria-label='Finish Fitbit migration']",
  );
  assert.ok(finishButton instanceof rendered.window.HTMLButtonElement);

  await act(async () => {
    finishButton.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  assert.match(rendered.container.textContent ?? "", /Confirm Fitbit migration\?/u);
  assert.match(
    rendered.container.textContent ?? "",
    /cannot prove historical completeness automatically/u,
  );
  assert.match(
    rendered.container.textContent ?? "",
    /last few days of sleep, activity, heart rate, exercise, and workouts/u,
  );
  const finishMigrationButtons = [...rendered.container.querySelectorAll("button")]
    .filter((button) => button.textContent === "Finish migration");
  const confirmButton = finishMigrationButtons[finishMigrationButtons.length - 1];
  assert.ok(confirmButton instanceof rendered.window.HTMLButtonElement);

  await act(async () => {
    confirmButton.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  await vi.waitFor(() => {
    assert.match(
      rendered.container.textContent ?? "",
      /Fitbit migration complete/u,
    );
    assert.match(
      rendered.container.textContent ?? "",
      /Fitbit now uses Google Health\. Your history is still saved\./u,
    );
  });
  assert.equal(
    fetch.mock.calls[0]?.[0],
    "/api/settings/device-sync/connections/dsc_junction_fitbit/sources/fitbit/disconnect",
  );
  assert.match(rendered.container.textContent ?? "", /Fitbit connected/u);
  assert.ok(
    rendered.container.querySelector("button[aria-label='Disconnect Fitbit']"),
  );
  assert.doesNotMatch(
    rendered.container.textContent ?? "",
    /has not imported overlapping history/u,
  );

  await rendered.cleanup();
});

test("ConnectSourcesGrid preserves the staged Fitbit migration when cutover is cancelled", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);

  const { ConnectSourcesGrid } = await import(
    "../app/(dashboard)/connect/connect-page-client"
  );
  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [{
        description: "Fitbit data through Google authorization.",
        disconnectConnectionId: "dsc_junction_fitbit",
        disconnectSourceProviderSlug: "fitbit",
        id: "fitbit",
        logo: {
          className: "size-11 object-contain",
          height: 44,
          src: "/brand-logos/connect/fitbit.svg",
          width: 44,
        },
        migrationState: "cutover_ready",
        name: "Fitbit",
      }],
    }),
  );

  const finishButton = rendered.container.querySelector(
    "button[aria-label='Finish Fitbit migration']",
  );
  assert.ok(finishButton instanceof rendered.window.HTMLButtonElement);
  await act(async () => {
    finishButton.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  const cancelButton = [...rendered.container.querySelectorAll("button")]
    .find((button) => button.textContent === "Cancel");
  assert.ok(cancelButton instanceof rendered.window.HTMLButtonElement);
  await act(async () => {
    cancelButton.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  assert.equal(fetch.mock.calls.length, 0);
  assert.ok(
    rendered.container.querySelector("button[aria-label='Finish Fitbit migration']"),
  );
  assert.match(
    rendered.container.textContent ?? "",
    /has not imported overlapping history/u,
  );
  assert.doesNotMatch(rendered.container.textContent ?? "", /Fitbit connected/u);

  await rendered.cleanup();
});

test("ConnectSourcesGrid preserves the legacy Fitbit migration when cutover fails", async () => {
  const fetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return Response.json({
        error: {
          code: "DEVICE_SYNC_SOURCE_DISCONNECT_FAILED",
          message: "The legacy Fitbit connection could not be stopped.",
        },
      }, {
        status: 502,
      });
    },
  );
  vi.stubGlobal("fetch", fetch);

  const { ConnectSourcesGrid } = await import(
    "../app/(dashboard)/connect/connect-page-client"
  );
  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [{
        description: "Fitbit data through Google authorization.",
        disconnectConnectionId: "dsc_junction_fitbit",
        disconnectSourceProviderSlug: "fitbit",
        id: "fitbit",
        logo: {
          className: "size-11 object-contain",
          height: 44,
          src: "/brand-logos/connect/fitbit.svg",
          width: 44,
        },
        migrationState: "cutover_ready",
        name: "Fitbit",
      }],
    }),
  );

  const finishButton = rendered.container.querySelector(
    "button[aria-label='Finish Fitbit migration']",
  );
  assert.ok(finishButton instanceof rendered.window.HTMLButtonElement);
  await act(async () => {
    finishButton.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  const finishMigrationButtons = [...rendered.container.querySelectorAll("button")]
    .filter((button) => button.textContent === "Finish migration");
  const confirmButton = finishMigrationButtons[finishMigrationButtons.length - 1];
  assert.ok(confirmButton instanceof rendered.window.HTMLButtonElement);
  await act(async () => {
    confirmButton.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  await vi.waitFor(() => {
    assert.match(
      rendered.container.textContent ?? "",
      /legacy Fitbit connection could not be stopped/u,
    );
  });
  assert.equal(
    fetch.mock.calls[0]?.[0],
    "/api/settings/device-sync/connections/dsc_junction_fitbit/sources/fitbit/disconnect",
  );
  assert.match(
    rendered.container.textContent ?? "",
    /cannot prove historical completeness automatically/u,
  );
  assert.doesNotMatch(rendered.container.textContent ?? "", /Fitbit connected/u);

  await rendered.cleanup();
});

test("ConnectSourcesGrid hides a connection-disabled source after its local disconnect", async () => {
  const fetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return Response.json({});
    },
  );
  vi.stubGlobal("fetch", fetch);

  const { ConnectSourcesGrid } = await import(
    "../app/(dashboard)/connect/connect-page-client"
  );
  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [
        {
          connectionAvailable: false,
          connected: true,
          description:
            "Rides, runs, workouts, route context, power, and training load.",
          disconnectConnectionId: "dsc_strava_123",
          id: "strava",
          logo: {
            className: "h-auto max-h-9 w-auto max-w-[8rem] object-contain",
            height: 20,
            src: "/brand-logos/connect/strava.svg",
            width: 96,
          },
          name: "Strava",
        },
      ],
    }),
  );

  assert.match(rendered.container.textContent ?? "", /1 of 1 sources/u);
  const disconnectButton = rendered.container.querySelector(
    "button[aria-label='Disconnect Strava']",
  );
  assert.ok(disconnectButton instanceof rendered.window.HTMLButtonElement);

  await act(async () => {
    disconnectButton.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  const confirmButton = [...rendered.container.querySelectorAll("button")]
    .filter((button) => button.textContent === "Disconnect")
    .at(-1);
  assert.ok(confirmButton instanceof rendered.window.HTMLButtonElement);

  await act(async () => {
    confirmButton.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  await vi.waitFor(() => {
    assert.match(
      rendered.container.textContent ?? "",
      /Disconnected Strava\. Your history is still saved\./u,
    );
    assert.match(rendered.container.textContent ?? "", /0 of 0 sources/u);
  });

  assert.equal(
    [...rendered.container.querySelectorAll("h2")].some(
      (heading) => heading.textContent === "Strava",
    ),
    false,
  );
  assert.equal(
    rendered.container.querySelector("button[aria-label='Disconnect Strava']"),
    null,
  );
  assert.doesNotMatch(rendered.container.textContent ?? "", /Not available/u);

  await rendered.cleanup();
});

test("ConnectSourcesGrid keeps Apple Health mobile guidance after local disconnect", async () => {
  const fetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return Response.json({});
    },
  );
  vi.stubGlobal("fetch", fetch);

  const { ConnectSourcesGrid } = await import(
    "../app/(dashboard)/connect/connect-page-client"
  );
  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [
        {
          connected: true,
          description:
            "iPhone and Apple Watch activity, sleep, vitals, and workouts.",
          disconnectConnectionId: "dsc_apple_health_123",
          id: "apple-health",
          logo: {
            className: "h-9 w-auto object-contain",
            height: 48,
            src: "/brand-logos/connect/apple-health.png",
            width: 48,
          },
          name: "Apple Health",
          unavailableActionLabel: "Download app",
          unavailableActionUrl:
            "https://apps.apple.com/us/app/murph-ai/id6786145859",
          unavailableMessage:
            "Download Murph on your iPhone, then connect Apple Health in the app.",
        },
      ],
    }),
  );

  const disconnectButton = rendered.container.querySelector(
    "button[aria-label='Disconnect Apple Health']",
  );
  assert.ok(disconnectButton instanceof rendered.window.HTMLButtonElement);

  await act(async () => {
    disconnectButton.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  const confirmButton = [...rendered.container.querySelectorAll("button")]
    .filter((button) => button.textContent === "Disconnect")
    .at(-1);
  assert.ok(confirmButton instanceof rendered.window.HTMLButtonElement);

  await act(async () => {
    confirmButton.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  await vi.waitFor(() => {
    assert.match(
      rendered.container.textContent ?? "",
      /Disconnected Apple Health\. Your history is still saved\./,
    );
  });

  assert.equal(
    fetch.mock.calls[0]?.[0],
    "/api/settings/device-sync/connections/dsc_apple_health_123/disconnect",
  );
  assert.match(
    rendered.container.textContent ?? "",
    /Apple Health not connected/,
  );
  assert.match(
    rendered.container.textContent ?? "",
    /Download Murph on your iPhone, then connect Apple Health in the app\./,
  );
  const appDownloadLink = rendered.container.querySelector(
    "a[aria-label='Download app for Apple Health']",
  );
  assert.equal(appDownloadLink?.textContent, "Download app");
  assert.equal(
    appDownloadLink?.getAttribute("href"),
    "https://apps.apple.com/us/app/murph-ai/id6786145859",
  );
  assert.doesNotMatch(rendered.container.textContent ?? "", /Not available/u);

  await rendered.cleanup();
});

test("ConnectSourcesGrid uses account-scoped disconnect copy without naming Junction", async () => {
  const fetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return Response.json({});
    },
  );
  vi.stubGlobal("fetch", fetch);

  const { ConnectSourcesGrid } = await import(
    "../app/(dashboard)/connect/connect-page-client"
  );
  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [
        {
          connected: true,
          description: "Recovery, strain, sleep, and heart rate.",
          disconnectConnectionId: "dsc_junction_multi",
          disconnectScope: "junction_account",
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
  );

  const disconnectButton = rendered.container.querySelector(
    "button[aria-label='Disconnect account']",
  );
  assert.ok(disconnectButton instanceof rendered.window.HTMLButtonElement);
  assert.equal(disconnectButton.textContent, "Disconnect");
  assert.doesNotMatch(
    rendered.container.textContent ?? "",
    /Junction account/u,
  );

  await act(async () => {
    disconnectButton.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  assert.match(rendered.container.textContent ?? "", /Disconnect account\?/);
  assert.match(
    rendered.container.textContent ?? "",
    /Murph will stop syncing new data from every source in this connection\. Your history is kept\./,
  );

  const confirmButton = [...rendered.container.querySelectorAll("button")]
    .filter((button) => button.textContent === "Disconnect")
    .at(-1);
  assert.ok(confirmButton instanceof rendered.window.HTMLButtonElement);

  await act(async () => {
    confirmButton.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  await vi.waitFor(() => {
    assert.match(
      rendered.container.textContent ?? "",
      /Disconnected this connection\. Your history is still saved\./,
    );
  });
  assert.equal(
    fetch.mock.calls[0]?.[0],
    "/api/settings/device-sync/connections/dsc_junction_multi/disconnect",
  );

  await rendered.cleanup();
});

test("ConnectSourcesGrid walks connection-reset sources through account disconnect then connect", async () => {
  const fetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return Response.json({});
    },
  );
  vi.stubGlobal("fetch", fetch);

  const { ConnectSourcesGrid } = await import(
    "../app/(dashboard)/connect/connect-page-client"
  );
  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [
        {
          connectTarget: "garmin",
          description: "Workouts, sleep, stress, heart rate, and body battery.",
          disconnectConnectionId: "dsc_junction_garmin",
          disconnectScope: "junction_account",
          id: "garmin",
          logo: {
            className: "size-11 object-contain",
            height: 44,
            src: "/brand-logos/connect/garmin.png",
            width: 44,
          },
          name: "Garmin",
          recoveryKind: "connection_reset",
        },
      ],
    }),
  );

  assert.match(
    rendered.container.textContent ?? "",
    /Garmin needs a fresh connection\. Disconnect it first, then connect it again\./,
  );
  assert.equal(
    rendered.container.querySelector("button[aria-label='Reconnect Garmin']"),
    null,
  );
  assert.equal(
    rendered.container.querySelector("button[aria-label='Connect Garmin']"),
    null,
  );

  const disconnectButton = rendered.container.querySelector(
    "button[aria-label='Disconnect account']",
  );
  assert.ok(disconnectButton instanceof rendered.window.HTMLButtonElement);

  await act(async () => {
    disconnectButton.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  assert.match(rendered.container.textContent ?? "", /Disconnect account\?/);
  assert.match(
    rendered.container.textContent ?? "",
    /Murph will stop syncing new data from every source in this connection\. Your history is kept\./,
  );

  const confirmButton = [...rendered.container.querySelectorAll("button")]
    .filter((button) => button.textContent === "Disconnect")
    .at(-1);
  assert.ok(confirmButton instanceof rendered.window.HTMLButtonElement);

  await act(async () => {
    confirmButton.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  await vi.waitFor(() => {
    assert.match(
      rendered.container.textContent ?? "",
      /Disconnected this connection\. Your history is still saved\./,
    );
  });
  assert.equal(
    fetch.mock.calls[0]?.[0],
    "/api/settings/device-sync/connections/dsc_junction_garmin/disconnect",
  );

  const connectButton = rendered.container.querySelector(
    "button[aria-label='Connect Garmin']",
  );
  assert.ok(connectButton instanceof rendered.window.HTMLButtonElement);
  assert.equal(connectButton.textContent, "Connect");
  assert.doesNotMatch(
    rendered.container.textContent ?? "",
    /needs a fresh connection/u,
  );

  await rendered.cleanup();
});

test("ConnectSourcesGrid explains an unfinished historical reset when disconnect returns a warning", async () => {
  const fetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return Response.json({
        warning: {
          code: "HISTORICAL_RESET_REVOKE_FAILED",
          historicalResetIncomplete: true,
          message:
            "Provider revoke did not complete while a historical data reset is pending. " +
            "Remove the connection in the provider account before reconnecting.",
        },
      });
    },
  );
  vi.stubGlobal("fetch", fetch);

  const { ConnectSourcesGrid } = await import(
    "../app/(dashboard)/connect/connect-page-client"
  );
  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [
        {
          connectTarget: "garmin",
          description: "Workouts, sleep, stress, heart rate, and body battery.",
          disconnectConnectionId: "dsc_junction_garmin",
          disconnectScope: "junction_account",
          id: "garmin",
          logo: {
            className: "size-11 object-contain",
            height: 44,
            src: "/brand-logos/connect/garmin.png",
            width: 44,
          },
          name: "Garmin",
          recoveryKind: "connection_reset",
        },
      ],
    }),
  );

  const disconnectButton = rendered.container.querySelector(
    "button[aria-label='Disconnect account']",
  );
  assert.ok(disconnectButton instanceof rendered.window.HTMLButtonElement);

  await act(async () => {
    disconnectButton.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  const confirmButton = [...rendered.container.querySelectorAll("button")]
    .filter((button) => button.textContent === "Disconnect")
    .at(-1);
  assert.ok(confirmButton instanceof rendered.window.HTMLButtonElement);

  await act(async () => {
    confirmButton.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  await vi.waitFor(() => {
    assert.match(
      rendered.container.textContent ?? "",
      /Disconnected this connection\. Your history is still saved\. The historical reset did not finish\. Remove the old connection in your wearable provider account before reconnecting here\./,
    );
  });
  assert.equal(
    fetch.mock.calls[0]?.[0],
    "/api/settings/device-sync/connections/dsc_junction_garmin/disconnect",
  );
  assert.doesNotMatch(
    rendered.container.textContent ?? "",
    /did not fully confirm/u,
  );

  const connectButton = rendered.container.querySelector(
    "button[aria-label='Connect Garmin']",
  );
  assert.ok(connectButton instanceof rendered.window.HTMLButtonElement);
  assert.equal(connectButton.textContent, "Connect");

  await rendered.cleanup();
});

test("ConnectSourcesGrid explains an unfinished historical reset when a healthy sibling card starts the disconnect", async () => {
  const fetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return Response.json({
        warning: {
          code: "HISTORICAL_RESET_REVOKE_FAILED",
          historicalResetIncomplete: true,
          message:
            "Provider revoke did not complete while a historical data reset is pending. " +
            "Remove the connection in the provider account before reconnecting.",
        },
      });
    },
  );
  vi.stubGlobal("fetch", fetch);

  const { ConnectSourcesGrid } = await import(
    "../app/(dashboard)/connect/connect-page-client"
  );
  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [
        {
          connectTarget: "garmin",
          description: "Workouts, sleep, stress, heart rate, and body battery.",
          disconnectConnectionId: "dsc_junction_multi",
          disconnectScope: "junction_account",
          id: "garmin",
          logo: {
            className: "size-11 object-contain",
            height: 44,
            src: "/brand-logos/connect/garmin.png",
            width: 44,
          },
          name: "Garmin",
          recoveryKind: "connection_reset",
        },
        {
          connectTarget: "whoop",
          connected: true,
          description: "Recovery, strain, sleep, and heart rate.",
          disconnectConnectionId: "dsc_junction_multi",
          disconnectScope: "junction_account",
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
  );

  // Start the shared-account disconnect from the healthy Whoop card, not the
  // Garmin card that carries the historical reset.
  const disconnectButton = [
    ...rendered.container.querySelectorAll(
      "button[aria-label='Disconnect account']",
    ),
  ].find((button) =>
    button.closest("div.relative")?.textContent?.includes("Whoop"),
  );
  assert.ok(disconnectButton instanceof rendered.window.HTMLButtonElement);

  await act(async () => {
    disconnectButton.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  const confirmButton = [...rendered.container.querySelectorAll("button")]
    .filter((button) => button.textContent === "Disconnect")
    .at(-1);
  assert.ok(confirmButton instanceof rendered.window.HTMLButtonElement);

  await act(async () => {
    confirmButton.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  await vi.waitFor(() => {
    assert.match(
      rendered.container.textContent ?? "",
      /Disconnected this connection\. Your history is still saved\. The historical reset did not finish\. Remove the old connection in your wearable provider account before reconnecting here\./,
    );
  });
  assert.equal(
    fetch.mock.calls[0]?.[0],
    "/api/settings/device-sync/connections/dsc_junction_multi/disconnect",
  );
  assert.doesNotMatch(
    rendered.container.textContent ?? "",
    /did not fully confirm/u,
  );

  await rendered.cleanup();
});

test("ConnectSourcesGrid keeps ordinary disconnect warnings generic", async () => {
  const fetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return Response.json({
        warning: {
          code: "PROVIDER_REVOKE_FAILED",
          message: "Provider revoke request failed during disconnect.",
        },
      });
    },
  );
  vi.stubGlobal("fetch", fetch);

  const { ConnectSourcesGrid } = await import(
    "../app/(dashboard)/connect/connect-page-client"
  );
  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
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
    }),
  );

  const disconnectButton = rendered.container.querySelector(
    "button[aria-label='Disconnect Whoop']",
  );
  assert.ok(disconnectButton instanceof rendered.window.HTMLButtonElement);

  await act(async () => {
    disconnectButton.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  const confirmButton = [...rendered.container.querySelectorAll("button")]
    .filter((button) => button.textContent === "Disconnect")
    .at(-1);
  assert.ok(confirmButton instanceof rendered.window.HTMLButtonElement);

  await act(async () => {
    confirmButton.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  await vi.waitFor(() => {
    assert.match(
      rendered.container.textContent ?? "",
      /Disconnected Whoop\. Your history is still saved\. The provider did not fully confirm, so check that account if you want access removed there too\./,
    );
  });
  assert.equal(
    fetch.mock.calls[0]?.[0],
    "/api/settings/device-sync/connections/dsc_whoop_123/disconnect",
  );
  assert.doesNotMatch(
    rendered.container.textContent ?? "",
    /historical reset/iu,
  );

  await rendered.cleanup();
});

test("ConnectSourcesGrid shows reconnect guidance without a disconnect action", async () => {
  const fetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return Response.json({
        authorizationUrl: "https://provider.example.test/oauth/start",
      });
    },
  );
  vi.stubGlobal("fetch", fetch);

  const { ConnectSourcesGrid } = await import(
    "../app/(dashboard)/connect/connect-page-client"
  );
  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
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
    }),
  );

  assert.match(
    rendered.container.textContent ?? "",
    /Please reconnect Whoop to resume syncing\./,
  );
  assert.equal(
    rendered.container.querySelector("button[aria-label='Disconnect Whoop']"),
    null,
  );
  const reconnectButton = rendered.container.querySelector(
    "button[aria-label='Reconnect Whoop']",
  );
  assert.ok(reconnectButton instanceof rendered.window.HTMLButtonElement);
  assert.equal(reconnectButton.textContent, "Reconnect");

  await act(async () => {
    reconnectButton.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  await vi.waitFor(() => {
    assert.equal(fetch.mock.calls.length, 1);
    assert.equal(
      rendered.assign.mock.calls[0]?.[0],
      "https://provider.example.test/oauth/start",
    );
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
  const fetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return Response.json(
        {
          error: {
            code: "DEVICE_SYNC_DISCONNECT_FAILED",
            message: "We could not disconnect Whoop right now.",
          },
        },
        { status: 502 },
      );
    },
  );
  vi.stubGlobal("fetch", fetch);

  const { ConnectSourcesGrid } = await import(
    "../app/(dashboard)/connect/connect-page-client"
  );
  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
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
    }),
  );

  const disconnectButton = rendered.container.querySelector(
    "button[aria-label='Disconnect Whoop']",
  );
  assert.ok(disconnectButton instanceof rendered.window.HTMLButtonElement);

  await act(async () => {
    disconnectButton.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  const confirmButton = [...rendered.container.querySelectorAll("button")]
    .filter((button) => button.textContent === "Disconnect")
    .at(-1);
  assert.ok(confirmButton instanceof rendered.window.HTMLButtonElement);

  await act(async () => {
    confirmButton.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  await vi.waitFor(() => {
    const alert = rendered.container.querySelector("[role='alert']");
    assert.ok(alert);
    assert.equal(alert.textContent, "We could not disconnect Whoop right now.");
  });
  assert.match(rendered.container.textContent ?? "", /Disconnect Whoop\?/);
  assert.match(rendered.container.textContent ?? "", /Whoop connected/);
  assert.equal(
    rendered.container.querySelector("button[aria-label='Connect Whoop']"),
    null,
  );

  await rendered.cleanup();
});

test("ConnectSourcesGrid rejects malformed connect responses before redirecting", async () => {
  const fetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return Response.json({
        authorizationUrl: 42,
      });
    },
  );
  vi.stubGlobal("fetch", fetch);
  const { ConnectSourcesGrid } = await import(
    "../app/(dashboard)/connect/connect-page-client"
  );
  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [
        {
          connectTarget: "oura",
          description:
            "Sleep, readiness, activity, temperature, and heart rate.",
          id: "oura",
          logo: {
            className: "size-11 object-contain",
            height: 44,
            src: "/brand-logos/connect/oura.png",
            width: 44,
          },
          name: "Oura",
        },
      ],
    }),
  );

  await act(async () => {
    rendered.button.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  assert.equal(rendered.assign.mock.calls.length, 0);
  assert.match(
    rendered.container.textContent ?? "",
    /Connection could not be started\./,
  );

  await rendered.cleanup();
});

test("ConnectSourcesGrid rejects unsafe connect response URLs before redirecting", async () => {
  const fetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return Response.json({
        authorizationUrl: "javascript:alert(1)",
      });
    },
  );
  vi.stubGlobal("fetch", fetch);
  const { ConnectSourcesGrid } = await import(
    "../app/(dashboard)/connect/connect-page-client"
  );
  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [
        {
          connectTarget: "oura",
          description:
            "Sleep, readiness, activity, temperature, and heart rate.",
          id: "oura",
          logo: {
            className: "size-11 object-contain",
            height: 44,
            src: "/brand-logos/connect/oura.png",
            width: 44,
          },
          name: "Oura",
        },
      ],
    }),
  );

  await act(async () => {
    rendered.button.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  assert.equal(rendered.assign.mock.calls.length, 0);
  assert.match(
    rendered.container.textContent ?? "",
    /Connection could not be started\./,
  );

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

  const { default: ConnectPage } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const markup = renderToStaticMarkup(
    await ConnectPage({
      searchParams: Promise.resolve({
        connectSource: "oura",
        deviceSyncProvider: "junction",
        deviceSyncStatus: "connected",
      }),
    }),
  );

  assert.match(markup, /Connected Oura\./);
  assert.match(markup, /data-connection-state="connected"/u);
  assert.ok(
    sourceHeadingIndex(markup, "Oura") < sourceHeadingIndex(markup, "Whoop"),
  );
  assert.doesNotMatch(markup, /aria-label="Connect Oura"/u);
});

test("ConnectPage maps a Google Health callback back to the Fitbit migration card", async () => {
  vi.stubEnv("JUNCTION_API_KEY", "sk_us_junction-test");
  vi.stubEnv(
    "JUNCTION_CLIENT_USER_ID_SECRET",
    "junction-client-user-id-secret",
  );
  vi.stubEnv("JUNCTION_ENV", "sandbox");
  vi.stubEnv("JUNCTION_PROVIDER_FILTER", "google_health");
  vi.stubEnv("JUNCTION_REGION", "us");
  mocks.buildHostedDeviceSyncSettingsResponse.mockResolvedValueOnce({
    generatedAt: "2026-08-11T12:00:00.000Z",
    ok: true,
    sources: [{
      connectionId: "dsc_junction_fitbit",
      provider: "junction",
      state: "active",
      upstreamSources: [
        {
          connectProvider: "junction",
          connectSourceId: "fitbit",
          connectTarget: "fitbit",
          providerLabel: "Fitbit",
          resourceCount: 4,
          sourceProviderSlug: "fitbit",
          status: "connected",
        },
        {
          firstSeenAt: "2026-08-11T11:55:00.000Z",
          lastDataAt: null,
          lastSeenAt: "2026-08-11T11:55:00.000Z",
          providerLabel: "Fitbit",
          resourceCount: 3,
          sourceProviderSlug: "google_health",
          status: "connected",
        },
      ],
    }],
  });

  const { default: ConnectPage } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const markup = renderToStaticMarkup(
    await ConnectPage({
      searchParams: Promise.resolve({
        connectSource: "fitbit",
        connectTarget: "fitbit",
        deviceSyncProvider: "junction",
        deviceSyncStatus: "connected",
      }),
    }),
  );

  assert.match(markup, /Google Health authorized/u);
  assert.match(
    markup,
    /Murph is verifying Fitbit history before you finish the migration/u,
  );
  assert.match(markup, /Google Health is authorized/u);
  assert.equal(markup.match(/<h2[^>]*>Fitbit<\/h2>/gu)?.length, 1);
});

test("ConnectPage leaves legacy Fitbit migration available after failed Google authorization", async () => {
  vi.stubEnv("JUNCTION_API_KEY", "sk_us_junction-test");
  vi.stubEnv(
    "JUNCTION_CLIENT_USER_ID_SECRET",
    "junction-client-user-id-secret",
  );
  vi.stubEnv("JUNCTION_ENV", "sandbox");
  vi.stubEnv("JUNCTION_PROVIDER_FILTER", "google_health");
  vi.stubEnv("JUNCTION_REGION", "us");
  mocks.buildHostedDeviceSyncSettingsResponse.mockResolvedValueOnce({
    generatedAt: "2026-08-11T12:00:00.000Z",
    ok: true,
    sources: [{
      connectionId: "dsc_junction_fitbit",
      provider: "junction",
      state: "active",
      upstreamSources: [{
        connectProvider: "junction",
        connectSourceId: "fitbit",
        connectTarget: "fitbit",
        firstSeenAt: "2026-07-01T00:00:00.000Z",
        lastDataAt: "2026-08-10T00:00:00.000Z",
        lastSeenAt: "2026-08-10T00:00:00.000Z",
        providerLabel: "Fitbit",
        resourceCount: 4,
        sourceProviderSlug: "fitbit",
        status: "connected",
      }],
    }],
  });

  const { default: ConnectPage } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const markup = renderToStaticMarkup(
    await ConnectPage({
      searchParams: Promise.resolve({
        connectSource: "fitbit",
        connectTarget: "fitbit",
        deviceSyncError: "OAUTH_DENIED",
        deviceSyncProvider: "junction",
        deviceSyncStatus: "error",
      }),
    }),
  );

  assert.match(markup, /Unable to finish connection/u);
  assert.match(markup, /Murph will not change the legacy Fitbit connection/u);
  assert.match(markup, /aria-label="Authorize Google for Fitbit"/u);
  assert.doesNotMatch(markup, /Finish Fitbit migration/u);
});

test("ConnectPage suppresses unverified connected callbacks from query params", async () => {
  const { default: ConnectPage } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const markup = renderToStaticMarkup(
    await ConnectPage({
      searchParams: Promise.resolve({
        connectSource: "oura",
        deviceSyncProvider: "junction",
        deviceSyncStatus: "connected",
      }),
    }),
  );

  assert.doesNotMatch(markup, /Connected Oura\./);
  assert.match(markup, /Oura not connected/);
});

test("ConnectPage ignores connected callback status when callback source metadata is missing", async () => {
  const { default: ConnectPage } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const markup = renderToStaticMarkup(
    await ConnectPage({
      searchParams: Promise.resolve({
        deviceSyncProvider: "junction",
        deviceSyncStatus: "connected",
      }),
    }),
  );

  assert.doesNotMatch(markup, /Connected your wearable source\./);
  assert.doesNotMatch(markup, /Junction/u);
});

test("ConnectPage shows callback errors with the original source label", async () => {
  const { default: ConnectPage } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const markup = renderToStaticMarkup(
    await ConnectPage({
      searchParams: Promise.resolve({
        connectSource: "oura",
        deviceSyncError: "OAUTH_STATE_INVALID",
        deviceSyncProvider: "junction",
        deviceSyncStatus: "error",
      }),
    }),
  );

  assert.match(markup, /Unable to finish connection/);
  assert.match(
    markup,
    /Oura gave us an expired or invalid return from the last attempt\./,
  );
});

test("ConnectPage shows rejected callback errors with the original source label", async () => {
  const { default: ConnectPage } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const markup = renderToStaticMarkup(
    await ConnectPage({
      searchParams: Promise.resolve({
        connectSource: "whoop",
        deviceSyncError: "OAUTH_CALLBACK_REJECTED",
        deviceSyncProvider: "whoop",
        deviceSyncStatus: "error",
      }),
    }),
  );

  assert.match(markup, /Unable to finish connection/);
  assert.match(markup, /Whoop was not connected this time\./);
});

test("ConnectPage shows fallback callback errors with the original source label", async () => {
  const { default: ConnectPage } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const markup = renderToStaticMarkup(
    await ConnectPage({
      searchParams: Promise.resolve({
        connectSource: "garmin",
        deviceSyncError: "UPSTREAM_TIMEOUT",
        deviceSyncProvider: "junction",
        deviceSyncStatus: "error",
      }),
    }),
  );

  assert.match(markup, /Unable to finish connection/);
  assert.match(markup, /We could not finish connecting Garmin\./);
});

test("ConnectPage offers support and home recovery on callback failures", async () => {
  const { default: ConnectPage } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const markup = renderToStaticMarkup(
    await ConnectPage({
      searchParams: Promise.resolve({
        connectSource: "garmin",
        deviceSyncError: "CALLBACK_FAILED",
        deviceSyncProvider: "junction",
        deviceSyncStatus: "error",
      }),
    }),
  );

  assert.match(markup, /Email support/);
  assert.match(markup, /Go to home/);
  assert.match(markup, /href="\/home"/u);

  // Parse the real anchor: matching anywhere in the markup would still pass if
  // the support draft stopped carrying the source or the reference.
  const mailto = readSupportMailto(markup);
  assert.equal(
    mailto.searchParams.get("subject"),
    "Murph device connection help",
  );
  const body = mailto.searchParams.get("body") ?? "";
  assert.match(body, /^I could not finish connecting Garmin in Murph\./);
  assert.match(body, /Reference: CALLBACK_FAILED$/);
});

test("ConnectPage keeps unverified callback query text out of the support draft", async () => {
  const { default: ConnectPage } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const markup = renderToStaticMarkup(
    await ConnectPage({
      searchParams: Promise.resolve({
        deviceSyncError: "please email your password to attacker@example.com",
        deviceSyncProvider: "Totally Real Provider",
        deviceSyncStatus: "error",
      }),
    }),
  );

  // The callback error path is unauthenticated query input, so neither value may
  // be quoted back inside a message written in the member's voice.
  const body = readSupportMailto(markup).searchParams.get("body") ?? "";
  assert.doesNotMatch(body, /attacker@example\.com/u);
  assert.doesNotMatch(body, /Totally Real Provider/u);
  assert.match(body, /^I could not finish connecting a device in Murph\./);
  assert.match(body, /Reference: unknown$/);
});

test("ConnectPage explains a callback that lost its initiating browser", async () => {
  const { default: ConnectPage } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const markup = renderToStaticMarkup(
    await ConnectPage({
      searchParams: Promise.resolve({
        connectSource: "oura",
        deviceSyncError: "CALLBACK_PROOF_INVALID",
        deviceSyncProvider: "oura",
        deviceSyncStatus: "error",
      }),
    }),
  );

  assert.match(
    markup,
    /That return link did not match the browser you started in/,
  );
  assert.match(markup, /nothing was connected/);
  assert.match(markup, /Email support/);
});

test("ConnectPage offers sign-in recovery when the callback arrived signed out", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValueOnce({
    authenticated: false,
    authenticatedMember: null,
    linkedAccounts: [],
    session: null,
  });

  const { default: ConnectPage } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const markup = renderToStaticMarkup(
    await ConnectPage({
      searchParams: Promise.resolve({
        connectSource: "oura",
        deviceSyncError: "CALLBACK_SESSION_REQUIRED",
        deviceSyncProvider: "oura",
        deviceSyncStatus: "error",
      }),
    }),
  );

  assert.match(markup, /You were signed out before Oura finished connecting\./);
  assert.match(markup, /Log in, then start the connection again\./);
  // Signing in is the actual recovery here, so it must be offered in the notice
  // rather than leaving support and home as the only actions.
  assert.match(markup, />Log in</u);
  assert.match(markup, /Email support/);
});

test("ConnectPage omits sign-in recovery when the member is already signed in", async () => {
  const { default: ConnectPage } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const markup = renderToStaticMarkup(
    await ConnectPage({
      searchParams: Promise.resolve({
        connectSource: "oura",
        deviceSyncError: "CALLBACK_PROOF_INVALID",
        deviceSyncProvider: "oura",
        deviceSyncStatus: "error",
      }),
    }),
  );

  assert.doesNotMatch(markup, />Log in</u);
  assert.match(markup, /Email support/);
});

test("ConnectPage keeps successful callbacks free of failure recovery actions", async () => {
  const { default: ConnectPage } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const markup = renderToStaticMarkup(
    await ConnectPage({
      searchParams: Promise.resolve({
        connectSource: "oura",
        deviceSyncProvider: "oura",
        deviceSyncStatus: "connected",
      }),
    }),
  );

  assert.doesNotMatch(markup, /Email support/);
  assert.doesNotMatch(markup, /Go to home/);
});

test("resolveConfiguredConnectSources marks only Junction-backed actions", async () => {
  vi.stubEnv("WHOOP_CLIENT_ID", "whoop-client-id");
  vi.stubEnv("WHOOP_CLIENT_SECRET", "whoop-client-secret");
  vi.stubEnv("JUNCTION_API_KEY", "sk_us_junction-test");
  vi.stubEnv(
    "JUNCTION_CLIENT_USER_ID_SECRET",
    "junction-client-user-id-secret",
  );
  vi.stubEnv("JUNCTION_ENV", "sandbox");
  vi.stubEnv("JUNCTION_PROVIDER_FILTER", "fitbit");
  vi.stubEnv("JUNCTION_REGION", "us");

  const { resolveConfiguredConnectSources } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const logo = {
    className: "size-11 object-contain",
    height: 44,
    src: "/logo.png",
    width: 44,
  };
  const resolved = resolveConfiguredConnectSources([
    { id: "whoop", name: "Whoop", description: "Recovery.", logo },
    { id: "fitbit", name: "Fitbit", description: "Activity.", logo },
  ]);

  assert.deepEqual(
    Object.fromEntries(
      resolved.map((source) => [
        source.id,
        source.requiresJunctionDisclosure === true,
      ]),
    ),
    { fitbit: true, whoop: false },
  );
});

test("Junction disclosure follows reconnect and fresh providers across local disconnects", async () => {
  vi.stubEnv("OURA_CLIENT_ID", "oura-client-id");
  vi.stubEnv("OURA_CLIENT_SECRET", "oura-client-secret");
  vi.stubEnv("WHOOP_CLIENT_ID", "whoop-client-id");
  vi.stubEnv("WHOOP_CLIENT_SECRET", "whoop-client-secret");
  vi.stubEnv("JUNCTION_API_KEY", "sk_us_junction-test");
  vi.stubEnv(
    "JUNCTION_CLIENT_USER_ID_SECRET",
    "junction-client-user-id-secret",
  );
  vi.stubEnv("JUNCTION_ENV", "sandbox");
  vi.stubEnv("JUNCTION_PROVIDER_FILTER", "oura,whoop_v2");
  vi.stubEnv("JUNCTION_REGION", "us");

  const { resolveConfiguredConnectSources } = await import(
    "../app/(dashboard)/connect/connect-page-content"
  );
  const { requiresJunctionConnectionPreflight } = await import(
    "../app/(dashboard)/connect/connect-page-client"
  );
  const { markLocallyDisconnectedSources } = await import(
    "../app/(dashboard)/connect/connect-page-helpers"
  );
  const logo = {
    className: "size-11 object-contain",
    height: 44,
    src: "/logo.png",
    width: 44,
  };
  const resolved = resolveConfiguredConnectSources(
    [
      { id: "oura", name: "Oura", description: "Sleep.", logo },
      { id: "whoop", name: "Whoop", description: "Recovery.", logo },
    ],
    {
      reconnectProviderBySourceId: new Map([
        ["oura", "junction"],
        ["whoop", "whoop"],
      ]),
      reconnectSourceIds: new Set(["oura", "whoop"]),
      reconnectTargetBySourceId: new Map([
        ["oura", "oura"],
        ["whoop", "whoop"],
      ]),
    },
  );
  const oura = resolved.find((source) => source.id === "oura");
  const whoop = resolved.find((source) => source.id === "whoop");
  assert.ok(oura);
  assert.ok(whoop);

  assert.equal(oura.connectProvider, "junction");
  assert.equal(oura.requiresJunctionDisclosure, undefined);
  assert.equal(requiresJunctionConnectionPreflight(oura), true);
  assert.equal(whoop.connectProvider, "whoop");
  assert.equal(whoop.requiresJunctionDisclosure, true);
  assert.equal(requiresJunctionConnectionPreflight(whoop), false);

  const locallyDisconnected = markLocallyDisconnectedSources(
    resolved,
    new Set(),
    new Set(["oura", "whoop"]),
  );
  const disconnectedOura = locallyDisconnected.find(
    (source) => source.id === "oura",
  );
  const disconnectedWhoop = locallyDisconnected.find(
    (source) => source.id === "whoop",
  );
  assert.ok(disconnectedOura);
  assert.ok(disconnectedWhoop);
  assert.equal(requiresJunctionConnectionPreflight(disconnectedOura), false);
  assert.equal(requiresJunctionConnectionPreflight(disconnectedWhoop), true);
});

test("A successful Google Health callback advances the Fitbit migration to verification", async () => {
  const { markCallbackConnectedSource } = await import(
    "../app/(dashboard)/connect/connect-page-helpers"
  );
  const logo = {
    className: "size-11 object-contain",
    height: 44,
    src: "/logo.png",
    width: 44,
  };
  const [source] = markCallbackConnectedSource(
    [{
      connectTarget: "fitbit",
      description: "Fitbit data.",
      id: "fitbit",
      logo,
      migrationState: "authorization_required",
      name: "Fitbit",
    }],
    "fitbit",
  );

  assert.deepEqual(source, {
    connectTarget: "fitbit",
    connected: true,
    description: "Fitbit data.",
    id: "fitbit",
    logo,
    migrationState: "verifying_successor",
    name: "Fitbit",
  });
});

test("A successful Google Health callback uses migration-specific notice copy", async () => {
  const { createConnectCallbackNotice } = await import(
    "../app/(dashboard)/connect/connect-page-helpers"
  );
  const logo = {
    className: "size-11 object-contain",
    height: 44,
    src: "/logo.png",
    width: 44,
  };

  assert.deepEqual(
    createConnectCallbackNotice(
      {
        connectSource: "fitbit",
        connectTarget: "fitbit",
        errorCode: null,
        provider: "junction",
        status: "connected",
      },
      [{
        connectTarget: "fitbit",
        description: "Fitbit data.",
        id: "fitbit",
        logo,
        migrationState: "authorization_required",
        name: "Fitbit",
      }],
    ),
    {
      kind: "success",
      title: "Google Health authorized",
      message:
        "Murph is verifying Fitbit history before you finish the migration. The legacy Fitbit connection stays active for now.",
    },
  );
});

test("Finishing Fitbit migration keeps the successor card connected locally", async () => {
  const { markLocallyCompletedFitbitMigrations } = await import(
    "../app/(dashboard)/connect/connect-page-helpers"
  );
  const logo = {
    className: "size-11 object-contain",
    height: 44,
    src: "/logo.png",
    width: 44,
  };
  const [completed] = markLocallyCompletedFitbitMigrations(
    [{
      description: "Fitbit data.",
      disconnectConnectionId: "dsc_fitbit",
      disconnectSourceProviderSlug: "fitbit",
      id: "fitbit",
      logo,
      migrationState: "cutover_ready",
      name: "Fitbit",
    }],
    new Set(["fitbit"]),
  );

  assert.deepEqual(completed, {
    connected: true,
    description: "Fitbit data.",
    disconnectConnectionId: "dsc_fitbit",
    disconnectSourceProviderSlug: "google_health",
    id: "fitbit",
    logo,
    name: "Fitbit",
  });
});

test("ConnectSourcesGrid refreshes while Fitbit migration verification is pending", async () => {
  vi.useFakeTimers();

  try {
    const { ConnectSourcesGrid } = await import(
      "../app/(dashboard)/connect/connect-page-client"
    );
    const rendered = await renderClientComponent(
      createElement(ConnectSourcesGrid, {
        sources: [{
          description: "Fitbit data through Google authorization.",
          id: "fitbit",
          logo: {
            className: "size-11 object-contain",
            height: 44,
            src: "/brand-logos/connect/fitbit.svg",
            width: 44,
          },
          migrationState: "verifying_successor",
          name: "Fitbit",
        }],
      }),
      { requireButton: false },
    );

    assert.equal(mocks.routerRefresh.mock.calls.length, 0);

    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    assert.equal(mocks.routerRefresh.mock.calls.length, 1);

    await act(async () => {
      vi.advanceTimersByTime(15_000 * 11);
    });
    assert.equal(mocks.routerRefresh.mock.calls.length, 12);
    assert.match(
      rendered.container.textContent ?? "",
      /Fitbit migration is still verifying/u,
    );
    assert.match(
      rendered.container.textContent ?? "",
      /check back after your next Fitbit or Pixel Watch sync/u,
    );

    await rendered.cleanup();
  } finally {
    vi.useRealTimers();
  }
});

test("ConnectSourcesGrid explains Junction before a Junction-backed authorization", async () => {
  const fetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return Response.json({
        authorizationUrl: "https://junction.example.test/link/fitbit",
      });
    },
  );
  vi.stubGlobal("fetch", fetch);

  const { ConnectSourcesGrid } = await import(
    "../app/(dashboard)/connect/connect-page-client"
  );
  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [
        {
          connectTarget: "fitbit",
          description: "Fitbit and Pixel Watch sleep, activity, heart rate, exercise, and workout trends through Google authorization.",
          id: "fitbit",
          logo: {
            className: "size-11 object-contain",
            height: 44,
            src: "/brand-logos/connect/fitbit.svg",
            width: 44,
          },
          name: "Fitbit",
          requiresJunctionDisclosure: true,
        },
      ],
    }),
  );

  const connectButton = rendered.container.querySelector(
    "button[aria-label='Connect Fitbit']",
  );
  assert.ok(connectButton instanceof rendered.window.HTMLButtonElement);
  await act(async () => {
    connectButton.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  assert.equal(fetch.mock.calls.length, 0);
  assert.match(
    rendered.container.textContent ?? "",
    /Connect Fitbit to Murph/u,
  );
  assert.match(
    rendered.container.textContent ?? "",
    /Google will ask you to authorize Fitbit and Pixel Watch health data\./u,
  );
  assert.match(
    rendered.container.textContent ?? "",
    /We use Junction to connect this health source to Murph\./u,
  );
  assert.doesNotMatch(
    rendered.container.textContent ?? "",
    /Turn on Historical Data/u,
  );
  assert.equal(rendered.container.querySelector("audio"), null);

  const continueButton = [
    ...rendered.container.querySelectorAll("button"),
  ].find((button) => button.textContent === "Continue to Google");
  assert.ok(continueButton instanceof rendered.window.HTMLButtonElement);
  await act(async () => {
    continueButton.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  await vi.waitFor(() => {
    assert.equal(fetch.mock.calls.length, 1);
    assert.equal(
      rendered.assign.mock.calls[0]?.[0],
      "https://junction.example.test/link/fitbit",
    );
  });
  assert.equal(fetch.mock.calls[0]?.[0], "/api/connect-sources/fitbit/start");

  await rendered.cleanup();
});

test("ConnectSourcesGrid dismisses a Junction handoff without starting a connection", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);

  const { ConnectSourcesGrid } = await import(
    "../app/(dashboard)/connect/connect-page-client"
  );
  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [
        {
          connectTarget: "fitbit",
          description: "Fitbit and Pixel Watch sleep, activity, heart rate, exercise, and workout trends through Google authorization.",
          id: "fitbit",
          logo: {
            className: "size-11 object-contain",
            height: 44,
            src: "/brand-logos/connect/fitbit.svg",
            width: 44,
          },
          name: "Fitbit",
          requiresJunctionDisclosure: true,
        },
      ],
    }),
  );

  const connectButton = rendered.container.querySelector(
    "button[aria-label='Connect Fitbit']",
  );
  assert.ok(connectButton instanceof rendered.window.HTMLButtonElement);
  await act(async () => {
    connectButton.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  assert.match(
    rendered.container.textContent ?? "",
    /Connect Fitbit to Murph/u,
  );
  const closeButton = rendered.container.querySelector(
    'button[aria-label="Close"]',
  );
  assert.ok(closeButton instanceof rendered.window.HTMLButtonElement);
  await act(async () => {
    closeButton.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  assert.equal(fetch.mock.calls.length, 0);
  assert.equal(rendered.assign.mock.calls.length, 0);
  assert.doesNotMatch(
    rendered.container.textContent ?? "",
    /Connect Fitbit to Murph/u,
  );
  assert.ok(
    rendered.container.querySelector("button[aria-label='Connect Fitbit']"),
  );

  await rendered.cleanup();
});

test("ConnectSourcesGrid keeps a direct integration one-click", async () => {
  const fetch = vi.fn(async () =>
    Response.json({
      authorizationUrl: "https://whoop.example.test/oauth",
    }),
  );
  vi.stubGlobal("fetch", fetch);

  const { ConnectSourcesGrid } = await import(
    "../app/(dashboard)/connect/connect-page-client"
  );
  const rendered = await renderClientComponent(
    createElement(ConnectSourcesGrid, {
      sources: [
        {
          connectTarget: "whoop",
          description: "Recovery, strain, sleep, and heart rate.",
          id: "whoop",
          logo: {
            className: "size-11 object-contain",
            height: 44,
            src: "/brand-logos/connect/whoop.svg",
            width: 44,
          },
          name: "Whoop",
        },
      ],
    }),
  );

  const connectButton = rendered.container.querySelector(
    "button[aria-label='Connect Whoop']",
  );
  assert.ok(connectButton instanceof rendered.window.HTMLButtonElement);
  await act(async () => {
    connectButton.dispatchEvent(
      new rendered.window.Event("click", { bubbles: true }),
    );
  });

  await vi.waitFor(() => {
    assert.equal(fetch.mock.calls.length, 1);
    assert.equal(
      rendered.assign.mock.calls[0]?.[0],
      "https://whoop.example.test/oauth",
    );
  });
  assert.doesNotMatch(rendered.container.textContent ?? "", /We use Junction/u);

  await rendered.cleanup();
});

function readSupportMailto(markup: string): URL {
  const match = markup.match(/href="(mailto:[^"]+)"/u);
  assert.ok(match, "expected a support mailto anchor in the rendered markup");
  return new URL(match[1].replaceAll("&amp;", "&"));
}

function readWhoopSyncContactAction(page: ReactNode): unknown {
  return readConnectSourcesGridProp(page, "whoopSyncContactAction");
}

function readConnectSourcesGridProp(
  page: ReactNode,
  propName: string,
): unknown {
  assert.ok(isValidElement<{ children?: ReactNode }>(page));
  const connectSourcesGrid = Children.toArray(page.props.children).find(
    (child) => {
      if (!isValidElement(child)) {
        return false;
      }
      return propName in (child.props as Record<string, unknown>);
    },
  );

  assert.ok(isValidElement(connectSourcesGrid));
  return (connectSourcesGrid.props as Record<string, unknown>)[propName];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sourceHeadingIndex(markup: string, sourceName: string): number {
  const index = markup.indexOf(`>${sourceName}</h2>`);
  assert.notEqual(index, -1, `${sourceName} heading should exist`);
  return index;
}

function expectSettingResponseNotLoaded() {
  assert.equal(
    mocks.buildHostedDeviceSyncSettingsResponse.mock.calls.length,
    0,
  );
}
