import type { ConnectSource } from "./connect-page-types";

const MURPH_ANDROID_PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=ai.withmurph.app";

export const MOBVOI_HEALTH_CONNECT_SOURCE = Object.freeze({
  connectionAvailable: false,
  description:
    "Supported TicWatch data reaches Murph through Health Connect.",
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
    "Turn on Health Connect in Mobvoi Health. If that option is missing, share to Google Fit and enable Sync Fit with Health Connect. In Murph for Android, connect Health Connect. No data? Recheck sharing and permissions. Categories and history depend on what Mobvoi writes.",
} satisfies ConnectSource);
