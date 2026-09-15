import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import { changeHostedLoginMethodRequest } from "@/src/lib/better-auth/credential-request";

export const POST = withJsonError((request: Request) => changeHostedLoginMethodRequest(request, "remove"));
