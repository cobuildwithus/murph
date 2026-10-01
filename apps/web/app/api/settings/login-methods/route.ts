import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import { readHostedLoginMethodsRequest } from "@/src/lib/better-auth/credential-request";

export const GET = withJsonError(readHostedLoginMethodsRequest);
