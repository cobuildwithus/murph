import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import { verifyHostedAuthCode } from "@/src/lib/better-auth/routes";

export const POST = withJsonError((request: Request) => verifyHostedAuthCode(request, "native"));
