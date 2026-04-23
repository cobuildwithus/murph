import { type readHostedExecutionEnvironment } from "../env.ts";
import { methodNotAllowed, notFound } from "../json.ts";
import { fetchHostedExecutionWebControlPlaneResponse } from "../web-control-plane.ts";
import {
  isAllowedHostedRunnerWebControlPath,
} from "./shared-web-control-policy.ts";

export async function handleRunnerWebControlRequest(input: {
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  request: Request;
  url: URL;
  userId: string;
}): Promise<Response> {
  if (input.request.method !== "POST") {
    return input.request.method === "GET" ? notFound() : methodNotAllowed();
  }

  if (!isAllowedHostedRunnerWebControlPath(input.url.pathname)) {
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
