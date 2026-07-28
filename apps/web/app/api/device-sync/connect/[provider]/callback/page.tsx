import type { Metadata } from "next";
import { headers } from "next/headers";

import { HostedDeviceSyncCallbackConfirmation } from "@/src/components/device-sync/hosted-device-sync-callback-confirmation";
import {
  readHostedDeviceSyncCallbackState,
  verifyHostedDeviceSyncCallbackProof,
} from "@/src/lib/device-sync/browser-callback-proof";
import { createHostedDeviceSyncPublicIngressService } from "@/src/lib/device-sync/public-ingress-service";
import { readHostedDeviceSyncPublicBaseUrl } from "@/src/lib/hosted-web/public-url";
import { requireActiveHostedAppSession } from "@/src/lib/hosted-onboarding/app-session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: {
    follow: false,
    index: false,
  },
  title: "Finish device connection",
};

type CallbackSearchParams = Record<string, string | string[] | undefined>;

export default async function HostedDeviceSyncCallbackPage(input: {
  params: Promise<{ provider: string }>;
  searchParams: Promise<CallbackSearchParams>;
}) {
  const [{ provider }, searchParams, requestHeaders] = await Promise.all([
    input.params,
    input.searchParams,
    headers(),
  ]);
  let callbackRequest: Request | null = null;
  let publicIngress: ReturnType<typeof createHostedDeviceSyncPublicIngressService> | null = null;

  try {
    callbackRequest = buildHostedDeviceSyncCallbackRequest({
      provider,
      requestHeaders,
      searchParams,
    });
    publicIngress = createHostedDeviceSyncPublicIngressService(callbackRequest);
    const session = await requireActiveHostedAppSession();
    const state = readHostedDeviceSyncCallbackState(new URL(callbackRequest.url));
    if (
      !state
      || !verifyHostedDeviceSyncCallbackProof({
        memberId: session.member.id,
        provider,
        request: callbackRequest,
        sessionId: session.sessionId,
        state,
      })
    ) {
      await publicIngress.discardConnectionCallback(provider);
      return <HostedDeviceSyncCallbackConfirmation state="failure" />;
    }

    return (
      <HostedDeviceSyncCallbackConfirmation
        action={buildHostedDeviceSyncCallbackCompletionAction(provider, searchParams)}
        state="confirmation"
      />
    );
  } catch {
    await publicIngress?.discardConnectionCallback(provider).catch(() => undefined);
    return <HostedDeviceSyncCallbackConfirmation state="failure" />;
  }
}

function buildHostedDeviceSyncCallbackRequest(input: {
  provider: string;
  requestHeaders: Headers;
  searchParams: CallbackSearchParams;
}): Request {
  const publicBaseUrl = readHostedDeviceSyncPublicBaseUrl();
  if (!publicBaseUrl) {
    throw new TypeError("Hosted device-sync callback base URL is not configured.");
  }

  const url = new URL(
    `${publicBaseUrl.replace(/\/$/u, "")}/connect/${encodeURIComponent(input.provider)}/callback`,
  );
  appendCallbackSearchParams(url.searchParams, input.searchParams);
  return new Request(url, {
    headers: input.requestHeaders,
  });
}

function buildHostedDeviceSyncCallbackCompletionAction(
  provider: string,
  searchParams: CallbackSearchParams,
): string {
  const url = new URL(
    `/api/device-sync/connect/${encodeURIComponent(provider)}/callback/complete`,
    "https://callback.invalid",
  );
  appendCallbackSearchParams(url.searchParams, searchParams);
  return `${url.pathname}${url.search}`;
}

function appendCallbackSearchParams(
  target: URLSearchParams,
  source: CallbackSearchParams,
): void {
  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        target.append(key, entry);
      }
    } else if (typeof value === "string") {
      target.append(key, value);
    }
  }
}
