import Link from "next/link";

import { GoalBrowseCard } from "@/src/components/goals/goal-browse-card";
import { GoalCategoryArtwork } from "@/src/components/goals/goal-visual";
import {
  GOAL_CATEGORIES,
  type GoalCategory,
} from "@/src/lib/goals/goal-categories";
import { resolveGoalIllustrationSrc } from "@/src/lib/goals/goal-illustrations";
import type { GoalIndexEntryModel } from "@/src/lib/goals/goal-models";

interface GoalBrowseNode {
  children: GoalBrowseNode[];
  goal: GoalIndexEntryModel;
}

interface GoalDirectoryEntry {
  depth: number;
  goal: GoalIndexEntryModel;
}

interface GoalDirectorySection {
  goals: GoalIndexEntryModel[];
  id: string;
  label: string;
}

const GOAL_DIRECTORY_GRID_CLASS_NAME =
  "grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3";

const CARDIO_DIRECTORY_SECTIONS = [
  {
    id: "fitness",
    label: "Cardio fitness",
    routeIds: [
      "improve-vo2-max",
      "improve-cardio-endurance",
      "improve-heart-rate-recovery",
      "get-150-minutes-of-cardio",
      "exercise-30-minutes-without-stopping",
      "climb-stairs-without-getting-winded",
    ],
  },
  {
    id: "running",
    label: "Running",
    routeIds: [
      "start-running",
      "return-to-running",
      "run-mile-without-stopping",
      "run-faster-mile",
      "run-first-5k",
      "run-faster-5k",
      "run-first-10k",
      "run-faster-10k",
      "run-half-marathon",
      "run-marathon",
      "run-trail-race",
      "run-ultramarathon",
    ],
  },
  {
    id: "cycling",
    label: "Cycling",
    routeIds: [
      "cycle-farther",
      "cycle-faster",
      "increase-cycling-power",
      "ride-100-miles",
    ],
  },
  {
    id: "swimming-rowing",
    label: "Swimming and rowing",
    routeIds: [
      "swim-farther-without-stopping",
      "swim-faster",
      "swim-one-mile",
      "improve-rowing-endurance",
      "row-faster-2k",
    ],
  },
  {
    id: "triathlon-endurance",
    label: "Triathlon and long-distance endurance",
    routeIds: [
      "complete-first-triathlon",
      "complete-olympic-triathlon",
      "complete-half-ironman",
      "run-ironman",
      "hike-longer",
      "complete-long-distance-hike",
      "ruck-farther",
    ],
  },
  {
    id: "everyday-sports",
    label: "Everyday movement and team sports",
    routeIds: [
      "walk-every-day",
      "sit-less",
      "jump-rope-10-minutes",
      "get-in-basketball-shape",
      "get-in-soccer-shape",
    ],
  },
] as const;

const SLEEP_DIRECTORY_SECTIONS = [
  {
    id: "quality",
    label: "Sleep quality",
    routeIds: [
      "sleep-better",
      "fall-asleep-faster",
      "improve-chronic-insomnia",
      "improve-deep-sleep",
      "improve-rem-sleep",
      "sleep-longer",
      "sleep-through-the-night",
      "wake-up-feeling-rested",
      "recover-from-sleep-debt",
      "reduce-sleep-anxiety",
      "have-fewer-nightmares",
    ],
  },
  {
    id: "schedule",
    label: "Sleep schedule and timing",
    routeIds: [
      "adjust-to-daylight-saving-time",
      "fix-my-sleep-schedule",
      "keep-a-consistent-sleep-schedule",
      "reduce-jet-lag",
      "sleep-better-on-night-shifts",
      "sleep-better-on-rotating-shifts",
      "stop-hitting-snooze",
      "stop-waking-up-too-early",
      "take-better-naps",
      "wake-up-earlier",
    ],
  },
  {
    id: "situations-comfort",
    label: "Sleep situations and comfort",
    routeIds: [
      "sleep-better-during-stressful-times",
      "sleep-better-in-hot-weather",
      "sleep-better-while-traveling",
      "sleep-better-with-a-partner-who-snores",
      "sleep-better-with-acid-reflux",
      "sleep-better-with-allergies",
      "sleep-better-with-chronic-pain",
      "sleep-better-with-noise",
    ],
  },
  {
    id: "snoring-apnea",
    label: "Snoring and sleep apnea",
    routeIds: [
      "get-sleep-apnea-under-control",
      "use-cpap-consistently",
      "snore-less",
    ],
  },
  {
    id: "nighttime-symptoms",
    label: "Nighttime symptoms",
    routeIds: [
      "feel-less-sleepy-during-the-day",
      "reduce-nighttime-teeth-grinding",
      "reduce-restless-legs-at-night",
    ],
  },
] as const;

const LIFE_STAGES_DIRECTORY_SECTIONS = [
  {
    id: "healthy-aging",
    label: "Healthy aging",
    routeIds: [
      "stay-independent-as-i-age",
      "stay-strong-as-i-age",
      "improve-balance-as-i-age",
      "keep-my-brain-healthy-as-i-age",
      "stay-mobile-as-i-age",
    ],
  },
  {
    id: "fertility-reproductive-health",
    label: "Fertility and reproductive health",
    routeIds: [
      "get-ready-for-pregnancy",
      "improve-sperm-health",
      "improve-erectile-health",
    ],
  },
  {
    id: "pregnancy-wellbeing",
    label: "Pregnancy wellbeing",
    routeIds: [
      "eat-well-during-pregnancy",
      "reduce-back-pain-during-pregnancy",
      "sleep-better-during-pregnancy",
      "stay-active-during-pregnancy",
      "stay-strong-during-pregnancy",
    ],
  },
  {
    id: "postpartum-recovery",
    label: "Postpartum recovery",
    routeIds: [
      "recover-after-giving-birth",
      "return-to-exercise-postpartum",
      "return-to-running-postpartum",
      "improve-postpartum-mental-health",
      "rebuild-core-strength-after-birth",
      "rebuild-pelvic-floor-after-birth",
    ],
  },
  {
    id: "menopause-health",
    label: "Menopause health",
    routeIds: [
      "reduce-hot-flashes",
      "reduce-night-sweats",
      "improve-vaginal-comfort-after-menopause",
      "protect-bone-health-after-menopause",
      "sleep-better-during-menopause",
      "stay-strong-through-menopause",
    ],
  },
  {
    id: "period-pelvic-health",
    label: "Period and pelvic health",
    routeIds: [
      "have-more-regular-periods",
      "improve-bladder-control",
      "reduce-pain-during-sex",
      "reduce-period-pain",
      "reduce-pms-symptoms",
    ],
  },
] as const;

const CURATED_DIRECTORY_SECTIONS: Partial<
  Record<GoalCategory["slug"], readonly {
    id: string;
    label: string;
    routeIds: readonly string[];
  }[]>
> = {
  cardio: CARDIO_DIRECTORY_SECTIONS,
  "life-stages": LIFE_STAGES_DIRECTORY_SECTIONS,
  sleep: SLEEP_DIRECTORY_SECTIONS,
};

const FAMILY_SECTION_LABELS: Readonly<Record<string, string>> = {
  "build-a-habit": "Habits and routines",
  "build-a-support-system": "Support and connection",
  "build-muscle": "Muscle growth",
  "build-stronger-bones": "Bone health",
  "correct-iron-deficiency": "Iron health",
  "drink-less-alcohol": "Alcohol use",
  "eat-balanced-diet": "Everyday nutrition",
  "get-ready-for-pregnancy": "Fertility and pregnancy planning",
  "get-sleep-apnea-under-control": "Sleep apnea",
  "get-stronger": "Strength skills",
  "improve-balance": "Balance",
  "improve-blood-sugar-control": "Blood sugar",
  "improve-digestion": "Digestion",
  "improve-fatty-liver-disease": "Liver health",
  "improve-metabolic-health": "Metabolic health",
  "improve-mobility": "Mobility and movement",
  "lose-weight": "Weight management",
  "lower-cholesterol": "Cholesterol",
  "lower-resting-heart-rate": "Heart rate and recovery",
  "prevent-gout-attacks": "Gout",
  "protect-kidney-function": "Kidney health",
  "recover-after-giving-birth": "Postpartum recovery",
  "reduce-hot-flashes": "Menopause symptoms",
  "reduce-pain-during-sex": "Pelvic and sexual comfort",
  "reduce-screen-time": "Screen habits",
  "sleep-better": "Sleep quality",
  "stay-active-during-pregnancy": "Pregnancy movement",
  "stay-independent-as-i-age": "Healthy aging",
};

export function GoalCategoryBrowse({
  category,
  goals,
}: {
  category: GoalCategory;
  goals: readonly GoalIndexEntryModel[];
}) {
  const curatedSections = groupCuratedGoals(category.slug, goals);
  const roots = prioritizeFeaturedGoalTree(
    buildGoalBrowseTree(goals),
    category.featuredRouteIds,
  );
  const families = curatedSections
    ? []
    : roots.filter((node) => node.children.length > 0);
  const standalone = curatedSections
    ? []
    : roots
        .filter((node) => node.children.length === 0)
        .map((node) => node.goal);
  const cardClassName = "h-full";

  return (
    <div
      className="flex flex-col gap-10 pb-12 sm:gap-12"
      data-goal-catalog={category.slug}
    >
      <div className="flex flex-col gap-7 sm:gap-10">
        <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
          <Link href="/goals" className="transition-colors hover:text-foreground">
            Goals
          </Link>
          <span className="px-2" aria-hidden="true">/</span>
          <span>{category.label}</span>
        </nav>
        <header className="border-b border-[#c4a882]/30 pb-8 sm:pb-10">
          <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_7.5rem] sm:items-start sm:gap-8">
            <div className="min-w-0">
              <h1 className="font-serif text-4xl font-semibold leading-[1.05] tracking-[-0.03em] text-balance text-foreground sm:text-5xl">
                {category.directoryTitle}
              </h1>
              <p className="mt-4 max-w-2xl text-lg/8 text-pretty text-muted-foreground">
                {category.description}
              </p>
            </div>
            <GoalCategoryArtwork
              category={category.slug}
              className="order-first size-20 sm:order-none sm:size-[7.5rem] sm:justify-self-end"
              imageClassName="p-3"
            />
          </div>
          <nav
            aria-label="Other goal categories"
            className="mt-8 flex flex-wrap gap-2"
          >
            {GOAL_CATEGORIES.filter((other) => other.slug !== category.slug).map(
              (other) => (
                <Link
                  href={`/goals/${other.slug}`}
                  key={other.slug}
                  className="inline-flex min-h-9 items-center rounded-full border border-black/[0.08] bg-[#fffdf8] px-4 text-sm font-medium text-[#635a48] transition-colors hover:border-black/[0.16] hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring"
                >
                  {other.label}
                </Link>
              ),
            )}
          </nav>
        </header>
      </div>

      {families.map((family) => (
        <GoalFamilySection
          cardClassName={cardClassName}
          family={family}
          key={family.goal.key}
        />
      ))}

      {curatedSections ? (
        <div className="flex flex-col gap-8 sm:gap-10" data-goal-sectioned-directory>
          {curatedSections.map((section) => {
            const headingId = `goal-directory-${section.id}`;
            return (
              <section
                aria-labelledby={headingId}
                className="flex flex-col gap-4 sm:gap-5"
                data-goal-directory-section={section.id}
                key={section.id}
              >
                <h2
                  className="font-serif text-2xl font-semibold tracking-tight text-foreground sm:text-[1.75rem]"
                  id={headingId}
                >
                  {section.label}
                </h2>
                <ul
                  className={GOAL_DIRECTORY_GRID_CLASS_NAME}
                  data-goal-directory="section"
                  role="list"
                >
                  {section.goals.map((goal) => (
                    <li
                      className="min-w-0"
                      data-goal-root="standalone"
                      key={goal.key}
                    >
                      <GoalBrowseCard
                        className={cardClassName}
                        href={`/goals/${goal.routeId}`}
                        illustrationSrc={resolveGoalIllustrationSrc(goal.routeId)}
                        title={goal.title}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      ) : standalone.length > 0 ? (
        <section
          aria-labelledby={families.length > 0 ? "goal-standalone-heading" : undefined}
          className="flex flex-col gap-4 sm:gap-5"
        >
          {families.length > 0 ? (
            <h2
              className="font-serif text-2xl font-semibold tracking-tight text-foreground sm:text-[1.75rem]"
              id="goal-standalone-heading"
            >
              More {category.label.toLowerCase()} goals
            </h2>
          ) : null}
          <ul
            aria-label={families.length > 0 ? undefined : `${category.label} goals`}
            className={GOAL_DIRECTORY_GRID_CLASS_NAME}
            data-goal-directory="root"
            role="list"
          >
            {standalone.map((goal) => (
              <li className="min-w-0" data-goal-root="standalone" key={goal.key}>
                <GoalBrowseCard
                  className={cardClassName}
                  href={`/goals/${goal.routeId}`}
                  illustrationSrc={resolveGoalIllustrationSrc(goal.routeId)}
                  title={goal.title}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function GoalFamilySection({
  cardClassName,
  family,
}: {
  cardClassName: string;
  family: GoalBrowseNode;
}) {
  const { goal } = family;
  const headingId = `goal-family-${goal.routeId}`;
  const entries = [
    { depth: 0, goal },
    ...flattenGoalDescendants(family.children),
  ];

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 sm:gap-5"
      data-goal-family={goal.routeId}
    >
      <h2
        className="font-serif text-2xl font-semibold tracking-tight text-foreground sm:text-[1.75rem]"
        id={headingId}
      >
        {FAMILY_SECTION_LABELS[goal.routeId] ?? "Related goals"}
      </h2>
      <ul
        aria-labelledby={headingId}
        className={GOAL_DIRECTORY_GRID_CLASS_NAME}
        data-goal-directory="family"
        role="list"
      >
        {entries.map((entry) => (
          <li
            className="min-w-0"
            data-goal-depth={entry.depth}
            data-goal-root={entry.depth === 0 ? "family" : undefined}
            key={entry.goal.key}
          >
            <GoalBrowseCard
              className={cardClassName}
              href={`/goals/${entry.goal.routeId}`}
              illustrationSrc={resolveGoalIllustrationSrc(entry.goal.routeId)}
              title={entry.goal.title}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function flattenGoalDescendants(
  nodes: readonly GoalBrowseNode[],
  depth = 1,
): GoalDirectoryEntry[] {
  return nodes.flatMap((node) => [
    { depth, goal: node.goal },
    ...flattenGoalDescendants(node.children, depth + 1),
  ]);
}

function groupCuratedGoals(
  category: GoalCategory["slug"],
  goals: readonly GoalIndexEntryModel[],
): GoalDirectorySection[] | null {
  const definitions = CURATED_DIRECTORY_SECTIONS[category];
  if (!definitions) {
    return null;
  }

  const goalsByRouteId = new Map(goals.map((goal) => [goal.routeId, goal]));
  const assignedRouteIds = new Set<string>();
  const sections = definitions.flatMap((section) => {
    const sectionGoals = section.routeIds.flatMap((routeId) => {
      const goal = goalsByRouteId.get(routeId);
      if (!goal) {
        return [];
      }
      assignedRouteIds.add(routeId);
      return [goal];
    });
    return sectionGoals.length > 0
      ? [{ goals: sectionGoals, id: section.id, label: section.label }]
      : [];
  });
  const unassignedGoals = goals.filter(
    (goal) => !assignedRouteIds.has(goal.routeId),
  );

  return unassignedGoals.length > 0
    ? [
        ...sections,
        {
          goals: unassignedGoals,
          id: "more",
          label: `More ${category === "life-stages" ? "life-stage" : category} goals`,
        },
      ]
    : sections;
}

function buildGoalBrowseTree(
  goals: readonly GoalIndexEntryModel[],
): GoalBrowseNode[] {
  const goalsByKey = new Map(goals.map((goal) => [goal.key, goal]));
  const childrenByParent = new Map<string, GoalIndexEntryModel[]>();

  for (const goal of goals) {
    if (!goal.parentGoalKey || !goalsByKey.has(goal.parentGoalKey)) {
      continue;
    }
    const children = childrenByParent.get(goal.parentGoalKey) ?? [];
    children.push(goal);
    childrenByParent.set(goal.parentGoalKey, children);
  }

  const visited = new Set<string>();
  const materialize = (goal: GoalIndexEntryModel): GoalBrowseNode | null => {
    if (visited.has(goal.key)) {
      return null;
    }
    visited.add(goal.key);
    const children = (childrenByParent.get(goal.key) ?? [])
      .map(materialize)
      .filter((child): child is GoalBrowseNode => child !== null);

    return { children, goal };
  };

  const roots: GoalBrowseNode[] = [];
  const rootGoals = goals.filter(
    (goal) => !goal.parentGoalKey || !goalsByKey.has(goal.parentGoalKey),
  );

  for (const goal of [...rootGoals, ...goals]) {
    const node = materialize(goal);
    if (node) {
      roots.push(node);
    }
  }

  return roots;
}

function prioritizeFeaturedGoalTree(
  nodes: readonly GoalBrowseNode[],
  featuredRouteIds: readonly string[],
): GoalBrowseNode[] {
  const featuredRanks = new Map(
    featuredRouteIds.map((routeId, index) => [routeId, index]),
  );
  const prioritizeNodes = (
    currentNodes: readonly GoalBrowseNode[],
  ): GoalBrowseNode[] =>
    currentNodes
      .map((node, index) => {
        const prioritizedNode = {
          ...node,
          children: prioritizeNodes(node.children),
        };

        return {
          index,
          node: prioritizedNode,
          rank: findFeaturedRank(prioritizedNode, featuredRanks),
        };
      })
      .sort((left, right) => left.rank - right.rank || left.index - right.index)
      .map(({ node }) => node);

  return prioritizeNodes(nodes);
}

function findFeaturedRank(
  node: GoalBrowseNode,
  featuredRanks: ReadonlyMap<string, number>,
): number {
  let rank = featuredRanks.get(node.goal.routeId) ?? Number.POSITIVE_INFINITY;

  for (const child of node.children) {
    rank = Math.min(rank, findFeaturedRank(child, featuredRanks));
  }

  return rank;
}
