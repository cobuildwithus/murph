import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import { sendHostedAuthCode } from "@/src/lib/better-auth/routes";

export const POST = withJsonError((request: Request) => sendHostedAuthCode(request, "browser"));
