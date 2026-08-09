import type { ConnectSource, LogoAsset } from "./connect-page-types";

type AppleHealthRelayConnectSourceUi = Omit<ConnectSource, "id">;

export const MAINSTREAM_APPLE_HEALTH_RELAY_SOURCE_IDS = [
  "huawei-health",
  "xiaomi-mi-fitness",
  "zepp",
] as const;

export const SPECIALTY_APPLE_HEALTH_RELAY_SOURCE_IDS = [
  "coros",
  "suunto",
  "ringconn",
] as const;

export const APPLE_HEALTH_RELAY_CONNECT_SOURCE_IDS = [
  ...MAINSTREAM_APPLE_HEALTH_RELAY_SOURCE_IDS,
  ...SPECIALTY_APPLE_HEALTH_RELAY_SOURCE_IDS,
] as const;

export type AppleHealthRelayConnectSourceId =
  (typeof APPLE_HEALTH_RELAY_CONNECT_SOURCE_IDS)[number];

function providerAppLogo(fileName: string): LogoAsset {
  return {
    className: "size-11 rounded-md object-contain",
    height: 44,
    src: `/brand-logos/connect/${fileName}`,
    width: 44,
  };
}

function appleHealthRelaySourceUi(
  input: Omit<AppleHealthRelayConnectSourceUi, "logo" | "setupGuideActionLabel"> & {
    logoFileName: string;
  },
): AppleHealthRelayConnectSourceUi {
  const { logoFileName, ...source } = input;

  return {
    ...source,
    logo: providerAppLogo(logoFileName),
    setupGuideActionLabel: "Set up sync",
  };
}

export const APPLE_HEALTH_RELAY_CONNECT_SOURCE_UI = {
  "huawei-health": appleHealthRelaySourceUi({
    description: "Selected watch and band data through Apple Health, where supported.",
    logoFileName: "huawei-health.png",
    name: "Huawei Health",
    setupGuideId: "huawei-health-apple-health",
  }),
  "xiaomi-mi-fitness": appleHealthRelaySourceUi({
    description:
      "Mi Band, Xiaomi Smart Band, and Redmi Watch activity, sleep, heart rate, and workouts through Apple Health.",
    logoFileName: "mi-fitness.png",
    name: "Xiaomi / Mi Fitness",
    setupGuideId: "xiaomi-mi-fitness-apple-health",
  }),
  zepp: appleHealthRelaySourceUi({
    description: "Amazfit activity, sleep, heart rate, and workouts through Apple Health.",
    logoFileName: "zepp.png",
    name: "Zepp / Amazfit",
    setupGuideId: "zepp-apple-health",
  }),
  coros: appleHealthRelaySourceUi({
    description: "Activity, sleep, heart rate, and supported workouts through Apple Health.",
    logoFileName: "coros.png",
    name: "COROS",
    setupGuideId: "coros-apple-health",
  }),
  suunto: appleHealthRelaySourceUi({
    description: "Activity, sleep, heart rate, and supported workouts through Apple Health.",
    logoFileName: "suunto.png",
    name: "Suunto",
    setupGuideId: "suunto-apple-health",
  }),
  ringconn: appleHealthRelaySourceUi({
    description: "Smart-ring sleep, activity, heart rate, and supported data through Apple Health.",
    logoFileName: "ringconn.png",
    name: "RingConn",
    setupGuideId: "ringconn-apple-health",
  }),
} satisfies Record<AppleHealthRelayConnectSourceId, AppleHealthRelayConnectSourceUi>;

export function listAppleHealthRelayConnectSources(): ConnectSource[] {
  return APPLE_HEALTH_RELAY_CONNECT_SOURCE_IDS.map((id) => ({
    id,
    ...APPLE_HEALTH_RELAY_CONNECT_SOURCE_UI[id],
  }));
}
