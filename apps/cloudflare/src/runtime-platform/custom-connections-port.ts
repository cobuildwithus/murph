import { emitHostedExecutionStructuredLog, hostedCustomConnectionsManifestSchema, type HostedCustomConnectionsPort } from "@murphai/hosted-execution";
import {
  fetchHostedWebControlPlaneJson,
  HostedWebControlPlaneResponseError,
  HOSTED_RUNNER_WEB_CONTROL_ROUTES,
  type HostedWebControlTransport,
} from "./web-control-transport.ts";

// The read sits before the first eligible reply of a wake, so it gets a short bound.
const CUSTOM_CONNECTIONS_MANIFEST_TIMEOUT_MS = 3_000;

/**
 * The platform is invocation-local; even concurrent eligible plans share this
 * read. Mounts only add tools, so any failure means none this wake rather than
 * a failed reply.
 */
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
        timeoutMs: Math.min(input.timeoutMs, CUSTOM_CONNECTIONS_MANIFEST_TIMEOUT_MS),
        description: "Hosted custom connections",
        route: HOSTED_RUNNER_WEB_CONTROL_ROUTES.customConnectionsManifest,
        sensitiveResponseBody: { maxBytes: 64 * 1024 },
      });
      const parsed = hostedCustomConnectionsManifestSchema.safeParse(response);
      if (!parsed.success) throw new Error("Invalid custom connections manifest.");
      return parsed.data.connections.sort((a, b) => a.slug.localeCompare(b.slug));
    } catch (error) {
      if (error instanceof HostedWebControlPlaneResponseError && error.status === 404) return [];
      emitHostedExecutionStructuredLog({
        component: "hosted.runtime.custom-connections",
        details: { status: error instanceof HostedWebControlPlaneResponseError ? error.status : null },
        level: "warn",
        message: "Hosted custom connections manifest unavailable; mounting none this wake.",
        phase: "wake.running",
        userId: null,
      });
      return [];
    }
  }
  return { readManifest: () => manifest ??= read() };
}
