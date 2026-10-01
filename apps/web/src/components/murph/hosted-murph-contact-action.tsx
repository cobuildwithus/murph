import "server-only";

import { MurphChatAction, type MurphChatActionProps } from "./murph-chat-action";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";

import {
  getHostedMurphContactContext,
} from "@/src/lib/hosted-onboarding/hosted-contact-context";
import {
  resolveMurphContactOptions,
  type MurphContactKind,
  type MurphContactMessage,
  type MurphContactOption,
} from "@/src/lib/murph-contact-routing";

interface ResolveHostedMurphContactOptionsInput {
  message?: MurphContactMessage | null;
  preferredKind?: MurphContactKind | null;
}

export async function resolveHostedMurphContactOptions({
  message = null,
  preferredKind = null,
}: ResolveHostedMurphContactOptionsInput = {}): Promise<MurphContactOption[]> {
  const { initialContactChannels, murphEmailAddress, murphPhoneNumber } =
    await getHostedMurphContactContext();

  return resolveMurphContactOptions({
    contactChannels: initialContactChannels,
    message,
    murphEmailAddress,
    murphPhoneNumber,
    preferredKind,
  });
}

export async function resolveHostedMurphContactOption({
  message = null,
  preferredKind = null,
}: ResolveHostedMurphContactOptionsInput = {}): Promise<MurphContactOption | null> {
  const options = await resolveHostedMurphContactOptions({ message, preferredKind });
  return options[0] ?? null;
}

export async function HostedMurphChatAction(props: Omit<MurphChatActionProps, "options" | "authenticated"> = {}) {
  const options = await resolveHostedMurphContactOptions();
  const authenticated = options.length === 0
    ? (await getHostedPageAuthSnapshot()).authenticated
    : true;

  return <MurphChatAction {...props} options={options} authenticated={authenticated} />;
}
