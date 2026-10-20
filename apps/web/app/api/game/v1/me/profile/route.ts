import { respondToGameCommand } from "@/src/lib/game/http/command-route";
import { withJsonError } from "@/src/lib/hosted-onboarding/http";

export const PUT = withJsonError((request: Request) =>
  respondToGameCommand(request, (body) => ({ ...body, type: "setProfile" })));
