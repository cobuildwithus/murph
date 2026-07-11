import type { ReactNode } from "react";
import { cva } from "class-variance-authority";
import Image from "next/image";
import {
  Cat,
  ChevronDown,
  Info,
  MapPin,
  Moon,
  Sun,
  Wind,
  type LucideIcon,
} from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/src/components/ui/tooltip";

import type { CategoryGrade, CategoryNote, FactRow } from "./category-notes";
import type { ResolvedCategory } from "./home-model";

type EnvironmentContext = {
  location: string;
  areaType: string;
  weather: string;
  nights: string;
  outdoorAir: string;
  pets: string;
};

type GradeTone = "olive" | "amber" | "terracotta" | "muted";

export const gradeBadgeVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-xl font-serif font-semibold leading-none",
  {
    variants: {
      tone: {
        olive: "bg-primary/15 text-primary",
        amber: "bg-[#d89a1c]/15 text-[#8a5a00]",
        terracotta: "bg-destructive/10 text-destructive",
        muted: "bg-muted text-muted-foreground",
      },
      size: {
        sm: "size-10 text-xl",
        lg: "size-20 text-5xl tracking-[-0.03em]",
      },
    },
    defaultVariants: {
      tone: "muted",
      size: "sm",
    },
  },
);

function gradeTone(letter: CategoryGrade["letter"]): GradeTone {
  if (letter === "A" || letter === "B") return "olive";
  if (letter === "C") return "amber";
  if (letter === "D" || letter === "E") return "terracotta";
  return "muted";
}

export function GradeBadge({
  grade,
  size = "sm",
}: {
  grade: CategoryGrade;
  size?: "sm" | "lg";
}) {
  const label =
    grade.letter && grade.pct !== null
      ? `Grade ${grade.letter}, ${grade.pct} percent`
      : "Grade not available";

  return (
    <span
      className={gradeBadgeVariants({ tone: gradeTone(grade.letter), size })}
    >
      <span className="sr-only">{label}</span>
      <span aria-hidden="true">{grade.letter ?? "–"}</span>
    </span>
  );
}

const CONTEXT_ICONS: ReadonlyArray<{
  key: keyof Omit<EnvironmentContext, "areaType">;
  label: string;
  icon: LucideIcon;
}> = [
  { key: "location", label: "Location", icon: MapPin },
  { key: "weather", label: "Weather", icon: Sun },
  { key: "nights", label: "Nights", icon: Moon },
  { key: "outdoorAir", label: "Outdoor air", icon: Wind },
  { key: "pets", label: "Pets", icon: Cat },
];

export function EnvironmentHero({
  grade,
  known,
  total,
  context,
}: {
  grade: CategoryGrade;
  known: number;
  total: number;
  context: EnvironmentContext;
}) {
  const coverage = total === 0 ? 0 : Math.round((100 * known) / total);

  return (
    <section
      aria-labelledby="environment-grade-title"
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      <div className="grid lg:grid-cols-2">
        <div className="flex items-center gap-5 px-5 py-6 sm:px-6">
          <GradeBadge grade={grade} size="lg" />
          <div className="min-w-0">
            <p
              id="environment-grade-title"
              className="text-xs text-muted-foreground"
            >
              Environment grade
            </p>
            {grade.pct === null ? null : (
              <p className="mt-1 font-serif text-3xl font-semibold tracking-[-0.02em] text-foreground">
                {grade.pct}%
              </p>
            )}
          </div>
        </div>

        <div className="border-t border-border px-5 py-6 sm:px-6 lg:border-l lg:border-t-0">
          <p className="text-xs text-muted-foreground">Coverage</p>
          <div className="mt-2 flex items-baseline justify-between gap-4">
            <p className="text-sm font-medium text-foreground">
              Murph knows {known} of {total}
            </p>
            <p className="font-serif text-2xl font-semibold text-foreground">
              {coverage}%
            </p>
          </div>
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary/40"
            role="progressbar"
            aria-label="Overall environment coverage"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={coverage}
          >
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${coverage}%` }}
            />
          </div>
        </div>
      </div>

      <TooltipProvider delay={250}>
        <div
          className="grid grid-cols-2 gap-x-4 gap-y-5 border-t border-border px-5 py-5 sm:px-6 md:grid-cols-3 xl:grid-cols-5"
          aria-label="Current home context"
        >
          {CONTEXT_ICONS.map((item) => {
            const Icon = item.icon;
            const value = context[item.key];
            const isLocation = item.key === "location";
            return (
              <div key={item.key} className="flex min-w-0 items-center gap-3">
                <Icon
                  className="size-4 shrink-0 text-primary"
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{item.label}</p>
                  {isLocation ? (
                    <Tooltip>
                      <TooltipTrigger className="block max-w-full truncate border-b border-dotted border-muted-foreground/60 text-left text-sm font-medium text-foreground">
                        {value}
                      </TooltipTrigger>
                      <TooltipContent>{context.areaType}</TooltipContent>
                    </Tooltip>
                  ) : (
                    <p className="truncate text-sm font-medium text-foreground">
                      {value}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </TooltipProvider>
    </section>
  );
}

export function CategoryCard({
  category,
  note,
  visual,
}: {
  category: ResolvedCategory;
  note: CategoryNote;
  visual: ReactNode;
}) {
  const headingId = `environment-category-${note.id}`;
  const coverage =
    note.total === 0 ? 0 : Math.round((100 * note.known) / note.total);
  const visualLabel =
    category.presentation === "vignette"
      ? `${note.title} illustrated setup`
      : `${note.title} equipment and access`;

  return (
    <article
      aria-labelledby={headingId}
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      <details className="group/category">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-4 marker:hidden transition-colors duration-200 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset motion-reduce:transition-none sm:gap-4 sm:px-6 [&::-webkit-details-marker]:hidden">
          <Image
            src={category.thumbnail.src}
            alt=""
            width={category.thumbnail.w}
            height={category.thumbnail.h}
            className="size-12 shrink-0 object-contain"
          />
          <span
            id={headingId}
            role="heading"
            aria-level={2}
            className="min-w-0 flex-1 truncate font-serif text-base font-semibold tracking-[-0.02em] text-foreground sm:text-xl"
          >
            {note.title}
          </span>
          <GradeBadge grade={note.grade} />
          <span className="w-12 shrink-0 sm:w-24">
            <span className="flex items-baseline justify-between gap-1">
              <span className="font-serif text-base font-semibold text-foreground sm:text-lg">
                {coverage}%
              </span>
              <span className="hidden text-[10px] text-muted-foreground sm:inline">
                {note.known}/{note.total}
              </span>
            </span>
            <span
              className="mt-1 block h-1 overflow-hidden rounded-full bg-secondary/40"
              role="progressbar"
              aria-label={`${note.title} coverage`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={coverage}
            >
              <span
                className="block h-full rounded-full bg-primary"
                style={{ width: `${coverage}%` }}
              />
            </span>
          </span>
          <ChevronDown
            className="size-5 shrink-0 text-muted-foreground transition duration-200 group-open/category:rotate-180 motion-reduce:transition-none"
            aria-hidden="true"
          />
        </summary>

        <div className="grid gap-6 border-t border-border px-4 py-5 sm:px-6 lg:grid-cols-[minmax(280px,0.9fr)_minmax(0,1.1fr)] lg:gap-8 lg:px-8 lg:py-7">
          <section
            aria-label={visualLabel}
            className="bg-muted/60 px-4 py-5 sm:px-5"
          >
            {visual}
          </section>
          <CategoryFactList note={note} />
        </div>
      </details>
    </article>
  );
}

function FactValue({ row }: { row: FactRow }) {
  if (!row.detail) {
    return <span className="text-sm text-foreground">{row.value}</span>;
  }

  return (
    <Tooltip>
      <TooltipTrigger className="inline-flex items-center gap-1 border-b border-dotted border-muted-foreground/60 text-left text-sm text-foreground">
        {row.value}
        <Info className="size-3 text-muted-foreground" aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent>{row.detail}</TooltipContent>
    </Tooltip>
  );
}

type FactStatusKind = "met" | "unmet" | "known" | "unknown" | "skipped";

const FACT_STATUS: Record<
  FactStatusKind,
  { label: string; className: string }
> = {
  met: { label: "within target", className: "border-primary bg-primary" },
  unmet: {
    label: "needs attention",
    className: "border-destructive bg-destructive",
  },
  known: {
    label: "known",
    className: "border-muted-foreground/50 bg-transparent",
  },
  unknown: {
    label: "not known yet",
    className: "border-dashed border-muted-foreground/70 bg-transparent",
  },
  skipped: {
    label: "skipped",
    className: "border-muted-foreground/60 bg-transparent",
  },
};

function FactStatus({ kind }: { kind: FactStatusKind }) {
  const status = FACT_STATUS[kind];

  return (
    <span className="flex size-3 items-center justify-center pt-0.5">
      <span
        className={`flex size-2.5 items-center justify-center rounded-full border ${status.className}`}
        aria-hidden="true"
      >
        {kind === "skipped" ? (
          <span className="text-[8px] leading-none text-muted-foreground">
            –
          </span>
        ) : null}
      </span>
      <span className="sr-only">{status.label}</span>
    </span>
  );
}

function factStatusKind(met: FactRow["met"]): FactStatusKind {
  if (met === true) return "met";
  if (met === false) return "unmet";
  return "known";
}

const FACT_ROW_GRID =
  "gap-x-5 gap-y-1 sm:grid-cols-[minmax(150px,0.9fr)_minmax(90px,0.55fr)_minmax(150px,1fr)]";

function QuietFactRow({
  label,
  kind,
}: {
  label: string;
  kind: "unknown" | "skipped";
}) {
  return (
    <li
      className={`grid ${FACT_ROW_GRID} py-3 text-muted-foreground last:pb-0`}
    >
      <div className="flex min-w-0 items-start gap-3">
        <FactStatus kind={kind} />
        <p className="text-sm font-medium">{label}</p>
      </div>
      <p className="pl-6 text-sm sm:pl-0">
        {kind === "unknown" ? "not known yet" : "skipped"}
      </p>
    </li>
  );
}

function CategoryFactList({ note }: { note: CategoryNote }) {
  const hasRows =
    note.rows.length > 0 ||
    note.unknownLabels.length > 0 ||
    note.skippedLabels.length > 0;
  const hasGoal = note.rows.some((row) => row.target !== null);

  return (
    <TooltipProvider delay={250}>
      <section aria-label={`${note.title} facts`} className="min-w-0">
        {hasGoal ? (
          <div
            className={`hidden ${FACT_ROW_GRID} mb-1 border-b border-border pb-1.5 sm:grid`}
            aria-hidden="true"
          >
            <span className="text-right text-xs text-muted-foreground sm:col-start-3">
              Target
            </span>
          </div>
        ) : null}

        {hasRows ? (
          <ul className="divide-y divide-border" role="list">
            {note.rows.map((row) => (
              <li
                key={row.indicatorId}
                className={`grid ${FACT_ROW_GRID} py-3 last:pb-0`}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <FactStatus kind={factStatusKind(row.met)} />
                  <p className="text-sm font-medium text-foreground">
                    {row.label}
                  </p>
                </div>
                <p className="min-w-0 pl-6 sm:pl-0">
                  <FactValue row={row} />
                </p>
                {row.target ? (
                  <p className="pl-6 text-xs text-muted-foreground sm:pl-0 sm:text-right">
                    {row.target}
                  </p>
                ) : null}
              </li>
            ))}
            {note.unknownLabels.map((label) => (
              <QuietFactRow
                key={`unknown-${label}`}
                label={label}
                kind="unknown"
              />
            ))}
            {note.skippedLabels.map((label) => (
              <QuietFactRow
                key={`skipped-${label}`}
                label={label}
                kind="skipped"
              />
            ))}
          </ul>
        ) : null}
      </section>
    </TooltipProvider>
  );
}
