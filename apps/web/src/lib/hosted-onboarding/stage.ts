export type HostedOnboardingStage =
  | "invalid"
  | "expired"
  | "verify"
  | "checkout"
  | "activating"
  | "blocked"
  | "active";

export type HostedPostVerificationStage = Extract<
  HostedOnboardingStage,
  "checkout" | "activating" | "blocked" | "active"
>;

export type HostedAccessibleOnboardingStage = Extract<
  HostedOnboardingStage,
  "activating" | "active"
>;

export function resolveHostedAccessibleOnboardingStage(
  activationPending?: boolean,
): HostedAccessibleOnboardingStage {
  return activationPending ? "activating" : "active";
}

export function isHostedOnboardingAccessibleStage(
  stage: HostedOnboardingStage,
): stage is HostedAccessibleOnboardingStage {
  return stage === "active" || stage === "activating";
}

export function isHostedOnboardingPendingStage(
  stage: HostedOnboardingStage,
): boolean {
  return stage === "verify" || stage === "checkout" || stage === "activating";
}
