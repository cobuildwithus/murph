import { BookOpenIcon, ExternalLinkIcon, FileTextIcon, InfoIcon } from "lucide-react";
import { type ReactNode } from "react";

import { Badge } from "@/src/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";
import { SectionLabel } from "@/src/components/ui/section-label";
import type { BiomarkerPageModel } from "@/src/lib/health-commons/biomarker-detail";
import { cn } from "@/src/lib/utils";

type BiomarkerBodyBlock =
  | { text: string; type: "paragraph" }
  | { items: string[]; listStyle: "ordered" | "unordered"; type: "list" };

interface BiomarkerBodySection {
  blocks: BiomarkerBodyBlock[];
  heading: string;
}

const DUPLICATIVE_RESEARCH_NOTE_HEADINGS = new Set([
  "how murph should interpret your trend",
  "protocol interpretation",
  "protocol ranking logic",
]);

export function BiomarkerResearch({ biomarker }: { biomarker: BiomarkerPageModel }) {
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
      {(hasClaims || hasSourceHighlights) && (
        <section className="flex flex-col gap-5">
          <div className="flex max-w-3xl flex-col gap-1.5">
            <SectionLabel>Evidence</SectionLabel>
            <p className="text-sm/6 text-muted-foreground">
              Source-backed claims stay separate from your private trend and from future opt-in
              community outcomes.
            </p>
          </div>
          <div
            className={cn(
              "grid gap-4",
              hasClaims && hasSourceHighlights ? "lg:grid-cols-[minmax(0,1fr)_400px]" : null,
            )}
          >
            {hasClaims ? (
              <Card className="border border-border/60">
                <CardHeader className="gap-3">
                  <SectionKicker
                    icon={<BookOpenIcon className="size-4" aria-hidden />}
                    label="Claim boundaries"
                  />
                  <CardTitle>Evidence-backed interpretation</CardTitle>
                  <CardDescription>
                    These claims are attached to source artifacts in Health Commons so the page can
                    stay useful without overreaching.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3">
                  {biomarker.claims.map((claim) => (
                    <div
                      key={claim.claimId}
                      className="rounded-xl border border-border/60 bg-muted/30 p-4"
                    >
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">{formatChipLabel(claim.strength)} evidence</Badge>
                        <Badge variant="outline">{formatChipLabel(claim.type)}</Badge>
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
                </CardContent>
              </Card>
            ) : null}

            {hasSourceHighlights ? (
              <Card className="border border-border/60">
                <CardHeader>
                  <SectionKicker
                    icon={<FileTextIcon className="size-4" aria-hidden />}
                    label="Source artifacts"
                  />
                  <CardTitle>Research highlights</CardTitle>
                  <CardDescription>
                    A compact source list for the claims and measurement guardrails on this page.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3">
                  {biomarker.sourceHighlights.slice(0, 8).map((source) => (
                    <SourceHighlightCard key={source.key} source={source} />
                  ))}
                </CardContent>
              </Card>
            ) : null}
          </div>
        </section>
      )}

      {hasMemo && (
        <section className="flex flex-col gap-5">
          <div className="flex max-w-3xl flex-col gap-1.5">
            <SectionLabel>Commons memo</SectionLabel>
            <p className="text-sm/6 text-muted-foreground">
              Longer biomarker notes from Health Commons, organized as a single appendix.
            </p>
          </div>
          <Card className="border border-border/60">
            <CardHeader>
              <SectionKicker
                icon={<InfoIcon className="size-4" aria-hidden />}
                label="Commons memo"
              />
              <CardTitle>{biomarker.shortName} evidence notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {memoSections.map((section, sectionIndex) => (
                <div
                  key={section.heading}
                  className={cn(
                    "space-y-4",
                    sectionIndex > 0 ? "border-t border-border/60 pt-6" : null,
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
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}

function SourceHighlightCard({
  source,
}: {
  source: BiomarkerPageModel["sourceHighlights"][number];
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/30 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium leading-5 text-foreground">{source.title}</p>
          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
            {source.typeLabel}
            {source.year ? ` · ${source.year}` : ""}
          </p>
        </div>
        {source.externalUrl ? (
          <ExternalLinkIcon
            className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
            aria-hidden
          />
        ) : null}
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{source.summary}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge variant="outline">{source.evidenceLabel}</Badge>
        {source.externalUrl ? (
          <a
            href={source.externalUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-foreground underline-offset-4 hover:underline"
          >
            Open original source
            <ExternalLinkIcon className="size-3.5" aria-hidden />
          </a>
        ) : null}
      </div>
    </div>
  );
}

function SectionKicker({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
      <span className="flex size-7 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </span>
      {label}
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
