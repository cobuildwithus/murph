import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { cn } from "@/src/lib/utils";

export interface GoalBrowseCardModel {
  categoryLabel: string;
  href: string;
  summary: string;
  title: string;
}

export function GoalBrowseCard({
  categoryLabel,
  className,
  href,
  summary,
  title,
}: GoalBrowseCardModel & { className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex min-h-48 flex-col justify-between rounded-2xl border border-border/70 bg-card p-5 transition-[border-color,background-color,transform] hover:-translate-y-0.5 hover:border-foreground/20 hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {categoryLabel}
        </span>
        <ArrowUpRight
          className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
          aria-hidden="true"
        />
      </div>
      <div className="mt-10 flex flex-col gap-2">
        <h3 className="font-serif text-lg font-semibold leading-snug tracking-tight text-balance text-foreground">
          {title}
        </h3>
        <p className="line-clamp-3 text-sm/6 text-pretty text-muted-foreground">
          {summary}
        </p>
      </div>
    </Link>
  );
}
