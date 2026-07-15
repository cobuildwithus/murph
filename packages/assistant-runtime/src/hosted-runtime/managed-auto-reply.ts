import type {
  HostedAssistantRuntimeChannelCapabilities,
  HostedAssistantRuntimeManagedAutoReplyChannel,
} from "./models.ts";

// Channels whose inbound conversation messages prove member consent, so a
// message arriving on them may self-heal the auto-reply channel state: Linq
// routing and signed email reply aliases only exist for members who linked or
// authorized the channel.
export const HOSTED_INBOUND_SELF_HEAL_AUTO_REPLY_CHANNELS: ReadonlySet<string> =
  new Set(["email", "linq"]);

export function createDefaultHostedManagedAutoReplyChannels(
  channelCapabilities: HostedAssistantRuntimeChannelCapabilities,
): HostedAssistantRuntimeManagedAutoReplyChannel[] {
  return [
    {
      capabilityReady: channelCapabilities.emailSendReady,
      channel: "email",
      memberChannel: "email",
    },
    {
      capabilityReady: true,
      channel: "linq",
      memberChannel: "linq",
    },
    {
      capabilityReady: channelCapabilities.telegramBotConfigured,
      channel: "telegram",
      memberChannel: "telegram",
    },
  ];
}
