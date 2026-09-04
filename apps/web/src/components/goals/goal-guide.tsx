import { ArrowRight, ShieldAlert } from "lucide-react";
import Link from "next/link";

import { GoalBrowseCard } from "@/src/components/goals/goal-browse-card";
import { GoalContactAction } from "@/src/components/goals/goal-contact-action";
import { GoalOutline } from "@/src/components/goals/goal-outline";
import { GoalHeroArtwork } from "@/src/components/goals/goal-visual";
import { MarkdownView } from "@/src/components/ui/markdown-view";
import type { GoalCategory } from "@/src/lib/goals/goal-categories";
import { resolveGoalIllustrationSrc } from "@/src/lib/goals/goal-illustrations";
import { describeGoalSourcePublisher } from "@/src/lib/goals/goal-source-labels";
import {
  isGoalGuideRelatedSection,
  isGoalGuideSafetySection,
  isGoalGuideSourcesSection,
  splitGoalGuideBody,
  type GoalGuideSection,
} from "@/src/lib/goals/goal-guide-sections";
import type {
  GoalIndexEntryModel,
  GoalPageModel,
} from "@/src/lib/goals/goal-models";
import type { MurphContactOption } from "@/src/lib/murph-contact-routing";
import { cn } from "@/src/lib/utils";

const GOAL_SOURCES_SECTION_ID = "sources";

const GOAL_PROSE_CLASS_NAME =
  "text-base/7 text-foreground/90 [&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:decoration-primary/30 [&_a]:underline-offset-4 [&_a:hover]:decoration-primary [&_blockquote]:my-6 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-5 [&_blockquote]:text-muted-foreground [&_h3]:mb-2 [&_h3]:mt-7 [&_h3]:font-serif [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-foreground [&_li]:my-2 [&_ol]:my-5 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-6 [&_p]:my-4 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_strong]:text-foreground [&_ul]:my-5 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6";

export interface GoalGuideRelatedGoals {
  goals: readonly GoalIndexEntryModel[];
  total: number;
}

export function GoalGuide({
  category,
  contactOption,
  goal,
  related,
}: {
  category: GoalCategory;
  contactOption: MurphContactOption;
  goal: GoalPageModel;
  related?: GoalGuideRelatedGoals;
}) {
  const outline = splitGoalGuideBody(goal.body);
  const sourcesSection = outline.sections.find(isGoalGuideSourcesSection) ?? null;
  // The hand-written "Related goals" list is superseded by the category
  // links rendered after the article, so it is not shown.
  const articleSections = outline.sections.filter(
    (section) =>
      !isGoalGuideSourcesSection(section) && !isGoalGuideRelatedSection(section),
  );
  const showSources = goal.sources.length > 0 || sourcesSection !== null;
  const outlineEntries = [
    ...articleSections.map(({ id, title }) => ({ id, title })),
    ...(showSources ? [{ id: GOAL_SOURCES_SECTION_ID, title: "Sources" }] : []),
  ];

  return (
    <article className="mx-auto w-full max-w-5xl pb-12">
      <nav
        aria-label="Breadcrumb"
        className="mb-8 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
      >
        <Link href="/goals" className="transition-colors hover:text-foreground">
          Goals
        </Link>
        <span aria-hidden="true">/</span>
        <Link
          href={`/goals/${category.slug}`}
          className="transition-colors hover:text-foreground"
        >
          {category.label}
        </Link>
      </nav>

      <header className="border-b border-[#c4a882]/30 pb-10">
        <div className="grid gap-8 sm:grid-cols-[minmax(0,1fr)_9rem] sm:items-start">
          <div className="min-w-0">
            <h1 className="font-serif text-4xl font-semibold leading-[1.05] tracking-[-0.03em] text-balance text-foreground sm:text-5xl">
              {goal.title}
            </h1>
            <p className="mt-5 max-w-2xl text-lg/8 text-pretty text-muted-foreground">
              {goal.summary}
            </p>
            <div className="mt-8">
              <GoalContactAction
                goalRouteId={goal.routeId}
                option={contactOption}
              />
            </div>
          </div>
          <GoalHeroArtwork
            category={category.slug}
            className="hidden size-36 sm:flex sm:justify-self-end"
            imageClassName="p-4"
            preload
            routeId={goal.routeId}
          />
        </div>
      </header>

      <div className="grid gap-12 pt-10 lg:grid-cols-[minmax(0,1fr)_14rem] lg:gap-16">
        <div className="min-w-0 max-w-[68ch]">
          {outline.intro ? (
            <MarkdownView
              className={cn(
                GOAL_PROSE_CLASS_NAME,
                "text-[1.0625rem]/8 text-foreground",
              )}
              content={outline.intro}
            />
          ) : null}
          {articleSections.map((section) =>
            isGoalGuideSafetySection(section) ? (
              <GoalSafetyNote key={section.id} section={section} />
            ) : (
              <GoalArticleSection key={section.id} section={section} />
            )
          )}
          {showSources ? (
            <GoalSources
              fallbackBody={sourcesSection?.body ?? null}
              sources={goal.sources}
            />
          ) : null}
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-28">
            <GoalOutline entries={outlineEntries} />
          </div>
        </aside>
      </div>

      {related && related.goals.length > 0 ? (
        <GoalRelatedGoals
          category={category}
          related={related}
        />
      ) : null}

      <footer className="mt-12 border-t border-border/70 pt-5 text-xs text-muted-foreground">
        <p className="max-w-3xl text-[13px]/6 text-pretty" data-goal-disclaimer>
          This guide is educational health information, not medical advice.
          It is not meant to diagnose, treat, or prevent any disease or
          condition, and it does not replace advice from your clinician. If
          you are or may be pregnant, nursing, have a history of an eating
          disorder, or have another medical condition, talk to your doctor
          before acting on it.
        </p>
        <p className="mt-4">
          Created by Murph Health Commons
          <span className="px-2" aria-hidden="true">·</span>
          <Link
            href="/goals/methodology"
            className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
          >
            How these guides are made
          </Link>
        </p>
      </footer>
    </article>
  );
}

function GoalArticleSection({ section }: { section: GoalGuideSection }) {
  const headingId = `${section.id}-heading`;

  return (
    <section
      aria-labelledby={headingId}
      className="mt-10 scroll-mt-28 border-t border-[#c4a882]/20 pt-8"
      id={section.id}
    >
      <h2
        className="font-serif text-2xl font-semibold tracking-tight text-foreground"
        id={headingId}
      >
        {section.title}
      </h2>
      <MarkdownView
        className={cn(GOAL_PROSE_CLASS_NAME, "mt-4")}
        content={section.body}
      />
    </section>
  );
}

function GoalSafetyNote({ section }: { section: GoalGuideSection }) {
  const headingId = `${section.id}-heading`;

  return (
    <section
      aria-labelledby={headingId}
      className="mt-10 scroll-mt-28 rounded-2xl border border-[#c4a882]/40 bg-[#fffcf6] p-5 sm:p-6"
      data-goal-safety-note
      id={section.id}
    >
      <h2
        className="flex items-center gap-2.5 font-serif text-xl font-semibold tracking-tight text-foreground"
        id={headingId}
      >
        <ShieldAlert aria-hidden="true" className="size-5 shrink-0 text-[#8b5d3f]" />
        {section.title}
      </h2>
      <MarkdownView
        className={cn(GOAL_PROSE_CLASS_NAME, "mt-3 text-[0.9375rem]/7")}
        content={section.body}
      />
    </section>
  );
}

function GoalSources({
  fallbackBody,
  sources,
}: {
  fallbackBody: string | null;
  sources: GoalPageModel["sources"];
}) {
  const headingId = `${GOAL_SOURCES_SECTION_ID}-heading`;

  return (
    <section
      aria-labelledby={headingId}
      className="mt-12 scroll-mt-28"
      data-goal-sources
      id={GOAL_SOURCES_SECTION_ID}
    >
      <h2
        className="font-serif text-2xl font-semibold tracking-tight text-foreground"
        id={headingId}
      >
        Sources
      </h2>
      {sources.length > 0 ? (
        <ol className="mt-4 border-t border-[#c4a882]/30">
          {sources.map((source) => (
            <li className="border-b border-[#c4a882]/30" key={source.url}>
              <a
                href={source.url}
                className="group grid gap-1.5 py-4 text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-baseline sm:gap-6"
                rel="noopener noreferrer"
                target="_blank"
              >
                <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  {describeGoalSourcePublisher(source.url)}
                </span>
                <span className="font-serif text-lg font-semibold leading-snug tracking-[-0.015em] text-balance">
                  {source.label}
                </span>
              </a>
            </li>
          ))}
        </ol>
      ) : fallbackBody ? (
        <MarkdownView
          className={cn(GOAL_PROSE_CLASS_NAME, "mt-3")}
          content={fallbackBody}
        />
      ) : null}
    </section>
  );
}

function GoalRelatedGoals({
  category,
  related,
}: {
  category: GoalCategory;
  related: GoalGuideRelatedGoals;
}) {
  return (
    <section
      aria-labelledby="goal-related-heading"
      className="mt-16 border-t border-[#c4a882]/30 pt-10"
      data-goal-related
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2
          className="font-serif text-2xl font-semibold tracking-tight text-foreground"
          id="goal-related-heading"
        >
          More {category.label.toLowerCase()} goals
        </h2>
        <Link
          href={`/goals/${category.slug}`}
          className="group inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          View all {related.total}
          <ArrowRight
            aria-hidden="true"
            className="size-4 transition-transform motion-safe:group-hover:translate-x-1"
          />
        </Link>
      </div>
      <ul className="mt-6 grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3">
        {related.goals.map((relatedGoal) => (
          <li className="min-w-0" key={relatedGoal.key}>
            <GoalBrowseCard
              className="h-full"
              href={`/goals/${relatedGoal.routeId}`}
              illustrationSrc={resolveGoalIllustrationSrc(relatedGoal.routeId)}
              title={relatedGoal.title}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
