import {
  Activity,
  AlertOctagon,
  Baby,
  Brain,
  CircleAlert,
  Droplet,
  Flame,
  HeartPulse,
  Info,
  LogOut,
  ShieldAlert,
  Stethoscope,
  Thermometer,
  Wine,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/src/lib/utils";

interface SafetySectionProps {
  cautionLevel: number;
  whoShouldAvoid: string[];
  precautions: string[];
}

export function SafetySection({
  cautionLevel,
  whoShouldAvoid,
  precautions,
}: SafetySectionProps) {
  const hasAvoid = whoShouldAvoid.length > 0;
  const hasPrecautions = precautions.length > 0;

  return (
    <div id="safety-section" className="flex scroll-mt-8 flex-col gap-3">
      <div className={cn("grid gap-3", hasPrecautions && "lg:grid-cols-2")}>
        <div className="flex flex-col gap-6 rounded-xl border border-destructive/20 bg-destructive/4 p-6">
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-[11px]/3.5 uppercase tracking-[0.12em] text-chart-4">
              Safety
            </span>
            <h2 className="font-serif text-base font-semibold text-foreground">
              {cautionTitle(cautionLevel)}
            </h2>
          </div>

          <div className="flex flex-1 flex-col gap-5 sm:flex-row sm:items-stretch sm:gap-6">
            <div className="shrink-0 self-center sm:self-stretch">
              <CautionThermometer level={cautionLevel} />
            </div>

            {hasAvoid ? (
              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <div className="flex flex-col gap-0.5">
                  <h3 className="text-sm font-semibold text-foreground">
                    Skip this if you have
                  </h3>
                  <span className="text-xs/4 text-muted-foreground">
                    Get clinician guidance before starting if any apply.
                  </span>
                </div>
                <ul role="list" className="flex flex-wrap gap-1.5">
                  {whoShouldAvoid.map((item) => {
                    const Icon = whoIcon(item);
                    return (
                      <li
                        key={item}
                        className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-destructive/25 bg-background/70 px-2.5 py-1 text-xs/4 text-foreground"
                      >
                        <Icon className="size-3.5 shrink-0 text-destructive" />
                        <span className="min-w-0 break-words">{item}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </div>
        </div>

        {hasPrecautions ? (
          <div className="flex flex-col gap-5 rounded-xl border border-foreground/10 bg-cream-dark/50 p-6">
            <div className="flex flex-col gap-0.5">
              <span className="font-mono text-[11px]/3.5 uppercase tracking-[0.12em] text-muted-foreground">
                Precautions
              </span>
              <h2 className="font-serif text-base font-semibold text-foreground">
                Stay safe before, during, and after each session.
              </h2>
            </div>
            <ul role="list" className="flex flex-1 flex-col">
              {precautions.map((item, idx) => {
                const Icon = precautionIcon(item);
                return (
                  <li
                    key={item}
                    className={cn(
                      "flex items-start gap-3 py-2",
                      idx > 0 && "border-t border-foreground/8",
                    )}
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-destructive/10">
                      <Icon className="size-3.5 text-destructive" />
                    </span>
                    <span className="min-w-0 break-words pt-1 text-sm/5 text-foreground">
                      {item}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function cautionTitle(level: number): string {
  const clamped = Math.max(1, Math.min(5, level));
  if (clamped <= 2) return "Low caution";
  if (clamped <= 3) return "Moderate caution";
  return "High caution";
}

function CautionThermometer({ level }: { level: number }) {
  const clamped = Math.max(1, Math.min(5, level));
  const tubeFillPct = ((clamped - 1) / 4) * 100;

  return (
    <div
      role="img"
      aria-label={`Caution level ${clamped} of 5: ${cautionTitle(clamped)}`}
      className="flex h-full min-h-72 items-stretch gap-3"
    >
      <div aria-hidden="true" className="flex flex-col justify-between py-1 font-mono text-[10px]/3 uppercase tracking-wide text-muted-foreground">
        <span>High</span>
        <span>Mod</span>
        <span>Low</span>
      </div>
      <div aria-hidden="true" className="flex flex-col items-center">
        <div className="relative w-3.5 flex-1 overflow-hidden rounded-t-full border border-b-0 border-destructive/35 bg-secondary/25">
          <div
            className="absolute inset-0 bg-linear-to-t from-primary via-[#c4a882] to-destructive"
            style={{ clipPath: `inset(${100 - tubeFillPct}% 0 0 0)` }}
          />
        </div>
        <svg
          width="32"
          height="36"
          viewBox="0 0 32 36"
          aria-hidden="true"
          className="shrink-0"
        >
          <path
            d="M9 0 L9 8 A14 14 0 1 0 23 8 L23 0 Z"
            fill="var(--primary)"
            stroke="var(--destructive)"
            strokeOpacity="0.35"
            strokeWidth="1"
          />
        </svg>
      </div>
    </div>
  );
}

function whoIcon(text: string): LucideIcon {
  const lower = text.toLowerCase();
  if (/heart|cardiac|angina|infarction|arrhythmia|failure|stenosis/.test(lower)) {
    return HeartPulse;
  }
  if (/hypertension|blood pressure/.test(lower)) return Activity;
  if (/stroke|brain/.test(lower)) return Brain;
  if (/pregnan/.test(lower)) return Baby;
  if (/fever|illness|infection/.test(lower)) return Thermometer;
  if (/dehydr|fainting|faint/.test(lower)) return Droplet;
  if (/heat/.test(lower)) return Flame;
  return CircleAlert;
}

function precautionIcon(text: string): LucideIcon {
  const lower = text.toLowerCase();
  if (/^stop if/.test(lower)) return AlertOctagon;
  if (/alcohol/.test(lower)) return Wine;
  if (/clinician|treatment plan/.test(lower)) return Stethoscope;
  if (/bounded wellness|self-experiment|disease/.test(lower)) return Info;
  if (/exit|leave|early/.test(lower)) return LogOut;
  if (/temperature|°c|heat-stress/.test(lower)) return Thermometer;
  return ShieldAlert;
}
