import type { ComponentType, ReactNode, SVGProps } from "react";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import {
  ChartPulseIcon,
  FlaskSparkleIcon,
  LabReportIcon,
  WatchHeartIcon,
} from "./home-icons";

const steps: {
  id: "devices" | "experiments" | "labs" | "biomarkers";
  step: number;
  title: string;
  description: string;
  cta: string;
  href: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}[] = [
  {
    id: "devices",
    step: 1,
    title: "Connect devices",
    description:
      "Add Apple Health or a wearable to sync sleep, activity, recovery, and more.",
    cta: "Connect devices",
    href: "/settings",
    icon: WatchHeartIcon,
  },
  {
    id: "experiments",
    step: 2,
    title: "Start an experiment",
    description:
      "Browse protocols like sauna, creatine, or zone 2 and measure what changes.",
    cta: "View experiments",
    href: "/experiments",
    icon: FlaskSparkleIcon,
  },
  {
    id: "labs",
    step: 3,
    title: "Upload labs",
    description:
      "Import blood work or lab results to track biomarkers over time.",
    cta: "Upload labs",
    href: "/settings",
    icon: LabReportIcon,
  },
  {
    id: "biomarkers",
    step: 4,
    title: "Explore biomarkers",
    description:
      "See the signals Murph tracks: sleep, resting heart rate, HRV, weight, glucose, and more.",
    cta: "View biomarkers",
    href: "/biomarkers/resting-heart-rate",
    icon: ChartPulseIcon,
  },
];

export function getOnboardingStepActionClass(isPrimary: boolean): string {
  return isPrimary
    ? "inline-flex items-center gap-2.5 rounded-2xl bg-[#5a6e32] px-6 py-3 text-sm font-medium text-white transition-colors duration-200 hover:bg-[#7a8c6e] focus-visible:ring-2 focus-visible:ring-[#7a8c6e] focus-visible:ring-offset-2"
    : "inline-flex items-center gap-2.5 rounded-2xl border border-foreground/12 px-6 py-3 text-sm font-medium text-foreground transition-all duration-200 hover:border-[#7a8c6e]/30 hover:bg-[#7a8c6e]/[0.04] focus-visible:ring-2 focus-visible:ring-[#7a8c6e] focus-visible:ring-offset-2";
}

export function OnboardingSteps({
  uploadLabsAction = null,
}: {
  uploadLabsAction?: ReactNode;
}) {
  return (
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
      {steps.map((step, i) => {
        const Icon = step.icon;
        const isPrimary = i === 0;
        const customAction = step.id === "labs" ? uploadLabsAction : null;

        return (
          <div
            key={step.step}
            className="group flex flex-col justify-between rounded-2xl border border-border/50 bg-[rgba(255,252,246,0.9)] p-7 transition-colors duration-300 hover:border-[#7a8c6e]/25"
          >
            <div>
              <div className="mb-6 flex items-start justify-between">
                <span className="rounded-full bg-foreground/[0.04] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  Step {step.step}
                </span>
                <div className="flex size-14 items-center justify-center rounded-2xl bg-[#f0ede8] ring-1 ring-[#e5e0d8]/60 transition-transform duration-300 group-hover:scale-105">
                  <Icon className="size-6 text-[#7a8c6e]" />
                </div>
              </div>
              <h2 className="mb-2.5 font-serif text-[22px] font-semibold tracking-tight text-foreground">
                {step.title}
              </h2>
              <p className="mb-8 text-[13.5px] leading-relaxed text-muted-foreground">
                {step.description}
              </p>
            </div>

            <div>
              {customAction ?? (
                <Link
                  href={step.href}
                  className={getOnboardingStepActionClass(isPrimary)}
                >
                  {step.cta}
                  <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                </Link>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
