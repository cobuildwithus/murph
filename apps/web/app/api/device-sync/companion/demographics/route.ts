import { queueCompanionDemographics } from "@/src/lib/device-sync/companion-demographics";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const PUT = withJsonError(async (request: Request) => jsonOk(await queueCompanionDemographics(request), 202));
