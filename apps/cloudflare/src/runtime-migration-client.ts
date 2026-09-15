import { HOSTED_RUNTIME_MIGRATION_PATH, parseHostedRuntimeMigrationCommand, type HostedRuntimeMigrationCommand } from "@murphai/hosted-execution/runtime-migration";
import { readHostedExecutionEnvironment } from "./env.ts";
import { asWorkerStringEnvironment } from "./worker-contracts.ts";
import { fetchHostedExecutionWebControlPlaneResponse } from "./web-control-plane.ts";
import { readHostedWebControlPlaneResponseText } from "./runtime-platform/web-control-transport.ts";

/** System signature: migration must cover objects with no surviving member. */
export async function commandHostedRuntimeMigration(input: { source: Readonly<Record<string, unknown>>; command: HostedRuntimeMigrationCommand }): Promise<Record<string, unknown>> {
  const environment = readHostedExecutionEnvironment(asWorkerStringEnvironment(input.source));
  if (!environment.hostedWebBaseUrl) throw new Error("Hosted runtime migration URL is not configured.");
  const response = await fetchHostedExecutionWebControlPlaneResponse({
    baseUrl: environment.hostedWebBaseUrl, allowHttpHosts: environment.hostedWebAllowHttpHosts,
    boundUserId: null, callbackSigning: environment.webCallbackSigning, method: "POST", path: HOSTED_RUNTIME_MIGRATION_PATH,
    body: JSON.stringify(parseHostedRuntimeMigrationCommand(input.command)), timeoutMs: environment.webControlTimeoutMs,
  });
  if (!response.ok) throw new Error(`Hosted runtime migration returned HTTP ${response.status}.`);
  const result: unknown = JSON.parse(await readHostedWebControlPlaneResponseText({ response,
    description: "Hosted runtime migration", maxBytes: 64 * 1024, signal: null, timeoutMs: environment.webControlTimeoutMs }));
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Hosted runtime migration response is invalid.");
  return result as Record<string, unknown>;
}
