import {
  createEncryptedWorkspaceSnapshotFile,
} from "./workspace-snapshot-local.ts";
import type {
  HostedWorkspaceSnapshotArchiveBuilder,
} from "@murphai/assistant-runtime/hosted-invocation";

export function createCloudflareHostedWorkspaceSnapshotArchiveBuilder():
  HostedWorkspaceSnapshotArchiveBuilder {
  return {
    async buildEncryptedSnapshot(input) {
      return await createEncryptedWorkspaceSnapshotFile({
        aad: input.aad,
        archiveEntries: input.archiveEntries,
        dataKey: input.dataKey,
        durableRoot: input.durableRoot,
        ivBase64: input.ivBase64,
        maxEncryptedBytes: input.maxEncryptedBytes,
        outputDir: input.outputDir,
      });
    },
  };
}
