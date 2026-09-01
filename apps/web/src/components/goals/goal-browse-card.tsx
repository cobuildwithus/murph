import Link from "next/link";

import { cn } from "@/src/lib/utils";

export interface GoalBrowseCardModel {
  href: string;
  prefetch?: boolean;
  title: string;
}

export function GoalBrowseCard({
  className,
  href,
  prefetch,
  title,
}: GoalBrowseCardModel & { className?: string }) {
  return (
    <Link
      href={href}
      prefetch={prefetch}
      className={cn(
        "flex min-h-20 items-center rounded-xl border border-black/[0.07] bg-[#fffdf8] p-4 shadow-[0_1px_2px_rgba(45,52,54,0.03)] transition-[border-color,background-color,box-shadow,transform] motion-safe:hover:-translate-y-0.5 hover:border-black/[0.13] hover:shadow-[0_14px_30px_-26px_rgba(45,52,54,0.35)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[#f5f0e8] sm:min-h-24 sm:p-5",
        className,
      )}
    >
      <div className="min-w-0">
        <h3 className="font-serif text-base font-semibold leading-snug tracking-[-0.015em] text-balance text-foreground sm:text-lg">
          {title}
        </h3>
      </div>
    </Link>
  );
}
