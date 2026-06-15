import type { ComponentType, ReactNode, SVGProps } from "react";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { AuthButton } from "@/src/components/ui/auth-button";
import {
  FlaskSparkleIcon,
  LabReportIcon,
  WatchHeartIcon,
} from "@/src/components/icons/home-icons";

const steps: {
  id: "devices" | "experiments" | "labs";
  title: string;
  description: string;
  cta: string;
  href: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}[] = [
  {
    id: "devices",
    title: "Connect devices",
    description: "Sync sleep, activity, and recovery from your wearable.",
    cta: "Connect",
    href: "/connect",
    icon: WatchHeartIcon,
  },
  {
    id: "labs",
    title: "Sync labs",
    description: "Upload blood work to track biomarkers over time.",
    cta: "Sync",
    href: "/settings",
    icon: LabReportIcon,
  },
  {
    id: "experiments",
    title: "Start an experiment",
    description: "Try protocols like sauna or creatine and see what works.",
    cta: "View experiments",
    href: "/experiments",
    icon: FlaskSparkleIcon,
  },
];

export interface OnboardingStepsProps {
  hideExperimentStep?: boolean;
  hideLabsStep?: boolean;
  showDeviceStep?: boolean;
  uploadLabsAction?: ReactNode;
}

export function getOnboardingStepActionClass(isPrimary: boolean): string {
  return isPrimary
    ? "inline-flex items-center gap-2.5 rounded-2xl bg-[#5a6e32] px-6 py-3 text-sm font-medium text-white transition-colors duration-200 hover:bg-[#7a8c6e] focus-visible:ring-2 focus-visible:ring-[#7a8c6e] focus-visible:ring-offset-2"
    : "inline-flex items-center gap-2.5 rounded-2xl border border-foreground/12 px-6 py-3 text-sm font-medium text-foreground transition-all duration-200 hover:border-[#7a8c6e]/30 hover:bg-[#7a8c6e]/[0.04] focus-visible:ring-2 focus-visible:ring-[#7a8c6e] focus-visible:ring-offset-2";
}

export function OnboardingSteps({
  showDeviceStep = true,
  hideExperimentStep = false,
  hideLabsStep = false,
  uploadLabsAction = null,
}: OnboardingStepsProps) {
  const visibleSteps = steps.filter((step) => {
    if (step.id === "devices" && !showDeviceStep) return false;
    if (step.id === "experiments" && hideExperimentStep) return false;
    if (step.id === "labs" && hideLabsStep) return false;
    return true;
  });
  if (visibleSteps.length === 0) {
    return null;
  }

  const gridColsClass =
    visibleSteps.length >= 3 ? "sm:grid-cols-2 xl:grid-cols-3" : "sm:grid-cols-2";

  return (
    <div className={`grid gap-5 ${gridColsClass}`}>
      {visibleSteps.map((step, i) => {
        const Icon = step.icon;
        const isPrimary = step.id === "devices";
        const customAction = step.id === "labs" ? uploadLabsAction : null;
        const defaultAction = step.id === "devices" ? (
          <AuthButton
            className={getOnboardingStepActionClass(isPrimary)}
            nativeButton={false}
            render={<Link href={step.href} />}
            size="unstyled"
            variant="unstyled"
          >
            {step.cta}
            <ArrowRight
              data-icon="inline-end"
              className="transition-transform duration-200 group-hover:translate-x-0.5"
            />
          </AuthButton>
        ) : (
          <Link
            href={step.href}
            className={getOnboardingStepActionClass(isPrimary)}
          >
            {step.cta}
            <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
          </Link>
        );

        return (
          <div
            key={step.id}
            className={`group flex flex-col justify-between rounded-2xl border p-7 transition-colors duration-300 ${isPrimary ? "border-primary/35 bg-primary/12 hover:border-primary/45" : "border-border/50 bg-[rgba(255,252,246,0.9)] hover:border-[#7a8c6e]/25"}`}
          >
            <div>
              <div className="mb-6 flex items-start justify-between">
                <span className="rounded-full bg-foreground/[0.04] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  Step {i + 1}
                </span>
                <div className="flex size-14 items-center justify-center rounded-2xl bg-[#f0ede8] ring-1 ring-[#e5e0d8]/60 transition-transform duration-300 group-hover:scale-105">
                  <Icon className="size-8 text-[#7a8c6e]" />
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
              {customAction ?? defaultAction}
            </div>
          </div>
        );
      })}
    </div>
  );
}
