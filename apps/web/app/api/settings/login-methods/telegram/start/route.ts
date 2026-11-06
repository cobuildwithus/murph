import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import { changeHostedTelegramCredential } from "@/src/lib/better-auth/credential-telegram";

export const POST = withJsonError((request: Request) => changeHostedTelegramCredential(request, "start"));
