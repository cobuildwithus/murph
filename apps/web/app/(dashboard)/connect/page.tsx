import type { Metadata } from "next";
import {
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

const CONNECT_SOURCES: readonly ConnectSource[] = [
  {
    description: "Recovery, strain, sleep, and heart rate.",
    id: "whoop",
    logo: logoAsset("whoop.svg", "h-auto max-h-7 w-auto max-w-[8rem] object-contain", 96, 15),
    name: "Whoop",
  },
  {
    description: "Workouts, routes, pace, and distance.",
    id: "mapmyfitness",
    logo: logoAsset("mapmyfitness.png"),
    name: "MapMyFitness",
  },
  {
    description: "Smart ring. Sleep, recovery, temperature, and movement.",
    id: "ultrahuman",
    logo: logoAsset("ultrahuman.png"),
    name: "Ultrahuman",
  },
  {
    description: "Continuous glucose and sensor trends.",
    id: "dexcom-g6-and-older",
    logo: logoAsset("dexcom-g6-and-older.png"),
    name: "Dexcom (G6 and older)",
  },
  {
    description: "Smart scale. Weight and body composition.",
    id: "renpho",
    logo: logoAsset("renpho.svg", "h-auto max-h-7 w-auto max-w-[8rem] object-contain", 110, 22),
    name: "Renpho",
  },
  {
    description: "Runs, walks, routes, and pace.",
    id: "runkeeper",
    logo: logoAsset("runkeeper.svg", "h-auto max-h-7 w-auto max-w-[8rem] object-contain", 132, 20),
    name: "Runkeeper",
  },
  {
    description: "Phone and watch activity, sleep, and heart rate.",
    id: "samsung-health",
    logo: logoAsset("samsung-health.png"),
    name: "Samsung Health",
  },
  {
    description: "Insulin pump and CGM therapy records.",
    id: "tandem-source",
    logo: logoAsset("tandem-source.svg", "h-auto max-h-7 w-auto max-w-[8rem] object-contain", 120, 25),
    name: "Tandem Source",
  },
  {
    description: "Blood pressure, weight, glucose, and pulse ox.",
    id: "beurer",
    logo: logoAsset("beurer.png"),
    name: "Beurer",
  },
  {
    description: "Rides, runs, power, and training load.",
    id: "strava",
    logo: logoAsset("strava.svg", "h-auto max-h-9 w-auto max-w-[8rem] object-contain", 96, 20),
    name: "Strava",
  },
  {
    description: "Real-time glucose via Bluetooth sensor.",
    id: "freestyle-libre-ble",
    logo: logoAsset("freestyle-libre-ble.png"),
    name: "Freestyle Libre BLE",
  },
  {
    description: "Blood pressure, pulse, and weight.",
    id: "omron",
    logo: logoAsset("omron.png", "h-auto max-h-7 w-auto max-w-[8rem] object-contain", 106, 40),
    name: "Omron",
  },
  {
    description: "Glucose meter readings and history.",
    id: "accuchek",
    logo: logoAsset("accuchek.svg", "h-auto max-h-7 w-auto max-w-[8rem] object-contain", 122, 14),
    name: "Accu-Chek",
  },
  {
    description: "Smart mattress. Sleep, temperature, and heart rate.",
    id: "eight-sleep",
    logo: logoAsset("eight-sleep.svg"),
    name: "Eight Sleep",
  },
  {
    description: "Sleep, activity, heart rate, and daily readiness.",
    id: "fitbit",
    logo: logoAsset("fitbit.svg"),
    name: "Fitbit",
  },
  {
    description: "Glucose history, trends, and time in range.",
    id: "freestyle-libre",
    logo: logoAsset("freestyle-libre.png"),
    name: "Freestyle Libre",
  },
  {
    description: "Workouts, sleep, stress, heart rate, and body battery.",
    id: "garmin",
    logo: logoAsset("garmin.png"),
    name: "Garmin",
  },
  {
    description: "Cycling computer. Rides, routes, elevation, and power.",
    id: "hammerhead",
    logo: logoAsset("hammerhead.png"),
    name: "Hammerhead",
  },
  {
    description: "Blood pressure, glucose, weight, and pulse ox.",
    id: "ihealth",
    logo: logoAsset("ihealth.png"),
    name: "iHealth",
  },
  {
    description: "Smart ring. Sleep, readiness, temperature, and recovery.",
    id: "oura",
    logo: logoAsset("oura.png", "h-auto max-h-8 w-auto max-w-[8rem] object-contain", 96, 30),
    name: "Oura",
  },
  {
    description: "Rides, runs, strength, and output.",
    id: "peloton",
    logo: logoAsset("peloton.svg"),
    name: "Peloton",
  },
  {
    description: "Cycling, running, heart rate, and power.",
    id: "wahoo",
    logo: logoAsset("wahoo.svg", "h-auto max-h-7 w-auto max-w-[8rem] object-contain", 108, 26),
    name: "Wahoo",
  },
  {
    description: "Bluetooth glucose meter readings.",
    id: "contour-ble",
    logo: logoAsset("contour-ble.png"),
    name: "Contour BLE",
  },
  {
    description: "Weight, sleep, blood pressure, temperature, and activity.",
    id: "withings",
    logo: logoAsset("withings.png"),
    name: "Withings",
  },
  {
    description: "Steps, workouts, and heart rate from Android.",
    id: "google-fit",
    logo: logoAsset("google-fit.svg"),
    name: "Google Fit",
  },
  {
    description: "Virtual rides, runs, power, and distance.",
    id: "zwift",
    logo: logoAsset("zwift.png"),
    name: "Zwift",
  },
  {
    description: "Glucose meter readings and trends.",
    id: "onetouch",
    logo: logoAsset("onetouch.png"),
    name: "OneTouch",
  },
  {
    description: "Glucose reports, trends, and sensor history.",
    id: "abbott-libreview",
    logo: logoAsset("abbott-libreview.svg"),
    name: "Abbott LibreView",
  },
  {
    description: "Real-time CGM glucose and trend arrows.",
    id: "dexcom",
    logo: logoAsset("dexcom.png"),
    name: "Dexcom",
  },
  {
    description: "Portable ECG recordings and rhythm detection.",
    id: "kardia",
    logo: logoAsset("kardia.svg", "h-auto max-h-7 w-auto max-w-[8rem] object-contain", 104, 20),
    name: "Kardia",
  },
  {
    description: "Calories, macros, micronutrients, and meal timing.",
    id: "cronometer",
    logo: logoAsset("cronometer.png"),
    name: "Cronometer",
  },
  {
    description: "Training, sleep, heart rate, and recovery.",
    id: "polar",
    logo: logoAsset("polar.svg", "h-auto max-h-7 w-auto max-w-[8rem] object-contain", 122, 20),
    name: "Polar",
  },
] as const;

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
        title="Connect your health"
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
