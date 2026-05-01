export interface JunctionConnectSourceTarget {
  readonly connectSourceId: string;
  readonly label: string;
  readonly providerSlug: string;
}

export const JUNCTION_CONNECT_SOURCE_TARGETS = Object.freeze([
  { connectSourceId: "whoop", label: "WHOOP", providerSlug: "whoop" },
  { connectSourceId: "mapmyfitness", label: "MapMyFitness", providerSlug: "map_my_fitness" },
  { connectSourceId: "ultrahuman", label: "Ultrahuman", providerSlug: "ultrahuman" },
  { connectSourceId: "dexcom-g6-and-older", label: "Dexcom (G6 and older)", providerSlug: "dexcom" },
  { connectSourceId: "renpho", label: "Renpho", providerSlug: "renpho" },
  { connectSourceId: "runkeeper", label: "Runkeeper", providerSlug: "runkeeper" },
  { connectSourceId: "samsung-health", label: "Samsung Health", providerSlug: "samsung_health" },
  { connectSourceId: "tandem-source", label: "Tandem Source", providerSlug: "tandem_source" },
  { connectSourceId: "beurer", label: "Beurer", providerSlug: "beurer_api" },
  { connectSourceId: "strava", label: "Strava", providerSlug: "strava" },
  { connectSourceId: "freestyle-libre-ble", label: "Freestyle Libre BLE", providerSlug: "freestyle_libre_ble" },
  { connectSourceId: "omron", label: "Omron", providerSlug: "omron" },
  { connectSourceId: "accuchek", label: "Accu-Chek", providerSlug: "accuchek_ble" },
  { connectSourceId: "eight-sleep", label: "Eight Sleep", providerSlug: "eight_sleep" },
  { connectSourceId: "fitbit", label: "Fitbit", providerSlug: "fitbit" },
  { connectSourceId: "freestyle-libre", label: "Freestyle Libre", providerSlug: "freestyle_libre" },
  { connectSourceId: "garmin", label: "Garmin", providerSlug: "garmin" },
  { connectSourceId: "hammerhead", label: "Hammerhead", providerSlug: "hammerhead" },
  { connectSourceId: "ihealth", label: "iHealth", providerSlug: "ihealth" },
  { connectSourceId: "oura", label: "Oura", providerSlug: "oura" },
  { connectSourceId: "peloton", label: "Peloton", providerSlug: "peloton" },
  { connectSourceId: "wahoo", label: "Wahoo", providerSlug: "wahoo" },
  { connectSourceId: "contour-ble", label: "Contour BLE", providerSlug: "contour_ble" },
  { connectSourceId: "withings", label: "Withings", providerSlug: "withings" },
  { connectSourceId: "google-fit", label: "Google Fit", providerSlug: "google_fit" },
  { connectSourceId: "zwift", label: "Zwift", providerSlug: "zwift" },
  { connectSourceId: "onetouch", label: "OneTouch", providerSlug: "onetouch_ble" },
  { connectSourceId: "abbott-libreview", label: "Abbott LibreView", providerSlug: "abbott_libreview" },
  { connectSourceId: "dexcom", label: "Dexcom", providerSlug: "dexcom_v3" },
  { connectSourceId: "kardia", label: "Kardia", providerSlug: "kardia" },
  { connectSourceId: "cronometer", label: "Cronometer", providerSlug: "cronometer" },
  { connectSourceId: "polar", label: "Polar", providerSlug: "polar" },
] as const satisfies readonly JunctionConnectSourceTarget[]);

export const JUNCTION_DEFAULT_PROVIDER_FILTER = Object.freeze(
  JUNCTION_CONNECT_SOURCE_TARGETS.map(({ providerSlug }) => providerSlug),
);

const JUNCTION_PROVIDER_SLUG_BY_CONNECT_SOURCE_ID = new Map(
  JUNCTION_CONNECT_SOURCE_TARGETS.map((target) => [
    normalizeJunctionProviderSlug(target.connectSourceId),
    target.providerSlug,
  ]),
);

const JUNCTION_CONNECT_SOURCE_LABEL_BY_PROVIDER_SLUG = new Map(
  JUNCTION_CONNECT_SOURCE_TARGETS.map((target) => [
    normalizeJunctionProviderSlug(target.providerSlug),
    target.label,
  ]),
);

export function resolveJunctionConnectTargetForSourceId(sourceId: string): string | null {
  const normalized = normalizeJunctionProviderSlug(sourceId);
  if (!normalized) {
    return null;
  }

  return JUNCTION_PROVIDER_SLUG_BY_CONNECT_SOURCE_ID.get(normalized) ?? null;
}

export function resolveJunctionConnectSourceLabel(providerSlug: string): string | null {
  const normalized = normalizeJunctionProviderSlug(providerSlug);
  if (!normalized) {
    return null;
  }

  return JUNCTION_CONNECT_SOURCE_LABEL_BY_PROVIDER_SLUG.get(normalized) ?? null;
}

function normalizeJunctionProviderSlug(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/gu, "_")
    .replace(/^_+|_+$/gu, "");

  return normalized || null;
}

