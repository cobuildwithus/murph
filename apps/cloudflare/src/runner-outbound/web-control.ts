import {
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH,
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH,
} from "@murphai/device-syncd/hosted-runtime";

import { type readHostedExecutionEnvironment } from "../env.ts";
import { methodNotAllowed, notFound } from "../json.ts";
import { fetchHostedExecutionWebControlPlaneResponse } from "../web-control-plane.ts";

const HOSTED_WEB_USAGE_RECORD_PATH = "/api/internal/hosted-execution/usage/record";
const HOSTED_WEB_ISSUE_RECORD_PATH = "/api/internal/hosted-execution/issues/record";
const HOSTED_WEB_STRIPE_CUSTOMER_LOOKUP_PATH =
  "/api/internal/hosted-execution/billing/stripe/customer/resolve";
const HOSTED_DEVICE_SYNC_CONNECT_LINK_PATH =
  /^\/api\/internal\/device-sync\/providers\/[^/]+\/connect-link$/u;

export async function handleRunnerWebControlRequest(input: {
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  request: Request;
  url: URL;
  userId: string;
}): Promise<Response> {
  if (input.request.method !== "POST") {
    return input.request.method === "GET" ? notFound() : methodNotAllowed();
  }

  if (!isAllowedRunnerWebControlRoute(input.url.pathname)) {
    return notFound();
  }

  const bodyText = await input.request.text();
  const body = bodyText.length > 0 ? bodyText : undefined;

  return await fetchHostedExecutionWebControlPlaneResponse({
    baseUrl: input.environment.hostedWebBaseUrl,
    body,
    boundUserId: input.userId,
    callbackSigning: input.environment.webCallbackSigning,
    method: "POST",
    path: input.url.pathname,
    search: input.url.search || null,
    timeoutMs: input.environment.runnerTimeoutMs,
  });
}

function isAllowedRunnerWebControlRoute(path: string): boolean {
  return path === HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH
    || path === HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH
    || path === HOSTED_WEB_ISSUE_RECORD_PATH
    || path === HOSTED_WEB_STRIPE_CUSTOMER_LOOKUP_PATH
    || path === HOSTED_WEB_USAGE_RECORD_PATH
    || HOSTED_DEVICE_SYNC_CONNECT_LINK_PATH.test(path);
}
