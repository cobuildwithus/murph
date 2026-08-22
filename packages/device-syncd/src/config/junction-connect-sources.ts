import {
  canonicalizeJunctionProviderSlug,
  DEVICE_CONNECT_SOURCES,
  listDefaultJunctionLinkProviderSlugs,
  normalizeJunctionLinkProviderFilter,
  resolveDeviceConnectSourceById,
  resolveJunctionDeviceConnectRouteByProviderSlug,
} from "./connect-routes.ts";
import { normalizeString, sha256Text } from "../shared.ts";

import type {
  DeviceConnectJunctionLinkRoute,
  DeviceConnectJunctionSdkRoute,
  DeviceConnectRoute,
} from "./connect-routes.ts";

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

export const JUNCTION_DEFAULT_PROVIDER_FILTER: readonly string[] = Object.freeze(
  listDefaultJunctionLinkProviderSlugs(),
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
  return normalizeJunctionLinkProviderFilter(value);
}

export function buildJunctionProviderSourceInstanceKey(input: {
  connectionId: string;
  sourceProviderSlug: string;
}): string | null {
  const connectionId = normalizeString(input.connectionId);
  const sourceProviderSlug = canonicalizeJunctionProviderSlug(input.sourceProviderSlug);

  if (!connectionId || !sourceProviderSlug) {
    return null;
  }

  return `jxn_src_${
    sha256Text(JSON.stringify([
      "junction-provider-source",
      connectionId,
      sourceProviderSlug,
    ])).slice(0, 32)
  }`;
}

function isJunctionProviderRoute(
  route: DeviceConnectRoute,
): route is DeviceConnectJunctionLinkRoute | DeviceConnectJunctionSdkRoute {
  return route.kind === "junction_link" || route.kind === "junction_sdk";
}
