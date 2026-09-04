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
          Murph Health Commons writes and maintains these guides as public
          starting points for common health and fitness goals.
        </p>
      </header>

      <div className="pt-8 text-base/7 text-foreground/90">
        <MethodologySection title="What goes into a guide">
          <p>
            Each page starts with one outcome a person can say plainly, such as
            sleeping longer, lowering resting heart rate, or running a first 5K.
            From there it lays out the steps that move that outcome, how to
            tell whether they are working, what to expect, the usual reasons
            progress stalls, and a short safety note.
          </p>
          <p>
            Sources lean on current guidance from public health agencies and
            professional bodies, with primary research and good reviews where
            they add something useful. Citations stay visible on the page so
            you can check them yourself. A citation backs a specific point. It
            does not mean every suggestion fits every person.
          </p>
        </MethodologySection>

        <MethodologySection title="How automation is used">
          <p>
            AI and automated tools assist with organizing research, drafting,
            consistency checks, link checks, and publishing. They also confirm
            that every page has a clear outcome, an exact editable Murph
            prompt, visible sources, and the required safety boundaries.
          </p>
          <p>
            The current library is field-testing material. The pages are
            usable and actively maintained, but they are not individually
            reviewed medical advice, and no clinician has checked every
            sentence.
          </p>
        </MethodologySection>

        <MethodologySection title="Updates and versioning">
          <p>
            Each guide has a stable public URL plus internal revision
            identifiers for the article and for the Murph setup workflow. A
            meaningful change to either creates a new revision while the URL
            stays the same. Automated checks catch broken relationships,
            duplicate outcomes, missing sources, and invalid prompts before
            anything is published.
          </p>
          <p>
            Health guidance and source links change over time. We update guides
            when the evidence, public guidance, safety language, or product
            workflow changes. We do not add a review date or a named reviewer
            unless that review actually happened.
          </p>
        </MethodologySection>

        <MethodologySection title="What these guides cannot do">
          <p>
            These pages are educational starting points, not diagnoses or personalized care.
            Your medical history, medications, symptoms, pregnancy status,
            disability, and training background can change what is right for
            you. Read the safety note on each guide, involve a clinician when
            the situation calls for one, and use emergency services for urgent
            symptoms.
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
