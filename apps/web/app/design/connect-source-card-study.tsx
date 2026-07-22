"use client";

import { SourceCard } from "@/app/(dashboard)/connect/connect-source-card";
import type { ConnectSource } from "@/app/(dashboard)/connect/connect-page-types";

const DESIGN_CONNECT_SOURCES: ConnectSource[] = [
  {
    description: "Workouts, sleep, stress, heart rate, and body battery.",
    connected: true,
    disconnectConnectionId: "design-garmin-connection",
    id: "garmin",
    logo: {
      className: "h-auto max-h-8 w-auto max-w-[8rem] object-contain",
      height: 36,
      src: "/brand-logos/connect/garmin.png",
      width: 128,
    },
    name: "Garmin",
  },
  {
    description: "iPhone and Apple Watch activity, sleep, vitals, and workouts.",
    id: "apple-health",
    logo: {
      className: "h-auto max-h-8 w-auto max-w-[8rem] object-contain",
      height: 36,
      src: "/brand-logos/connect/apple-health.png",
      width: 128,
    },
    name: "Apple Health",
    unavailableActionLabel: "Download app",
    unavailableActionUrl: "https://apps.apple.com/us/app/murph-ai/id6786145859",
  },
  {
    connectTarget: "fitbit",
    description: "Sleep, activity, heart rate, and daily readiness.",
    id: "fitbit",
    logo: {
      className: "h-auto max-h-8 w-auto max-w-[8rem] object-contain",
      height: 36,
      src: "/brand-logos/connect/fitbit.svg",
      width: 128,
    },
    name: "Fitbit",
  },
];

export function ConnectSourceCardStudy() {
  return (
    <div
      className="rounded-3xl border border-border bg-background px-4 py-8 sm:px-8"
      data-design-study="connect-source-card-actions"
      id="connect-source-card-actions"
    >
      <div className="grid items-stretch gap-4 lg:grid-cols-3">
        {DESIGN_CONNECT_SOURCES.map((source) => (
          <SourceCard
            key={source.id}
            authenticated
            errorMessage={null}
            pending={false}
            pendingDisconnect={false}
            source={source}
            onDisconnectTargetChange={() => {}}
            onStartConnection={() => Promise.resolve()}
          />
        ))}
      </div>
    </div>
  );
}
