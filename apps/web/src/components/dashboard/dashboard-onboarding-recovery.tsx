"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  HostedOnboardingApiError,
  requestHostedOnboardingJson,
} from "@/src/components/hosted-onboarding/client-api";

interface DashboardOnboardingRecoveryResponse {
  redirectPath: string | null;
}

export function DashboardOnboardingRecoveryRedirect({
  enabled,
}: {
  enabled: boolean;
}) {
  const { refresh } = useRouter();
  const [failed, setFailed] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;
    setFailed(false);

    async function recoverDashboardOnboarding() {
      try {
        const response =
          await requestHostedOnboardingJson<DashboardOnboardingRecoveryResponse>({
            method: "POST",
            payload: {},
            url: "/api/hosted-onboarding/session/dashboard-recovery",
          });

        if (!cancelled && response.redirectPath) {
          window.location.assign(response.redirectPath);
          return;
        }

        if (!cancelled) {
          refresh();
        }
      } catch (error) {
        if (
          error instanceof HostedOnboardingApiError
          && error.code === "AUTH_REQUIRED"
        ) {
          window.location.assign("/");
          return;
        }

        if (!cancelled) {
          setFailed(true);
        }
      }
    }

    void recoverDashboardOnboarding();

    return () => {
      cancelled = true;
    };
  }, [enabled, refresh, retryNonce]);

  if (!enabled || !failed) {
    return null;
  }

  return (
    <div
      className="rounded-md border border-border bg-background p-4 text-sm"
      role="alert"
    >
      <p className="text-muted-foreground">Could not reopen checkout.</p>
      <button
        className="mt-3 rounded-md border border-border px-3 py-1.5 text-foreground"
        onClick={() => setRetryNonce((value) => value + 1)}
        type="button"
      >
        Try again
      </button>
    </div>
  );
}
