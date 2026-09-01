import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  GoalIndexEntryModel,
  GoalPageModel,
} from "@/src/lib/goals/goal-models";

const fixtureGoal: GoalPageModel = {
  aliases: ["lower rhr"],
  body: `Aerobic fitness and good recovery can gradually lower resting heart rate.

## A practical plan

- Build a consistent aerobic base.
- Recover between harder sessions.

## A quick note

Seek medical care for a sudden change with concerning symptoms.

## Sources

- [American Heart Association](https://www.heart.org/)`,
  category: "biomarkers",
  goalPhrase: "lower my resting heart rate",
  indexable: true,
  key: "goal_template:lower-resting-heart-rate",
  outcomeKind: "biomarker",
  parentGoalKey: null,
  routeId: "lower-resting-heart-rate",
  sources: [
    { label: "American Heart Association", url: "https://www.heart.org/" },
    { label: "Centers for Disease Control and Prevention", url: "https://www.cdc.gov/physical-activity/" },
  ],
  startPrompt: "Hey Murph, help me lower my resting heart rate.",
  summary: "Use aerobic training and recovery to lower resting heart rate over time.",
  title: "Lower My Resting Heart Rate",
};

const fixtureChild: GoalIndexEntryModel = {
  aliases: ["rhr during sleep"],
  category: "biomarkers",
  goalPhrase: "improve my overnight resting heart rate",
  key: "goal_template:overnight-resting-heart-rate",
  outcomeKind: "biomarker",
  parentGoalKey: fixtureGoal.key,
  routeId: "improve-overnight-resting-heart-rate",
  startPrompt: "Hey Murph, help me improve my overnight resting heart rate.",
  summary: "Build habits that support a healthier overnight heart-rate trend.",
  title: "Improve My Overnight Resting Heart Rate",
};

const fixtureGrandchild: GoalIndexEntryModel = {
  aliases: ["steady overnight rhr"],
  category: "biomarkers",
  goalPhrase: "stabilize my overnight resting heart rate",
  key: "goal_template:stable-overnight-resting-heart-rate",
  outcomeKind: "biomarker",
  parentGoalKey: fixtureChild.key,
  routeId: "stabilize-overnight-resting-heart-rate",
  startPrompt: "Hey Murph, help me stabilize my overnight resting heart rate.",
  summary: "Build a steadier routine around overnight heart-rate trends.",
  title: "Stabilize My Overnight Resting Heart Rate",
};

const fixtureStandalone: GoalIndexEntryModel = {
  aliases: ["improve blood pressure"],
  category: "biomarkers",
  goalPhrase: "improve my blood pressure",
  key: "goal_template:improve-blood-pressure",
  outcomeKind: "biomarker",
  parentGoalKey: null,
  routeId: "improve-blood-pressure",
  startPrompt: "Hey Murph, help me improve my blood pressure.",
  summary: "Build habits that support a healthier blood-pressure trend.",
  title: "Improve My Blood Pressure",
};

const fixtureStandaloneAfter: GoalIndexEntryModel = {
  ...fixtureStandalone,
  aliases: ["improve HRV"],
  goalPhrase: "improve my HRV",
  key: "goal_template:improve-hrv",
  routeId: "improve-hrv",
  startPrompt: "Hey Murph, help me improve my HRV.",
  summary: "Build habits that support a healthier heart-rate-variability trend.",
  title: "Improve My HRV",
};

const fixtureSecondFamily: GoalIndexEntryModel = {
  ...fixtureStandalone,
  aliases: ["lower cholesterol"],
  goalPhrase: "lower my cholesterol",
  key: "goal_template:lower-cholesterol",
  routeId: "lower-cholesterol",
  startPrompt: "Hey Murph, help me lower my cholesterol.",
  summary: "Build a practical plan to improve cholesterol over time.",
  title: "Lower My Cholesterol",
};

const fixtureSecondFamilyChild: GoalIndexEntryModel = {
  ...fixtureStandalone,
  aliases: ["lower LDL"],
  goalPhrase: "lower my LDL cholesterol",
  key: "goal_template:lower-ldl-cholesterol",
  parentGoalKey: fixtureSecondFamily.key,
  routeId: "lower-ldl-cholesterol",
  startPrompt: "Hey Murph, help me lower my LDL cholesterol.",
  summary: "Use repeatable habits to improve LDL cholesterol over time.",
  title: "Lower My LDL Cholesterol",
};

const fixtureSmallMultiFamily: GoalIndexEntryModel = {
  ...fixtureStandalone,
  aliases: ["blood sugar control"],
  goalPhrase: "improve my blood sugar control",
  key: "goal_template:improve-blood-sugar-control",
  routeId: "improve-blood-sugar-control",
  startPrompt: "Hey Murph, help me improve my blood sugar control.",
  summary: "Build a practical plan to improve blood sugar control over time.",
  title: "Improve My Blood Sugar Control",
};

const fixtureSmallMultiFamilyChildren = [
  "Improve My Fasting Blood Sugar",
  "Reduce Blood Sugar Spikes",
  "Improve My Post-Meal Blood Sugar",
  "Improve My Insulin Sensitivity",
  "Lower My A1C",
].map((title, index): GoalIndexEntryModel => ({
  ...fixtureStandalone,
  aliases: [],
  goalPhrase: title.toLowerCase(),
  key: `goal_template:blood-sugar-fixture-${index + 1}`,
  parentGoalKey: fixtureSmallMultiFamily.key,
  routeId: `blood-sugar-fixture-${index + 1}`,
  startPrompt: `Hey Murph, help me ${title.toLowerCase()}.`,
  summary: `A practical guide for ${title.toLowerCase()}.`,
  title,
}));

const fixtureMediumFamilyChildren = Array.from(
  { length: 6 },
  (_, index): GoalIndexEntryModel => ({
    ...fixtureChild,
    aliases: [],
    goalPhrase: `support biomarker goal ${index + 1}`,
    key: `goal_template:biomarker-support-${index + 1}`,
    parentGoalKey: fixtureGoal.key,
    routeId: `biomarker-support-${index + 1}`,
    startPrompt: `Hey Murph, help me with biomarker support goal ${index + 1}.`,
    title: `Biomarker Support Goal ${index + 1}`,
  }),
);

const fixtureLargeFamily: GoalIndexEntryModel = {
  ...fixtureStandalone,
  aliases: ["metabolic health"],
  goalPhrase: "improve my metabolic health",
  key: "goal_template:improve-metabolic-health",
  routeId: "improve-metabolic-health",
  startPrompt: "Hey Murph, help me improve my metabolic health.",
  summary: "Build a practical plan around the metabolic outcomes that matter.",
  title: "Improve My Metabolic Health",
};

const fixtureLargeFamilyChildren = [
  "Improve My Fasting Blood Sugar",
  "Improve My Insulin Sensitivity",
  "Lower My A1C",
  "Lower My Triglycerides",
  "Move Out of the Prediabetes Range",
  "Prevent Type 2 Diabetes",
  "Reduce My Liver Fat",
  "Support a Healthy Waist Circumference",
  "Support Type 2 Diabetes Remission",
].map((title, index): GoalIndexEntryModel => ({
  ...fixtureStandalone,
  aliases: [],
  goalPhrase: title.toLowerCase(),
  key: `goal_template:metabolic-fixture-${index + 1}`,
  parentGoalKey: fixtureLargeFamily.key,
  routeId: `metabolic-fixture-${index + 1}`,
  startPrompt: `Hey Murph, help me ${title.toLowerCase()}.`,
  summary: `A practical guide for ${title.toLowerCase()}.`,
  title,
}));

const fixtureStandaloneFinal: GoalIndexEntryModel = {
  ...fixtureStandalone,
  aliases: ["stroke risk"],
  goalPhrase: "lower my risk of stroke",
  key: "goal_template:lower-stroke-risk",
  routeId: "lower-stroke-risk",
  startPrompt: "Hey Murph, help me lower my risk of stroke.",
  summary: "Build habits that support a lower long-term risk of stroke.",
  title: "Lower My Risk of Stroke",
};

const fixtureStandaloneCardioGoals = [
  "Climb Stairs Without Getting Winded",
  "Complete a Half Ironman",
  "Complete a Long-Distance Hike",
  "Complete an Olympic Triathlon",
  "Complete My First Triathlon",
  "Cycle Farther Without Getting Tired",
  "Cycle Faster",
  "Exercise for 30 Minutes Without Stopping",
  "Get 150 Minutes of Cardio Each Week",
  "Get in Basketball Shape",
  "Get in Soccer Shape",
  "Hike Longer Without Getting Tired",
  "Improve My Cardio Endurance",
  "Improve My Heart Rate Recovery",
  "Improve My Rowing Endurance",
  "Improve My VO₂ Max",
  "Increase My Cycling Power",
  "Jump Rope for 10 Minutes",
  "Return to Running After a Break",
  "Ride 100 Miles",
  "Row 2,000 Meters Faster",
  "Ruck Farther",
  "Run a Faster 10K",
  "Run a Faster 5K",
  "Run a Faster Mile",
  "Run a Half Marathon",
  "Run a Marathon",
  "Run a Mile Without Stopping",
  "Run a Trail Race",
  "Run an Ironman",
  "Run an Ultramarathon",
  "Run My First 10K",
  "Run My First 5K",
  "Sit Less During the Day",
  "Start Running",
  "Swim Farther Without Stopping",
  "Swim Faster",
  "Swim One Mile",
  "Walk Every Day",
].map((title, index): GoalIndexEntryModel => ({
  ...fixtureStandalone,
  aliases: [],
  category: "cardio",
  goalPhrase: title.toLowerCase(),
  key: `goal_template:cardio-fixture-${index + 1}`,
  outcomeKind: "capacity",
  routeId: ({
    "Improve My Cardio Endurance": "improve-cardio-endurance",
    "Improve My VO₂ Max": "improve-vo2-max",
    "Run an Ironman": "run-ironman",
    "Run My First 5K": "run-first-5k",
  } as Record<string, string>)[title] ?? `cardio-fixture-${index + 1}`,
  startPrompt: `Hey Murph, help me ${title.toLowerCase()}.`,
  summary: `A practical guide for ${title.toLowerCase()}.`,
  title,
}));

const featuredDescendantFixtures = [
  {
    category: "sleep",
    rootRouteId: "sleep-better",
    targetRouteId: "sleep-through-the-night",
  },
  {
    category: "biomarkers",
    rootRouteId: "lower-cholesterol",
    targetRouteId: "lower-ldl-cholesterol",
  },
  {
    category: "life-stages",
    rootRouteId: "recover-after-giving-birth",
    targetRouteId: "return-to-running-postpartum",
  },
  {
    category: "life-stages",
    rootRouteId: "stay-independent-as-i-age",
    targetRouteId: "stay-strong-as-i-age",
  },
] as const;

function requireMarkupMatch(
  markup: string,
  pattern: RegExp,
  description: string,
): string {
  const match = markup.match(pattern)?.[0];
  if (!match) {
    throw new Error(`Expected rendered markup to include ${description}.`);
  }
  return match;
}

const mocks = vi.hoisted(() => ({
  getHostedMurphContactContext: vi.fn(),
  listHealthCommonsGoalRouteParams: vi.fn(),
  listHealthCommonsGoalsByCategory: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  permanentRedirect: vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`);
  }),
  resolveGoalContactOption: vi.fn(),
  resolveHealthCommonsGoalPage: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  permanentRedirect: mocks.permanentRedirect,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-contact-context", () => ({
  getHostedMurphContactContext: mocks.getHostedMurphContactContext,
}));

vi.mock("@/src/lib/goals/goal-contact", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/goals/goal-contact")
  >();
  mocks.resolveGoalContactOption.mockImplementation(
    actual.resolveGoalContactOption,
  );
  return {
    ...actual,
    resolveGoalContactOption: mocks.resolveGoalContactOption,
  };
});

vi.mock("@/src/lib/health-commons/goal-projections", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/health-commons/goal-projections")
  >();

  return {
    ...actual,
    listHealthCommonsGoalRouteParams: mocks.listHealthCommonsGoalRouteParams,
    listHealthCommonsGoalsByCategory: mocks.listHealthCommonsGoalsByCategory,
    resolveHealthCommonsGoalPage: mocks.resolveHealthCommonsGoalPage,
  };
});

import GoalOrCategoryPage, {
  generateMetadata,
  generateStaticParams,
} from "../app/goals/[goalId]/page";
import GoalMethodologyPage, {
  metadata as methodologyMetadata,
} from "../app/goals/methodology/page";

describe("public goal pages", () => {
  beforeEach(() => {
    mocks.getHostedMurphContactContext.mockReset();
    mocks.getHostedMurphContactContext.mockResolvedValue({
      initialContactChannels: {
        email: false,
        telegram: false,
        text: true,
      },
      murphEmailAddress: null,
      murphPhoneNumber: "+15550100001",
    });
    mocks.listHealthCommonsGoalRouteParams.mockReset();
    mocks.listHealthCommonsGoalRouteParams.mockReturnValue([
      { goalId: fixtureStandalone.routeId },
      { goalId: fixtureGoal.routeId },
      { goalId: fixtureChild.routeId },
      { goalId: fixtureGrandchild.routeId },
    ]);
    mocks.listHealthCommonsGoalsByCategory.mockReset();
    mocks.listHealthCommonsGoalsByCategory.mockImplementation((category: string) =>
      category === "biomarkers"
        ? [
            fixtureStandalone,
            fixtureGoal,
            fixtureChild,
            fixtureGrandchild,
            ...fixtureMediumFamilyChildren,
            fixtureStandaloneAfter,
            fixtureSecondFamily,
            fixtureSecondFamilyChild,
            fixtureLargeFamily,
            ...fixtureLargeFamilyChildren,
            fixtureStandaloneFinal,
          ]
        : []
    );
    mocks.notFound.mockClear();
    mocks.permanentRedirect.mockClear();
    mocks.resolveGoalContactOption.mockClear();
    mocks.resolveHealthCommonsGoalPage.mockReset();
    mocks.resolveHealthCommonsGoalPage.mockImplementation((routeId: string) => {
      if (routeId !== fixtureGoal.routeId && routeId !== "lower-rhr") {
        return null;
      }

      return {
        goal: fixtureGoal,
        route: {
          canonicalRouteId: fixtureGoal.routeId,
          entry: fixtureGoal,
          isAlias: routeId === "lower-rhr",
        },
      };
    });
  });

  it("publishes canonical goal and category static params", () => {
    expect(generateStaticParams()).toEqual(expect.arrayContaining([
      { goalId: "sleep" },
      { goalId: "life-stages" },
      { goalId: fixtureGoal.routeId },
    ]));
  });

  it("uses an SEO how-to title and canonical URL", async () => {
    await expect(generateMetadata({
      params: Promise.resolve({ goalId: fixtureGoal.routeId }),
    })).resolves.toEqual(expect.objectContaining({
      alternates: { canonical: `/goals/${fixtureGoal.routeId}` },
      description: fixtureGoal.summary,
      openGraph: expect.objectContaining({
        type: "article",
        url: `/goals/${fixtureGoal.routeId}`,
      }),
      robots: { follow: true, index: true },
      title: "How to lower your resting heart rate | Murph",
    }));
  });

  it("renders an independently useful static article with one runtime-aware Murph CTA", async () => {
    const element = await GoalOrCategoryPage({
      params: Promise.resolve({ goalId: fixtureGoal.routeId }),
    });
    const markup = renderToStaticMarkup(element);

    expect(markup).toContain("Lower My Resting Heart Rate");
    expect(markup).toContain("A practical plan");
    expect(markup).toContain("A quick note");
    expect(markup).toContain("American Heart Association");
    expect(markup.match(/aria-label="Build my plan with Murph in /gu)).toHaveLength(1);
    expect(markup).toContain("Build my plan");
    expect(markup).toContain("/icons/murph-mark.svg");
    expect(markup).not.toContain("Do this with Murph");
    expect(markup).toContain("https://t.me/withmurph_bot?text=");
    expect(mocks.resolveGoalContactOption).toHaveBeenCalledWith({
      murphPhoneNumber: null,
      startPrompt: fixtureGoal.startPrompt,
      textAvailable: false,
    });
    expect(mocks.getHostedMurphContactContext).not.toHaveBeenCalled();
    expect(markup).not.toContain("Review or edit this message");
    expect(markup).not.toContain("choose an app");
    expect(markup).not.toContain("Nothing is sent automatically");
    expect(markup).not.toContain("data-goal-outcome-visual");
    expect(markup.match(/data-goal-category-visual=/gu)).toHaveLength(1);
    expect(markup).toContain("[&amp;_a:hover]:decoration-primary");
    expect(markup).not.toContain("hover:[&amp;_a]:decoration-primary");
    expect(markup).toContain("Created by Murph Health Commons");
    expect(markup).toContain('href="/goals/methodology"');
    expect(markup).toContain('"@type":"Article"');
    expect(markup).toContain('"citation":[{"@type":"CreativeWork"');
    expect(markup).toContain('"url":"https://www.heart.org/"');
    expect(markup).toContain('"@type":"BreadcrumbList"');
    expect(markup).toContain('"name":"Murph Health Commons"');
  });

  it("publishes an honest methodology page for the goal library", () => {
    const markup = renderToStaticMarkup(<GoalMethodologyPage />);

    expect(methodologyMetadata.alternates?.canonical).toBe("/goals/methodology");
    expect(methodologyMetadata.openGraph).toEqual(expect.objectContaining({
      type: "website",
      url: "/goals/methodology",
    }));
    expect(methodologyMetadata.robots).toEqual({ follow: true, index: true });
    expect(markup).toContain("How these guides are made");
    expect(markup).toContain("AI and automated tools assist");
    expect(markup).toContain("field-testing material");
    expect(markup).toContain("not diagnoses or personalized care");
    expect(markup).not.toContain("Reviewed by");
  });

  it("keeps interleaved roots in one responsive catalog with compact family previews", async () => {
    const element = await GoalOrCategoryPage({
      params: Promise.resolve({ goalId: "biomarkers" }),
    });
    const markup = renderToStaticMarkup(element);
    const rootDirectoryTag = requireMarkupMatch(
      markup,
      /<ul\b[^>]*data-goal-directory="root"[^>]*>/u,
      "the root goal catalog opening tag",
    );

    expect(markup).toContain("Biomarker Goals");
    expect(markup).toContain('data-goal-family="lower-resting-heart-rate"');
    expect(markup).toContain('data-goal-family="lower-cholesterol"');
    expect(markup).toContain("Improve My Blood Pressure");
    expect(markup).toContain("Improve My Overnight Resting Heart Rate");
    expect(markup).toContain("Stabilize My Overnight Resting Heart Rate");
    expect(markup).toContain("Improve My HRV");
    expect(markup).toContain("Lower My LDL Cholesterol");
    expect(markup).toContain("Improve My Metabolic Health");
    expect(markup).toContain("Lower My Risk of Stroke");
    expect(markup).not.toContain("Related to");
    expect(markup).not.toContain("data-goal-outcome-visual");
    expect(markup).not.toContain(">Specific goals<");
    expect(markup.match(/data-goal-directory="root"/gu)).toHaveLength(1);
    expect(markup.match(/aria-label="Biomarkers goals"/gu)).toHaveLength(1);
    expect(markup.match(/data-goal-root="standalone"/gu)).toHaveLength(3);
    expect(markup).not.toContain("data-goal-family-size");
    expect(rootDirectoryTag).toContain("grid-cols-1");
    expect(rootDirectoryTag).toContain("sm:grid-cols-2");
    expect(rootDirectoryTag).toContain("xl:grid-cols-3");
    expect(rootDirectoryTag).not.toContain("columns-1");
    expect(rootDirectoryTag).not.toContain("column-span");
    expect(rootDirectoryTag).not.toContain("space-y-");

    for (const goal of [
      fixtureGoal,
      fixtureChild,
      fixtureGrandchild,
      fixtureStandalone,
      fixtureStandaloneAfter,
      fixtureSecondFamily,
      fixtureSecondFamilyChild,
      ...fixtureMediumFamilyChildren,
      fixtureLargeFamily,
      ...fixtureLargeFamilyChildren,
      fixtureStandaloneFinal,
    ]) {
      expect(markup).not.toContain(goal.summary);
    }

    expect(markup.match(/href="\/goals\/lower-resting-heart-rate"/gu)).toHaveLength(1);
    expect(markup.match(/href="\/goals\/improve-overnight-resting-heart-rate"/gu)).toHaveLength(1);
    expect(markup.match(/href="\/goals\/stabilize-overnight-resting-heart-rate"/gu)).toHaveLength(1);
    expect(markup.indexOf("Lower My Resting Heart Rate"))
      .toBeLessThan(markup.indexOf("Improve My Overnight Resting Heart Rate"));
    expect(markup.indexOf("Improve My Overnight Resting Heart Rate"))
      .toBeLessThan(markup.indexOf("Stabilize My Overnight Resting Heart Rate"));
    expect(markup.indexOf("Biomarker Support Goal 6"))
      .toBeLessThan(markup.indexOf("Improve My HRV"));
    expect(markup.indexOf("Improve My HRV"))
      .toBeLessThan(markup.indexOf("Lower My Cholesterol"));
    expect(markup.indexOf("Lower My Cholesterol"))
      .toBeLessThan(markup.indexOf("Lower My LDL Cholesterol"));
    expect(markup.indexOf("Lower My LDL Cholesterol"))
      .toBeLessThan(markup.indexOf("Improve My Blood Pressure"));
    expect(markup.indexOf("Improve My Blood Pressure"))
      .toBeLessThan(markup.indexOf("Improve My Metabolic Health"));
    expect(markup.indexOf("Improve My Metabolic Health"))
      .toBeLessThan(markup.indexOf("Improve My Fasting Blood Sugar"));
    expect(markup.indexOf("Support Type 2 Diabetes Remission"))
      .toBeLessThan(markup.indexOf("Lower My Risk of Stroke"));

    const firstFamilyTag = requireMarkupMatch(
      markup,
      /<li\b[^>]*data-goal-family="lower-resting-heart-rate"[^>]*>/u,
      "the medium family cluster opening tag",
    );
    const firstSpecificDirectoryTag = requireMarkupMatch(
      markup,
      /<ul\b[^>]*aria-labelledby="goal-family-lower-resting-heart-rate"[^>]*data-goal-directory="specific"[^>]*>/u,
      "the first family child-list opening tag",
    );
    const firstMoreDirectoryTag = requireMarkupMatch(
      markup,
      /<ul\b[^>]*aria-labelledby="goal-family-lower-resting-heart-rate"[^>]*data-goal-directory="specific-more"[^>]*>/u,
      "the first family additional-goals opening tag",
    );
    const secondSpecificDirectoryTag = requireMarkupMatch(
      markup,
      /<ul\b[^>]*aria-labelledby="goal-family-lower-cholesterol"[^>]*data-goal-directory="specific"[^>]*>/u,
      "the second family child-list opening tag",
    );
    const secondFamilyTag = requireMarkupMatch(
      markup,
      /<li\b[^>]*data-goal-family="lower-cholesterol"[^>]*>/u,
      "the one-child family cluster opening tag",
    );
    const largeFamilyTag = requireMarkupMatch(
      markup,
      /<li\b[^>]*data-goal-family="improve-metabolic-health"[^>]*>/u,
      "the large family cluster opening tag",
    );
    const largeSpecificDirectoryTag = requireMarkupMatch(
      markup,
      /<ul\b[^>]*aria-labelledby="goal-family-improve-metabolic-health"[^>]*data-goal-directory="specific"[^>]*>/u,
      "the large family child-list opening tag",
    );
    const largeMoreDirectoryTag = requireMarkupMatch(
      markup,
      /<ul\b[^>]*aria-labelledby="goal-family-improve-metabolic-health"[^>]*data-goal-directory="specific-more"[^>]*>/u,
      "the large family additional-goals opening tag",
    );

    expect(firstFamilyTag).toContain("min-w-0");
    expect([
      fixtureChild,
      fixtureGrandchild,
      ...fixtureMediumFamilyChildren,
    ]).toHaveLength(8);
    expect(firstSpecificDirectoryTag).toContain("grid");
    expect(firstSpecificDirectoryTag).toContain("grid-cols-2");
    expect(firstSpecificDirectoryTag).toContain(
      'aria-labelledby="goal-family-lower-resting-heart-rate"',
    );
    expect(firstMoreDirectoryTag).toContain("grid-cols-2");
    expect(markup).toContain("Show 4 more");
    expect(secondSpecificDirectoryTag).toContain(
      'aria-labelledby="goal-family-lower-cholesterol"',
    );
    expect(secondFamilyTag).toContain("min-w-0");
    expect(secondSpecificDirectoryTag).toContain("grid");
    expect(secondSpecificDirectoryTag).toContain("grid-cols-1");
    expect(largeFamilyTag).toContain("min-w-0");
    expect(fixtureLargeFamilyChildren).toHaveLength(9);
    expect(largeSpecificDirectoryTag).toContain("grid");
    expect(largeSpecificDirectoryTag).toContain("grid-cols-2");
    expect(largeMoreDirectoryTag).toContain("grid-cols-2");
    expect(markup).toContain("Show 5 more");
    for (const familyTag of [firstFamilyTag, secondFamilyTag, largeFamilyTag]) {
      expect(familyTag).not.toContain("col-span");
      expect(familyTag).not.toContain("columns-");
    }
    expect(markup.match(/data-goal-directory="specific"/gu)).toHaveLength(3);
    expect(markup.match(/data-goal-directory="specific-more"/gu)).toHaveLength(2);
    expect(markup.match(/<details\b/gu)).toHaveLength(2);
    expect(markup.match(/<summary\b/gu)).toHaveLength(2);
    expect(markup).not.toContain("data-goal-category-disclosure");
    expect(markup).not.toContain('data-goal-directory="root-more"');
    expect(markup.match(/data-goal-depth="1"/gu)).toHaveLength(17);
    expect(markup.match(/data-goal-depth="2"/gu)).toHaveLength(1);
    expect(markup).not.toContain('aria-label="Specific goals for');

    const standaloneLinkTag = requireMarkupMatch(
      markup,
      /<a\b[^>]*href="\/goals\/improve-blood-pressure"[^>]*>/u,
      "the standalone whole-cell link",
    );
    const familyLinkTag = requireMarkupMatch(
      markup,
      /<a\b[^>]*href="\/goals\/lower-resting-heart-rate"[^>]*>/u,
      "the family-header whole-cell link",
    );
    const leafLinkTag = requireMarkupMatch(
      markup,
      /<a\b[^>]*href="\/goals\/stabilize-overnight-resting-heart-rate"[^>]*>/u,
      "the descendant whole-cell link",
    );
    expect(standaloneLinkTag).toContain("min-h-14");
    expect(standaloneLinkTag).toContain("w-full");
    expect(familyLinkTag).toContain("min-h-17");
    expect(familyLinkTag).toContain("w-full");
    expect(leafLinkTag).toContain("h-full");
    expect(leafLinkTag).toContain("w-full");
  });

  it("prioritizes featured roots and server-renders the rest behind a native disclosure", async () => {
    mocks.listHealthCommonsGoalsByCategory.mockImplementation((category: string) =>
      category === "cardio" ? fixtureStandaloneCardioGoals : []
    );

    const element = await GoalOrCategoryPage({
      params: Promise.resolve({ goalId: "cardio" }),
    });
    const markup = renderToStaticMarkup(element);
    const rootDirectory = requireMarkupMatch(
      markup,
      /<ul\b[^>]*data-goal-directory="root"[^>]*>[\s\S]*?<\/ul>/u,
      "the root goal catalog",
    );
    const rootDirectoryTag = requireMarkupMatch(
      rootDirectory,
      /^<ul\b[^>]*>/u,
      "the root goal catalog opening tag",
    );
    const disclosure = requireMarkupMatch(
      markup,
      /<details\b[^>]*data-goal-category-disclosure="cardio"[^>]*>[\s\S]*?<\/details>/u,
      "the category-level additional-goals disclosure",
    );
    const disclosureTag = requireMarkupMatch(
      disclosure,
      /^<details\b[^>]*>/u,
      "the category-level disclosure opening tag",
    );
    const additionalRootDirectory = requireMarkupMatch(
      disclosure,
      /<ul\b[^>]*data-goal-directory="root-more"[^>]*>[\s\S]*?<\/ul>/u,
      "the additional root goal catalog",
    );
    const visibleRouteIds = Array.from(
      rootDirectory.matchAll(/href="\/goals\/([^"]+)"/gu),
      (match) => match[1],
    );

    expect(markup).toContain("Cardio Goals");
    expect(markup).not.toContain(">Specific goals<");
    expect(markup).not.toContain("data-goal-family");
    expect(markup.match(/data-goal-root="standalone"/gu)).toHaveLength(39);
    expect(markup.match(/data-goal-directory="root"/gu)).toHaveLength(1);
    expect(markup.match(/data-goal-directory="root-more"/gu)).toHaveLength(1);
    expect(markup.match(/aria-label="Cardio goals"/gu)).toHaveLength(1);
    expect(markup.match(/aria-label="Cardio additional goals"/gu)).toHaveLength(1);
    expect(rootDirectory.match(/<ul\b/gu)).toHaveLength(1);
    expect(rootDirectory.match(/<li\b/gu)).toHaveLength(8);
    expect(additionalRootDirectory.match(/<li\b/gu)).toHaveLength(31);
    expect(rootDirectoryTag).toContain('aria-label="Cardio goals"');
    expect(fixtureStandaloneCardioGoals).toHaveLength(39);
    expect(disclosureTag).not.toContain(" open");
    expect(disclosure).toContain("Show 31 more");
    expect(disclosure).toContain("Show fewer");
    expect(visibleRouteIds).toEqual([
      "improve-vo2-max",
      "run-ironman",
      "run-first-5k",
      "improve-cardio-endurance",
      "cardio-fixture-1",
      "cardio-fixture-2",
      "cardio-fixture-3",
      "cardio-fixture-4",
    ]);
    expect(rootDirectoryTag).toContain("grid-cols-1");
    expect(rootDirectoryTag).toContain("sm:grid-cols-2");
    expect(rootDirectoryTag).toContain("xl:grid-cols-3");
    expect(rootDirectoryTag).not.toContain("columns-1");
    expect(rootDirectoryTag).not.toContain("column-span");
    expect(rootDirectoryTag).not.toContain("space-y-");

    for (const goal of fixtureStandaloneCardioGoals) {
      expect(markup).toContain(goal.title);
      expect(markup).not.toContain(goal.summary);
      const linkTag = requireMarkupMatch(
        markup,
        new RegExp(`<a\\b[^>]*href="/goals/${goal.routeId}"[^>]*>`, "u"),
        `the whole-cell link for ${goal.routeId}`,
      );
      expect(linkTag).toContain("min-h-14");
      expect(linkTag).toContain("w-full");
    }
  });

  it.each(featuredDescendantFixtures)(
    "promotes the ancestor and visible branch for featured descendant $targetRouteId",
    async ({ category, rootRouteId, targetRouteId }) => {
      const actualProjections = await vi.importActual<
        typeof import("@/src/lib/health-commons/goal-projections")
      >("@/src/lib/health-commons/goal-projections");
      const goals = actualProjections.listHealthCommonsGoalsByCategory(category);
      const root = goals.find((goal) => goal.routeId === rootRouteId);
      const target = goals.find((goal) => goal.routeId === targetRouteId);

      expect(root).toBeDefined();
      expect(target).toBeDefined();
      if (!root || !target) {
        throw new Error(`Missing real goal fixture for ${targetRouteId}.`);
      }
      mocks.listHealthCommonsGoalsByCategory.mockImplementation(
        (requestedCategory: string) =>
          requestedCategory === category ? goals : [],
      );

      const element = await GoalOrCategoryPage({
        params: Promise.resolve({ goalId: category }),
      });
      const markup = renderToStaticMarkup(element);
      const categoryDisclosureIndex = markup.indexOf(
        `data-goal-category-disclosure="${category}"`,
      );

      expect(categoryDisclosureIndex).toBeGreaterThan(0);
      const initialRootMarkup = markup.slice(0, categoryDisclosureIndex);
      const family = requireMarkupMatch(
        initialRootMarkup,
        new RegExp(
          `<li\\b[^>]*data-goal-family="${root.routeId}"[^>]*>[\\s\\S]*?</section></li>`,
          "u",
        ),
        `the promoted ${root.routeId} family`,
      );
      const visibleChildren = requireMarkupMatch(
        family,
        /<ul\b[^>]*data-goal-directory="specific"[^>]*>[\s\S]*?<\/ul>/u,
        `the visible children for ${root.routeId}`,
      );
      const additionalRoots = requireMarkupMatch(
        markup,
        /<ul\b[^>]*data-goal-directory="root-more"[^>]*>[\s\S]*?<\/ul>/u,
        "the additional root directory",
      );

      expect(visibleChildren).toContain(`href="/goals/${target.routeId}"`);
      expect(additionalRoots).not.toContain(`href="/goals/${root.routeId}"`);
      expect(visibleChildren.match(/<a\b/gu)?.length ?? 0).toBeLessThanOrEqual(4);
    },
  );

  it("collapses every category with more than eight root goals", async () => {
    const tenRoots = fixtureStandaloneCardioGoals.slice(0, 10);
    mocks.listHealthCommonsGoalsByCategory.mockImplementation((category: string) =>
      category === "cardio" ? tenRoots : []
    );

    const element = await GoalOrCategoryPage({
      params: Promise.resolve({ goalId: "cardio" }),
    });
    const markup = renderToStaticMarkup(element);
    const rootDirectory = requireMarkupMatch(
      markup,
      /<ul\b[^>]*data-goal-directory="root"[^>]*>[\s\S]*?<\/ul>/u,
      "the eight-goal root preview",
    );
    const additionalRootDirectory = requireMarkupMatch(
      markup,
      /<ul\b[^>]*data-goal-directory="root-more"[^>]*>[\s\S]*?<\/ul>/u,
      "the two additional root goals",
    );

    expect(rootDirectory.match(/<li\b/gu)).toHaveLength(8);
    expect(additionalRootDirectory.match(/<li\b/gu)).toHaveLength(2);
    expect(markup).toContain("Show 2 more");
  });

  it("keeps a five-child family compact behind a native disclosure", async () => {
    mocks.listHealthCommonsGoalsByCategory.mockImplementation((category: string) =>
      category === "biomarkers"
        ? [fixtureSmallMultiFamily, ...fixtureSmallMultiFamilyChildren]
        : []
    );

    const element = await GoalOrCategoryPage({
      params: Promise.resolve({ goalId: "biomarkers" }),
    });
    const markup = renderToStaticMarkup(element);
    const familyTag = requireMarkupMatch(
      markup,
      /<li\b[^>]*data-goal-family="improve-blood-sugar-control"[^>]*>/u,
      "the five-child small family opening tag",
    );
    const childDirectoryTag = requireMarkupMatch(
      markup,
      /<ul\b[^>]*aria-labelledby="goal-family-improve-blood-sugar-control"[^>]*data-goal-directory="specific"[^>]*>/u,
      "the five-child small family directory opening tag",
    );

    expect(fixtureSmallMultiFamilyChildren).toHaveLength(5);
    expect(familyTag).toContain("min-w-0");
    expect(childDirectoryTag).toContain("grid");
    expect(childDirectoryTag).toContain("grid-cols-2");
    expect(markup).not.toContain("col-span-2");
    expect(markup).toContain("<details");
    expect(markup).toContain('data-goal-directory="specific-more"');
    expect(markup).toContain("Show 1 more");
    expect(markup.match(/data-goal-depth="1"/gu)).toHaveLength(5);
  });

  it("server-renders every large-family link behind a four-goal native disclosure", async () => {
    mocks.listHealthCommonsGoalsByCategory.mockImplementation((category: string) =>
      category === "biomarkers"
        ? [fixtureLargeFamily, ...fixtureLargeFamilyChildren]
        : []
    );

    const element = await GoalOrCategoryPage({
      params: Promise.resolve({ goalId: "biomarkers" }),
    });
    const markup = renderToStaticMarkup(element);
    const previewDirectory = requireMarkupMatch(
      markup,
      /<ul\b[^>]*data-goal-directory="specific"[^>]*>[\s\S]*?<\/ul>/u,
      "the four-goal family preview",
    );
    const disclosure = requireMarkupMatch(
      markup,
      /<details\b[^>]*data-goal-disclosure="improve-metabolic-health"[^>]*>[\s\S]*?<\/details>/u,
      "the native additional-goals disclosure",
    );
    const disclosureTag = requireMarkupMatch(
      disclosure,
      /^<details\b[^>]*>/u,
      "the native disclosure opening tag",
    );
    const remainingDirectory = requireMarkupMatch(
      disclosure,
      /<ul\b[^>]*data-goal-directory="specific-more"[^>]*>[\s\S]*?<\/ul>/u,
      "the server-rendered additional-goals directory",
    );

    expect(previewDirectory.match(/data-goal-depth="1"/gu)).toHaveLength(4);
    expect(remainingDirectory.match(/data-goal-depth="1"/gu)).toHaveLength(5);
    expect(disclosureTag).not.toContain(" open");
    expect(disclosure).toContain("<summary");
    expect(disclosure).toContain("Show 5 more");
    expect(disclosure).toContain("Show fewer");

    for (const [index, goal] of fixtureLargeFamilyChildren.entries()) {
      const expectedMarkup = index < 4 ? previewDirectory : remainingDirectory;
      expect(expectedMarkup).toContain(goal.title);
      expect(markup.match(new RegExp(`href="/goals/${goal.routeId}"`, "gu")))
        .toHaveLength(1);
    }

    const hiddenLinkTag = requireMarkupMatch(
      remainingDirectory,
      /<a\b[^>]*href="\/goals\/metabolic-fixture-9"[^>]*>/u,
      "an additional whole-cell goal link",
    );
    expect(hiddenLinkTag).toContain("h-full");
    expect(hiddenLinkTag).toContain("w-full");
  });

  it("permanently redirects generated route aliases", async () => {
    await expect(GoalOrCategoryPage({
      params: Promise.resolve({ goalId: "lower-rhr" }),
    })).rejects.toThrow(`NEXT_REDIRECT:/goals/${fixtureGoal.routeId}`);
  });

  it("returns not found for unknown goals", async () => {
    await expect(GoalOrCategoryPage({
      params: Promise.resolve({ goalId: "missing-goal" }),
    })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
