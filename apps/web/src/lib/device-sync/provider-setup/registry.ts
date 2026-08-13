import "server-only";

import { createHash } from "node:crypto";

import {
  listMemberOwnedDeviceSyncConnectTargets,
  normalizeDeviceConnectSourceId,
  normalizeDeviceSyncConnectTargetKey,
} from "@murphai/device-syncd/connect-config";
import { listDeviceSyncProviderCatalog } from "@murphai/device-syncd";

import { readHostedDeviceSyncPublicBaseUrl } from "../../hosted-web/public-url";
import {
  isMemberOwnedDeviceProviderApplicationProvider,
  type MemberOwnedDeviceProviderApplicationProvider,
} from "../provider-applications";
import { STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION } from "./presentation";
import type { MemberOwnedProviderSetupPresentation } from "./types";

export { STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION } from "./presentation";

export interface MemberOwnedProviderSetupCoordinates<
  TProvider extends string = MemberOwnedDeviceProviderApplicationProvider,
> {
  connectSourceId: string;
  connectTarget: string;
  provider: TProvider;
  sourceProviderSlug: string | null;
}

export interface MemberOwnedProviderSetupBrowserMetadata {
  applicationCategory: string | null;
  applicationWebsite: string;
  developerPortalUrl: string;
  guidance: readonly string[];
  safeLandingUrl: string;
}

export interface MemberOwnedProviderSetupRegistration<
  TProvider extends string = MemberOwnedDeviceProviderApplicationProvider,
> {
  browser: MemberOwnedProviderSetupBrowserMetadata;
  coordinates: MemberOwnedProviderSetupCoordinates<TProvider>;
  presentation: MemberOwnedProviderSetupPresentation<TProvider>;
}

export interface MemberOwnedProviderSetupBrowserContract<
  TProvider extends string = MemberOwnedDeviceProviderApplicationProvider,
> {
  application: {
    callbackUrl: string;
    category: string | null;
    marker: string;
    name: string;
    readOnlyScopes: readonly string[];
    website: string;
  };
  developerPortalUrl: string;
  guidance: readonly string[];
  provider: TProvider;
  providerName: string;
  safeLandingUrl: string;
}

export const STRAVA_MEMBER_OWNED_PROVIDER_SETUP_COORDINATES = {
  connectSourceId: "strava",
  connectTarget: "strava",
  provider: "strava",
  sourceProviderSlug: null,
} as const satisfies MemberOwnedProviderSetupCoordinates;

const STRAVA_REGISTRATION = Object.freeze({
  browser: Object.freeze({
    applicationCategory: "Other",
    applicationWebsite: "https://withmurph.ai",
    developerPortalUrl: "https://www.strava.com/settings/api",
    guidance: Object.freeze([
      "Use the provider developer page to create one private application with the exact supplied name, website, category, callback URL, and read-only scopes.",
      "Navigate and identify controls from the live page. Never rely on checked-in provider selectors or a provider-specific browser program.",
      "Fill the final form with computer tools, but do not submit it with computer_act. Call provider_setup capture so final submission and credential sealing happen inside the trusted browser boundary.",
      "For sign-in, MFA, CAPTCHA, or developer-access prerequisites, pause the same run for the member. Ask them to complete only that interruption, not to create the application or copy credentials.",
    ]),
    safeLandingUrl: "https://www.strava.com/settings/api",
  }),
  coordinates: STRAVA_MEMBER_OWNED_PROVIDER_SETUP_COORDINATES,
  presentation: STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION,
} as const satisfies MemberOwnedProviderSetupRegistration<"strava">);

const REGISTRATIONS = Object.freeze([STRAVA_REGISTRATION]);
assertRegistrationsMatchConnectCatalog();

export function listMemberOwnedProviderSetupRegistrations(): readonly MemberOwnedProviderSetupRegistration[] {
  return REGISTRATIONS;
}

export function readMemberOwnedProviderSetupRegistration(
  provider: string,
): MemberOwnedProviderSetupRegistration | null {
  if (!isMemberOwnedDeviceProviderApplicationProvider(provider)) {
    return null;
  }
  return REGISTRATIONS.find(
    (registration) => registration.coordinates.provider === provider,
  ) ?? null;
}

export function readMemberOwnedProviderSetupRegistrationByConnectSourceId(
  connectSourceId: string,
): MemberOwnedProviderSetupRegistration | null {
  const normalized = normalizeDeviceConnectSourceId(connectSourceId);
  if (!normalized) {
    return null;
  }
  return REGISTRATIONS.find(
    (registration) => registration.coordinates.connectSourceId === normalized,
  ) ?? null;
}

export function readMemberOwnedProviderSetupRegistrationByConnectTarget(
  connectTarget: string,
): MemberOwnedProviderSetupRegistration | null {
  const normalized = normalizeDeviceSyncConnectTargetKey(connectTarget);
  if (!normalized) {
    return null;
  }
  return REGISTRATIONS.find(
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

export function buildMemberOwnedProviderSetupBrowserContract(input: {
  env?: Readonly<Record<string, string | undefined>>;
  memberId: string;
  provider: MemberOwnedDeviceProviderApplicationProvider;
  registration?: MemberOwnedProviderSetupRegistration;
}): MemberOwnedProviderSetupBrowserContract {
  const registration = input.registration
    ?? requireMemberOwnedProviderSetupRegistration(input.provider);
  if (registration.coordinates.provider !== input.provider) {
    throw new TypeError("Member-owned provider setup metadata does not match its provider.");
  }
  const publicBaseUrl = readHostedDeviceSyncPublicBaseUrl(input.env ?? process.env);
  if (!publicBaseUrl) {
    throw new TypeError("Hosted device-sync public base URL is required for provider setup.");
  }
  const descriptor = listDeviceSyncProviderCatalog().find(
    (candidate) => candidate.provider === input.provider,
  );
  if (!descriptor?.callbackPath || descriptor.defaultScopes.length === 0) {
    throw new TypeError("Provider setup OAuth metadata is incomplete.");
  }
  const marker = buildMemberOwnedProviderApplicationMarker({
    memberId: input.memberId,
    provider: input.provider,
  });
  return {
    application: {
      callbackUrl: new URL(
        descriptor.callbackPath.replace(/^\/+/, ""),
        `${publicBaseUrl.replace(/\/+$/u, "")}/`,
      ).toString(),
      category: registration.browser.applicationCategory,
      marker,
      name: marker,
      readOnlyScopes: descriptor.defaultScopes,
      website: registration.browser.applicationWebsite,
    },
    developerPortalUrl: registration.browser.developerPortalUrl,
    guidance: registration.browser.guidance,
    provider: input.provider,
    providerName: registration.presentation.providerName,
    safeLandingUrl: registration.browser.safeLandingUrl,
  };
}

export function buildMemberOwnedProviderApplicationMarker(input: {
  memberId: string;
  provider: MemberOwnedDeviceProviderApplicationProvider;
}): string {
  const suffix = createHash("sha256")
    .update(`murph.member-owned-provider:${input.provider}:${input.memberId}`, "utf8")
    .digest("hex")
    .slice(0, 12);
  return `Murph Private Sync ${suffix}`;
}

function assertRegistrationsMatchConnectCatalog(): void {
  const targets = listMemberOwnedDeviceSyncConnectTargets();
  if (targets.length !== REGISTRATIONS.length) {
    throw new TypeError(
      "Member-owned provider setup metadata does not match the device connect catalog.",
    );
  }
  for (const registration of REGISTRATIONS) {
    const coordinates = registration.coordinates;
    if (!targets.some(
      (target) => target.connectSourceId === coordinates.connectSourceId
        && target.connectTarget === coordinates.connectTarget
        && target.provider === coordinates.provider
        && (target.sourceProviderSlug ?? null) === coordinates.sourceProviderSlug,
    )) {
      throw new TypeError(
        `Member-owned provider setup metadata for ${coordinates.provider} does not match the device connect catalog.`,
      );
    }
  }
}
