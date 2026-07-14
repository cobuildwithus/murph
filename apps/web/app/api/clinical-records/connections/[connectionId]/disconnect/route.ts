import { disconnectClinicalRecordConnection } from "@/src/lib/clinical-records/connections";
import { clinicalJsonOk, withClinicalJsonError } from "@/src/lib/clinical-records/http";
import { resolveDecodedRouteParam } from "@/src/lib/http";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";

export async function GET(): Promise<Response> {
  return Response.json({ error: { code: "METHOD_NOT_ALLOWED", message: "Clinical Records disconnect only allows POST." } }, {
    headers: { Allow: "POST", "Cache-Control": "no-store" },
    status: 405,
  });
}

export const POST = withClinicalJsonError(async (
  request: Request,
  context: { params: Promise<{ connectionId: string }> },
) => {
  assertHostedOnboardingMutationOrigin(request);
  const connectionId = await resolveDecodedRouteParam(context.params, "connectionId");
  return clinicalJsonOk({
    ok: true,
    ...await disconnectClinicalRecordConnection({ connectionId, request }),
  });
});
