import { isHostedOnboardingError } from "../../hosted-onboarding/errors";
import { requireHostedMemberAuthFromBearerToken } from "../../hosted-onboarding/request-auth";
import { getPrisma } from "../../prisma";
import { areGameDevToolsAllowed } from "../access";
import { isGameEnabledFor } from "../service";
import { gameHttpError } from "./errors";

/**
 * A signed-in bearer session is enough: invitees play free, so this skips the
 * paid-member check. Members outside the game flag see the routes as missing.
 */
export async function requireGameMember(request: Request): Promise<string> {
  return (await requireGameMemberAuth(request)).member.id;
}

export async function requireGameMemberAuth(request: Request) {
  let auth: Awaited<ReturnType<typeof requireHostedMemberAuthFromBearerToken>>;
  try {
    auth = await requireHostedMemberAuthFromBearerToken(request, getPrisma());
  } catch (error) {
    if (isHostedOnboardingError(error) && error.httpStatus === 401) {
      throw gameHttpError("UNAUTHENTICATED", 401, "Sign in to continue.");
    }
    throw error;
  }
  if (!(await isGameEnabledFor(auth.member.id))) throw gameDisabled();
  return auth;
}

export function assertGameDevRoutesAllowed(): void {
  if (!areGameDevToolsAllowed()) throw gameDisabled();
}

function gameDisabled() {
  return gameHttpError("GAME_DISABLED", 404, "Not found.");
}
