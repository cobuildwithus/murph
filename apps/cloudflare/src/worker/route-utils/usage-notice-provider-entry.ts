import type {
  CloudflareHostedControlUsageNoticeProviderDispatchAttempt,
} from "@murphai/cloudflare-hosted-control/client";
import {
  HOSTED_RUNTIME_USAGE_NOTICE_PROVIDER_ENTRY_PATH,
} from "@murphai/hosted-execution/routes";

import {
  fetchHostedExecutionWebControlPlaneResponse,
} from "../../web-control-plane.ts";
import { normalizeCloudflareWorkerFetch } from "../../worker-fetch.ts";
import type { WorkerRouteContext } from "../../worker-routes/shared.ts";

const HOSTED_USAGE_NOTICE_PROVIDER_ENTRY_TIMEOUT_MS = 2_500;

export function createUsageNoticeProviderEntryBoundary(input: {
  attempt: CloudflareHostedControlUsageNoticeProviderDispatchAttempt;
  context: WorkerRouteContext;
  userId: string;
}): {
  enter: () => Promise<void>;
  fetchImplementation: typeof fetch;
  hasEntered: () => boolean;
} {
  let entered = false;
  let entryPromise: Promise<void> | null = null;
  const enter = () => {
    entryPromise ??= persistUsageNoticeProviderEntry(input).then(() => {
      entered = true;
    });
    return entryPromise;
  };
  const providerFetch = normalizeCloudflareWorkerFetch();

  return {
    enter,
    fetchImplementation: (async (request, init) => {
      await enter();
      return providerFetch(request, init);
    }) as typeof fetch,
    hasEntered: () => entered,
  };
}

async function persistUsageNoticeProviderEntry(input: {
  attempt: CloudflareHostedControlUsageNoticeProviderDispatchAttempt;
  context: WorkerRouteContext;
  userId: string;
}): Promise<void> {
  let response: Response;
  try {
    response = await fetchHostedExecutionWebControlPlaneResponse({
      ...(input.context.environment.hostedWebAllowHttpHosts
        ? { allowHttpHosts: input.context.environment.hostedWebAllowHttpHosts }
        : {}),
      baseUrl: input.context.environment.hostedWebBaseUrl,
      body: JSON.stringify(input.attempt),
      boundUserId: input.userId,
      callbackSigning: input.context.environment.webCallbackSigning,
      method: "POST",
      path: HOSTED_RUNTIME_USAGE_NOTICE_PROVIDER_ENTRY_PATH,
      signal: input.context.request.signal,
      timeoutMs: HOSTED_USAGE_NOTICE_PROVIDER_ENTRY_TIMEOUT_MS,
    });
  } catch (cause) {
    throw Object.assign(
      new Error("Hosted usage notice provider-entry callback was unavailable.", {
        cause,
      }),
      {
        code: "HOSTED_USAGE_NOTICE_PROVIDER_ENTRY_UNAVAILABLE",
        context: {
          failureStage: "pre_provider",
          retryable: true,
        },
        deliveryMayHaveSucceeded: false,
        retryable: true,
      },
    );
  }
  if (response.ok) {
    return;
  }

  const deliveryMayHaveSucceeded = response.status === 409;
  throw Object.assign(
    new Error("Hosted usage notice provider-entry callback failed."),
    {
      code: deliveryMayHaveSucceeded
        ? "HOSTED_USAGE_NOTICE_PROVIDER_DISPATCH_ALREADY_STARTED"
        : "HOSTED_USAGE_NOTICE_PROVIDER_ENTRY_UNAVAILABLE",
      context: {
        failureStage: "pre_provider",
        retryable: !deliveryMayHaveSucceeded,
        status: response.status,
      },
      deliveryMayHaveSucceeded,
      retryable: !deliveryMayHaveSucceeded,
    },
  );
}
