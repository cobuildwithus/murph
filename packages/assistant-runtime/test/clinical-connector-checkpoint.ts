import type { ClinicalCheckpointInput } from "./clinical-connector-runtime.ts";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sha256HostedBundleHex, snapshotHostedBundleRoots } from "@murphai/runtime-state/node";
import { createHostedMailboxRoutingPlan } from "../src/hosted-runtime/mailbox-routing.ts";
import {
  enqueueHostedSystemMailboxItem, prepareHostedSystemMailboxItemForCheckpoint, recordHostedSystemMailboxItemAfterCheckpoint,
} from "../src/hosted-runtime/system-mailbox.ts";
import {
  createHostedRuntimeArtifactStoreStub, createHostedRuntimeEffectsPortStub, createHostedRuntimeResolvedConfig,
} from "./hosted-runtime-test-helpers.ts";


export async function checkpointClinicalMailboxItem(input: ClinicalCheckpointInput) {
  const { item, port, vaultRoot, wake } = input;
  const route = createHostedMailboxRoutingPlan(item);
  if (route.state !== "route" || !item.payloadInlineCiphertext) throw new Error("Expected an inline clinical wake.");
  await enqueueHostedSystemMailboxItem({ vaultRoot, wake, item: { route, item, payload: {
    status: "resolved", source: "inline", payloadCiphertext: item.payloadInlineCiphertext,
    payloadSchema: "murph.hosted-mailbox-payload.v1", requestId: null,
  } } });
  const runtime = { commitTimeoutMs: null, forwardedEnv: {}, platformEnv: {}, userEnv: {},
    resolvedConfig: createHostedRuntimeResolvedConfig(), platform: { clinicalRecordsPort: port,
      artifactStore: createHostedRuntimeArtifactStoreStub().artifactStore, effectsPort: createHostedRuntimeEffectsPortStub() } };
  const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
    executionContext: null, runtime, runtimeEnv: {}, vaultRoot, allowedRouteActions: ["run-clinical-records-sync"],
  });
  if (prepared?.status !== "processed" || prepared.item.postCheckpointRecord?.kind !== "clinical-records.outcome-recorded") {
    throw new Error(`Clinical wake did not prepare an outcome (${prepared?.status}).`);
  }
  // The disposable object store retains the exact portable vault with its pending receipt.
  const bytes = await snapshotHostedBundleRoots({ kind: "vault", roots: [{ root: vaultRoot, rootKey: "vault" }] });
  if (!bytes) throw new Error("Clinical checkpoint contained no vault.");
  const hash = sha256HostedBundleHex(bytes);
  const key = `${hash}.bundle.json`;
  await writeFile(join(input.workspaceRoot, key), bytes);
  await input.publish({ hash, key, size: bytes.byteLength, updatedAt: new Date().toISOString() });
  const result = await recordHostedSystemMailboxItemAfterCheckpoint({ runtime, vaultRoot, item: prepared.item });
  if (result.failed || !result.recorded) throw new Error("Clinical checkpoint outcome was not accepted.");
}
