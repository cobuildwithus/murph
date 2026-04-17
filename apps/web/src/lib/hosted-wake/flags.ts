import type { HostedExecutionDispatchRequest } from "@murphai/hosted-execution/contracts";

type EnvSource = Readonly<Record<string, string | undefined>>;

export interface HostedWakeProducerRouting {
  deviceSyncWakeEnabled: boolean;
  linqMessageReceivedEnabled: boolean;
  memberActivatedEnabled: boolean;
  memberChannelsUpdatedEnabled: boolean;
  telegramMessageReceivedEnabled: boolean;
  vaultShareAcceptedEnabled: boolean;
}

export function readHostedWakeProducerRouting(
  source: EnvSource = process.env,
): HostedWakeProducerRouting {
  return {
    deviceSyncWakeEnabled: parseBooleanFlag(
      source.HOSTED_WAKE_DEVICE_SYNC_WAKE_ENABLED,
      "HOSTED_WAKE_DEVICE_SYNC_WAKE_ENABLED",
    ),
    linqMessageReceivedEnabled: parseBooleanFlag(
      source.HOSTED_WAKE_LINQ_MESSAGE_RECEIVED_ENABLED,
      "HOSTED_WAKE_LINQ_MESSAGE_RECEIVED_ENABLED",
    ),
    memberActivatedEnabled: parseBooleanFlag(
      source.HOSTED_WAKE_MEMBER_ACTIVATED_ENABLED,
      "HOSTED_WAKE_MEMBER_ACTIVATED_ENABLED",
    ),
    memberChannelsUpdatedEnabled: parseBooleanFlag(
      source.HOSTED_WAKE_MEMBER_CHANNELS_UPDATED_ENABLED,
      "HOSTED_WAKE_MEMBER_CHANNELS_UPDATED_ENABLED",
    ),
    telegramMessageReceivedEnabled: parseBooleanFlag(
      source.HOSTED_WAKE_TELEGRAM_MESSAGE_RECEIVED_ENABLED,
      "HOSTED_WAKE_TELEGRAM_MESSAGE_RECEIVED_ENABLED",
    ),
    vaultShareAcceptedEnabled: parseBooleanFlag(
      source.HOSTED_WAKE_VAULT_SHARE_ACCEPTED_ENABLED,
      "HOSTED_WAKE_VAULT_SHARE_ACCEPTED_ENABLED",
    ),
  };
}

export function shouldRouteHostedDispatchToWake(
  dispatch: HostedExecutionDispatchRequest,
  source: EnvSource = process.env,
): boolean {
  const routing = readHostedWakeProducerRouting(source);

  switch (dispatch.event.kind) {
    case "device-sync.wake":
      return routing.deviceSyncWakeEnabled;
    case "linq.message.received":
      return routing.linqMessageReceivedEnabled;
    case "member.activated":
      return routing.memberActivatedEnabled;
    case "member.channels.updated":
      return routing.memberChannelsUpdatedEnabled;
    case "telegram.message.received":
      return routing.telegramMessageReceivedEnabled;
    case "vault.share.accepted":
      return routing.vaultShareAcceptedEnabled;
    default:
      return false;
  }
}

function parseBooleanFlag(value: string | undefined, label: string): boolean {
  const normalized = value?.trim().toLowerCase();

  switch (normalized) {
    case undefined:
    case "":
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    default:
      throw new TypeError(`${label} must be a boolean-like flag.`);
  }
}
