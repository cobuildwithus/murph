"use client";

import Link from "next/link";
import {
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { useAuth } from "@/src/components/hosted-onboarding/auth-dialog-provider";
import {
  type MurphContactOption,
  withMurphContactOptionBody,
} from "@/src/lib/murph-contact-routing";

// Platforms whose sms: links open a real messaging app. Everything else
// (Windows, Linux, ChromeOS desktops) gets the signup dialog instead.
const NATIVE_MESSAGING_PLATFORM_PATTERN = /Macintosh|iPhone|iPad|iPod|Android/u;

function subscribeToNothing(): () => void {
  return () => {};
}

function readNativeMessagingPlatform(): boolean {
  return NATIVE_MESSAGING_PLATFORM_PATTERN.test(window.navigator.userAgent);
}

// The server cannot know the platform; null keeps the first client render
// identical to the server markup, then React re-renders with the real value.
function readNativeMessagingPlatformOnServer(): boolean | null {
  return null;
}

export type GoalHandoffKind = "guide" | "message" | "signup";

/**
 * Where a goal click goes. Members and uncertain sessions open the guide,
 * whose CTA resolves their own Murph line. Anonymous visitors message Murph
 * directly when the platform can, and otherwise open the signup dialog.
 */
export type GoalHandoff =
  | { kind: "guide" }
  | {
      external: boolean;
      hrefFor: (prompt: string | null) => string;
      kind: "message";
    }
  | { kind: "signup"; open: () => void; prepare: () => void };

export type GoalHandoffLabels = Partial<Record<GoalHandoffKind, string>>;

export function useGoalHandoff(option: MurphContactOption): GoalHandoff {
  const auth = useAuth();
  const nativeMessaging = useSyncExternalStore(
    subscribeToNothing,
    readNativeMessagingPlatform,
    readNativeMessagingPlatformOnServer,
  );

  if (auth.authenticated || auth.authenticationStatus === "unavailable") {
    return { kind: "guide" };
  }
  if (option.kind !== "text" || nativeMessaging !== false) {
    return {
      external: option.target === "_blank",
      hrefFor: (prompt) =>
        prompt ? withMurphContactOptionBody(option, prompt).href : option.href,
      kind: "message",
    };
  }
  return { kind: "signup", open: auth.openAuthDialog, prepare: auth.prepareAuth };
}

/**
 * One clickable goal rendered as whatever the handoff needs: a guide link, a
 * message link, or a button that opens signup. Icon-only children should pass
 * `labels`; children with visible text name themselves.
 */
export function GoalHandoffAction({
  children,
  className,
  guideHref,
  handoff,
  labels,
  prompt,
  ref,
  ...dataProps
}: {
  children: ReactNode;
  className: string;
  guideHref: string;
  handoff: GoalHandoff;
  labels?: GoalHandoffLabels;
  prompt: string | null;
  ref?: React.RefCallback<HTMLElement>;
  "data-goal-composer-send"?: boolean;
  "data-goal-composer-ready"?: boolean;
}) {
  if (handoff.kind === "guide") {
    return (
      <Link
        {...dataProps}
        aria-label={labels?.guide}
        className={className}
        href={guideHref}
        prefetch={false}
        ref={ref}
      >
        {children}
      </Link>
    );
  }
  if (handoff.kind === "message") {
    return (
      <a
        {...dataProps}
        aria-label={labels?.message}
        className={className}
        href={handoff.hrefFor(prompt)}
        ref={ref}
        {...(handoff.external ? { rel: "noreferrer", target: "_blank" } : {})}
      >
        {children}
      </a>
    );
  }
  return (
    <button
      {...dataProps}
      aria-label={labels?.signup}
      className={className}
      onClick={handoff.open}
      onFocus={handoff.prepare}
      onPointerEnter={handoff.prepare}
      ref={ref}
      type="button"
    >
      {children}
    </button>
  );
}
