import type {
  HostedAssistantRuntimeChannelCapabilities,
  HostedAssistantRuntimeManagedAutoReplyChannel,
} from "./models.ts";

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
