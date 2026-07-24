import { act, createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const mocks = vi.hoisted(() => ({
  requestHostedOnboardingJson: vi.fn(),
}));

vi.mock("@/src/components/hosted-onboarding/client-api", () => ({
  requestHostedOnboardingJson: mocks.requestHostedOnboardingJson,
}));

import {
  fetchHostedInviteStatus,
  useHostedInviteStatusRefresh,
} from "@/src/components/hosted-onboarding/invite-status-client";
import type { HostedInviteStatusPayload } from "@/src/lib/hosted-onboarding/types";

describe("invite status client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("requests invite status from the same-origin hosted onboarding route", async () => {
    mocks.requestHostedOnboardingJson.mockResolvedValue({
      billing: {
        defaultPlanCode: "launch_monthly",
        plans: [],
      },
      capabilities: {
        billingReady: true,
        phoneAuthReady: true,
      },
      invite: null,
      session: {
        authenticated: false,
        expiresAt: null,
        matchesInvite: false,
      },
      stage: "invalid",
    });

    await fetchHostedInviteStatus("invite-code");

    expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledWith({
      url: "/api/hosted-onboarding/invites/invite-code/status",
    });
  });

  it("does not start a new poll until the prior invite refresh settles", async () => {
    vi.useFakeTimers();

    let resolveFirstFetch!: (payload: HostedInviteStatusPayload) => void;
    const firstFetch = new Promise<HostedInviteStatusPayload>((resolve) => {
      resolveFirstFetch = resolve;
    });

    mocks.requestHostedOnboardingJson
      .mockImplementationOnce(() => firstFetch)
      .mockResolvedValue(createStatusPayload());

    const onStatus = vi.fn();
    const onError = vi.fn();

    const { cleanup } = await renderClientComponent(
      createElement(InviteStatusRefreshProbe, {
        inviteCode: "invite-code",
        onError,
        onStatus,
        shouldPoll: true,
      }),
    );

    try {
      expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });

      expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(1);

      await act(async () => {
        resolveFirstFetch(createStatusPayload());
        await firstFetch;
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });

      expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(2);
      expect(onError).not.toHaveBeenCalled();
      expect(onStatus).toHaveBeenCalledTimes(2);
    } finally {
      await cleanup();
      vi.useRealTimers();
    }
  });

  it("retries after a failed poll without overlapping the next request", async () => {
    vi.useFakeTimers();

    let rejectFirstFetch!: (error: unknown) => void;
    const firstFetch = new Promise<HostedInviteStatusPayload>((_resolve, reject) => {
      rejectFirstFetch = reject;
    });

    mocks.requestHostedOnboardingJson
      .mockImplementationOnce(() => firstFetch)
      .mockResolvedValue(createStatusPayload());

    const onStatus = vi.fn();
    const onError = vi.fn();

    const { cleanup } = await renderClientComponent(
      createElement(InviteStatusRefreshProbe, {
        inviteCode: "invite-code",
        onError,
        onStatus,
        shouldPoll: true,
      }),
    );

    try {
      expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });

      expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(1);

      await act(async () => {
        rejectFirstFetch(new Error("poll failed"));
        await firstFetch.catch(() => undefined);
      });

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onStatus).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });

      expect(mocks.requestHostedOnboardingJson).toHaveBeenCalledTimes(2);
      expect(onStatus).toHaveBeenCalledTimes(1);
    } finally {
      await cleanup();
      vi.useRealTimers();
    }
  });
});

function InviteStatusRefreshProbe(input: {
  inviteCode: string;
  onError?: (error: unknown) => void;
  onStatus: (payload: HostedInviteStatusPayload) => void;
  shouldPoll: boolean;
  disabled?: boolean;
}) {
  useHostedInviteStatusRefresh(input);

  return createElement("button", { type: "button" }, "probe");
}

function createStatusPayload(): HostedInviteStatusPayload {
  return {
    billing: {
      defaultPlanCode: "launch_monthly",
      plans: [],
    },
    capabilities: {
      billingReady: true,
      phoneAuthReady: true,
    },
    invite: null,
    session: {
      authenticated: false,
      expiresAt: null,
      matchesInvite: false,
    },
    messagingSetupRequired: false,
    stage: "verify",
    telegramStartRequired: false,
  };
}
