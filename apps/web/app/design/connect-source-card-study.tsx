"use client";

import { useSearchParams } from "next/navigation";

import { SourceCard } from "@/app/(dashboard)/connect/connect-source-card";
import { ConnectSourcesGrid } from "@/app/(dashboard)/connect/connect-page-client";
import { ConnectDisconnectDialog } from "@/app/(dashboard)/connect/connect-page-dialogs";
import { DeviceSyncSetupGuideDialog } from "@/app/(dashboard)/home/device-sync-completion-dialog";
import {
  FITBIT_MIGRATION_STILL_VERIFYING_NOTICE,
  markLocallyCompletedFitbitMigrations,
  markLocallyDisconnectedSources,
} from "@/app/(dashboard)/connect/connect-page-helpers";
import {
  APPLE_HEALTH_RELAY_CONNECT_SOURCE_UI,
  listAppleHealthRelayConnectSources,
} from "@/app/(dashboard)/connect/apple-health-relay-connect-sources";
import { MOBVOI_HEALTH_CONNECT_SOURCE } from "@/app/(dashboard)/connect/health-connect-relay-connect-sources";
import type {
  ConnectCallbackInput,
  ConnectSource,
} from "@/app/(dashboard)/connect/connect-page-types";
import { buildAppleHealthRelaySetupGuide } from "@/src/lib/device-sync/apple-health-relay-setup-guide";
import { buildZeppAppleHealthSetupGuide } from "@/src/lib/device-sync/zepp-apple-health-setup-guide";
import { PageHeader } from "@/src/components/ui/page-header";

type ConnectSourceCardStudyCase = {
  authenticated: boolean;
  errorMessage: string | null;
  source: ConnectSource;
};

const ZEPP_CONNECT_SOURCE: ConnectSource = {
  id: "zepp",
  ...APPLE_HEALTH_RELAY_CONNECT_SOURCE_UI.zepp,
};

const FITBIT_MIGRATION_SOURCE: ConnectSource = {
  description:
    "Fitbit and Pixel Watch sleep, activity, heart rate, exercise, and workout trends through Google authorization.",
  disconnectConnectionId: "design-fitbit-migration",
  disconnectSourceProviderSlug: "fitbit",
  id: "fitbit-migration-cutover",
  logo: {
    className: "h-auto max-h-8 w-auto max-w-[8rem] object-contain",
    height: 36,
    src: "/brand-logos/connect/fitbit.svg",
    width: 128,
  },
  migrationState: "cutover_ready",
  name: "Fitbit",
};

const FITBIT_COMPLETED_MIGRATION_SOURCE =
  markLocallyCompletedFitbitMigrations(
    [{ ...FITBIT_MIGRATION_SOURCE, id: "fitbit" }],
    new Set(["fitbit"]),
  )[0] ?? {
    ...FITBIT_MIGRATION_SOURCE,
    connected: true,
    disconnectSourceProviderSlug: "google_health",
    id: "fitbit",
  };

const FITBIT_MIGRATION_CALLBACK_SOURCE: ConnectSource = {
  connectProvider: "junction",
  connectTarget: "fitbit",
  description:
    "Fitbit and Pixel Watch sleep, activity, heart rate, exercise, and workout trends through Google authorization.",
  id: "fitbit",
  logo: {
    className: "h-auto max-h-8 w-auto max-w-[8rem] object-contain",
    height: 36,
    src: "/brand-logos/connect/fitbit.svg",
    width: 128,
  },
  migrationState: "authorization_required",
  name: "Fitbit",
  requiresJunctionDisclosure: true,
};

const FITBIT_MIGRATION_CALLBACK_INPUT: NonNullable<ConnectCallbackInput> = {
  connectSource: "fitbit",
  connectTarget: "fitbit",
  errorCode: null,
  provider: "junction",
  status: "connected",
};

const DESIGN_CONNECT_SOURCE_CASES: ConnectSourceCardStudyCase[] = [
  {
    authenticated: true,
    errorMessage: null,
    source: ZEPP_CONNECT_SOURCE,
  },
  {
    authenticated: true,
    errorMessage: null,
    source: MOBVOI_HEALTH_CONNECT_SOURCE,
  },
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
      description: "Fitbit and Pixel Watch sleep, activity, heart rate, exercise, and workout trends through Google authorization.",
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
    authenticated: true,
    errorMessage: null,
    source: {
      connectProvider: "junction",
      connectTarget: "fitbit",
      description:
        "Fitbit and Pixel Watch sleep, activity, heart rate, exercise, and workout trends through Google authorization.",
      disconnectConnectionId: "design-fitbit-migration",
      id: "fitbit-migration-authorization",
      logo: {
        className: "h-auto max-h-8 w-auto max-w-[8rem] object-contain",
        height: 36,
        src: "/brand-logos/connect/fitbit.svg",
        width: 128,
      },
      migrationState: "authorization_required",
      name: "Fitbit",
      requiresJunctionDisclosure: true,
    },
  },
  {
    authenticated: true,
    errorMessage: null,
    source: {
      description:
        "Fitbit and Pixel Watch sleep, activity, heart rate, exercise, and workout trends through Google authorization.",
      disconnectConnectionId: "design-fitbit-migration",
      id: "fitbit-migration-verifying",
      logo: {
        className: "h-auto max-h-8 w-auto max-w-[8rem] object-contain",
        height: 36,
        src: "/brand-logos/connect/fitbit.svg",
        width: 128,
      },
      migrationState: "verifying_successor",
      name: "Fitbit",
    },
  },
  {
    authenticated: true,
    errorMessage: null,
    source: FITBIT_MIGRATION_SOURCE,
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

export function ConnectSourceCardStudy({
  androidAppAvailable,
}: {
  androidAppAvailable: boolean;
}) {
  const searchParams = useSearchParams();
  const studyState = searchParams?.get("connectDisconnectStudy") ?? null;
  const connectPageStudy = searchParams?.get("connectPageStudy") ?? null;
  const disconnectDialogSource = studyState === "source"
    ? DESIGN_CONNECT_SOURCE_CASES[0]?.source ?? null
    : studyState === "fitbit-migration-dialog" ||
        studyState === "fitbit-migration-pending" ||
        studyState === "fitbit-migration-error"
      ? FITBIT_MIGRATION_SOURCE
      : null;

  if (
    connectPageStudy === "fitbit-migration-callback" ||
    connectPageStudy === "fitbit-migration-callback-success" ||
    connectPageStudy === "fitbit-migration-callback-timeout"
  ) {
    return (
      <div
        className="flex w-full min-w-0 flex-col gap-8"
        data-design-study="fitbit-migration-callback-page"
        id="fitbit-migration-callback-page"
        inert
      >
        <PageHeader
          eyebrow="Live Well"
          title="Sync your biomarkers"
          description="Bring in sleep, activity, recovery, glucose, and device context from the tools you already use."
        />
        <ConnectSourcesGrid
          authenticated
          initialCallback={FITBIT_MIGRATION_CALLBACK_INPUT}
          initialNoticeOverride={
            connectPageStudy === "fitbit-migration-callback-timeout"
              ? FITBIT_MIGRATION_STILL_VERIFYING_NOTICE
              : null
          }
          sources={[FITBIT_MIGRATION_CALLBACK_SOURCE]}
        />
      </div>
    );
  }

  const defaultStudyCases = androidAppAvailable
    ? DESIGN_CONNECT_SOURCE_CASES
    : DESIGN_CONNECT_SOURCE_CASES.filter(
        ({ source }) => source.id !== MOBVOI_HEALTH_CONNECT_SOURCE.id,
      );
  const studyCases = studyState === "source-reconnect"
    ? DESIGN_SOURCE_DISCONNECT_JOURNEY_CASES
    : studyState === "source-success"
      ? DESIGN_SOURCE_DISCONNECT_JOURNEY_CASES.map((studyCase, index) => ({
          ...studyCase,
          source: DESIGN_SOURCE_DISCONNECT_SUCCESS_SOURCES[index] ?? studyCase.source,
        }))
      : studyState === "fitbit-migration-completed"
        ? [{
            authenticated: true,
            errorMessage: null,
            source: FITBIT_COMPLETED_MIGRATION_SOURCE,
          }]
      : defaultStudyCases;

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
              onSetupGuideOpen={() => {}}
              onStartConnection={() => Promise.resolve()}
            />
          ))}
        </div>
      </div>

      <ConnectDisconnectDialog
        errorMessage={studyState === "fitbit-migration-error"
          ? "The legacy Fitbit connection could not be stopped."
          : null}
        inert
        pending={studyState === "fitbit-migration-pending"}
        source={disconnectDialogSource}
        onConfirm={() => Promise.resolve()}
        onOpenChange={() => {}}
      />
    </>
  );
}

export function ZeppAppleHealthSetupStudy() {
  const searchParams = useSearchParams();
  const open = searchParams?.get("zeppSetupStudy") === "open";

  return (
    <>
      <div
        className="max-w-md rounded-3xl border border-border bg-background p-4 sm:p-8"
        data-design-study="zepp-apple-health-setup"
        id="zepp-apple-health-setup"
        inert
      >
        <SourceCard
          authenticated
          errorMessage={null}
          pending={false}
          pendingDisconnect={false}
          source={ZEPP_CONNECT_SOURCE}
          onDisconnectTargetChange={() => {}}
          onSetupGuideOpen={() => {}}
          onStartConnection={() => Promise.resolve()}
        />
      </div>

      <DeviceSyncSetupGuideDialog
        contactAction={{
          href: "sms:+15555550100?body=Help%20me%20set%20up%20Zepp",
          kind: "imessage",
          label: "Text Murph",
        }}
        guide={buildZeppAppleHealthSetupGuide()}
        inert
        open={open}
        onOpenChange={() => {}}
      />
    </>
  );
}

const APPLE_HEALTH_RELAY_STUDY_SOURCES = listAppleHealthRelayConnectSources();

export function AppleHealthRelaySetupStudy() {
  const searchParams = useSearchParams();
  const open = searchParams?.get("appleHealthRelaySetupStudy") === "open";

  return (
    <>
      <div
        className="rounded-3xl border border-border bg-background px-4 py-8 sm:px-8"
        data-design-study="apple-health-relay-setup"
        id="apple-health-relay-setup"
        inert
      >
        <div className="grid items-stretch gap-4 lg:grid-cols-3">
          {APPLE_HEALTH_RELAY_STUDY_SOURCES.map((source) => (
            <SourceCard
              key={source.id}
              authenticated
              errorMessage={null}
              pending={false}
              pendingDisconnect={false}
              source={source}
              onDisconnectTargetChange={() => {}}
              onSetupGuideOpen={() => {}}
              onStartConnection={() => Promise.resolve()}
            />
          ))}
        </div>
      </div>

      <DeviceSyncSetupGuideDialog
        contactAction={{
          href: "sms:+15555550100?body=Help%20me%20set%20up%20Xiaomi",
          kind: "imessage",
          label: "Text Murph",
        }}
        guide={buildAppleHealthRelaySetupGuide("xiaomi-mi-fitness-apple-health")}
        inert
        open={open}
        onOpenChange={() => {}}
      />
    </>
  );
}
