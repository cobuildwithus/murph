import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/src/lib/utils";

type BadgeTone = "primary" | "muted";

interface ActionApprovalScreenProps {
  badgeIcon: LucideIcon;
  badgeTone?: BadgeTone;
  body: ReactNode;
  caveat?: ReactNode;
  children?: ReactNode;
  title: string;
}

export function ActionApprovalScreen({
  badgeIcon: BadgeIcon,
  badgeTone = "primary",
  body,
  caveat,
  children,
  title,
}: ActionApprovalScreenProps) {
  return (
    <main className="min-h-dvh bg-background px-4 py-8 text-foreground sm:px-6">
      <section className="mx-auto flex min-h-[78vh] max-w-xl flex-col justify-center">
        <div className="rounded-2xl border border-border bg-card p-6 sm:p-8">
          <span className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-background">
            <BadgeIcon
              aria-hidden="true"
              className={cn(
                "h-5 w-5",
                badgeTone === "primary" ? "text-primary" : "text-muted-foreground",
              )}
            />
          </span>
          <p className="mt-6 font-mono text-xs uppercase tracking-wide text-muted-foreground">
            Secure approval
          </p>
          <h1 className="mt-3 font-serif text-3xl leading-tight text-balance">
            {title}
          </h1>
          <div className="mt-4 text-sm leading-6 text-muted-foreground text-pretty">
            {body}
          </div>
          {caveat ? (
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              {caveat}
            </p>
          ) : null}
          {children}
        </div>
      </section>
    </main>
  );
}
