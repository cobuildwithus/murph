"use client";

import { Check, MessageCircle } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { AuthDialog } from "@/src/components/hosted-onboarding/auth-dialog";
import {
  requestHostedOnboardingJson,
} from "@/src/components/hosted-onboarding/client-api";
import { navigateHostedAuthRedirect } from "@/src/components/hosted-onboarding/hosted-auth-navigation";
import type { HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";
import { isHostedOnboardingAccessibleStage } from "@/src/lib/hosted-onboarding/stage";
import { Button } from "@/src/components/ui/button";

type HostedGroupStartRecoveryResponse = {
  ok: true;
  status: "already_connected" | "linked";
};

export function HostedGroupStartClient({
  activeAccess,
  authenticated,
  recoveryToken,
}: {
  activeAccess: boolean;
  authenticated: boolean;
  recoveryToken: string | null;
}) {
  const recoveryStarted = useRef(false);
  const [authOpen, setAuthOpen] = useState(!authenticated);
  const [signedIn, setSignedIn] = useState(authenticated);
  const [readyAccess, setReadyAccess] = useState(activeAccess);
  const [recoveryStatus, setRecoveryStatus] = useState<
    "idle" | "linking" | "linked" | "failed"
  >(authenticated && recoveryToken ? "linking" : "idle");

  useEffect(() => {
    if (!authenticated || !recoveryToken || recoveryStarted.current) {
      return;
    }
    recoveryStarted.current = true;
    void linkRecovery(recoveryToken).then(
      () => setRecoveryStatus("linked"),
      () => setRecoveryStatus("failed"),
    );
  }, [authenticated, recoveryToken]);

  async function handleCompleted(payload: HostedPrivyCompletionPayload) {
    if (recoveryToken) {
      setRecoveryStatus("linking");
      try {
        await linkRecovery(recoveryToken);
        setRecoveryStatus("linked");
      } catch {
        setRecoveryStatus("failed");
        return;
      }
    }

    if (!isHostedOnboardingAccessibleStage(payload.stage)) {
      navigateHostedAuthRedirect(payload.joinUrl);
      return;
    }

    setSignedIn(true);
    setReadyAccess(true);
    setAuthOpen(false);
  }

  if (recoveryStatus === "linking") {
    return (
      <HostedGroupStartFrame
        icon={<MessageCircle className="size-8" />}
        title="Connecting your Messages address"
        body="One moment — Murph is linking the address that sent the group message to your account."
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
            recoveryStarted.current = false;
            setRecoveryStatus("linking");
            if (recoveryToken) {
              recoveryStarted.current = true;
              void linkRecovery(recoveryToken).then(
                () => setRecoveryStatus("linked"),
                () => setRecoveryStatus("failed"),
              );
            }
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

async function linkRecovery(token: string): Promise<void> {
  await requestHostedOnboardingJson<HostedGroupStartRecoveryResponse>({
    payload: { token },
    url: "/api/groups/start/recover",
  });
}

function HostedGroupStartFrame({
  body,
  children,
  icon,
  title,
}: {
  body: string;
  children?: ReactNode;
  icon: ReactNode;
  title: string;
}) {
  return (
    <div className="flex flex-col gap-8 text-center">
      <header className="flex flex-col items-center gap-4">
        <span
          aria-hidden="true"
          className="flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary"
        >
          {icon}
        </span>
        <div className="flex flex-col gap-2">
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          <p className="text-pretty text-base leading-7 text-muted-foreground">
            {body}
          </p>
        </div>
      </header>
      {children ? <div className="flex flex-col gap-3">{children}</div> : null}
    </div>
  );
}
