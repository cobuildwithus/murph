import type { HeroContactInfo } from "@/src/lib/hero-contact-info";
import {
  resolveMurphContactOptions,
  type MurphContactOption,
} from "@/src/lib/murph-contact-routing";

export function resolvePublicGoalContactOptions(input: {
  contactInfo: HeroContactInfo;
  startPrompt: string;
}): MurphContactOption[] {
  const startPrompt = input.startPrompt.trim() || "Hey Murph, help me with this goal.";

  return resolveMurphContactOptions({
    contactChannels: {
      email: true,
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
