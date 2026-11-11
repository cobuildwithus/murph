"use client";

import { DashboardCriticalLoadError } from "@/src/components/dashboard/dashboard-critical-load-error";
import { HomeDataLoadAlert } from "@/src/components/home/home-data-load-alert";
import { OnboardingSteps } from "@/src/components/home/onboarding-steps";
import { PageHeader } from "@/src/components/ui/page-header";

export function HomeLoadStateStudy() {
  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <div
        className="flex flex-col gap-8 rounded-2xl border border-border bg-background p-5 sm:p-8"
        data-design-section="home-partial-load"
        id="home-partial-load-section"
      >
        <PageHeader description="Your health, with a little help from Murph." eyebrow="Live Well" title="Welcome to Murph" />
        <HomeDataLoadAlert />
        <div inert>
          <OnboardingSteps hideLabsStep showEmptyState={false} />
        </div>
      </div>
      <div
        className="rounded-2xl border border-border bg-background p-5 sm:p-8"
        data-design-section="home-critical-load"
        id="home-critical-load-section"
      >
        <DashboardCriticalLoadError />
      </div>
    </div>
  );
}
