import "server-only";

import {
  DEVICE_CONNECT_SOURCES,
  JUNCTION_FITBIT_LEGACY_PROVIDER_SLUG,
  JUNCTION_GOOGLE_HEALTH_PROVIDER_SLUG,
  isDeviceConnectSourceAvailableForConnection,
  listConfiguredDeviceSyncConnectTargets,
  normalizeDeviceConnectSourceId,
  normalizeDeviceSyncConnectTargetKey,
  readConfiguredDeviceSyncConnectTargetConfigs,
  resolveDeviceConnectSourceIdForJunctionProviderSlug,
} from "@murphai/device-syncd/connect-config";
import {
  DEVICE_SYNC_GOOGLE_HEALTH_FITBIT_CUTOVER_FAILED_ERROR_CODE,
  isGoogleHealthFitbitMigrationLegacyTerminal,
} from "@murphai/device-syncd/fitbit-migration";
import type { HostedDeviceSyncSettingsSource } from "./settings-surface";
import type { ConnectSource, LogoAsset } from "./connect-source-types";
import {
  APPLE_HEALTH_RELAY_CONNECT_SOURCE_IDS,
  APPLE_HEALTH_RELAY_CONNECT_SOURCE_UI,
} from "./apple-health-relay-connect-sources";
import {
  listHealthConnectRelayConnectSources,
  MOBVOI_HEALTH_CONNECT_SOURCE,
} from "./health-connect-relay-connect-sources";
import { MURPH_IOS_APP_STORE_URL } from "@/src/lib/site-metadata";
import { sortConnectSourcesByConnectionState } from "./connect-source-order";

type ConnectSourceUi = Omit<ConnectSource, "id">;
type ConnectSettingsSourceMatch = Pick<
  HostedDeviceSyncSettingsSource,
  | "connectSourceId"
  | "connectTarget"
  | "historicalResetIncomplete"
  | "provider"
  | "state"
  | "upstreamSources"
> & {
  connectionId?: string | null;
  primaryAction?: HostedDeviceSyncSettingsSource["primaryAction"];
};
export type ConnectSourceConnectionState = {
  connectionId: string | null;
  connectProvider: string | null;
  connectTarget: string | null;
  disconnectScope?: ConnectSourceDisconnectScope;
  disconnectSourceProviderSlug?: string;
  migrationState?: ConnectSourceMigrationState;
  migrationRetryRequired?: boolean;
  recoveryKind?: ConnectSourceRecoveryKind;
  requiresReconnect: boolean;
  sourceId: string;
  state: "active" | "reauthorization_required";
};
type ConnectSourceRecoveryKind = NonNullable<ConnectSource["recoveryKind"]>;
type ConnectSourceMigrationState = NonNullable<ConnectSource["migrationState"]>;
type ConnectSourceDisconnectScope = NonNullable<
  ConnectSource["disconnectScope"]
>;

const DISPLAY_ONLY_CONNECT_SOURCE_IDS = new Set<string>([
  "apple-health",
  ...APPLE_HEALTH_RELAY_CONNECT_SOURCE_IDS,
]);

const CONNECT_SOURCE_UI = {
  "apple-health": {
    description:
      "iPhone and Apple Watch activity, sleep, vitals, and workouts.",
    logo: logoAsset("apple-health.png"),
    name: "Apple Health",
    unavailableActionLabel: "Download app",
    unavailableActionUrl: MURPH_IOS_APP_STORE_URL,
  },
  ...APPLE_HEALTH_RELAY_CONNECT_SOURCE_UI,
  "mobvoi-health": MOBVOI_HEALTH_CONNECT_SOURCE,
  whoop: {
    description: "Recovery, strain, sleep, and heart rate.",
    logo: logoAsset(
      "whoop.svg",
      "h-auto max-h-7 w-auto max-w-[8rem] object-contain",
      96,
      15,
    ),
    name: "WHOOP",
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
    logo: logoAsset(
      "renpho.svg",
      "h-auto max-h-7 w-auto max-w-[8rem] object-contain",
      110,
      22,
    ),
    name: "Renpho",
  },
  runkeeper: {
    description: "Runs, walks, routes, and pace.",
    logo: logoAsset(
      "runkeeper.svg",
      "h-auto max-h-7 w-auto max-w-[8rem] object-contain",
      132,
      20,
    ),
    name: "Runkeeper",
  },
  "samsung-health": {
    description: "Phone and watch activity, sleep, and heart rate.",
    logo: logoAsset("samsung-health.png"),
    name: "Samsung Health",
  },
  "tandem-source": {
    description: "Insulin pump and CGM therapy records.",
    logo: logoAsset(
      "tandem-source.svg",
      "h-auto max-h-7 w-auto max-w-[8rem] object-contain",
      120,
      25,
    ),
    name: "Tandem Source",
  },
  beurer: {
    description: "Blood pressure, weight, glucose, and pulse ox.",
    logo: logoAsset("beurer.png"),
    name: "Beurer",
  },
  strava: {
    description: "Rides, runs, power, and training load.",
    logo: logoAsset(
      "strava.svg",
      "h-auto max-h-9 w-auto max-w-[8rem] object-contain",
      96,
      20,
    ),
    name: "Strava",
  },
  "freestyle-libre-ble": {
    description: "Real-time glucose via Bluetooth sensor.",
    logo: logoAsset("freestyle-libre-ble.png"),
    name: "Freestyle Libre BLE",
  },
  omron: {
    description: "Blood pressure, pulse, and weight.",
    logo: logoAsset(
      "omron.png",
      "h-auto max-h-7 w-auto max-w-[8rem] object-contain",
      106,
      40,
    ),
    name: "Omron",
  },
  accuchek: {
    description: "Glucose meter readings and history.",
    logo: logoAsset(
      "accuchek.svg",
      "h-auto max-h-7 w-auto max-w-[8rem] object-contain",
      122,
      14,
    ),
    name: "Accu-Chek",
  },
  "eight-sleep": {
    description: "Smart mattress. Sleep, temperature, and heart rate.",
    logo: logoAsset("eight-sleep.svg"),
    name: "Eight Sleep",
  },
  fitbit: {
    description: "Fitbit and Pixel Watch sleep, activity, heart rate, and workouts.",
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
    logo: logoAsset(
      "oura.png",
      "h-auto max-h-8 w-auto max-w-[8rem] object-contain",
      96,
      30,
    ),
    name: "Oura",
  },
  peloton: {
    description: "Rides, runs, strength, and output.",
    logo: logoAsset("peloton.svg"),
    name: "Peloton",
  },
  wahoo: {
    description: "Cycling, running, heart rate, and power.",
    logo: logoAsset(
      "wahoo.svg",
      "h-auto max-h-7 w-auto max-w-[8rem] object-contain",
      108,
      26,
    ),
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
    description: "CGM glucose readings and trends.",
    logo: logoAsset("dexcom.png"),
    name: "Dexcom",
    unavailableActionLabel: "Coming soon",
    unavailableMessage: "Dexcom connections are coming soon.",
  },
  kardia: {
    description: "Portable ECG recordings and rhythm detection.",
    logo: logoAsset(
      "kardia.svg",
      "h-auto max-h-7 w-auto max-w-[8rem] object-contain",
      104,
      20,
    ),
    name: "Kardia",
  },
  cronometer: {
    description:
      "Meal logs with calories, macros, timing, and supported nutrient fields. Daily targets and dashboard percentages stay in Cronometer.",
    logo: logoAsset("cronometer.png"),
    name: "Cronometer",
  },
  polar: {
    description: "Training, sleep, heart rate, and recovery.",
    logo: logoAsset(
      "polar.svg",
      "h-auto max-h-7 w-auto max-w-[8rem] object-contain",
      122,
      20,
    ),
    name: "Polar",
  },
} satisfies Record<string, ConnectSourceUi>;

export function resolveConnectSources(
  settingsSources: readonly ConnectSettingsSourceMatch[] = [],
): ConnectSource[] {
  const sources = listVisibleDeviceConnectSources();
  return sortConnectSourcesByConnectionState([
    ...resolveConfiguredConnectSources(sources, {
      connectionStates: resolveConnectSourceConnectionStates(sources, settingsSources),
      historicalResetIncompleteSourceIds:
        resolveHistoricalResetIncompleteConnectSourceIds(sources, settingsSources),
    }),
    ...listHealthConnectRelayConnectSources(),
  ]);
}

export function connectSourcePngLogoPath(id: string): string | null {
  return readConnectSourceUi(id)?.logo.src.replace(/\.svg$/u, ".png") ?? null;
}

export function listVisibleDeviceConnectSources(): ConnectSource[] {
  return DEVICE_CONNECT_SOURCES.flatMap((source) => {
    if (!isVisibleConnectSource(source)) {
      return [];
    }

    const ui = readConnectSourceUi(source.connectSourceId);
    return ui ? [{ id: source.connectSourceId, ...ui }] : [];
  });
}

function isVisibleConnectSource(
  source: (typeof DEVICE_CONNECT_SOURCES)[number],
): boolean {
  return (
    DISPLAY_ONLY_CONNECT_SOURCE_IDS.has(source.connectSourceId) ||
    source.routes.some(
      (route) => route.kind === "junction_link",
    )
  );
}

export function resolveConfiguredConnectSources(
  sources: readonly ConnectSource[],
  options: {
    connectionStates?: readonly ConnectSourceConnectionState[];
    historicalResetIncompleteSourceIds?: ReadonlySet<string>;
  } = {},
): ConnectSource[] {
  const connectConfigBySourceId = new Map(
    listConfiguredDeviceSyncConnectTargets(
      readConfiguredDeviceSyncConnectTargetConfigs(process.env),
    ).map((target) => [target.connectSourceId, target] as const),
  );

  const connectionBySourceId = new Map(
    options.connectionStates?.map((connection) => [connection.sourceId, connection]),
  );

  return sortConnectSourcesByConnectionState(
    sources.map((source) => {
      const connectionAvailable = isDeviceConnectSourceAvailableForConnection(
        source.id,
      );
      const connectConfig = connectConfigBySourceId.get(source.id);
      const {
        connectionId: disconnectConnectionId,
        connectProvider,
        connectTarget,
        disconnectScope,
        disconnectSourceProviderSlug,
        migrationState,
        migrationRetryRequired,
        recoveryKind,
        requiresReconnect: reconnect,
        state,
      } = connectionBySourceId.get(source.id) ?? {};
      const connected =
        !migrationState && !recoveryKind && !reconnect && state === "active";
      const requiresReconnect = !recoveryKind && reconnect === true;
      const historicalResetIncomplete =
        !connected &&
        !recoveryKind &&
        !requiresReconnect &&
        options.historicalResetIncompleteSourceIds?.has(source.id) === true;
      const useReconnectTarget = reconnect || migrationState === "authorization_required";
      const reconnectProvider = useReconnectTarget ? connectProvider : undefined;
      const reconnectTarget = useReconnectTarget ? connectTarget : undefined;
      const resolvedConnectTarget = connectionAvailable
        ? (reconnectTarget ?? connectConfig?.connectTarget)
        : undefined;
      const requiresVitalDisclosure =
        connectionAvailable &&
        connectConfig?.provider === "junction" &&
        source.id !== "fitbit";

      return {
        ...source,
        connectionAvailable,
        ...(reconnectProvider ? { connectProvider: reconnectProvider } : {}),
        ...(resolvedConnectTarget
          ? { connectTarget: resolvedConnectTarget }
          : {}),
        ...(disconnectConnectionId ? { disconnectConnectionId } : {}),
        ...(disconnectScope ? { disconnectScope } : {}),
        ...(disconnectSourceProviderSlug
          ? { disconnectSourceProviderSlug }
          : {}),
        ...(historicalResetIncomplete ? { historicalResetIncomplete } : {}),
        ...(migrationState ? { migrationState } : {}),
        ...(migrationRetryRequired
          ? { migrationRetryRequired: true }
          : {}),
        ...(recoveryKind ? { recoveryKind } : {}),
        ...(requiresReconnect ? { requiresReconnect } : {}),
        ...(requiresVitalDisclosure ? { requiresVitalDisclosure } : {}),
        ...(connected ? { connected } : {}),
      };
    }),
  ).filter(
    (source) =>
      source.connectionAvailable !== false ||
      Boolean(source.setupGuideId) ||
      Boolean(source.unavailableMessage) ||
      source.connected === true ||
      source.requiresReconnect === true ||
      Boolean(source.recoveryKind) ||
      Boolean(source.migrationState) ||
      source.historicalResetIncomplete === true,
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

// A disconnected connection can still carry the persisted unfinished-reset warning.
// Map it to the visible connect sources it covered so the connect page can keep
// showing the manual provider-removal guidance next to the ordinary Connect action.
export function resolveHistoricalResetIncompleteConnectSourceIds(
  sources: readonly Pick<ConnectSource, "id">[],
  settingsSources: readonly ConnectSettingsSourceMatch[],
): Set<string> {
  const visibleSourceIds = new Set(sources.map((source) => source.id));
  const sourceIdByDirectProvider = new Map<string, string>();
  for (const source of sources) {
    const directProvider = normalizeDeviceSyncConnectTargetKey(source.id);
    if (directProvider) {
      sourceIdByDirectProvider.set(directProvider, source.id);
    }
  }
  const resetIncompleteSourceIds = new Set<string>();

  for (const source of settingsSources) {
    if (
      source.state !== "disconnected" ||
      source.historicalResetIncomplete !== true
    ) {
      continue;
    }

    const provider = normalizeDeviceSyncConnectTargetKey(source.provider);
    const configuredSourceId = normalizeDeviceConnectSourceId(
      source.connectSourceId ?? null,
    );
    if (configuredSourceId && visibleSourceIds.has(configuredSourceId)) {
      resetIncompleteSourceIds.add(configuredSourceId);
    }
    const directSourceId = provider
      ? sourceIdByDirectProvider.get(provider)
      : null;
    if (directSourceId) {
      resetIncompleteSourceIds.add(directSourceId);
    }
    if (provider !== "junction") {
      continue;
    }

    for (const upstreamSource of source.upstreamSources) {
      const sourceProviderSlug = normalizeDeviceSyncConnectTargetKey(
        upstreamSource.sourceProviderSlug,
      );
      const sourceId = sourceProviderSlug
        ? resolveDeviceConnectSourceIdForJunctionProviderSlug(
            sourceProviderSlug,
          )
        : null;
      if (sourceId && visibleSourceIds.has(sourceId)) {
        resetIncompleteSourceIds.add(sourceId);
      }
    }
  }

  return resetIncompleteSourceIds;
}

export function resolveConnectedConnectSourceConnections(
  sources: readonly Pick<ConnectSource, "id">[],
  settingsSources: readonly ConnectSettingsSourceMatch[],
): { connectionId: string | null; sourceId: string }[] {
  return resolveConnectSourceConnectionMatches(sources, settingsSources).map(
    (connection) => ({
      connectionId: connection.connectionId,
      sourceId: connection.sourceId,
    }),
  );
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
    const sourceState =
      source.state === "active" ||
      (options.includeReauthorizationRequired === true &&
        isReauthorizationRequiredConnectSourceState(source.state))
        ? source.state
        : null;
    const parentRequiresReconnect = isReauthorizationRequiredConnectSourceState(
      source.state,
    );
    const sourceRequiresReconnect = source.primaryAction?.kind === "reconnect";
    const requiresReconnect =
      sourceRequiresReconnect || parentRequiresReconnect;
    const connectionId =
      typeof source.connectionId === "string" && source.connectionId.trim()
        ? source.connectionId
        : null;
    const connectTarget =
      typeof source.connectTarget === "string" && source.connectTarget.trim()
        ? source.connectTarget
        : null;
    const hasJunctionUpstreamSources =
      provider === "junction" && source.upstreamSources.length > 0;
    const unambiguousJunctionReconnectUpstreamCount =
      hasJunctionUpstreamSources && sourceRequiresReconnect
        ? countLiveJunctionUpstreamSources(source.upstreamSources)
        : 0;

    const configuredSourceId = normalizeDeviceConnectSourceId(
      source.connectSourceId ?? null,
    );
    if (
      sourceState &&
      configuredSourceId &&
      visibleSourceIds.has(configuredSourceId) &&
      !hasJunctionUpstreamSources
    ) {
      upsertConnectSourceConnection(connectedConnections, {
        connectionId,
        connectProvider: provider,
        connectTarget,
        requiresReconnect,
        sourceId: configuredSourceId,
        state: sourceState,
      });
    }

    if (sourceState && provider) {
      const sourceId = sourceIdByDirectProvider.get(provider);
      if (sourceId) {
        upsertConnectSourceConnection(connectedConnections, {
          connectionId,
          connectProvider: provider,
          connectTarget,
          requiresReconnect,
          sourceId,
          state: sourceState,
        });
      }
    }

    if (provider !== "junction" || !sourceState) {
      continue;
    }

    const fitbitMigration = resolveFitbitMigrationConnectionState({
      connectionId,
      source,
      sourceState,
      visibleSourceIds,
    });
    if (fitbitMigration) {
      upsertConnectSourceConnection(connectedConnections, fitbitMigration);
    }

    for (const upstreamSource of source.upstreamSources) {
      if (!isDisconnectableJunctionUpstreamSource(upstreamSource)) {
        continue;
      }

      const upstreamNeedsConnectionReset =
        upstreamSource.recoveryKind === "connection_reset";
      const upstreamOwnRequiresReconnect =
        upstreamSource.requiresReconnect === true;
      const upstreamInheritsSourceReconnect =
        sourceRequiresReconnect &&
        unambiguousJunctionReconnectUpstreamCount === 1 &&
        isLiveJunctionUpstreamSource(upstreamSource);
      // A connection reset never offers reconnect: the existing connection has to be
      // disconnected before a fresh connect can restart the historical export.
      const upstreamRequiresReconnect =
        !upstreamNeedsConnectionReset &&
        (parentRequiresReconnect ||
          upstreamOwnRequiresReconnect ||
          upstreamInheritsSourceReconnect);
      const upstreamConnectProvider = upstreamSource.connectProvider
        ? normalizeDeviceSyncConnectTargetKey(upstreamSource.connectProvider)
        : provider;
      const upstreamConnectTarget =
        typeof upstreamSource.connectTarget === "string" &&
        upstreamSource.connectTarget.trim()
          ? upstreamSource.connectTarget
          : null;

      if (
        sourceState === "active" &&
        upstreamSource.status !== "connected" &&
        !upstreamRequiresReconnect &&
        !upstreamNeedsConnectionReset
      ) {
        continue;
      }

      const sourceProviderSlug = normalizeDeviceSyncConnectTargetKey(
        upstreamSource.sourceProviderSlug,
      );
      if (
        fitbitMigration &&
        (sourceProviderSlug === JUNCTION_FITBIT_LEGACY_PROVIDER_SLUG
          || sourceProviderSlug === JUNCTION_GOOGLE_HEALTH_PROVIDER_SLUG)
      ) {
        continue;
      }
      const sourceId = sourceProviderSlug
        ? resolveDeviceConnectSourceIdForJunctionProviderSlug(
            sourceProviderSlug,
          )
        : null;
      if (sourceId && visibleSourceIds.has(sourceId)) {
        upsertConnectSourceConnection(connectedConnections, {
          connectionId,
          connectProvider: upstreamRequiresReconnect
            ? upstreamConnectProvider
            : provider,
          connectTarget: upstreamRequiresReconnect
            ? upstreamConnectTarget
            : null,
          // Resetting always disconnects the whole shared Junction connection, so keep
          // the disconnect account-scoped even when this is its only source.
          ...(upstreamNeedsConnectionReset && connectionId
            ? { disconnectScope: "junction_account" as const }
            : {}),
          ...(!upstreamNeedsConnectionReset && sourceProviderSlug
            ? { disconnectSourceProviderSlug: sourceProviderSlug }
            : {}),
          ...(upstreamNeedsConnectionReset
            ? { recoveryKind: "connection_reset" as const }
            : {}),
          requiresReconnect: upstreamRequiresReconnect,
          sourceId,
          state: sourceState,
        });
      }
    }
  }

  return [...connectedConnections.values()];
}

function resolveFitbitMigrationConnectionState(input: {
  connectionId: string | null;
  source: ConnectSettingsSourceMatch;
  sourceState: ConnectSourceConnectionState["state"];
  visibleSourceIds: ReadonlySet<string>;
}): ConnectSourceConnectionState | null {
  if (!input.visibleSourceIds.has("fitbit")) {
    return null;
  }

  const legacy = input.source.upstreamSources.find(
    (source) =>
      normalizeDeviceSyncConnectTargetKey(source.sourceProviderSlug) === JUNCTION_FITBIT_LEGACY_PROVIDER_SLUG &&
      isUnfinishedFitbitLegacySource(source),
  );
  if (!legacy) {
    return null;
  }

  const successor = input.source.upstreamSources.find(
    (source) =>
      normalizeDeviceSyncConnectTargetKey(source.sourceProviderSlug) === JUNCTION_GOOGLE_HEALTH_PROVIDER_SLUG &&
      isLiveJunctionUpstreamSource(source),
  );
  const successorReady = successor?.status === "connected";
  const successorNeedsAuthorization =
    !successor ||
    successor.status === "error" ||
    successor.requiresReconnect === true;

  return {
    connectionId: input.connectionId,
    connectProvider: successorNeedsAuthorization
      ? normalizeDeviceSyncConnectTargetKey(legacy.connectProvider ?? "junction")
      : null,
    connectTarget: successorNeedsAuthorization
      ? legacy.connectTarget ?? "fitbit"
      : null,
    ...(successorReady ? { disconnectSourceProviderSlug: JUNCTION_FITBIT_LEGACY_PROVIDER_SLUG } : {}),
    ...(successorReady &&
      legacy.lastErrorCode === DEVICE_SYNC_GOOGLE_HEALTH_FITBIT_CUTOVER_FAILED_ERROR_CODE
      ? { migrationRetryRequired: true }
      : {}),
    migrationState: successorReady
      ? "cutover_ready"
      : successorNeedsAuthorization
        ? "authorization_required"
        : "verifying_successor",
    requiresReconnect: false,
    sourceId: "fitbit",
    state: input.sourceState,
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
  return (
    source.status === "connected" ||
    source.status === "error" ||
    source.requiresReconnect === true
  );
}

function isUnfinishedFitbitLegacySource(
  source: ConnectSettingsSourceMatch["upstreamSources"][number],
): boolean {
  if (isLiveJunctionUpstreamSource(source)) {
    return true;
  }
  if (source.status !== "disconnected") {
    return false;
  }
  return !isGoogleHealthFitbitMigrationLegacyTerminal(source);
}

function isDisconnectableJunctionUpstreamSource(
  source: ConnectSettingsSourceMatch["upstreamSources"][number],
): boolean {
  return source.status !== "disconnected" || source.requiresReconnect === true;
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

function connectSourceStatePriority(
  connection: ConnectSourceConnectionState,
): number {
  if (
    connection.state === "active" &&
    (connection.migrationState || connection.requiresReconnect || connection.recoveryKind)
  ) {
    return connection.migrationState ? 6 : 5;
  }

  if (connection.state === "active") {
    return 4;
  }

  return 2;
}

function isReauthorizationRequiredConnectSourceState(
  state:
    | HostedDeviceSyncSettingsSource["state"]
    | ConnectSourceConnectionState["state"],
): state is "reauthorization_required" {
  return state === "reauthorization_required";
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

export function readConnectSourceUi(connectSourceId: string): ConnectSourceUi | null {
  return Object.prototype.hasOwnProperty.call(
    CONNECT_SOURCE_UI,
    connectSourceId,
  )
    ? CONNECT_SOURCE_UI[connectSourceId as keyof typeof CONNECT_SOURCE_UI]
    : null;
}
