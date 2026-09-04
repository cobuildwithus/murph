import { resolveGoalIllustrationSrc } from "./goal-illustrations";
import type { GoalIndexEntryModel } from "./goal-models";

// Four ways people arrive at Murph, each completing "Hey Murph, help me…"
// with four guides from the public library. Every route here must have a
// checked-in illustration; the homepage test enforces that.
export const HOMEPAGE_GOAL_PERSONAS = [
  {
    id: "feel-better",
    label: "Just feel better",
    routeIds: [
      "sleep-better",
      "feel-more-energetic",
      "reduce-stress",
      "walk-every-day",
    ],
  },
  {
    id: "compete",
    label: "Compete",
    routeIds: [
      "run-marathon",
      "improve-vo2-max",
      "run-ironman",
      "dunk-basketball",
    ],
  },
  {
    id: "live-long",
    label: "Live long",
    routeIds: [
      "stay-independent-as-i-age",
      "keep-my-brain-healthy-as-i-age",
      "lower-blood-pressure",
      "lower-cholesterol",
    ],
  },
  {
    id: "motherhood",
    label: "Motherhood",
    routeIds: [
      "stay-strong-during-pregnancy",
      "sleep-better-during-pregnancy",
      "recover-after-giving-birth",
      "return-to-running-postpartum",
    ],
  },
] as const;

export type HomepageGoalPersonaId =
  (typeof HOMEPAGE_GOAL_PERSONAS)[number]["id"];

// The pill that is selected before anyone clicks.
export const DEFAULT_HOMEPAGE_GOAL_PERSONA_ID: HomepageGoalPersonaId = "live-long";

export interface HomepageGoalLink {
  href: string;
  illustrationSrc: string | null;
  phrase: string;
}

export interface HomepageGoalPersona {
  goals: HomepageGoalLink[];
  id: HomepageGoalPersonaId;
  label: string;
}

export function resolveHomepageGoalPersonas(
  goals: readonly GoalIndexEntryModel[],
): HomepageGoalPersona[] {
  const goalsByRouteId = new Map(goals.map((goal) => [goal.routeId, goal]));

  return HOMEPAGE_GOAL_PERSONAS.map((persona) => ({
    goals: persona.routeIds.flatMap((routeId) => {
      const goal = goalsByRouteId.get(routeId);
      return goal
        ? [{
            href: `/goals/${routeId}`,
            illustrationSrc: resolveGoalIllustrationSrc(routeId),
            phrase: goal.goalPhrase,
          }]
        : [];
    }),
    id: persona.id,
    label: persona.label,
  }));
}
