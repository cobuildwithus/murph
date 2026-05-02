import type { Metadata } from "next";
import {
  DEVICE_CONNECT_SOURCES,
  listConfiguredDeviceSyncConnectTargets,
  normalizeDeviceSyncConnectTargetKey,
  readConfiguredDeviceSyncProviderConfigs,
  resolveJunctionConnectTargetForSourceId,
} from "@murphai/device-syncd/config";

import { PageHeader } from "@/src/components/ui/page-header";
import { buildHostedDeviceSyncSettingsResponse } from "@/src/lib/device-sync/settings-service";
import type { HostedDeviceSyncSettingsSource } from "@/src/lib/device-sync/settings-surface";
import { isHostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

import { ConnectSourcesGrid, type ConnectCallbackInput } from "./connect-page-client";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Connect Devices — Murph",
  description: "Connect your wearables and health data sources.",
});

type LogoAsset = {
  className: string;
  height: number;
  src: string;
  width: number;
};

type ConnectSource = {
  connectTarget?: string;
  connected?: boolean;
  description: string;
  id: string;
  logo: LogoAsset;
  name: string;
};

type ConnectPageInitialLoadError = {
  message: string;
};

type ConnectPageSearchParams = Record<string, string | string[] | undefined>;

type ConnectSourceUi = Omit<ConnectSource, "id">;

const CONNECT_SOURCE_UI = {
  whoop: {
    description: "Recovery, strain, sleep, and heart rate.",
    logo: logoAsset("whoop.svg", "h-auto max-h-7 w-auto max-w-[8rem] object-contain", 96, 15),
    name: "Whoop",
  },
  mapmyfitness: {
    description: "Workouts, routes, pace, and distance.",
    logo: logoAsset("mapmyfitness.png"),
    name: "MapMyFitness",
  },
  ultrahuman: {
    description: "Smart ring. Sleep, recovery, temperature, and movement.",
    logo: logoAsset("ultrahuman.png"),
    name: "Ultrahuman",
  },
  "dexcom-g6-and-older": {
    description: "Continuous glucose and sensor trends.",
    logo: logoAsset("dexcom-g6-and-older.png"),
    name: "Dexcom (G6 and older)",
  },
  renpho: {
    description: "Smart scale. Weight and body composition.",
    logo: logoAsset("renpho.svg", "h-auto max-h-7 w-auto max-w-[8rem] object-contain", 110, 22),
    name: "Renpho",
  },
  runkeeper: {
    description: "Runs, walks, routes, and pace.",
    logo: logoAsset("runkeeper.svg", "h-auto max-h-7 w-auto max-w-[8rem] object-contain", 132, 20),
    name: "Runkeeper",
  },
  "samsung-health": {
    description: "Phone and watch activity, sleep, and heart rate.",
    logo: logoAsset("samsung-health.png"),
    name: "Samsung Health",
  },
  "tandem-source": {
    description: "Insulin pump and CGM therapy records.",
    logo: logoAsset("tandem-source.svg", "h-auto max-h-7 w-auto max-w-[8rem] object-contain", 120, 25),
    name: "Tandem Source",
  },
  beurer: {
    description: "Blood pressure, weight, glucose, and pulse ox.",
    logo: logoAsset("beurer.png"),
    name: "Beurer",
  },
  strava: {
    description: "Rides, runs, power, and training load.",
    logo: logoAsset("strava.svg", "h-auto max-h-9 w-auto max-w-[8rem] object-contain", 96, 20),
    name: "Strava",
  },
  "freestyle-libre-ble": {
    description: "Real-time glucose via Bluetooth sensor.",
    logo: logoAsset("freestyle-libre-ble.png"),
    name: "Freestyle Libre BLE",
  },
  omron: {
    description: "Blood pressure, pulse, and weight.",
    logo: logoAsset("omron.png", "h-auto max-h-7 w-auto max-w-[8rem] object-contain", 106, 40),
    name: "Omron",
  },
  accuchek: {
    description: "Glucose meter readings and history.",
    logo: logoAsset("accuchek.svg", "h-auto max-h-7 w-auto max-w-[8rem] object-contain", 122, 14),
    name: "Accu-Chek",
  },
  "eight-sleep": {
    description: "Smart mattress. Sleep, temperature, and heart rate.",
    logo: logoAsset("eight-sleep.svg"),
    name: "Eight Sleep",
  },
  fitbit: {
    description: "Sleep, activity, heart rate, and daily readiness.",
    logo: logoAsset("fitbit.svg"),
    name: "Fitbit",
  },
  "freestyle-libre": {
    description: "Glucose history, trends, and time in range.",
    logo: logoAsset("freestyle-libre.png"),
    name: "Freestyle Libre",
  },
  garmin: {
    description: "Workouts, sleep, stress, heart rate, and body battery.",
    logo: logoAsset("garmin.png"),
    name: "Garmin",
  },
  hammerhead: {
    description: "Cycling computer. Rides, routes, elevation, and power.",
    logo: logoAsset("hammerhead.png"),
    name: "Hammerhead",
  },
  ihealth: {
    description: "Blood pressure, glucose, weight, and pulse ox.",
    logo: logoAsset("ihealth.png"),
    name: "iHealth",
  },
  oura: {
    description: "Smart ring. Sleep, readiness, temperature, and recovery.",
    logo: logoAsset("oura.png", "h-auto max-h-8 w-auto max-w-[8rem] object-contain", 96, 30),
    name: "Oura",
  },
  peloton: {
    description: "Rides, runs, strength, and output.",
    logo: logoAsset("peloton.svg"),
    name: "Peloton",
  },
  wahoo: {
    description: "Cycling, running, heart rate, and power.",
    logo: logoAsset("wahoo.svg", "h-auto max-h-7 w-auto max-w-[8rem] object-contain", 108, 26),
    name: "Wahoo",
  },
  "contour-ble": {
    description: "Bluetooth glucose meter readings.",
    logo: logoAsset("contour-ble.png"),
    name: "Contour BLE",
  },
  withings: {
    description: "Weight, sleep, blood pressure, temperature, and activity.",
    logo: logoAsset("withings.png"),
    name: "Withings",
  },
  "google-fit": {
    description: "Steps, workouts, and heart rate from Android.",
    logo: logoAsset("google-fit.svg"),
    name: "Google Fit",
  },
  zwift: {
    description: "Virtual rides, runs, power, and distance.",
    logo: logoAsset("zwift.png"),
    name: "Zwift",
  },
  onetouch: {
    description: "Glucose meter readings and trends.",
    logo: logoAsset("onetouch.png"),
    name: "OneTouch",
  },
  "abbott-libreview": {
    description: "Glucose reports, trends, and sensor history.",
    logo: logoAsset("abbott-libreview.svg"),
    name: "Abbott LibreView",
  },
  dexcom: {
    description: "Real-time CGM glucose and trend arrows.",
    logo: logoAsset("dexcom.png"),
    name: "Dexcom",
  },
  kardia: {
    description: "Portable ECG recordings and rhythm detection.",
    logo: logoAsset("kardia.svg", "h-auto max-h-7 w-auto max-w-[8rem] object-contain", 104, 20),
    name: "Kardia",
  },
  cronometer: {
    description: "Calories, macros, micronutrients, and meal timing.",
    logo: logoAsset("cronometer.png"),
    name: "Cronometer",
  },
  polar: {
    description: "Training, sleep, heart rate, and recovery.",
    logo: logoAsset("polar.svg", "h-auto max-h-7 w-auto max-w-[8rem] object-contain", 122, 20),
    name: "Polar",
  },
} satisfies Record<string, ConnectSourceUi>;

const CONNECT_SOURCES: readonly ConnectSource[] = listVisibleConnectSources();

export default async function ConnectPage({
  searchParams,
}: {
  searchParams?: Promise<ConnectPageSearchParams>;
} = {}) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const auth = await getHostedPageAuthSnapshot();
  const connectedSourceIds = new Set<string>();
  let initialLoadError: ConnectPageInitialLoadError | null = null;

  if (auth.authenticatedMember) {
    try {
      const response = await buildHostedDeviceSyncSettingsResponse({
        member: auth.authenticatedMember,
      });
      for (const sourceId of resolveConnectedConnectSourceIds(CONNECT_SOURCES, response.sources)) {
        connectedSourceIds.add(sourceId);
      }
    } catch (error) {
      initialLoadError = isHostedOnboardingError(error)
        ? {
            message: error.message,
          }
        : {
            message: "Could not load your connected sources right now.",
          };
    }
  }

  const sources = resolveConfiguredConnectSources(CONNECT_SOURCES, {
    connectedSourceIds,
  });

  return (
    <div className="flex w-full min-w-0 max-w-[calc(100vw-3rem)] flex-col gap-8 md:max-w-full">
      <PageHeader
        eyebrow="Live Well"
        title="Sync your biomarkers"
        description="Bring in sleep, activity, recovery, glucose, and device context from the tools you already use."
      />

      <ConnectSourcesGrid
        authenticated={Boolean(auth.authenticatedMember)}
        initialCallback={resolveInitialConnectCallback(resolvedSearchParams)}
        initialLoadError={initialLoadError}
        sources={sources}
      />
    </div>
  );
}

export function listVisibleConnectSources(): ConnectSource[] {
  return DEVICE_CONNECT_SOURCES.flatMap((source) => {
    const ui = readConnectSourceUi(source.connectSourceId);
    return ui
      ? [
          {
            description: ui.description,
            id: source.connectSourceId,
            logo: ui.logo,
            name: ui.name,
          },
        ]
      : [];
  });
}

export function resolveConfiguredConnectSources(
  sources: readonly ConnectSource[],
  options: { connectedSourceIds?: ReadonlySet<string> } = {},
): ConnectSource[] {
  const connectTargetBySourceId = new Map(
    listConfiguredDeviceSyncConnectTargets(
      readConfiguredDeviceSyncProviderConfigs(process.env),
    ).map((target) => [target.connectSourceId, target.connectTarget] as const),
  );

  return sources.map((source) => {
    const connectTarget = connectTargetBySourceId.get(source.id);
    const connected = options.connectedSourceIds?.has(source.id) === true;

    return {
      ...source,
      ...(connectTarget ? { connectTarget } : {}),
      ...(connected ? { connected } : {}),
    };
  });
}

export function resolveConnectedConnectSourceIds(
  sources: readonly Pick<ConnectSource, "id">[],
  settingsSources: readonly Pick<
    HostedDeviceSyncSettingsSource,
    "provider" | "state" | "upstreamSources"
  >[],
): Set<string> {
  const connectedSourceIds = new Set<string>();
  const sourceIdByDirectProvider = new Map<string, string>();
  const sourceIdByJunctionTarget = new Map<string, string>();

  for (const source of sources) {
    const directProvider = normalizeDeviceSyncConnectTargetKey(source.id);
    if (directProvider) {
      sourceIdByDirectProvider.set(directProvider, source.id);
    }

    const junctionTarget = resolveJunctionConnectTargetForSourceId(source.id);
    if (junctionTarget) {
      sourceIdByJunctionTarget.set(junctionTarget, source.id);
    }
  }

  for (const source of settingsSources) {
    const provider = normalizeDeviceSyncConnectTargetKey(source.provider);
    if (source.state === "active" && provider) {
      const sourceId = sourceIdByDirectProvider.get(provider);
      if (sourceId) {
        connectedSourceIds.add(sourceId);
      }
    }

    if (provider !== "junction" || source.state !== "active") {
      continue;
    }

    for (const upstreamSource of source.upstreamSources) {
      if (upstreamSource.status !== "connected") {
        continue;
      }

      const sourceProviderSlug = normalizeDeviceSyncConnectTargetKey(upstreamSource.sourceProviderSlug);
      const sourceId = sourceProviderSlug
        ? sourceIdByJunctionTarget.get(sourceProviderSlug)
        : null;
      if (sourceId) {
        connectedSourceIds.add(sourceId);
      }
    }
  }

  return connectedSourceIds;
}

function resolveInitialConnectCallback(searchParams: ConnectPageSearchParams): ConnectCallbackInput {
  const status = readSearchParamString(searchParams, "deviceSyncStatus");

  if (status !== "connected" && status !== "error") {
    return null;
  }

  return {
    connectTarget: readSearchParamString(searchParams, "connectTarget"),
    connectSource: readSearchParamString(searchParams, "connectSource"),
    errorCode: readSearchParamString(searchParams, "deviceSyncError"),
    provider: readSearchParamString(searchParams, "deviceSyncProvider"),
    status,
  };
}

function readSearchParamString(
  searchParams: ConnectPageSearchParams,
  key: string,
): string | null {
  const value = searchParams[key];

  if (typeof value === "string") {
    return value;
  }

  return value?.[0] ?? null;
}

function logoAsset(
  fileName: string,
  className = "size-11 object-contain",
  width = 44,
  height = 44,
): LogoAsset {
  return {
    className,
    height,
    src: `/brand-logos/connect/${fileName}`,
    width,
  };
}

function readConnectSourceUi(connectSourceId: string): ConnectSourceUi | null {
  return Object.prototype.hasOwnProperty.call(CONNECT_SOURCE_UI, connectSourceId)
    ? CONNECT_SOURCE_UI[connectSourceId as keyof typeof CONNECT_SOURCE_UI]
    : null;
}
