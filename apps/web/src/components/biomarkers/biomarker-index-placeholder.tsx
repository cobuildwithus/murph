import type { ReactNode } from "react";

import { cn } from "@/src/lib/utils";

export type BiomarkerIndexPlaceholderVariant =
  | "empty"
  | "preparing"
  | "saved"
  | "stale";

interface BiomarkerIndexPlaceholderProps {
  action?: ReactNode;
  headingAs?: "h2" | "h4";
  variant: BiomarkerIndexPlaceholderVariant;
}

const BIOMARKER_INDEX_PREVIEW_ROWS = [
  { labelWidth: "w-36", valueWidth: "w-20" },
  { labelWidth: "w-48", valueWidth: "w-24" },
  { labelWidth: "w-40", valueWidth: "w-16" },
] as const;

const BIOMARKER_INDEX_PLACEHOLDER_COPY = {
  empty: {
    description:
      "Send Murph a lab report to start here. Readings from a supported connected wearable will appear automatically.",
    headline: "Bring your health records together here.",
    previewLabel: "Waiting",
    statusLabel: "Ready when you are",
  },
  preparing: {
    description:
      "Recognized lab results and device readings will appear together here. This page will update when your biomarkers are ready.",
    headline: "Murph is organizing your health records.",
    previewLabel: "Building",
    statusLabel: "Updating your biomarkers",
  },
  saved: {
    description:
      "Your saved lab records remain private, but none are recognized as biomarkers yet. New recognized results will appear here automatically.",
    headline: "Your records are saved. Murph is filing what it recognizes.",
    previewLabel: "Reviewing",
    statusLabel: "Your saved records are still available",
  },
  stale: {
    description:
      "Murph checks for newer device and lab data in the background. Recognized results will appear here when this page catches up.",
    headline: "Murph is checking for newer records.",
    previewLabel: "Checking",
    statusLabel: "Looking for newer health data",
  },
} as const satisfies Record<
  BiomarkerIndexPlaceholderVariant,
  {
    description: string;
    headline: string;
    previewLabel: string;
    statusLabel: string;
  }
>;

export function BiomarkerIndexPlaceholder({
  action = null,
  headingAs: Heading = "h2",
  variant,
}: BiomarkerIndexPlaceholderProps) {
  const content = BIOMARKER_INDEX_PLACEHOLDER_COPY[variant];
  const preparing = variant === "preparing";
  const Subheading = Heading === "h2" ? "h3" : "h5";
  const headingId = `biomarker-index-${variant}-heading`;
  const previewHeadingId = `biomarker-index-${variant}-preview-heading`;

  return (
    <section
      aria-labelledby={headingId}
      className="min-w-0 overflow-hidden border-y border-border/70"
      data-biomarker-index-state={variant}
    >
      <div className="grid lg:grid-cols-[minmax(0,1.08fr)_minmax(22rem,0.92fr)]">
        <div className="px-5 py-10 sm:px-8 sm:py-12 lg:border-r lg:border-border/70 lg:py-16">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Private biomarkers
          </p>
          <Heading
            className="mt-4 max-w-xl font-serif text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
            id={headingId}
          >
            {content.headline}
          </Heading>
          <p className="mt-4 max-w-[62ch] text-sm leading-relaxed text-muted-foreground sm:text-base">
            {content.description}
          </p>

          <div className="mt-8 flex flex-col gap-5 border-t border-border/70 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div
              aria-live={preparing ? "polite" : undefined}
              className="flex items-center gap-3"
              role={preparing ? "status" : undefined}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "size-2.5 shrink-0 rounded-full",
                  preparing ? "animate-pulse bg-primary motion-reduce:animate-none" : "bg-border",
                )}
              />
              <span className="text-sm font-medium text-foreground">
                {content.statusLabel}
              </span>
            </div>
            {action ? <div className="shrink-0">{action}</div> : null}
          </div>
        </div>

        <div className="flex flex-col justify-center px-5 py-10 sm:px-8 sm:py-12 lg:py-16">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            What appears next
          </p>
          <ol className="mt-5 border-y border-border/70">
            <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-4 border-b border-border/70 py-5">
              <span className="font-serif text-xl font-semibold tabular-nums text-primary">01</span>
              <div>
                <Subheading className="font-serif text-xl font-semibold tracking-tight text-foreground">
                  From your devices
                </Subheading>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  Supported measurements with actual readings, shown first.
                </p>
              </div>
            </li>
            <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-4 py-5">
              <span className="font-serif text-xl font-semibold tabular-nums text-primary">02</span>
              <div>
                <Subheading className="font-serif text-xl font-semibold tracking-tight text-foreground">
                  From the lab
                </Subheading>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  Recognized results filed by health area, not by report.
                </p>
              </div>
            </li>
          </ol>
        </div>
      </div>

      <div aria-labelledby={previewHeadingId} className="border-t border-border/70" role="group">
        <div className="flex items-baseline justify-between gap-4 border-b border-border/70 px-5 py-4 sm:px-8">
          <Subheading
            className="font-serif text-xl font-semibold tracking-tight text-foreground"
            id={previewHeadingId}
          >
            Biomarkers
          </Subheading>
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            {content.previewLabel}
          </span>
        </div>
        <div aria-hidden="true" className="divide-y divide-border/70">
          {BIOMARKER_INDEX_PREVIEW_ROWS.map((row, index) => (
            <div
              className="grid min-h-20 grid-cols-[minmax(0,1fr)_auto] items-center gap-8 px-5 py-4 sm:min-h-24 sm:px-8"
              key={`${row.labelWidth}:${row.valueWidth}`}
            >
              <div className="flex items-center gap-4">
                <span className="h-12 w-1 shrink-0 rounded-full bg-border" />
                <span
                  className={cn(
                    "h-4 max-w-[65%] rounded-sm bg-muted",
                    row.labelWidth,
                    preparing && "animate-pulse motion-reduce:animate-none",
                  )}
                />
              </div>
              <div className="flex flex-col items-end gap-2">
                <span
                  className={cn(
                    "h-3 rounded-sm bg-muted",
                    row.valueWidth,
                    preparing && "animate-pulse motion-reduce:animate-none",
                  )}
                />
                <span
                  className={cn(
                    "h-2.5 rounded-sm bg-muted/70",
                    index === 1 ? "w-16" : "w-12",
                    preparing && "animate-pulse motion-reduce:animate-none",
                  )}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
