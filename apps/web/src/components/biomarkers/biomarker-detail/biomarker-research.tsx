import { ExternalLinkIcon } from "lucide-react";
import { type ReactNode } from "react";

import { SectionLabel } from "@/src/components/ui/section-label";
import type { BiomarkerResearchProjection } from "@/src/lib/health-commons/biomarker-projections";
import { cn } from "@/src/lib/utils";

import { BiomarkerEvidenceRow } from "./biomarker-evidence-row";

type BiomarkerBodyBlock =
  | { text: string; type: "paragraph" }
  | { items: string[]; listStyle: "ordered" | "unordered"; type: "list" };

interface BiomarkerBodySection {
  blocks: BiomarkerBodyBlock[];
  heading: string;
}

const DUPLICATIVE_RESEARCH_NOTE_HEADINGS = new Set([
  "how murph should interpret your trend",
  "how murph should display it",
  "how murph uses this",
  "how murph uses it",
  "protocol interpretation",
  "protocol ranking logic",
  "source posture",
  "why murph includes it",
  "bottom line for murph",
]);

export function BiomarkerResearch({ biomarker }: { biomarker: BiomarkerResearchProjection }) {
  const hasClaims = biomarker.claims.length > 0;
  const hasSourceHighlights = biomarker.sourceHighlights.length > 0;
  const memoSections = selectResearchNotesSections(parseBiomarkerBodySections(biomarker.body));
  const hasMemo = memoSections.length > 0;

  if (!hasClaims && !hasSourceHighlights && !hasMemo) {
    return (
      <div className="flex flex-col gap-4 pb-12">
        <p className="text-sm text-muted-foreground">
          No research notes published for {biomarker.shortName} yet.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-12 pb-12">
      <BiomarkerEvidenceRow biomarker={biomarker} />

      {(hasClaims || hasSourceHighlights) && (
        <section className="flex flex-col gap-6">
          <div className="flex max-w-3xl flex-col gap-1.5">
            <SectionLabel>Evidence</SectionLabel>
            <p className="text-sm/6 text-muted-foreground">
              Everything here comes from published research, kept separate from your own private
              data.
            </p>
          </div>

          <div
            className={cn(
              "grid gap-8",
              hasClaims && hasSourceHighlights ? "lg:grid-cols-[minmax(0,1fr)_400px]" : null,
            )}
          >
            {hasClaims ? (
              <div className="flex flex-col gap-5">
                <div>
                  <SectionLabel>What the research says</SectionLabel>
                  <h3 className="font-serif text-xl font-semibold tracking-tight text-foreground">
                    Evidence-backed interpretation
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Each claim links back to the research it came from, so the page can
                    stay useful without overreaching.
                  </p>
                </div>
                <div className="flex flex-col gap-4">
                  {biomarker.claims.map((claim) => (
                    <div
                      key={claim.claimId}
                      className="border-t border-border/40 pt-4"
                    >
                      <div className="mb-2 flex flex-wrap items-center gap-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                        <span>{formatChipLabel(claim.strength)} evidence</span>
                        <span className="text-border">·</span>
                        <span>{formatChipLabel(claim.type)}</span>
                      </div>
                      <p className="text-sm leading-6 text-foreground">{claim.text}</p>
                      {claim.caveats.length > 0 ? (
                        <ul className="mt-3 grid gap-1 text-xs leading-5 text-muted-foreground">
                          {claim.caveats.map((caveat) => (
                            <li key={caveat} className="flex gap-2">
                              <span
                                className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground/50"
                                aria-hidden
                              />
                              <span>{caveat}</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {claim.sources.length > 0 ? (
                        <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
                          Sources: {claim.sources.map((source) => source.title).join(" · ")}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {hasSourceHighlights ? (
              <div className="flex flex-col gap-5">
                <div>
                  <SectionLabel>Sources</SectionLabel>
                  <h3 className="font-serif text-xl font-semibold tracking-tight text-foreground">
                    Research highlights
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    A compact source list for the claims and measurement guardrails on this page.
                  </p>
                </div>
                <div className="flex flex-col">
                  {biomarker.sourceHighlights.slice(0, 8).map((source, i) => (
                    <SourceHighlightRow key={source.key} source={source} first={i === 0} />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      )}

      {hasMemo && (
        <section className="flex flex-col gap-5">
          <div className="flex max-w-3xl flex-col gap-1.5">
            <SectionLabel>Research notes</SectionLabel>
            <p className="text-sm/6 text-muted-foreground">
              Extended notes on measurement, interpretation, and context.
            </p>
          </div>

          <div className="max-w-3xl space-y-8">
            {memoSections.map((section, sectionIndex) => (
              <div
                key={section.heading}
                className={cn(
                  "space-y-4",
                  sectionIndex > 0 ? "border-t border-border/40 pt-8" : null,
                )}
              >
                <h3 className="font-serif text-xl font-semibold tracking-tight text-foreground">
                  {section.heading}
                </h3>
                <div className="space-y-4 text-sm leading-6 text-muted-foreground">
                  {section.blocks.map((block, index) => {
                    if (block.type === "list") {
                      const ListTag = block.listStyle === "ordered" ? "ol" : "ul";

                      return (
                        <ListTag
                          key={`list:${index}`}
                          className={
                            block.listStyle === "ordered"
                              ? "list-decimal space-y-2 pl-5"
                              : "list-disc space-y-2 pl-5"
                          }
                        >
                          {block.items.map((item) => (
                            <li key={`${index}:${item}`}>{renderInlineMarkdown(item)}</li>
                          ))}
                        </ListTag>
                      );
                    }

                    return <p key={`paragraph:${index}`}>{renderInlineMarkdown(block.text)}</p>;
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SourceHighlightRow({
  source,
  first,
}: {
  source: BiomarkerResearchProjection["sourceHighlights"][number];
  first: boolean;
}) {
  return (
    <div className={cn("py-4", first ? "" : "border-t border-border/40")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium leading-5 text-foreground">{source.title}</p>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {source.typeLabel}
            {source.year ? ` · ${source.year}` : ""}
          </p>
        </div>
        {source.externalUrl ? (
          <a
            href={source.externalUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
            aria-label={`Open original source: ${source.title}`}
          >
            <ExternalLinkIcon className="size-3.5" aria-hidden />
          </a>
        ) : null}
      </div>
      {source.summary ? (
        <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{source.summary}</p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        <span>{source.evidenceLabel}</span>
      </div>
    </div>
  );
}

function parseBiomarkerBodySections(body: string): BiomarkerBodySection[] {
  const sections: BiomarkerBodySection[] = [];
  let current: BiomarkerBodySection = { blocks: [], heading: "Commons interpretation" };
  let paragraphLines: string[] = [];
  let listItems: string[] = [];
  let listStyle: "ordered" | "unordered" | null = null;

  const flushParagraph = () => {
    if (paragraphLines.length === 0) {
      return;
    }
    current.blocks.push({ text: paragraphLines.join(" "), type: "paragraph" });
    paragraphLines = [];
  };

  const flushList = () => {
    if (listItems.length === 0 || listStyle === null) {
      return;
    }
    current.blocks.push({ items: listItems, listStyle, type: "list" });
    listItems = [];
    listStyle = null;
  };

  const pushCurrent = () => {
    flushParagraph();
    flushList();
    if (current.blocks.length > 0) {
      sections.push(current);
    }
  };

  const pushListItem = (nextListStyle: "ordered" | "unordered", item: string) => {
    flushParagraph();
    if (listStyle !== null && listStyle !== nextListStyle) {
      flushList();
    }
    listStyle = nextListStyle;
    listItems.push(item);
  };

  for (const rawLine of body.split(/\r?\n/u)) {
    const line = rawLine.trim();

    if (line.length === 0) {
      flushParagraph();
      flushList();
      continue;
    }

    if (line.startsWith("## ")) {
      pushCurrent();
      current = { blocks: [], heading: stripInlineMarkdown(line.replace(/^##\s+/u, "")).trim() };
      continue;
    }

    if (line.startsWith("- ")) {
      pushListItem("unordered", line.replace(/^-\s+/u, ""));
      continue;
    }

    const orderedListMatch = line.match(/^\d+\.\s+(.*)$/u);
    if (orderedListMatch) {
      pushListItem("ordered", orderedListMatch[1]);
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }

  pushCurrent();
  return sections;
}

function selectResearchNotesSections(sections: BiomarkerBodySection[]): BiomarkerBodySection[] {
  const filtered = sections.filter(
    (section) => !DUPLICATIVE_RESEARCH_NOTE_HEADINGS.has(normalizeResearchHeading(section.heading)),
  );
  return filtered.length > 0 ? filtered : sections;
}

function normalizeResearchHeading(value: string): string {
  return stripInlineMarkdown(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

function renderInlineMarkdown(text: string): ReactNode {
  const pieces = text
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/u)
    .filter((piece) => piece.length > 0);

  return pieces.map((piece, index) => {
    if (piece.startsWith("**") && piece.endsWith("**")) {
      return <strong key={`${index}:${piece}`}>{piece.slice(2, -2)}</strong>;
    }

    if (piece.startsWith("`") && piece.endsWith("`")) {
      return (
        <code
          key={`${index}:${piece}`}
          className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.9em] text-foreground"
        >
          {piece.slice(1, -1)}
        </code>
      );
    }

    return <span key={`${index}:${piece}`}>{stripInlineMarkdown(piece)}</span>;
  });
}

function stripInlineMarkdown(value: string): string {
  return value.replace(/\*\*/gu, "").replace(/`/gu, "");
}

function formatChipLabel(value: string): string {
  return value
    .split(/[-_\s]+/u)
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
