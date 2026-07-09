type OrderedConnectSource = {
  connected?: boolean;
  id: string;
  requiresReconnect?: boolean;
};

const CONNECT_SOURCE_POPULARITY_ORDER = [
  "apple-health",
  "samsung-health",
  "garmin",
  "fitbit",
  "google-fit",
  "strava",
  "withings",
  "oura",
  "whoop",
  "dexcom",
  "dexcom-g6-and-older",
  "freestyle-libre",
  "abbott-libreview",
  "polar",
  "wahoo",
  "peloton",
  "zwift",
  "runkeeper",
  "mapmyfitness",
  "cronometer",
  "renpho",
  "omron",
  "ihealth",
  "beurer",
  "accuchek",
  "onetouch",
  "contour-ble",
  "freestyle-libre-ble",
  "ultrahuman",
  "eight-sleep",
  "kardia",
  "hammerhead",
  "tandem-source",
] as const;

const CONNECT_SOURCE_POPULARITY_RANK = new Map<string, number>(
  CONNECT_SOURCE_POPULARITY_ORDER.map((sourceId, index) => [sourceId, index]),
);

export function sortConnectSourcesByConnectionState<TSource extends OrderedConnectSource>(
  sources: readonly TSource[],
): TSource[] {
  return sources
    .map((source, index) => ({ index, source }))
    .sort((left, right) => {
      const leftConnected = Boolean(left.source.connected);
      const rightConnected = Boolean(right.source.connected);
      const leftRequiresReconnect = Boolean(left.source.requiresReconnect);
      const rightRequiresReconnect = Boolean(right.source.requiresReconnect);

      if (leftRequiresReconnect !== rightRequiresReconnect) {
        return leftRequiresReconnect ? -1 : 1;
      }

      if (leftConnected !== rightConnected) {
        return leftConnected ? -1 : 1;
      }

      const leftRank =
        CONNECT_SOURCE_POPULARITY_RANK.get(left.source.id) ?? Number.MAX_SAFE_INTEGER;
      const rightRank =
        CONNECT_SOURCE_POPULARITY_RANK.get(right.source.id) ?? Number.MAX_SAFE_INTEGER;

      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }

      return left.index - right.index;
    })
    .map(({ source }) => source);
}
