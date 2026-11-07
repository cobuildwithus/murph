const CONNECT_LOGO_DIRECTORY = "/brand-logos/connect";

// The same names the Connect page shows, so a link page never stretches a logo
// that has a sharper file.
const CONNECT_LOGO_FILES: ReadonlyMap<string, string> = new Map([
  ...[
    "abbott-libreview",
    "accuchek",
    "eight-sleep",
    "fitbit",
    "gmail",
    "google-fit",
    "kardia",
    "peloton",
    "polar",
    "renpho",
    "runkeeper",
    "strava",
    "tandem-source",
    "wahoo",
    "whoop",
  ].map((id) => [id, `${id}.svg`] as const),
  ...[
    "apple-health",
    "beurer",
    "contour-ble",
    "coros",
    "cronometer",
    "dexcom",
    "dexcom-g6-and-older",
    "freestyle-libre",
    "freestyle-libre-ble",
    "garmin",
    "hammerhead",
    "huawei-health",
    "ihealth",
    "mapmyfitness",
    "omron",
    "onetouch",
    "oura",
    "ringconn",
    "samsung-health",
    "suunto",
    "ultrahuman",
    "withings",
    "zepp",
    "zwift",
  ].map((id) => [id, `${id}.png`] as const),
  ["googlecalendar", "google-calendar.svg"],
]);

/** A connect source's or connected app's logo, when Murph has one. */
export function resolveConnectLogoSrc(id: string | null | undefined): string | null {
  const file = id ? CONNECT_LOGO_FILES.get(id.trim().toLowerCase()) : null;
  return file ? `${CONNECT_LOGO_DIRECTORY}/${file}` : null;
}
