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
  isGoogleHealthFitbitMigrationSuccessorReady,
} from "@murphai/device-syncd/fitbit-migration";
import { PageHeader } from "@/src/components/ui/page-header";
import {
  resolveHostedMurphContactOption,
  resolveHostedMurphContactOptions,
} from "@/src/components/murph/hosted-murph-contact-action";
import {
  APPLE_HEALTH_RELAY_SETUP_GUIDE_IDS,
  readAppleHealthRelaySourceName,
  type AppleHealthRelaySetupGuideId,
} from "@/src/lib/device-sync/apple-health-relay-setup-guide";
import { buildHostedDeviceSyncSettingsResponse } from "@/src/lib/device-sync/settings-service";
import type { DeviceSyncCompletionContactAction } from "@/src/lib/device-sync/connect-completion-types";
import type { HostedDeviceSyncSettingsSource } from "@/src/lib/device-sync/settings-surface";
import { resolveDeviceSyncVoiceMemoSources } from "@/src/lib/device-sync/device-sync-voice-memos";
import { isHostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";

import { APPLE_HEALTH_RELAY_CONNECT_SOURCE_UI } from "./apple-health-relay-connect-sources";
import { ConnectSourcesGrid } from "./connect-page-client";
import { listHealthConnectRelayConnectSources } from "./health-connect-relay-connect-sources";
import { sortConnectSourcesByConnectionState } from "./connect-source-order";
import type {
  ConnectCallbackInput,
  ConnectPageInitialLoadError,
  ConnectSource,
  LogoAsset,
} from "./connect-page-types";

export type ConnectPageSearchParams = Record<
  string,
  string | string[] | undefined
>;

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
type ConnectSourceConnectionState = {
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

const MURPH_IOS_APP_STORE_URL =
  "https://apps.apple.com/us/app/murph-ai/id6786145859";
const DISPLAY_ONLY_CONNECT_SOURCE_IDS = new Set<string>([
  "apple-health",
  "coros",
  "huawei-health",
  "ringconn",
  "suunto",
  "xiaomi-mi-fitness",
  "zepp",
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
  whoop: {
    description: "Recovery, strain, sleep, and heart rate.",
    logo: logoAsset(
      "whoop.svg",
      "h-auto max-h-7 w-auto max-w-[8rem] object-contain",
      96,
      15,
    ),
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
    description:
      "Fitbit and Pixel Watch sleep, activity, heart rate, exercise, and workout trends through Google authorization.",
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

const CONNECTION_SOURCES: readonly ConnectSource[] = listVisibleDeviceConnectSources();

export default async function ConnectPage({
  searchParams,
}: {
  searchParams?: Promise<ConnectPageSearchParams>;
} = {}) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const auth = await getHostedDashboardPageAuthSnapshot();
  const connectedSourceIds = new Set<string>();
  const recoveryKindBySourceId = new Map<string, ConnectSourceRecoveryKind>();
  const reconnectSourceIds = new Set<string>();
  const reconnectProviderBySourceId = new Map<string, string>();
  const reconnectTargetBySourceId = new Map<string, string>();
  const disconnectConnectionIdBySourceId = new Map<string, string>();
  const disconnectScopeBySourceId = new Map<
    string,
    ConnectSourceDisconnectScope
  >();
  const disconnectSourceProviderSlugBySourceId = new Map<string, string>();
  const migrationStateBySourceId = new Map<string, ConnectSourceMigrationState>();
  const migrationRetrySourceIds = new Set<string>();
  let historicalResetIncompleteSourceIds = new Set<string>();
  let initialLoadError: ConnectPageInitialLoadError | null = null;
  const [
    recoveryContactAction,
    voiceMemoSources,
    whoopSyncContactAction,
    zeppSyncContactAction,
    appleHealthRelaySyncContactActions,
  ] = await Promise.all([
    resolveDeviceConnectRecoveryContactAction(
      Boolean(auth.authenticatedMember),
    ),
    resolveDeviceSyncVoiceMemoSources(auth.authenticatedMember?.id ?? null),
    resolveWhoopSyncContactAction(Boolean(auth.authenticatedMember)),
    resolveZeppSyncContactAction(Boolean(auth.authenticatedMember)),
    resolveAppleHealthRelaySyncContactActions(
      Boolean(auth.authenticatedMember),
    ),
  ]);

  if (auth.authenticatedMember) {
    try {
      const response = await buildHostedDeviceSyncSettingsResponse({
        member: auth.authenticatedMember,
      });
      for (const connection of resolveConnectSourceConnectionStates(
        CONNECTION_SOURCES,
        response.sources,
      )) {
        const sourceId = connection.sourceId;
        if (connection.recoveryKind) {
          recoveryKindBySourceId.set(sourceId, connection.recoveryKind);
        } else if (connection.requiresReconnect) {
          reconnectSourceIds.add(sourceId);
        } else if (connection.state === "active") {
          connectedSourceIds.add(sourceId);
        }
        if (connection.migrationState) {
          migrationStateBySourceId.set(sourceId, connection.migrationState);
          connectedSourceIds.delete(sourceId);
        }
        if (connection.migrationRetryRequired) {
          migrationRetrySourceIds.add(sourceId);
        }
        if (connection.connectionId) {
          disconnectConnectionIdBySourceId.set(
            sourceId,
            connection.connectionId,
          );
        }
        if (connection.disconnectScope) {
          disconnectScopeBySourceId.set(sourceId, connection.disconnectScope);
        }
        if (connection.disconnectSourceProviderSlug) {
          disconnectSourceProviderSlugBySourceId.set(
            sourceId,
            connection.disconnectSourceProviderSlug,
          );
        }
        if (
          connection.requiresReconnect ||
          connection.migrationState === "authorization_required"
        ) {
          if (connection.connectProvider) {
            reconnectProviderBySourceId.set(
              sourceId,
              connection.connectProvider,
            );
          }
          if (connection.connectTarget) {
            reconnectTargetBySourceId.set(sourceId, connection.connectTarget);
          }
        }
      }
      historicalResetIncompleteSourceIds =
        resolveHistoricalResetIncompleteConnectSourceIds(
          CONNECTION_SOURCES,
          response.sources,
        );
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

  const sources = [
    ...resolveConfiguredConnectSources(CONNECTION_SOURCES, {
      connectedSourceIds,
      disconnectConnectionIdBySourceId,
      disconnectScopeBySourceId,
      disconnectSourceProviderSlugBySourceId,
      historicalResetIncompleteSourceIds,
      migrationStateBySourceId,
      migrationRetrySourceIds,
      reconnectProviderBySourceId,
      reconnectSourceIds,
      reconnectTargetBySourceId,
      recoveryKindBySourceId,
    }),
    ...listHealthConnectRelayConnectSources(),
  ];

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
        garminHistoricalDataVoiceMemoSrc={voiceMemoSources.garminHistoricalData}
        initialCallback={resolveVerifiedInitialConnectCallback(
          resolvedSearchParams,
          sources,
        )}
        initialLoadError={initialLoadError}
        sources={sources}
        whoopSyncContactAction={whoopSyncContactAction}
        whoopSyncVoiceMemoSrc={voiceMemoSources.whoopSync}
        zeppSyncContactAction={zeppSyncContactAction}
        appleHealthRelaySyncContactActions={appleHealthRelaySyncContactActions}
      />
    </div>
  );
}

export function listVisibleConnectSources(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ConnectSource[] {
  return [
    ...listVisibleDeviceConnectSources(),
    ...listHealthConnectRelayConnectSources(env),
  ];
}

function listVisibleDeviceConnectSources(): ConnectSource[] {
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
            ...(ui.setupGuideActionLabel
              ? { setupGuideActionLabel: ui.setupGuideActionLabel }
              : {}),
            ...(ui.setupGuideId ? { setupGuideId: ui.setupGuideId } : {}),
            ...(ui.unavailableActionLabel
              ? { unavailableActionLabel: ui.unavailableActionLabel }
              : {}),
            ...(ui.unavailableActionUrl
              ? { unavailableActionUrl: ui.unavailableActionUrl }
              : {}),
            ...(ui.unavailableMessage
              ? { unavailableMessage: ui.unavailableMessage }
              : {}),
          },
        ]
      : [];
  });
}

async function resolveDeviceConnectRecoveryContactAction(
  authenticated: boolean,
) {
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

async function resolveWhoopSyncContactAction(
  authenticated: boolean,
): Promise<DeviceSyncCompletionContactAction | null> {
  return resolveAppleHealthRelayContactAction(
    authenticated,
    "Help me finish setting up WHOOP through Apple Health.",
  );
}

async function resolveZeppSyncContactAction(
  authenticated: boolean,
): Promise<DeviceSyncCompletionContactAction | null> {
  return resolveAppleHealthRelayContactAction(
    authenticated,
    "Help me set up Zepp/Amazfit through Apple Health. Please walk me through it with a voice memo.",
  );
}

type AppleHealthRelaySyncContactActions = Partial<
  Record<AppleHealthRelaySetupGuideId, DeviceSyncCompletionContactAction | null>
>;

async function resolveAppleHealthRelaySyncContactActions(
  authenticated: boolean,
): Promise<AppleHealthRelaySyncContactActions> {
  if (!authenticated) {
    return {};
  }

  const entries = await Promise.all(
    APPLE_HEALTH_RELAY_SETUP_GUIDE_IDS.map(
      async (setupGuideId) =>
        [
          setupGuideId,
          await resolveAppleHealthRelayContactAction(
            authenticated,
            `Help me set up ${readAppleHealthRelaySourceName(setupGuideId)} through Apple Health. Please walk me through it with a voice memo.`,
          ),
        ] as const,
    ),
  );

  return Object.fromEntries(entries);
}

async function resolveAppleHealthRelayContactAction(
  authenticated: boolean,
  messageBody: string,
): Promise<DeviceSyncCompletionContactAction | null> {
  if (!authenticated) {
    return null;
  }

  try {
    const options = await resolveHostedMurphContactOptions({
      message: {
        body: messageBody,
      },
    });
    const option = options.find(
      (candidate) => candidate.kind === "text" || candidate.kind === "telegram",
    );

    if (!option || option.kind === "email") {
      return null;
    }

    return {
      href: option.href,
      kind: option.kind === "text" ? "imessage" : "telegram",
      label: "Text Murph",
      ...(option.rel ? { rel: option.rel } : {}),
      ...(option.target ? { target: option.target } : {}),
    };
  } catch {
    return null;
  }
}

function isVisibleConnectSource(
  source: (typeof DEVICE_CONNECT_SOURCES)[number],
): boolean {
  return (
    DISPLAY_ONLY_CONNECT_SOURCE_IDS.has(source.connectSourceId) ||
    source.routes.some(
      (route) => route.kind === "direct" || route.kind === "junction_link",
    )
  );
}

export function resolveConfiguredConnectSources(
  sources: readonly ConnectSource[],
  options: {
    connectedSourceIds?: ReadonlySet<string>;
    disconnectConnectionIdBySourceId?: ReadonlyMap<string, string>;
    disconnectScopeBySourceId?: ReadonlyMap<
      string,
      ConnectSourceDisconnectScope
    >;
    disconnectSourceProviderSlugBySourceId?: ReadonlyMap<string, string>;
    historicalResetIncompleteSourceIds?: ReadonlySet<string>;
    migrationStateBySourceId?: ReadonlyMap<string, ConnectSourceMigrationState>;
    migrationRetrySourceIds?: ReadonlySet<string>;
    reconnectProviderBySourceId?: ReadonlyMap<string, string>;
    reconnectSourceIds?: ReadonlySet<string>;
    reconnectTargetBySourceId?: ReadonlyMap<string, string>;
    recoveryKindBySourceId?: ReadonlyMap<string, ConnectSourceRecoveryKind>;
  } = {},
): ConnectSource[] {
  const connectConfigBySourceId = new Map(
    listConfiguredDeviceSyncConnectTargets(
      readConfiguredDeviceSyncConnectTargetConfigs(process.env),
    ).map((target) => [target.connectSourceId, target] as const),
  );

  return sortConnectSourcesByConnectionState(
    sources.map((source) => {
      const connectionAvailable = isDeviceConnectSourceAvailableForConnection(
        source.id,
      );
      const connectConfig = connectConfigBySourceId.get(source.id);
      const migrationState = options.migrationStateBySourceId?.get(source.id);
      const connected =
        !migrationState && options.connectedSourceIds?.has(source.id) === true;
      const recoveryKind = !connected
        ? options.recoveryKindBySourceId?.get(source.id)
        : undefined;
      const requiresReconnect =
        !connected &&
        !recoveryKind &&
        options.reconnectSourceIds?.has(source.id) === true;
      const historicalResetIncomplete =
        !connected &&
        !recoveryKind &&
        !requiresReconnect &&
        options.historicalResetIncompleteSourceIds?.has(source.id) === true;
      const disconnectConnectionId =
        options.disconnectConnectionIdBySourceId?.get(source.id);
      const disconnectScope = options.disconnectScopeBySourceId?.get(source.id);
      const disconnectSourceProviderSlug =
        options.disconnectSourceProviderSlugBySourceId?.get(source.id);
      const reconnectProvider = options.reconnectProviderBySourceId?.get(
        source.id,
      );
      const reconnectTarget = options.reconnectTargetBySourceId?.get(source.id);
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
        ...(options.migrationRetrySourceIds?.has(source.id)
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

export function resolveConnectedConnectSourceIds(
  sources: readonly Pick<ConnectSource, "id">[],
  settingsSources: readonly Pick<
    HostedDeviceSyncSettingsSource,
    "provider" | "state" | "upstreamSources"
  >[],
): Set<string> {
  return new Set(
    resolveConnectedConnectSourceConnections(sources, settingsSources).map(
      (connection) => connection.sourceId,
    ),
  );
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
  const successorReady = successor
    && successor.fitbitMigrationCoverageReady === true
    ? isGoogleHealthFitbitMigrationSuccessorReady({
        firstSeenAt: successor.firstSeenAt,
        historicalBackfillComplete: successor.historicalBackfillComplete === true,
        lastDataAt: successor.lastDataAt,
        resourceCount: successor.resourceCount,
        status: successor.status,
      })
    : false;
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
      ? legacy.connectTarget ?? null
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

function resolveInitialConnectCallback(
  searchParams: ConnectPageSearchParams,
): ConnectCallbackInput {
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
    ? sources.some(
        (source) =>
          source.id === callbackSourceId &&
          (source.connected === true ||
            source.migrationState === "verifying_successor" ||
            source.migrationState === "cutover_ready"),
      )
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
  const target = input.connectTarget
    ? normalizeDeviceSyncConnectTargetKey(input.connectTarget)
    : null;
  const provider = input.provider
    ? normalizeDeviceSyncConnectTargetKey(input.provider)
    : null;

  return (
    input.sources.find((candidate) => {
      const sourceTarget = candidate.connectTarget
        ? normalizeDeviceSyncConnectTargetKey(candidate.connectTarget)
        : null;
      const sourceId = normalizeDeviceSyncConnectTargetKey(candidate.id);
      const normalizedSourceId = normalizeDeviceConnectSourceId(candidate.id);

      return Boolean(
        (source && normalizedSourceId === source) ||
          (target && (sourceTarget === target || sourceId === target)) ||
          (provider && (sourceTarget === provider || sourceId === provider)),
      );
    })?.id ?? null
  );
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
  return Object.prototype.hasOwnProperty.call(
    CONNECT_SOURCE_UI,
    connectSourceId,
  )
    ? CONNECT_SOURCE_UI[connectSourceId as keyof typeof CONNECT_SOURCE_UI]
    : null;
}
