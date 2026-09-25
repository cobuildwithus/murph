import type { WorkerRuntimeCompletionReceipt, WorkerProviderEgressCredentialValidationResult, WorkerProviderEgressTokenValidationResult } from "../src/worker-contracts.ts";

import type { HostedBrowserVaultReplicaOrphanCandidate } from "../src/browser-vault-store.ts";

import type {
  HostedPrivateMediaPublishInput,
  HostedPrivateMediaPublishResult,
} from "../src/private-media.ts";

import type {
  HostedWorkspaceSnapshotOrphanCandidate,
  HostedWorkspaceSnapshotUploadSession,
} from "../src/workspace-snapshot-store.ts";

export interface ResourceTestBackend {

  recordRunnerContainerRetired?(input: {
    runnerContainerName: string;
    userId: string;
  }): Promise<{ cleared: boolean }>;
  bindUser?(userId: string): Promise<{ userId: string }>;
  deleteHostedUserData?(userId: string): Promise<unknown>;
  reconcileRuntimeHealthDataConsentForUser?(userId: string): Promise<unknown>;
  publishHostedPrivateMedia?(
    input: HostedPrivateMediaPublishInput,
  ): Promise<HostedPrivateMediaPublishResult>;
  createHostedWorkspaceSnapshotUploadSession?(
    input: HostedWorkspaceSnapshotUploadSession,
  ): Promise<HostedWorkspaceSnapshotUploadSession | null>;
  heartbeatHostedWorkspaceSnapshotUploadSession?(input: {
    attemptId: string;
    leaseGeneration: string;
    snapshotId: string;
    userId: string;
  }): Promise<boolean>;
  completeHostedWorkspaceSnapshotUploadSession?(input: {
    attemptId: string;
    leaseGeneration: string;
    snapshotId: string;
    userId: string;
  }): Promise<boolean>;
  rememberHostedWorkspaceSnapshotReplacedRef?(input: {
    expectedSession: HostedWorkspaceSnapshotUploadSession;
    replacedSnapshotRef: NonNullable<HostedWorkspaceSnapshotUploadSession["replacedSnapshotRef"]>;
  }): Promise<boolean>;
  rememberHostedWorkspaceSnapshotPresignedPut?(input: {
    drainUntil: string;
    expectedSession: HostedWorkspaceSnapshotUploadSession;
    expiresAt: string;
  }): Promise<HostedWorkspaceSnapshotUploadSession | null>;
  admitHostedBrowserVaultReplicaDirectPut?(input: {
    admittedAt: string;
    attemptId: string;
    leaseGeneration: string;
    userId: string;
    writeId: string;
  }): Promise<boolean>;
  releaseHostedBrowserVaultReplicaDirectPut?(input: {
    userId: string;
    writeId: string;
  }): Promise<void>;
  deleteHostedWorkspaceSnapshotUploadSession?(input: {
    snapshotId: string;
    userId: string;
  }): Promise<{ deleted: boolean }>;
  readHostedWorkspaceSnapshotUploadSession?(input: {
    snapshotId: string;
    userId: string;
  }): Promise<HostedWorkspaceSnapshotUploadSession | null>;
  recordHostedWorkspaceSnapshotOrphanCandidate?(
    input: HostedWorkspaceSnapshotOrphanCandidate,
  ): Promise<HostedWorkspaceSnapshotOrphanCandidate>;
  recordHostedBrowserVaultReplicaOrphanCandidate?(
    input: HostedBrowserVaultReplicaOrphanCandidate,
  ): Promise<HostedBrowserVaultReplicaOrphanCandidate>;
  validateRuntimeWriteFence?(input: {
    attemptId: string;
    generation: string;
    userId: string;
  }): Promise<boolean>;
  admitHostedMediaRead?(
    input: HostedMediaAssetDescriptor,
  ): Promise<HostedMediaAssetReadAdmissionResult>;
  recordHostedMediaAsset?(
    input: HostedMediaAssetRegistrationInput,
  ): Promise<boolean>;
  forgetHostedMediaAsset?(
    input: HostedMediaAssetDeletionInput,
  ): Promise<boolean>;
  recordRuntimeCompletionFromContainer?(
    input: WorkerRuntimeCompletionReceipt,
  ): Promise<{ completed: boolean }>;
  revokeActiveRuntimePlatformAiUsage?(input: {
    attemptId: string;
    generation: string;
    userId: string;
  }): Promise<boolean>;
  validateRuntimeProviderEgressToken?(input: {
    providerEgressToken: string;
    userId: string;
  }): Promise<WorkerProviderEgressTokenValidationResult>;
  validateRuntimeProviderEgressCredential?(input: {
    providerKind: string;
    runnerContainerName: string;
    userId: string;
  }): Promise<WorkerProviderEgressCredentialValidationResult>;
}

export interface BoundResourceTestBackend extends ResourceTestBackend {
  bindUser(userId: string): Promise<{ userId: string }>;
}

export interface ResourceTestBackends<
  TStub extends ResourceTestBackend = ResourceTestBackend,
> {
  getByName(name: string): TStub;
  idFromName?(name: string): { toString(): string };
  idFromString?(id: string): unknown;
  get?(id: unknown): TStub;
}

export interface HostedMediaAssetDescriptor {
  byteSize: number;
  expiresAt?: string | null;
  mediaId: string;
  mediaKind: "image" | "video";
  sha256: string;
  userId: string;
}

export interface HostedMediaAssetRegistrationInput
  extends HostedMediaAssetDescriptor {
  attemptId: string;
  leaseGeneration: string;
}

export interface HostedMediaAssetDeletionInput {
  attemptId: string;
  leaseGeneration: string;
  mediaId: string;
  userId: string;
}

export interface HostedMediaAssetReadAdmissionResult {
  ok: boolean;
  reason:
    | "active"
    | "descriptor_mismatch"
    | "expired"
    | "unregistered";
}

