"use client";

import { useSearchParams } from "next/navigation";

import { SourceCard } from "@/app/(dashboard)/connect/connect-source-card";
import { ConnectDisconnectDialog } from "@/app/(dashboard)/connect/connect-page-dialogs";
import { markLocallyDisconnectedSources } from "@/app/(dashboard)/connect/connect-page-helpers";
import type { ConnectSource } from "@/app/(dashboard)/connect/connect-page-types";

type ConnectSourceCardStudyCase = {
  authenticated: boolean;
  errorMessage: string | null;
  source: ConnectSource;
};

const DESIGN_CONNECT_SOURCE_CASES: ConnectSourceCardStudyCase[] = [
  {
    authenticated: true,
    errorMessage: null,
    source: {
      description: "Workouts, sleep, stress, heart rate, and body battery.",
      connected: true,
      disconnectConnectionId: "design-garmin-connection",
      disconnectSourceProviderSlug: "garmin",
      id: "garmin",
      logo: {
        className: "h-auto max-h-8 w-auto max-w-[8rem] object-contain",
        height: 36,
        src: "/brand-logos/connect/garmin.png",
        width: 128,
      },
      name: "Garmin",
    },
  },
  {
    authenticated: true,
    errorMessage: null,
    source: {
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
  },
  {
    authenticated: true,
    errorMessage: null,
    source: {
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
  },
  {
    authenticated: false,
    errorMessage: null,
    source: {
      connectTarget: "oura",
      description: "Sleep, readiness, activity, heart rate, and temperature trends.",
      id: "oura-signed-out",
      logo: {
        className: "h-auto max-h-8 w-auto max-w-[8rem] object-contain",
        height: 36,
        src: "/brand-logos/connect/oura.png",
        width: 128,
      },
      name: "Oura",
    },
  },
  {
    authenticated: true,
    errorMessage: null,
    source: {
      connectTarget: "whoop",
      description: "Recovery, strain, sleep, heart rate, and daily readiness.",
      disconnectConnectionId: "design-whoop-recovery",
      disconnectScope: "junction_account",
      id: "whoop-recovery",
      logo: {
        className: "h-auto max-h-8 w-auto max-w-[8rem] object-contain",
        height: 36,
        src: "/brand-logos/connect/whoop.svg",
        width: 128,
      },
      name: "Whoop",
      recoveryKind: "connection_reset",
    },
  },
  {
    authenticated: true,
    errorMessage: "Peloton could not open. Please try again.",
    source: {
      connectTarget: "peloton",
      description: "Rides, runs, strength, and workout output.",
      id: "peloton-error",
      logo: {
        className: "h-auto max-h-8 w-auto max-w-[8rem] object-contain",
        height: 36,
        src: "/brand-logos/connect/peloton.svg",
        width: 128,
      },
      name: "Peloton",
    },
  },
];

const DESIGN_SOURCE_DISCONNECT_JOURNEY_CASES: ConnectSourceCardStudyCase[] = [
  {
    authenticated: true,
    errorMessage: null,
    source: {
      connected: true,
      connectTarget: "garmin",
      description: "Workouts, sleep, stress, heart rate, and body battery.",
      disconnectConnectionId: "design-shared-junction",
      disconnectSourceProviderSlug: "garmin",
      id: "garmin-disconnect-journey",
      logo: {
        className: "h-auto max-h-8 w-auto max-w-[8rem] object-contain",
        height: 36,
        src: "/brand-logos/connect/garmin.png",
        width: 128,
      },
      name: "Garmin",
      requiresReconnect: true,
    },
  },
  {
    authenticated: true,
    errorMessage: null,
    source: {
      connected: true,
      description: "Sleep, readiness, activity, heart rate, and temperature trends.",
      disconnectConnectionId: "design-shared-junction",
      disconnectSourceProviderSlug: "oura",
      id: "oura-disconnect-journey",
      logo: {
        className: "h-auto max-h-8 w-auto max-w-[8rem] object-contain",
        height: 36,
        src: "/brand-logos/connect/oura.png",
        width: 128,
      },
      name: "Oura",
    },
  },
  {
    authenticated: true,
    errorMessage: null,
    source: {
      connected: true,
      description: "Recovery, strain, sleep, heart rate, and daily readiness.",
      disconnectConnectionId: "design-shared-junction",
      disconnectSourceProviderSlug: "whoop_v2",
      id: "whoop-disconnect-journey",
      logo: {
        className: "h-auto max-h-8 w-auto max-w-[8rem] object-contain",
        height: 36,
        src: "/brand-logos/connect/whoop.svg",
        width: 128,
      },
      name: "Whoop",
    },
  },
];

const DESIGN_SOURCE_DISCONNECT_SUCCESS_SOURCES = markLocallyDisconnectedSources(
  DESIGN_SOURCE_DISCONNECT_JOURNEY_CASES.map(({ source }) => source),
  new Set(),
  new Set(["garmin-disconnect-journey"]),
);

export function ConnectSourceCardStudy() {
  const searchParams = useSearchParams();
  const studyState = searchParams?.get("connectDisconnectStudy") ?? null;
  const disconnectDialogSource = studyState === "source"
    ? DESIGN_CONNECT_SOURCE_CASES[0]?.source ?? null
    : null;
  const studyCases = studyState === "source-reconnect"
    ? DESIGN_SOURCE_DISCONNECT_JOURNEY_CASES
    : studyState === "source-success"
      ? DESIGN_SOURCE_DISCONNECT_JOURNEY_CASES.map((studyCase, index) => ({
          ...studyCase,
          source: DESIGN_SOURCE_DISCONNECT_SUCCESS_SOURCES[index] ?? studyCase.source,
        }))
      : DESIGN_CONNECT_SOURCE_CASES;

  return (
    <>
      <div
        className="rounded-3xl border border-border bg-background px-4 py-8 sm:px-8"
        data-design-study="connect-source-card-actions"
        id="connect-source-card-actions"
        inert
      >
        <div className="grid items-stretch gap-4 lg:grid-cols-3">
          {studyCases.map(({ authenticated, errorMessage, source }) => (
            <SourceCard
              key={source.id}
              authenticated={authenticated}
              errorMessage={errorMessage}
              pending={false}
              pendingDisconnect={false}
              source={source}
              onDisconnectTargetChange={() => {}}
              onStartConnection={() => Promise.resolve()}
            />
          ))}
        </div>
      </div>

      <ConnectDisconnectDialog
        errorMessage={null}
        inert
        pending={false}
        source={disconnectDialogSource}
        onConfirm={() => Promise.resolve()}
        onOpenChange={() => {}}
      />
    </>
  );
}
