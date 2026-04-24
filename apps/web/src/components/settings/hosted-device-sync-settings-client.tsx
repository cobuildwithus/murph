"use client";

import { useCallback, useEffect, useState } from "react";

import { DEVICE_SYNC_CALLBACK_QUERY_PARAM_KEYS } from "@murphai/device-syncd/callback-redirect";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import {
  HostedOnboardingApiError,
  requestHostedOnboardingJson,
} from "@/src/components/hosted-onboarding/client-api";
import {
  formatHostedDeviceSyncProviderLabel,
  type HostedDeviceSyncSettingsResponse,
  type HostedDeviceSyncSettingsSource,
} from "@/src/lib/device-sync/settings-surface";

import {
  HostedDeviceSyncDisconnectDialog,
  HostedDeviceSyncSettingsContent,
  HostedDeviceSyncSettingsStatusCard,
} from "./hosted-device-sync-settings-sections";
import {
  describeDeviceSyncCallbackError,
  sourceKey,
} from "./hosted-device-sync-settings-utils";
import { HostedSettingsSessionState } from "./hosted-settings-session-state";
import type { HostedDeviceSyncSettingsInitialLoadError } from "./hosted-device-sync-settings";

interface HostedDeviceSyncConnectResponse {
  authorizationUrl: string;
}

interface HostedDeviceSyncDisconnectResponse {
  warning?: { code: string; message: string };
}

export function HostedDeviceSyncSettingsClient(props: {
  authenticated: boolean;
  initialLoadError: HostedDeviceSyncSettingsInitialLoadError | null;
  initialResponse: HostedDeviceSyncSettingsResponse | null;
}) {
  const [sources, setSources] = useState<HostedDeviceSyncSettingsSource[]>(props.initialResponse?.sources ?? []);
  const [errorState, setErrorState] = useState<HostedDeviceSyncSettingsErrorState | null>(
    props.initialLoadError
      ? {
          ...props.initialLoadError,
          phase: "load",
        }
      : null,
  );
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
      setErrorState(null);
    } catch (error) {
      setErrorState(
        createHostedDeviceSyncErrorState(error, "Could not load your data sources right now.", "load"),
      );
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
      setErrorState(null);
      void loadSources();
    } else if (status === "error") {
      setErrorState({
        code: null,
        message: describeDeviceSyncCallbackError(provider, errorCode),
        phase: "action",
      });
      setSuccessMessage(null);
    }

    for (const key of DEVICE_SYNC_CALLBACK_QUERY_PARAM_KEYS) {
      url.searchParams.delete(key);
    }
    window.history.replaceState({}, "", url.toString());
  }, [loadSources]);

  async function handleConnect(source: HostedDeviceSyncSettingsSource) {
    setPendingActionKey(sourceKey(source, "connect"));
    setErrorState(null);
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
      setErrorState(
        createHostedDeviceSyncErrorState(
          error,
          `We could not start the ${source.providerLabel} connection right now.`,
          "action",
        ),
      );
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
    setErrorState(null);
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
      setErrorState(
        createHostedDeviceSyncErrorState(
          error,
          `We could not disconnect ${source.providerLabel} right now.`,
          "action",
        ),
      );
    } finally {
      setPendingActionKey(null);
    }
  }

  const errorMessage = errorState?.message ?? null;
  const showUnavailableState = props.authenticated && errorState?.phase === "load" && sources.length === 0;
  const errorAlertTitle = errorState?.phase === "load"
    ? "Unable to load connected sources"
    : "Unable to update connected sources";

  return (
    <div className="space-y-5">
      {successMessage ? (
        <Alert className="border-emerald-200 bg-emerald-50 text-emerald-900">
          <AlertTitle>Connected source updated</AlertTitle>
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
          <AlertTitle>{errorAlertTitle}</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      {!props.authenticated ? (
        <HostedSettingsSessionState
          authenticated={props.authenticated}
          signedOutDescription="Sign in to manage your data sources."
        />
      ) : showUnavailableState ? (
        <HostedDeviceSyncSettingsStatusCard
          actionLabel={isHostedDeviceSyncBlockedState(errorState) ? null : "Refresh status"}
          description={errorMessage ?? "Could not load your data sources right now."}
          disabled={isRefreshing}
          title={isHostedDeviceSyncBlockedState(errorState) ? "Data sources unavailable" : "Could not load data sources"}
          onAction={isHostedDeviceSyncBlockedState(errorState) ? undefined : loadSources}
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

type HostedDeviceSyncSettingsErrorState = HostedDeviceSyncSettingsInitialLoadError & {
  phase: "action" | "load";
};

function createHostedDeviceSyncErrorState(
  error: unknown,
  fallback: string,
  phase: HostedDeviceSyncSettingsErrorState["phase"],
): HostedDeviceSyncSettingsErrorState {
  if (error instanceof HostedOnboardingApiError) {
    return {
      code: error.code,
      message: error.message || fallback,
      phase,
    };
  }

  if (error instanceof Error && error.message) {
    return {
      code: readOptionalErrorCode(error),
      message: error.message,
      phase,
    };
  }

  if (typeof error === "string" && error.trim()) {
    return {
      code: null,
      message: error.trim(),
      phase,
    };
  }

  return {
    code: null,
    message: fallback,
    phase,
  };
}

function isHostedDeviceSyncBlockedState(
  errorState: HostedDeviceSyncSettingsErrorState | null,
): boolean {
  return errorState?.code === "HOSTED_ACCESS_REQUIRED" || errorState?.code === "HOSTED_MEMBER_SUSPENDED";
}

function readOptionalErrorCode(error: Error): string | null {
  return "code" in error && typeof error.code === "string" ? error.code : null;
}
