import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import { startHostedTelegramLogin } from "@/src/lib/better-auth/telegram-request";

export const POST = withJsonError(startHostedTelegramLogin);
