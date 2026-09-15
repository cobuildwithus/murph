import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import { verifyHostedTelegramLogin } from "@/src/lib/better-auth/telegram-request";

export const POST = withJsonError(verifyHostedTelegramLogin);
