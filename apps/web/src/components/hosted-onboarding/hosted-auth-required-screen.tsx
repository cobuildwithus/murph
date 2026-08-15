"use client";

import { LockKeyhole, type LucideIcon } from "lucide-react";
import { useEffect, type ReactNode } from "react";

import { useAuth } from "@/src/components/hosted-onboarding/auth-dialog-provider";
import { Button } from "@/src/components/ui/button";

interface HostedAuthRequiredScreenProps {
  description: ReactNode;
  details?: ReactNode;
  detailsCompact?: boolean;
  eyebrow: string;
  eyebrowIcon: LucideIcon;
  footer?: ReactNode;
  loginLabel?: string;
  title: string;
}

export function HostedAuthRequiredScreen(props: HostedAuthRequiredScreenProps) {
  const { authenticated, openAuthDialog } = useAuth();

  useEffect(() => {
    if (!authenticated) {
      openAuthDialog();
    }
  }, [authenticated, openAuthDialog]);

  return <HostedAuthRequiredScreenView {...props} onLogin={openAuthDialog} />;
}

/**
 * Presentation only. The design catalog renders this rather than the screen
 * above, whose effect would open the app-wide auth dialog over the catalog.
 */
export function HostedAuthRequiredScreenView({
  description,
  details,
  detailsCompact = false,
  eyebrow,
  eyebrowIcon: EyebrowIcon,
  footer,
  loginLabel = "Log in or sign up",
  onLogin,
  title,
}: HostedAuthRequiredScreenProps & { onLogin?: () => void }) {
  return (
    <main className="min-h-dvh bg-background px-4 py-8 text-foreground sm:px-6">
      <section className="mx-auto flex min-h-[78vh] max-w-xl flex-col items-center justify-center text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full border border-border bg-card">
          <LockKeyhole className="h-6 w-6 text-primary" aria-hidden="true" />
        </span>
        <p className="mt-6 flex items-center gap-2 font-mono text-xs uppercase text-muted-foreground">
          <EyebrowIcon className="h-4 w-4 text-primary" aria-hidden="true" />
          {eyebrow}
        </p>
        <h1 className="mt-4 font-serif text-3xl leading-tight text-balance sm:text-4xl">
          {title}
        </h1>
        <p className="mt-4 max-w-lg text-sm leading-6 text-muted-foreground text-pretty">
          {description}
        </p>

        {details ? (
          <div
            className={detailsCompact
              ? "mt-6 w-full max-w-lg rounded-xl border border-border bg-card p-4 text-left text-[13px] leading-5 text-muted-foreground sm:p-5 sm:text-sm sm:leading-6"
              : "mt-6 w-full max-w-lg rounded-xl border border-border bg-card p-5 text-left text-sm leading-6 text-muted-foreground"}
          >
            {details}
          </div>
        ) : null}

        <div className="mt-8 flex flex-col items-center gap-3">
          <Button type="button" size="lg" onClick={onLogin}>
            {loginLabel}
          </Button>
          {footer ? (
            <p className="max-w-sm text-xs leading-5 text-muted-foreground">
              {footer}
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
