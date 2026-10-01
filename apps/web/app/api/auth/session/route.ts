import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import { readHostedAuthSessionResponse } from "@/src/lib/better-auth/routes";

export const GET = withJsonError((request: Request) => readHostedAuthSessionResponse(request, "browser"));
export const POST = withJsonError((request: Request) => readHostedAuthSessionResponse(request, "browser", true));
