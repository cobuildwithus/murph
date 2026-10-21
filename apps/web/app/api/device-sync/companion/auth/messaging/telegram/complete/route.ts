import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import { nativeMessagingTelegramRequest } from "@/src/lib/better-auth/native-messaging-telegram";

export const POST = withJsonError((request: Request) => nativeMessagingTelegramRequest(request, "complete"));
