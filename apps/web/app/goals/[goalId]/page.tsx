import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import { GoalCategoryBrowse } from "@/src/components/goals/goal-category-browse";
import { GoalGuide } from "@/src/components/goals/goal-guide";
import {
  GOAL_CATEGORIES,
  getGoalCategory,
  type GoalCategory,
} from "@/src/lib/goals/goal-categories";
import type { GoalIndexEntryModel } from "@/src/lib/goals/goal-models";
import { toReaderFacingGoalPhrase } from "@/src/lib/goals/goal-copy";
import {
  listHealthCommonsGoalRouteParams,
  listHealthCommonsGoalsByCategory,
  resolveHealthCommonsGoalPage,
} from "@/src/lib/health-commons/goal-projections";
import { resolveGoalContactOption } from "@/src/lib/goals/goal-contact";
import { getHostedMurphContactContext } from "@/src/lib/hosted-onboarding/hosted-contact-context";
import { serializeStructuredData } from "@/src/lib/public-agent-content";
import {
  createMurphPageMetadata,
  MURPH_INDEXABLE_PAGE_ROBOTS,
  MURPH_PUBLIC_SITE_URL,
} from "@/src/lib/site-metadata";

export const dynamicParams = true;

export function generateStaticParams(): { goalId: string }[] {
  return [
    ...GOAL_CATEGORIES.map((category) => ({ goalId: category.slug })),
    ...listHealthCommonsGoalRouteParams(),
  ];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ goalId: string }>;
}): Promise<Metadata> {
  const { goalId } = await params;
  const category = getGoalCategory(goalId);

  if (category) {
    return createMurphPageMetadata({
      alternates: { canonical: `/goals/${category.slug}` },
      description: category.description,
      robots: MURPH_INDEXABLE_PAGE_ROBOTS,
      title: `${category.label} Goals | Murph`,
    });
  }

  const resolved = resolveHealthCommonsGoalPage(goalId);
  if (!resolved) {
    return {};
  }

  return createMurphPageMetadata({
    alternates: {
      canonical: `/goals/${encodeURIComponent(resolved.route.canonicalRouteId)}`,
    },
    description: resolved.goal.summary,
    openGraph: { type: "article" },
    robots: MURPH_INDEXABLE_PAGE_ROBOTS,
    title: `How to ${toReaderFacingGoalPhrase(resolved.goal.goalPhrase)} | Murph`,
  });
}

export default async function GoalOrCategoryPage({
  params,
}: {
  params: Promise<{ goalId: string }>;
}) {
  const { goalId } = await params;
  const category = getGoalCategory(goalId);

  if (category) {
    return (
      <GoalCategoryBrowse
        category={category}
        goals={listHealthCommonsGoalsByCategory(category.slug)}
      />
    );
  }

  const resolved = resolveHealthCommonsGoalPage(goalId);
  if (!resolved) {
    notFound();
  }

  if (resolved.route.isAlias) {
    permanentRedirect(`/goals/${resolved.route.canonicalRouteId}`);
  }

  const goalCategory = getGoalCategory(resolved.goal.category);
  if (!goalCategory) {
    notFound();
  }

  const contactContext = await getHostedMurphContactContext();
  const contactOption = resolveGoalContactOption({
    murphPhoneNumber: contactContext.murphPhoneNumber,
    startPrompt: resolved.goal.startPrompt,
    textAvailable: contactContext.initialContactChannels.text,
  });
  const structuredData = buildGoalStructuredData({
    category: goalCategory,
    goal: resolved.goal,
  });

  return (
    <>
      {structuredData.map((item) => (
        <script
          dangerouslySetInnerHTML={{ __html: serializeStructuredData(item) }}
          key={item["@id"]}
          type="application/ld+json"
        />
      ))}
      <GoalGuide
        category={goalCategory}
        contactOption={contactOption}
        goal={resolved.goal}
      />
    </>
  );
}

function buildGoalStructuredData({
  category,
  goal,
}: {
  category: GoalCategory;
  goal: GoalIndexEntryModel;
}) {
  const path = `/goals/${encodeURIComponent(goal.routeId)}`;
  const url = new URL(path, MURPH_PUBLIC_SITE_URL).toString();
  const categoryUrl = new URL(`/goals/${category.slug}`, MURPH_PUBLIC_SITE_URL).toString();

  return [
    {
      "@context": "https://schema.org",
      "@id": `${url}#article`,
      "@type": "Article",
      about: goal.goalPhrase,
      articleSection: category.label,
      author: {
        "@type": "Organization",
        name: "Murph Health Commons",
        url: new URL("/goals/methodology", MURPH_PUBLIC_SITE_URL).toString(),
      },
      description: goal.summary,
      headline: goal.title,
      isAccessibleForFree: true,
      mainEntityOfPage: url,
      publisher: {
        "@id": `${MURPH_PUBLIC_SITE_URL}/#organization`,
        "@type": "Organization",
        name: "Murph",
        url: MURPH_PUBLIC_SITE_URL,
      },
      url,
    },
    {
      "@context": "https://schema.org",
      "@id": `${url}#breadcrumbs`,
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          item: new URL("/goals", MURPH_PUBLIC_SITE_URL).toString(),
          name: "Goals",
          position: 1,
        },
        {
          "@type": "ListItem",
          item: categoryUrl,
          name: category.label,
          position: 2,
        },
        {
          "@type": "ListItem",
          item: url,
          name: goal.title,
          position: 3,
        },
      ],
    },
  ];
}
