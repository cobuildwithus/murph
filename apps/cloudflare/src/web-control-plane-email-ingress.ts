import type {
  HostedWakeAppendResponse,
  HostedEmailIngressWakeAppendRequest,
} from "@murphai/hosted-execution";
import { parseHostedWakeAppendResponse } from "@murphai/hosted-execution/parsers";

import {
  fetchHostedExecutionWebControlPlaneResponse,
} from "./web-control-plane.ts";
import type { HostedWebCallbackSigningEnvironment } from "./web-callback-auth.ts";

const HOSTED_WEB_HOSTED_WAKE_EMAIL_INGRESS_PATH = "/api/internal/hosted-wake/email-ingress";

export async function appendHostedEmailIngressWakeInWeb(input: {
  baseUrl: string;
  body: HostedEmailIngressWakeAppendRequest;
  boundUserId: string;
  callbackSigning?: HostedWebCallbackSigningEnvironment | null;
  fetchImpl?: typeof fetch;
  timeoutMs: number | null;
}): Promise<HostedWakeAppendResponse> {
  const response = await fetchHostedExecutionWebControlPlaneResponse({
    baseUrl: input.baseUrl,
    body: JSON.stringify(input.body),
    boundUserId: input.boundUserId,
    callbackSigning: input.callbackSigning,
    fetchImpl: input.fetchImpl,
    method: "POST",
    path: HOSTED_WEB_HOSTED_WAKE_EMAIL_INGRESS_PATH,
    timeoutMs: input.timeoutMs,
  });

  if (!response.ok) {
    throw new Error(`Hosted email ingress wake append failed with HTTP ${response.status}.`);
  }

  return parseHostedWakeAppendResponse(await response.json());
}
