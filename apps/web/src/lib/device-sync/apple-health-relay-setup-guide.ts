import type { DeviceSyncCompletionSetupGuide } from "@/src/lib/device-sync/connect-completion-types";

const MURPH_IOS_APP_STORE_URL = "https://apps.apple.com/us/app/murph-ai/id6786145859";

export const APPLE_HEALTH_RELAY_SETUP_GUIDE_IDS = [
  "xiaomi-mi-fitness-apple-health",
  "ringconn-apple-health",
  "coros-apple-health",
  "suunto-apple-health",
  "huawei-health-apple-health",
] as const;

export type AppleHealthRelaySetupGuideId =
  (typeof APPLE_HEALTH_RELAY_SETUP_GUIDE_IDS)[number];

type AppleHealthRelaySetupGuideConfig = {
  detail: string;
  setupDetail: string;
  setupTitle: string;
  sourceName: string;
};

const APPLE_HEALTH_RELAY_SETUP_GUIDES = {
  "xiaomi-mi-fitness-apple-health": {
    detail:
      "Mi Fitness shares supported Mi Band, Xiaomi Smart Band, and Redmi Watch data with Apple Health, and Murph reads it there.",
    setupDetail:
      "In Mi Fitness, open its Apple Health sharing settings and allow the categories you want Murph to use.",
    setupTitle: "Turn on Apple Health in Mi Fitness",
    sourceName: "Xiaomi / Mi Fitness",
  },
  "ringconn-apple-health": {
    detail:
      "RingConn shares supported smart-ring data with Apple Health, and Murph reads it there.",
    setupDetail:
      "In RingConn, open its Apple Health integration and allow the categories you want Murph to use.",
    setupTitle: "Turn on Apple Health in RingConn",
    sourceName: "RingConn",
  },
  "coros-apple-health": {
    detail:
      "COROS shares supported activity, sleep, heart-rate, and workout data with Apple Health, and Murph reads it there.",
    setupDetail:
      "In COROS, open its third-party data sync settings, choose Apple Health, and allow the categories you want Murph to use.",
    setupTitle: "Turn on Apple Health in COROS",
    sourceName: "COROS",
  },
  "suunto-apple-health": {
    detail:
      "Suunto shares supported activity, sleep, heart-rate, and workout data with Apple Health, and Murph reads it there.",
    setupDetail:
      "In Suunto, open its Apple Health integration and allow the categories you want Murph to use.",
    setupTitle: "Turn on Apple Health in Suunto",
    sourceName: "Suunto",
  },
  "huawei-health-apple-health": {
    detail:
      "Huawei Health can share selected data with Apple Health on supported iPhone setups. Availability varies by device, region, and app version.",
    setupDetail:
      "In Huawei Health, enable Apple Health sharing if the option appears, then allow the categories available on your setup.",
    setupTitle: "Turn on Apple Health in Huawei Health",
    sourceName: "Huawei Health",
  },
} satisfies Record<AppleHealthRelaySetupGuideId, AppleHealthRelaySetupGuideConfig>;

const APPLE_HEALTH_RELAY_SETUP_GUIDE_ID_SET = new Set<string>(
  APPLE_HEALTH_RELAY_SETUP_GUIDE_IDS,
);

export function isAppleHealthRelaySetupGuideId(
  value: unknown,
): value is AppleHealthRelaySetupGuideId {
  return typeof value === "string" && APPLE_HEALTH_RELAY_SETUP_GUIDE_ID_SET.has(value);
}

export function buildAppleHealthRelaySetupGuide(
  setupGuideId: AppleHealthRelaySetupGuideId,
): DeviceSyncCompletionSetupGuide {
  const guide = APPLE_HEALTH_RELAY_SETUP_GUIDES[setupGuideId];

  return {
    actionAriaLabel: `See how to sync ${guide.sourceName} through Apple Health`,
    actionLabel: "Set up sync",
    detail: guide.detail,
    downloadAction: {
      ariaLabel: `Download App to sync ${guide.sourceName} through Apple Health`,
      href: MURPH_IOS_APP_STORE_URL,
      label: "Download App",
      rel: "noopener noreferrer",
      target: "_blank",
    },
    steps: [
      {
        detail: "Get the Murph app on your iPhone and connect Apple Health when it asks.",
        title: "Download Murph and sign in",
      },
      {
        detail: guide.setupDetail,
        title: guide.setupTitle,
      },
    ],
    title: `Sync ${guide.sourceName} through Apple Health`,
  };
}
