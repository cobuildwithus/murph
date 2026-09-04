import { GoalCategoryBrowse } from "@/src/components/goals/goal-category-browse";
import { GoalGuide } from "@/src/components/goals/goal-guide";
import { GoalsSection } from "@/src/components/homepage/goals-section";
import type { GoalIndexEntryModel } from "@/src/lib/goals/goal-models";
import type { HomepageGoalPersona } from "@/src/lib/goals/homepage-goal-personas";

const DESIGN_GOAL = {
  aliases: ["lower rhr"],
  body: `A lower resting heart rate often reflects better aerobic fitness and recovery. The most useful approach is steady training, enough recovery, and a trend measured under similar conditions.

## A practical plan

- Build toward three or four easy aerobic sessions each week.
- Add harder intervals only after the easy work feels sustainable.
- Keep sleep, hydration, and rest days consistent enough to recover.

## How to track progress

Compare a weekly median measured at the same time of day. Also notice whether a familiar pace feels easier.

## What to expect

Fitness changes take time. Look for a gradual trend across several weeks, not a dramatic change overnight.

## If progress stalls

Check whether training has become inconsistent or recovery has fallen behind before adding more intensity.

## A quick note

A sudden change with chest pain, fainting, or severe shortness of breath needs medical attention.

## Sources

- [American Heart Association: target heart rates](https://www.heart.org/en/healthy-living/fitness/fitness-basics/target-heart-rates)`,
  category: "biomarkers" as const,
  goalPhrase: "lower my resting heart rate",
  indexable: true,
  key: "goal_template:lower-resting-heart-rate",
  outcomeKind: "biomarker" as const,
  parentGoalKey: null,
  routeId: "lower-resting-heart-rate",
  sources: [
    {
      label: "American Heart Association: target heart rates",
      url: "https://www.heart.org/en/healthy-living/fitness/fitness-basics/target-heart-rates",
    },
    {
      label: "Centers for Disease Control and Prevention: physical activity basics",
      url: "https://www.cdc.gov/physical-activity/php/about/index.html",
    },
  ],
  startPrompt: "Hey Murph, help me lower my resting heart rate.",
  summary: "Use aerobic training and better recovery to bring your resting heart rate down over time.",
  title: "Lower My Resting Heart Rate",
};

const DESIGN_CONTACT_OPTION = {
  href: "sms:+15550100001?body=Hey%20Murph%2C%20help%20me%20lower%20my%20resting%20heart%20rate.",
  kind: "text" as const,
  label: "Messages",
};

function designPersona(
  id: HomepageGoalPersona["id"],
  label: string,
  goals: ReadonlyArray<readonly [routeId: string, phrase: string]>,
): HomepageGoalPersona {
  return {
    goals: goals.map(([routeId, phrase]) => ({
      href: `/goals/${routeId}`,
      illustrationSrc: `/design-assets/goals/${routeId}.svg`,
      phrase,
    })),
    id,
    label,
  };
}

const DESIGN_GOAL_PERSONAS: HomepageGoalPersona[] = [
  designPersona("feel-better", "Just feel better", [
    ["sleep-better", "sleep better"],
    ["feel-more-energetic", "feel more energetic"],
    ["reduce-stress", "reduce my stress"],
    ["walk-every-day", "walk every day"],
  ]),
  designPersona("compete", "Compete", [
    ["run-marathon", "run a marathon"],
    ["improve-vo2-max", "improve my VO₂ max"],
    ["run-ironman", "run an Ironman"],
    ["dunk-basketball", "dunk a basketball"],
  ]),
  designPersona("live-long", "Live long", [
    ["stay-independent-as-i-age", "stay independent as I age"],
    ["keep-my-brain-healthy-as-i-age", "keep my brain healthy as I age"],
    ["lower-blood-pressure", "lower my blood pressure"],
    ["lower-cholesterol", "lower my cholesterol"],
  ]),
  designPersona("motherhood", "Motherhood", [
    ["stay-strong-during-pregnancy", "stay strong during pregnancy"],
    ["sleep-better-during-pregnancy", "sleep better during pregnancy"],
    ["recover-after-giving-birth", "recover after giving birth"],
    ["return-to-running-postpartum", "return to running postpartum"],
  ]),
];

const DESIGN_BROWSE_CATEGORY = {
  description: "Improve endurance, heart health, and the activities you want to finish.",
  directoryTitle: "Cardio Goals",
  featuredRouteIds: [
    "improve-vo2-max",
    "run-ironman",
    "run-first-5k",
    "improve-cardio-endurance",
  ],
  label: "Cardio",
  slug: "cardio",
} as const;

const DESIGN_BROWSE_FAMILY: GoalIndexEntryModel = {
  aliases: [],
  category: "cardio",
  goalPhrase: "improve my cardio endurance",
  key: "goal_template:design-cardio-endurance",
  outcomeKind: "capacity",
  parentGoalKey: null,
  routeId: "improve-cardio-endurance",
  startPrompt: "Hey Murph, help me improve my cardio endurance.",
  summary: "Build endurance for the activities that matter to you.",
  title: "Improve My Cardio Endurance",
};

const DESIGN_BROWSE_FAMILY_CHILDREN = [
  "Exercise for 30 Minutes Without Stopping",
  "Climb Stairs Without Getting Winded",
  "Improve My Heart Rate Recovery",
  "Improve My Rowing Endurance",
  "Hike Longer Without Getting Tired",
  "Ruck Farther",
  "Get 150 Minutes of Cardio Each Week",
].map((title, index): GoalIndexEntryModel => ({
  aliases: [],
  category: "cardio",
  goalPhrase: title.toLowerCase(),
  key: `goal_template:design-cardio-child-${index + 1}`,
  outcomeKind: "capacity",
  parentGoalKey: DESIGN_BROWSE_FAMILY.key,
  routeId: `design-cardio-child-${index + 1}`,
  startPrompt: `Hey Murph, help me ${title.toLowerCase()}.`,
  summary: `A practical guide for ${title.toLowerCase()}.`,
  title,
}));

const DESIGN_BROWSE_ROOTS = [
  ["improve-vo2-max", "Improve My VO₂ Max"],
  ["run-ironman", "Run an Ironman"],
  ["run-first-5k", "Run My First 5K"],
  ["walk-every-day", "Walk Every Day"],
  ["cycle-faster", "Cycle Faster"],
  ["swim-farther", "Swim Farther Without Stopping"],
  ["jump-rope-ten-minutes", "Jump Rope for 10 Minutes"],
  ["return-to-running", "Return to Running After a Break"],
  ["run-marathon", "Run a Marathon"],
  ["ride-one-hundred-miles", "Ride 100 Miles"],
  ["complete-long-hike", "Complete a Long-Distance Hike"],
].map(([routeId, title], index): GoalIndexEntryModel => ({
  aliases: [],
  category: "cardio",
  goalPhrase: title.toLowerCase(),
  key: `goal_template:design-cardio-root-${index + 1}`,
  outcomeKind: "capacity",
  parentGoalKey: null,
  routeId,
  startPrompt: `Hey Murph, help me ${title.toLowerCase()}.`,
  summary: `A practical guide for ${title.toLowerCase()}.`,
  title,
}));

const DESIGN_BROWSE_GOALS = [
  DESIGN_BROWSE_FAMILY,
  ...DESIGN_BROWSE_FAMILY_CHILDREN,
  ...DESIGN_BROWSE_ROOTS,
];

export function GoalGuideStudy() {
  return (
    <>
      <section
        className="mx-auto w-full max-w-[1320px] px-6 pb-4 pt-12 sm:px-10 lg:px-16"
        data-design-study="goal-composer"
        id="goal-composer"
      >
        <div className="border-b border-[#e5e1d8] pb-12">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Homepage goals section
          </p>
          <h1 className="mt-2 max-w-2xl font-serif text-3xl font-semibold tracking-tight text-foreground">
            Hey Murph, help me… composer
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            Production composition with synthetic personas: the shared goal composer, persona pills opening on Live long, and goal cards that hand off to Messages. Inert here, so nothing fetches or sends.
          </p>

          <div className="mt-10 overflow-hidden rounded-2xl border border-border bg-background" inert>
            <GoalsSection
              personas={DESIGN_GOAL_PERSONAS}
              startOption={DESIGN_CONTACT_OPTION}
              totalGoalCount={252}
            />
          </div>
        </div>
      </section>

      <section
        className="mx-auto w-full max-w-5xl px-6 pb-4 pt-12 sm:px-10 lg:px-16"
        data-design-study="goal-category-browse"
        id="goal-category-browse"
      >
        <div className="border-b border-[#e5e1d8] pb-12">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Public goal directory
          </p>
          <h1 className="mt-2 max-w-2xl font-serif text-3xl font-semibold tracking-tight text-foreground">
            Compact category browsing
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            Production composition with synthetic goals showing both family and category disclosures.
          </p>

          <div className="mt-10 rounded-2xl border border-border bg-background px-4 pt-8 sm:px-8" inert>
            <GoalCategoryBrowse
              category={DESIGN_BROWSE_CATEGORY}
              goals={DESIGN_BROWSE_GOALS}
            />
          </div>
        </div>
      </section>

      <section
        className="mx-auto w-full max-w-5xl px-6 pb-4 pt-12 sm:px-10 lg:px-16"
        data-design-study="goal-guide"
        id="goal-guide"
      >
        <div className="border-b border-[#e5e1d8] pb-12">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Public goal guide
          </p>
          <h1 className="mt-2 max-w-2xl font-serif text-3xl font-semibold tracking-tight text-foreground">
            Article-first goal page
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            Production composition with synthetic content. Links and actions are inert in this review surface.
          </p>

          <div className="mt-10 rounded-2xl border border-border bg-background px-4 pt-8 sm:px-8" inert>
            <GoalGuide
              category={{
                description: "Work toward healthier measurements you can follow over time.",
                directoryTitle: "Biomarker Goals",
                featuredRouteIds: [
                  "lower-resting-heart-rate",
                  "improve-hrv",
                  "lower-blood-pressure",
                  "lower-ldl-cholesterol",
                ],
                label: "Biomarkers",
                slug: "biomarkers",
              }}
              contactOption={DESIGN_CONTACT_OPTION}
              goal={DESIGN_GOAL}
            />
          </div>
        </div>
      </section>
    </>
  );
}
