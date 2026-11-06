"use client";

import { useEffect, useEffectEvent, useRef } from "react";

import type { HostedInviteStatusPayload } from "@/src/lib/hosted-onboarding/types";

import { requestHostedOnboardingJson } from "./client-api";

const HOSTED_INVITE_STATUS_POLL_INTERVAL_MS = 3_000;
const HOSTED_INVITE_STATUS_FAST_WINDOW_MS = 30_000;
const HOSTED_INVITE_STATUS_IDLE_POLL_INTERVAL_MS = 30_000;

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
    let refreshing = false;
    let fastWindowStartedAt = Date.now();

    const scheduleNextPoll = () => {
      if (cancelled || document.visibilityState === "hidden" || timer !== null) {
        return;
      }

      timer = window.setTimeout(() => {
        timer = null;
        void runRefreshCycle();
      }, Date.now() - fastWindowStartedAt < HOSTED_INVITE_STATUS_FAST_WINDOW_MS
        ? HOSTED_INVITE_STATUS_POLL_INTERVAL_MS
        : HOSTED_INVITE_STATUS_IDLE_POLL_INTERVAL_MS);
    };

    const runRefreshCycle = async () => {
      if (cancelled || refreshing || document.visibilityState === "hidden") return;
      refreshing = true;
      await refreshStatusEffect();
      refreshing = false;
      scheduleNextPoll();
    };

    const onVisibilityChange = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      if (document.visibilityState !== "hidden") {
        fastWindowStartedAt = Date.now();
        void runRefreshCycle();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    scheduleNextPoll();

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
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
