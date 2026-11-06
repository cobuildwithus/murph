import { queueCompanionMeasurement } from "@/src/lib/device-sync/companion-measurements";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const POST = withJsonError(async (request: Request) => jsonOk(await queueCompanionMeasurement(request), 202));
