import { abortRuntimeMultipartUpload } from "../../runtime-object-upload.ts";
import { parseHostedRuntimeResourcePurge } from "@murphai/hosted-execution/runtime-resource-purge";
import { readHostedExecutionSnapshotBaseRef, readHostedExecutionSnapshotDeltaRef, readHostedExecutionSnapshotHotRef } from "@murphai/hosted-execution/parsers";
import { matchCloudflareHostedControlUserRoutePath } from "@murphai/cloudflare-hosted-control/routes";
import { hostedPrivateMediaUserPrefix, hostedBrowserVaultReplicaUserPrefix, hostedMediaUserPrefix, hostedWorkspaceSnapshotUserPrefix } from "../../storage-paths.ts";
import { listHostedBrowserVaultReplicaSiblingObjectKeys } from "../../browser-vault-store.ts";
import { HostedBundleGarbageCollector } from "../../bundle-gc.ts";
import { RunnerStoreCache } from "../../user-runner/runner-store-cache.ts";
import { json, readOptionalJsonObject } from "../../json.ts";
import { readHostedExecutionEnvironment } from "../../env.ts";
import { asWorkerStringEnvironment } from "../../worker-contracts.ts";
import type { WorkerRouteContext } from "../../worker-routes/shared.ts";
import { requireBoundInternalRouteUser } from "../auth.ts";
import type { DeclarativeRoute } from "../routes.ts";
import { decodeRouteParam } from "../route-utils/route-params.ts";

export const runtimeResourcePurgeRoutes: readonly DeclarativeRoute<WorkerRouteContext>[] = [{
  authorizeBeforeMethod: true, authorization: "vercel-oidc",
  beforeMethod(context, params) { return requireBoundInternalRouteUser(context, params, "runtime-resource-purge"); },
  async handle(context, params) {
    const userId = decodeRouteParam(params.userId);
    const resource = parseHostedRuntimeResourcePurge(await readOptionalJsonObject(context.request, { limitBytes: 16 * 1024 }));
    await purgeHostedRuntimeResource({ source: context.env, userId, resource });
    return json({ deleted: true });
  },
  match: pathname => matchCloudflareHostedControlUserRoutePath("runtimeResourcePurge", pathname),
  methods: ["POST"], name: "runtime-resource-purge", wrongMethodResponse: "method-not-allowed",
}];

export async function purgeHostedRuntimeResource(input: {
  source: Pick<WorkerRouteContext["env"], "BUNDLES"> & Readonly<Record<string, unknown>>; userId: string; resource: ReturnType<typeof parseHostedRuntimeResourcePurge>;
}): Promise<void> {
  const bucket = input.source.BUNDLES;
  if (!bucket.delete) throw new Error("Runtime resource deletion is unavailable.");
  const resource = parseHostedRuntimeResourcePurge(input.resource);
  if (resource.kind === "multipart") {
    if (!bucket.resumeMultipartUpload) throw new Error("Runtime multipart recovery is unavailable.");
    const prefixes = await Promise.all([hostedMediaUserPrefix({ userId: input.userId }), hostedPrivateMediaUserPrefix({ userId: input.userId }), hostedBrowserVaultReplicaUserPrefix({ userId: input.userId }), hostedWorkspaceSnapshotUserPrefix({ userId: input.userId })]);
    if (!prefixes.some(prefix => resource.objectKey.startsWith(prefix) && !resource.objectKey.slice(prefix.length).includes("/"))) throw new TypeError("Multipart upload is outside the member namespace.");
    await abortRuntimeMultipartUpload(bucket.resumeMultipartUpload(resource.objectKey, resource.uploadId));
    return;
  }
  if (resource.kind === "legacy_snapshot") {
    const stores = await new RunnerStoreCache({ bucket, env: readHostedExecutionEnvironment(asWorkerStringEnvironment(input.source)), runnerRuntimeEnvSource: input.source }).ensure(input.userId);
    const collector = new HostedBundleGarbageCollector(bucket, stores.crypto.rootKey, stores.crypto.rootKeyId, stores.crypto.keysById);
    const refs = [readHostedExecutionSnapshotBaseRef(resource.snapshotRef), readHostedExecutionSnapshotHotRef(resource.snapshotRef), readHostedExecutionSnapshotDeltaRef(resource.snapshotRef)];
    for (const previousBundleRef of refs) if (previousBundleRef) await collector.cleanupBundleTransition({ userId: input.userId, previousBundleRef, nextBundleRef: null });
    return;
  }
  const prefix = await (resource.kind === "snapshot" ? hostedWorkspaceSnapshotUserPrefix : resource.kind === "media" ? hostedMediaUserPrefix : hostedBrowserVaultReplicaUserPrefix)({ userId: input.userId });
  if (!resource.objectKey.startsWith(prefix) || resource.objectKey.slice(prefix.length).includes("/")) throw new TypeError("Runtime resource purge is outside the member namespace.");
  const keys = resource.kind === "replica" ? [resource.objectKey, ...listHostedBrowserVaultReplicaSiblingObjectKeys(resource.objectKey)] : [resource.objectKey];
  for (const key of keys) await bucket.delete(key);
}
