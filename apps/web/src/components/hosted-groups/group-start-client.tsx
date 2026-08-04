"use client";

import { Check, MessageCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { AuthDialog } from "@/src/components/hosted-onboarding/auth-dialog";
import { HostedGroupStartFrame } from "./group-start-frame";
import {
  HostedOnboardingApiError,
  requestHostedOnboardingJson,
} from "@/src/components/hosted-onboarding/client-api";
import { navigateHostedAuthRedirect } from "@/src/components/hosted-onboarding/hosted-auth-navigation";
import type { HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";
import { isHostedOnboardingAccessibleStage } from "@/src/lib/hosted-onboarding/stage";
import {
  armHostedGroupStartHandoff,
  clearHostedGroupStartHandoff,
} from "@/src/lib/hosted-groups/group-start-handoff";
import { Button } from "@/src/components/ui/button";

type HostedGroupStartRecoveryResponse = {
  ok: true;
  status: "already_connected" | "linked";
};

type HostedGroupStartRecoveryStatus =
  | "checking"
  | "conflict"
  | "failed"
  | "idle"
  | "linked"
  | "linking";

// The route reports a cross-account binding as this typed 409. It is terminal
// for this link, so it gets its own message and no retry action.
const HOSTED_GROUP_START_RECOVERY_CONFLICT_CODE =
  "HOSTED_LINQ_GROUP_EMAIL_RECOVERY_CONFLICT";

export function HostedGroupStartClient({
  activeAccess,
  authenticated,
}: {
  activeAccess: boolean;
  authenticated: boolean;
}) {
  const recoveryStarted = useRef(false);
  const recoveryTokenRef = useRef<string | null>(null);
  const [authOpen, setAuthOpen] = useState(!authenticated);
  const [signedIn, setSignedIn] = useState(authenticated);
  const [readyAccess, setReadyAccess] = useState(activeAccess);
  const [recoveryStatus, setRecoveryStatus] =
    useState<HostedGroupStartRecoveryStatus>("checking");

  useEffect(() => {
    if (activeAccess) {
      clearHostedGroupStartHandoff();
    } else {
      armHostedGroupStartHandoff();
    }

    let cancelled = false;
    const token = readHostedGroupStartRecoveryToken();
    recoveryTokenRef.current = token;

    void Promise.resolve().then(async () => {
      if (cancelled) {
        return;
      }
      if (!token || !authenticated) {
        setRecoveryStatus("idle");
        return;
      }
      if (recoveryStarted.current) {
        return;
      }

      recoveryStarted.current = true;
      setRecoveryStatus("linking");
      try {
        await linkRecovery(token);
        if (!cancelled) {
          clearHostedGroupStartRecoveryFragment();
          setRecoveryStatus("linked");
        }
      } catch (error) {
        if (!cancelled) {
          setRecoveryStatus(readHostedGroupStartRecoveryFailure(error));
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeAccess, authenticated]);

  async function handleCompleted(payload: HostedPrivyCompletionPayload) {
    const recoveryToken = recoveryTokenRef.current;
    if (recoveryToken) {
      setRecoveryStatus("linking");
      try {
        await linkRecovery(recoveryToken);
        clearHostedGroupStartRecoveryFragment();
        setRecoveryStatus("linked");
      } catch (error) {
        setRecoveryStatus(readHostedGroupStartRecoveryFailure(error));
        return;
      }
    }

    if (!isHostedOnboardingAccessibleStage(payload.stage)) {
      armHostedGroupStartHandoff();
      navigateHostedAuthRedirect(payload.joinUrl);
      return;
    }

    clearHostedGroupStartHandoff();
    setSignedIn(true);
    setReadyAccess(true);
    setAuthOpen(false);
  }

  if (recoveryStatus === "checking" || recoveryStatus === "linking") {
    return (
      <HostedGroupStartFrame
        icon={<MessageCircle className="size-8" />}
        title={
          recoveryStatus === "linking"
            ? "Connecting your Messages address"
            : "Preparing Murph"
        }
        body={
          recoveryStatus === "linking"
            ? "One moment — Murph is linking the address that sent the group message to your account."
            : "One moment while Murph prepares group setup."
        }
      />
    );
  }

  if (recoveryStatus === "conflict") {
    return (
      <HostedGroupStartFrame
        icon={<MessageCircle className="size-8" />}
        title="That address is already set up"
        body="The Messages address that sent this group message is connected to a different Murph account. Log in to that account and message the group again, or ask someone else in the group to message Murph."
      />
    );
  }

  if (recoveryStatus === "failed") {
    return (
      <HostedGroupStartFrame
        icon={<MessageCircle className="size-8" />}
        title="That recovery link did not work"
        body="Open the latest link Murph sent, or return to the group and have someone with Murph message again."
      >
        <Button
          type="button"
          size="xl"
          className="w-full"
          onClick={() => {
            const recoveryToken = recoveryTokenRef.current;
            if (!recoveryToken) {
              return;
            }
            setRecoveryStatus("linking");
            void linkRecovery(recoveryToken).then(
              () => {
                clearHostedGroupStartRecoveryFragment();
                setRecoveryStatus("linked");
              },
              (error: unknown) =>
                setRecoveryStatus(readHostedGroupStartRecoveryFailure(error)),
            );
          }}
        >
          Try again
        </Button>
      </HostedGroupStartFrame>
    );
  }

  if (signedIn || recoveryStatus === "linked") {
    return readyAccess ? (
      <HostedGroupStartFrame
        icon={<Check className="size-8" />}
        title="Go back to the group"
        body="Message Murph in that group again. Your next message will connect the chat and Murph will reply there."
      />
    ) : (
      <HostedGroupStartFrame
        icon={<MessageCircle className="size-8" />}
        title="Finish setting up Murph"
        body="Complete setup, then return to the group and message Murph again."
      >
        <Button
          render={<Link href="/join" />}
          nativeButton={false}
          size="xl"
          className="w-full"
        >
          Finish setup
        </Button>
      </HostedGroupStartFrame>
    );
  }

  return (
    <HostedGroupStartFrame
      icon={<MessageCircle className="size-8" />}
      title="Set up Murph for this group"
      body="Create or open your Murph account. When setup is finished, return to the group and message Murph again."
    >
      <Button
        type="button"
        size="xl"
        className="w-full"
        onClick={() => setAuthOpen(true)}
      >
        Continue
      </Button>
      <AuthDialog
        open={authOpen}
        onOpenChange={setAuthOpen}
        onCompleted={handleCompleted}
        requireLaunchConsentOnCompletion
        title="Log in or sign up"
        description="Finish setting up Murph, then return to your group chat."
      />
    </HostedGroupStartFrame>
  );
}

function readHostedGroupStartRecoveryFailure(
  error: unknown,
): Extract<HostedGroupStartRecoveryStatus, "conflict" | "failed"> {
  return error instanceof HostedOnboardingApiError
    && error.code === HOSTED_GROUP_START_RECOVERY_CONFLICT_CODE
    ? "conflict"
    : "failed";
}

async function linkRecovery(token: string): Promise<void> {
  await requestHostedOnboardingJson<HostedGroupStartRecoveryResponse>({
    payload: { token },
    url: "/api/groups/start/recover",
  });
}

function readHostedGroupStartRecoveryToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const token = new URLSearchParams(hash).get("recover")?.trim() ?? "";
  return token.length > 0 && token.length <= 6_000 ? token : null;
}

function clearHostedGroupStartRecoveryFragment(): void {
  if (typeof window === "undefined" || !window.location.hash) {
    return;
  }

  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${window.location.search}`,
  );
}
