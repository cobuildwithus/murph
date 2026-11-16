import { RequestBodyTooLargeError } from "@murphai/hosted-execution/request-input";
import { readHostedExecutionEnvironment } from "./env.ts";
import { readRequestBodyText } from "./json.ts";
import { CLOUDFLARE_HOSTED_RUNTIME_HOSTS } from "./internal-hosts.ts";
import { readNativeRuntimeProviderAuthority, type RuntimeProviderCaller } from "./runtime-provider-authorization.ts";
import type { RunnerOutboundEnvironmentSource } from "./runner-outbound/shared.ts";
import { writeRunnerRuntimeWriteFenceHeaders } from "./runner-outbound/write-fence.ts";
import { fetchHostedExecutionWebControlPlaneResponse } from "./web-control-plane.ts";
import { asWorkerStringEnvironment } from "./worker-contracts.ts";

export const CUSTOM_CONNECTIONS_MAX_REQUEST_BYTES = 256 * 1024;

export async function handleHostedRunnerCustomConnectionsOutbound(
  request: Request,
  env: RunnerOutboundEnvironmentSource,
  caller: RuntimeProviderCaller,
): Promise<Response> {
  const url = new URL(request.url);
  const path = /^\/v1\/([A-Za-z0-9_-]{1,128})\/([1-9][0-9]{0,15})\/([A-Za-z0-9_-]{43})\/mcp$/u.exec(url.pathname);
  if (url.hostname !== CLOUDFLARE_HOSTED_RUNTIME_HOSTS.customConnections || !path || url.search) {
    return new Response("Not found", { status: 404 });
  }
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  try {
    const authority = await readNativeRuntimeProviderAuthority(env, caller);
    if (!authority || authority.retiring || !authority.userId || !authority.attemptId || !authority.generation) {
      return new Response("Forbidden", { status: 403 });
    }
    const body = await readRequestBodyText(request, { limitBytes: CUSTOM_CONNECTIONS_MAX_REQUEST_BYTES });
    const environment = readHostedExecutionEnvironment(asWorkerStringEnvironment(env));
    // No caller headers are authority or upstream protocol state.
    const headers = new Headers({ accept: "application/json, text/event-stream" });
    writeRunnerRuntimeWriteFenceHeaders(headers, {
      attemptId: authority.attemptId,
      generation: authority.generation,
      workspaceVersion: authority.workspaceVersion,
    });
    const response = await fetchHostedExecutionWebControlPlaneResponse({
      baseUrl: environment.hostedWebBaseUrl,
      body,
      boundUserId: authority.userId,
      callbackSigning: environment.webCallbackSigning,
      headers,
      method: "POST",
      path: `/api/internal/custom-connections/${path[1]}/${path[2]}/${path[3]}/mcp`,
      timeoutMs: environment.webControlTimeoutMs,
    });
    const responseHeaders = new Headers();
    const contentType = response.headers.get("content-type");
    if (contentType !== null) responseHeaders.set("content-type", contentType);
    return new Response(response.body, { status: response.status, headers: responseHeaders });
  } catch (error) {
    // Raw transport errors can include callback URLs or upstream content.
    return new Response(error instanceof RequestBodyTooLargeError ? "Request too large" : "Connection unavailable", {
      status: error instanceof RequestBodyTooLargeError ? 413 : 502,
    });
  }
}
