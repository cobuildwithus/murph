import type { ConnectSource } from "./connect-page-types";

type ConnectSourceUi = Omit<ConnectSource, "id">;
type RelayPlatform = "android" | "ios";

const MURPH_IOS_APP_STORE_URL =
  "https://apps.apple.com/us/app/murph-ai/id6786145859";
const MURPH_ANDROID_PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=ai.withmurph.app";
const RELAY_LOGO = {
  className: "h-auto max-h-7 w-auto max-w-[8rem] object-contain",
  height: 40,
  src: "/brand-logos/connect/wearable-relay.svg",
  width: 64,
} as const;

export const HEALTH_DATA_RELAY_SOURCE_IDS = [
  "health-connect",
  "samsung-health",
  "mobvoi-health",
  "wyze-scale",
  "eufy-life",
  "vesync-etekcity",
  "ad-heart-track",
  "microlife-connected-health",
] as const;

type HealthDataRelaySourceId =
  (typeof HEALTH_DATA_RELAY_SOURCE_IDS)[number];

function relaySourceUi(input: {
  description: string;
  name: string;
  platform: RelayPlatform;
  setup: string;
}): ConnectSourceUi {
  return {
    description: input.description,
    logo: { ...RELAY_LOGO },
    name: input.name,
    unavailableActionLabel: "Download app",
    unavailableActionUrl:
      input.platform === "android"
        ? MURPH_ANDROID_PLAY_STORE_URL
        : MURPH_IOS_APP_STORE_URL,
    unavailableMessage: input.setup,
  };
}

export const HEALTH_DATA_RELAY_SOURCE_UI = {
  "health-connect": relaySourceUi({
    description:
      "Android health apps, smart scales, blood pressure monitors, and supported records through Health Connect.",
    name: "Health Connect",
    platform: "android",
    setup:
      "Connect the device's own app to Health Connect, then open Murph on Android and approve the categories you want to share.",
  }),
  "samsung-health": relaySourceUi({
    description:
      "Samsung Health activity, sleep, weight, body composition, and blood pressure through Health Connect.",
    name: "Samsung Health",
    platform: "android",
    setup:
      "In Samsung Health, turn on Health Connect sharing, then open Murph on Android and approve the categories you want to share.",
  }),
  "mobvoi-health": relaySourceUi({
    description:
      "TicWatch sleep, activity, heart rate, and workouts through Android Health Connect.",
    name: "Mobvoi / TicWatch",
    platform: "android",
    setup:
      "In Mobvoi Health, turn on Google Fit sharing, then allow those categories in Health Connect before opening Murph on Android.",
  }),
  "wyze-scale": relaySourceUi({
    description:
      "Wyze Scale weight and body-composition trends through Apple Health.",
    name: "Wyze Scale",
    platform: "ios",
    setup:
      "In the Wyze app, enable Apple Health sharing, then open Murph on iPhone and connect Apple Health.",
  }),
  "eufy-life": relaySourceUi({
    description:
      "Eufy Smart Scale and eufyLife weight and body-composition trends through Apple Health.",
    name: "Eufy Smart Scale / eufyLife",
    platform: "ios",
    setup:
      "In eufyLife, enable Apple Health sharing, then open Murph on iPhone and connect Apple Health.",
  }),
  "vesync-etekcity": relaySourceUi({
    description:
      "Etekcity and VeSync smart-scale weight and body-composition trends through Apple Health.",
    name: "VeSync / Etekcity",
    platform: "ios",
    setup:
      "In VeSync, enable Apple Health sharing for the scale, then open Murph on iPhone and connect Apple Health.",
  }),
  "ad-heart-track": relaySourceUi({
    description:
      "A&D Heart Track blood pressure, pulse, and supported weight data through Apple Health.",
    name: "A&D Heart Track",
    platform: "ios",
    setup:
      "In Heart Track, enable Apple Health sharing, then open Murph on iPhone and connect Apple Health.",
  }),
  "microlife-connected-health": relaySourceUi({
    description:
      "Microlife Connected Health+ blood pressure and pulse readings through Apple Health.",
    name: "Microlife Connected Health+",
    platform: "ios",
    setup:
      "In Connected Health+, enable Apple Health sharing, then open Murph on iPhone and connect Apple Health.",
  }),
} satisfies Record<HealthDataRelaySourceId, ConnectSourceUi>;

export function listHealthDataRelayConnectSources(): ConnectSource[] {
  return HEALTH_DATA_RELAY_SOURCE_IDS.map((id) => ({
    id,
    ...HEALTH_DATA_RELAY_SOURCE_UI[id],
  }));
}
