import type {
  HostedWakeAppendResponse,
  HostedEmailIngressWakeAppendRequest,
} from "@murphai/hosted-execution";
import { emitHostedExecutionStructuredLog } from "@murphai/hosted-execution";
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
  let response: Response;
  try {
    response = await fetchHostedExecutionWebControlPlaneResponse({
      baseUrl: input.baseUrl,
      body: JSON.stringify(input.body),
      boundUserId: input.boundUserId,
      callbackSigning: input.callbackSigning,
      fetchImpl: input.fetchImpl,
      method: "POST",
      path: HOSTED_WEB_HOSTED_WAKE_EMAIL_INGRESS_PATH,
      timeoutMs: input.timeoutMs,
    });
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "assistant-delivery",
      details: {
        description: "Hosted email ingress wake append",
        path: HOSTED_WEB_HOSTED_WAKE_EMAIL_INGRESS_PATH,
        userId: input.boundUserId,
      },
      error,
      level: "warn",
      message: "Hosted email ingress control-plane request failed.",
      phase: "side-effects.draining",
      userId: input.boundUserId,
    });
    throw error;
  }

  if (!response.ok) {
    const responseDetail = (await response.text()).trim();
    const error = new Error(
      responseDetail.length > 0
        ? `Hosted email ingress wake append failed with HTTP ${response.status}. ${responseDetail}`
        : `Hosted email ingress wake append failed with HTTP ${response.status}.`,
    ) as Error & {
      status: number;
      statusCode: number;
    };
    error.status = response.status;
    error.statusCode = response.status;
    emitHostedExecutionStructuredLog({
      component: "assistant-delivery",
      details: {
        description: "Hosted email ingress wake append",
        path: HOSTED_WEB_HOSTED_WAKE_EMAIL_INGRESS_PATH,
        responseStatus: response.status,
        userId: input.boundUserId,
      },
      error,
      level: "warn",
      message: "Hosted email ingress control-plane response returned non-OK.",
      phase: "side-effects.draining",
      userId: input.boundUserId,
    });
    throw error;
  }

  return parseHostedWakeAppendResponse(await response.json());
}
