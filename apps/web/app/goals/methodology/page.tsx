import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import {
  createMurphPageMetadata,
  MURPH_INDEXABLE_PAGE_ROBOTS,
} from "@/src/lib/site-metadata";

const METHODOLOGY_DESCRIPTION =
  "How Murph Health Commons drafts, sources, checks, versions, and maintains its public health goal guides.";

export const metadata: Metadata = createMurphPageMetadata({
  alternates: { canonical: "/goals/methodology" },
  description: METHODOLOGY_DESCRIPTION,
  openGraph: { type: "website", url: "/goals/methodology" },
  robots: MURPH_INDEXABLE_PAGE_ROBOTS,
  title: "How Murph Health Guides Are Made | Murph",
});

export default function GoalMethodologyPage() {
  return (
    <article className="mx-auto w-full max-w-3xl pb-12">
      <nav aria-label="Breadcrumb" className="mb-8 text-xs text-muted-foreground">
        <Link href="/goals" className="transition-colors hover:text-foreground">
          Goals
        </Link>
        <span className="px-2" aria-hidden="true">/</span>
        <span>Methodology</span>
      </nav>

      <header className="border-b border-border/70 pb-8">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          About the library
        </span>
        <h1 className="mt-2 font-serif text-4xl font-semibold leading-[1.08] tracking-tight text-balance text-foreground sm:text-5xl">
          How these guides are made
        </h1>
        <p className="mt-4 text-lg/8 text-pretty text-muted-foreground">
          Murph Health Commons creates and maintains these guides as practical,
          public starting points for common health and fitness goals.
        </p>
      </header>

      <div className="pt-8 text-base/7 text-foreground/90">
        <MethodologySection title="What goes into a guide">
          <p>
            Each page starts with one outcome a person can say plainly, such as
            sleeping longer, lowering resting heart rate, or running a first 5K.
            The guide then turns that outcome into practical steps, ways to track
            progress, realistic expectations, common reasons progress stalls, and
            a brief safety note.
          </p>
          <p>
            Sources favor current guidance from public-health agencies and
            professional bodies, along with primary research and high-quality
            reviews when they add useful detail. Citations stay visible on the
            page so readers can inspect them directly. A citation supports a
            specific point; it does not mean every suggestion fits every person.
          </p>
        </MethodologySection>

        <MethodologySection title="How automation is used">
          <p>
            AI and automated tools assist with research organization, drafting,
            consistency checks, link checks, and structured publishing. They also
            check that every page has a clear outcome, an exact editable Murph
            prompt, visible sources, and required safety boundaries.
          </p>
          <p>
            The current goal library is field-testing material. That means the
            pages are usable and actively maintained, but they should not be read
            as individually reviewed medical advice or as a claim that a clinician
            reviewed every sentence.
          </p>
        </MethodologySection>

        <MethodologySection title="Updates and versioning">
          <p>
            Each guide has a stable canonical URL plus internal page and workflow
            revision identifiers. A meaningful change to the article or to the
            Murph setup workflow creates a new revision while the public URL stays
            stable. Corpus checks catch broken relationships, duplicate outcomes,
            missing sources, and invalid action prompts before publication.
          </p>
          <p>
            Health guidance and source URLs change. Murph Health Commons updates
            guides when evidence, public guidance, safety language, or the product
            workflow changes. We do not add a review date or named reviewer unless
            that review actually occurred and can be supported.
          </p>
        </MethodologySection>

        <MethodologySection title="What these guides cannot do">
          <p>
            These pages are educational starting points, not diagnoses or
            personalized care. Your medical history, medications, symptoms,
            pregnancy status, disability, and training background can change what
            is appropriate. Use the safety note on each guide, involve a qualified
            clinician when the situation calls for it, and use emergency services
            for urgent symptoms.
          </p>
        </MethodologySection>

        <p className="mt-10 border-t border-border/70 pt-6 text-sm text-muted-foreground">
          See something that should be corrected?{" "}
          <Link
            href="/contact"
            className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
          >
            Contact Murph
          </Link>
          .
        </p>
      </div>
    </article>
  );
}

function MethodologySection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="mt-10 first:mt-0">
      <h2 className="font-serif text-2xl font-semibold tracking-tight text-foreground">
        {title}
      </h2>
      <div className="mt-3 space-y-4">{children}</div>
    </section>
  );
}
