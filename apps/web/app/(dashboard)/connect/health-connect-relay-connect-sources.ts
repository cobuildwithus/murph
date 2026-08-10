import type { ConnectSource } from "./connect-page-types";

const MURPH_ANDROID_PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=ai.withmurph.app";

export const MOBVOI_HEALTH_CONNECT_SOURCE = Object.freeze({
  connectionStatusMeaningful: false,
  description:
    "Supported TicWatch data through direct Health Connect sharing or a Google Fit fallback.",
  id: "mobvoi-health",
  logo: {
    className: "size-11 rounded-full object-contain",
    height: 44,
    src: "/brand-logos/connect/mobvoi-health.png",
    width: 44,
  },
  name: "Mobvoi / TicWatch",
  unavailableActionLabel: "Get Murph for Android",
  unavailableActionUrl: MURPH_ANDROID_PLAY_STORE_URL,
  unavailableMessage:
    "First, enable direct Health Connect sharing in Mobvoi Health if your installed version offers it. Otherwise, enable Google Fit sharing in Mobvoi Health and Sync Fit with Health Connect in Google Fit. Then connect Health Connect in Murph for Android. If no data appears, recheck Mobvoi Health's sharing controls for your version and Health Connect permissions. Categories and history depend on what the apps write.",
} satisfies ConnectSource);
