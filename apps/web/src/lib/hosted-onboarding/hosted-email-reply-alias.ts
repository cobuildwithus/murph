import "server-only";

import {
  createHostedEmailReplyAliasRoute,
  createHostedEmailUserReplyAliasRoute,
  normalizeHostedEmailReplyAliasLookupKey,
} from "@murphai/hosted-execution/hosted-email";

type HostedEmailReplyAliasEnvSource = Readonly<Record<string, string | undefined>>;

export interface HostedMemberReplyAliasRoute {
  address: string;
  replyAliasLookupKey: string;
}

export async function createHostedMemberReplyAliasRoute(input: {
  generation?: number;
  memberId: string;
  source?: HostedEmailReplyAliasEnvSource;
}): Promise<HostedMemberReplyAliasRoute | null> {
  const config = readHostedMemberReplyAliasConfig(input.source);
  if (!config) {
    return null;
  }

  const route = await createHostedEmailUserReplyAliasRoute({
    domain: config.domain,
    generation: input.generation,
    localPart: config.localPart,
    signingSecret: config.signingSecret,
    userId: input.memberId,
  });

  return {
    address: route.address,
    replyAliasLookupKey: route.aliasKey,
  };
}

export async function createHostedMemberReplyAliasRouteFromLookupKey(input: {
  replyAliasLookupKey: string | null | undefined;
  source?: HostedEmailReplyAliasEnvSource;
}): Promise<HostedMemberReplyAliasRoute | null> {
  const config = readHostedMemberReplyAliasConfig(input.source);
  const replyAliasLookupKey = normalizeHostedEmailReplyAliasLookupKey(
    input.replyAliasLookupKey,
  );
  if (!config || !replyAliasLookupKey) {
    return null;
  }

  const route = await createHostedEmailReplyAliasRoute({
    aliasKey: replyAliasLookupKey,
    domain: config.domain,
    localPart: config.localPart,
    signingSecret: config.signingSecret,
  });

  return {
    address: route.address,
    replyAliasLookupKey: route.aliasKey,
  };
}

export function readHostedMemberReplyAliasSigningSecret(
  source: HostedEmailReplyAliasEnvSource = process.env,
): string | null {
  return readHostedMemberReplyAliasConfig(source)?.signingSecret ?? null;
}

function readHostedMemberReplyAliasConfig(
  source: HostedEmailReplyAliasEnvSource = process.env,
) {
  const domain = normalizeHostedEmailReplyAliasConfigString(source.HOSTED_EMAIL_DOMAIN)?.toLowerCase() ?? null;
  const signingSecret = normalizeHostedEmailReplyAliasConfigString(source.HOSTED_EMAIL_SIGNING_SECRET);
  if (!domain || !signingSecret) {
    return null;
  }

  return {
    domain,
    localPart: normalizeHostedEmailReplyAliasConfigString(source.HOSTED_EMAIL_LOCAL_PART)?.toLowerCase()
      ?? "assistant",
    signingSecret,
  };
}

function normalizeHostedEmailReplyAliasConfigString(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}
