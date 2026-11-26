import { RequestInputError } from "@murphai/hosted-execution/request-input";
import { clinicalJsonOk, withClinicalJsonError } from "@/src/lib/clinical-records/http";
import { setClinicalRecordMessageMode } from "@/src/lib/clinical-records/message-preference";
import { requireHostedMemberAuthFromBearerToken } from "@/src/lib/hosted-onboarding/request-auth";
import { readJsonObject } from "@/src/lib/http";

export const POST = withClinicalJsonError(async (request: Request) => {
  const auth = await requireHostedMemberAuthFromBearerToken(request);
  const body = await readJsonObject(request, { limitBytes: 1024 });
  const { mode } = body;
  if (Object.keys(body).length !== 1 || (mode !== "off" && mode !== "notice" && mode !== "detail")) {
    throw new RequestInputError("Invalid clinical record message mode.");
  }
  return clinicalJsonOk(await setClinicalRecordMessageMode(auth, mode === "detail" ? "notice" : mode));
});
