import { readCompanionMemberAction } from "@/src/lib/device-sync/companion-demographics";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const GET = withJsonError(async (request: Request, context: { params: Promise<{ actionId: string }> }) =>
  jsonOk(await readCompanionMemberAction(request, (await context.params).actionId)));
