import type {
  HostedExecutionBundleRef,
} from "@murphai/hosted-execution/contracts";

import {
  createHostedArtifactStore,
  createHostedBundleStore,
  isMissingHostedBundleError,
} from "../../bundle-store.ts";
import {
  json,
  notFound,
} from "../../json.ts";
import {
  resolveHostedExecutionUserCryptoContext,
  type WorkerRouteContext,
} from "../../worker-routes/shared.ts";
import {
  requireHostedExecutionBoundUserResponse,
} from "../auth.ts";
import type {
  DeclarativeRoute,
} from "../routes.ts";
import {
  matchExactPath,
} from "../routes.ts";
import {
  isHostedWorkerTestEnvironment,
  requireHostedWorkerTestEnvironment,
} from "../route-utils/test-env.ts";

export const testArtifactRoutes: readonly DeclarativeRoute<WorkerRouteContext>[] = [
  {
    authorization: "vercel-oidc",
    beforeMethod(context) {
      return requireHostedWorkerTestEnvironment(context);
    },
    async handle(context) {
      return handleTestArtifactRoute(context);
    },
    match: matchExactPath("/__test/artifacts"),
    methods: ["GET", "PUT"],
    name: "test-artifact-seed",
    wrongMethodResponse: "not-found",
  },
];

export async function handleTestArtifactRoute(
  context: WorkerRouteContext,
): Promise<Response> {
  if (!isHostedWorkerTestEnvironment(context.env)) {
    return notFound();
  }

  const userId = context.url.searchParams.get("userId")?.trim() ?? "";
  const sha256 = context.url.searchParams.get("sha256")?.trim() ?? "";
  const bundleKey = context.url.searchParams.get("key")?.trim() ?? "";
  const bundleSize = context.url.searchParams.get("size")?.trim() ?? "";

  if (!userId) {
    return json({ error: "userId is required." }, 400);
  }

  if (!/^[a-f0-9]{64}$/u.test(sha256)) {
    return json({ error: "sha256 is required." }, 400);
  }

  const boundUserResponse = requireHostedExecutionBoundUserResponse(
    context.request,
    userId,
    "Hosted execution bound user does not match the test artifact user.",
    "test-artifact-bound-user-mismatch",
    "test-artifact-seed",
  );
  if (boundUserResponse) {
    return boundUserResponse;
  }

  const crypto = await resolveHostedExecutionUserCryptoContext({
    bucket: context.env.BUNDLES,
    domain: "runtime",
    environment: context.environment,
    userId,
  });
  const artifactStore = createHostedArtifactStore({
    bucket: context.env.BUNDLES,
    key: crypto.rootKey,
    keyId: crypto.rootKeyId,
    keysById: crypto.keysById,
    resolveKeyById: crypto.resolveKeyById,
    userId,
  });
  if (context.request.method === "GET") {
    if (bundleKey) {
      const parsedBundleSize = parseStrictNonNegativeInteger(bundleSize);
      if (parsedBundleSize === null) {
        return json({ error: "size is required." }, 400);
      }

      if (isArtifactBackedHostedWorkspaceBundleKey(bundleKey, sha256)) {
        return await readTestHostedArtifactResponse({
          artifactStore,
          expectedSize: parsedBundleSize,
          sha256,
        });
      }

      const bundleStore = createHostedBundleStore({
        bucket: context.env.BUNDLES,
        key: crypto.rootKey,
        keyId: crypto.rootKeyId,
        keysById: crypto.keysById,
        resolveKeyById: crypto.resolveKeyById,
        userId,
      });
      const ref: HostedExecutionBundleRef = {
        hash: sha256,
        key: bundleKey,
        size: parsedBundleSize,
        updatedAt: "test-route",
      };

      try {
        const bundle = await bundleStore.readBundle(ref);
        if (!bundle) {
          return json({ error: "Hosted artifact was not found." }, 404);
        }

        return new Response(bundle.slice(), {
          headers: {
            "content-type": "application/octet-stream",
          },
        });
      } catch (error) {
        if (isMissingHostedBundleError(error)) {
          return json({ error: "Hosted artifact was not found." }, 404);
        }
        throw error;
      }
    }

    return await readTestHostedArtifactResponse({
      artifactStore,
      sha256,
    });
  }

  const bytes = new Uint8Array(await context.request.arrayBuffer());
  await artifactStore.writeArtifact(sha256, bytes);

  return json({
    ok: true,
    sha256,
    size: bytes.byteLength,
    userId,
  });
}

export async function readTestHostedArtifactResponse(input: {
  artifactStore: ReturnType<typeof createHostedArtifactStore>;
  expectedSize?: number;
  sha256: string;
}): Promise<Response> {
  const artifact = await input.artifactStore.readArtifact(input.sha256);
  if (!artifact) {
    return json({ error: "Hosted artifact was not found." }, 404);
  }

  if (input.expectedSize !== undefined && artifact.byteLength !== input.expectedSize) {
    return json({ error: "Hosted artifact size did not match the requested bundle ref." }, 409);
  }

  return new Response(artifact.slice(), {
    headers: {
      "content-type": "application/octet-stream",
    },
  });
}

export function isArtifactBackedHostedWorkspaceBundleKey(
  key: string,
  sha256: string,
): boolean {
  return key === `cloudflare-workspace-snapshots/${sha256}.bundle`
    || key === `cloudflare-workspace-deltas/${sha256}.bundle`
    || key === `cloudflare-workspace-hot-state/${sha256}.bundle`;
}

function parseStrictNonNegativeInteger(value: string): number | null {
  if (!/^[0-9]+$/u.test(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
