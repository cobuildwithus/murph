import {
  HOSTED_EMAIL_PUBLIC_BOOTSTRAP_CALLBACK_PATH,
  HOSTED_EMAIL_PUBLIC_BOOTSTRAP_CALLBACK_USER_ID,
  parseHostedEmailPublicBootstrapCallbackResponse,
  type HostedEmailPublicBootstrapCallbackRequest,
} from "@murphai/hosted-execution/hosted-email";

import {
  fetchHostedExecutionWebControlPlaneResponse,
} from "./web-control-plane.ts";
import type { HostedWebCallbackSigningEnvironment } from "./web-callback-auth.ts";

export async function requestHostedEmailPublicBootstrapInWeb(input: {
  allowHttpHosts?: readonly string[];
  baseUrl: string;
  body: HostedEmailPublicBootstrapCallbackRequest;
  callbackSigning?: HostedWebCallbackSigningEnvironment | null;
  fetchImpl?: typeof fetch;
  timeoutMs: number | null;
}): Promise<void> {
  const response = await fetchHostedExecutionWebControlPlaneResponse({
    ...(input.allowHttpHosts ? { allowHttpHosts: input.allowHttpHosts } : {}),
    baseUrl: input.baseUrl,
    body: JSON.stringify(input.body),
    boundUserId: HOSTED_EMAIL_PUBLIC_BOOTSTRAP_CALLBACK_USER_ID,
    callbackSigning: input.callbackSigning,
    fetchImpl: input.fetchImpl,
    method: "POST",
    path: HOSTED_EMAIL_PUBLIC_BOOTSTRAP_CALLBACK_PATH,
    timeoutMs: input.timeoutMs,
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(
      `Hosted email public bootstrap callback failed with HTTP ${response.status}.`,
    );
  }

  parseHostedEmailPublicBootstrapCallbackResponse(await response.json());
}
