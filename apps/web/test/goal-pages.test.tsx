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
        ? [fixtureStandalone, fixtureGoal, fixtureChild, fixtureGrandchild]
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
      openGraph: expect.objectContaining({ type: "article" }),
      robots: { follow: true, index: true },
      title: "How to lower your resting heart rate | Murph",
    }));
  });

  it("renders an independently useful article with one clear Murph CTA", async () => {
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
    expect(markup).toContain(
      `sms:+15550100001?body=${encodeURIComponent(fixtureGoal.startPrompt)}`,
    );
    expect(mocks.resolveGoalContactOption).toHaveBeenCalledWith({
      murphPhoneNumber: "+15550100001",
      startPrompt: fixtureGoal.startPrompt,
      textAvailable: true,
    });
    expect(markup).not.toContain("Review or edit this message");
    expect(markup).not.toContain("choose an app");
    expect(markup).not.toContain("Nothing is sent automatically");
    expect(markup).toContain("[&amp;_a:hover]:decoration-primary");
    expect(markup).not.toContain("hover:[&amp;_a]:decoration-primary");
    expect(markup).toContain("Created by Murph Health Commons");
    expect(markup).toContain('href="/goals/methodology"');
    expect(markup).toContain('"@type":"Article"');
    expect(markup).toContain('"@type":"BreadcrumbList"');
    expect(markup).toContain('"name":"Murph Health Commons"');
  });

  it("falls back directly to Telegram when no assigned text line is available", async () => {
    mocks.getHostedMurphContactContext.mockResolvedValue({
      initialContactChannels: {
        email: false,
        telegram: false,
        text: false,
      },
      murphEmailAddress: null,
      murphPhoneNumber: null,
    });

    const element = await GoalOrCategoryPage({
      params: Promise.resolve({ goalId: fixtureGoal.routeId }),
    });
    const markup = renderToStaticMarkup(element);

    expect(markup).toContain("https://t.me/withmurph_bot?text=");
    expect(markup).toContain("Build my plan with Murph in Telegram");
    expect(markup).not.toContain("choose an app");
  });

  it("publishes an honest methodology page for the goal library", () => {
    const markup = renderToStaticMarkup(<GoalMethodologyPage />);

    expect(methodologyMetadata.alternates?.canonical).toBe("/goals/methodology");
    expect(methodologyMetadata.robots).toEqual({ follow: true, index: true });
    expect(markup).toContain("How these guides are made");
    expect(markup).toContain("AI and automated tools assist");
    expect(markup).toContain("field-testing material");
    expect(markup).toContain("not diagnoses or personalized care");
    expect(markup).not.toContain("Reviewed by");
  });

  it("groups specific goals without repeated taxonomy icons or labels", async () => {
    const element = await GoalOrCategoryPage({
      params: Promise.resolve({ goalId: "biomarkers" }),
    });
    const markup = renderToStaticMarkup(element);

    expect(markup).toContain("Biomarkers goals");
    expect(markup).toContain('data-goal-family="lower-resting-heart-rate"');
    expect(markup).toContain("Specific goals");
    expect(markup).toContain("Improve My Blood Pressure");
    expect(markup).toContain("Improve My Overnight Resting Heart Rate");
    expect(markup).toContain("Stabilize My Overnight Resting Heart Rate");
    expect(markup).toContain('data-goal-depth="1"');
    expect(markup).toContain('data-goal-depth="2"');
    expect(markup).not.toContain("Related to");
    expect(markup).not.toContain("data-goal-outcome-visual");
    expect(markup.match(/href="\/goals\/lower-resting-heart-rate"/gu)).toHaveLength(1);
    expect(markup.match(/href="\/goals\/improve-overnight-resting-heart-rate"/gu)).toHaveLength(1);
    expect(markup.match(/href="\/goals\/stabilize-overnight-resting-heart-rate"/gu)).toHaveLength(1);
    expect(markup.indexOf("Improve My Blood Pressure"))
      .toBeLessThan(markup.indexOf("Lower My Resting Heart Rate"));
    expect(markup.indexOf("Lower My Resting Heart Rate"))
      .toBeLessThan(markup.indexOf("Improve My Overnight Resting Heart Rate"));
    expect(markup.indexOf("Improve My Overnight Resting Heart Rate"))
      .toBeLessThan(markup.indexOf("Stabilize My Overnight Resting Heart Rate"));
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
