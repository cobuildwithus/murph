"use client";

import { DashboardCriticalLoadError } from "@/src/components/dashboard/dashboard-critical-load-error";
import { BrowserVaultUnavailableAlert } from "@/src/components/home/browser-vault-unavailable-alert";
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
          description="Connect your health data, pick an experiment, and see what actually works for you."
          eyebrow="Live Well"
          title="Welcome to Murph"
        />
        <HomeDataLoadAlert />
        <div className="grid gap-4 sm:grid-cols-2">
          {["Sync labs", "Start an experiment"].map((label) => (
            <div
              className="rounded-xl border border-border bg-card p-5"
              key={label}
            >
              <p className="font-serif text-lg font-semibold text-foreground">
                {label}
              </p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                This home action remains available while missing details reload.
              </p>
            </div>
          ))}
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
        <BrowserVaultUnavailableAlert
          message="Your dashboard data is not available right now."
          onRetry={() => {}}
        />
      </div>
    </div>
  );
}
