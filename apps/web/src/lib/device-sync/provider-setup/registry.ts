import "server-only";

import {
  listMemberOwnedDeviceSyncConnectTargets,
  normalizeDeviceConnectSourceId,
  normalizeDeviceSyncConnectTargetKey,
} from "@murphai/device-syncd/connect-config";
import { listDeviceSyncProviderCatalog } from "@murphai/device-syncd/config";

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
  trustedAuthority: {
    clientIdSelector: string;
    clientSecretSelector: string;
    credentialsPageUrl: string;
    revealSecretSelector: string | null;
  };
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
    readOnlyScopes: readonly string[];
    website: string;
  };
  credentialsPageUrl: string;
  developerPortalUrl: string;
  guidance: readonly string[];
  provider: TProvider;
  providerName: string;
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
      "Use ordinary computer-use browsing to create one private application with the supplied website, category, callback URL, and read-only scopes. Fill the entire creation form yourself, including any application name you choose, and submit it.",
      "Strava permits one application per account. If creation reports an existing application or another on-page error, recover from the visible page as a person would and continue to the registered credentials page.",
      "When the credentials page is available, confirm that the client ID and client secret elements are present without reading, copying, or transcribing either value, then call provider_setup capture once. The trusted capture action navigates to that page, reveals the secret if needed, seals both values, and returns no credentials.",
      "For sign-in, MFA, CAPTCHA, or developer-access prerequisites, pause the same run for the member. Ask them to complete only that interruption; never ask them for provider credentials.",
    ]),
    trustedAuthority: Object.freeze({
      clientIdSelector: "[data-strava-client-id]",
      clientSecretSelector: "[data-strava-client-secret]",
      credentialsPageUrl: "https://www.strava.com/settings/api",
      revealSecretSelector: "[data-strava-client-secret-reveal]",
    }),
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
  return {
    application: {
      callbackUrl: new URL(
        descriptor.callbackPath.replace(/^\/+/, ""),
        `${publicBaseUrl.replace(/\/+$/u, "")}/`,
      ).toString(),
      category: registration.browser.applicationCategory,
      readOnlyScopes: descriptor.defaultScopes,
      website: registration.browser.applicationWebsite,
    },
    credentialsPageUrl:
      registration.browser.trustedAuthority.credentialsPageUrl,
    developerPortalUrl: registration.browser.developerPortalUrl,
    guidance: registration.browser.guidance,
    provider: input.provider,
    providerName: registration.presentation.providerName,
  };
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
    const authority = registration.browser.trustedAuthority;
    const authoritySelectors: string[] = [
      authority.clientIdSelector,
      authority.clientSecretSelector,
      ...(authority.revealSecretSelector === null
        ? []
        : [authority.revealSecretSelector]),
    ];
    if (
      authoritySelectors.some((selector) => selector.trim().length === 0)
      || new Set(authoritySelectors).size !== authoritySelectors.length
    ) {
      throw new TypeError(
        `Member-owned provider setup authority for ${coordinates.provider} must use distinct nonempty selectors.`,
      );
    }
    if (
      !isTrustedProviderBrowserUrl(registration.browser.developerPortalUrl)
      || !isTrustedProviderBrowserUrl(authority.credentialsPageUrl)
    ) {
      throw new TypeError(
        `Member-owned provider setup URLs for ${coordinates.provider} must be absolute HTTPS URLs.`,
      );
    }
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

function isTrustedProviderBrowserUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.username.length === 0
      && url.password.length === 0;
  } catch {
    return false;
  }
}
