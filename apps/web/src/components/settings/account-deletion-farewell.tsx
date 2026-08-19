import Image from "next/image";
import Link from "next/link";
import { forwardRef } from "react";

import { cn } from "@/src/lib/utils";

export const ACCOUNT_DELETION_FAREWELL_PATH = "/farewell";

export function buildAccountDeletionFarewellPath(
  cleanupPending: boolean,
): string {
  return cleanupPending
    ? `${ACCOUNT_DELETION_FAREWELL_PATH}?cleanup=pending`
    : ACCOUNT_DELETION_FAREWELL_PATH;
}

export const AccountDeletionFarewell = forwardRef<HTMLDivElement, {
  cleanupPending: boolean;
  takeover?: boolean;
}>(function AccountDeletionFarewell({ cleanupPending, takeover = false }, ref) {
  return (
    <div
      ref={ref}
      className={cn(
        "min-h-dvh overflow-y-auto bg-background px-6 py-7 text-foreground sm:px-10 sm:py-9 lg:px-16",
        takeover && "fixed inset-0 z-[100]",
      )}
      data-account-deletion-farewell="true"
      tabIndex={-1}
    >
      <div className="mx-auto flex min-h-[calc(100dvh-3.5rem)] max-w-6xl flex-col sm:min-h-[calc(100dvh-4.5rem)]">
        {takeover ? (
          <Image
            alt="Murph"
            className="h-6 w-auto"
            height={24}
            priority
            src="/logo.svg"
            width={107}
          />
        ) : (
          <Link
            aria-label="Murph home"
            className="w-fit rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
            href="/"
          >
            <Image
              alt="Murph"
              className="h-6 w-auto"
              height={24}
              priority
              src="/logo.svg"
              width={107}
            />
          </Link>
        )}

        <div className="flex flex-1 items-center py-14 sm:py-20">
          <section
            aria-live={takeover ? "polite" : undefined}
            className="w-full max-w-2xl"
          >
            <div className="mb-7 flex items-center gap-3 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground sm:mb-9">
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full bg-primary"
              />
              Account closed
            </div>

            <h1 className="max-w-xl text-balance font-serif text-5xl font-semibold leading-[1.02] tracking-[-0.035em] sm:text-6xl lg:text-7xl">
              Farewell for now.
            </h1>
            <div className="mt-7 max-w-xl space-y-4 text-base leading-7 text-muted-foreground sm:mt-9 sm:text-lg sm:leading-8">
              <p>
                {cleanupPending
                  ? "Your account has been deleted. Murph is finishing a small amount of technical cleanup in the background; no action is needed."
                  : "Your Murph account and live data have been deleted."}
              </p>
              <p>
                Thank you for spending some time with us. If you ever decide to
                come back, we&apos;ll be here.
              </p>
            </div>

            <div className="mt-10 border-t border-border pt-6 sm:mt-12">
              {takeover ? (
                <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Clearing this browser session
                </p>
              ) : (
                <Link
                  className="inline-flex min-h-11 items-center rounded-lg bg-foreground px-5 text-sm font-medium text-background transition-colors hover:bg-foreground/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  href="/"
                >
                  Return to Murph
                </Link>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
});
