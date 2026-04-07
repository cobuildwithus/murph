import {
  type HostedExecutionDispatchRequest,
} from "@murphai/hosted-execution";

import {
  fetchHostedExecutionWebControlPlaneResponse,
  normalizeHostedWebControlBaseUrl,
} from "../web-control-plane.ts";
import {
  CLOUDFLARE_HOSTED_SHARE_IMPORT_COMPLETE_PATH,
  CLOUDFLARE_HOSTED_SHARE_IMPORT_RELEASE_PATH,
} from "../outbound-routes.ts";

export async function applyHostedWebBusinessOutcomeIfNeeded(input: {
  callbackSigning: import("../web-callback-auth.ts").HostedWebCallbackSigningEnvironment;
  dispatch: HostedExecutionDispatchRequest;
  env: Readonly<Record<string, string | undefined>>;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  if (input.dispatch.event.kind !== "vault.share.accepted") {
    return;
  }

  const baseUrl = normalizeHostedWebControlBaseUrl(input.env.HOSTED_WEB_BASE_URL);

  if (!baseUrl) {
    throw new Error("HOSTED_WEB_BASE_URL must be configured for hosted web business outcome callbacks.");
  }

  const response = await fetchHostedExecutionWebControlPlaneResponse({
    baseUrl,
    body: JSON.stringify({
      eventId: input.dispatch.eventId,
      shareId: input.dispatch.event.share.shareId,
    }),
    boundUserId: input.dispatch.event.userId,
    callbackSigning: input.callbackSigning,
    fetchImpl: input.fetchImpl,
    method: "POST",
    path: CLOUDFLARE_HOSTED_SHARE_IMPORT_COMPLETE_PATH,
    timeoutMs: null,
  });

  if (response.ok) {
    return;
  }

  const responseText = await response.text();
  throw new Error(
    `Hosted web business outcome callback failed for ${input.dispatch.event.userId}/${input.dispatch.eventId} with HTTP ${response.status}${formatResponseSuffix(responseText)}.`,
  );
}

export async function releaseHostedWebShareClaim(input: {
  callbackSigning: import("../web-callback-auth.ts").HostedWebCallbackSigningEnvironment;
  dispatch: HostedExecutionDispatchRequest;
  env: Readonly<Record<string, string | undefined>>;
  fetchImpl?: typeof fetch;
  reason?: string | null;
}): Promise<void> {
  if (input.dispatch.event.kind !== "vault.share.accepted") {
    return;
  }

  const baseUrl = normalizeHostedWebControlBaseUrl(input.env.HOSTED_WEB_BASE_URL);

  if (!baseUrl) {
    throw new Error("HOSTED_WEB_BASE_URL must be configured for hosted web business outcome callbacks.");
  }

  const response = await fetchHostedExecutionWebControlPlaneResponse({
    baseUrl,
    body: JSON.stringify({
      eventId: input.dispatch.eventId,
      ...(input.reason ? { reason: input.reason } : {}),
      shareId: input.dispatch.event.share.shareId,
    }),
    boundUserId: input.dispatch.event.userId,
    callbackSigning: input.callbackSigning,
    fetchImpl: input.fetchImpl,
    method: "POST",
    path: CLOUDFLARE_HOSTED_SHARE_IMPORT_RELEASE_PATH,
    timeoutMs: null,
  });

  if (response.ok) {
    return;
  }

  const responseText = await response.text();
  throw new Error(
    `Hosted web share-claim release callback failed for ${input.dispatch.event.userId}/${input.dispatch.eventId} with HTTP ${response.status}${formatResponseSuffix(responseText)}.`,
  );
}

function formatResponseSuffix(value: string): string {
  const normalized = value.trim();
  return normalized.length > 0 ? `: ${normalized.slice(0, 500)}` : "";
}
