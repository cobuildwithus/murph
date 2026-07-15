import {
  finishClinicalRecordAuthorization,
} from "@/src/lib/clinical-records/control-plane";
import {
  isClinicalRecordsControlPlaneError,
} from "@/src/lib/clinical-records/errors";
import { isHostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { resolveHostedPublicBaseUrl } from "@/src/lib/hosted-web/public-url";
import type { ClinicalRecordCallbackMarker } from "@/src/lib/clinical-records/client-contracts";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const providerDenied = Boolean(url.searchParams.get("error"));
  try {
    await finishClinicalRecordAuthorization({
      code: url.searchParams.get("code"),
      providerDenied,
      request,
      state,
    });
    return callbackRedirect(request, "connected");
  } catch (error) {
    const diagnostic = callbackFailureDiagnostic(error);
    console.warn("Clinical Records OAuth callback failed.", {
      code: diagnostic.code,
      errorType: diagnostic.errorType,
      providerDenied,
    });
    return callbackRedirect(request, callbackFailureMarker(error));
  }
}

function callbackFailureDiagnostic(error: unknown): {
  code: string;
  errorType: "clinical-records" | "hosted-onboarding" | "unexpected";
} {
  if (isClinicalRecordsControlPlaneError(error)) {
    return { code: normalizeDiagnosticCode(error.code), errorType: "clinical-records" };
  }
  if (isHostedOnboardingError(error)) {
    return { code: normalizeDiagnosticCode(error.code), errorType: "hosted-onboarding" };
  }
  return { code: "UNEXPECTED", errorType: "unexpected" };
}

function normalizeDiagnosticCode(value: string): string {
  return /^[A-Z0-9_]{1,100}$/u.test(value) ? value : "UNEXPECTED";
}

function callbackFailureMarker(error: unknown): Exclude<ClinicalRecordCallbackMarker, "connected"> {
  if (isHostedOnboardingError(error) && error.code === "AUTH_REQUIRED") return "auth-required";
  if (!isClinicalRecordsControlPlaneError(error)) return "failed";
  if (error.code === "CLINICAL_RECORD_AUTHORIZATION_DECLINED") return "declined";
  if (error.code === "CLINICAL_RECORD_OAUTH_STATE_EXPIRED") return "expired";
  return "failed";
}

function callbackRedirect(request: Request, result: ClinicalRecordCallbackMarker): Response {
  const baseUrl = resolveHostedPublicBaseUrl() ?? new URL(request.url).origin;
  const destination = new URL("/records", `${baseUrl}/`);
  destination.searchParams.set("clinicalRecords", result);
  return new Response(null, {
    headers: {
      "Cache-Control": "no-store",
      Location: destination.toString(),
      "Referrer-Policy": "no-referrer",
    },
    status: 303,
  });
}
