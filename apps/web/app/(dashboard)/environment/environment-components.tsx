"use client";

import { useState, type ReactNode, type SVGProps } from "react";
import { cva } from "class-variance-authority";
import Image from "next/image";
import Link from "next/link";
import {
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  MapPin,
  MessageCircle,
  Moon,
  Printer,
  Share2,
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

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/src/components/ui/sheet";
import type {
  CategoryGrade,
  CategoryNote,
  FactRow,
  QuietFact,
} from "./category-notes";
import { INDICATOR_GUIDES } from "./indicator-guides";
import {
  CATEGORY_THUMBNAILS,
  INDICATOR_SPRITES,
  type ObjectSprite as ObjectSpriteDefinition,
  type ResolvedCategory,
} from "./home-model";

type EnvironmentContext = {
  location: string;
  areaType: string;
  weather: string;
  nights: string;
  outdoorAir: string;
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
        xs: "size-7 rounded-lg text-sm",
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
  size?: "xs" | "sm" | "lg";
}) {
  const bonusSummary =
    grade.capabilityBonus && grade.basePct !== undefined
      ? `, based on ${grade.basePct} percent from conditions plus a ${grade.capabilityBonus} point capability bonus`
      : "";
  const label =
    grade.letter && grade.pct !== null
      ? grade.redFlags > 0
        ? `Grade ${grade.letter}, capped by ${grade.redFlags} red ${
            grade.redFlags === 1 ? "flag" : "flags"
          }; ${grade.pct} percent${bonusSummary}`
        : `Grade ${grade.letter}, ${grade.pct} percent${bonusSummary}`
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

function GradeDialog({
  open,
  onOpenChange,
  title,
  grade,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  grade: CategoryGrade;
  children: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-border bg-muted/40 px-7 pb-6 pt-7">
          <div className="flex items-center gap-5 pr-8">
            <GradeBadge grade={grade} size="lg" />
            <div className="min-w-0">
              <DialogTitle className="font-serif text-xl font-semibold tracking-[-0.02em]">
                {title}
              </DialogTitle>
              <DialogDescription className="mt-1.5 text-sm leading-relaxed">
                {grade.eligible === 0
                  ? "Informational facts only. This category isn't graded."
                  : grade.letter === null
                  ? grade.redFlags > 0
                    ? `Murph found ${
                        grade.redFlags === 1
                          ? "an urgent issue"
                          : `${grade.redFlags} urgent issues`
                      }, but knows only ${grade.graded} of ${
                        grade.eligible
                      } scoreable conditions. At least half are needed for a complete grade.`
                    : `Murph knows ${grade.graded} of ${grade.eligible} scoreable conditions. At least half are needed for a fair grade.`
                  : grade.redFlags > 0
                  ? `${
                      grade.redFlags === 1
                        ? "An urgent issue caps"
                        : `${grade.redFlags} urgent issues cap`
                    } this grade at E. ${grade.met} of ${
                      grade.graded
                    } known conditions are within target.${
                      grade.capabilityBonus && grade.basePct !== undefined
                        ? ` The ${grade.capabilityBonus}-point capability bonus cannot remove this cap.`
                        : ""
                    }`
                  : `${grade.met} of ${
                      grade.graded
                    } known conditions are within target. Unknown facts do not lower the grade.${
                      grade.capabilityBonus && grade.basePct !== undefined
                        ? ` The base result is ${
                            grade.basePct
                          }%. Available capabilities add ${
                            grade.capabilityBonus
                          } points${
                            grade.basePct + grade.capabilityBonus > 100
                              ? ", with the total limited to 100%."
                              : "."
                          }`
                        : ""
                    }`}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="px-7 py-4">{children}</div>
      </DialogContent>
    </Dialog>
  );
}

function GradeBadgeButton({
  grade,
  onClick,
  size = "sm",
}: {
  grade: CategoryGrade;
  onClick: () => void;
  size?: "sm" | "lg";
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
      className="cursor-pointer rounded-xl transition-transform duration-150 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
      aria-label="How this grade is calculated"
    >
      <GradeBadge grade={grade} size={size} />
    </button>
  );
}

function CategoryGradeButton({ note }: { note: CategoryNote }) {
  const [open, setOpen] = useState(false);
  const unmet = note.rows.filter((row) => row.met === false);

  return (
    <>
      <GradeBadgeButton grade={note.grade} onClick={() => setOpen(true)} />
      <GradeDialog
        open={open}
        onOpenChange={setOpen}
        title={note.title}
        grade={note.grade}
      >
        {unmet.length > 0 ? (
          <ul className="divide-y divide-border">
            {unmet.map((row) => (
              <li
                key={row.indicatorId}
                className="flex items-baseline justify-between gap-4 py-3 text-sm"
              >
                <span className="font-medium text-foreground">{row.label}</span>
                <span className="text-destructive">{row.value}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-3 text-sm text-muted-foreground">
            {note.grade.eligible > 0
              ? "Everything graded here is within target."
              : "Nothing to fix. These facts are context, not targets."}
          </p>
        )}
      </GradeDialog>
    </>
  );
}

function OverallGradeDialog({
  open,
  onOpenChange,
  grade,
  notes,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  grade: CategoryGrade;
  notes: CategoryNote[];
}) {
  return (
    <GradeDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Environment grade"
      grade={grade}
    >
      <ul className="divide-y divide-border">
        {notes.map((note) => {
          const thumbnail = CATEGORY_THUMBNAILS[note.id];
          const pct =
            note.grade.eligible === 0
              ? 0
              : Math.round((100 * note.grade.graded) / note.grade.eligible);
          return (
            <li key={note.id} className="flex items-center gap-3.5 py-3">
              {thumbnail ? (
                <Image
                  src={thumbnail.src}
                  alt=""
                  width={thumbnail.w}
                  height={thumbnail.h}
                  className="size-8 shrink-0 object-contain"
                />
              ) : (
                <span className="size-8 shrink-0" aria-hidden="true" />
              )}
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                {note.title}
              </span>
              {note.grade.eligible === 0 ? (
                <span className="text-xs text-muted-foreground">
                  not graded
                </span>
              ) : note.grade.letter === null ? (
                <span className="text-xs text-muted-foreground">
                  {note.grade.graded}/{note.grade.eligible} known
                </span>
              ) : (
                <>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {note.grade.met}/{note.grade.graded}
                  </span>
                  <span
                    className="h-1 w-16 overflow-hidden rounded-full bg-secondary/40"
                    aria-hidden="true"
                  >
                    <span
                      className="block h-full rounded-full bg-primary"
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                </>
              )}
              <GradeBadge grade={note.grade} size="xs" />
            </li>
          );
        })}
      </ul>
    </GradeDialog>
  );
}

export function ShareEnvironmentButton({
  coverage,
  disabled = false,
  grade,
  known,
  total,
}: {
  coverage: number;
  disabled?: boolean;
  grade: CategoryGrade;
  known: number;
  total: number;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  const share = async () => {
    if (grade.letter === null || grade.pct === null) {
      return;
    }
    setFailed(false);
    const url = window.location.origin + window.location.pathname;
    const title = `My Environment score is ${grade.pct}%`;
    try {
      const response = await fetch("/api/environment/share-card", {
        body: JSON.stringify({
          coverage,
          grade: grade.letter,
          known,
          score: grade.pct,
          total,
        }),
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("Environment share card could not be created.");
      }
      const blob = await response.blob();
      const file = new File([blob], "my-environment-grade.png", {
        type: "image/png",
      });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title,
          text: `My Environment score is ${grade.pct}%. ${url}`,
        });
        return;
      }
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      setFailed(true);
      setTimeout(() => setFailed(false), 2500);
    }
  };

  const label = failed ? (
    <>
      <Share2 className="size-3.5" aria-hidden="true" />
      Try sharing again
    </>
  ) : copied ? (
    <>
      <Check className="size-3.5 text-primary" aria-hidden="true" />
      Link copied
    </>
  ) : (
    <>
      <Share2 className="size-3.5" aria-hidden="true" />
      Share
    </>
  );

  if (disabled) {
    return (
      <TooltipProvider delay={150}>
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="inline-flex cursor-not-allowed" tabIndex={0} />
            }
          >
            <button
              type="button"
              disabled
              className="pointer-events-none inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground/50"
            >
              {label}
            </button>
          </TooltipTrigger>
          <TooltipContent>
            Add enough details for a fair grade before sharing.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <button
      type="button"
      onClick={share}
      className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
    >
      {label}
    </button>
  );
}

export function PrintEnvironmentLink() {
  return (
    <Link
      href="/environment/print"
      target="_blank"
      rel="noreferrer"
      className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
    >
      <Printer className="size-3.5" aria-hidden="true" />
      Print report
    </Link>
  );
}

const CONTEXT_ICONS: ReadonlyArray<{
  key: keyof EnvironmentContext;
  label: string;
  icon: LucideIcon;
}> = [
  { key: "location", label: "Location", icon: MapPin },
  { key: "areaType", label: "Area", icon: Building2 },
  { key: "weather", label: "Weather", icon: Sun },
  { key: "nights", label: "Nights", icon: Moon },
  { key: "outdoorAir", label: "Outdoor air", icon: Wind },
];

export function EnvironmentHero({
  grade,
  known,
  total,
  context,
  notes,
  missingTopicByKey,
  onFillMissing,
}: {
  grade: CategoryGrade;
  known: number;
  total: number;
  context: EnvironmentContext;
  notes: CategoryNote[];
  missingTopicByKey?: Partial<Record<keyof EnvironmentContext, string>>;
  onFillMissing?: (topicId: string) => void;
}) {
  const coverage = total === 0 ? 0 : Math.round((100 * known) / total);
  const [gradeOpen, setGradeOpen] = useState(false);

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
            {grade.pct === null ? (
              <p className="mt-1 max-w-xs text-sm font-medium leading-snug text-foreground">
                {known === 0
                  ? "A few facts unlock your first fair grade"
                  : "Not enough information for a fair grade"}
              </p>
            ) : (
              <button
                type="button"
                onClick={() => setGradeOpen(true)}
                aria-label="How this grade is calculated"
                className="mt-1 cursor-pointer border-b border-dotted border-muted-foreground/60 font-serif text-3xl font-semibold tracking-[-0.02em] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {grade.pct}%
              </button>
            )}
            {grade.redFlags > 0 ? (
              <button
                type="button"
                onClick={() => setGradeOpen(true)}
                className="mt-2 block text-left text-xs font-medium text-destructive underline decoration-destructive/40 underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {grade.redFlags} urgent{" "}
                {grade.redFlags === 1 ? "issue" : "issues"}{" "}
                {grade.letter === "E"
                  ? `${grade.redFlags === 1 ? "caps" : "cap"} the grade at E`
                  : `${grade.redFlags === 1 ? "needs" : "need"} attention now`}
              </button>
            ) : null}
          </div>
          <OverallGradeDialog
            open={gradeOpen}
            onOpenChange={setGradeOpen}
            grade={grade}
            notes={notes}
          />
        </div>

        <div className="border-t border-border px-5 py-6 sm:px-6 lg:border-l lg:border-t-0">
          <p className="text-xs text-muted-foreground">Coverage</p>
          <div className="mt-2 flex items-baseline justify-between gap-4">
            <p className="text-sm font-medium text-foreground">
              {known === 0
                ? "Start with five short topics"
                : `Murph knows ${known} of ${total} conditions`}
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

      <div
        className="grid grid-cols-2 gap-x-4 gap-y-5 border-t border-border px-5 py-5 sm:px-6 md:grid-cols-3 xl:grid-cols-5"
        aria-label="Current home context"
      >
        {CONTEXT_ICONS.map((item) => {
          const Icon = item.icon;
          const topicId = missingTopicByKey?.[item.key];
          const content = (
            <>
              <Icon
                className="size-4 shrink-0 text-primary"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{item.label}</p>
                <p
                  className={`truncate text-sm font-medium ${
                    topicId
                      ? "text-primary underline decoration-primary/30 underline-offset-2"
                      : "text-foreground"
                  }`}
                >
                  {context[item.key]}
                </p>
              </div>
            </>
          );
          return topicId && onFillMissing ? (
            <button
              className="flex min-w-0 cursor-pointer items-center gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              key={item.key}
              onClick={() => onFillMissing(topicId)}
              type="button"
            >
              {content}
            </button>
          ) : (
            <div key={item.key} className="flex min-w-0 items-center gap-3">
              {content}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function CategoryCard({
  category,
  note,
  chatHref,
  renderFillMissing,
  voiceAction,
}: {
  category: ResolvedCategory;
  note: CategoryNote;
  chatHref: string | null;
  renderFillMissing?: (indicatorId: string) => ReactNode;
  voiceAction?: ReactNode;
}) {
  const headingId = `environment-category-${note.id}`;
  const coverage =
    note.total === 0 ? 0 : Math.round((100 * note.known) / note.total);

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
          <CategoryGradeButton note={note} />
          <span className="w-12 shrink-0 sm:w-28">
            {note.total === 0 ? (
              <span className="block text-right text-xs text-muted-foreground">
                Optional
              </span>
            ) : (
              <>
                <span className="block text-right text-xs text-muted-foreground">
                  <span className="font-serif text-base font-semibold text-foreground sm:text-lg">
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
              </>
            )}
          </span>
          <ChevronDown
            className="size-5 shrink-0 text-muted-foreground transition duration-200 group-open/category:rotate-180 motion-reduce:transition-none"
            aria-hidden="true"
          />
        </summary>

        <div className="border-t border-border px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
          <CategoryFactList
            category={category}
            note={note}
            chatHref={chatHref}
            renderFillMissing={renderFillMissing}
            voiceAction={voiceAction}
          />
        </div>
      </details>
    </article>
  );
}

function FactValue({ row }: { row: FactRow }) {
  return <span className="text-sm text-foreground">{row.value}</span>;
}

type FactStatusKind =
  | "met"
  | "unmet"
  | "known"
  | "unknown"
  | "optional"
  | "skipped";

const FACT_ICON_RING: Record<FactStatusKind, string> = {
  met: "border border-secondary",
  unmet: "border border-secondary",
  known: "border border-secondary",
  unknown: "border border-dashed border-muted-foreground/70",
  optional: "border border-secondary",
  skipped: "border border-dashed border-muted-foreground/70",
};

function ObjectSprite({
  sprite,
  ...imageProps
}: Omit<SVGProps<SVGImageElement>, "href"> & {
  sprite: ObjectSpriteDefinition;
}) {
  return (
    <image
      href={sprite.src}
      width={sprite.w}
      height={sprite.h}
      preserveAspectRatio="xMidYMid meet"
      {...imageProps}
    />
  );
}

function FactIcon({
  kind,
  sprite,
}: {
  kind: FactStatusKind;
  sprite?: ObjectSpriteDefinition;
}) {
  return (
    <span
      className={`flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary/20 ${FACT_ICON_RING[kind]}`}
    >
      {kind === "unknown" ? (
        <span
          className="font-mono text-sm font-semibold text-primary"
          aria-hidden="true"
        >
          ?
        </span>
      ) : kind === "skipped" ? (
        <span
          className="font-mono text-sm text-muted-foreground"
          aria-hidden="true"
        >
          –
        </span>
      ) : (
        <svg viewBox="0 0 64 64" className="size-8" aria-hidden="true">
          {sprite ? (
            <ObjectSprite sprite={sprite} x={4} y={4} width={56} height={56} />
          ) : (
            <>
              <rect
                x={13}
                y={15}
                width={38}
                height={34}
                rx={7}
                fill="#fffcf6"
                stroke="#736a58"
                strokeWidth={1.5}
              />
              <circle cx={32} cy={32} r={4} fill="#7a8c6e" />
            </>
          )}
        </svg>
      )}
    </span>
  );
}

function factStatusKind(met: FactRow["met"]): FactStatusKind {
  if (met === true) return "met";
  if (met === false) return "unmet";
  return "known";
}

const FACT_ROW_GRID =
  "gap-x-5 gap-y-1 sm:grid-cols-[minmax(170px,1fr)_minmax(120px,0.7fr)_minmax(140px,0.9fr)_1rem] sm:items-center";

export type SelectedFact = {
  indicatorId: string;
  label: string;
  kind: FactStatusKind;
  value: string | null;
  target: string | null;
  detail: string | null;
  note: string | null;
};

function UnmetFlag() {
  return (
    <span className="ml-2 text-xs font-medium text-destructive">
      needs attention
    </span>
  );
}

function FactRowButton({
  children,
  muted = false,
  onClick,
}: {
  children: React.ReactNode;
  muted?: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`group/fact relative grid w-full ${FACT_ROW_GRID} cursor-pointer rounded-lg px-3 py-2.5 text-left transition-colors duration-150 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset motion-reduce:transition-none ${
          muted ? "text-muted-foreground" : ""
        }`}
      >
        {children}
      </button>
    </li>
  );
}

function RowChevron() {
  return (
    <ChevronRight
      className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/50 transition-colors duration-150 group-hover/fact:text-muted-foreground sm:static sm:translate-y-0 sm:justify-self-end"
      aria-hidden="true"
    />
  );
}

function buildChatMessage(fact: SelectedFact): string {
  const topic = fact.label.toLowerCase();
  if (fact.kind === "optional") {
    return `Hey Murph, would ${topic} be useful for me?`;
  }
  if (fact.kind === "unknown" || fact.kind === "skipped") {
    return `Hey Murph, you don't know about my ${topic} yet. Let's fill it in.`;
  }
  if (fact.kind === "unmet") {
    const target = fact.target ? ` (target: ${fact.target})` : "";
    return `Hey Murph, my ${topic} is "${fact.value}"${target}. Can you help me improve it?`;
  }
  return `Hey Murph, can we talk about my ${topic}? Mine is "${fact.value}".`;
}

function buildChatHref(chatHref: string, fact: SelectedFact): string {
  const [base, rawQuery = ""] = chatHref.split("?", 2);
  if (chatHref.startsWith("sms:")) {
    return `${base}?body=${encodeURIComponent(buildChatMessage(fact))}`;
  }
  const query = new URLSearchParams(rawQuery);
  query.set("text", buildChatMessage(fact));
  return `${base}?${query}`;
}

function GuideTipList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {title}
      </p>
      <ul className="mt-3.5 flex flex-col gap-3.5">
        {items.map((item) => (
          <li key={item} className="text-sm leading-relaxed text-foreground">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function replaceHash(hash: string | null) {
  if (typeof window === "undefined") return;
  const { pathname, search } = window.location;
  window.history.replaceState(null, "", hash ? `#${hash}` : pathname + search);
}

function FactDrawer({
  fact,
  sprite,
  chatHref,
  onClose,
  renderFillMissing,
  onStep,
  position,
}: {
  fact: SelectedFact | null;
  sprite?: ObjectSpriteDefinition;
  chatHref: string | null;
  onClose: () => void;
  renderFillMissing?: (indicatorId: string) => ReactNode;
  onStep?: (delta: 1 | -1) => void;
  position?: { index: number; total: number };
}) {
  const guide = fact ? INDICATOR_GUIDES[fact.indicatorId] : undefined;
  const quiet =
    fact?.kind === "unknown" ||
    fact?.kind === "optional" ||
    fact?.kind === "skipped";
  const fillMissing =
    fact &&
    (fact.kind === "unknown" ||
      fact.kind === "optional" ||
      fact.kind === "skipped")
      ? renderFillMissing?.(fact.indicatorId)
      : null;

  return (
    <Sheet open={fact !== null} onOpenChange={(open) => open || onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        {fact ? (
          <>
            {onStep && position ? (
              <div className="absolute left-3 top-3 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onStep(-1)}
                  disabled={position.index === 0}
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
                  aria-label="Previous fact"
                >
                  <ChevronUp className="size-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => onStep(1)}
                  disabled={position.index === position.total - 1}
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
                  aria-label="Next fact"
                >
                  <ChevronDown className="size-4" aria-hidden="true" />
                </button>
                <span className="ml-1 text-xs tabular-nums text-muted-foreground">
                  {position.index + 1}/{position.total}
                </span>
              </div>
            ) : null}
            <SheetHeader className="items-center gap-4 pt-10 text-center">
              <span className="flex size-24 items-center justify-center rounded-full border border-secondary bg-secondary/20">
                {fact.kind === "skipped" ? (
                  <span className="font-mono text-2xl text-muted-foreground">
                    –
                  </span>
                ) : fact.kind === "unknown" || !sprite ? (
                  <span className="font-mono text-2xl font-semibold text-primary">
                    ?
                  </span>
                ) : (
                  <svg
                    viewBox="0 0 64 64"
                    className="size-18"
                    aria-hidden="true"
                  >
                    <ObjectSprite
                      sprite={sprite}
                      x={4}
                      y={4}
                      width={56}
                      height={56}
                    />
                  </svg>
                )}
              </span>
              <SheetTitle className="text-2xl tracking-[-0.02em]">
                {fact.label}
              </SheetTitle>
            </SheetHeader>

            <div className="flex flex-col gap-7 px-6 pb-6">
              {guide && guide.keyPoints.length > 0 ? (
                <p className="font-serif text-[15.5px] leading-relaxed text-foreground/90 text-pretty">
                  {guide.keyPoints.join(" ")}
                </p>
              ) : null}
              <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
                {fact.kind === "unknown" ? (
                  <p className="text-sm text-muted-foreground">
                    Murph doesn&apos;t know this about your home yet.
                  </p>
                ) : fact.kind === "optional" ? (
                  <p className="text-sm text-muted-foreground">
                    Optional context. This never affects your environment grade.
                  </p>
                ) : fact.kind === "skipped" ? (
                  <p className="text-sm text-muted-foreground">
                    You skipped this one. You can pick it up with Murph any
                    time.
                  </p>
                ) : (
                  <dl className="flex flex-col gap-3">
                    <div
                      className={`grid gap-4 ${
                        fact.target ? "grid-cols-2" : "grid-cols-1"
                      }`}
                    >
                      <div className="flex flex-col gap-1">
                        <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                          Yours
                        </dt>
                        <dd className="text-sm font-medium text-foreground">
                          {fact.value}
                          {fact.kind === "unmet" ? <UnmetFlag /> : null}
                        </dd>
                      </div>
                      {fact.target ? (
                        <div className="flex flex-col gap-1">
                          <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                            Target
                          </dt>
                          <dd className="text-sm text-muted-foreground">
                            {fact.target}
                          </dd>
                        </div>
                      ) : null}
                    </div>
                    {fact.detail ? (
                      <p className="text-xs text-muted-foreground">
                        {fact.detail}
                      </p>
                    ) : null}
                    {fact.note ? (
                      <div className="border-t border-border pt-3">
                        <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                          What Murph remembers
                        </dt>
                        <dd className="mt-1.5 text-sm leading-relaxed text-foreground">
                          {fact.note}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                )}
              </div>

              {guide?.sections.map((section) => (
                <GuideTipList
                  key={section.title}
                  title={section.title}
                  items={section.items}
                />
              ))}
            </div>

            {fillMissing ? (
              <SheetFooter className="border-t border-border">
                {fillMissing}
              </SheetFooter>
            ) : chatHref ? (
              <SheetFooter className="border-t border-border">
                <a
                  href={buildChatHref(chatHref, fact)}
                  target={chatHref.startsWith("sms:") ? undefined : "_blank"}
                  rel={chatHref.startsWith("sms:") ? undefined : "noreferrer"}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  <MessageCircle className="size-4" aria-hidden="true" />
                  {fact.kind === "optional"
                    ? "Ask Murph about it"
                    : quiet
                    ? "Tell Murph about it"
                    : "Talk to Murph about it"}
                </a>
              </SheetFooter>
            ) : null}
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

export type NextCheckItem = {
  fact: SelectedFact;
  sprite?: ObjectSpriteDefinition;
  categoryTitle: string;
};

export function NextChecksStrip({
  items,
  chatHref,
  renderFillMissing,
}: {
  items: NextCheckItem[];
  chatHref: string | null;
  renderFillMissing?: (indicatorId: string) => ReactNode;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const unmet = items.filter((item) => item.fact.kind === "unmet");
  const shown = [
    ...unmet.slice(0, 2),
    ...items.filter((item) => item.fact.kind !== "unmet"),
    ...unmet.slice(2),
  ].slice(0, 3);
  const selectedIndex = shown.findIndex(
    (item) => item.fact.indicatorId === selectedId,
  );
  const selected = selectedIndex === -1 ? null : shown[selectedIndex];

  if (items.length === 0) {
    return null;
  }

  const open = (item: NextCheckItem) => {
    setSelectedId(item.fact.indicatorId);
    replaceHash(item.fact.indicatorId);
  };
  const close = () => {
    setSelectedId(null);
    replaceHash(null);
  };
  const step = (delta: 1 | -1) => {
    if (selectedIndex === -1) return;
    const next = shown[selectedIndex + delta];
    if (next) open(next);
  };
  return (
    <section aria-label="What to check next">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        What to check next
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((item) => (
          <button
            key={item.fact.indicatorId}
            type="button"
            onClick={() => open(item)}
            className="group/check flex w-full cursor-pointer items-center gap-3 rounded-xl border border-border bg-card px-4 py-3.5 text-left transition-colors duration-150 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
          >
            <FactIcon kind={item.fact.kind} sprite={item.sprite} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">
                {item.fact.label}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {item.fact.kind === "unknown"
                  ? `not known yet · ${item.categoryTitle}`
                  : `${item.fact.value} · ${item.categoryTitle}`}
              </span>
            </span>
            {item.fact.kind === "unmet" ? (
              <span className="shrink-0 text-xs font-medium text-destructive">
                fix
              </span>
            ) : (
              <span className="shrink-0 text-xs font-medium text-primary">
                fill in
              </span>
            )}
            <ChevronRight
              className="size-4 shrink-0 text-muted-foreground/50 transition-colors duration-150 group-hover/check:text-muted-foreground"
              aria-hidden="true"
            />
          </button>
        ))}
      </div>

      <FactDrawer
        fact={selected?.fact ?? null}
        sprite={selected?.sprite}
        chatHref={chatHref}
        onClose={close}
        renderFillMissing={renderFillMissing}
        onStep={step}
        position={
          selected === null
            ? undefined
            : { index: selectedIndex, total: shown.length }
        }
      />
    </section>
  );
}

function quietToSelected(
  fact: QuietFact,
  kind: "unknown" | "optional" | "skipped",
): SelectedFact {
  return {
    indicatorId: fact.indicatorId,
    label: fact.label,
    kind,
    value: null,
    target: null,
    detail: null,
    note: null,
  };
}

function rowToSelected(row: FactRow): SelectedFact {
  return {
    indicatorId: row.indicatorId,
    label: row.label,
    kind: factStatusKind(row.met),
    value: row.value,
    target: row.target,
    detail: row.detail,
    note: row.note,
  };
}

const CATEGORY_SECTION_DESCRIPTIONS: Readonly<Record<string, string>> = {
  air: "Air, water and home exposures that shape everyday health.",
  light: "Morning and evening light that shape sleep and daily rhythm.",
  recovery: "Recovery tools and health devices available when you need them.",
  sleep: "Temperature, darkness and noise that shape your sleep.",
  workspace: "Your desk setup, movement and comfort while you work.",
};

function CategoryFactList({
  category,
  note,
  chatHref,
  renderFillMissing,
  voiceAction,
}: {
  category: ResolvedCategory;
  note: CategoryNote;
  chatHref: string | null;
  renderFillMissing?: (indicatorId: string) => ReactNode;
  voiceAction?: ReactNode;
}) {
  const facts: SelectedFact[] = [
    ...note.rows.map(rowToSelected),
    ...note.optionalFacts.map((fact) => quietToSelected(fact, "optional")),
    ...note.unknownFacts.map((fact) => quietToSelected(fact, "unknown")),
    ...note.skippedFacts.map((fact) => quietToSelected(fact, "skipped")),
  ];
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const selected = selectedIndex === null ? null : facts[selectedIndex] ?? null;

  const openIndex = (index: number) => {
    setSelectedIndex(index);
    replaceHash(facts[index]?.indicatorId ?? null);
  };
  const close = () => {
    setSelectedIndex(null);
    replaceHash(null);
  };
  const step = (delta: 1 | -1) => {
    if (selectedIndex === null) return;
    const next = selectedIndex + delta;
    if (next >= 0 && next < facts.length) openIndex(next);
  };

  const spriteByIndicatorId = new Map(
    category.objects.flatMap((object) =>
      object.sprite && !object.decor
        ? [[object.indicatorId, object.sprite] as const]
        : [],
    ),
  );
  const spriteFor = (indicatorId: string) =>
    spriteByIndicatorId.get(indicatorId) ?? INDICATOR_SPRITES[indicatorId];
  const hasRows = facts.length > 0;
  const hasGoal = note.rows.some((row) => row.target !== null);
  const description = CATEGORY_SECTION_DESCRIPTIONS[note.id];

  return (
    <section aria-label={`${note.title} facts`} className="min-w-0">
      {voiceAction ? (
        <div className="mb-3 flex flex-col gap-3 border-b border-border pb-4 min-[480px]:flex-row min-[480px]:items-center min-[480px]:justify-between">
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
          <div className="shrink-0">{voiceAction}</div>
        </div>
      ) : null}
      {hasRows ? (
        <div className={`${FACT_ROW_GRID} mb-1 hidden pb-2.5 sm:grid`}>
          <span />
          <span className="hidden text-xs text-muted-foreground sm:block">
            Yours
          </span>
          {hasGoal ? (
            <span className="hidden text-xs text-muted-foreground sm:block">
              Target
            </span>
          ) : null}
        </div>
      ) : null}

      {hasRows ? (
        <ul className="-mx-3 divide-y divide-border" role="list">
          {note.rows.map((row, index) => (
            <FactRowButton
              key={row.indicatorId}
              onClick={() => openIndex(index)}
            >
              <span className="flex min-w-0 items-center gap-3">
                <FactIcon
                  kind={factStatusKind(row.met)}
                  sprite={spriteFor(row.indicatorId)}
                />
                <span className="text-sm font-medium text-foreground">
                  {row.label}
                </span>
              </span>
              <span className="min-w-0 pl-13 sm:pl-0">
                <span className="sr-only">Yours: </span>
                <FactValue row={row} />
                {row.met === false ? <UnmetFlag /> : null}
              </span>
              <span className="pl-13 text-xs text-muted-foreground sm:pl-0">
                {row.target ? (
                  <>
                    <span className="sr-only">Target: </span>
                    {row.target}
                  </>
                ) : null}
              </span>
              <RowChevron />
            </FactRowButton>
          ))}
          {note.optionalFacts.map((fact, index) => (
            <FactRowButton
              key={`optional-${fact.indicatorId}`}
              muted
              onClick={() => openIndex(note.rows.length + index)}
            >
              <span className="flex min-w-0 items-center gap-3">
                <FactIcon
                  kind="optional"
                  sprite={spriteFor(fact.indicatorId)}
                />
                <span className="text-sm font-medium">{fact.label}</span>
              </span>
              <span className="pl-13 text-sm sm:pl-0">
                optional · not graded
              </span>
              <span aria-hidden="true" />
              <RowChevron />
            </FactRowButton>
          ))}
          {note.unknownFacts.map((fact, index) => (
            <FactRowButton
              key={`unknown-${fact.indicatorId}`}
              muted
              onClick={() =>
                openIndex(note.rows.length + note.optionalFacts.length + index)
              }
            >
              <span className="flex min-w-0 items-center gap-3">
                <FactIcon kind="unknown" />
                <span className="text-sm font-medium">{fact.label}</span>
              </span>
              <span className="pl-13 text-sm sm:pl-0">not known yet</span>
              <span aria-hidden="true" />
              <RowChevron />
            </FactRowButton>
          ))}
          {note.skippedFacts.map((fact, index) => (
            <FactRowButton
              key={`skipped-${fact.indicatorId}`}
              muted
              onClick={() =>
                openIndex(
                  note.rows.length +
                    note.optionalFacts.length +
                    note.unknownFacts.length +
                    index,
                )
              }
            >
              <span className="flex min-w-0 items-center gap-3">
                <FactIcon kind="skipped" />
                <span className="text-sm font-medium">{fact.label}</span>
              </span>
              <span className="pl-13 text-sm sm:pl-0">skipped</span>
              <span aria-hidden="true" />
              <RowChevron />
            </FactRowButton>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          Optional context appears here when you mention equipment or access to
          Murph. None of it is required for a good grade.
        </p>
      )}

      <FactDrawer
        fact={selected}
        sprite={selected ? spriteFor(selected.indicatorId) : undefined}
        chatHref={chatHref}
        onClose={close}
        renderFillMissing={renderFillMissing}
        onStep={step}
        position={
          selectedIndex === null
            ? undefined
            : { index: selectedIndex, total: facts.length }
        }
      />
    </section>
  );
}
