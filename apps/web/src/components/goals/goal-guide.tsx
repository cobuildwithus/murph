import { ArrowRight, ShieldAlert } from "lucide-react";
import Link from "next/link";

import { GoalBrowseCard } from "@/src/components/goals/goal-browse-card";
import { GoalContactAction } from "@/src/components/goals/goal-contact-action";
import {
  GoalCategoryArtwork,
  getGoalCategoryVisual,
} from "@/src/components/goals/goal-visual";
import { MarkdownView } from "@/src/components/ui/markdown-view";
import type { GoalCategory } from "@/src/lib/goals/goal-categories";
import {
  estimateGoalGuideReadingMinutes,
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
  const articleSections = outline.sections.filter(
    (section) => !isGoalGuideSourcesSection(section),
  );
  const showSources = goal.sources.length > 0 || sourcesSection !== null;
  const outlineEntries = [
    ...articleSections.map(({ id, title }) => ({ id, title })),
    ...(showSources ? [{ id: GOAL_SOURCES_SECTION_ID, title: "Sources" }] : []),
  ];
  const readingMinutes = estimateGoalGuideReadingMinutes(goal.body);
  const visual = getGoalCategoryVisual(category.slug);

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
            <Link
              href={`/goals/${category.slug}`}
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.16em] transition-[filter] hover:brightness-[0.97] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring",
                visual.surfaceClassName,
                visual.borderClassName,
                visual.accentClassName,
              )}
            >
              <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
              {category.label}
            </Link>
            <h1 className="mt-5 font-serif text-4xl font-semibold leading-[1.05] tracking-[-0.03em] text-balance text-foreground sm:text-5xl">
              {goal.title}
            </h1>
            <p className="mt-5 max-w-2xl text-lg/8 text-pretty text-muted-foreground">
              {goal.summary}
            </p>
            <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
              <GoalContactAction
                goalRouteId={goal.routeId}
                option={contactOption}
              />
              <p className="max-w-[34ch] text-sm/6 text-pretty text-muted-foreground">
                Murph turns this guide into a personal plan and checks in as you
                go.
              </p>
            </div>
            <dl className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              <div>
                <dt className="sr-only">Reading time</dt>
                <dd>{readingMinutes} min read</dd>
              </div>
              {goal.sources.length > 0 ? (
                <>
                  <span aria-hidden="true">·</span>
                  <div>
                    <dt className="sr-only">Sources</dt>
                    <dd>
                      <a
                        href={`#${GOAL_SOURCES_SECTION_ID}`}
                        className="underline decoration-border underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground"
                      >
                        {goal.sources.length}{" "}
                        {goal.sources.length === 1 ? "source" : "sources"}
                      </a>
                    </dd>
                  </div>
                </>
              ) : null}
              <span aria-hidden="true">·</span>
              <div>
                <dt className="sr-only">Author</dt>
                <dd>Murph Health Commons</dd>
              </div>
            </dl>
          </div>
          <GoalCategoryArtwork
            category={category.slug}
            className="hidden size-36 sm:flex sm:justify-self-end"
            imageClassName="p-4"
            preload
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
          <div className="sticky top-28 flex flex-col gap-7">
            <nav aria-label="On this page">
              <span className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-[#736a58]">
                On this page
              </span>
              <ol className="mt-3 flex flex-col border-l border-[#c4a882]/30">
                {outlineEntries.map((entry) => (
                  <li key={entry.id}>
                    <a
                      href={`#${entry.id}`}
                      className="-ml-px block border-l border-transparent py-1.5 pl-4 text-sm/6 text-[#635a48] transition-colors hover:border-[#5a6e32] hover:text-foreground"
                    >
                      {entry.title}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
            <p className="border-t border-[#c4a882]/30 pt-5 text-[13px]/6 text-muted-foreground">
              A public starting point, not personal medical advice.{" "}
              <Link
                href="/goals/methodology"
                className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
              >
                How these guides are made
              </Link>
            </p>
          </div>
        </aside>
      </div>

      {related && related.goals.length > 0 ? (
        <GoalRelatedGoals
          category={category}
          hoverClassName={visual.hoverSurfaceClassName}
          related={related}
        />
      ) : null}

      <footer className="mt-12 border-t border-border/70 pt-5 text-xs text-muted-foreground">
        Created by Murph Health Commons
        <span className="px-2" aria-hidden="true">·</span>
        <Link
          href="/goals/methodology"
          className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
        >
          How these guides are made
        </Link>
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
      className="mt-12 scroll-mt-28 rounded-2xl border border-black/[0.06] bg-[#fffdf8] p-5 sm:p-6"
      data-goal-sources
      id={GOAL_SOURCES_SECTION_ID}
    >
      <h2
        className="font-serif text-xl font-semibold tracking-tight text-foreground"
        id={headingId}
      >
        Sources
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        The guidance and research this guide draws on.
      </p>
      {sources.length > 0 ? (
        <ol className="mt-4 divide-y divide-border/70">
          {sources.map((source, index) => (
            <li className="flex gap-4 py-3" key={source.url}>
              <span className="pt-0.5 font-mono text-[11px] text-muted-foreground">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="min-w-0">
                <a
                  href={source.url}
                  className="font-medium text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground"
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {source.label}
                </a>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {describeSourceHost(source.url)}
                </span>
              </div>
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
  hoverClassName,
  related,
}: {
  category: GoalCategory;
  hoverClassName: string;
  related: GoalGuideRelatedGoals;
}) {
  return (
    <section
      aria-labelledby="goal-related-heading"
      className="mt-16 border-t border-[#c4a882]/30 pt-10"
      data-goal-related
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-[#736a58]">
            Keep going
          </span>
          <h2
            className="mt-2 font-serif text-2xl font-semibold tracking-tight text-foreground"
            id="goal-related-heading"
          >
            More {category.label.toLowerCase()} goals
          </h2>
        </div>
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
              className={cn("h-full", hoverClassName)}
              href={`/goals/${relatedGoal.routeId}`}
              title={relatedGoal.title}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function describeSourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./u, "");
  } catch {
    return url;
  }
}
