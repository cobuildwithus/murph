"use client";

import type { ReactNode } from "react";
import { startTransition, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { RouteTabs } from "@/src/components/ui/route-tabs";
import { ExperimentHero } from "@/src/components/experiments/experiment-detail/experiment-hero";
import { ExperimentHeader } from "@/src/components/experiments/experiment-detail/experiment-header";
import { hasCurrentExperimentProtocolContract } from "@/src/lib/experiments/experiment-detail";
import type { ExperimentShellProjection } from "@/src/lib/health-commons/experiment-projections";

type ExperimentDetailTab = "protocol" | "research" | "results";

export function ExperimentLayoutClient({
  children,
  headerStartAction = null,
  shell,
}: {
  children?: ReactNode;
  headerStartAction?: ReactNode;
  shell: ExperimentShellProjection;
}) {
  return (
    <ExperimentLayoutInner
      headerStartAction={headerStartAction}
      shell={shell}
    >
      {children}
    </ExperimentLayoutInner>
  );
}

function ExperimentLayoutInner({
  children,
  headerStartAction,
  shell,
}: {
  children?: ReactNode;
  headerStartAction: ReactNode;
  shell: ExperimentShellProjection;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const hasCurrentProtocolContract = hasCurrentExperimentProtocolContract(shell);

  useEffect(() => {
    if (!hasCurrentProtocolContract) {
      startTransition(() => {
        router.refresh();
      });
    }
  }, [hasCurrentProtocolContract, router]);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [isTabsSticky, setIsTabsSticky] = useState(false);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsTabsSticky(!entry.isIntersecting),
      { rootMargin: "0px 0px 0px 0px", threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  if (!hasCurrentProtocolContract) {
    return (
      <div className="flex min-h-40 items-center justify-center rounded-xl border border-secondary/25 bg-card/90 px-6 py-8 text-sm text-muted-foreground">
        Refreshing experiment…
      </div>
    );
  }

  const experiment = {
    ...shell,
    status: "upcoming" as const,
  };
  const basePath = `/experiments/${shell.id}`;
  const currentTab: ExperimentDetailTab = pathname.endsWith("/research")
    ? "research"
    : pathname.endsWith("/results")
      ? "results"
      : "protocol";
  const showHeaderStartAction = currentTab !== "results";

  return (
    <div className="flex flex-col gap-8">
      <div className="-mt-4 md:-mt-6">
        <ExperimentHero image={experiment.image} />
      </div>

      <ExperimentHeader
        title={experiment.title}
        category={experiment.category}
        durationDays={experiment.durationDays}
        evidenceLevel={experiment.evidenceLevel}
        matchPercent={undefined}
        status={experiment.status}
        day={undefined}
        dateRange={undefined}
        baselineDays={experiment.baselineDays}
        completionPercent={undefined}
        description={experiment.description}
        showStartAction={showHeaderStartAction}
        startAction={headerStartAction}
      />

      <div className="w-full">
        <div ref={sentinelRef} aria-hidden="true" className="h-px" />
        <div className="sticky top-0 z-20 -mx-4 bg-background/95 px-4 backdrop-blur-md md:-mx-14 md:px-14">
          <div className="flex items-center gap-4 border-b border-border">
            <RouteTabs
              ariaLabel="Experiment tabs"
              currentValue={currentTab}
              tabs={[
                { value: "protocol", label: "Protocol", href: basePath },
                { value: "research", label: "Research", href: `${basePath}/research` },
                { value: "results", label: "Your results", href: `${basePath}/results` },
              ]}
            />
            <span
              aria-hidden={!isTabsSticky}
              className="ml-auto hidden min-w-0 truncate font-serif text-sm/5 font-semibold text-foreground transition-opacity duration-150 md:block md:text-base/6"
              style={{
                opacity: isTabsSticky ? 1 : 0,
                pointerEvents: isTabsSticky ? "auto" : "none",
              }}
            >
              {experiment.title}
            </span>
          </div>
        </div>
        <div className="pt-6">{children}</div>
      </div>
    </div>
  );
}
