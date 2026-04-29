"use client";

import type { ReactNode } from "react";
import { startTransition, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";

import { Tabs, TabsList, TabsTrigger } from "@/src/components/ui/tabs";
import { ExperimentHero } from "@/src/components/experiments/experiment-detail/experiment-hero";
import { ExperimentHeader } from "@/src/components/experiments/experiment-detail/experiment-header";
import { ExperimentStartContactProvider } from "@/src/components/experiments/experiment-detail/start-experiment-contact-context";
import { hasCurrentExperimentProtocolContract } from "@/src/lib/experiments/experiment-detail";
import {
  DEFAULT_EXPERIMENT_START_CONTACT_CHANNELS,
  type ExperimentStartContactChannels,
} from "@/src/lib/experiments/start-experiment-contact";
import type { ExperimentShellProjection } from "@/src/lib/health-commons/experiment-projections";

type ExperimentDetailTab = "protocol" | "research" | "results";

export function ExperimentLayoutClient({
  children,
  initialContactChannels = DEFAULT_EXPERIMENT_START_CONTACT_CHANNELS,
  murphPhoneNumber = null,
  shell,
}: {
  children?: ReactNode;
  initialContactChannels?: ExperimentStartContactChannels;
  murphPhoneNumber?: string | null;
  shell: ExperimentShellProjection;
}) {
  return (
    <ExperimentStartContactProvider
      initialContactChannels={initialContactChannels}
      murphPhoneNumber={murphPhoneNumber}
    >
      <ExperimentLayoutInner
        initialContactChannels={initialContactChannels}
        murphPhoneNumber={murphPhoneNumber}
        shell={shell}
      >
        {children}
      </ExperimentLayoutInner>
    </ExperimentStartContactProvider>
  );
}

function ExperimentLayoutInner({
  children,
  initialContactChannels,
  murphPhoneNumber,
  shell,
}: {
  children?: ReactNode;
  initialContactChannels: ExperimentStartContactChannels;
  murphPhoneNumber: string | null;
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
  const currentTab: ExperimentDetailTab = pathname === `${basePath}/research`
    ? "research"
    : pathname === `${basePath}/results`
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
        evidenceLabel={experiment.evidenceLabel}
        matchPercent={undefined}
        status={experiment.status}
        day={undefined}
        dateRange={undefined}
        baselineDays={experiment.baselineDays}
        completionPercent={undefined}
        description={experiment.description}
        initialContactChannels={initialContactChannels}
        murphPhoneNumber={murphPhoneNumber}
        showStartAction={showHeaderStartAction}
      />

      <Tabs value={currentTab} className="w-full">
        <div ref={sentinelRef} aria-hidden="true" className="h-px" />
        <div className="sticky top-0 z-20 -mx-6 flex items-center gap-4 bg-background/95 px-6 py-2 backdrop-blur-md md:-mx-14 md:px-14">
          <TabsList>
            <TabsTrigger
              value="protocol"
              className="px-3 sm:px-5"
              nativeButton={false}
              render={<Link href={basePath} />}
            >
              Protocol
            </TabsTrigger>
            <TabsTrigger
              value="research"
              className="px-3 sm:px-5"
              nativeButton={false}
              render={<Link href={`${basePath}/research`} />}
            >
              Research
            </TabsTrigger>
            <TabsTrigger
              value="results"
              className="px-3 sm:px-5"
              nativeButton={false}
              render={<Link href={`${basePath}/results`} />}
            >
              Your Results
            </TabsTrigger>
          </TabsList>
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
        <div className="pt-4">{children}</div>
      </Tabs>
    </div>
  );
}
