import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import { exchangeHostedAuthSession } from "@/src/lib/better-auth/routes";

export const POST = withJsonError(exchangeHostedAuthSession);
