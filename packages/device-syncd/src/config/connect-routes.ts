import type { ConfiguredDeviceSyncProviderKey } from "./provider-types.ts";

export type DirectDeviceConnectProvider = Exclude<ConfiguredDeviceSyncProviderKey, "junction">;

export interface DeviceConnectSource {
  readonly connectSourceId: string;
  readonly label: string;
  readonly routes: readonly DeviceConnectRoute[];
}

export interface DeviceConnectJunctionLinkRoute {
  readonly kind: "junction_link";
  readonly connectTarget: string;
  readonly sourceProviderSlug: string;
  readonly sourceProviderSlugAliases?: readonly string[];
  readonly defaultEnabled: boolean;
}

export interface DeviceConnectJunctionSdkRoute {
  readonly kind: "junction_sdk";
  readonly sourceProviderSlug: string;
  readonly sourceProviderSlugAliases?: readonly string[];
}

export interface DeviceConnectDirectRoute {
  readonly kind: "direct";
  readonly connectTarget: string;
  readonly provider: DirectDeviceConnectProvider;
  readonly defaultEnabled: boolean;
}

export interface DeviceConnectUnavailableRoute {
  readonly kind: "unavailable";
  readonly reason?: string;
}

export type DeviceConnectRoute =
  | DeviceConnectJunctionLinkRoute
  | DeviceConnectJunctionSdkRoute
  | DeviceConnectDirectRoute
  | DeviceConnectUnavailableRoute;

export interface DeviceConnectRouteEntry<TRoute extends DeviceConnectRoute = DeviceConnectRoute> {
  readonly source: DeviceConnectSource;
  readonly route: TRoute;
}

export const DEVICE_CONNECT_SOURCES = Object.freeze([
  {
    connectSourceId: "whoop",
    label: "WHOOP",
    routes: [directRoute("whoop"), junctionLinkRoute("whoop_v2", { connectTarget: "whoop" })],
  },
  {
    connectSourceId: "mapmyfitness",
    label: "MapMyFitness",
    routes: [junctionLinkRoute("map_my_fitness")],
  },
  {
    connectSourceId: "ultrahuman",
    label: "Ultrahuman",
    routes: [junctionLinkRoute("ultrahuman")],
  },
  {
    connectSourceId: "dexcom-g6-and-older",
    label: "Dexcom (G6 and older)",
    routes: [junctionLinkRoute("dexcom")],
  },
  {
    connectSourceId: "renpho",
    label: "Renpho",
    routes: [junctionLinkRoute("renpho")],
  },
  {
    connectSourceId: "runkeeper",
    label: "Runkeeper",
    routes: [junctionLinkRoute("runkeeper")],
  },
  {
    connectSourceId: "samsung-health",
    label: "Samsung Health",
    routes: [junctionSdkRoute("samsung_health")],
  },
  {
    connectSourceId: "tandem-source",
    label: "Tandem Source",
    routes: [junctionLinkRoute("tandem_source")],
  },
  {
    connectSourceId: "beurer",
    label: "Beurer",
    routes: [junctionLinkRoute("beurer_api")],
  },
  {
    connectSourceId: "strava",
    label: "Strava",
    routes: [directRoute("strava"), junctionLinkRoute("strava")],
  },
  {
    connectSourceId: "freestyle-libre-ble",
    label: "Freestyle Libre BLE",
    routes: [junctionSdkRoute("freestyle_libre_ble")],
  },
  {
    connectSourceId: "omron",
    label: "Omron",
    routes: [junctionLinkRoute("omron")],
  },
  {
    connectSourceId: "accuchek",
    label: "Accu-Chek",
    routes: [junctionSdkRoute("accuchek_ble")],
  },
  {
    connectSourceId: "eight-sleep",
    label: "Eight Sleep",
    routes: [junctionLinkRoute("eight_sleep")],
  },
  {
    connectSourceId: "fitbit",
    label: "Fitbit",
    routes: [junctionLinkRoute("fitbit")],
  },
  {
    connectSourceId: "freestyle-libre",
    label: "Freestyle Libre",
    routes: [junctionLinkRoute("freestyle_libre")],
  },
  {
    connectSourceId: "garmin",
    label: "Garmin",
    routes: [junctionLinkRoute("garmin")],
  },
  {
    connectSourceId: "hammerhead",
    label: "Hammerhead",
    routes: [junctionLinkRoute("hammerhead")],
  },
  {
    connectSourceId: "ihealth",
    label: "iHealth",
    routes: [junctionLinkRoute("ihealth")],
  },
  {
    connectSourceId: "oura",
    label: "Oura",
    routes: [directRoute("oura"), junctionLinkRoute("oura")],
  },
  {
    connectSourceId: "peloton",
    label: "Peloton",
    routes: [junctionLinkRoute("peloton")],
  },
  {
    connectSourceId: "wahoo",
    label: "Wahoo",
    routes: [junctionLinkRoute("wahoo")],
  },
  {
    connectSourceId: "contour-ble",
    label: "Contour BLE",
    routes: [junctionSdkRoute("contour_ble")],
  },
  {
    connectSourceId: "withings",
    label: "Withings",
    routes: [junctionLinkRoute("withings")],
  },
  {
    connectSourceId: "google-fit",
    label: "Google Fit",
    routes: [junctionLinkRoute("google_fit")],
  },
  {
    connectSourceId: "zwift",
    label: "Zwift",
    routes: [junctionLinkRoute("zwift")],
  },
  {
    connectSourceId: "onetouch",
    label: "OneTouch",
    routes: [junctionSdkRoute("onetouch_ble")],
  },
  {
    connectSourceId: "abbott-libreview",
    label: "Abbott LibreView",
    routes: [junctionLinkRoute("abbott_libreview")],
  },
  {
    connectSourceId: "dexcom",
    label: "Dexcom",
    routes: [junctionLinkRoute("dexcom_v3")],
  },
  {
    connectSourceId: "kardia",
    label: "Kardia",
    routes: [junctionLinkRoute("kardia")],
  },
  {
    connectSourceId: "cronometer",
    label: "Cronometer",
    routes: [junctionLinkRoute("cronometer")],
  },
  {
    connectSourceId: "polar",
    label: "Polar",
    routes: [junctionLinkRoute("polar")],
  },
  {
    connectSourceId: "apple-health",
    label: "Apple Health",
    routes: [junctionSdkRoute("apple_health_kit", { aliases: ["apple_health", "apple_healthkit"] })],
  },
  {
    connectSourceId: "zepp",
    label: "Zepp / Amazfit",
    routes: [
      unavailableRoute(
        "Zepp and Amazfit sync through Apple Health in the Murph iOS app.",
      ),
    ],
  },
  {
    connectSourceId: "xiaomi-mi-fitness",
    label: "Xiaomi / Mi Fitness",
    routes: [
      unavailableRoute(
        "Xiaomi and Mi Fitness devices sync supported data through Apple Health in the Murph iOS app.",
      ),
    ],
  },
  {
    connectSourceId: "ringconn",
    label: "RingConn",
    routes: [
      unavailableRoute(
        "RingConn devices sync supported data through Apple Health in the Murph iOS app.",
      ),
    ],
  },
  {
    connectSourceId: "coros",
    label: "COROS",
    routes: [
      unavailableRoute(
        "COROS devices sync supported data through Apple Health in the Murph iOS app.",
      ),
    ],
  },
  {
    connectSourceId: "suunto",
    label: "Suunto",
    routes: [
      unavailableRoute(
        "Suunto devices sync supported data through Apple Health in the Murph iOS app.",
      ),
    ],
  },
  {
    connectSourceId: "huawei-health",
    label: "Huawei Health",
    routes: [
      unavailableRoute(
        "Supported Huawei Health data can sync through Apple Health in the Murph iOS app, depending on device, region, and app version.",
      ),
    ],
  },
  {
    connectSourceId: "health-connect",
    label: "Health Connect",
    routes: [unavailableRoute("Health Connect is a mobile/local device flow, not hosted Junction Link.")],
  },
] as const satisfies readonly DeviceConnectSource[]);

export const DEVICE_CONNECT_SOURCE_BY_ID: ReadonlyMap<string, DeviceConnectSource> = new Map(
  DEVICE_CONNECT_SOURCES.map((source) => [source.connectSourceId, source] as const),
);

const DIRECT_ROUTE_ENTRY_BY_PROVIDER = new Map(
  listDirectDeviceConnectRouteEntries().map((entry) => [entry.route.provider, entry] as const),
);

const JUNCTION_ROUTE_ENTRY_BY_PROVIDER_SLUG = buildJunctionDeviceConnectRouteEntryMap();

const JUNCTION_LINK_ROUTE_ENTRY_BY_PROVIDER_SLUG = new Map(
  listJunctionLinkDeviceConnectRouteEntries().map((entry) => [entry.route.sourceProviderSlug, entry] as const),
);

export function normalizeDeviceConnectSourceId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  return normalized || null;
}

export function normalizeJunctionProviderSlug(value: unknown): string | null {
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

export function canonicalizeJunctionProviderSlug(value: unknown): string | null {
  const slug = normalizeJunctionProviderSlug(value);
  return JUNCTION_ROUTE_ENTRY_BY_PROVIDER_SLUG.get(slug ?? "")?.route.sourceProviderSlug
    ?? slug;
}

export function resolveDeviceConnectSourceById(sourceId: string): DeviceConnectSource | null {
  const normalized = normalizeDeviceConnectSourceId(sourceId);
  return normalized ? DEVICE_CONNECT_SOURCE_BY_ID.get(normalized) ?? null : null;
}

export function listDirectDeviceConnectRouteEntries(): DeviceConnectRouteEntry<DeviceConnectDirectRoute>[] {
  const entries: DeviceConnectRouteEntry<DeviceConnectDirectRoute>[] = [];
  for (const source of DEVICE_CONNECT_SOURCES) {
    for (const route of source.routes) {
      if (route.kind === "direct") {
        entries.push({ source, route });
      }
    }
  }
  return entries;
}

export function listJunctionDeviceConnectRouteEntries(): Array<
  DeviceConnectRouteEntry<DeviceConnectJunctionLinkRoute | DeviceConnectJunctionSdkRoute>
> {
  const entries: Array<
    DeviceConnectRouteEntry<DeviceConnectJunctionLinkRoute | DeviceConnectJunctionSdkRoute>
  > = [];
  for (const source of DEVICE_CONNECT_SOURCES) {
    for (const route of source.routes) {
      if (route.kind === "junction_link" || route.kind === "junction_sdk") {
        entries.push({ source, route });
      }
    }
  }
  return entries;
}

export function listJunctionLinkDeviceConnectRouteEntries(): DeviceConnectRouteEntry<DeviceConnectJunctionLinkRoute>[] {
  const entries: DeviceConnectRouteEntry<DeviceConnectJunctionLinkRoute>[] = [];
  for (const source of DEVICE_CONNECT_SOURCES) {
    for (const route of source.routes) {
      if (route.kind === "junction_link") {
        entries.push({ source, route });
      }
    }
  }
  return entries;
}

export function listDefaultJunctionLinkProviderSlugs(): string[] {
  return listJunctionLinkDeviceConnectRouteEntries()
    .filter(({ route }) => route.defaultEnabled)
    .map(({ route }) => route.sourceProviderSlug);
}

export function normalizeJunctionLinkProviderFilter(value: readonly string[] | undefined): string[] {
  const usingDefault = !value || value.length === 0;
  const requested = usingDefault ? listDefaultJunctionLinkProviderSlugs() : value;
  const normalizedProviderSlugs: string[] = [];
  const unsupportedProviderSlugs: string[] = [];

  for (const entry of requested) {
    const providerSlug = normalizeJunctionProviderSlug(entry);

    if (!providerSlug || !JUNCTION_LINK_ROUTE_ENTRY_BY_PROVIDER_SLUG.has(providerSlug)) {
      if (!usingDefault) {
        unsupportedProviderSlugs.push(providerSlug ?? String(entry));
      }
      continue;
    }

    normalizedProviderSlugs.push(providerSlug);
  }

  if (!usingDefault && unsupportedProviderSlugs.length > 0) {
    throw new TypeError(
      `JUNCTION_PROVIDER_FILTER includes unsupported Junction Link provider slugs: ${[
        ...new Set(unsupportedProviderSlugs),
      ].join(", ")}. Only Junction Link routes can be used in the web Link provider filter; SDK-only and unavailable routes require a separate connection flow.`,
    );
  }

  return [...new Set(normalizedProviderSlugs)];
}

export function resolveDirectDeviceConnectRouteByProvider(
  provider: DirectDeviceConnectProvider,
): DeviceConnectRouteEntry<DeviceConnectDirectRoute> | null {
  return DIRECT_ROUTE_ENTRY_BY_PROVIDER.get(provider) ?? null;
}

export function resolveJunctionDeviceConnectRouteByProviderSlug(
  providerSlug: string,
): DeviceConnectRouteEntry<DeviceConnectJunctionLinkRoute | DeviceConnectJunctionSdkRoute> | null {
  const normalized = normalizeJunctionProviderSlug(providerSlug);
  return normalized ? JUNCTION_ROUTE_ENTRY_BY_PROVIDER_SLUG.get(normalized) ?? null : null;
}

export function resolveDeviceConnectSourceIdForJunctionProviderSlug(providerSlug: string): string | null {
  return resolveJunctionDeviceConnectRouteByProviderSlug(providerSlug)?.source.connectSourceId ?? null;
}

export function areJunctionDeviceConnectProviderSlugsEquivalent(
  left: string,
  right: string,
): boolean {
  const normalizedLeft = normalizeJunctionProviderSlug(left);
  const normalizedRight = normalizeJunctionProviderSlug(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  const leftSourceId = resolveDeviceConnectSourceIdForJunctionProviderSlug(normalizedLeft);
  const rightSourceId = resolveDeviceConnectSourceIdForJunctionProviderSlug(normalizedRight);
  return leftSourceId !== null && rightSourceId !== null
    ? leftSourceId === rightSourceId
    : normalizedLeft === normalizedRight;
}

export function resolveJunctionLinkDeviceConnectRouteByProviderSlug(
  providerSlug: string,
): DeviceConnectRouteEntry<DeviceConnectJunctionLinkRoute> | null {
  const normalized = normalizeJunctionProviderSlug(providerSlug);
  return normalized ? JUNCTION_LINK_ROUTE_ENTRY_BY_PROVIDER_SLUG.get(normalized) ?? null : null;
}

function junctionLinkRoute(
  sourceProviderSlug: string,
  options: { aliases?: readonly string[]; connectTarget?: string; defaultEnabled?: boolean } = {},
): DeviceConnectJunctionLinkRoute {
  const normalizedProviderSlug = normalizeJunctionProviderSlug(sourceProviderSlug);
  const normalizedConnectTarget = normalizeJunctionProviderSlug(options.connectTarget ?? sourceProviderSlug);

  if (!normalizedProviderSlug || !normalizedConnectTarget) {
    throw new TypeError("Junction Link routes require normalized provider slugs and connect targets.");
  }

  return {
    kind: "junction_link",
    connectTarget: normalizedConnectTarget,
    sourceProviderSlug: normalizedProviderSlug,
    ...normalizeJunctionProviderSlugAliases(options.aliases),
    defaultEnabled: options.defaultEnabled ?? true,
  };
}

function junctionSdkRoute(
  sourceProviderSlug: string,
  options: { aliases?: readonly string[] } = {},
): DeviceConnectJunctionSdkRoute {
  const normalizedProviderSlug = normalizeJunctionProviderSlug(sourceProviderSlug);
  if (!normalizedProviderSlug) {
    throw new TypeError("Junction SDK routes require normalized provider slugs.");
  }

  return {
    kind: "junction_sdk",
    sourceProviderSlug: normalizedProviderSlug,
    ...normalizeJunctionProviderSlugAliases(options.aliases),
  };
}

function directRoute(
  provider: DirectDeviceConnectProvider,
  options: { connectTarget?: string; defaultEnabled?: boolean } = {},
): DeviceConnectDirectRoute {
  const normalizedConnectTarget = normalizeJunctionProviderSlug(options.connectTarget ?? provider);
  if (!normalizedConnectTarget) {
    throw new TypeError("Direct device connect routes require normalized connect targets.");
  }

  return {
    kind: "direct",
    connectTarget: normalizedConnectTarget,
    provider,
    defaultEnabled: options.defaultEnabled ?? true,
  };
}

function unavailableRoute(reason: string): DeviceConnectUnavailableRoute {
  return { kind: "unavailable", reason };
}

function buildJunctionDeviceConnectRouteEntryMap(): ReadonlyMap<
  string,
  DeviceConnectRouteEntry<DeviceConnectJunctionLinkRoute | DeviceConnectJunctionSdkRoute>
> {
  const entries = new Map<
    string,
    DeviceConnectRouteEntry<DeviceConnectJunctionLinkRoute | DeviceConnectJunctionSdkRoute>
  >();

  for (const entry of listJunctionDeviceConnectRouteEntries()) {
    for (const providerSlug of [
      entry.route.sourceProviderSlug,
      ...(entry.route.sourceProviderSlugAliases ?? []),
    ]) {
      const existing = entries.get(providerSlug);
      if (existing && existing.source.connectSourceId !== entry.source.connectSourceId) {
        throw new TypeError(
          `Junction provider slug ${providerSlug} is mapped to multiple device connect sources.`,
        );
      }
      entries.set(providerSlug, entry);
    }
  }

  return entries;
}

function normalizeJunctionProviderSlugAliases(
  aliases: readonly string[] | undefined,
): { sourceProviderSlugAliases?: readonly string[] } {
  if (!aliases || aliases.length === 0) {
    return {};
  }

  const normalizedAliases = [...new Set(
    aliases
      .map((alias) => normalizeJunctionProviderSlug(alias))
      .filter((alias): alias is string => Boolean(alias)),
  )];

  return normalizedAliases.length > 0
    ? { sourceProviderSlugAliases: Object.freeze(normalizedAliases) }
    : {};
}
