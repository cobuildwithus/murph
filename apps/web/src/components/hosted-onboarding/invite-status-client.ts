"use client";

import { useEffect, useEffectEvent, useRef } from "react";

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
  const inFlightRefreshRef = useRef<{
    inviteCode: string;
    promise: Promise<void>;
  } | null>(null);

  const refreshStatusEffect = useEffectEvent(() => {
    const currentInviteCode = input.inviteCode;
    const currentRefresh = inFlightRefreshRef.current;

    if (currentRefresh?.inviteCode === currentInviteCode) {
      return currentRefresh.promise;
    }

    const promise = fetchHostedInviteStatus(currentInviteCode)
      .then(input.onStatus)
      .catch((error: unknown) => {
        input.onError?.(error);
      })
      .finally(() => {
        if (inFlightRefreshRef.current?.promise === promise) {
          inFlightRefreshRef.current = null;
        }
      });

    inFlightRefreshRef.current = {
      inviteCode: currentInviteCode,
      promise,
    };

    return promise;
  });

  useEffect(() => {
    if (input.disabled) {
      return;
    }
    void refreshStatusEffect();
  }, [input.inviteCode, input.disabled]);

  useEffect(() => {
    if (input.disabled || !input.shouldPoll) {
      return;
    }

    let cancelled = false;
    let timer: number | null = null;

    const scheduleNextPoll = () => {
      if (cancelled) {
        return;
      }

      timer = window.setTimeout(() => {
        timer = null;
        void runRefreshCycle();
      }, HOSTED_INVITE_STATUS_POLL_INTERVAL_MS);
    };

    const runRefreshCycle = async () => {
      await refreshStatusEffect();

      if (cancelled) {
        return;
      }

      scheduleNextPoll();
    };

    scheduleNextPoll();

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [input.inviteCode, input.shouldPoll, input.disabled]);
}

function buildHostedInviteStatusUrl(inviteCode: string): string {
  return `/api/hosted-onboarding/invites/${encodeURIComponent(inviteCode)}/status`;
}
