"use client";

import { useEffect } from "react";

import { requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";

interface DashboardOnboardingRecoveryResponse {
  redirectPath: string | null;
}

export function DashboardOnboardingRecoveryRedirect({
  enabled,
}: {
  enabled: boolean;
}) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;

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
        }
      } catch {
        // Active-access gates still own the visible error if recovery is unavailable.
      }
    }

    void recoverDashboardOnboarding();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return null;
}
