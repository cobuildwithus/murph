"use client";

import Link from "next/link";
import {
  useEffect,
  useState,
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

export function useGoalHandoff(option: MurphContactOption): GoalHandoff {
  const auth = useAuth();
  const [nativeMessaging, setNativeMessaging] = useState<boolean | null>(null);

  useEffect(() => {
    setNativeMessaging(
      NATIVE_MESSAGING_PLATFORM_PATTERN.test(window.navigator.userAgent),
    );
  }, []);

  if (auth.authenticated || auth.authenticationStatus === "unavailable") {
    return { kind: "guide" };
  }
  // Before mount the platform is unknown; keep the message link so the server
  // and first client render agree, then swap on desktops that cannot text.
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

export function GoalHandoffAction({
  children,
  className,
  guideHref,
  handoff,
  label,
  prompt,
  ref,
  ...dataProps
}: {
  children: ReactNode;
  className: string;
  guideHref: string;
  handoff: GoalHandoff;
  label: string;
  prompt: string | null;
  ref?: React.Ref<HTMLElement>;
  "data-goal-composer-send"?: boolean;
  "data-goal-composer-ready"?: boolean;
}) {
  if (handoff.kind === "guide") {
    return (
      <Link
        {...dataProps}
        className={className}
        href={guideHref}
        prefetch={false}
        ref={ref as React.Ref<HTMLAnchorElement>}
      >
        {children}
      </Link>
    );
  }
  if (handoff.kind === "message") {
    return (
      <a
        {...dataProps}
        aria-label={label}
        className={className}
        href={handoff.hrefFor(prompt)}
        ref={ref as React.Ref<HTMLAnchorElement>}
        {...(handoff.external ? { rel: "noreferrer", target: "_blank" } : {})}
      >
        {children}
      </a>
    );
  }
  return (
    <button
      {...dataProps}
      aria-label={label}
      className={className}
      onClick={handoff.open}
      onFocus={handoff.prepare}
      onPointerEnter={handoff.prepare}
      ref={ref as React.Ref<HTMLButtonElement>}
      type="button"
    >
      {children}
    </button>
  );
}
