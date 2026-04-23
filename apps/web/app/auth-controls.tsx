"use client";

import { useState } from "react";

import { HostedAuthPanel } from "@/src/components/hosted-onboarding/hosted-auth-panel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import { cn } from "@/src/lib/utils";

type LandingAuthContext = "nav" | "hero" | "footer";
type LandingAuthIntent = "signup" | "signin";

function LandingAuthDialogButton({
  buttonClassName,
  buttonLabel,
  description,
  intent,
  showArrow = false,
  showLegalNotice = false,
  title,
}: {
  buttonClassName: string;
  buttonLabel: string;
  description: string;
  intent: LandingAuthIntent;
  showArrow?: boolean;
  showLegalNotice?: boolean;
  title: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={buttonClassName}
        onClick={() => setOpen(true)}
      >
        <span>{buttonLabel}</span>
        {showArrow ? (
          <span
            aria-hidden="true"
            className="inline-block transition-transform group-hover:translate-x-0.5"
          >
            &rarr;
          </span>
        ) : null}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md p-6 md:p-7">
          <DialogHeader className="pr-10">
            <DialogTitle className="text-xl font-bold tracking-tight text-stone-900">
              {title}
            </DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {open ? (
            <HostedAuthPanel
              intent={intent}
              methods={["phone", "telegram", "email"]}
              showLegalNotice={showLegalNotice}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function getLandingAuthClasses(context: LandingAuthContext) {
  switch (context) {
    case "nav":
      return {
        container: "flex items-center gap-2 sm:gap-3",
        settings:
          "inline-flex items-center rounded-lg bg-[#5a6e32] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#4d5f2a] sm:px-4 sm:text-sm",
        signin:
          "inline-flex items-center rounded-lg border border-white/25 px-3 py-1.5 text-xs font-medium text-white/85 transition-colors hover:border-white/40 hover:bg-white/5 sm:px-4 sm:text-sm",
        signup:
          "inline-flex items-center rounded-lg bg-[#5a6e32] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#4d5f2a] sm:px-4 sm:text-sm",
      };
    case "footer":
      return {
        container: "flex flex-wrap items-center gap-3",
        settings:
          "inline-flex items-center rounded-xl bg-[#5a6e32] px-5 py-3 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-[#4d5f2a]",
        signin:
          "inline-flex items-center rounded-xl border border-[#f5f0e8]/20 px-5 py-3 text-[0.9375rem] font-medium text-[#f5f0e8]/85 transition-colors hover:border-[#f5f0e8]/35 hover:bg-white/5",
        signup:
          "group inline-flex items-center gap-2 rounded-xl bg-[#5a6e32] px-5 py-3 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-[#4d5f2a]",
      };
    case "hero":
      return {
        container: "flex flex-wrap items-center gap-4",
        settings:
          "inline-flex items-center rounded-xl bg-[#5a6e32] px-5 py-3.5 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-[#4d5f2a]",
        signin:
          "inline-flex items-center rounded-xl border border-white/25 px-5 py-3.5 text-[0.9375rem] font-medium text-white/85 transition-colors hover:border-white/40 hover:bg-white/5",
        signup:
          "group inline-flex items-center gap-2 rounded-xl bg-[#5a6e32] px-5 py-3.5 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-[#4d5f2a]",
      };
  }
}

export function LandingAuthActions({
  authenticated,
  context,
  showSignIn = true,
  signupLabel,
}: {
  authenticated: boolean;
  context: LandingAuthContext;
  showSignIn?: boolean;
  signupLabel: string;
}) {
  const styles = getLandingAuthClasses(context);

  if (authenticated) {
    return (
      <div className={styles.container}>
        <a href="/settings" className={styles.settings}>
          Your account
        </a>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <LandingAuthDialogButton
        buttonClassName={cn(
          styles.signup,
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5a6e32]"
        )}
        buttonLabel={signupLabel}
        description="Use your phone number, email address, or Telegram to get started."
        intent="signup"
        showArrow={context !== "nav"}
        showLegalNotice
        title="Sign up for Murph"
      />
      {showSignIn ? (
        <LandingAuthDialogButton
          buttonClassName={styles.signin}
          buttonLabel="Sign in"
          description="Use your previously linked phone number, email address, or Telegram account to sign in."
          intent="signin"
          title="Sign in to Murph"
        />
      ) : null}
    </div>
  );
}
