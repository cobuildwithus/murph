import { requireActiveHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import {
  issueMurphContactCardHandoffClaim,
  MURPH_CONTACT_CARD_NATIVE_COMPANION_SESSION_ID,
  requireMurphContactCardHandoffClaim,
} from "@/src/lib/hosted-onboarding/contact-card-handoff";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import {
  hostedOnboardingError,
  isHostedOnboardingError,
} from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  readJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import {
  buildMurphHostedLinqContactCardVcf,
  fetchMurphHostedLinqContactCardVcfPhoto,
  MURPH_CONTACT_CARD_VCF_CONTENT_TYPE,
  MURPH_CONTACT_CARD_VCF_FILE_NAME,
  resolveMurphContactCardAssetUrl,
  resolveMurphHostedLinqContactCardBackupPhoneNumber,
} from "@/src/lib/hosted-onboarding/linq-contact-card";
import { readHostedMemberRoutingState } from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import {
  sanitizeHostedOnboardingStructuredLogDetails,
  toHostedOnboardingLogIdSuffix,
} from "@/src/lib/hosted-onboarding/logging";
import {
  assertActiveHostedMemberAccessAllowed,
  assertHostedCompanionMemberAccessAllowed,
} from "@/src/lib/hosted-onboarding/member-access";
import { detectInAppBrowser } from "@/src/lib/in-app-browser";
import {
  DEFAULT_MURPH_CONTACT_AVATAR_ID,
  findMurphContactAvatarOption,
  type MurphContactAvatarOption,
} from "@/src/lib/murph-contact-avatars";
import { getPrisma } from "@/src/lib/prisma";

const MURPH_CONTACT_CARD_HANDOFF_BODY_LIMIT_BYTES = 512;

type MurphContactCardAuthoritySource = "handoff" | "session";

interface MurphContactCardAuthority {
  avatar: MurphContactAvatarOption;
  memberId: string;
  source: MurphContactCardAuthoritySource;
}

/**
 * Downloadable Murph vCard with the member-chosen avatar embedded as the
 * `PHOTO`. The card carries the member's own conversation line as `mobile`
 * plus a second healthy pool line under the `backup` label, mirroring the
 * group-chat contact-card share. Unknown avatar ids fall back to the default
 * headshot; the no-photo option omits `PHOTO` entirely.
 */
export const GET = withJsonError(async (request: Request) => {
  const url = new URL(request.url);
  const browser = detectInAppBrowser(request.headers.get("user-agent") ?? "");
  const source: MurphContactCardAuthoritySource =
    url.searchParams.has("handoff") ? "handoff" : "session";

  let authority: MurphContactCardAuthority;
  try {
    authority = await requireMurphContactCardAuthority({ request, url });
  } catch (error) {
    logMurphContactCardRequest({
      app: browser.app,
      authOutcome: "rejected",
      avatarId: source === "session"
        ? resolveRequestedAvatar(url).id
        : null,
      errorCode: classifyMurphContactCardAuthorizationError(error),
      memberId: null,
      source,
      webview: browser.inAppBrowser,
    });
    throw error;
  }

  logMurphContactCardRequest({
    app: browser.app,
    authOutcome: "authorized",
    avatarId: authority.avatar.id,
    errorCode: null,
    memberId: authority.memberId,
    source: authority.source,
    webview: browser.inAppBrowser,
  });

  const prisma = getPrisma();
  const routing = await readHostedMemberRoutingState({
    memberId: authority.memberId,
    prisma,
  });
  // Same phone authority as the invite/home surfaces that show the CTA: a
  // freshly signed-up member may only have a pending line committed yet.
  const phoneNumber = routing?.linqRecipientPhone
    ?? routing?.pendingLinqRecipientPhone
    ?? null;
  if (!phoneNumber) {
    throw hostedOnboardingError({
      code: "MURPH_TEXT_LINE_NOT_READY",
      message: "Your Murph text line is not set up yet, so there is no contact card to download.",
      httpStatus: 409,
      retryable: true,
    });
  }

  const [photo, backupPhoneNumber] = await Promise.all([
    authority.avatar.src
      ? fetchMurphHostedLinqContactCardVcfPhoto({
          imageUrl: resolveMurphContactCardAssetUrl(authority.avatar.src),
        })
      : Promise.resolve(null),
    resolveMurphHostedLinqContactCardBackupPhoneNumber({
      excludePhoneNumber: phoneNumber,
      prisma,
    }),
  ]);

  const vcf = buildMurphHostedLinqContactCardVcf({
    backupPhoneNumber,
    phoneNumber,
    photo,
  });

  // `inline` so iOS Safari opens its native contact preview (Add to
  // Contacts) directly instead of routing through the Downloads manager;
  // Android Chrome and desktop browsers download the file either way and
  // use the filename parameter.
  return new Response(vcf, {
    headers: {
      "cache-control": "no-store",
      "content-disposition": `inline; filename="${MURPH_CONTACT_CARD_VCF_FILE_NAME}"`,
      "content-type": MURPH_CONTACT_CARD_VCF_CONTENT_TYPE,
    },
  });
});

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const session = await requireActiveHostedAppSessionFromRequest(request);
  const payload = await readJsonObject(request, {
    limitBytes: MURPH_CONTACT_CARD_HANDOFF_BODY_LIMIT_BYTES,
  });
  const avatarId = requireRequestedHandoffAvatarId(payload.avatar);

  return jsonOk({
    claim: issueMurphContactCardHandoffClaim({
      avatarId,
      memberId: session.member.id,
      sessionId: session.sessionId,
    }),
  });
});

async function requireMurphContactCardAuthority(input: {
  request: Request;
  url: URL;
}): Promise<MurphContactCardAuthority> {
  const handoff = input.url.searchParams.get("handoff");
  if (handoff !== null) {
    const claim = requireMurphContactCardHandoffClaim(handoff);
    if (claim.sessionId === MURPH_CONTACT_CARD_NATIVE_COMPANION_SESSION_ID) {
      await assertHostedCompanionMemberAccessAllowed({ memberId: claim.memberId });
    } else {
      await assertActiveHostedMemberAccessAllowed({ memberId: claim.memberId });
    }
    return {
      avatar: findMurphContactAvatarOption(claim.avatarId),
      memberId: claim.memberId,
      source: "handoff",
    };
  }

  const session = await requireActiveHostedAppSessionFromRequest(input.request);
  return {
    avatar: resolveRequestedAvatar(input.url),
    memberId: session.member.id,
    source: "session",
  };
}

function resolveRequestedAvatar(url: URL): MurphContactAvatarOption {
  return findMurphContactAvatarOption(
    url.searchParams.get("avatar") ?? DEFAULT_MURPH_CONTACT_AVATAR_ID,
  );
}

function requireRequestedHandoffAvatarId(value: unknown): string {
  if (typeof value !== "string") {
    throw invalidHandoffAvatarError();
  }

  const avatar = findMurphContactAvatarOption(value);
  if (avatar.id !== value) {
    throw invalidHandoffAvatarError();
  }

  return avatar.id;
}

function invalidHandoffAvatarError(): Error {
  return hostedOnboardingError({
    code: "MURPH_CONTACT_CARD_AVATAR_INVALID",
    httpStatus: 400,
    message: "Choose a valid Murph contact photo.",
  });
}

function classifyMurphContactCardAuthorizationError(error: unknown): string {
  if (isHostedOnboardingError(error)) {
    return error.code;
  }

  return error instanceof Error && error.name
    ? error.name
    : "UNKNOWN_ERROR";
}

function logMurphContactCardRequest(details: {
  app: string | null;
  authOutcome: "authorized" | "rejected";
  avatarId: string | null;
  errorCode: string | null;
  memberId: string | null;
  source: MurphContactCardAuthoritySource;
  webview: boolean;
}): void {
  console.info("Hosted Murph contact-card request.", {
    app: details.app,
    ...sanitizeHostedOnboardingStructuredLogDetails({
      authOutcome: details.authOutcome,
      authority: details.source,
      avatarId: details.avatarId,
      errorCode: details.errorCode,
      memberIdSuffix: toHostedOnboardingLogIdSuffix(details.memberId),
      webview: details.webview,
    }),
  });
}
