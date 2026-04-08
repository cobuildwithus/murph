import {
  type HostedExecutionDispatchRequest,
  normalizeHostedExecutionString,
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
  await applyHostedBusinessOutcomeIfNeeded(input);
}

const DEFAULT_LINQ_API_BASE_URL = "https://api.linqapp.com/api/partner/v3";
const DEFAULT_LINQ_API_TIMEOUT_MS = 10_000;

export async function applyHostedBusinessOutcomeIfNeeded(input: {
  callbackSigning: import("../web-callback-auth.ts").HostedWebCallbackSigningEnvironment;
  dispatch: HostedExecutionDispatchRequest;
  env: Readonly<Record<string, string | undefined>>;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  if (input.dispatch.event.kind === "vault.share.accepted") {
    await completeHostedWebShareImport(input);
    return;
  }

  if (input.dispatch.event.kind === "linq.message.received") {
    await deleteHostedLinqMessageFromSystem(input);
  }
}

async function completeHostedWebShareImport(input: {
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

  throw new Error(
    `Hosted web business outcome callback failed for ${input.dispatch.event.userId}/${input.dispatch.eventId} with HTTP ${response.status}.`,
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

  throw new Error(
    `Hosted web share-claim release callback failed for ${input.dispatch.event.userId}/${input.dispatch.eventId} with HTTP ${response.status}.`,
  );
}

async function deleteHostedLinqMessageFromSystem(input: {
  dispatch: HostedExecutionDispatchRequest;
  env: Readonly<Record<string, string | undefined>>;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  if (input.dispatch.event.kind !== "linq.message.received") {
    return;
  }

  const messageId = normalizeHostedExecutionString(input.dispatch.event.linqMessageId);
  if (!messageId) {
    return;
  }

  const apiToken = normalizeHostedExecutionString(input.env.LINQ_API_TOKEN);
  if (!apiToken) {
    throw new Error("LINQ_API_TOKEN must be configured for hosted Linq post-commit deletion.");
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, DEFAULT_LINQ_API_TIMEOUT_MS);

  let response: Response;

  try {
    response = await fetchImpl(
      new URL(
        `messages/${encodeURIComponent(messageId)}`,
        `${normalizeLinqApiBaseUrl(input.env.LINQ_API_BASE_URL)}/`,
      ),
      {
        headers: {
          authorization: `Bearer ${apiToken}`,
        },
        method: "DELETE",
        signal: controller.signal,
      },
    );
  } catch (error) {
    if (timedOut) {
      throw new Error(
        `Hosted Linq post-commit delete timed out for ${input.dispatch.event.userId}/${input.dispatch.eventId}/${messageId}.`,
      );
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  if (response.ok || response.status === 404) {
    return;
  }

  throw new Error(
    `Hosted Linq post-commit delete failed for ${input.dispatch.event.userId}/${input.dispatch.eventId}/${messageId} with HTTP ${response.status}.`,
  );
}

function normalizeLinqApiBaseUrl(value: string | undefined): string {
  return normalizeHostedExecutionString(value)?.replace(/\/$/u, "") ?? DEFAULT_LINQ_API_BASE_URL;
}
