import Image from "next/image";

import type { GoalCategorySlug } from "@/src/lib/goals/goal-categories";
import { cn } from "@/src/lib/utils";

interface GoalCategoryVisual {
  accentClassName: string;
  artwork: string;
  borderClassName: string;
  surfaceClassName: string;
}

const CATEGORY_VISUALS: Record<GoalCategorySlug, GoalCategoryVisual> = {
  sleep: {
    accentClassName: "text-[#38566f]",
    artwork: "/design-assets/habitat/bed.svg",
    borderClassName: "border-[#38566f]/15",
    surfaceClassName: "bg-[#e8eef4]",
  },
  nutrition: {
    accentClassName: "text-[#516237]",
    artwork: "/design-assets/patterns/meal.svg",
    borderClassName: "border-[#516237]/15",
    surfaceClassName: "bg-[#edf0e4]",
  },
  cardio: {
    accentClassName: "text-[#944e37]",
    artwork: "/design-assets/patterns/running.svg",
    borderClassName: "border-[#944e37]/15",
    surfaceClassName: "bg-[#f4e8df]",
  },
  strength: {
    accentClassName: "text-[#355747]",
    artwork: "/design-assets/patterns/strength.svg",
    borderClassName: "border-[#355747]/15",
    surfaceClassName: "bg-[#e7eee9]",
  },
  mind: {
    accentClassName: "text-[#67546f]",
    artwork: "/design-assets/patterns/mind-body.svg",
    borderClassName: "border-[#67546f]/15",
    surfaceClassName: "bg-[#eee8f0]",
  },
  biomarkers: {
    accentClassName: "text-[#275a50]",
    artwork: "/design-assets/patterns/performance.svg",
    borderClassName: "border-[#275a50]/15",
    surfaceClassName: "bg-[#e4eeeb]",
  },
  "life-stages": {
    accentClassName: "text-[#84563e]",
    artwork: "/design-assets/patterns/parenting.svg",
    borderClassName: "border-[#84563e]/15",
    surfaceClassName: "bg-[#f2e9e2]",
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
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-2xl border",
        visual.surfaceClassName,
        visual.borderClassName,
        className,
      )}
      data-goal-category-visual={category}
    >
      <Image
        alt=""
        className={cn("size-full object-contain p-2", imageClassName)}
        height={128}
        preload={preload}
        src={visual.artwork}
        width={128}
      />
    </span>
  );
}
