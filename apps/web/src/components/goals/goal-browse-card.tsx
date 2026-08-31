import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { GoalOutcomeMark, getGoalCategoryVisual } from "@/src/components/goals/goal-visual";
import type { GoalCategorySlug } from "@/src/lib/goals/goal-categories";
import type { GoalOutcomeKind } from "@/src/lib/goals/goal-models";
import { cn } from "@/src/lib/utils";

export interface GoalBrowseCardModel {
  category: GoalCategorySlug;
  categoryLabel: string;
  href: string;
  outcomeKind: GoalOutcomeKind;
  summary: string;
  title: string;
}

export function GoalBrowseCard({
  category,
  categoryLabel,
  className,
  href,
  outcomeKind,
  summary,
  title,
}: GoalBrowseCardModel & { className?: string }) {
  const visual = getGoalCategoryVisual(category);

  return (
    <Link
      href={href}
      className={cn(
        "group flex min-h-[8.75rem] flex-row overflow-hidden rounded-[1.25rem] border border-black/[0.06] bg-[#fffdf8] shadow-[0_1px_2px_rgba(45,52,54,0.03)] transition-[border-color,box-shadow,transform] motion-safe:hover:-translate-y-0.5 hover:border-black/[0.12] hover:shadow-[0_16px_36px_-28px_rgba(45,52,54,0.35)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[#f5f0e8] sm:min-h-[17rem] sm:flex-col",
        className,
      )}
    >
      <div
        className={cn(
          "relative flex w-20 shrink-0 flex-col items-center justify-center gap-3 overflow-hidden border-r px-3 sm:h-20 sm:w-auto sm:flex-row sm:justify-between sm:border-b sm:border-r-0 sm:px-5",
          visual.surfaceClassName,
          visual.borderClassName,
        )}
      >
        <span
          className={cn(
            "relative z-10 hidden font-mono text-[10px] font-medium uppercase tracking-[0.14em] sm:inline",
            visual.accentClassName,
          )}
        >
          {categoryLabel}
        </span>
        <span
          aria-hidden="true"
          className="absolute -right-8 -top-12 size-32 rounded-full border border-current opacity-[0.08]"
        />
        <GoalOutcomeMark category={category} outcomeKind={outcomeKind} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col p-4 sm:p-5">
        <h3 className="font-serif text-lg font-semibold leading-snug tracking-[-0.015em] text-balance text-foreground sm:text-xl">
          {title}
        </h3>
        <p className="mt-1.5 line-clamp-2 text-sm/5 text-pretty text-muted-foreground sm:mt-2 sm:line-clamp-3 sm:text-sm/6">
          {summary}
        </p>
        <ArrowRight
          aria-hidden="true"
          className="mt-auto size-4 self-end text-muted-foreground transition-transform motion-safe:group-hover:translate-x-1"
        />
      </div>
    </Link>
  );
}
