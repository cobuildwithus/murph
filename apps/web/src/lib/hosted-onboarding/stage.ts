export type HostedOnboardingStage =
  | "invalid"
  | "expired"
  | "verify"
  | "checkout"
  | "blocked"
  | "active";

export type HostedPostVerificationStage = Extract<
  HostedOnboardingStage,
  "checkout" | "blocked" | "active"
>;

export type HostedAccessibleOnboardingStage = Extract<
  HostedOnboardingStage,
  "active"
>;

export function isHostedOnboardingAccessibleStage(
  stage: HostedOnboardingStage,
): stage is HostedAccessibleOnboardingStage {
  return stage === "active";
}

export function isHostedOnboardingPendingStage(
  stage: HostedOnboardingStage,
): boolean {
  return stage === "verify" || stage === "checkout";
}
