import {
  resolveMurphContactOptions,
  type MurphContactOption,
} from "@/src/lib/murph-contact-routing";

export function resolveGoalContactOption(input: {
  murphPhoneNumber: string | null;
  startPrompt: string;
  textAvailable: boolean;
}): MurphContactOption {
  const startPrompt = input.startPrompt
    || "Hey Murph, help me with this goal.";

  const [option] = resolveMurphContactOptions({
    contactChannels: {
      email: false,
      telegram: true,
      text: input.textAvailable,
    },
    message: {
      body: startPrompt,
      subject: "Help me with this goal",
    },
    murphPhoneNumber: input.murphPhoneNumber,
    preferredKind: "text",
  });

  if (!option) {
    throw new Error("Goal contact routing did not produce a messaging option.");
  }

  return option;
}
