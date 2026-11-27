import { vi } from "vitest";
import type { HostedExecutionClinicalRecordsSyncRequestedWake } from "@murphai/hosted-execution";
import type { HostedMailboxItem } from "@murphai/hosted-execution/runtime-control";
import type {
  HostedClinicalRecordsFetchDocumentRequest, HostedClinicalRecordsFetchDocumentResponse,
  HostedClinicalChangeProof, HostedClinicalRecordsFetchPageRequest, HostedClinicalRecordsFetchPageResponse,
  HostedClinicalRecordsReadRunRequest, HostedClinicalRecordsReadRunResponse, HostedClinicalRecordsRecordOutcomeRequest,
} from "@murphai/hosted-execution/clinical-records";

export type ClinicalCheckpointInput = {
  item: HostedMailboxItem;
  wake: HostedExecutionClinicalRecordsSyncRequestedWake;
  vaultRoot: string;
  workspaceRoot: string;
  port: {
    readRun(request: HostedClinicalRecordsReadRunRequest): Promise<HostedClinicalRecordsReadRunResponse>;
    fetchDocument(request: HostedClinicalRecordsFetchDocumentRequest): Promise<HostedClinicalRecordsFetchDocumentResponse>;
    fetchPage(request: HostedClinicalRecordsFetchPageRequest): Promise<HostedClinicalRecordsFetchPageResponse>;
    recordOutcome(request: HostedClinicalRecordsRecordOutcomeRequest | HostedClinicalChangeProof): Promise<void>;
  };
  publishAndRestore: (ref: { hash: string; key: string; size: number; updatedAt: string }) => Promise<string>;
};

// Load the runtime in Vitest. Its Node environment is typechecked in the runtime project.
export async function checkpointClinicalMailboxItem(input: ClinicalCheckpointInput) {
  const runtime = await vi.importActual<{ checkpointClinicalMailboxItem(input: ClinicalCheckpointInput): Promise<void> }>(
    "./clinical-connector-checkpoint.ts",
  );
  await runtime.checkpointClinicalMailboxItem(input);
}
