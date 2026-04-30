import "server-only";

import {
  getHostedMurphContactContext,
} from "@/src/lib/hosted-onboarding/hosted-contact-context";
import {
  resolvePreferredMurphContactOption,
  type MurphContactMessage,
  type MurphContactOption,
} from "@/src/lib/murph-contact-routing";

export async function resolveHostedMurphContactOption({
  message = null,
}: {
  message?: MurphContactMessage | null;
} = {}): Promise<MurphContactOption | null> {
  const { initialContactChannels, murphPhoneNumber } =
    await getHostedMurphContactContext();

  return resolvePreferredMurphContactOption({
    contactChannels: initialContactChannels,
    message,
    murphPhoneNumber,
  });
}
