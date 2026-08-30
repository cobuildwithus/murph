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
  parentGoalKey: fixtureGoal.key,
  routeId: "improve-overnight-resting-heart-rate",
  startPrompt: "Hey Murph, help me improve my overnight resting heart rate.",
  summary: "Build habits that support a healthier overnight heart-rate trend.",
  title: "Improve My Overnight Resting Heart Rate",
};

const mocks = vi.hoisted(() => ({
  fetchHeroContactInfo: vi.fn(),
  listHealthCommonsGoalRouteParams: vi.fn(),
  listHealthCommonsGoalsByCategory: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  permanentRedirect: vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`);
  }),
  resolvePublicGoalContactOptions: vi.fn(),
  resolveHealthCommonsGoalPage: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  permanentRedirect: mocks.permanentRedirect,
}));

vi.mock("@/src/lib/hero-contact-info", () => ({
  fetchHeroContactInfo: mocks.fetchHeroContactInfo,
}));

vi.mock("@/src/lib/goals/goal-contact", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/goals/goal-contact")
  >();
  mocks.resolvePublicGoalContactOptions.mockImplementation(
    actual.resolvePublicGoalContactOptions,
  );
  return {
    ...actual,
    resolvePublicGoalContactOptions: mocks.resolvePublicGoalContactOptions,
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
    mocks.fetchHeroContactInfo.mockReset();
    mocks.fetchHeroContactInfo.mockResolvedValue({
      phone: "+15550100001",
      phoneConfigured: true,
      telegram: "withmurph_bot",
    });
    mocks.listHealthCommonsGoalRouteParams.mockReset();
    mocks.listHealthCommonsGoalRouteParams.mockReturnValue([
      { goalId: fixtureGoal.routeId },
      { goalId: fixtureChild.routeId },
    ]);
    mocks.listHealthCommonsGoalsByCategory.mockReset();
    mocks.listHealthCommonsGoalsByCategory.mockImplementation((category: string) =>
      category === "biomarkers" ? [fixtureGoal, fixtureChild] : []
    );
    mocks.notFound.mockClear();
    mocks.permanentRedirect.mockClear();
    mocks.resolvePublicGoalContactOptions.mockClear();
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
    expect(markup.match(/Do this with Murph/gu)).toHaveLength(1);
    expect(markup).toContain(fixtureGoal.startPrompt);
    expect(mocks.resolvePublicGoalContactOptions).toHaveBeenCalledWith({
      contactInfo: expect.any(Object),
      startPrompt: fixtureGoal.startPrompt,
    });
    expect(markup).toContain("Created by Murph Health Commons");
    expect(markup).toContain('href="/goals/methodology"');
    expect(markup).toContain('"@type":"Article"');
    expect(markup).toContain('"@type":"BreadcrumbList"');
    expect(markup).toContain('"name":"Murph Health Commons"');
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

  it("groups more specific goals under their parent on category pages", async () => {
    const element = await GoalOrCategoryPage({
      params: Promise.resolve({ goalId: "biomarkers" }),
    });
    const markup = renderToStaticMarkup(element);

    expect(markup).toContain("Biomarkers goals");
    expect(markup).toContain("Related to Lower My Resting Heart Rate");
    expect(markup).toContain("Improve My Overnight Resting Heart Rate");
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
