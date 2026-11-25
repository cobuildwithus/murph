import { clinicalRecordsError } from "@/src/lib/clinical-records/errors";
import { RequestInputError } from "@murphai/hosted-execution/request-input";
import { clinicalJsonOk, withClinicalJsonError } from "@/src/lib/clinical-records/http";
import { setClinicalProcessorApproval } from "@/src/lib/clinical-records/processor-approvals";
import { clinicalProcessors } from "@/src/lib/clinical-records/processor-registry";
import { requireHostedMemberAuthFromBearerToken } from "@/src/lib/hosted-onboarding/request-auth";
import { readJsonObject } from "@/src/lib/http";

export const POST = withClinicalJsonError(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireHostedMemberAuthFromBearerToken(request);
  const body = await readJsonObject(request, { limitBytes: 1024 });
  const { id } = await context.params;
  const processor = clinicalProcessors.find(entry => entry.id === id);
  if (!processor) {
    throw clinicalRecordsError({ code: "CLINICAL_RECORD_PROCESSOR_NOT_FOUND", httpStatus: 404, message: "Processor not found." });
  }
  if (Object.keys(body).length !== 2 || typeof body.version !== "string" || typeof body.approved !== "boolean") {
    throw new RequestInputError("Submit a single processor, notice version and decision.");
  }
  return clinicalJsonOk(await setClinicalProcessorApproval(auth, processor, body.version, body.approved));
});
