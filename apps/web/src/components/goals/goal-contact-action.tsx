"use client";

import { ArrowRight } from "lucide-react";
import Image from "next/image";
import {
  useEffect,
  useRef,
  useState,
} from "react";

import { useAuth } from "@/src/components/hosted-onboarding/auth-dialog-provider";
import { requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";
import { MurphContactLink } from "@/src/components/murph/murph-contact-link";
import { buttonVariants } from "@/src/components/ui/button";
import {
  GOAL_CONTACT_RESOLUTION_PATH,
  type GoalContactResolution,
} from "@/src/lib/goals/goal-contact-contract";
import type { MurphContactOption } from "@/src/lib/murph-contact-routing";
import { cn } from "@/src/lib/utils";

const GOAL_CONTACT_RESOLUTION_TIMEOUT_MS = 10_000;

export function GoalContactAction({
  goalRouteId,
  option,
}: {
  goalRouteId: string;
  option: MurphContactOption;
}) {
  const { authenticated } = useAuth();

  return (
    <div>
      {authenticated ? (
        <AuthenticatedGoalContactAction
          key={goalRouteId}
          goalRouteId={goalRouteId}
        />
      ) : (
        <MurphContactLink
          actionLabel="Build my plan with Murph"
          className={cn(buttonVariants({ size: "xl" }), "w-full sm:w-auto")}
          option={option}
        >
          <GoalContactActionContents />
        </MurphContactLink>
      )}
    </div>
  );
}

interface GoalContactAttempt {
  controller: AbortController;
  locationHref: string;
  timeout: ReturnType<typeof setTimeout>;
}

function AuthenticatedGoalContactAction({
  goalRouteId,
}: {
  goalRouteId: string;
}) {
  const activeAttempt = useRef<GoalContactAttempt | null>(null);
  const [status, setStatus] = useState<"failed" | "idle" | "opening">("idle");

  useEffect(() => {
    const cancelForNavigation = () => {
      const attempt = activeAttempt.current;
      if (!attempt) {
        return;
      }

      cancelGoalContactAttempt(activeAttempt, attempt);
      setStatus("idle");
    };

    window.addEventListener("pagehide", cancelForNavigation);
    window.addEventListener("popstate", cancelForNavigation);
    return () => {
      window.removeEventListener("pagehide", cancelForNavigation);
      window.removeEventListener("popstate", cancelForNavigation);

      const attempt = activeAttempt.current;
      if (attempt) {
        cancelGoalContactAttempt(activeAttempt, attempt);
      }
    };
  }, []);

  function handlePersonalizedClick() {
    if (activeAttempt.current) {
      return;
    }

    const controller = new AbortController();
    const attempt: GoalContactAttempt = {
      controller,
      locationHref: window.location.href,
      timeout: setTimeout(() => {
        if (!cancelGoalContactAttempt(activeAttempt, attempt)) {
          return;
        }
        setStatus("failed");
      }, GOAL_CONTACT_RESOLUTION_TIMEOUT_MS),
    };
    activeAttempt.current = attempt;
    setStatus("opening");

    void resolvePersonalizedGoalContact({
      goalRouteId,
      signal: controller.signal,
    })
      .then((resolvedOption) => {
        if (
          activeAttempt.current !== attempt
          || controller.signal.aborted
        ) {
          return;
        }
        if (window.location.href !== attempt.locationHref) {
          cancelGoalContactAttempt(activeAttempt, attempt);
          setStatus("idle");
          return;
        }

        finishGoalContactAttempt(activeAttempt, attempt);
        try {
          window.location.assign(resolvedOption.href);
          setStatus("idle");
        } catch {
          setStatus("failed");
        }
      })
      .catch(() => {
        if (!finishGoalContactAttempt(activeAttempt, attempt)) {
          return;
        }
        setStatus("failed");
      });
  }

  return (
    <>
      <button
        aria-label="Build my plan with Murph"
        aria-busy={status === "opening"}
        className={cn(buttonVariants({ size: "xl" }), "w-full sm:w-auto")}
        disabled={status === "opening"}
        onClick={handlePersonalizedClick}
        type="button"
      >
        <GoalContactActionContents />
      </button>
      {status === "failed" ? (
        <p className="mt-2 text-sm text-muted-foreground" role="status">
          Couldn’t open your Murph chat. Try again.
        </p>
      ) : null}
    </>
  );
}

async function resolvePersonalizedGoalContact(input: {
  goalRouteId: string;
  signal: AbortSignal;
}): Promise<MurphContactOption> {
  const resolution = await requestHostedOnboardingJson<GoalContactResolution>({
    method: "POST",
    payload: { goalRouteId: input.goalRouteId },
    signal: input.signal,
    url: GOAL_CONTACT_RESOLUTION_PATH,
  });
  return resolution.option;
}

function finishGoalContactAttempt(
  activeAttempt: React.RefObject<GoalContactAttempt | null>,
  attempt: GoalContactAttempt,
): boolean {
  if (activeAttempt.current !== attempt) {
    return false;
  }

  clearTimeout(attempt.timeout);
  activeAttempt.current = null;
  return true;
}

function cancelGoalContactAttempt(
  activeAttempt: React.RefObject<GoalContactAttempt | null>,
  attempt: GoalContactAttempt,
): boolean {
  if (!finishGoalContactAttempt(activeAttempt, attempt)) {
    return false;
  }

  attempt.controller.abort();
  return true;
}

function GoalContactActionContents() {
  return (
    <>
      <Image
        alt=""
        aria-hidden="true"
        className="h-6 w-auto brightness-0 invert"
        height={24}
        src="/icons/murph-mark.svg"
        width={36}
      />
      Build my plan
      <ArrowRight data-icon="inline-end" aria-hidden="true" />
    </>
  );
}
