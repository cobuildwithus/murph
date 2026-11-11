"use client";

import { useEffect, useRef, useState } from "react";

import {
  HostedGroupStartScreen,
  HostedGroupStartSignIn,
} from "./group-start-frame";
import {
  HostedOnboardingApiError,
  requestHostedOnboardingJson,
} from "@/src/components/hosted-onboarding/client-api";
import { navigateHostedAuthRedirect } from "@/src/components/hosted-onboarding/hosted-auth-navigation";
import type { HostedAuthenticationCompletionPayload } from "@/src/lib/hosted-onboarding/types";
import { isHostedOnboardingAccessibleStage } from "@/src/lib/hosted-onboarding/stage";
import {
  armHostedGroupStartHandoff,
  clearHostedGroupStartHandoff,
} from "@/src/lib/hosted-groups/group-start-handoff";

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

  async function handleCompleted(payload: HostedAuthenticationCompletionPayload) {
    const accessible = isHostedOnboardingAccessibleStage(payload.stage);
    // Authentication succeeded independently of linking the Messages address.
    // A transient linking failure must not discard access before an explicit retry.
    setSignedIn(true);
    setReadyAccess(accessible);
    if (accessible) {
      clearHostedGroupStartHandoff();
    }
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

    if (!accessible) {
      armHostedGroupStartHandoff();
      navigateHostedAuthRedirect(payload.joinUrl);
      return;
    }
  }

  if (
    recoveryStatus === "checking"
    || recoveryStatus === "conflict"
    || recoveryStatus === "linking"
  ) {
    return <HostedGroupStartScreen state={recoveryStatus} />;
  }

  if (recoveryStatus === "failed") {
    return (
      <HostedGroupStartScreen
        onRetry={() => {
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
        state="failed"
      />
    );
  }

  if (signedIn || recoveryStatus === "linked") {
    return <HostedGroupStartScreen state={readyAccess ? "ready" : "finish"} />;
  }

  return <HostedGroupStartSignIn onCompleted={handleCompleted} />;
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
