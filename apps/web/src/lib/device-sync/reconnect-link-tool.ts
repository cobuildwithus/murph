import {
  isDeviceConnectSourceAvailableForConnection,
  listConfiguredDeviceSyncReconnectTargets,
  normalizeDeviceConnectSourceId,
  normalizeDeviceSyncConnectTargetKey,
  readConfiguredDeviceSyncConnectTargetConfigs,
  type DeviceSyncConnectTarget,
} from "@murphai/device-syncd/connect-config";

import {
  HOSTED_DEVICE_RECONNECT_NOTICE_INTENT_TTL_MS,
  createHostedDeviceConnectIntentTx,
} from "./connect-intent-core";
import {
  createMemberOwnedProviderSetupService,
  listMemberOwnedProviderSetupRegistrations,
  readMemberOwnedProviderSetupRegistration,
} from "./provider-setup";
import { readHostedPublicBaseUrl } from "../hosted-web/public-url";
import { getPrisma } from "../prisma";

type EnvSource = Readonly<Record<string, string | undefined>>;

export interface HostedDeviceReconnectLinkCliArgs {
  baseUrl: string | null;
  connectSourceId: string | null;
  connectTarget: string | null;
  help: boolean;
  memberId: string | null;
  sourceProviderSlug: string | null;
}

export type HostedDeviceReconnectLinkTargetResult =
  | { status: "found"; target: DeviceSyncConnectTarget }
  | { status: "ambiguous"; matches: DeviceSyncConnectTarget[] }
  | { status: "missing" };

export interface HostedDeviceReconnectLinkResult {
  connectUrl: string;
  expiresAt: string;
  target: DeviceSyncConnectTarget;
}

export function parseHostedDeviceReconnectLinkCliArgs(
  argv: readonly string[],
): HostedDeviceReconnectLinkCliArgs {
  const args: HostedDeviceReconnectLinkCliArgs = {
    baseUrl: null,
    connectSourceId: null,
    connectTarget: null,
    help: false,
    memberId: null,
    sourceProviderSlug: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }

    if (arg === "--") {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }

    const value = argv[index + 1];
    if (value === undefined || value.startsWith("-")) {
      throw new Error(`${arg} requires a value.`);
    }

    switch (arg) {
      case "--base-url":
        args.baseUrl = value;
        break;
      case "--connect-source":
        args.connectSourceId = value;
        break;
      case "--connect-target":
        args.connectTarget = value;
        break;
      case "--member-id":
        args.memberId = value;
        break;
      case "--source-provider-slug":
        args.sourceProviderSlug = value;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }

    index += 1;
  }

  return args;
}

export function resolveHostedDeviceReconnectLinkTarget(
  env: EnvSource,
  input: Pick<
    HostedDeviceReconnectLinkCliArgs,
    "connectSourceId" | "connectTarget" | "sourceProviderSlug"
  >,
): HostedDeviceReconnectLinkTargetResult {
  const connectSourceId = normalizeDeviceConnectSourceId(input.connectSourceId);
  const connectTarget = normalizeDeviceSyncConnectTargetKey(input.connectTarget ?? "");
  const sourceProviderSlug = normalizeDeviceSyncConnectTargetKey(input.sourceProviderSlug ?? "");

  if (!connectSourceId && !connectTarget && !sourceProviderSlug) {
    return { status: "missing" };
  }

  const memberOwnedTargets = listMemberOwnedProviderSetupRegistrations()
    .map((registration) => ({
      ...registration.coordinates,
      label: registration.presentation.providerName,
    }))
    .filter((target) =>
      !sourceProviderSlug
      && (!connectSourceId || target.connectSourceId === connectSourceId)
      && (!connectTarget || target.connectTarget === connectTarget)
    );

  const matches = [
    ...memberOwnedTargets,
    ...listConfiguredDeviceSyncReconnectTargets(
      readConfiguredDeviceSyncConnectTargetConfigs(env),
    ).filter((target) =>
      !readMemberOwnedProviderSetupRegistration(target.provider)
      && isDeviceConnectSourceAvailableForConnection(target.connectSourceId)
      && (!connectSourceId || target.connectSourceId === connectSourceId)
      && (!connectTarget || target.connectTarget === connectTarget)
      && (!sourceProviderSlug || (target.sourceProviderSlug ?? null) === sourceProviderSlug)
    ),
  ];
  const firstMatch = matches[0];

  if (matches.length === 1 && firstMatch) {
    return {
      status: "found",
      target: firstMatch,
    };
  }

  if (matches.length > 1) {
    return {
      status: "ambiguous",
      matches,
    };
  }

  return { status: "missing" };
}

export async function createHostedDeviceReconnectLink(input: {
  args: HostedDeviceReconnectLinkCliArgs;
  env?: EnvSource;
  now?: Date;
}): Promise<HostedDeviceReconnectLinkResult> {
  const env = input.env ?? process.env;
  const memberId = input.args.memberId?.trim() ?? "";
  if (!memberId) {
    throw new Error("--member-id is required.");
  }

  const targetResult = resolveHostedDeviceReconnectLinkTarget(env, input.args);
  if (targetResult.status === "missing") {
    throw new Error(
      "No configured reconnect target matched. Pass --source-provider-slug for Junction-backed sources.",
    );
  }

  if (targetResult.status === "ambiguous") {
    throw new Error(
      `Reconnect target is ambiguous (${targetResult.matches.length} matches). Pass --source-provider-slug to choose the Junction source.`,
    );
  }

  const request = new Request(resolveHostedDeviceReconnectLinkBaseUrl(env, input.args.baseUrl));
  const setupRegistration = readMemberOwnedProviderSetupRegistration(
    targetResult.target.provider,
  );
  const setup = setupRegistration
    ? await createMemberOwnedProviderSetupService(
        setupRegistration.coordinates.provider,
      ).ensure(memberId)
    : null;
  const intent = await getPrisma().$transaction((tx) =>
    createHostedDeviceConnectIntentTx({
      connectSourceId: targetResult.target.connectSourceId,
      connectTarget: targetResult.target.connectTarget,
      ...(setup
        ? {
            providerSetupId: setup.id,
          }
        : {}),
      memberId,
      now: input.now,
      provider: targetResult.target.provider,
      request,
      sourceProviderSlug: targetResult.target.sourceProviderSlug ?? null,
      ttlMs: HOSTED_DEVICE_RECONNECT_NOTICE_INTENT_TTL_MS,
      tx,
    })
  );

  return {
    connectUrl: intent.connectUrl,
    expiresAt: intent.expiresAt,
    target: targetResult.target,
  };
}

export function resolveHostedDeviceReconnectLinkBaseUrl(
  env: EnvSource,
  explicitBaseUrl: string | null,
): string {
  const configuredBaseUrl = explicitBaseUrl?.trim()
    ? normalizeBaseUrl(explicitBaseUrl)
    : readHostedPublicBaseUrl(env);

  if (!configuredBaseUrl) {
    throw new Error(
      "A hosted public base URL is required. Set HOSTED_WEB_BASE_URL or pass --base-url.",
    );
  }

  return configuredBaseUrl;
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  return url.origin;
}
