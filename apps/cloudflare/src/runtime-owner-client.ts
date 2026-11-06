import { HOSTED_RUNTIME_OWNER_PATH, parseHostedRuntimeOwnerResponse, type HostedRuntimeOwnerCommand } from "@murphai/hosted-execution/runtime-owner";
import { readHostedExecutionEnvironment } from "./env.ts";
import { asWorkerStringEnvironment } from "./worker-contracts.ts";
import { fetchHostedExecutionWebControlPlaneResponse } from "./web-control-plane.ts";
import { readHostedWebControlPlaneResponseText } from "./runtime-platform/web-control-transport.ts";

export async function commandHostedRuntimeOwner(input: {
  source: Readonly<Record<string, unknown>>;
  userId: string;
  command: HostedRuntimeOwnerCommand;
  timeoutMs?: number;
}) {
  const environment = readHostedExecutionEnvironment(asWorkerStringEnvironment(input.source));
  if (!environment.hostedWebBaseUrl) throw new Error("Hosted runtime owner URL is not configured.");
  const response = await fetchHostedExecutionWebControlPlaneResponse({
    baseUrl: environment.hostedWebBaseUrl,
    allowHttpHosts: environment.hostedWebAllowHttpHosts,
    boundUserId: input.userId,
    callbackSigning: environment.webCallbackSigning,
    method: "POST", path: HOSTED_RUNTIME_OWNER_PATH,
    body: JSON.stringify(input.command),
    timeoutMs: input.timeoutMs ?? environment.webControlTimeoutMs,
  });
  if (!response.ok) throw new Error(`Hosted runtime owner returned HTTP ${response.status}.`);
  const result = parseHostedRuntimeOwnerResponse(JSON.parse(await readHostedWebControlPlaneResponseText({
    response, description: "Hosted runtime owner", maxBytes: 64 * 1024,
    signal: null, timeoutMs: input.timeoutMs ?? environment.webControlTimeoutMs,
  })));
  if (result.owner && result.owner.userId !== input.userId) {
    throw new Error("Hosted runtime owner returned a different member.");
  }
  return result;
}
