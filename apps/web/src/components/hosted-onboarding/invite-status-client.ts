"use client";

import { useEffect, useEffectEvent } from "react";

import type { HostedInviteStatusPayload } from "@/src/lib/hosted-onboarding/types";

import { requestHostedOnboardingJson } from "./client-api";

const HOSTED_INVITE_STATUS_POLL_INTERVAL_MS = 3_000;

export async function fetchHostedInviteStatus(inviteCode: string): Promise<HostedInviteStatusPayload> {
  return requestHostedOnboardingJson<HostedInviteStatusPayload>({
    url: buildHostedInviteStatusUrl(inviteCode),
  });
}

export function useHostedInviteStatusRefresh(input: {
  inviteCode: string;
  onError?: (error: unknown) => void;
  onStatus: (payload: HostedInviteStatusPayload) => void;
  shouldPoll: boolean;
  disabled?: boolean;
}) {
  const refreshStatusEffect = useEffectEvent(() => {
    void fetchHostedInviteStatus(input.inviteCode)
      .then(input.onStatus)
      .catch((error: unknown) => {
        input.onError?.(error);
      });
  });

  useEffect(() => {
    if (input.disabled) {
      return;
    }
    refreshStatusEffect();
  }, [input.inviteCode, input.disabled]);

  useEffect(() => {
    if (input.disabled || !input.shouldPoll) {
      return;
    }

    const timer = window.setInterval(() => {
      refreshStatusEffect();
    }, HOSTED_INVITE_STATUS_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [input.inviteCode, input.shouldPoll, input.disabled]);
}

function buildHostedInviteStatusUrl(inviteCode: string): string {
  return `/api/hosted-onboarding/invites/${encodeURIComponent(inviteCode)}/status`;
}
