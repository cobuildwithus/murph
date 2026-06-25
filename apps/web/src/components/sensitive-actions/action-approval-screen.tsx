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
    <main className="min-h-dvh bg-background px-4 py-10 text-foreground sm:px-6 sm:py-14">
      <section className="mx-auto flex min-h-[78vh] max-w-xl flex-col justify-center">
        <article className="rounded-2xl border border-[#c4a882]/25 bg-[rgba(255,252,246,0.9)] p-7 sm:p-10">
          <header className="flex items-center gap-3.5">
            <span
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-full border",
                badgeTone === "primary"
                  ? "border-[#7a8c6e]/30 bg-[#7a8c6e]/12"
                  : "border-[#c4a882]/40 bg-[rgba(196,168,130,0.18)]",
              )}
            >
              <BadgeIcon
                aria-hidden="true"
                className={cn(
                  "h-[18px] w-[18px]",
                  badgeTone === "primary" ? "text-[#5a6e32]" : "text-muted-foreground",
                )}
              />
            </span>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Secure approval
            </p>
          </header>

          <h1 className="mt-7 font-serif text-[2.125rem] leading-[1.05] tracking-[-0.02em] text-foreground text-balance sm:text-[2.5rem]">
            {title}
          </h1>

          <div className="mt-5 text-[15px] leading-[1.6] text-muted-foreground text-pretty">
            {body}
          </div>

          {caveat ? (
            <div className="mt-6 border-l-[3px] border-l-[#7a8c6e] py-0.5 pl-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#5a6e32]">
                Bound to this request
              </p>
              <p className="mt-1.5 text-[13px] leading-[1.55] text-muted-foreground">
                {caveat}
              </p>
            </div>
          ) : null}

          {children}
        </article>
      </section>
    </main>
  );
}
