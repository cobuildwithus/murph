import { GoalGuide } from "@/src/components/goals/goal-guide";

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
  parentGoalKey: null,
  routeId: "lower-resting-heart-rate",
  startPrompt: "Hey Murph, help me lower my resting heart rate.",
  summary: "Use aerobic training and better recovery to bring your resting heart rate down over time.",
  title: "Lower My Resting Heart Rate",
};

const DESIGN_CONTACT_OPTIONS = [
  {
    href: "sms:+15550100001?body=Hey%20Murph%2C%20help%20me%20lower%20my%20resting%20heart%20rate.",
    kind: "text" as const,
    label: "Messages",
  },
  {
    href: "https://t.me/withmurph_bot?text=Hey+Murph%2C+help+me+lower+my+resting+heart+rate.",
    kind: "telegram" as const,
    label: "Telegram",
    rel: "noopener noreferrer",
    target: "_blank",
  },
];

export function GoalGuideStudy() {
  return (
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
              featuredRouteIds: [
                "lower-resting-heart-rate",
                "improve-hrv",
                "lower-blood-pressure",
                "lower-ldl-cholesterol",
              ],
              label: "Biomarkers",
              slug: "biomarkers",
            }}
            contactOptions={DESIGN_CONTACT_OPTIONS}
            goal={DESIGN_GOAL}
          />
        </div>
      </div>
    </section>
  );
}
