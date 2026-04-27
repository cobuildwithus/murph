import { type readHostedExecutionEnvironment } from "../env.ts";
import { methodNotAllowed, notFound } from "../json.ts";
import { fetchHostedExecutionWebControlPlaneResponse } from "../web-control-plane.ts";
import {
  allowsHostedRunnerWebControlSignedUserOverride,
  HOSTED_RUNNER_WEB_CONTROL_SIGNED_USER_ID_HEADER,
  isAllowedHostedRunnerWebControlRequest,
} from "./shared-web-control-policy.ts";

export async function handleRunnerWebControlRequest(input: {
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  request: Request;
  url: URL;
  userId: string;
}): Promise<Response> {
  if (input.request.method !== "GET" && input.request.method !== "POST") {
    return methodNotAllowed();
  }

  if (!isAllowedHostedRunnerWebControlRequest({
    method: input.request.method,
    path: input.url.pathname,
  })) {
    return notFound();
  }

  const signedUserId = resolveHostedRunnerWebControlSignedUserId({
    path: input.url.pathname,
    request: input.request,
    userId: input.userId,
  });
  if (!signedUserId) {
    return notFound();
  }

  const body = input.request.method === "POST"
    ? await readOptionalHostedRunnerWebControlBody(input.request)
    : undefined;

  return await fetchHostedExecutionWebControlPlaneResponse({
    baseUrl: input.environment.hostedWebBaseUrl,
    body,
    boundUserId: signedUserId,
    callbackSigning: input.environment.webCallbackSigning,
    method: input.request.method,
    path: input.url.pathname,
    search: input.url.search || null,
    timeoutMs: input.environment.webControlTimeoutMs,
  });
}

function resolveHostedRunnerWebControlSignedUserId(input: {
  path: string;
  request: Request;
  userId: string;
}): string | null {
  const override = input.request.headers.get(HOSTED_RUNNER_WEB_CONTROL_SIGNED_USER_ID_HEADER);
  if (override === null) {
    return input.userId;
  }

  if (!allowsHostedRunnerWebControlSignedUserOverride(input.path)) {
    return null;
  }

  return isValidHostedRunnerWebControlUserId(override) ? override : null;
}

function isValidHostedRunnerWebControlUserId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u.test(value);
}

async function readOptionalHostedRunnerWebControlBody(request: Request): Promise<string | undefined> {
  const bodyText = await request.text();
  return bodyText.length > 0 ? bodyText : undefined;
}
