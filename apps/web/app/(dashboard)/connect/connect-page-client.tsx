"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";
import { useAuth } from "@/src/components/hosted-onboarding/auth-dialog-provider";
import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { ConnectCallbackErrorNotice } from "@/src/components/device-sync/connect-callback-error-notice";
import { Input } from "@/src/components/ui/input";
import { DeviceSyncSetupGuideDialog } from "@/app/(dashboard)/home/device-sync-completion-dialog";
import type { DeviceSyncCompletionContactAction } from "@/src/lib/device-sync/connect-completion-types";
import {
  buildAppleHealthRelaySetupGuide,
  isAppleHealthRelaySetupGuideId,
  type AppleHealthRelaySetupGuideId,
} from "@/src/lib/device-sync/apple-health-relay-setup-guide";
import { buildWhoopAppleHealthSetupGuide } from "@/src/lib/device-sync/whoop-apple-health-setup-guide";
import { buildZeppAppleHealthSetupGuide } from "@/src/lib/device-sync/zepp-apple-health-setup-guide";
import type { MurphContactOption } from "@/src/lib/murph-contact-routing";

import {
  ConnectDisconnectDialog,
  ConnectIntentRecoveryDialog,
  ConnectRedirectDialog,
  JunctionConnectionDialog,
} from "./connect-page-dialogs";
import {
  createConnectCallbackNotice,
  filterConnectSourcesForSearch,
  isHostedDeviceConnectIntentUnavailableError,
  isHostedWhoopDirectConnectCapReachedError,
  markCallbackConnectedSource,
  markLocallyCompletedFitbitMigrations,
  markLocallyDisconnectedSources,
  readDeviceConnectIntentFromCurrentLocation,
  requestConnectionAuthorizationUrl,
  resolveCallbackSourceId,
  resolveConnectIntentRedirectSource,
  resolveConnectIntentStartSource,
  resolveInitialConnectIntentPresentation,
  stripConnectCallbackParams,
  stripDeviceConnectIntentParams,
} from "./connect-page-helpers";
import { SourceCard } from "./connect-source-card";
import { sortConnectSourcesByConnectionState } from "./connect-source-order";
import type {
  ConnectCallbackInput,
  ConnectCallbackNotice,
  ConnectIntentRecoveryRequest,
  ConnectPageInitialLoadError,
  ConnectSource,
  ConnectSourceSetupGuideId,
  InitialDeviceConnectIntent,
} from "./connect-page-types";

interface HostedDeviceSyncDisconnectResponse {
  warning?: { historicalResetIncomplete?: boolean; message: string };
}

type ConnectStartOptions = {
  junctionDisclosureConfirmed?: boolean;
  intentClaim?: string;
};

type JunctionConnectionRequest = {
  intentClaim?: string;
  source: ConnectSource;
};

const FITBIT_MIGRATION_REFRESH_INTERVAL_MS = 15_000;
const FITBIT_MIGRATION_REFRESH_ATTEMPT_LIMIT = 12;

export type {
  ConnectCallbackInput,
  InitialDeviceConnectIntent,
} from "./connect-page-types";
export { filterConnectSourcesForSearch } from "./connect-page-helpers";

export function ConnectSourcesGrid({
  authenticated = true,
  appleHealthRelaySyncContactActions = {},
  deviceConnectRecoveryContactAction = null,
  garminHistoricalDataVoiceMemoSrc = null,
  initialCallback = null,
  initialConnectIntent = null,
  initialLoadError = null,
  sources,
  whoopSyncContactAction = null,
  whoopSyncVoiceMemoSrc = null,
  zeppSyncContactAction = null,
}: {
  authenticated?: boolean;
  appleHealthRelaySyncContactActions?: Partial<
    Record<
      AppleHealthRelaySetupGuideId,
      DeviceSyncCompletionContactAction | null
    >
  >;
  deviceConnectRecoveryContactAction?: MurphContactOption | null;
  garminHistoricalDataVoiceMemoSrc?: string | null;
  initialCallback?: ConnectCallbackInput;
  initialConnectIntent?: InitialDeviceConnectIntent;
  initialLoadError?: ConnectPageInitialLoadError | null;
  sources: readonly ConnectSource[];
  whoopSyncContactAction?: DeviceSyncCompletionContactAction | null;
  whoopSyncVoiceMemoSrc?: string | null;
  zeppSyncContactAction?: DeviceSyncCompletionContactAction | null;
}) {
  const [notice, setNotice] = useState<ConnectCallbackNotice>(() =>
    createConnectCallbackNotice(initialCallback, sources),
  );
  const [search, setSearch] = useState("");
  const [pendingSourceId, setPendingSourceId] = useState<string | null>(null);
  const [pendingDisconnectSourceId, setPendingDisconnectSourceId] = useState<
    string | null
  >(null);
  const [actionError, setActionError] = useState<{
    message: string;
    sourceId: string;
  } | null>(null);
  const [connectIntentRecovery, setConnectIntentRecovery] =
    useState<ConnectIntentRecoveryRequest | null>(null);
  const [junctionConnectionRequest, setJunctionConnectionRequest] =
    useState<JunctionConnectionRequest | null>(null);
  const [showWhoopAppleHealthSetupDialog, setShowWhoopAppleHealthSetupDialog] =
    useState(false);
  const [activeSetupGuideId, setActiveSetupGuideId] =
    useState<ConnectSourceSetupGuideId | null>(null);
  const [disconnectSource, setDisconnectSource] =
    useState<ConnectSource | null>(null);
  const [disconnectedConnectionIds, setDisconnectedConnectionIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [disconnectedSourceIds, setDisconnectedSourceIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [completedMigrationSourceIds, setCompletedMigrationSourceIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [locationConnectIntent] = useState<InitialDeviceConnectIntent>(() =>
    initialConnectIntent ? null : readDeviceConnectIntentFromCurrentLocation(),
  );
  const [initialConnectIntentDismissed, setInitialConnectIntentDismissed] =
    useState(false);
  const initialConnectIntentAuthOpenedRef = useRef(false);
  const initialConnectIntentAttemptedRef = useRef(false);
  const fitbitMigrationRefreshAttemptsRef = useRef(0);
  const router = useRouter();
  const { openAuthDialog } = useAuth();
  const callbackConnectedSourceId =
    initialCallback?.status === "connected"
      ? resolveCallbackSourceId(initialCallback, sources)
      : null;
  const displaySources = useMemo(
    () =>
      sortConnectSourcesByConnectionState(
        markLocallyCompletedFitbitMigrations(
          markLocallyDisconnectedSources(
            markCallbackConnectedSource(sources, callbackConnectedSourceId),
            disconnectedConnectionIds,
            disconnectedSourceIds,
          ),
          completedMigrationSourceIds,
        ).filter(
          (source) =>
            source.connectionAvailable !== false ||
            Boolean(source.setupGuideId) ||
            Boolean(source.unavailableActionUrl) ||
            source.connected === true ||
            source.requiresReconnect === true ||
            Boolean(source.recoveryKind) ||
            source.historicalResetIncomplete === true,
        ),
      ),
    [
      callbackConnectedSourceId,
      completedMigrationSourceIds,
      disconnectedConnectionIds,
      disconnectedSourceIds,
      sources,
    ],
  );
  const filteredSources = useMemo(
    () => filterConnectSourcesForSearch(displaySources, search),
    [displaySources, search],
  );
  const hasVerifyingFitbitMigration = useMemo(
    () =>
      displaySources.some(
        (source) =>
          source.id === "fitbit" &&
          source.migrationState === "verifying_successor",
      ),
    [displaySources],
  );
  const hasInitialCallback = Boolean(initialCallback);
  const activeConnectIntent = initialConnectIntent ?? locationConnectIntent;
  const initialConnectIntentPresentation = useMemo(
    () =>
      initialConnectIntentDismissed || !authenticated
        ? null
        : resolveInitialConnectIntentPresentation(
            activeConnectIntent,
            displaySources,
          ),
    [
      activeConnectIntent,
      authenticated,
      displaySources,
      initialConnectIntentDismissed,
    ],
  );
  const visibleNotice =
    notice ?? initialConnectIntentPresentation?.notice ?? null;
  const visibleActionError =
    actionError ?? initialConnectIntentPresentation?.actionError ?? null;
  const activeAppleHealthRelaySetupGuide = isAppleHealthRelaySetupGuideId(
    activeSetupGuideId,
  )
    ? buildAppleHealthRelaySetupGuide(activeSetupGuideId)
    : null;
  const activeAppleHealthRelayContactAction = isAppleHealthRelaySetupGuideId(
    activeSetupGuideId,
  )
    ? (appleHealthRelaySyncContactActions[activeSetupGuideId] ?? null)
    : null;
  // When this load carries a connect intent that the effect below will auto-redirect, show a
  // pending-redirect dialog. Seeded on mount and cleared only if that redirect attempt fails.
  const [connectIntentRedirectName, setConnectIntentRedirectName] = useState<
    string | null
  >(() => {
    const source = resolveConnectIntentRedirectSource(
      activeConnectIntent,
      displaySources,
      authenticated,
    );
    return source && !requiresJunctionConnectionPreflight(
      source,
      activeConnectIntent?.connectProvider,
    )
      ? source.name
      : null;
  });

  useEffect(() => {
    if (hasInitialCallback) {
      stripConnectCallbackParams();
    }
  }, [hasInitialCallback]);

  useEffect(() => {
    if (!hasVerifyingFitbitMigration) {
      fitbitMigrationRefreshAttemptsRef.current = 0;
      return;
    }

    const intervalId = window.setInterval(() => {
      const nextAttempt = fitbitMigrationRefreshAttemptsRef.current + 1;
      fitbitMigrationRefreshAttemptsRef.current = nextAttempt;
      router.refresh();

      if (nextAttempt >= FITBIT_MIGRATION_REFRESH_ATTEMPT_LIMIT) {
        window.clearInterval(intervalId);
        setNotice((current) =>
          current ?? {
            kind: "warning",
            title: "Fitbit migration is still verifying",
            message:
              "Google Health is authorized, but Murph has not seen a fresh supported update yet. Keep legacy Fitbit connected and check back after your next Fitbit or Pixel Watch sync.",
          },
        );
      }
    }, FITBIT_MIGRATION_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [hasVerifyingFitbitMigration, router]);

  useEffect(() => {
    if (
      authenticated ||
      initialConnectIntentAuthOpenedRef.current ||
      !activeConnectIntent?.claim
    ) {
      return;
    }

    const source = resolveConnectIntentStartSource(
      activeConnectIntent,
      displaySources,
    );
    if (!source) {
      return;
    }

    initialConnectIntentAuthOpenedRef.current = true;
    openAuthDialog();
  }, [activeConnectIntent, authenticated, displaySources, openAuthDialog]);

  const startConnection = useCallback(
    async (source: ConnectSource, options: ConnectStartOptions = {}) => {
      if (!authenticated || (!options.intentClaim && !source.connectTarget)) {
        return;
      }

      setInitialConnectIntentDismissed(true);
      setActionError(null);
      setNotice(null);
      setConnectIntentRecovery(null);
      setShowWhoopAppleHealthSetupDialog(false);
      setActiveSetupGuideId(null);

      if (
        requiresJunctionConnectionPreflight(source) &&
        !options.junctionDisclosureConfirmed
      ) {
        setPendingSourceId(null);
        setJunctionConnectionRequest({
          ...(options.intentClaim ? { intentClaim: options.intentClaim } : {}),
          source,
        });
        return;
      }

      setJunctionConnectionRequest(null);
      setPendingSourceId(source.id);
      if (options.intentClaim) {
        setConnectIntentRedirectName(source.name);
      }

      try {
        const authorizationUrl = await requestConnectionAuthorizationUrl(
          source,
          {
            ...(options.intentClaim
              ? { intentClaim: options.intentClaim }
              : {}),
          },
        );
        window.location.assign(authorizationUrl);
      } catch (error) {
        if (options.intentClaim) {
          setConnectIntentRedirectName(null);
        }

        if (
          options.intentClaim &&
          isHostedDeviceConnectIntentUnavailableError(error)
        ) {
          setConnectIntentRecovery({
            message: error.message,
            sourceName: source.name,
          });
          setPendingSourceId(null);
          return;
        }

        if (isHostedWhoopDirectConnectCapReachedError(error)) {
          setShowWhoopAppleHealthSetupDialog(true);
          setPendingSourceId(null);
          return;
        }

        const message =
          error instanceof Error
            ? error.message
            : "Connection could not be started.";
        setActionError({
          message,
          sourceId: source.id,
        });
        setPendingSourceId(null);
      }
    },
    [authenticated],
  );

  useEffect(() => {
    if (
      initialConnectIntentAttemptedRef.current ||
      !authenticated ||
      !activeConnectIntent?.claim
    ) {
      return;
    }

    const source = resolveConnectIntentRedirectSource(
      activeConnectIntent,
      displaySources,
      authenticated,
    );
    if (!source) {
      initialConnectIntentAttemptedRef.current = true;
      stripDeviceConnectIntentParams();
      return;
    }

    let cancelled = false;
    if (requiresJunctionConnectionPreflight(
      source,
      activeConnectIntent.connectProvider,
    )) {
      void Promise.resolve().then(() => {
        if (cancelled || initialConnectIntentAttemptedRef.current) {
          return;
        }

        initialConnectIntentAttemptedRef.current = true;
        stripDeviceConnectIntentParams();
        setConnectIntentRedirectName(null);
        setInitialConnectIntentDismissed(true);
        setJunctionConnectionRequest({
          intentClaim: activeConnectIntent.claim,
          source,
        });
      });
      return () => {
        cancelled = true;
      };
    }

    initialConnectIntentAttemptedRef.current = true;
    stripDeviceConnectIntentParams();
    void requestConnectionAuthorizationUrl(source, {
      intentClaim: activeConnectIntent.claim,
    })
      .then((authorizationUrl) => {
        if (cancelled) {
          return;
        }

        setInitialConnectIntentDismissed(true);
        window.location.assign(authorizationUrl);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        setConnectIntentRedirectName(null);
        setInitialConnectIntentDismissed(true);
        if (isHostedWhoopDirectConnectCapReachedError(error)) {
          setShowWhoopAppleHealthSetupDialog(true);
          return;
        }

        if (isHostedDeviceConnectIntentUnavailableError(error)) {
          setConnectIntentRecovery({
            message: error.message,
            sourceName: source.name,
          });
          return;
        }

        const message =
          error instanceof Error
            ? error.message
            : "Connection could not be started.";
        setActionError({
          message,
          sourceId: source.id,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [activeConnectIntent, authenticated, displaySources]);

  async function disconnectConnection(source: ConnectSource) {
    const connectionId = source.disconnectConnectionId?.trim();
    if (
      !connectionId ||
      pendingDisconnectSourceId ||
      pendingSourceId === source.id
    ) {
      return;
    }

    setPendingDisconnectSourceId(source.id);
    setActionError(null);
    setNotice(null);

    try {
      const sourceProviderSlug = source.disconnectSourceProviderSlug?.trim();
      const disconnectUrl = sourceProviderSlug
        ? `/api/settings/device-sync/connections/${encodeURIComponent(connectionId)}/sources/${encodeURIComponent(sourceProviderSlug)}/disconnect`
        : `/api/settings/device-sync/connections/${encodeURIComponent(connectionId)}/disconnect`;
      const result =
        await requestHostedOnboardingJson<HostedDeviceSyncDisconnectResponse>({
          method: "POST",
          url: disconnectUrl,
        });
      setDisconnectSource(null);
      if (source.migrationState === "cutover_ready") {
        setCompletedMigrationSourceIds(
          (current) => new Set([...current, source.id]),
        );
      } else if (sourceProviderSlug) {
        setDisconnectedSourceIds((current) => new Set([...current, source.id]));
      } else {
        setDisconnectedConnectionIds(
          (current) => new Set([...current, connectionId]),
        );
      }
      setNotice({
        kind: result.warning?.message ? "warning" : "success",
        title: source.migrationState === "cutover_ready"
          ? "Fitbit migration complete"
          : "Source disconnected",
        message: result.warning?.message
          ? `${resolveDisconnectSuccessMessage(source)} ${resolveDisconnectWarningDetail(result.warning)}`
          : resolveDisconnectSuccessMessage(source),
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : resolveDisconnectFailureMessage(source);
      setActionError({
        message,
        sourceId: source.id,
      });
    } finally {
      setPendingDisconnectSourceId(null);
    }
  }

  return (
    <section className="flex min-w-0 flex-col gap-4">
      {initialLoadError?.message ? (
        <Alert variant="destructive">
          <AlertTitle>Unable to load connected sources</AlertTitle>
          <AlertDescription>{initialLoadError.message}</AlertDescription>
        </Alert>
      ) : null}

      {visibleNotice ? (
        visibleNotice.kind === "success" ? (
          <Alert className="border-emerald-200 bg-emerald-50 text-emerald-900">
            <AlertTitle>{visibleNotice.title}</AlertTitle>
            <AlertDescription>{visibleNotice.message}</AlertDescription>
          </Alert>
        ) : visibleNotice.kind === "warning" ? (
          <Alert className="border-amber-200 bg-amber-50 text-amber-900">
            <AlertTitle>{visibleNotice.title}</AlertTitle>
            <AlertDescription>{visibleNotice.message}</AlertDescription>
          </Alert>
        ) : (
          <ConnectCallbackErrorNotice
            errorCode={visibleNotice.errorCode}
            message={visibleNotice.message}
            onSignIn={
              !authenticated &&
              visibleNotice.errorCode === "CALLBACK_SESSION_REQUIRED"
                ? openAuthDialog
                : null
            }
            sourceLabel={visibleNotice.sourceLabel}
            title={visibleNotice.title}
          />
        )
      ) : null}

      <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground">
            Sources
          </p>
          <p className="mt-1 text-xs tabular-nums text-muted-foreground">
            {filteredSources.length} of {displaySources.length} sources
          </p>
        </div>
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search sources"
          aria-label="Search sources"
          className="w-full sm:w-64"
        />
      </div>

      {filteredSources.length === 0 ? (
        <Alert>
          <AlertTitle>No sources matched</AlertTitle>
          <AlertDescription>
            Try a different search to get back to the full source list.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-2 xl:grid-cols-4">
          {filteredSources.map((source) => (
            <SourceCard
              key={source.id}
              authenticated={authenticated}
              errorMessage={
                visibleActionError?.sourceId === source.id
                  ? visibleActionError.message
                  : null
              }
              pending={pendingSourceId === source.id}
              pendingDisconnect={pendingDisconnectSourceId === source.id}
              source={source}
              onDisconnectTargetChange={setDisconnectSource}
              onSetupGuideOpen={setActiveSetupGuideId}
              onStartConnection={startConnection}
            />
          ))}
        </div>
      )}

      <DeviceSyncSetupGuideDialog
        contactAction={whoopSyncContactAction}
        guide={buildWhoopAppleHealthSetupGuide(whoopSyncVoiceMemoSrc)}
        open={showWhoopAppleHealthSetupDialog}
        onOpenChange={setShowWhoopAppleHealthSetupDialog}
      />

      <DeviceSyncSetupGuideDialog
        contactAction={zeppSyncContactAction}
        guide={buildZeppAppleHealthSetupGuide()}
        open={activeSetupGuideId === "zepp-apple-health"}
        onOpenChange={(open) => {
          if (!open) {
            setActiveSetupGuideId(null);
          }
        }}
      />

      {activeAppleHealthRelaySetupGuide ? (
        <DeviceSyncSetupGuideDialog
          contactAction={activeAppleHealthRelayContactAction}
          guide={activeAppleHealthRelaySetupGuide}
          open
          onOpenChange={(open) => {
            if (!open) {
              setActiveSetupGuideId(null);
            }
          }}
        />
      ) : null}

      <JunctionConnectionDialog
        source={junctionConnectionRequest?.source ?? null}
        voiceMemoSrc={garminHistoricalDataVoiceMemoSrc}
        onOpenChange={(open) => {
          if (!open) {
            setJunctionConnectionRequest(null);
          }
        }}
        onContinue={() => {
          const request = junctionConnectionRequest;
          if (!request) {
            return;
          }

          setJunctionConnectionRequest(null);
          void startConnection(request.source, {
            junctionDisclosureConfirmed: true,
            ...(request.intentClaim
              ? { intentClaim: request.intentClaim }
              : {}),
          });
        }}
      />

      <ConnectDisconnectDialog
        errorMessage={
          disconnectSource && actionError?.sourceId === disconnectSource.id
            ? actionError.message
            : null
        }
        pending={Boolean(
          disconnectSource && pendingDisconnectSourceId === disconnectSource.id,
        )}
        source={disconnectSource}
        onConfirm={disconnectConnection}
        onOpenChange={(open) => {
          if (!open && !pendingDisconnectSourceId) {
            setDisconnectSource(null);
          }
        }}
      />

      <ConnectRedirectDialog sourceName={connectIntentRedirectName} />

      <ConnectIntentRecoveryDialog
        contactAction={deviceConnectRecoveryContactAction}
        request={connectIntentRecovery}
        onOpenChange={(open) => {
          if (!open) {
            setConnectIntentRecovery(null);
          }
        }}
      />
    </section>
  );
}

export function requiresJunctionConnectionPreflight(
  source: ConnectSource,
  connectIntentProvider?: string | null,
): boolean {
  if (connectIntentProvider) {
    return connectIntentProvider === "junction";
  }

  if (source.requiresReconnect) {
    return source.connectProvider === "junction";
  }

  return source.requiresJunctionDisclosure === true;
}

function resolveDisconnectSuccessMessage(source: ConnectSource): string {
  if (source.migrationState === "cutover_ready") {
    return "Fitbit now uses Google Health. Your history is still saved.";
  }

  return source.disconnectScope === "junction_account"
    ? "Disconnected this connection. Your history is still saved."
    : `Disconnected ${source.name}. Your history is still saved.`;
}

function resolveDisconnectFailureMessage(source: ConnectSource): string {
  if (source.migrationState === "cutover_ready") {
    return "We could not finish the Fitbit migration right now. The legacy Fitbit connection was not changed.";
  }

  return source.disconnectScope === "junction_account"
    ? "We could not disconnect this connection right now."
    : `We could not disconnect ${source.name} right now.`;
}

// Keyed off the response semantic, not the clicked card: a shared connection can be
// disconnected from a healthy sibling card while the historical reset lives elsewhere.
function resolveDisconnectWarningDetail(warning: {
  historicalResetIncomplete?: boolean;
}): string {
  return warning.historicalResetIncomplete
    ? "The historical reset did not finish. Remove the old connection in your wearable provider account before reconnecting here."
    : "The provider did not fully confirm, so check that account if you want access removed there too.";
}
