"use client";

import { useCallback, useEffect, useState } from "react";

import { DEVICE_SYNC_CALLBACK_QUERY_PARAM_KEYS } from "@murphai/device-syncd/callback-redirect";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import {
  HostedOnboardingApiError,
  requestHostedOnboardingJson,
} from "@/src/components/hosted-onboarding/client-api";
import {
  type HostedDeviceSyncSettingsResponse,
  type HostedDeviceSyncSettingsSource,
} from "@/src/lib/device-sync/settings-surface";

import {
  HostedDeviceSyncDisconnectDialog,
  HostedDeviceSyncReconnectConsentDialog,
  HostedDeviceSyncSettingsContent,
  HostedDeviceSyncSettingsStatusCard,
} from "./hosted-device-sync-settings-sections";
import {
  sourceKey,
} from "./hosted-device-sync-settings-utils";
import { HostedSettingsSessionState } from "./hosted-settings-session-state";
import type { HostedDeviceSyncSettingsInitialLoadError } from "./hosted-device-sync-settings";

interface HostedDeviceSyncDisconnectResponse {
  warning?: { code: string; message: string };
}

interface HostedDeviceSyncConnectResponse {
  authorizationUrl: string;
}

const SETTINGS_DEVICE_SYNC_CALLBACK_QUERY_PARAM_KEYS = [
  ...DEVICE_SYNC_CALLBACK_QUERY_PARAM_KEYS,
  "connectSource",
  "connectTarget",
] as const;

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
  const [reconnectConsentTarget, setReconnectConsentTarget] = useState<HostedDeviceSyncSettingsSource | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);

  const disconnectPending = disconnectTarget
    ? pendingActionKey === sourceKey(disconnectTarget, "disconnect")
    : false;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const url = new URL(window.location.href);
    const hasCallbackParam = SETTINGS_DEVICE_SYNC_CALLBACK_QUERY_PARAM_KEYS.some((key) =>
      url.searchParams.has(key)
    );

    if (!hasCallbackParam) {
      return;
    }

    for (const key of SETTINGS_DEVICE_SYNC_CALLBACK_QUERY_PARAM_KEYS) {
      url.searchParams.delete(key);
    }
    window.history.replaceState({}, "", url.toString());
  }, []);

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
        createHostedDeviceSyncErrorState(error, "Could not load your wearables right now.", "load"),
      );
    } finally {
      setIsRefreshing(false);
    }
  }, []);

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
    setReconnectConsentTarget(null);

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

  async function handleReconnect(source: HostedDeviceSyncSettingsSource) {
    const connectSourceId = source.connectSourceId?.trim();
    if (!connectSourceId || pendingActionKey === sourceKey(source, "reconnect")) {
      return;
    }

    setPendingActionKey(sourceKey(source, "reconnect"));
    setErrorState(null);
    setSuccessMessage(null);
    setWarningMessage(null);
    setReconnectConsentTarget(null);

    try {
      const result = await requestHostedOnboardingJson<HostedDeviceSyncConnectResponse>({
        method: "POST",
        url: `/api/connect-sources/${encodeURIComponent(connectSourceId)}/start`,
      });
      const authorizationUrl = readHostedDeviceSyncAuthorizationUrl(result);
      window.location.assign(authorizationUrl);
    } catch (error) {
      if (isHostedConsentRequiredError(error)) {
        setReconnectConsentTarget(source);
        setPendingActionKey(null);
        return;
      }

      setErrorState(
        createHostedDeviceSyncErrorState(
          error,
          `We could not start reconnecting ${source.providerLabel} right now.`,
          "action",
        ),
      );
      setPendingActionKey(null);
    }
  }

  const errorMessage = errorState?.message ?? null;
  const showUnavailableState = props.authenticated && errorState?.phase === "load" && sources.length === 0;
  const errorAlertTitle = errorState?.phase === "load"
    ? "Unable to load wearable sources"
    : "Unable to update wearable sources";

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
          <AlertTitle>{errorAlertTitle}</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      {!props.authenticated ? (
        <HostedSettingsSessionState
          authenticated={props.authenticated}
          signedOutDescription="Sign in to manage your wearables."
        />
      ) : showUnavailableState ? (
        <HostedDeviceSyncSettingsStatusCard
          actionLabel={isHostedDeviceSyncBlockedState(errorState) ? null : "Refresh status"}
          description={errorMessage ?? "Could not load your wearables right now."}
          disabled={isRefreshing}
          title={isHostedDeviceSyncBlockedState(errorState) ? "Wearables unavailable" : "Could not load wearables"}
          onAction={isHostedDeviceSyncBlockedState(errorState) ? undefined : loadSources}
        />
      ) : (
        <HostedDeviceSyncSettingsContent
          disconnectTarget={disconnectTarget}
          isRefreshing={isRefreshing}
          pendingActionKey={pendingActionKey}
          sources={sources}
          onDisconnectTargetChange={setDisconnectTarget}
          onRefresh={loadSources}
          onReconnect={handleReconnect}
        />
      )}

      <HostedDeviceSyncReconnectConsentDialog
        source={reconnectConsentTarget}
        onAccepted={handleReconnect}
        onOpenChange={(open) => {
          if (!open) {
            setReconnectConsentTarget(null);
          }
        }}
      />

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

function isHostedConsentRequiredError(error: unknown): boolean {
  return error instanceof HostedOnboardingApiError && error.code === "HOSTED_CONSENT_REQUIRED";
}

function readHostedDeviceSyncAuthorizationUrl(response: HostedDeviceSyncConnectResponse): string {
  if (typeof response.authorizationUrl !== "string" || !response.authorizationUrl.trim()) {
    throw new Error("Connection could not be started.");
  }

  const url = new URL(response.authorizationUrl);
  if (url.protocol !== "https:") {
    throw new Error("Connection could not be started.");
  }

  return response.authorizationUrl;
}

function readOptionalErrorCode(error: Error): string | null {
  return "code" in error && typeof error.code === "string" ? error.code : null;
}
