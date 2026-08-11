import { isMurphAndroidAppEnabled } from "@murphai/hosted-execution/env";

import type { ConnectSource } from "./connect-page-types";

const MURPH_ANDROID_PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=ai.withmurph.app";

export const MOBVOI_HEALTH_CONNECT_SOURCE = Object.freeze({
  connectionAvailable: false,
  description: "TicWatch data via Health Connect.",
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
    "Sync through Mobvoi Health or Google Fit, then connect Health Connect in Murph.",
} satisfies ConnectSource);

export function listHealthConnectRelayConnectSources(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ConnectSource[] {
  return isMurphAndroidAppEnabled(env)
    ? [MOBVOI_HEALTH_CONNECT_SOURCE]
    : [];
}
