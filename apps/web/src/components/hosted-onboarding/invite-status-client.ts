"use client";

import { useEffect, useEffectEvent } from "react";

import type { HostedInviteStatusPayload } from "@/src/lib/hosted-onboarding/types";

import { requestHostedOnboardingJson } from "./client-api";

const HOSTED_INVITE_STATUS_POLL_INTERVAL_MS = 3_000;

export async function fetchHostedInviteStatus(inviteCode: string): Promise<HostedInviteStatusPayload> {
  return requestHostedOnboardingJson<HostedInviteStatusPayload>({
    auth: "optional",
    url: buildHostedInviteStatusUrl(inviteCode),
  });
}

export function useHostedInviteStatusRefresh(input: {
  authenticated: boolean;
  inviteCode: string;
  onError?: (error: unknown) => void;
  onStatus: (payload: HostedInviteStatusPayload) => void;
  ready: boolean;
  sessionAuthenticated: boolean;
  shouldPoll: boolean;
}) {
  const refreshStatusEffect = useEffectEvent(() => {
    void fetchHostedInviteStatus(input.inviteCode)
      .then(input.onStatus)
      .catch((error: unknown) => {
        input.onError?.(error);
      });
  });

  useEffect(() => {
    if (!input.ready || !input.authenticated || input.sessionAuthenticated) {
      return;
    }

    refreshStatusEffect();
  }, [input.authenticated, input.ready, input.sessionAuthenticated]);

  useEffect(() => {
    if (!input.ready || !input.authenticated || !input.shouldPoll) {
      return;
    }

    refreshStatusEffect();
    const timer = window.setInterval(() => {
      refreshStatusEffect();
    }, HOSTED_INVITE_STATUS_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [input.authenticated, input.ready, input.shouldPoll]);
}

function buildHostedInviteStatusUrl(inviteCode: string): string {
  return `/api/hosted-onboarding/invites/${encodeURIComponent(inviteCode)}/status`;
}
