import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import { readHostedAuthSessionResponse } from "@/src/lib/better-auth/routes";

export const GET = withJsonError((request: Request) => readHostedAuthSessionResponse(request, "native"));
export const POST = withJsonError((request: Request) => readHostedAuthSessionResponse(request, "native", true));
