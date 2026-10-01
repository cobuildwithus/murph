import Image from "next/image";
import Link from "next/link";

import { cn } from "@/src/lib/utils";

export interface GoalBrowseCardModel {
  href: string;
  /** Extra classes for the art, e.g. to hide it where the card is too narrow. */
  illustrationClassName?: string;
  illustrationSrc?: string | null;
  prefetch?: boolean;
  title: string;
}

export const GOAL_BROWSE_CARD_CLASS_NAME =
  "group flex min-h-20 items-center gap-3.5 rounded-xl border border-black/[0.07] bg-[#fffdf8] p-4 transition-colors hover:border-black/[0.16] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[#f5f0e8] sm:min-h-24 sm:gap-4 sm:p-5";

export const GOAL_BROWSE_CARD_TITLE_CLASS_NAME =
  "font-serif text-base font-semibold leading-snug tracking-[-0.015em] text-balance break-words text-foreground transition-colors group-hover:text-primary sm:text-lg";

export function GoalBrowseCardIllustration({
  className,
  src,
}: {
  className?: string;
  src?: string | null;
}) {
  if (!src) {
    return null;
  }

  return (
    <Image
      alt=""
      aria-hidden="true"
      // Two-column cards at 320px leave no room beside the art, so the
      // narrowest phones get title-only cards.
      className={cn(
        "hidden size-12 shrink-0 min-[360px]:block sm:size-14",
        className,
      )}
      data-goal-illustration
      height={56}
      src={src}
      width={56}
    />
  );
}

export function GoalBrowseCard({
  className,
  href,
  illustrationClassName,
  illustrationSrc,
  prefetch,
  title,
}: GoalBrowseCardModel & { className?: string }) {
  return (
    <Link
      href={href}
      prefetch={prefetch}
      className={cn(GOAL_BROWSE_CARD_CLASS_NAME, className)}
    >
      <GoalBrowseCardIllustration
        className={illustrationClassName}
        src={illustrationSrc}
      />
      <div className="min-w-0">
        <h3 className={GOAL_BROWSE_CARD_TITLE_CLASS_NAME}>
          {title}
        </h3>
      </div>
    </Link>
  );
}
