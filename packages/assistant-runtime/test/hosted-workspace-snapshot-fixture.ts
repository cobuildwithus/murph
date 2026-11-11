import path from "node:path";
import {
  collectHostedWorkspaceSnapshotArchivePlan,
  restoreHostedBundleRoots,
  snapshotHostedBundleRoots,
} from "@murphai/runtime-state/node";

// Exercise current snapshot admission; the generic codec transports the fixture
// without recreating the retired full/delta snapshot producer in tests.
export async function snapshotHostedWorkspaceFixture(input: {
  vaultRoot: string;
  operatorHomeRoot: string;
}) {
  const plan = await collectHostedWorkspaceSnapshotArchivePlan({
    ...input,
    durableRoot: path.dirname(input.vaultRoot),
  });
  const bundle = await snapshotHostedBundleRoots({
    kind: "vault",
    roots: [
      { root: input.vaultRoot, rootKey: "vault" },
      { root: input.operatorHomeRoot, rootKey: "operator-home" },
    ].map((root) => ({
      ...root,
      optional: true,
      shouldIncludeRelativePath: () => false,
      explicitFiles: plan.entries
        .filter((entry) => entry.kind === "file" && entry.root === root.rootKey)
        .map((entry) => entry.relativePath),
    })),
  });
  if (!bundle) throw new Error("Snapshot fixture has no workspace roots.");
  return { bundle, codexHomeSnapshotDiagnostics: plan.codexHomeSnapshotDiagnostics };
}

export async function restoreHostedWorkspaceFixture(input: {
  bundle: Uint8Array;
  workspaceRoot: string;
}) {
  const vaultRoot = path.join(input.workspaceRoot, "vault");
  const operatorHomeRoot = path.join(input.workspaceRoot, "operator-home");
  await restoreHostedBundleRoots({
    bytes: input.bundle,
    expectedKind: "vault",
    roots: { vault: vaultRoot, "operator-home": operatorHomeRoot },
  });
  return { vaultRoot, operatorHomeRoot };
}
