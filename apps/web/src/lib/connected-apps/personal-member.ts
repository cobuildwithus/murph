import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { isHostedThreadContainerMember } from "@/src/lib/hosted-onboarding/member-access";

export function personalConnectedAppsMemberRequired() {
  return hostedOnboardingError({
    code: "CONNECTED_APPS_PERSONAL_MEMBER_REQUIRED",
    httpStatus: 403,
    message: "Personal connected apps are unavailable in a group chat.",
  });
}

export async function requirePersonalConnectedAppsMember(memberId: string) {
  if (await isHostedThreadContainerMember({ memberId })) throw personalConnectedAppsMemberRequired();
}
