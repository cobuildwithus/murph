import { vi } from "vitest";
import type { HostedExecutionClinicalRecordsSyncRequestedWake } from "@murphai/hosted-execution";
import type { HostedMailboxItem } from "@murphai/hosted-execution/runtime-control";
import type { HostedRuntimeClinicalRecordsPort } from "../src/hosted-runtime/platform.ts";

export { createHostedRuntimeWorkspace } from "./hosted-runtime-test-helpers.ts";

export type ClinicalCheckpointInput = {
  item: HostedMailboxItem;
  wake: HostedExecutionClinicalRecordsSyncRequestedWake;
  vaultRoot: string;
  workspaceRoot: string;
  port: HostedRuntimeClinicalRecordsPort;
  publishAndRestore: (ref: { hash: string; key: string; size: number; updatedAt: string }) => Promise<string>;
};

// Load the runtime in Vitest. Its Node environment is typechecked in the runtime project.
export async function checkpointClinicalMailboxItem(input: ClinicalCheckpointInput) {
  const runtime = await vi.importActual<{ checkpointClinicalMailboxItem(input: ClinicalCheckpointInput): Promise<void> }>(
    "./clinical-connector-checkpoint.ts",
  );
  await runtime.checkpointClinicalMailboxItem(input);
}
