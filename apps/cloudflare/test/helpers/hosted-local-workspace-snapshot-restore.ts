import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { validateCurrentVaultMetadata } from "@murphai/contracts";
import {
  isHostedWorkspaceSnapshotV2Ref,
  parseHostedExecutionSnapshotRef,
} from "@murphai/hosted-execution/parsers";
import type { HostedRunnerStatusResponse } from "@murphai/hosted-execution/runtime-control";

import { readHostedExecutionEnvironment } from "../../src/env.ts";
import { requireHostedUserCryptoContextFromEnvironment } from "../../src/hosted-crypto/runtime-user-crypto-context.ts";
import { readHostedR2PresignEnvironment } from "../../src/r2-presigned-url.ts";
import { restoreEncryptedWorkspaceSnapshotFromEncryptedStream } from "../../src/workspace-snapshot-local.ts";
import { prepareHostedWorkspaceSnapshotRestore } from "../../src/workspace-snapshot-restore-preparation.ts";
import type { HostedLocalDevHarness } from "./hosted-local-dev-harness.js";

/** Inspect the actual committed encrypted checkpoint; release its plaintext after the assertion. */
export async function withHostedLocalWorkspaceSnapshot<T>(input: {
  harness: Pick<HostedLocalDevHarness, "workerRuntimeEnv">;
  read: (roots: { vaultRoot: string }) => Promise<T>;
  status: HostedRunnerStatusResponse;
  userId: string;
}): Promise<T> {
  const source = input.harness.workerRuntimeEnv;
  if (!source) throw new Error("Snapshot inspection requires the hosted-local Worker environment.");
  const r2 = readHostedR2PresignEnvironment(source);
  if (!r2.localEndpointAllowed || !r2.controlEndpoint) {
    throw new Error("Snapshot inspection requires the hosted-local MinIO control endpoint.");
  }
  const environment = readHostedExecutionEnvironment(source);
  const webUrl = new URL(environment.hostedWebBaseUrl);
  if (!["http:", "https:"].includes(webUrl.protocol)
    || !["localhost", "127.0.0.1", "[::1]"].includes(webUrl.hostname)
    || webUrl.username || webUrl.password) {
    throw new Error("Snapshot inspection requires a loopback Web endpoint.");
  }
  const workspace = input.status.workspace;
  const ref = parseHostedExecutionSnapshotRef(workspace?.snapshotRef);
  if (!workspace || !isHostedWorkspaceSnapshotV2Ref(ref)) {
    throw new Error("Snapshot inspection requires a committed v2 workspace snapshot.");
  }
  if (input.status.userId !== input.userId || workspace.userId !== input.userId
    || ref.userId !== input.userId) {
    throw new Error("Snapshot inspection is outside the requested member workspace.");
  }

  const crypto = await requireHostedUserCryptoContextFromEnvironment({
    domain: "runtime", environment, reason: "hosted-local-snapshot-inspection", userId: input.userId,
  });
  let temporaryRoot: string | undefined;
  try {
    const prepared = await prepareHostedWorkspaceSnapshotRestore({
      configSource: { ...source, HOSTED_R2_PRESIGN_ENDPOINT: r2.controlEndpoint },
      crypto,
      userId: input.userId,
      workspace: { ...workspace, snapshotRef: ref },
    });
    if (!prepared) throw new Error("Snapshot inspection could not prepare the committed encrypted snapshot.");
    temporaryRoot = await mkdtemp(path.join(tmpdir(), "hosted-local-snapshot-inspection-"));
    const signal = AbortSignal.timeout(30_000);
    const response = await fetch(prepared.getUrl, { method: "GET", signal });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error(`Snapshot inspection download failed with HTTP ${response.status}.`);
    }
    const durableRoot = path.join(temporaryRoot, "workspace");
    await restoreEncryptedWorkspaceSnapshotFromEncryptedStream({
      dataKey: prepared.dataKey,
      durableRoot,
      encryptedStream: response.body,
      ref,
      signal,
    });
    const vaultRoot = path.join(durableRoot, "vault");
    const metadata: unknown = JSON.parse(await readFile(path.join(vaultRoot, "vault.json"), "utf8"));
    if (!validateCurrentVaultMetadata(metadata).success) {
      throw new Error("Snapshot inspection did not restore valid canonical vault metadata.");
    }
    return await input.read({ vaultRoot });
  } finally {
    crypto.rootKey.fill(0);
    if (temporaryRoot) await rm(temporaryRoot, { force: true, recursive: true });
  }
}
