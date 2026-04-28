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

function LandingAuthDialogButton({
  buttonClassName,
  buttonLabel,
  description,
  showArrow = false,
  showLegalNotice = false,
  title,
}: {
  buttonClassName: string;
  buttonLabel: string;
  description: string;
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
        signup:
          "inline-flex items-center rounded-lg bg-[#5a6e32] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#4d5f2a] sm:px-4 sm:text-sm",
      };
    case "footer":
      return {
        container: "flex flex-wrap items-center gap-3",
        settings:
          "inline-flex items-center rounded-xl bg-[#5a6e32] px-5 py-3 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-[#4d5f2a]",
        signup:
          "group inline-flex items-center gap-2 rounded-xl bg-[#5a6e32] px-5 py-3 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-[#4d5f2a]",
      };
    case "hero":
      return {
        container: "flex flex-wrap items-center gap-4",
        settings:
          "inline-flex items-center rounded-xl bg-[#5a6e32] px-5 py-3.5 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-[#4d5f2a]",
        signup:
          "group inline-flex items-center gap-2 rounded-xl bg-[#5a6e32] px-5 py-3.5 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-[#4d5f2a]",
      };
  }
}

export function LandingAuthActions({
  authLabel,
  authenticated,
  context,
}: {
  authLabel: string;
  authenticated: boolean;
  context: LandingAuthContext;
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
        buttonLabel={authLabel}
        description="Discover what actually makes you healthier."
        showArrow={context !== "nav"}
        showLegalNotice
        title="Log in or sign up"
      />
    </div>
  );
}
