import {
  DEVICE_CONNECT_SOURCES,
  normalizeJunctionProviderSlug,
  resolveDeviceConnectSourceById,
  resolveJunctionDeviceConnectRouteByProviderSlug,
} from "../config/connect-routes.ts";

import type {
  DeviceConnectJunctionLinkRoute,
  DeviceConnectJunctionSdkRoute,
  DeviceConnectRoute,
} from "../config/connect-routes.ts";

export type JunctionConnectMode = "junction_link" | "junction_sdk" | "direct" | "unavailable";

export interface JunctionConnectSourceTarget {
  readonly connectSourceId: string;
  readonly label: string;
  readonly providerSlug: string;
  readonly connectMode: JunctionConnectMode;
}

export const JUNCTION_CONNECT_SOURCE_TARGETS: readonly JunctionConnectSourceTarget[] = Object.freeze(
  DEVICE_CONNECT_SOURCES.flatMap((source) => {
    const route = source.routes.find(isJunctionProviderRoute);
    return route
      ? [{
        connectMode: route.kind,
        connectSourceId: source.connectSourceId,
        label: source.label,
        providerSlug: route.sourceProviderSlug,
      }]
      : [];
  }),
);

export const JUNCTION_LINK_PROVIDER_SLUGS: readonly string[] = Object.freeze(
  JUNCTION_CONNECT_SOURCE_TARGETS
    .filter((target) => target.connectMode === "junction_link")
    .map(({ providerSlug }) => providerSlug),
);

export const JUNCTION_DEFAULT_PROVIDER_FILTER: readonly string[] = JUNCTION_LINK_PROVIDER_SLUGS;

const JUNCTION_LINK_PROVIDER_SLUG_SET = new Set(JUNCTION_LINK_PROVIDER_SLUGS);

export const JUNCTION_BLOCKED_WEB_LINK_PROVIDER_SLUGS: readonly string[] = Object.freeze(
  JUNCTION_CONNECT_SOURCE_TARGETS
    .filter((target) => target.connectMode !== "junction_link")
    .map(({ providerSlug }) => providerSlug),
);

export function resolveJunctionConnectTargetForSourceId(sourceId: string): string | null {
  const source = resolveDeviceConnectSourceById(sourceId);
  const junctionRoute = source?.routes.find(isJunctionProviderRoute);
  return junctionRoute?.sourceProviderSlug ?? null;
}

export function resolveJunctionConnectSourceLabel(providerSlug: string): string | null {
  const junctionRoute = resolveJunctionDeviceConnectRouteByProviderSlug(providerSlug);
  return junctionRoute?.source.label ?? null;
}

export function normalizeJunctionProviderFilter(value: readonly string[] | undefined): string[] {
  const requested = value && value.length > 0 ? value : JUNCTION_LINK_PROVIDER_SLUGS;

  return [...new Set(
    requested
      .map(normalizeJunctionProviderSlug)
      .filter((entry): entry is string => entry !== null && JUNCTION_LINK_PROVIDER_SLUG_SET.has(entry)),
  )];
}

function isJunctionProviderRoute(
  route: DeviceConnectRoute,
): route is DeviceConnectJunctionLinkRoute | DeviceConnectJunctionSdkRoute {
  return route.kind === "junction_link" || route.kind === "junction_sdk";
}
