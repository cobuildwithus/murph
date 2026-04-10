"use client";

import { useCallback, useEffect, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";
import {
  formatHostedDeviceSyncProviderLabel,
  type HostedDeviceSyncSettingsResponse,
  type HostedDeviceSyncSettingsSource,
} from "@/src/lib/device-sync/settings-surface";

import {
  HostedDeviceSyncDisconnectDialog,
  HostedDeviceSyncSettingsContent,
} from "./hosted-device-sync-settings-sections";
import {
  describeDeviceSyncCallbackError,
  sourceKey,
} from "./hosted-device-sync-settings-utils";
import { HostedSettingsSessionState } from "./hosted-settings-session-state";
import { toErrorMessage } from "./hosted-settings-utils";

interface HostedDeviceSyncConnectResponse {
  authorizationUrl: string;
}

interface HostedDeviceSyncDisconnectResponse {
  warning?: { code: string; message: string };
}

export function HostedDeviceSyncSettingsClient(props: {
  authenticated: boolean;
  initialLoadError: string | null;
  initialResponse: HostedDeviceSyncSettingsResponse | null;
}) {
  const [sources, setSources] = useState<HostedDeviceSyncSettingsSource[]>(props.initialResponse?.sources ?? []);
  const [errorMessage, setErrorMessage] = useState<string | null>(props.initialLoadError);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pendingActionKey, setPendingActionKey] = useState<string | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<HostedDeviceSyncSettingsSource | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);

  const disconnectPending = disconnectTarget
    ? pendingActionKey === sourceKey(disconnectTarget, "disconnect")
    : false;

  const loadSources = useCallback(async () => {
    setIsRefreshing(true);

    try {
      const response = await requestHostedOnboardingJson<HostedDeviceSyncSettingsResponse>({
        url: "/api/settings/device-sync",
      });
      setSources(response.sources);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "Could not load your wearables right now."));
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const url = new URL(window.location.href);
    const status = url.searchParams.get("deviceSyncStatus");

    if (!status) {
      return;
    }

    const provider = formatHostedDeviceSyncProviderLabel(url.searchParams.get("deviceSyncProvider") ?? "source");
    const errorCode = url.searchParams.get("deviceSyncError");

    if (status === "connected") {
      setSuccessMessage(`Connected ${provider}.`);
      setWarningMessage(null);
      setErrorMessage(null);
      void loadSources();
    } else if (status === "error") {
      setErrorMessage(describeDeviceSyncCallbackError(provider, errorCode));
      setSuccessMessage(null);
    }

    url.searchParams.delete("deviceSyncStatus");
    url.searchParams.delete("deviceSyncProvider");
    url.searchParams.delete("deviceSyncConnectionId");
    url.searchParams.delete("deviceSyncError");
    url.searchParams.delete("deviceSyncErrorMessage");
    window.history.replaceState({}, "", url.toString());
  }, [loadSources]);

  async function handleConnect(source: HostedDeviceSyncSettingsSource) {
    setPendingActionKey(sourceKey(source, "connect"));
    setErrorMessage(null);
    setSuccessMessage(null);
    setWarningMessage(null);

    try {
      const result = await requestHostedOnboardingJson<HostedDeviceSyncConnectResponse>({
        method: "POST",
        payload: {
          returnTo: "/settings",
        },
        url: `/api/settings/device-sync/providers/${encodeURIComponent(source.provider)}/connect`,
      });
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      setErrorMessage(toErrorMessage(error, `We could not start the ${source.providerLabel} connection right now.`));
      setPendingActionKey(null);
    }
  }

  async function handleDisconnectConfirmed() {
    const source = disconnectTarget;

    if (!source?.connectionId) {
      setDisconnectTarget(null);
      return;
    }

    if (pendingActionKey === sourceKey(source, "disconnect")) {
      return;
    }

    setPendingActionKey(sourceKey(source, "disconnect"));
    setErrorMessage(null);
    setSuccessMessage(null);
    setWarningMessage(null);

    try {
      const result = await requestHostedOnboardingJson<HostedDeviceSyncDisconnectResponse>({
        method: "POST",
        url: `/api/settings/device-sync/connections/${encodeURIComponent(source.connectionId)}/disconnect`,
      });
      setDisconnectTarget(null);
      setSuccessMessage(`Disconnected ${source.providerLabel}. Your history is still saved.`);

      if (result.warning?.message) {
        setWarningMessage(
          `Disconnected on our end, but ${source.providerLabel} didn't fully confirm: ${result.warning.message}`,
        );
      }

      await loadSources();
    } catch (error) {
      setErrorMessage(toErrorMessage(error, `We could not disconnect ${source.providerLabel} right now.`));
    } finally {
      setPendingActionKey(null);
    }
  }

  return (
    <div className="space-y-5">
      {successMessage ? (
        <Alert className="border-emerald-200 bg-emerald-50 text-emerald-900">
          <AlertTitle>Wearable source updated</AlertTitle>
          <AlertDescription>{successMessage}</AlertDescription>
        </Alert>
      ) : null}

      {warningMessage ? (
        <Alert className="border-amber-200 bg-amber-50 text-amber-900">
          <AlertTitle>Small warning</AlertTitle>
          <AlertDescription>{warningMessage}</AlertDescription>
        </Alert>
      ) : null}

      {errorMessage ? (
        <Alert variant="destructive">
          <AlertTitle>Unable to update wearable sources</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      {!props.authenticated ? (
        <HostedSettingsSessionState
          authenticated={props.authenticated}
          signedOutDescription="Sign in to manage your wearables."
        />
      ) : (
        <HostedDeviceSyncSettingsContent
          disconnectTarget={disconnectTarget}
          isRefreshing={isRefreshing}
          pendingActionKey={pendingActionKey}
          sources={sources}
          onConnect={handleConnect}
          onDisconnectTargetChange={setDisconnectTarget}
          onRefresh={loadSources}
        />
      )}

      <HostedDeviceSyncDisconnectDialog
        disconnectPending={disconnectPending}
        disconnectTarget={disconnectTarget}
        onConfirm={handleDisconnectConfirmed}
        onOpenChange={(open) => {
          if (!open && !disconnectPending) {
            setDisconnectTarget(null);
          }
        }}
      />
    </div>
  );
}
