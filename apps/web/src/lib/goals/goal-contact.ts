import type { HeroContactInfo } from "@/src/lib/hero-contact-info";
import {
  resolveMurphContactOptions,
  type MurphContactOption,
  withMurphContactOptionBody,
} from "@/src/lib/murph-contact-routing";

export function resolvePublicGoalContactOptions(input: {
  contactInfo: HeroContactInfo;
  startPrompt: string;
}): MurphContactOption[] {
  const startPrompt = input.startPrompt
    || "Hey Murph, help me with this goal.";

  return resolveMurphContactOptions({
    contactChannels: {
      email: false,
      telegram: true,
      text: input.contactInfo.phoneConfigured,
    },
    message: {
      body: startPrompt,
      subject: "Help me with this goal",
    },
    murphPhoneNumber: input.contactInfo.phone,
    preferredKind: "text",
  });
}

export function withPublicGoalContactDraft(
  option: MurphContactOption,
  draft: string,
): MurphContactOption {
  if (option.kind !== "text") {
    return withMurphContactOptionBody(option, draft);
  }

  const queryIndex = option.href.indexOf("?");
  const smsTarget = queryIndex === -1
    ? option.href
    : option.href.slice(0, queryIndex);
  return {
    ...option,
    href: `${smsTarget}?body=${encodeURIComponent(draft)}`,
  };
}
