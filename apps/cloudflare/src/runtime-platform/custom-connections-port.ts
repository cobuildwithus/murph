import { hostedCustomConnectionsManifestSchema, type HostedCustomConnectionsPort } from "@murphai/hosted-execution";
import {
  fetchHostedWebControlPlaneJson,
  HostedWebControlPlaneResponseError,
  HOSTED_RUNNER_WEB_CONTROL_ROUTES,
  type HostedWebControlTransport,
} from "./web-control-transport.ts";

/** The platform is invocation-local; even concurrent eligible plans share this read. */
export function createHostedWebCustomConnectionsPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}): HostedCustomConnectionsPort {
  let manifest: ReturnType<HostedCustomConnectionsPort["readManifest"]> | undefined;
  async function read() {
    try {
      const response = await fetchHostedWebControlPlaneJson({
        ...input,
        description: "Hosted custom connections",
        route: HOSTED_RUNNER_WEB_CONTROL_ROUTES.customConnectionsManifest,
        sensitiveResponseBody: { maxBytes: 64 * 1024 },
      });
      const parsed = hostedCustomConnectionsManifestSchema.safeParse(response);
      if (!parsed.success) throw new Error("Invalid custom connections manifest.");
      return parsed.data.connections.sort((a, b) => a.slug.localeCompare(b.slug));
    } catch (error) {
      if (error instanceof HostedWebControlPlaneResponseError && error.status === 404) return [];
      throw new Error("Custom connections manifest unavailable.");
    }
  }
  return { readManifest: () => manifest ??= read() };
}
