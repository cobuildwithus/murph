import Link from "next/link";

import { GoalContactAction } from "@/src/components/goals/goal-contact-action";
import { MarkdownView } from "@/src/components/ui/markdown-view";
import type { GoalCategory } from "@/src/lib/goals/goal-categories";
import type { GoalPageModel } from "@/src/lib/goals/goal-models";
import type { MurphContactOption } from "@/src/lib/murph-contact-routing";

export function GoalGuide({
  category,
  contactOptions,
  goal,
}: {
  category: GoalCategory;
  contactOptions: readonly MurphContactOption[];
  goal: GoalPageModel;
}) {
  return (
    <article className="mx-auto w-full max-w-4xl pb-12">
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

      <header className="max-w-3xl border-b border-border/70 pb-8">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {category.label}
        </span>
        <h1 className="mt-2 font-serif text-4xl font-semibold leading-[1.08] tracking-tight text-balance text-foreground sm:text-5xl">
          {goal.title}
        </h1>
        <p className="mt-4 max-w-2xl text-lg/8 text-pretty text-muted-foreground">
          {goal.summary}
        </p>
        <div className="mt-7 flex flex-col items-start gap-3">
          <GoalContactAction options={contactOptions} />
          <p className="max-w-xl text-xs/5 text-muted-foreground">
            Opens an editable draft: <q>{goal.startPrompt}</q> Nothing is sent
            until you send it.
          </p>
        </div>
      </header>

      <MarkdownView
        content={goal.body}
        className="max-w-3xl pt-8 text-base/7 text-foreground/90 [&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:decoration-primary/30 [&_a]:underline-offset-4 hover:[&_a]:decoration-primary [&_blockquote]:my-6 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-5 [&_blockquote]:text-muted-foreground [&_h2]:mb-3 [&_h2]:mt-10 [&_h2]:font-serif [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground [&_h3]:mb-2 [&_h3]:mt-7 [&_h3]:font-serif [&_h3]:text-lg [&_h3]:font-semibold [&_li]:my-2 [&_ol]:my-5 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-6 [&_p]:my-4 [&_strong]:font-semibold [&_strong]:text-foreground [&_ul]:my-5 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6"
      />
      <footer className="mt-10 max-w-3xl border-t border-border/70 pt-5 text-xs text-muted-foreground">
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
