import {
  CLOUDFLARE_HOSTED_RUNTIME_INTERNAL_HOSTNAMES,
} from "./internal-hosts.ts";
import {
  handleRunnerOutboundRequest,
  type RunnerOutboundEnvironmentSource,
} from "./runner-outbound.ts";
import {
  requireRunnerRuntimeWriteFence,
  RunnerRuntimeWriteFenceError,
} from "./runner-outbound/write-fence.ts";
import { unauthorized } from "./json.ts";

interface RunnerContainerOutboundContext {
  containerId?: string;
}

export async function hostedRunnerIntercept(
  request: Request,
  env: RunnerOutboundEnvironmentSource,
  ctx: RunnerContainerOutboundContext,
): Promise<Response> {
  const url = new URL(request.url);

  if (!CLOUDFLARE_HOSTED_RUNTIME_INTERNAL_HOSTNAMES.has(url.hostname)) {
    return fetch(request);
  }

  const userId = resolveHostedExecutionRunnerUserIdFromContainerName({
    containerName: ctx.containerId ?? "",
    source: env,
  });
  try {
    await requireRunnerRuntimeWriteFence({
      env,
      request,
      userId,
    });
  } catch (error) {
    if (error instanceof RunnerRuntimeWriteFenceError) {
      return unauthorized();
    }
    throw error;
  }

  return await handleRunnerOutboundRequest(
    request,
    env,
    userId,
  );
}

function resolveHostedExecutionRunnerUserIdFromContainerName(input: {
  containerName: string;
  source: Readonly<Record<string, unknown>>;
}): string {
  const workerVersionSegment = readRunnerContainerWorkerVersionSegment(input.source);
  const versionSuffix = workerVersionSegment ? `--v-${workerVersionSegment}` : null;
  return versionSuffix && input.containerName.endsWith(versionSuffix)
    ? input.containerName.slice(0, -versionSuffix.length)
    : input.containerName;
}

function readRunnerContainerWorkerVersionSegment(source: Readonly<Record<string, unknown>>): string | null {
  const metadata = source.CF_VERSION_METADATA;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const versionId = (metadata as { id?: unknown }).id;
  if (typeof versionId !== "string") {
    return null;
  }

  const sanitized = versionId
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return sanitized.length > 0 ? sanitized : null;
}
