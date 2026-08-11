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
  autoMergeAllowed: (identity: ReadyRepairIdentity) => boolean;
  closeIssue: (identity: ReadyRepairIdentity) => void;
  currentPullRequest: () => ReadyRepairRemoteState | null;
  issueIsClosed: () => boolean;
  merge: (identity: ReadyRepairIdentity) => void;
  mergeTreePasses: (identity: ReadyRepairIdentity) => boolean;
  pullRequestIsMerged: () => boolean;
  refreshAndVerifyIssue: () => void;
  requiredChecksPass: (identity: ReadyRepairIdentity) => boolean;
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
): "awaiting-human" | "merged" {
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

  // The exact-head scope gate is intentionally last and fail-closed. Any path
  // outside the narrow local-agent allowlist requires a human merge decision.
  if (!dependencies.autoMergeAllowed(identity)) return "awaiting-human";

  dependencies.refreshAndVerifyIssue();
  assertRemoteIdentity(identity, dependencies.currentPullRequest());
  if (!dependencies.requiredChecksPass(identity)) {
    throw new Error("required pull request checks changed before merge");
  }
  if (!dependencies.autoMergeAllowed(identity)) return "awaiting-human";
  dependencies.merge(identity);
  if (!dependencies.pullRequestIsMerged()) {
    throw new Error("pull request did not reach merged state");
  }
  if (!dependencies.issueIsClosed()) dependencies.closeIssue(identity);
  if (!dependencies.issueIsClosed()) {
    throw new Error("issue did not close after the verified merge");
  }
  return "merged";
}
