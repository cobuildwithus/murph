import "server-only";

import {
  listMemberOwnedDeviceSyncConnectTargets,
  normalizeDeviceConnectSourceId,
  normalizeDeviceSyncConnectTargetKey,
} from "@murphai/device-syncd/connect-config";

import {
  MEMBER_OWNED_DEVICE_PROVIDER_APPLICATION_PROVIDERS,
  isMemberOwnedDeviceProviderApplicationProvider,
  type MemberOwnedDeviceProviderApplicationProvider,
} from "../provider-applications";
import type {
  MemberOwnedProviderSetupAdapter,
  MemberOwnedProviderSetupComputer,
  MemberOwnedProviderSetupCoordinates,
} from "./adapter";
import { STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION } from "./presentation";
import { StravaMemberOwnedProviderSetupAdapter } from "./strava-adapter";
import type { MemberOwnedProviderSetupPresentation } from "./types";

export interface MemberOwnedProviderSetupRegistration<
  TProvider extends string = MemberOwnedDeviceProviderApplicationProvider,
> {
  coordinates: MemberOwnedProviderSetupCoordinates<TProvider>;
  createAdapter(input?: {
    computer?: MemberOwnedProviderSetupComputer;
  }): MemberOwnedProviderSetupAdapter<TProvider>;
  presentation: MemberOwnedProviderSetupPresentation<TProvider>;
}

export interface MemberOwnedProviderSetupRegistry<
  TProvider extends string,
> {
  list(): readonly MemberOwnedProviderSetupRegistration<TProvider>[];
  read(provider: string): MemberOwnedProviderSetupRegistration<TProvider> | null;
  readByConnectSourceId(
    connectSourceId: string,
  ): MemberOwnedProviderSetupRegistration<TProvider> | null;
  readByConnectTarget(
    connectTarget: string,
  ): MemberOwnedProviderSetupRegistration<TProvider> | null;
}

export { STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION } from "./presentation";

export const STRAVA_MEMBER_OWNED_PROVIDER_SETUP_COORDINATES = {
  connectSourceId: "strava",
  connectTarget: "strava",
  provider: "strava",
  sourceProviderSlug: null,
} as const satisfies MemberOwnedProviderSetupCoordinates;

const MEMBER_OWNED_PROVIDER_SETUP_REGISTRY = defineMemberOwnedProviderSetupRegistry(
  MEMBER_OWNED_DEVICE_PROVIDER_APPLICATION_PROVIDERS,
  {
    strava: {
      coordinates: STRAVA_MEMBER_OWNED_PROVIDER_SETUP_COORDINATES,
      createAdapter: (input) => new StravaMemberOwnedProviderSetupAdapter(input),
      presentation: STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION,
    },
  } as const satisfies Record<
    MemberOwnedDeviceProviderApplicationProvider,
    MemberOwnedProviderSetupRegistration<MemberOwnedDeviceProviderApplicationProvider>
  >,
);

assertRegistryMatchesMemberOwnedConnectCatalog(MEMBER_OWNED_PROVIDER_SETUP_REGISTRY);

export function listMemberOwnedProviderSetupRegistrations(): readonly MemberOwnedProviderSetupRegistration[] {
  return MEMBER_OWNED_PROVIDER_SETUP_REGISTRY.list();
}

export function readMemberOwnedProviderSetupRegistration(
  provider: string,
): MemberOwnedProviderSetupRegistration | null {
  return isMemberOwnedDeviceProviderApplicationProvider(provider)
    ? MEMBER_OWNED_PROVIDER_SETUP_REGISTRY.read(provider)
    : null;
}

export function readMemberOwnedProviderSetupRegistrationByConnectSourceId(
  connectSourceId: string,
): MemberOwnedProviderSetupRegistration | null {
  return MEMBER_OWNED_PROVIDER_SETUP_REGISTRY.readByConnectSourceId(connectSourceId);
}

export function readMemberOwnedProviderSetupRegistrationByConnectTarget(
  connectTarget: string,
): MemberOwnedProviderSetupRegistration | null {
  return MEMBER_OWNED_PROVIDER_SETUP_REGISTRY.readByConnectTarget(connectTarget);
}

export function defineMemberOwnedProviderSetupRegistry<TProvider extends string>(
  providers: readonly TProvider[],
  registrations: Readonly<
    Record<TProvider, MemberOwnedProviderSetupRegistration<TProvider>>
  >,
): MemberOwnedProviderSetupRegistry<TProvider> {
  const entries = Object.freeze(
    providers.map((provider) => {
      const registration = registrations[provider];
      if (
        registration.coordinates.provider !== provider
        || registration.presentation.provider !== provider
      ) {
        throw new TypeError(
          `Member-owned provider setup registration ${provider} has mismatched provider metadata.`,
        );
      }
      return registration;
    }),
  );
  const byProvider = new Map<string, MemberOwnedProviderSetupRegistration<TProvider>>(
    providers.map((provider) => [provider, registrations[provider]]),
  );
  const bySource = buildUniqueRegistrationIndex(entries, "connectSourceId");
  const byTarget = buildUniqueRegistrationIndex(entries, "connectTarget");

  return Object.freeze({
    list: () => entries,
    read: (provider: string) => byProvider.get(provider) ?? null,
    readByConnectSourceId: (connectSourceId: string) => {
      const normalized = normalizeDeviceConnectSourceId(connectSourceId);
      return normalized ? bySource.get(normalized) ?? null : null;
    },
    readByConnectTarget: (connectTarget: string) => {
      const normalized = normalizeDeviceSyncConnectTargetKey(connectTarget);
      return normalized ? byTarget.get(normalized) ?? null : null;
    },
  });
}

function buildUniqueRegistrationIndex<TProvider extends string>(
  registrations: readonly MemberOwnedProviderSetupRegistration<TProvider>[],
  coordinate: "connectSourceId" | "connectTarget",
): ReadonlyMap<string, MemberOwnedProviderSetupRegistration<TProvider>> {
  const index = new Map<string, MemberOwnedProviderSetupRegistration<TProvider>>();
  for (const registration of registrations) {
    const value = coordinate === "connectSourceId"
      ? normalizeDeviceConnectSourceId(registration.coordinates[coordinate])
      : normalizeDeviceSyncConnectTargetKey(registration.coordinates[coordinate]);
    if (!value) {
      throw new TypeError(
        `Member-owned provider setup ${coordinate} is invalid.`,
      );
    }
    if (index.has(value)) {
      throw new TypeError(
        `Member-owned provider setup ${coordinate} ${value} is duplicated.`,
      );
    }
    index.set(value, registration);
  }
  return index;
}

function assertRegistryMatchesMemberOwnedConnectCatalog(
  registry: MemberOwnedProviderSetupRegistry<MemberOwnedDeviceProviderApplicationProvider>,
): void {
  const registrations = registry.list();
  const targets = listMemberOwnedDeviceSyncConnectTargets();
  if (registrations.length !== targets.length) {
    throw new TypeError(
      "Member-owned provider setup registry does not match the device connect catalog.",
    );
  }
  for (const registration of registrations) {
    const coordinates = registration.coordinates;
    if (!targets.some(
      (target) =>
        target.connectSourceId === coordinates.connectSourceId
        && target.connectTarget === coordinates.connectTarget
        && target.provider === coordinates.provider
        && coordinates.sourceProviderSlug === null,
    )) {
      throw new TypeError(
        `Member-owned provider setup registry entry ${coordinates.provider} does not match the device connect catalog.`,
      );
    }
  }
}

export function requireMemberOwnedProviderSetupRegistration(
  provider: string,
): MemberOwnedProviderSetupRegistration {
  const registration = readMemberOwnedProviderSetupRegistration(provider);
  if (!registration) {
    throw new TypeError("Member-owned provider setup is not supported for this provider.");
  }
  return registration;
}
