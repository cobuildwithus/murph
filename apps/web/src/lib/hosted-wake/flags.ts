import type { HostedExecutionDispatchRequest } from "@murphai/hosted-execution/contracts";

type EnvSource = Readonly<Record<string, string | undefined>>;

export interface HostedWakeSimpleProducerRouting {
  memberActivatedEnabled: boolean;
  memberChannelsUpdatedEnabled: boolean;
}

export function readHostedWakeSimpleProducerRouting(
  source: EnvSource = process.env,
): HostedWakeSimpleProducerRouting {
  return {
    memberActivatedEnabled: parseBooleanFlag(
      source.HOSTED_WAKE_MEMBER_ACTIVATED_ENABLED,
      "HOSTED_WAKE_MEMBER_ACTIVATED_ENABLED",
    ),
    memberChannelsUpdatedEnabled: parseBooleanFlag(
      source.HOSTED_WAKE_MEMBER_CHANNELS_UPDATED_ENABLED,
      "HOSTED_WAKE_MEMBER_CHANNELS_UPDATED_ENABLED",
    ),
  };
}

export function shouldRouteHostedSimpleProducerDispatchToWake(
  dispatch: HostedExecutionDispatchRequest,
  source: EnvSource = process.env,
): boolean {
  const routing = readHostedWakeSimpleProducerRouting(source);

  switch (dispatch.event.kind) {
    case "member.activated":
      return routing.memberActivatedEnabled;
    case "member.channels.updated":
      return routing.memberChannelsUpdatedEnabled;
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
