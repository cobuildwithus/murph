import "server-only";

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

export interface MemberOwnedProviderSetupRegistration {
  coordinates: MemberOwnedProviderSetupCoordinates;
  createAdapter(input?: {
    computer?: MemberOwnedProviderSetupComputer;
  }): MemberOwnedProviderSetupAdapter;
  presentation: MemberOwnedProviderSetupPresentation;
}

export { STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION } from "./presentation";

export const STRAVA_MEMBER_OWNED_PROVIDER_SETUP_COORDINATES = {
  connectSourceId: "strava",
  connectTarget: "strava",
  provider: "strava",
  sourceProviderSlug: null,
} as const satisfies MemberOwnedProviderSetupCoordinates;

const MEMBER_OWNED_PROVIDER_SETUP_REGISTRY = {
  strava: {
    coordinates: STRAVA_MEMBER_OWNED_PROVIDER_SETUP_COORDINATES,
    createAdapter: (input) => new StravaMemberOwnedProviderSetupAdapter(input),
    presentation: STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION,
  },
} as const satisfies Record<
  MemberOwnedDeviceProviderApplicationProvider,
  MemberOwnedProviderSetupRegistration
>;

export function listMemberOwnedProviderSetupRegistrations(): readonly MemberOwnedProviderSetupRegistration[] {
  return MEMBER_OWNED_DEVICE_PROVIDER_APPLICATION_PROVIDERS.map(
    (provider) => MEMBER_OWNED_PROVIDER_SETUP_REGISTRY[provider],
  );
}

export function readMemberOwnedProviderSetupRegistration(
  provider: string,
): MemberOwnedProviderSetupRegistration | null {
  if (!isMemberOwnedDeviceProviderApplicationProvider(provider)) {
    return null;
  }
  return MEMBER_OWNED_PROVIDER_SETUP_REGISTRY[provider];
}

export function readMemberOwnedProviderSetupRegistrationByConnectSourceId(
  connectSourceId: string,
): MemberOwnedProviderSetupRegistration | null {
  return listMemberOwnedProviderSetupRegistrations().find(
    (registration) => registration.coordinates.connectSourceId === connectSourceId,
  ) ?? null;
}

export function readMemberOwnedProviderSetupRegistrationByConnectTarget(
  connectTarget: string,
): MemberOwnedProviderSetupRegistration | null {
  const normalized = connectTarget.trim().toLowerCase();
  return listMemberOwnedProviderSetupRegistrations().find(
    (registration) => registration.coordinates.connectTarget === normalized,
  ) ?? null;
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
