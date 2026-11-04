import { readCompanionNumbers } from "@/src/lib/device-sync/companion-numbers";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const GET = withJsonError(async (request: Request) => jsonOk(await readCompanionNumbers(request)));
