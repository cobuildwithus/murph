import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import {
  buildMurphHostedLinqContactCardVcf,
  fetchMurphHostedLinqContactCardVcfPhoto,
  MURPH_CONTACT_CARD_VCF_CONTENT_TYPE,
  MURPH_CONTACT_CARD_VCF_FILE_NAME,
  resolveMurphContactCardAssetUrl,
  resolveMurphHostedLinqContactCardBackupPhoneNumber,
} from "@/src/lib/hosted-onboarding/linq-contact-card";
import { readHostedMemberRoutingState } from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import { requireActivePrivyMemberAuth } from "@/src/lib/hosted-onboarding/request-auth";
import {
  DEFAULT_MURPH_CONTACT_AVATAR_ID,
  findMurphContactAvatarOption,
} from "@/src/lib/murph-contact-avatars";
import { getPrisma } from "@/src/lib/prisma";

/**
 * Downloadable Murph vCard with the member-chosen avatar embedded as the
 * `PHOTO`. The card carries the member's own conversation line as `mobile`
 * plus a second healthy pool line under the `backup` label, mirroring the
 * group-chat contact-card share. Unknown avatar ids fall back to the default
 * headshot; the no-photo option omits `PHOTO` entirely.
 */
export const GET = withJsonError(async (request: Request) => {
  const auth = await requireActivePrivyMemberAuth(request);
  const prisma = getPrisma();

  const routing = await readHostedMemberRoutingState({
    memberId: auth.member.id,
    prisma,
  });
  const phoneNumber = routing?.linqRecipientPhone ?? null;
  if (!phoneNumber) {
    throw hostedOnboardingError({
      code: "MURPH_TEXT_LINE_NOT_READY",
      message: "Your Murph text line is not set up yet, so there is no contact card to download.",
      httpStatus: 409,
      retryable: true,
    });
  }

  const avatarId = new URL(request.url).searchParams.get("avatar")
    ?? DEFAULT_MURPH_CONTACT_AVATAR_ID;
  const avatar = findMurphContactAvatarOption(avatarId);

  const [photo, backupPhoneNumber] = await Promise.all([
    avatar.src
      ? fetchMurphHostedLinqContactCardVcfPhoto({
          imageUrl: resolveMurphContactCardAssetUrl(avatar.src),
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
