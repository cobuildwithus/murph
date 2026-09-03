import Image from "next/image";
import Link from "next/link";

import { cn } from "@/src/lib/utils";

export interface GoalBrowseCardModel {
  href: string;
  illustrationSrc?: string | null;
  prefetch?: boolean;
  title: string;
}

export function GoalBrowseCard({
  className,
  href,
  illustrationSrc,
  prefetch,
  title,
}: GoalBrowseCardModel & { className?: string }) {
  return (
    <Link
      href={href}
      prefetch={prefetch}
      className={cn(
        "group flex min-h-20 items-center gap-3.5 rounded-xl border border-black/[0.07] bg-[#fffdf8] p-4 transition-colors hover:border-black/[0.16] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[#f5f0e8] sm:min-h-24 sm:gap-4 sm:p-5",
        className,
      )}
    >
      {illustrationSrc ? (
        <Image
          alt=""
          aria-hidden="true"
          className="size-12 shrink-0 sm:size-14"
          data-goal-illustration
          height={56}
          src={illustrationSrc}
          width={56}
        />
      ) : null}
      <div className="min-w-0">
        <h3 className="font-serif text-base font-semibold leading-snug tracking-[-0.015em] text-balance text-foreground transition-colors group-hover:text-primary sm:text-lg">
          {title}
        </h3>
      </div>
    </Link>
  );
}
