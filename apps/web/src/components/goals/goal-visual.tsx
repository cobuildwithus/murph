import Image from "next/image";

import type { GoalCategorySlug } from "@/src/lib/goals/goal-categories";
import { resolveGoalIllustrationSrc } from "@/src/lib/goals/goal-illustrations";
import { cn } from "@/src/lib/utils";

interface GoalCategoryVisual {
  artwork: string;
}

const CATEGORY_VISUALS: Record<GoalCategorySlug, GoalCategoryVisual> = {
  sleep: {
    artwork: "/design-assets/habitat/bed.svg",
  },
  nutrition: {
    artwork: "/design-assets/patterns/meal.svg",
  },
  cardio: {
    artwork: "/design-assets/patterns/running.svg",
  },
  strength: {
    artwork: "/design-assets/patterns/strength.svg",
  },
  mind: {
    artwork: "/design-assets/patterns/mind-body.svg",
  },
  biomarkers: {
    artwork: "/design-assets/patterns/performance.svg",
  },
  "life-stages": {
    artwork: "/design-assets/patterns/parenting.svg",
  },
};

export function getGoalCategoryVisual(
  category: GoalCategorySlug,
): GoalCategoryVisual {
  return CATEGORY_VISUALS[category];
}

export function GoalCategoryArtwork({
  category,
  className,
  imageClassName,
  preload = false,
}: {
  category: GoalCategorySlug;
  className?: string;
  imageClassName?: string;
  preload?: boolean;
}) {
  const visual = getGoalCategoryVisual(category);

  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border/80 bg-[#eee9df]/70",
        className,
      )}
      data-goal-category-visual={category}
    >
      <Image
        alt=""
        className={cn(
          "size-full object-contain p-2 opacity-60 saturate-50",
          imageClassName,
        )}
        height={128}
        preload={preload}
        src={visual.artwork}
        width={128}
      />
    </span>
  );
}

export function GoalHeroArtwork({
  category,
  className,
  imageClassName,
  preload = false,
  routeId,
}: {
  category: GoalCategorySlug;
  className?: string;
  imageClassName?: string;
  preload?: boolean;
  routeId: string;
}) {
  const illustrationSrc = resolveGoalIllustrationSrc(routeId);

  if (!illustrationSrc) {
    return (
      <GoalCategoryArtwork
        category={category}
        className={className}
        imageClassName={imageClassName}
        preload={preload}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border/80 bg-[#fffdf8]",
        className,
      )}
      data-goal-hero-visual={routeId}
    >
      <Image
        alt=""
        className={cn("size-full object-contain p-2", imageClassName)}
        data-goal-illustration
        height={128}
        preload={preload}
        src={illustrationSrc}
        width={128}
      />
    </span>
  );
}
