export interface ReadyRepairIdentity {
  bodySha256: string;
  branch: string;
  head: string;
  issueNumber: number;
  pullRequest: number;
  taskPath: string;
  taskSha256: string;
}

export interface ReadyRepairRemoteState {
  bodyAuthoritative: boolean;
  bodySha256: string;
  head: string;
  issueBound: boolean;
  pullRequest: number;
}

export interface ReadyRepairFinalizationDependencies {
  autoMergeAllowed: (identity: ReadyRepairIdentity) => boolean;
  closeIssue: (identity: ReadyRepairIdentity) => void;
  currentPullRequest: () => ReadyRepairRemoteState | null;
  issueIsClosed: () => boolean;
  merge: (identity: ReadyRepairIdentity) => void;
  mergeTreePasses: (identity: ReadyRepairIdentity) => boolean;
  pullRequestIsMerged: (identity: ReadyRepairIdentity) => boolean;
  refreshAndVerifyIssue: () => void;
  requiredChecksPass: (identity: ReadyRepairIdentity) => boolean;
  reviewControlsMatch: (identity: ReadyRepairIdentity) => boolean;
  taskAuthorityMatches: (identity: ReadyRepairIdentity) => boolean;
}

function assertRemoteIdentity(
  identity: ReadyRepairIdentity,
  current: ReadyRepairRemoteState | null,
) {
  if (
    !/^[0-9a-f]{64}$/u.test(identity.bodySha256)
    || !current
    || current.pullRequest !== identity.pullRequest
    || current.head !== identity.head
    || current.bodySha256 !== identity.bodySha256
    || !current.bodyAuthoritative
    || !current.issueBound
  ) {
    throw new Error("pull request authority changed before merge");
  }
}

export function finalizeReadyRepair(
  identity: ReadyRepairIdentity,
  dependencies: ReadyRepairFinalizationDependencies,
): "awaiting-human-authority" | "awaiting-human-conflict" | "awaiting-human-product" | "awaiting-human-review" | "merged" {
  if (
    !/^\.agents\/friction-log\/[^/\r\n]+\/friction\.md$/u.test(identity.taskPath)
    || !/^[0-9a-f]{64}$/u.test(identity.taskSha256)
  ) {
    throw new Error("repair task identity is invalid");
  }
  assertRemoteIdentity(identity, dependencies.currentPullRequest());
  if (!dependencies.requiredChecksPass(identity)) {
    throw new Error("required pull request checks are not green");
  }
  dependencies.refreshAndVerifyIssue();
  if (!dependencies.taskAuthorityMatches(identity)) {
    return "awaiting-human-authority";
  }
  if (!dependencies.reviewControlsMatch(identity)) {
    return "awaiting-human-review";
  }
  assertRemoteIdentity(identity, dependencies.currentPullRequest());
  if (!dependencies.requiredChecksPass(identity)) {
    throw new Error("required pull request checks changed before merge");
  }
  if (!dependencies.mergeTreePasses(identity)) {
    return "awaiting-human-conflict";
  }

  // The exact-head scope gate is intentionally last and fail-closed. Any path
  // outside the narrow local-agent allowlist requires a human merge decision.
  if (!dependencies.autoMergeAllowed(identity)) return "awaiting-human-product";

  dependencies.refreshAndVerifyIssue();
  assertRemoteIdentity(identity, dependencies.currentPullRequest());
  if (!dependencies.requiredChecksPass(identity)) {
    throw new Error("required pull request checks changed before merge");
  }
  if (!dependencies.autoMergeAllowed(identity)) return "awaiting-human-product";
  if (!dependencies.taskAuthorityMatches(identity)) {
    return "awaiting-human-authority";
  }
  if (!dependencies.reviewControlsMatch(identity)) {
    return "awaiting-human-review";
  }
  assertRemoteIdentity(identity, dependencies.currentPullRequest());
  dependencies.merge(identity);
  if (!dependencies.pullRequestIsMerged(identity)) {
    throw new Error("pull request did not reach merged state");
  }
  if (!dependencies.issueIsClosed()) dependencies.closeIssue(identity);
  if (!dependencies.issueIsClosed()) {
    throw new Error("issue did not close after the verified merge");
  }
  return "merged";
}
