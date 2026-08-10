import {
  issueMurphContactCardHandoffClaim,
  MURPH_CONTACT_CARD_NATIVE_COMPANION_SESSION_ID,
} from "@/src/lib/hosted-onboarding/contact-card-handoff";
import { hostedOnboardingError } from
  "@/src/lib/hosted-onboarding/errors";
import {
  requireHostedCompanionMemberAuthFromBearerToken,
} from "@/src/lib/hosted-onboarding/request-auth";
import {
  jsonOk,
  withJsonError,
} from "@/src/lib/device-sync/settings-http";
import { readJsonObject } from "@/src/lib/http";
import { resolveHostedPublicBaseUrl } from "@/src/lib/hosted-web/public-url";
import {
  findMurphContactAvatarOption,
} from "@/src/lib/murph-contact-avatars";
import { getPrisma } from "@/src/lib/prisma";

const CONTACT_CARD_BODY_LIMIT_BYTES = 512;
const CONTACT_CARD_REQUEST_FIELDS = new Set(["avatarId"]);

export const POST = withJsonError(async (request: Request) => {
  const prisma = getPrisma();
  const auth = await requireHostedCompanionMemberAuthFromBearerToken(request, prisma);
  const body = await readJsonObject(request, {
    limitBytes: CONTACT_CARD_BODY_LIMIT_BYTES,
  });
  if (Object.keys(body).some((key) => !CONTACT_CARD_REQUEST_FIELDS.has(key))) {
    throw invalidAvatarError();
  }
  const avatarId = requireAvatarId(body.avatarId);
  const handoff = issueMurphContactCardHandoffClaim({
    avatarId,
    memberId: auth.member.id,
    sessionId: MURPH_CONTACT_CARD_NATIVE_COMPANION_SESSION_ID,
  });
  const url = new URL(
    "/api/murph-contact-card",
    resolveHostedPublicBaseUrl() ?? request.url,
  );
  url.searchParams.set("handoff", handoff);

  return jsonOk({ url: url.toString() });
});

function requireAvatarId(value: unknown): string {
  if (typeof value !== "string") {
    throw invalidAvatarError();
  }
  const avatar = findMurphContactAvatarOption(value);
  if (avatar.id !== value) {
    throw invalidAvatarError();
  }
  return avatar.id;
}

function invalidAvatarError(): Error {
  return hostedOnboardingError({
    code: "MURPH_CONTACT_CARD_AVATAR_INVALID",
    httpStatus: 400,
    message: "Choose a valid Murph contact photo.",
  });
}
