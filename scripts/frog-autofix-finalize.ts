import type { FrogAutofixReadyManifest } from "./frog-autofix-lib.ts";

export interface ReadyRepairIdentity {
  branch: string;
  head: string;
  issueNumber: number;
  pullRequest: number;
}

export interface ReadyRepairRemoteState {
  head: string;
  pullRequest: number;
}

export interface ReadyRepairFinalizationDependencies {
  closeIssue: (identity: ReadyRepairIdentity) => void;
  currentPullRequest: () => ReadyRepairRemoteState | null;
  issueIsClosed: () => boolean;
  merge: (identity: ReadyRepairIdentity) => void;
  mergeTreePasses: (identity: ReadyRepairIdentity) => boolean;
  pullRequestIsMerged: () => boolean;
  refreshAndVerifyIssue: () => void;
  requiredChecksPass: (identity: ReadyRepairIdentity) => boolean;
}

export interface ReadyRepairDependencies
  extends ReadyRepairFinalizationDependencies {
  loadManifest: () => FrogAutofixReadyManifest;
  localHead: () => string;
  reviewEvidencePasses: (
    kind: "final" | "specialist",
    reviewedHead: string,
  ) => boolean;
  specialistHeadIsAncestor: (specialistHead: string, finalHead: string) => boolean;
  worktreeIsClean: () => boolean;
}

function assertRemoteIdentity(
  identity: ReadyRepairIdentity,
  current: ReadyRepairRemoteState | null,
) {
  if (
    !current
    || current.pullRequest !== identity.pullRequest
    || current.head !== identity.head
  ) {
    throw new Error("pull request authority changed before merge");
  }
}

export function finalizeReadyRepair(
  identity: ReadyRepairIdentity,
  dependencies: ReadyRepairFinalizationDependencies,
) {
  assertRemoteIdentity(identity, dependencies.currentPullRequest());
  if (!dependencies.requiredChecksPass(identity)) {
    throw new Error("required pull request checks are not green");
  }
  dependencies.refreshAndVerifyIssue();
  assertRemoteIdentity(identity, dependencies.currentPullRequest());
  if (!dependencies.requiredChecksPass(identity)) {
    throw new Error("required pull request checks changed before merge");
  }
  if (!dependencies.mergeTreePasses(identity)) {
    throw new Error("ready pull request does not merge cleanly into current main");
  }

  // Re-fetch all live authority after the potentially slow merge-tree/check work.
  dependencies.refreshAndVerifyIssue();
  assertRemoteIdentity(identity, dependencies.currentPullRequest());
  if (!dependencies.requiredChecksPass(identity)) {
    throw new Error("required pull request checks changed before merge");
  }
  dependencies.merge(identity);
  if (!dependencies.pullRequestIsMerged()) {
    throw new Error("pull request did not reach merged state");
  }
  if (!dependencies.issueIsClosed()) dependencies.closeIssue(identity);
  if (!dependencies.issueIsClosed()) {
    throw new Error("issue did not close after the verified merge");
  }
}

export function validateAndFinalizeReadyRepair(
  context: { branch: string; issueNumber: number },
  dependencies: ReadyRepairDependencies,
) {
  if (!dependencies.worktreeIsClean()) {
    throw new Error("ready issue worktree is not clean");
  }
  const manifest = dependencies.loadManifest();
  if (dependencies.localHead() !== manifest.head) {
    throw new Error("ready manifest head does not match the issue branch");
  }
  const current = dependencies.currentPullRequest();
  if (
    !current
    || current.pullRequest !== manifest.pullRequest
    || current.head !== manifest.head
  ) {
    throw new Error("ready manifest does not match one exact open pull request");
  }
  if (!dependencies.specialistHeadIsAncestor(
    manifest.specialistHead,
    manifest.head,
  )) {
    throw new Error("specialist reviewed head is not an ancestor of the ready head");
  }
  for (const [kind, reviewedHead] of [
    ["specialist", manifest.specialistHead],
    ["final", manifest.head],
  ] as const) {
    if (!dependencies.reviewEvidencePasses(kind, reviewedHead)) {
      throw new Error(`${kind} ReviewGPT evidence is invalid`);
    }
  }
  finalizeReadyRepair({
    branch: context.branch,
    head: manifest.head,
    issueNumber: context.issueNumber,
    pullRequest: manifest.pullRequest,
  }, dependencies);
}
