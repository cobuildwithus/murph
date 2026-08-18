"use client";

import { useSearchParams } from "next/navigation";

import { SourceCard } from "@/app/(dashboard)/connect/connect-source-card";
import { ConnectDisconnectDialog } from "@/app/(dashboard)/connect/connect-page-dialogs";
import { DeviceSyncSetupGuideDialog } from "@/app/(dashboard)/home/device-sync-completion-dialog";
import { markLocallyDisconnectedSources } from "@/app/(dashboard)/connect/connect-page-helpers";
import {
  APPLE_HEALTH_RELAY_CONNECT_SOURCE_UI,
  listAppleHealthRelayConnectSources,
} from "@/app/(dashboard)/connect/apple-health-relay-connect-sources";
import { MOBVOI_HEALTH_CONNECT_SOURCE } from "@/app/(dashboard)/connect/health-connect-relay-connect-sources";
import type { ConnectSource } from "@/app/(dashboard)/connect/connect-page-types";
import { buildAppleHealthRelaySetupGuide } from "@/src/lib/device-sync/apple-health-relay-setup-guide";
import { buildZeppAppleHealthSetupGuide } from "@/src/lib/device-sync/zepp-apple-health-setup-guide";

type ConnectSourceCardStudyCase = {
  authenticated: boolean;
  errorMessage: string | null;
  source: ConnectSource;
};

const ZEPP_CONNECT_SOURCE: ConnectSource = {
  id: "zepp",
  ...APPLE_HEALTH_RELAY_CONNECT_SOURCE_UI.zepp,
};

const APPLE_HEALTH_CONNECT_SOURCE: ConnectSource = {
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
};

const FITBIT_CONNECT_SOURCE: ConnectSource = {
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
  name: "Fitbit",
};

const DEXCOM_UNAVAILABLE_SOURCE: ConnectSource = {
  connectionAvailable: false,
  description: "CGM glucose readings and trends.",
  id: "dexcom",
  logo: {
    className: "h-auto max-h-8 w-auto max-w-[8rem] object-contain",
    height: 36,
    src: "/brand-logos/connect/dexcom.png",
    width: 128,
  },
  name: "Dexcom",
  unavailableActionLabel: "Coming soon",
  unavailableMessage: "Dexcom connections are coming soon.",
};

const DESIGN_SIGNED_OUT_SOURCE_CASES: ConnectSourceCardStudyCase[] = [
  {
    authenticated: false,
    errorMessage: null,
    source: {
      ...ZEPP_CONNECT_SOURCE,
      id: "zepp-signed-out",
    },
  },
  {
    authenticated: false,
    errorMessage: null,
    source: {
      ...APPLE_HEALTH_CONNECT_SOURCE,
      id: "apple-health-signed-out",
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
    authenticated: false,
    errorMessage: null,
    source: DEXCOM_UNAVAILABLE_SOURCE,
  },
];

const DESIGN_CONNECT_SOURCE_CASES: ConnectSourceCardStudyCase[] = [
  {
    authenticated: true,
    errorMessage: null,
    source: {
      connectTarget: "cronometer",
      description:
        "Meal logs with calories, macros, timing, and supported nutrient fields. Daily targets and dashboard percentages stay in Cronometer.",
      id: "cronometer",
      logo: {
        className: "size-11 object-contain",
        height: 44,
        src: "/brand-logos/connect/cronometer.png",
        width: 44,
      },
      name: "Cronometer",
    },
  },
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
    source: APPLE_HEALTH_CONNECT_SOURCE,
  },
  {
    authenticated: true,
    errorMessage: null,
    source: FITBIT_CONNECT_SOURCE,
  },
  ...([
    ["fitbit-authorization", "authorization_required", null],
    ["fitbit-verifying", "verifying_successor", null],
    ["fitbit-switching", "cutover_ready", null],
    [
      "fitbit-retry",
      "cutover_ready",
      "Murph could not stop the legacy Fitbit connection. It is still syncing; retry when you are ready.",
    ],
  ] as const).map(([id, migrationState, errorMessage]) => ({
    authenticated: true,
    errorMessage,
    source: {
      ...FITBIT_CONNECT_SOURCE,
      disconnectConnectionId: "design-fitbit-migration",
      disconnectSourceProviderSlug: "fitbit",
      id,
      migrationState,
    },
  })),
  {
    authenticated: true,
    errorMessage: null,
    source: {
      ...DEXCOM_UNAVAILABLE_SOURCE,
      connected: true,
      disconnectConnectionId: "design-dexcom-recovery",
      disconnectScope: "junction_account",
      id: "dexcom-recovery",
      requiresReconnect: true,
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
      disconnectScope: "junction_account",
      id: "garmin-disconnect-journey",
      logo: {
        className: "h-auto max-h-8 w-auto max-w-[8rem] object-contain",
        height: 36,
        src: "/brand-logos/connect/garmin.png",
        width: 128,
      },
      name: "Garmin",
      recoveryKind: "connection_reset",
    },
  },
  {
    authenticated: true,
    errorMessage: null,
    source: {
      connectionAvailable: false,
      connected: true,
      description: "CGM glucose readings and trends.",
      disconnectConnectionId: "design-shared-junction",
      disconnectScope: "junction_account",
      id: "dexcom-shared-disconnect-journey",
      logo: {
        className: "h-auto max-h-8 w-auto max-w-[8rem] object-contain",
        height: 36,
        src: "/brand-logos/connect/dexcom.png",
        width: 128,
      },
      name: "Dexcom",
      unavailableActionLabel: "Coming soon",
      unavailableMessage: "Dexcom connections are coming soon.",
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
  new Set(["design-shared-junction"]),
  new Set(),
);

export function ConnectSourceCardStudy({
  androidAppAvailable,
}: {
  androidAppAvailable: boolean;
}) {
  const searchParams = useSearchParams();
  const studyState = searchParams?.get("connectDisconnectStudy") ?? null;
  const disconnectDialogSource = studyState === "source"
    ? DESIGN_CONNECT_SOURCE_CASES.find(({ source }) => source.id === "zepp")
      ?.source ?? null
    : studyState === "disconnect-retry"
      ? DESIGN_SOURCE_DISCONNECT_JOURNEY_CASES.find(({ source }) =>
          source.id === "garmin-disconnect-journey"
        )?.source ?? null
      : studyState === "dexcom-disconnect"
        ? DESIGN_CONNECT_SOURCE_CASES.find(({ source }) =>
            source.id === "dexcom-recovery"
          )?.source ?? null
        : studyState === "shared-dexcom-disconnect"
          ? DESIGN_SOURCE_DISCONNECT_JOURNEY_CASES.find(({ source }) =>
              source.id === "garmin-disconnect-journey"
            )?.source ?? null
          : null;
  const disconnectErrorMessage = studyState === "disconnect-retry"
    ? "Disconnect not finished. Remove the old connection in your wearable provider account, then retry Disconnect here."
    : null;
  const disconnectUnavailableSourceNames = disconnectDialogSource
    ? [
        ...DESIGN_CONNECT_SOURCE_CASES,
        ...DESIGN_SOURCE_DISCONNECT_JOURNEY_CASES,
      ]
        .filter(({ source }) =>
          source.disconnectConnectionId === disconnectDialogSource.disconnectConnectionId
          && source.connectionAvailable === false
        )
        .map(({ source }) => source.name)
    : [];
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
      : defaultStudyCases;
  const showSignedOutActions = studyState === null;

  return (
    <>
      <div
        className="rounded-3xl border border-border bg-background px-4 py-8 sm:px-8"
        data-design-study="connect-source-card-actions"
        id="connect-source-card-actions"
        inert
      >
        {showSignedOutActions ? (
          <div
            className="-mx-5 px-5"
            data-design-state="signed-out-source-actions"
          >
            <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground">
              Signed out
            </p>
            <SourceCardStudyGrid studyCases={DESIGN_SIGNED_OUT_SOURCE_CASES} />
          </div>
        ) : null}
        <div className={showSignedOutActions ? "mt-8" : undefined}>
          <SourceCardStudyGrid studyCases={studyCases} />
        </div>
      </div>

      <ConnectDisconnectDialog
        affectedUnavailableSourceNames={disconnectUnavailableSourceNames}
        errorMessage={disconnectErrorMessage}
        inert
        pending={false}
        source={disconnectDialogSource}
        onConfirm={() => Promise.resolve()}
        onOpenChange={() => {}}
      />
    </>
  );
}

function SourceCardStudyGrid({
  studyCases,
}: {
  studyCases: ConnectSourceCardStudyCase[];
}) {
  return (
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
          onMigrationRetry={() => {}}
          onSetupGuideOpen={() => {}}
          onStartConnection={() => Promise.resolve()}
        />
      ))}
    </div>
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
