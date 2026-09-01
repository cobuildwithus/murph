import type {
  ComparisonCategoryId,
  ComparisonEntry,
  ComparisonQuickRow,
  ComparisonQuickStatus,
} from "./types";

const LONGITUDINAL_HISTORY_STATUS: Record<
  ComparisonCategoryId,
  ComparisonQuickStatus
> = {
  fitness: "yes",
  "health-assistants": "yes",
  "health-data": "yes",
  "labs-longevity": "limited",
  nutrition: "yes",
  "sleep-mental": "yes",
  wearables: "yes",
};

const FAMILIAR_MESSAGING_STATUS: Record<
  ComparisonCategoryId,
  ComparisonQuickStatus
> = {
  fitness: "no",
  "health-assistants": "limited",
  "health-data": "no",
  "labs-longevity": "no",
  nutrition: "no",
  "sleep-mental": "no",
  wearables: "no",
};

const PROACTIVE_FOLLOW_UP_STATUS: Record<
  ComparisonCategoryId,
  ComparisonQuickStatus
> = {
  fitness: "limited",
  "health-assistants": "yes",
  "health-data": "limited",
  "labs-longevity": "limited",
  nutrition: "limited",
  "sleep-mental": "limited",
  wearables: "limited",
};

const NO_DEDICATED_DEVICE = new Set([
  "amazfit-helio-strap",
  "apollo-neuro",
  "autosleep",
  "circular",
  "coros",
  "eight-sleep",
  "garmin-connect",
  "google-health",
  "lumen",
  "muse",
  "oura-ring",
  "polar-loop",
  "ringconn",
  "signos",
  "sleepwatch",
  "tonal",
  "ultrahuman-ring-pro",
  "whoop",
]);

const OPTIONAL_OR_EXTERNAL_DEVICE = new Set([
  "levels",
  "nutrisense",
  "withings",
]);

function noDedicatedDeviceStatus(slug: string): ComparisonQuickStatus {
  if (NO_DEDICATED_DEVICE.has(slug)) return "no";
  if (OPTIONAL_OR_EXTERNAL_DEVICE.has(slug)) return "limited";
  return "yes";
}

function familiarMessagingStatus(
  comparison: ComparisonEntry,
): ComparisonQuickStatus {
  if (comparison.slug === "bodybuddy") return "yes";

  if (
    [
      "caliber",
      "fay",
      "future-pro",
      "nourish",
      "nutrisense",
      "trainwell",
    ].includes(comparison.slug)
  ) {
    return "limited";
  }

  return FAMILIAR_MESSAGING_STATUS[comparison.category];
}

function sharedQuickRows(
  comparison: ComparisonEntry,
): readonly ComparisonQuickRow[] {
  return [
    {
      capability: "Longitudinal history",
      competitor: LONGITUDINAL_HISTORY_STATUS[comparison.category],
      evidence: "inputs",
      murph: "yes",
    },
    {
      capability: "Handles changing priorities",
      competitor: "limited",
      evidence: "primaryJob",
      murph: "yes",
    },
    {
      capability: "Familiar messaging access",
      competitor: familiarMessagingStatus(comparison),
      evidence: "format",
      murph: "yes",
    },
    {
      capability: "Proactive follow up",
      competitor: PROACTIVE_FOLLOW_UP_STATUS[comparison.category],
      evidence: "followThrough",
      murph: "yes",
    },
    {
      capability: "No dedicated device",
      competitor: noDedicatedDeviceStatus(comparison.slug),
      evidence: "hardware",
      murph: "yes",
    },
  ];
}

export function expandQuickComparison(
  comparison: ComparisonEntry,
): readonly ComparisonQuickRow[] {
  return [...comparison.quickComparison, ...sharedQuickRows(comparison)];
}
