"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  requestHostedOnboardingJson,
} from "@/src/components/hosted-onboarding/client-api";
import { useAuth } from "@/src/components/hosted-onboarding/auth-dialog-provider";
import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Input } from "@/src/components/ui/input";
import type { MurphContactOption } from "@/src/lib/murph-contact-routing";

import {
  ConnectConsentDialog,
  ConnectDisconnectDialog,
  ConnectIntentRecoveryDialog,
  ConnectRedirectDialog,
} from "./connect-page-dialogs";
import {
  createConnectCallbackNotice,
  filterConnectSourcesForSearch,
  isHostedConsentRequiredError,
  isHostedDeviceConnectIntentUnavailableError,
  markCallbackConnectedSource,
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
  ConnectConsentRequest,
  ConnectIntentRecoveryRequest,
  ConnectPageInitialLoadError,
  ConnectSource,
  InitialDeviceConnectIntent,
} from "./connect-page-types";

interface HostedDeviceSyncDisconnectResponse {
  warning?: { code: string; message: string };
}

export type { ConnectCallbackInput, InitialDeviceConnectIntent } from "./connect-page-types";
export { filterConnectSourcesForSearch } from "./connect-page-helpers";

export function ConnectSourcesGrid({
  authenticated = true,
  deviceConnectRecoveryContactAction = null,
  initialCallback = null,
  initialConnectIntent = null,
  initialLoadError = null,
  sources,
}: {
  authenticated?: boolean;
  deviceConnectRecoveryContactAction?: MurphContactOption | null;
  initialCallback?: ConnectCallbackInput;
  initialConnectIntent?: InitialDeviceConnectIntent;
  initialLoadError?: ConnectPageInitialLoadError | null;
  sources: readonly ConnectSource[];
}) {
  const [notice, setNotice] = useState<ConnectCallbackNotice>(() =>
    createConnectCallbackNotice(initialCallback, sources),
  );
  const [search, setSearch] = useState("");
  const [pendingSourceId, setPendingSourceId] = useState<string | null>(null);
  const [pendingDisconnectSourceId, setPendingDisconnectSourceId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{
    message: string;
    sourceId: string;
  } | null>(null);
  const [consentRequest, setConsentRequest] = useState<ConnectConsentRequest | null>(null);
  const [connectIntentRecovery, setConnectIntentRecovery] =
    useState<ConnectIntentRecoveryRequest | null>(null);
  const [disconnectSource, setDisconnectSource] = useState<ConnectSource | null>(null);
  const [disconnectedConnectionIds, setDisconnectedConnectionIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [locationConnectIntent] = useState<InitialDeviceConnectIntent>(() => (
    initialConnectIntent ? null : readDeviceConnectIntentFromCurrentLocation()
  ));
  const [initialConnectIntentDismissed, setInitialConnectIntentDismissed] = useState(false);
  const initialConnectIntentAuthOpenedRef = useRef(false);
  const initialConnectIntentAttemptedRef = useRef(false);
  const { openAuthDialog } = useAuth();
  const callbackConnectedSourceId = initialCallback?.status === "connected"
    ? resolveCallbackSourceId(initialCallback, sources)
    : null;
  const displaySources = useMemo(
    () => sortConnectSourcesByConnectionState(
      markLocallyDisconnectedSources(
        markCallbackConnectedSource(sources, callbackConnectedSourceId),
        disconnectedConnectionIds,
      ),
    ),
    [callbackConnectedSourceId, disconnectedConnectionIds, sources],
  );
  const filteredSources = useMemo(
    () => filterConnectSourcesForSearch(displaySources, search),
    [displaySources, search],
  );
  const hasInitialCallback = Boolean(initialCallback);
  const activeConnectIntent = initialConnectIntent ?? locationConnectIntent;
  const initialConnectIntentPresentation = useMemo(
    () => initialConnectIntentDismissed || !authenticated
      ? null
      : resolveInitialConnectIntentPresentation(activeConnectIntent, displaySources),
    [activeConnectIntent, authenticated, displaySources, initialConnectIntentDismissed],
  );
  const visibleNotice = notice ?? initialConnectIntentPresentation?.notice ?? null;
  const visibleActionError = actionError ?? initialConnectIntentPresentation?.actionError ?? null;
  // When this load carries a connect intent that the effect below will auto-redirect, show a
  // pending-redirect dialog. Seeded on mount and cleared only if that redirect attempt fails.
  const [connectIntentRedirectName, setConnectIntentRedirectName] = useState<string | null>(
    () => resolveConnectIntentRedirectSource(activeConnectIntent, displaySources, authenticated)?.name
      ?? null,
  );

  useEffect(() => {
    if (hasInitialCallback) {
      stripConnectCallbackParams();
    }
  }, [hasInitialCallback]);

  useEffect(() => {
    if (
      authenticated
      || initialConnectIntentAuthOpenedRef.current
      || !activeConnectIntent?.claim
    ) {
      return;
    }

    const source = resolveConnectIntentStartSource(activeConnectIntent, displaySources);
    if (!source) {
      return;
    }

    initialConnectIntentAuthOpenedRef.current = true;
    openAuthDialog();
  }, [activeConnectIntent, authenticated, displaySources, openAuthDialog]);

  const startConnection = useCallback(async (
    source: ConnectSource,
    options: { intentClaim?: string } = {},
  ) => {
    if (!authenticated || (!options.intentClaim && !source.connectTarget)) {
      return;
    }

    setInitialConnectIntentDismissed(true);
    setPendingSourceId(source.id);
    setActionError(null);
    setNotice(null);
    setConsentRequest(null);
    setConnectIntentRecovery(null);

    try {
      const authorizationUrl = await requestConnectionAuthorizationUrl(source, options);
      window.location.assign(authorizationUrl);
    } catch (error) {
      if (isHostedConsentRequiredError(error)) {
        setConsentRequest({
          ...(options.intentClaim ? { intentClaim: options.intentClaim } : {}),
          source,
        });
        setPendingSourceId(null);
        return;
      }

      if (options.intentClaim && isHostedDeviceConnectIntentUnavailableError(error)) {
        setConnectIntentRecovery({
          message: error.message,
          sourceName: source.name,
        });
        setPendingSourceId(null);
        return;
      }

      const message = error instanceof Error ? error.message : "Connection could not be started.";
      setActionError({
        message,
        sourceId: source.id,
      });
      setPendingSourceId(null);
    }
  }, [authenticated]);

  useEffect(() => {
    if (
      initialConnectIntentAttemptedRef.current
      || !authenticated
      || !activeConnectIntent?.claim
    ) {
      return;
    }

    initialConnectIntentAttemptedRef.current = true;
    stripDeviceConnectIntentParams();

    const source = resolveConnectIntentRedirectSource(activeConnectIntent, displaySources, authenticated);
    if (!source) {
      return;
    }

    let cancelled = false;
    void requestConnectionAuthorizationUrl(source, { intentClaim: activeConnectIntent.claim })
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
        if (isHostedConsentRequiredError(error)) {
          setConsentRequest({
            intentClaim: activeConnectIntent.claim,
            source,
          });
          return;
        }

        if (isHostedDeviceConnectIntentUnavailableError(error)) {
          setConnectIntentRecovery({
            message: error.message,
            sourceName: source.name,
          });
          return;
        }

        const message = error instanceof Error ? error.message : "Connection could not be started.";
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
    if (!connectionId || pendingDisconnectSourceId || pendingSourceId === source.id) {
      return;
    }

    setPendingDisconnectSourceId(source.id);
    setActionError(null);
    setNotice(null);

    try {
      const result = await requestHostedOnboardingJson<HostedDeviceSyncDisconnectResponse>({
        method: "POST",
        url: `/api/settings/device-sync/connections/${encodeURIComponent(connectionId)}/disconnect`,
      });
      setDisconnectSource(null);
      setDisconnectedConnectionIds((current) => new Set([...current, connectionId]));
      setNotice({
        kind: result.warning?.message ? "warning" : "success",
        title: "Source disconnected",
        message: result.warning?.message
          ? `Disconnected ${source.name}. Your history is still saved. The provider did not fully confirm, so check that account if you want access removed there too.`
          : `Disconnected ${source.name}. Your history is still saved.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : `We could not disconnect ${source.name} right now.`;
      setActionError({
        sourceId: source.id,
        message,
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
          <Alert variant="destructive">
            <AlertTitle>Unable to finish connection</AlertTitle>
            <AlertDescription>{visibleNotice.message}</AlertDescription>
          </Alert>
        )
      ) : null}

      <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground">
            Sources
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
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
              errorMessage={visibleActionError?.sourceId === source.id ? visibleActionError.message : null}
              pending={pendingSourceId === source.id}
              pendingDisconnect={pendingDisconnectSourceId === source.id}
              source={source}
              onDisconnectTargetChange={setDisconnectSource}
              onStartConnection={startConnection}
            />
          ))}
        </div>
      )}

      <ConnectConsentDialog
        source={consentRequest?.source ?? null}
        onOpenChange={(open) => {
          if (!open) {
            setConsentRequest(null);
          }
        }}
        onAccepted={async (source) => {
          await startConnection(source, {
            ...(consentRequest?.intentClaim
              ? { intentClaim: consentRequest.intentClaim }
              : {}),
          });
        }}
      />

      <ConnectDisconnectDialog
        errorMessage={disconnectSource && actionError?.sourceId === disconnectSource.id
          ? actionError.message
          : null}
        pending={Boolean(disconnectSource && pendingDisconnectSourceId === disconnectSource.id)}
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
