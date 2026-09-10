import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import { logoutHostedAuth } from "@/src/lib/better-auth/routes";

export const POST = withJsonError((request: Request) => logoutHostedAuth(request, "native"));
