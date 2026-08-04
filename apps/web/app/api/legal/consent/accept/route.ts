import {
  HOSTED_HEALTH_DATA_CONSENT_SCOPE,
  type HostedConsentLaunchScope,
  grantHostedOptionalFeatureConsent,
  parseHostedConsentAcceptRequest,
  readHostedHealthDataConsentState,
  recordHostedLaunchRequiredConsent,
} from "@/src/lib/legal/consent";
import { readHostedRuntimeAiAccessDecision } from "@/src/lib/hosted-onboarding/member-access";
import { signalHostedRuntimeRecheckRuntime } from "@/src/lib/hosted-orchestration/signal-runtime";
import { reconcileHostedHealthDataRuntimeConsent } from "@/src/lib/hosted-privacy/health-data-consent-withdrawal";
import {
  jsonOk,
  readJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { getPrisma } from "@/src/lib/prisma";

function isLaunchScope(scope: string): scope is HostedConsentLaunchScope {
  return scope === "launch.legal" || scope === "launch.health-data";
}

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const prisma = getPrisma();
  const auth = await requireHostedAppSessionFromRequest(request);
  const body = await readJsonObject(request);
  const consent = parseHostedConsentAcceptRequest(body);
  const priorHealthDataConsentState =
    consent.scope === HOSTED_HEALTH_DATA_CONSENT_SCOPE
      ? await readHostedHealthDataConsentState({
          memberId: auth.member.id,
          prisma,
        })
      : null;
  if (
    consent.scope === HOSTED_HEALTH_DATA_CONSENT_SCOPE
    && priorHealthDataConsentState !== "missing"
  ) {
    await reconcileHostedHealthDataRuntimeConsent({
      memberId: auth.member.id,
    });
  }
  const status = isLaunchScope(consent.scope)
    ? await recordHostedLaunchRequiredConsent({
        acceptedDocumentVersions: consent.acceptedDocumentVersions,
        memberId: auth.member.id,
        prisma,
        scope: consent.scope,
        source: consent.source,
      })
    : await grantHostedOptionalFeatureConsent({
        acceptedDocumentVersions: consent.acceptedDocumentVersions,
        memberId: auth.member.id,
        prisma,
        scope: consent.scope,
        source: consent.source,
      });

  if (
    consent.scope === HOSTED_HEALTH_DATA_CONSENT_SCOPE
    && priorHealthDataConsentState !== "missing"
    && (await readHostedRuntimeAiAccessDecision({
      memberId: auth.member.id,
      prisma,
    })).allowed
  ) {
    await signalHostedRuntimeRecheckRuntime({
      prisma,
      userId: auth.member.id,
    });
  }

  return jsonOk(status);
});
