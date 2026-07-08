import type { Metadata } from "next";
import {
  DEVICE_CONNECT_SOURCES,
  listConfiguredDeviceSyncConnectTargets,
  normalizeDeviceConnectSourceId,
  normalizeDeviceSyncConnectTargetKey,
  readConfiguredDeviceSyncConnectTargetConfigs,
  resolveDeviceConnectSourceIdForJunctionProviderSlug,
} from "@murphai/device-syncd/connect-config";

import { PageHeader } from "@/src/components/ui/page-header";
import { resolveHostedMurphContactOption } from "@/src/components/murph/hosted-murph-contact-action";
import { buildHostedDeviceSyncSettingsResponse } from "@/src/lib/device-sync/settings-service";
import type { HostedDeviceSyncSettingsSource } from "@/src/lib/device-sync/settings-surface";
import { isHostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

import { ConnectSourcesGrid } from "./connect-page-client";
import { sortConnectSourcesByConnectionState } from "./connect-source-order";
import type {
  ConnectCallbackInput,
  ConnectPageInitialLoadError,
  ConnectSource,
  LogoAsset,
} from "./connect-page-types";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Connect Devices — Murph",
  description: "Connect your wearables and health data sources.",
});

type ConnectPageSearchParams = Record<string, string | string[] | undefined>;

type ConnectSourceUi = Omit<ConnectSource, "id">;
type ConnectSettingsSourceMatch = Pick<
  HostedDeviceSyncSettingsSource,
  "connectSourceId" | "connectTarget" | "provider" | "state" | "upstreamSources"
> & {
  connectionId?: string | null;
  primaryAction?: HostedDeviceSyncSettingsSource["primaryAction"];
};
type ConnectSourceConnectionState = {
  connectionId: string | null;
  connectProvider: string | null;
  connectTarget: string | null;
  disconnectScope?: ConnectSourceDisconnectScope;
  requiresReconnect: boolean;
  sourceId: string;
  state: "active" | "reauthorization_required";
};
type ConnectSourceDisconnectScope = NonNullable<ConnectSource["disconnectScope"]>;

const DISPLAY_ONLY_CONNECT_SOURCE_IDS = new Set<string>(["apple-health"]);

const CONNECT_SOURCE_UI = {
  "apple-health": {
    description: "iPhone and Apple Watch activity, sleep, vitals, and workouts.",
    logo: logoAsset("apple-health.png"),
    name: "Apple Health",
    unavailableActionLabel: "Coming soon",
    unavailableMessage: "Apple Health web setup is coming soon. Connect from the Murph iOS app for now.",
  },
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
  const auth = await getHostedDashboardPageAuthSnapshot();
  const connectedSourceIds = new Set<string>();
  const reconnectSourceIds = new Set<string>();
  const reconnectProviderBySourceId = new Map<string, string>();
  const reconnectTargetBySourceId = new Map<string, string>();
  const disconnectConnectionIdBySourceId = new Map<string, string>();
  const disconnectScopeBySourceId = new Map<string, ConnectSourceDisconnectScope>();
  let initialLoadError: ConnectPageInitialLoadError | null = null;
  const recoveryContactAction = await resolveDeviceConnectRecoveryContactAction(
    Boolean(auth.authenticatedMember),
  );

  if (auth.authenticatedMember) {
    try {
      const response = await buildHostedDeviceSyncSettingsResponse({
        member: auth.authenticatedMember,
      });
      for (const connection of resolveConnectSourceConnectionStates(CONNECT_SOURCES, response.sources)) {
        const sourceId = connection.sourceId;
        if (connection.requiresReconnect) {
          reconnectSourceIds.add(sourceId);
        } else if (connection.state === "active") {
          connectedSourceIds.add(sourceId);
        }
        if (connection.connectionId) {
          disconnectConnectionIdBySourceId.set(sourceId, connection.connectionId);
        }
        if (connection.disconnectScope) {
          disconnectScopeBySourceId.set(sourceId, connection.disconnectScope);
        }
        if (connection.requiresReconnect) {
          if (connection.connectProvider) {
            reconnectProviderBySourceId.set(sourceId, connection.connectProvider);
          }
          if (connection.connectTarget) {
            reconnectTargetBySourceId.set(sourceId, connection.connectTarget);
          }
        }
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
    disconnectConnectionIdBySourceId,
    disconnectScopeBySourceId,
    reconnectProviderBySourceId,
    reconnectSourceIds,
    reconnectTargetBySourceId,
  });

  return (
    <div className="flex w-full min-w-0 flex-col gap-8 md:max-w-full">
      <PageHeader
        eyebrow="Live Well"
        title="Sync your biomarkers"
        description="Bring in sleep, activity, recovery, glucose, and device context from the tools you already use."
      />

      <ConnectSourcesGrid
        authenticated={Boolean(auth.authenticatedMember)}
        deviceConnectRecoveryContactAction={recoveryContactAction}
        initialCallback={resolveVerifiedInitialConnectCallback(resolvedSearchParams, sources)}
        initialLoadError={initialLoadError}
        sources={sources}
      />
    </div>
  );
}

export function listVisibleConnectSources(): ConnectSource[] {
  return DEVICE_CONNECT_SOURCES.flatMap((source) => {
    if (!isVisibleConnectSource(source)) {
      return [];
    }

    const ui = readConnectSourceUi(source.connectSourceId);
    return ui
      ? [
          {
            description: ui.description,
            id: source.connectSourceId,
            logo: ui.logo,
            name: ui.name,
            ...(ui.unavailableActionLabel ? { unavailableActionLabel: ui.unavailableActionLabel } : {}),
            ...(ui.unavailableMessage ? { unavailableMessage: ui.unavailableMessage } : {}),
          },
        ]
      : [];
  });
}

async function resolveDeviceConnectRecoveryContactAction(authenticated: boolean) {
  if (!authenticated) {
    return null;
  }

  try {
    return await resolveHostedMurphContactOption({
      message: {
        body: "Can you send me a fresh device connection link?",
      },
    });
  } catch {
    return null;
  }
}

function isVisibleConnectSource(source: (typeof DEVICE_CONNECT_SOURCES)[number]): boolean {
  return DISPLAY_ONLY_CONNECT_SOURCE_IDS.has(source.connectSourceId)
    || source.routes.some((route) => route.kind === "direct" || route.kind === "junction_link");
}

export function resolveConfiguredConnectSources(
  sources: readonly ConnectSource[],
  options: {
    connectedSourceIds?: ReadonlySet<string>;
    disconnectConnectionIdBySourceId?: ReadonlyMap<string, string>;
    disconnectScopeBySourceId?: ReadonlyMap<string, ConnectSourceDisconnectScope>;
    reconnectProviderBySourceId?: ReadonlyMap<string, string>;
    reconnectSourceIds?: ReadonlySet<string>;
    reconnectTargetBySourceId?: ReadonlyMap<string, string>;
  } = {},
): ConnectSource[] {
  const connectTargetBySourceId = new Map(
    listConfiguredDeviceSyncConnectTargets(
      readConfiguredDeviceSyncConnectTargetConfigs(process.env),
    ).map((target) => [target.connectSourceId, target.connectTarget] as const),
  );

  return sortConnectSourcesByConnectionState(
    sources.map((source) => {
      const connectTarget = connectTargetBySourceId.get(source.id);
      const connected = options.connectedSourceIds?.has(source.id) === true;
      const requiresReconnect = !connected && options.reconnectSourceIds?.has(source.id) === true;
      const disconnectConnectionId = options.disconnectConnectionIdBySourceId?.get(source.id);
      const disconnectScope = options.disconnectScopeBySourceId?.get(source.id);
      const reconnectProvider = options.reconnectProviderBySourceId?.get(source.id);
      const reconnectTarget = options.reconnectTargetBySourceId?.get(source.id);
      const resolvedConnectTarget = reconnectTarget ?? connectTarget;

      return {
        ...source,
        ...(reconnectProvider ? { connectProvider: reconnectProvider } : {}),
        ...(resolvedConnectTarget ? { connectTarget: resolvedConnectTarget } : {}),
        ...(disconnectConnectionId ? { disconnectConnectionId } : {}),
        ...(disconnectScope ? { disconnectScope } : {}),
        ...(requiresReconnect ? { requiresReconnect } : {}),
        ...(connected ? { connected } : {}),
      };
    }),
  );
}

export function resolveConnectSourceConnectionStates(
  sources: readonly Pick<ConnectSource, "id">[],
  settingsSources: readonly ConnectSettingsSourceMatch[],
): ConnectSourceConnectionState[] {
  return resolveConnectSourceConnectionMatches(sources, settingsSources, {
    includeReauthorizationRequired: true,
  });
}

export function resolveConnectedConnectSourceIds(
  sources: readonly Pick<ConnectSource, "id">[],
  settingsSources: readonly Pick<
    HostedDeviceSyncSettingsSource,
    "provider" | "state" | "upstreamSources"
  >[],
): Set<string> {
  return new Set(
    resolveConnectedConnectSourceConnections(sources, settingsSources)
      .map((connection) => connection.sourceId),
  );
}

export function resolveConnectedConnectSourceConnections(
  sources: readonly Pick<ConnectSource, "id">[],
  settingsSources: readonly ConnectSettingsSourceMatch[],
): { connectionId: string | null; sourceId: string }[] {
  return resolveConnectSourceConnectionMatches(sources, settingsSources).map((connection) => ({
    connectionId: connection.connectionId,
    sourceId: connection.sourceId,
  }));
}

function resolveConnectSourceConnectionMatches(
  sources: readonly Pick<ConnectSource, "id">[],
  settingsSources: readonly ConnectSettingsSourceMatch[],
  options: { includeReauthorizationRequired?: boolean } = {},
): ConnectSourceConnectionState[] {
  const connectedConnections = new Map<string, ConnectSourceConnectionState>();
  const visibleSourceIds = new Set(sources.map((source) => source.id));
  const sourceIdByDirectProvider = new Map<string, string>();

  for (const source of sources) {
    const directProvider = normalizeDeviceSyncConnectTargetKey(source.id);
    if (directProvider) {
      sourceIdByDirectProvider.set(directProvider, source.id);
    }
  }

  for (const source of settingsSources) {
    const provider = normalizeDeviceSyncConnectTargetKey(source.provider);
    const sourceState = source.state === "active" || (
      options.includeReauthorizationRequired === true
      && isReauthorizationRequiredConnectSourceState(source.state)
    )
      ? source.state
      : null;
    const parentRequiresReconnect = isReauthorizationRequiredConnectSourceState(source.state);
    const sourceRequiresReconnect = source.primaryAction?.kind === "reconnect";
    const requiresReconnect = sourceRequiresReconnect || parentRequiresReconnect;
    const connectionId = typeof source.connectionId === "string" && source.connectionId.trim()
      ? source.connectionId
      : null;
    const connectTarget = typeof source.connectTarget === "string" && source.connectTarget.trim()
      ? source.connectTarget
      : null;
    const disconnect = resolveConnectSourceDisconnect(source, connectionId);
    const hasJunctionUpstreamSources = provider === "junction" && source.upstreamSources.length > 0;
    const unambiguousJunctionReconnectUpstreamCount = hasJunctionUpstreamSources && sourceRequiresReconnect
      ? countLiveJunctionUpstreamSources(source.upstreamSources)
      : 0;

    const configuredSourceId = normalizeDeviceConnectSourceId(source.connectSourceId ?? null);
    if (
      sourceState
      && configuredSourceId
      && visibleSourceIds.has(configuredSourceId)
      && !hasJunctionUpstreamSources
    ) {
      upsertConnectSourceConnection(connectedConnections, {
        connectionId: disconnect.connectionId,
        connectProvider: provider,
        connectTarget,
        ...(disconnect.scope ? { disconnectScope: disconnect.scope } : {}),
        requiresReconnect,
        sourceId: configuredSourceId,
        state: sourceState,
      });
    }

    if (sourceState && provider) {
      const sourceId = sourceIdByDirectProvider.get(provider);
      if (sourceId) {
        upsertConnectSourceConnection(connectedConnections, {
          connectionId: disconnect.connectionId,
          connectProvider: provider,
          connectTarget,
          ...(disconnect.scope ? { disconnectScope: disconnect.scope } : {}),
          requiresReconnect,
          sourceId,
          state: sourceState,
        });
      }
    }

    if (provider !== "junction" || !sourceState) {
      continue;
    }

    for (const upstreamSource of source.upstreamSources) {
      const upstreamOwnRequiresReconnect = upstreamSource.requiresReconnect === true;
      const upstreamInheritsSourceReconnect =
        sourceRequiresReconnect
        && unambiguousJunctionReconnectUpstreamCount === 1
        && isLiveJunctionUpstreamSource(upstreamSource);
      const upstreamRequiresReconnect = parentRequiresReconnect
        || upstreamOwnRequiresReconnect
        || upstreamInheritsSourceReconnect;
      const upstreamConnectProvider = upstreamSource.connectProvider
        ? normalizeDeviceSyncConnectTargetKey(upstreamSource.connectProvider)
        : provider;
      const upstreamConnectTarget =
        typeof upstreamSource.connectTarget === "string" && upstreamSource.connectTarget.trim()
          ? upstreamSource.connectTarget
          : null;

      if (
        sourceState === "active"
        && upstreamSource.status !== "connected"
        && !upstreamRequiresReconnect
      ) {
        continue;
      }

      const sourceProviderSlug = normalizeDeviceSyncConnectTargetKey(upstreamSource.sourceProviderSlug);
      const sourceId = sourceProviderSlug
        ? resolveDeviceConnectSourceIdForJunctionProviderSlug(sourceProviderSlug)
        : null;
      if (sourceId && visibleSourceIds.has(sourceId)) {
        upsertConnectSourceConnection(connectedConnections, {
          connectionId: disconnect.connectionId,
          connectProvider: upstreamRequiresReconnect ? upstreamConnectProvider : provider,
          connectTarget: upstreamRequiresReconnect ? upstreamConnectTarget : null,
          ...(disconnect.scope ? { disconnectScope: disconnect.scope } : {}),
          requiresReconnect: upstreamRequiresReconnect,
          sourceId,
          state: sourceState,
        });
      }
    }
  }

  return [...connectedConnections.values()];
}

function resolveConnectSourceDisconnect(
  source: ConnectSettingsSourceMatch,
  connectionId: string | null,
): { connectionId: string | null; scope: ConnectSourceDisconnectScope | null } {
  if (!connectionId) {
    return { connectionId: null, scope: null };
  }

  const provider = normalizeDeviceSyncConnectTargetKey(source.provider);
  if (provider !== "junction") {
    return { connectionId, scope: null };
  }

  const affectedUpstreamSourceCount = isReauthorizationRequiredConnectSourceState(source.state)
    ? source.upstreamSources.length
    : countLiveJunctionUpstreamSources(source.upstreamSources);

  if (affectedUpstreamSourceCount <= 1) {
    return { connectionId, scope: null };
  }

  return {
    connectionId,
    scope: "junction_account",
  };
}

function countLiveJunctionUpstreamSources(
  upstreamSources: ConnectSettingsSourceMatch["upstreamSources"],
): number {
  return upstreamSources.filter(isLiveJunctionUpstreamSource).length;
}

function isLiveJunctionUpstreamSource(
  source: ConnectSettingsSourceMatch["upstreamSources"][number],
): boolean {
  return source.status === "connected"
    || source.status === "error"
    || source.requiresReconnect === true;
}

function upsertConnectSourceConnection(
  connections: Map<string, ConnectSourceConnectionState>,
  next: ConnectSourceConnectionState,
): void {
  const existing = connections.get(next.sourceId);
  if (!existing || compareConnectSourceStatePriority(next, existing) > 0) {
    connections.set(next.sourceId, next);
  }
}

function compareConnectSourceStatePriority(
  left: ConnectSourceConnectionState,
  right: ConnectSourceConnectionState,
): number {
  return connectSourceStatePriority(left) - connectSourceStatePriority(right);
}

function connectSourceStatePriority(connection: ConnectSourceConnectionState): number {
  if (connection.state === "active" && connection.requiresReconnect) {
    return 5;
  }

  if (connection.state === "active") {
    return 4;
  }

  return 2;
}

function isReauthorizationRequiredConnectSourceState(
  state: HostedDeviceSyncSettingsSource["state"] | ConnectSourceConnectionState["state"],
): state is "reauthorization_required" {
  return state === "reauthorization_required";
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

function resolveVerifiedInitialConnectCallback(
  searchParams: ConnectPageSearchParams,
  sources: readonly ConnectSource[],
): ConnectCallbackInput {
  const callback = resolveInitialConnectCallback(searchParams);

  if (callback?.status !== "connected") {
    return callback;
  }

  const callbackSourceId = findCallbackSourceId({
    connectSource: callback.connectSource,
    connectTarget: callback.connectTarget,
    provider: callback.provider,
    sources,
  });
  const confirmed = callbackSourceId
    ? sources.some((source) => source.id === callbackSourceId && source.connected === true)
    : false;

  return confirmed ? callback : null;
}

function findCallbackSourceId(input: {
  connectSource: string | null;
  connectTarget: string | null;
  provider: string | null;
  sources: readonly ConnectSource[];
}): string | null {
  const source = normalizeDeviceConnectSourceId(input.connectSource);
  const target = input.connectTarget ? normalizeDeviceSyncConnectTargetKey(input.connectTarget) : null;
  const provider = input.provider ? normalizeDeviceSyncConnectTargetKey(input.provider) : null;

  return input.sources.find((candidate) => {
    const sourceTarget = candidate.connectTarget
      ? normalizeDeviceSyncConnectTargetKey(candidate.connectTarget)
      : null;
    const sourceId = normalizeDeviceSyncConnectTargetKey(candidate.id);
    const normalizedSourceId = normalizeDeviceConnectSourceId(candidate.id);

    return Boolean(
      (source && normalizedSourceId === source)
      || (target && (sourceTarget === target || sourceId === target))
      || (provider && (sourceTarget === provider || sourceId === provider)),
    );
  })?.id ?? null;
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
