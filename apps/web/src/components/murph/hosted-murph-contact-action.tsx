import "server-only";

import {
  getHostedMurphContactContext,
} from "@/src/lib/hosted-onboarding/hosted-contact-context";
import {
  resolveMurphContactOptions,
  type MurphContactMessage,
  type MurphContactOption,
} from "@/src/lib/murph-contact-routing";

export async function resolveHostedMurphContactOptions({
  message = null,
}: {
  message?: MurphContactMessage | null;
} = {}): Promise<MurphContactOption[]> {
  const { initialContactChannels, murphEmailAddress, murphPhoneNumber } =
    await getHostedMurphContactContext();

  return resolveMurphContactOptions({
    contactChannels: initialContactChannels,
    message,
    murphEmailAddress,
    murphPhoneNumber,
  });
}

export async function resolveHostedMurphContactOption({
  message = null,
}: {
  message?: MurphContactMessage | null;
} = {}): Promise<MurphContactOption | null> {
  const options = await resolveHostedMurphContactOptions({ message });
  return options[0] ?? null;
}
