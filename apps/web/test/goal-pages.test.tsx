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

vi.mock("@/src/lib/goals/public-murph-line", () => ({
  resolvePublicMurphLinePhoneNumber: async () => "+15550100001",
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
    expect(markup.match(/aria-label="Ask Murph to help with this goal in /gu)).toHaveLength(1);
    expect(markup).toContain("Ask Murph to help");
    expect(markup).toContain("/icons/murph-mark.svg");
    expect(markup).not.toContain("Do this with Murph");
    expect(markup).toContain("sms:+15550100001?body=");
    expect(markup).not.toContain("t.me/");
    expect(mocks.resolveGoalContactOption).toHaveBeenCalledWith({
      murphPhoneNumber: "+15550100001",
      startPrompt: fixtureGoal.startPrompt,
      textAvailable: true,
    });
    expect(mocks.getHostedMurphContactContext).not.toHaveBeenCalled();
    expect(markup).not.toContain("Review or edit this message");
    expect(markup).not.toContain("choose an app");
    expect(markup).not.toContain("Nothing is sent automatically");
    expect(markup).not.toContain("data-goal-outcome-visual");
    expect(markup).toContain(
      `data-goal-hero-visual="${fixtureGoal.routeId}"`,
    );
    expect(markup).toContain(
      `/design-assets/goals/${fixtureGoal.routeId}.svg`,
    );
    expect(markup).not.toContain("data-goal-category-visual");
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

  it("renders every goal once under plain bounded sections with no disclosures", async () => {
    const element = await GoalOrCategoryPage({
      params: Promise.resolve({ goalId: "biomarkers" }),
    });
    const markup = renderToStaticMarkup(element);
    const allGoals = [
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
    ];

    expect(markup).toContain("Biomarker Goals");
    expect(markup).not.toContain("<details");
    expect(markup).not.toContain("<summary");
    expect(markup).not.toMatch(/Show \d+ more/u);
    expect(markup).not.toContain("data-goal-category-disclosure");
    expect(markup).not.toContain("data-goal-outcome-visual");

    for (const goal of allGoals) {
      expect(markup.match(new RegExp(`href="/goals/${goal.routeId}"`, "gu")))
        .toHaveLength(1);
      expect(markup).toContain(goal.title);
      expect(markup).not.toContain(goal.summary);
    }

    expect(markup).not.toContain("data-goal-family");
    expect(markup).not.toContain("data-goal-depth");
    expect(markup).toMatch(/<h2[^>]*>Blood pressure and heart fitness<\/h2>/u);
    expect(markup).toMatch(/<h2[^>]*>Cholesterol and cardiovascular risk<\/h2>/u);
    expect(markup).toContain("More biomarkers goals");
    expect(markup.match(/data-goal-root="standalone"/gu)).toHaveLength(
      allGoals.length,
    );
    for (const directoryTag of markup.matchAll(
      /<ul\b[^>]*data-goal-directory="section"[^>]*>/gu,
    )) {
      expect(directoryTag[0]).toContain("grid-cols-1");
      expect(directoryTag[0]).toContain("sm:grid-cols-2");
      expect(directoryTag[0]).toContain("lg:grid-cols-3");
      expect(directoryTag[0]).not.toContain("xl:grid-cols-4");
    }
  });

  it("groups cardio goals under plain section headings", async () => {
    mocks.listHealthCommonsGoalsByCategory.mockImplementation((category: string) =>
      category === "cardio" ? fixtureStandaloneCardioGoals : []
    );

    const element = await GoalOrCategoryPage({
      params: Promise.resolve({ goalId: "cardio" }),
    });
    const markup = renderToStaticMarkup(element);

    expect(markup).toContain("Cardio Goals");
    expect(markup).not.toContain("data-goal-family");
    expect(markup).not.toContain("<details");
    expect(markup).toContain("data-goal-sectioned-directory");
    expect(markup.match(/data-goal-directory-section=/gu)).toHaveLength(6);
    expect(markup).toMatch(/<h2[^>]*>Cardio fitness<\/h2>/u);
    expect(markup).toMatch(/<h2[^>]*>Running<\/h2>/u);
    expect(markup).toMatch(
      /<h2[^>]*>Triathlon and long-distance endurance<\/h2>/u,
    );
    expect(markup).toContain("More cardio goals");
    expect(fixtureStandaloneCardioGoals).toHaveLength(39);
    expect(markup.match(/data-goal-root="standalone"/gu)).toHaveLength(39);
    for (const goal of fixtureStandaloneCardioGoals) {
      expect(markup.match(new RegExp(`href="/goals/${goal.routeId}"`, "gu")))
        .toHaveLength(1);
      expect(markup).toContain(goal.title);
      expect(markup).not.toContain(goal.summary);
    }
  });

  it("keeps parent-linked goals as ordinary cards under plain sections", async () => {
    mocks.listHealthCommonsGoalsByCategory.mockImplementation((category: string) =>
      category === "biomarkers"
        ? [fixtureSmallMultiFamily, ...fixtureSmallMultiFamilyChildren]
        : []
    );

    const element = await GoalOrCategoryPage({
      params: Promise.resolve({ goalId: "biomarkers" }),
    });
    const markup = renderToStaticMarkup(element);

    expect(fixtureSmallMultiFamilyChildren).toHaveLength(5);
    expect(markup).not.toContain("data-goal-family");
    expect(markup).toMatch(/<h2[^>]*>Blood sugar and diabetes<\/h2>/u);
    expect(markup).toContain('href="/goals/improve-blood-sugar-control"');
    expect(markup.match(/data-goal-root="standalone"/gu)).toHaveLength(6);
    expect(markup).not.toContain("<details");
    expect(markup).toContain('data-goal-directory="section"');
    expect(markup).toContain("More biomarkers goals");
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
