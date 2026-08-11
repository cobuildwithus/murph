import { requireHostedOpsRequestAccess } from "@/src/lib/hosted-ops/access";
import {
  HostedLegacyPulseTrialCandidateCountChangedError,
  HostedLegacyPulseTrialRetirementBlockedError,
  runHostedLegacyPulseTrialRetirement,
} from "@/src/lib/hosted-onboarding/legacy-pulse-trial-retirement";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  readHostedOnboardingJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import {
  requireHostedStripeApiMode,
  requireValidatedHostedStripeBillingPlanConfig,
} from "@/src/lib/hosted-onboarding/runtime";
import { getPrisma } from "@/src/lib/prisma";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 300;
export const revalidate = 0;

const REQUEST_BODY_LIMIT_BYTES = 2 * 1024;

export const POST = withJsonError(async (request: Request) => {
  await requireHostedOpsRequestAccess(request, {
    requireMutationOrigin: true,
  });
  const body = await readHostedOnboardingJsonObject(request, {
    limitBytes: REQUEST_BODY_LIMIT_BYTES,
    tooLargeErrorCode: "HOSTED_OPS_LEGACY_TRIAL_RETIREMENT_REQUEST_TOO_LARGE",
    tooLargeErrorMessage:
      "Legacy trial retirement request body is too large.",
  });
  const operation = readOperation(body.operation);
  const expectedCandidates = readExpectedCandidates(
    body.expectedCandidates,
    operation,
  );
  const { stripeLiveMode } = requireHostedStripeApiMode();
  const config = await requireValidatedHostedStripeBillingPlanConfig({
    billingPlanCode: "launch_monthly",
  });
  const commonInput = {
    priceId: config.priceId,
    prisma: getPrisma(),
    stripe: config.stripe,
    stripeMode: stripeLiveMode ? "live" : "test",
  } as const;

  try {
    if (operation === "dry-run") {
      const report = await runHostedLegacyPulseTrialRetirement({
        ...commonInput,
        apply: false,
      });
      console.info("Hosted ops legacy trial retirement dry-run completed.", {
        candidateCount: report.candidateCount,
        missingProviderCount: report.missingProviderCount,
        stripeMode: report.stripeMode,
        subscriptionStatusCounts: report.subscriptionStatusCounts,
      });
      return jsonOk({ operation, report });
    }

    const report = await runHostedLegacyPulseTrialRetirement({
      ...commonInput,
      apply: true,
      expectedCandidates,
    });
    const verification = await runHostedLegacyPulseTrialRetirement({
      ...commonInput,
      apply: false,
    });
    const converged = verification.candidateCount === 0;
    console.info("Hosted ops legacy trial retirement apply completed.", {
      alreadyRetiredCount: report.alreadyRetiredCount,
      converged,
      expectedCandidates,
      remainingCandidateCount: verification.candidateCount,
      retiredCount: report.retiredCount,
      stripeMode: report.stripeMode,
    });
    return jsonOk({
      converged,
      operation,
      report,
      verification,
    });
  } catch (error) {
    if (error instanceof HostedLegacyPulseTrialCandidateCountChangedError) {
      throw hostedOnboardingError({
        code: "HOSTED_OPS_LEGACY_TRIAL_CANDIDATE_COUNT_CHANGED",
        details: {
          expectedCandidates: error.expectedCandidates,
          observedCandidates: error.observedCandidates,
        },
        httpStatus: 409,
        message: error.message,
        retryable: false,
      });
    }
    if (error instanceof HostedLegacyPulseTrialRetirementBlockedError) {
      throw hostedOnboardingError({
        code: "HOSTED_OPS_LEGACY_TRIAL_RETIREMENT_BLOCKED",
        httpStatus: 409,
        message: error.message,
        retryable: false,
      });
    }
    throw error;
  }
});

function readOperation(value: unknown): "apply" | "dry-run" {
  if (value === "apply" || value === "dry-run") {
    return value;
  }
  throw hostedOnboardingError({
    code: "HOSTED_OPS_LEGACY_TRIAL_RETIREMENT_OPERATION_INVALID",
    httpStatus: 400,
    message: "Choose dry-run or apply for legacy trial retirement.",
    retryable: false,
  });
}

function readExpectedCandidates(
  value: unknown,
  operation: "apply" | "dry-run",
): number | undefined {
  if (operation === "dry-run") {
    if (value === undefined) {
      return undefined;
    }
  } else if (
    typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
  ) {
    return value;
  }

  throw hostedOnboardingError({
    code: "HOSTED_OPS_LEGACY_TRIAL_RETIREMENT_EXPECTED_COUNT_INVALID",
    httpStatus: 400,
    message:
      operation === "apply"
        ? "Run a fresh dry-run and submit its exact candidate count."
        : "Dry-run does not accept an expected candidate count.",
    retryable: false,
  });
}
