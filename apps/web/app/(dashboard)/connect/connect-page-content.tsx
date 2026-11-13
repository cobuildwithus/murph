import {
  normalizeDeviceConnectSourceId,
  normalizeDeviceSyncConnectTargetKey,
} from "@murphai/device-syncd/connect-config";
import {
  listVisibleDeviceConnectSources,
  resolveConfiguredConnectSources,
  resolveConnectSourceConnectionStates,
  resolveHistoricalResetIncompleteConnectSourceIds,
  type ConnectSourceRecoveryKind,
  type ConnectSourceMigrationState,
  type ConnectSourceDisconnectScope,
} from "@/src/lib/device-sync/connect-sources";
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
import { resolveDeviceSyncVoiceMemoSources } from "@/src/lib/device-sync/device-sync-voice-memos";
import { isHostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";

import { ConnectSourcesGrid } from "./connect-page-client";
import { listHealthConnectRelayConnectSources } from "./health-connect-relay-connect-sources";
import type {
  ConnectCallbackInput,
  ConnectPageInitialLoadError,
  ConnectSource,
} from "./connect-page-types";

export {
  resolveConfiguredConnectSources,
  resolveConnectSourceConnectionStates,
  resolveConnectedConnectSourceConnections,
  resolveHistoricalResetIncompleteConnectSourceIds,
} from "@/src/lib/device-sync/connect-sources";

export type ConnectPageSearchParams = Record<
  string,
  string | string[] | undefined
>;

const CONNECTION_SOURCES: readonly ConnectSource[] = listVisibleDeviceConnectSources();

export default async function ConnectPage({
  searchParams,
}: {
  searchParams?: Promise<ConnectPageSearchParams>;
} = {}) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const auth = await getHostedDashboardPageAuthSnapshot();
  const memberId = auth.authenticatedMember?.id ?? null;
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
    chatContactAction,
    voiceMemoSources,
    whoopSyncContactAction,
    zeppSyncContactAction,
    appleHealthRelaySyncContactActions,
  ] = await Promise.all([
    resolveDeviceConnectRecoveryContactAction(
      Boolean(auth.authenticatedMember),
    ),
    resolveDeviceConnectChatContactAction(Boolean(auth.authenticatedMember)),
    resolveDeviceSyncVoiceMemoSources(memberId),
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
        key={memberId}
        authenticated={Boolean(auth.authenticatedMember)}
        deviceConnectChatContactAction={chatContactAction}
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

async function resolveDeviceConnectChatContactAction(authenticated: boolean) {
  if (!authenticated) {
    return null;
  }

  try {
    return await resolveHostedMurphContactOption();
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
