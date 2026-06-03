import {
  json,
} from "../json.ts";
import type {
  WorkerEnvironmentSource,
} from "../worker-routes/shared.ts";
import type {
  DeclarativeRoute,
} from "./routes.ts";
import {
  matchExactPath,
} from "./routes.ts";

export const workerPublicRoutes: readonly DeclarativeRoute<{
  env: WorkerEnvironmentSource;
  request: Request;
  url: URL;
}>[] = [
  {
    handle(context) {
      return createServiceBannerResponse(context.env);
    },
    match: matchExactPath("/", "/health"),
    methods: ["GET"],
    name: "service-banner",
  },
];

function createServiceBannerResponse(env: Pick<WorkerEnvironmentSource, "CF_VERSION_METADATA">): Response {
  const workerVersionId = readWorkerVersionId(env);
  return json({
    ok: true,
    service: "cloudflare-hosted-runner",
    ...(workerVersionId ? { workerVersionId } : {}),
  });
}

export function readWorkerVersionId(env: Pick<WorkerEnvironmentSource, "CF_VERSION_METADATA">): string | null {
  const versionId = env.CF_VERSION_METADATA?.id;
  return typeof versionId === "string" && versionId.trim().length > 0
    ? versionId.trim()
    : null;
}
