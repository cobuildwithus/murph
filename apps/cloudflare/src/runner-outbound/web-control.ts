import { type readHostedExecutionEnvironment } from "../env.ts";
import { methodNotAllowed } from "../json.ts";
import { fetchHostedExecutionWebControlPlaneResponse } from "../web-control-plane.ts";

export async function handleRunnerWebControlRequest(input: {
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  request: Request;
  url: URL;
  userId: string;
}): Promise<Response> {
  if (input.request.method !== "GET" && input.request.method !== "POST") {
    return methodNotAllowed();
  }

  const bodyText = input.request.method === "GET"
    ? undefined
    : await input.request.text();
  const body = bodyText && bodyText.length > 0 ? bodyText : undefined;

  return await fetchHostedExecutionWebControlPlaneResponse({
    baseUrl: input.environment.hostedWebBaseUrl,
    body,
    boundUserId: input.userId,
    callbackSigning: input.environment.webCallbackSigning,
    method: input.request.method,
    path: input.url.pathname,
    search: input.url.search || null,
    timeoutMs: input.environment.runnerTimeoutMs,
  });
}
