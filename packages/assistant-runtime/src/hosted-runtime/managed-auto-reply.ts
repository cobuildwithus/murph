import type {
  HostedAssistantRuntimeChannelCapabilities,
  HostedAssistantRuntimeManagedAutoReplyChannel,
} from "./models.ts";

// Channels whose Web-admitted inbound messages prove member consent, so a
// message arriving on them may self-heal the auto-reply channel state. Their
// routes exist only for linked members or validated hosted thread containers.
export const HOSTED_INBOUND_SELF_HEAL_AUTO_REPLY_CHANNELS: ReadonlySet<string> =
  new Set(["email", "linq", "telegram"]);

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
