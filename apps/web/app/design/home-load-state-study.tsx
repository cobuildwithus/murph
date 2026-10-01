"use client";

import { DashboardCriticalLoadError } from "@/src/components/dashboard/dashboard-critical-load-error";
import { BrowserVaultUnavailableAlert } from "@/src/components/home/browser-vault-unavailable-alert";
import { OnboardingSteps } from "@/src/components/home/onboarding-steps";
import { HomeDataLoadAlert } from "@/src/components/home/home-data-load-alert";
import { PageHeader } from "@/src/components/ui/page-header";

export function HomeLoadStateStudy() {
  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <div
        className="flex flex-col gap-8 rounded-2xl border border-border bg-background p-5 sm:p-8"
        data-design-section="home-partial-load"
        id="home-partial-load-section"
      >
        <PageHeader
          description="Your health, with a little help from Murph."
          eyebrow="Live Well"
          title="Welcome to Murph"
        />
        <HomeDataLoadAlert />
        <div inert>
          <OnboardingSteps showDeviceStep={false} showEmptyState={false} />
        </div>
      </div>
      <div
        className="rounded-2xl border border-border bg-background p-5 sm:p-8"
        data-design-section="home-critical-load"
        id="home-critical-load-section"
      >
        <DashboardCriticalLoadError />
      </div>
      {/*
        Only a signed-in member whose vault load failed sees this. A signed-out
        visitor gets the onboarding steps above instead, because the dashboard
        layout never starts a vault load without a member to load.
      */}
      <div
        className="rounded-2xl border border-border bg-background p-5 sm:p-8"
        data-design-section="home-browser-vault-unavailable"
        id="home-browser-vault-unavailable-section"
        inert
      >
        <BrowserVaultUnavailableAlert message="Your dashboard data is not available right now." />
      </div>
    </div>
  );
}
