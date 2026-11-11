"use client";

import {
  ConnectIntentRecoveryScreen,
  ConnectLinkFailedScreen,
  ConnectLinkReadyScreen,
  ConnectLinkSettledScreen,
  ConnectLinkSignInScreen,
  ConnectRedirectScreen,
} from "@/app/(dashboard)/connect/connect-page-dialogs";
import { DeviceSyncCompletionScreen } from "@/src/components/device-sync/device-sync-completion-dialog";
import { AuthProvider } from "@/src/components/hosted-onboarding/auth-dialog-provider";
import {
  FITBIT_GOOGLE_HEALTH_LINK_FAILED_DETAIL,
  type DeviceSyncCompletionDialogModel,
} from "@/src/lib/device-sync/connect-completion-types";
import { buildWhoopAppleHealthSetupGuide } from "@/src/lib/device-sync/whoop-apple-health-setup-guide";

import { LinkPageStudyState } from "./link-page-study-state";

const OURA = {
  id: "oura",
  logo: {
    className: "h-auto max-h-8 w-auto max-w-[8rem] object-contain",
    height: 30,
    src: "/brand-logos/connect/oura.png",
    width: 96,
  },
  name: "Oura",
};

const STUDY_CONTACT = {
  href: "sms:+15550100000",
  kind: "text",
  label: "Messages",
} as const;

const CONNECTED_MODEL: DeviceSyncCompletionDialogModel = {
  contactAction: {
    href: "sms:+15550100000",
    kind: "imessage",
    label: "Open Messages",
  },
  detail: "Go back to your chat.",
  failed: false,
  kind: "device-sync",
  logo: { name: "Oura", src: OURA.logo.src },
  retryHref: null,
  title: "Oura is connected.",
  unverified: false,
};

const FAILED_MODEL: DeviceSyncCompletionDialogModel = {
  contactAction: null,
  detail: "Nothing changed. Try again.",
  failed: true,
  kind: "device-sync",
  logo: { name: "Oura", src: OURA.logo.src },
  retryHref: "/connect",
  title: "Oura didn’t connect.",
  unverified: false,
};

export function WearableConnectLinkStudy() {
  return (
    <div
      className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3"
      data-design-section="wearable-connect-link"
      id="wearable-connect-link"
    >
      <LinkPageStudyState label="Signed out">
        <AuthProvider authenticated={false}>
          <ConnectLinkSignInScreen source={OURA} />
        </AuthProvider>
      </LinkPageStudyState>
      <LinkPageStudyState label="Ready">
        <ConnectLinkReadyScreen source={OURA} />
      </LinkPageStudyState>
      <LinkPageStudyState label="Ready, Garmin">
        <ConnectLinkReadyScreen
          source={{
            ...OURA,
            id: "garmin",
            logo: { ...OURA.logo, src: "/brand-logos/connect/garmin.png" },
            name: "Garmin",
          }}
        />
      </LinkPageStudyState>
      <LinkPageStudyState label="Connecting">
        <ConnectRedirectScreen sourceName="Oura" />
      </LinkPageStudyState>
      <LinkPageStudyState label="Couldn’t start">
        <ConnectLinkFailedScreen contactAction={STUDY_CONTACT} source={OURA} />
      </LinkPageStudyState>
      <LinkPageStudyState label="Link no longer available">
        <ConnectIntentRecoveryScreen
          contactAction={STUDY_CONTACT}
          request={{
            message: "This connection link has expired. Ask Murph for a new one.",
            sourceName: "Oura",
          }}
        />
      </LinkPageStudyState>
      <LinkPageStudyState label="Already connected">
        <ConnectLinkSettledScreen contactAction={STUDY_CONTACT} source={OURA} />
      </LinkPageStudyState>
      <LinkPageStudyState label="Connected">
        <DeviceSyncCompletionScreen model={CONNECTED_MODEL} />
      </LinkPageStudyState>
      <LinkPageStudyState label="Connected, WHOOP">
        <DeviceSyncCompletionScreen
          model={{
            ...CONNECTED_MODEL,
            detail:
              "Heads up: WHOOP doesn't share all of your data automatically. Syncing through Apple Health gives Murph the complete picture.",
            logo: { name: "WHOOP", src: "/brand-logos/connect/whoop.svg" },
            setupGuide: buildWhoopAppleHealthSetupGuide(null),
            title: "WHOOP is connected.",
          }}
        />
      </LinkPageStudyState>
      <LinkPageStudyState label="Didn’t connect">
        <DeviceSyncCompletionScreen model={FAILED_MODEL} />
      </LinkPageStudyState>
      <LinkPageStudyState label="Didn’t connect, Fitbit">
        <DeviceSyncCompletionScreen
          model={{
            ...FAILED_MODEL,
            detail: FITBIT_GOOGLE_HEALTH_LINK_FAILED_DETAIL,
            logo: { name: "Fitbit", src: "/brand-logos/connect/fitbit.svg" },
            title: "Fitbit didn’t connect.",
          }}
        />
      </LinkPageStudyState>
    </div>
  );
}
