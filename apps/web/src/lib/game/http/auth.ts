import { isHostedOnboardingError } from "../../hosted-onboarding/errors";
import { requireHostedMemberAuthFromBearerToken } from "../../hosted-onboarding/request-auth";
import { getPrisma } from "../../prisma";
import { areGameDevToolsAllowed } from "../access";
import { canEnterGame } from "../service";
import { gameHttpError } from "./errors";

/** The invite an app is holding while its member signs up to accept it. */
export const GAME_INVITE_HEADER = "x-murph-game-invite";

/**
 * A signed-in bearer session is enough: invitees play free, so this skips the
 * paid-member check. Members the game isn't on for see the routes as missing.
 * An invite route passes its own token; any other route may carry the invite
 * the app is holding in `GAME_INVITE_HEADER`.
 */
export async function requireGameMember(request: Request, inviteToken?: string): Promise<string> {
  return (await requireGameMemberAuth(request, inviteToken)).member.id;
}

export async function requireGameMemberAuth(request: Request, inviteToken?: string) {
  let auth: Awaited<ReturnType<typeof requireHostedMemberAuthFromBearerToken>>;
  try {
    auth = await requireHostedMemberAuthFromBearerToken(request, getPrisma());
  } catch (error) {
    if (isHostedOnboardingError(error) && error.httpStatus === 401) {
      throw gameHttpError("UNAUTHENTICATED", 401, "Sign in to continue.");
    }
    throw error;
  }
  if (!(await canEnterGame(auth.member.id, inviteToken || request.headers.get(GAME_INVITE_HEADER) || null))) throw gameDisabled();
  return auth;
}

export function assertGameDevRoutesAllowed(): void {
  if (!areGameDevToolsAllowed()) throw gameDisabled();
}

function gameDisabled() {
  return gameHttpError("GAME_DISABLED", 404, "Not found.");
}
