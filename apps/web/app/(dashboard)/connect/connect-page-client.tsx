"use client";

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
import type {
  MemberOwnedProviderSetupPresentation,
  MemberOwnedProviderSetupView,
} from "@/src/lib/device-sync/provider-setup/types";
import type { MurphContactOption } from "@/src/lib/murph-contact-routing";

import {
  ConnectDisconnectDialog,
  ConnectIntentRecoveryDialog,
  ConnectRedirectDialog,
  VitalConnectionDialog,
} from "./connect-page-dialogs";
import {
  createConnectCallbackNotice,
  filterConnectSourcesForSearch,
  isHostedDeviceConnectIntentUnavailableError,
  isHostedWhoopDirectConnectCapReachedError,
  markCallbackConnectedSource,
  markLocallyDisconnectedSources,
  readDeviceConnectIntentFromCurrentLocation,
  requestConnectionAuthorizationUrl,
  resolveCallbackSourceId,
  resolveConnectIntentRedirectSource,
  resolveConnectIntentStartSource,
  resolveMemberOwnedConnectIntentSource,
  resolveInitialConnectIntentPresentation,
  stripConnectCallbackParams,
  stripDeviceConnectIntentParams,
} from "./connect-page-helpers";
import {
  buildConnectSourceCardId,
  SourceCard,
} from "./connect-source-card";
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

interface MemberOwnedProviderSetupReadResponse {
  presentation: MemberOwnedProviderSetupPresentation;
  setup: MemberOwnedProviderSetupView | null;
}

interface MemberOwnedProviderSetupMutationResponse {
  presentation: MemberOwnedProviderSetupPresentation;
  setup: MemberOwnedProviderSetupView;
}

interface MemberOwnedProviderOAuthResponse {
  authorizationUrl: string;
  presentation: MemberOwnedProviderSetupPresentation;
  setup: MemberOwnedProviderSetupView;
}

interface MemberOwnedProviderHandoffResponse {
  handoffUrl: string;
}

const MEMBER_OWNED_SETUP_REVALIDATE_MS = 2_000;
const MEMBER_OWNED_SETUP_ACTIVE_STATUSES = new Set([
  "authorized",
  "browser_setup",
  "canceling",
]);

type ConnectStartOptions = {
  intentClaim?: string;
  preserveIntentDisclosure?: boolean;
  vitalDisclosureConfirmed?: boolean;
};

type VitalConnectionRequest = {
  intentClaim?: string;
  source: ConnectSource;
};

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
  const [pendingSourceIds, setPendingSourceIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [pendingDisconnectSourceId, setPendingDisconnectSourceId] = useState<
    string | null
  >(null);
  const [actionError, setActionError] = useState<{
    message: string;
    sourceId: string;
  } | null>(null);
  const [connectIntentRecovery, setConnectIntentRecovery] =
    useState<ConnectIntentRecoveryRequest | null>(null);
  const [vitalConnectionRequest, setVitalConnectionRequest] =
    useState<VitalConnectionRequest | null>(null);
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
  const [memberOwnedSetupBySourceId, setMemberOwnedSetupBySourceId] = useState<
    ReadonlyMap<string, MemberOwnedProviderSetupView | null>
  >(() => new Map(
    sources
      .filter((source) => Boolean(source.memberOwnedSetupProvider))
      .map((source) => [source.id, source.memberOwnedSetup ?? null] as const),
  ));
  const [locationConnectIntent] = useState<InitialDeviceConnectIntent>(() =>
    initialConnectIntent ? null : readDeviceConnectIntentFromCurrentLocation(),
  );
  const [initialConnectIntentDismissed, setInitialConnectIntentDismissed] =
    useState(false);
  const initialConnectIntentAuthOpenedRef = useRef(false);
  const initialConnectIntentAttemptedRef = useRef(false);
  const memberOwnedConnectIntentSubmittedRef = useRef<string | null>(null);
  const { openAuthDialog } = useAuth();
  const callbackConnectedSourceId =
    initialCallback?.status === "connected"
      ? resolveCallbackSourceId(initialCallback, sources)
      : null;
  const displaySources = useMemo(
    () =>
      sortConnectSourcesByConnectionState(
        markLocallyDisconnectedSources(
          markCallbackConnectedSource(
            sources.map((source) => source.memberOwnedSetupProvider
              ? {
                  ...source,
                  memberOwnedSetup:
                    memberOwnedSetupBySourceId.get(source.id)
                    ?? source.memberOwnedSetup
                    ?? null,
                }
              : source),
            callbackConnectedSourceId,
          ),
          disconnectedConnectionIds,
          disconnectedSourceIds,
        ).filter(
          (source) =>
            source.connectionAvailable !== false ||
            Boolean(source.setupGuideId) ||
            Boolean(source.unavailableActionUrl) ||
            Boolean(source.unavailableMessage) ||
            source.connected === true ||
            source.requiresReconnect === true ||
            Boolean(source.recoveryKind) ||
            source.historicalResetIncomplete === true,
        ),
      ),
    [
      callbackConnectedSourceId,
      disconnectedConnectionIds,
      disconnectedSourceIds,
      memberOwnedSetupBySourceId,
      sources,
    ],
  );
  const filteredSources = useMemo(
    () => filterConnectSourcesForSearch(displaySources, search),
    [displaySources, search],
  );
  const disconnectUnavailableSourceNames = useMemo(() => {
    if (
      disconnectSource?.disconnectScope !== "junction_account"
      || !disconnectSource.disconnectConnectionId
    ) {
      return [];
    }

    return displaySources
      .filter((source) =>
        source.disconnectConnectionId === disconnectSource.disconnectConnectionId
        && source.connectionAvailable === false
      )
      .map((source) => source.name);
  }, [disconnectSource, displaySources]);
  const hasInitialCallback = Boolean(initialCallback);
  const activeConnectIntent = initialConnectIntent ?? locationConnectIntent;
  const memberOwnedConnectIntentSource = useMemo(
    () =>
      initialConnectIntentDismissed
        ? null
        : resolveMemberOwnedConnectIntentSource(
            activeConnectIntent,
            displaySources,
            authenticated,
          ),
    [
      activeConnectIntent,
      authenticated,
      displaySources,
      initialConnectIntentDismissed,
    ],
  );
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
    return source && !requiresVitalConnectionPreflight(
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
    if (!memberOwnedConnectIntentSource) {
      return;
    }
    document
      .getElementById(buildConnectSourceCardId(memberOwnedConnectIntentSource.id))
      ?.focus();
  }, [memberOwnedConnectIntentSource]);

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

  const startMemberOwnedProviderSetup = useCallback(
    async (source: ConnectSource): Promise<void> => {
      const provider = source.memberOwnedSetupProvider;
      if (!provider) {
        return;
      }
      const current = memberOwnedSetupBySourceId.get(source.id)
        ?? source.memberOwnedSetup
        ?? null;
      const startOAuth = async () => {
        const oauth = await requestHostedOnboardingJson<MemberOwnedProviderOAuthResponse>({
          method: "POST",
          url: `/api/settings/device-sync/provider-setups/${encodeURIComponent(provider)}/oauth`,
        });
        setMemberOwnedSetupBySourceId((values) =>
          new Map(values).set(source.id, oauth.setup),
        );
        window.location.assign(oauth.authorizationUrl);
      };

      if (current?.action === "continue_oauth") {
        await startOAuth();
        return;
      }
      if (current?.action === "continue_handoff") {
        const handoff = await requestHostedOnboardingJson<
          MemberOwnedProviderHandoffResponse
        >({
          method: "PUT",
          payload: { setupId: current.setupId },
          url: `/api/settings/device-sync/provider-setups/${encodeURIComponent(provider)}`,
        });
        window.location.assign(handoff.handoffUrl);
        return;
      }

      const advanced = await requestHostedOnboardingJson<MemberOwnedProviderSetupMutationResponse>({
        method: "POST",
        url: `/api/settings/device-sync/provider-setups/${encodeURIComponent(provider)}`,
      });
      setMemberOwnedSetupBySourceId((values) =>
        new Map(values).set(source.id, advanced.setup),
      );
      if (advanced.setup.action === "continue_oauth") {
        await startOAuth();
      }
    },
    [memberOwnedSetupBySourceId],
  );

  useEffect(() => {
    if (!authenticated) {
      return;
    }
    const activeSources = sources.filter((source) => {
      const setup = memberOwnedSetupBySourceId.get(source.id)
        ?? source.memberOwnedSetup
        ?? null;
      return Boolean(
        source.memberOwnedSetupProvider
        && setup
        && setup.action === "none"
        && MEMBER_OWNED_SETUP_ACTIVE_STATUSES.has(setup.status),
      );
    });
    if (activeSources.length === 0) {
      return;
    }
    let stopped = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const revalidate = async () => {
      if (document.visibilityState !== "hidden") {
        await Promise.all(activeSources.map(async (source) => {
          const provider = source.memberOwnedSetupProvider;
          if (!provider) return;
          try {
            const projection = await requestHostedOnboardingJson<
              MemberOwnedProviderSetupReadResponse
            >({
              method: "GET",
              url: `/api/settings/device-sync/provider-setups/${encodeURIComponent(provider)}`,
            });
            if (!stopped) {
              setMemberOwnedSetupBySourceId((values) =>
                new Map(values).set(source.id, projection.setup),
              );
            }
          } catch {
            // The existing card state remains the safe retry surface.
          }
        }));
      }
      if (!stopped) {
        timeout = setTimeout(() => void revalidate(), MEMBER_OWNED_SETUP_REVALIDATE_MS);
      }
    };
    timeout = setTimeout(() => void revalidate(), MEMBER_OWNED_SETUP_REVALIDATE_MS);
    return () => {
      stopped = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [authenticated, memberOwnedSetupBySourceId, sources]);

  const cancelMemberOwnedProviderSetup = useCallback(
    async (source: ConnectSource): Promise<void> => {
      const provider = source.memberOwnedSetupProvider;
      const setupId = source.memberOwnedSetup?.setupId;
      if (!authenticated || !provider || !setupId) {
        return;
      }

      setActionError(null);
      setNotice(null);
      setPendingSourceIds((values) => addPendingSourceId(values, source.id));
      try {
        const canceled = await requestHostedOnboardingJson<
          MemberOwnedProviderSetupMutationResponse
        >({
          method: "DELETE",
          payload: { setupId },
          url: `/api/settings/device-sync/provider-setups/${encodeURIComponent(provider)}`,
        });
        setMemberOwnedSetupBySourceId((values) =>
          new Map(values).set(source.id, canceled.setup),
        );
      } catch (error) {
        setActionError({
          message: error instanceof Error
            ? error.message
            : "Private provider setup could not be canceled safely.",
          sourceId: source.id,
        });
      } finally {
        setPendingSourceIds((values) => removePendingSourceId(values, source.id));
      }
    },
    [authenticated],
  );

  const startConnection = useCallback(
    async (source: ConnectSource, options: ConnectStartOptions = {}) => {
      if (!authenticated || (!options.intentClaim && !source.connectTarget)) {
        return;
      }

      if (!options.preserveIntentDisclosure) {
        setInitialConnectIntentDismissed(true);
      }
      setActionError(null);
      setNotice(null);
      setConnectIntentRecovery(null);
      setShowWhoopAppleHealthSetupDialog(false);
      setActiveSetupGuideId(null);

      if (source.memberOwnedSetupProvider && !options.intentClaim) {
        setPendingSourceIds((values) => addPendingSourceId(values, source.id));
        try {
          await startMemberOwnedProviderSetup(source);
        } catch (error) {
          setActionError({
            message: error instanceof Error
              ? error.message
              : "Private provider setup could not continue.",
            sourceId: source.id,
          });
        } finally {
          setPendingSourceIds((values) => removePendingSourceId(values, source.id));
        }
        return;
      }

      if (
        requiresVitalConnectionPreflight(source) &&
        !options.vitalDisclosureConfirmed
      ) {
        setPendingSourceIds((values) => removePendingSourceId(values, source.id));
        setVitalConnectionRequest({
          ...(options.intentClaim ? { intentClaim: options.intentClaim } : {}),
          source,
        });
        return;
      }

      setVitalConnectionRequest(null);
      setPendingSourceIds((values) => addPendingSourceId(values, source.id));
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
          setInitialConnectIntentDismissed(true);
        }

        if (
          options.intentClaim &&
          isHostedDeviceConnectIntentUnavailableError(error)
        ) {
          setConnectIntentRecovery({
            message: error.message,
            sourceName: source.name,
          });
          setPendingSourceIds((values) => removePendingSourceId(values, source.id));
          return;
        }

        if (isHostedWhoopDirectConnectCapReachedError(error)) {
          setShowWhoopAppleHealthSetupDialog(true);
          setPendingSourceIds((values) => removePendingSourceId(values, source.id));
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
        setPendingSourceIds((values) => removePendingSourceId(values, source.id));
      }
    },
    [authenticated, startMemberOwnedProviderSetup],
  );

  const cancelMemberOwnedConnectIntent = useCallback(() => {
    initialConnectIntentAttemptedRef.current = true;
    stripDeviceConnectIntentParams();
    setInitialConnectIntentDismissed(true);
  }, []);

  const continueMemberOwnedConnectIntent = useCallback(() => {
    const claim = activeConnectIntent?.claim;
    const source = memberOwnedConnectIntentSource;
    if (
      !claim
      || !source
      || memberOwnedConnectIntentSubmittedRef.current === claim
    ) {
      return;
    }

    memberOwnedConnectIntentSubmittedRef.current = claim;
    initialConnectIntentAttemptedRef.current = true;
    stripDeviceConnectIntentParams();
    void startConnection(source, {
      intentClaim: claim,
      preserveIntentDisclosure: true,
    });
  }, [activeConnectIntent, memberOwnedConnectIntentSource, startConnection]);

  useEffect(() => {
    if (
      initialConnectIntentAttemptedRef.current ||
      !authenticated ||
      !activeConnectIntent?.claim
    ) {
      return;
    }

    if (
      resolveMemberOwnedConnectIntentSource(
        activeConnectIntent,
        displaySources,
        authenticated,
      )
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
    if (requiresVitalConnectionPreflight(
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
        setVitalConnectionRequest({
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
      pendingSourceIds.has(source.id)
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
      if (sourceProviderSlug) {
        setDisconnectedSourceIds((current) => new Set([...current, source.id]));
      } else {
        setDisconnectedConnectionIds(
          (current) => new Set([...current, connectionId]),
        );
      }
      let setupRefreshFailed = false;
      if (source.memberOwnedSetupProvider) {
        try {
          const refreshed =
            await requestHostedOnboardingJson<MemberOwnedProviderSetupReadResponse>({
              method: "GET",
              url: `/api/settings/device-sync/provider-setups/${encodeURIComponent(source.memberOwnedSetupProvider)}`,
            });
          setMemberOwnedSetupBySourceId((values) =>
            new Map(values).set(source.id, refreshed.setup),
          );
        } catch {
          // The disconnect already succeeded. Do not fabricate a setup state or
          // turn the completed upstream effect into a false failure.
          setupRefreshFailed = true;
        }
      }
      const warningDetail = result.warning?.message
        ? resolveDisconnectWarningDetail(result.warning)
        : setupRefreshFailed
          ? "Refresh this page to update the private application setup status."
          : null;
      setNotice({
        kind: warningDetail ? "warning" : "success",
        title: "Source disconnected",
        message: warningDetail
          ? `${resolveDisconnectSuccessMessage(source)} ${warningDetail}`
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
              pending={pendingSourceIds.has(source.id)}
              memberOwnedConnectIntentDisclosure={
                memberOwnedConnectIntentSource?.id === source.id
                  ? {
                      onCancel: cancelMemberOwnedConnectIntent,
                      onContinue: continueMemberOwnedConnectIntent,
                    }
                  : undefined
              }
              pendingDisconnect={pendingDisconnectSourceId === source.id}
              source={source}
              onCancelSetup={cancelMemberOwnedProviderSetup}
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

      <VitalConnectionDialog
        source={vitalConnectionRequest?.source ?? null}
        voiceMemoSrc={garminHistoricalDataVoiceMemoSrc}
        onOpenChange={(open) => {
          if (!open) {
            setVitalConnectionRequest(null);
          }
        }}
        onContinue={() => {
          const request = vitalConnectionRequest;
          if (!request) {
            return;
          }

          setVitalConnectionRequest(null);
          void startConnection(request.source, {
            vitalDisclosureConfirmed: true,
            ...(request.intentClaim
              ? { intentClaim: request.intentClaim }
              : {}),
          });
        }}
      />

      <ConnectDisconnectDialog
        affectedUnavailableSourceNames={disconnectUnavailableSourceNames}
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

export function requiresVitalConnectionPreflight(
  source: ConnectSource,
  connectIntentProvider?: string | null,
): boolean {
  if (connectIntentProvider) {
    return connectIntentProvider === "junction";
  }

  if (source.requiresReconnect) {
    return source.connectProvider === "junction";
  }

  return source.requiresVitalDisclosure === true;
}

function resolveDisconnectSuccessMessage(source: ConnectSource): string {
  return source.disconnectScope === "junction_account"
    ? "Disconnected this connection. Your history is still saved."
    : `Disconnected ${source.name}. Your history is still saved.`;
}

function resolveDisconnectFailureMessage(source: ConnectSource): string {
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

export function addPendingSourceId(
  values: ReadonlySet<string>,
  sourceId: string,
): ReadonlySet<string> {
  return new Set(values).add(sourceId);
}

export function removePendingSourceId(
  values: ReadonlySet<string>,
  sourceId: string,
): ReadonlySet<string> {
  const next = new Set(values);
  next.delete(sourceId);
  return next;
}
