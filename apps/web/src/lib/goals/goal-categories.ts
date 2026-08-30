export const GOAL_CATEGORIES = [
  {
    description: "Build a sleep schedule that leaves you rested and ready for the day.",
    featuredRouteIds: [
      "sleep-better",
      "improve-deep-sleep",
      "fall-asleep-faster",
      "sleep-through-the-night",
    ],
    label: "Sleep",
    slug: "sleep",
  },
  {
    description: "Eat in a way that supports your health, energy, and everyday life.",
    featuredRouteIds: [
      "lose-weight",
      "hit-protein-target",
      "eat-balanced-diet",
      "improve-digestion",
    ],
    label: "Nutrition",
    slug: "nutrition",
  },
  {
    description: "Improve endurance, heart health, and the activities you want to finish.",
    featuredRouteIds: [
      "improve-vo2-max",
      "run-ironman",
      "run-first-5k",
      "build-aerobic-base",
    ],
    label: "Cardio",
    slug: "cardio",
  },
  {
    description: "Get stronger, move better, and build useful physical skills.",
    featuredRouteIds: [
      "get-stronger",
      "build-muscle",
      "dunk-basketball",
      "reduce-knee-pain",
    ],
    label: "Strength",
    slug: "strength",
  },
  {
    description: "Support focus, mood, stress, and the way you feel day to day.",
    featuredRouteIds: [
      "reduce-stress",
      "feel-more-energetic",
      "improve-focus",
      "build-a-habit",
    ],
    label: "Mind",
    slug: "mind",
  },
  {
    description: "Work toward healthier measurements you can follow over time.",
    featuredRouteIds: [
      "lower-resting-heart-rate",
      "improve-hrv",
      "lower-blood-pressure",
      "lower-ldl-cholesterol",
    ],
    label: "Biomarkers",
    slug: "biomarkers",
  },
  {
    description: "Stay healthy through pregnancy, menopause, aging, and other life stages.",
    featuredRouteIds: [
      "stay-strong-as-i-age",
      "return-to-running-postpartum",
      "sleep-better-during-menopause",
      "get-ready-for-pregnancy",
    ],
    label: "Life stages",
    slug: "life-stages",
  },
] as const;

export type GoalCategorySlug = (typeof GOAL_CATEGORIES)[number]["slug"];
export type GoalCategory = (typeof GOAL_CATEGORIES)[number];

const GOAL_CATEGORY_BY_SLUG = new Map<GoalCategorySlug, GoalCategory>(
  GOAL_CATEGORIES.map((category) => [category.slug, category]),
);

export function isGoalCategorySlug(value: string): value is GoalCategorySlug {
  return GOAL_CATEGORY_BY_SLUG.has(value as GoalCategorySlug);
}

export function getGoalCategory(value: string): GoalCategory | null {
  return GOAL_CATEGORY_BY_SLUG.get(value as GoalCategorySlug) ?? null;
}
