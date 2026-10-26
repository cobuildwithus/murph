import { isHostedOnboardingError } from "../../hosted-onboarding/errors";
import { requireHostedMemberAuthFromBearerToken } from "../../hosted-onboarding/request-auth";
import { readHostedConsentStatus } from "../../legal/consent";
import { getPrisma } from "../../prisma";
import { areGameDevToolsAllowed } from "../access";
import type { GameCommand } from "../contract";
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

/**
 * Starting, joining and playing a game: the writes that need Murph's current
 * Terms. Reading, reporting, blocking, a profile, and taking back your own
 * post, invite or change never wait on them.
 */
const NEEDS_CURRENT_TERMS: ReadonlySet<unknown> = new Set<GameCommand["type"]>([
  "createGame", "join", "negotiate", "post", "proposeChange", "redeem",
]);

/**
 * With `MURPH_GAME_REQUIRE_CURRENT_TERMS=true`, those writes need the
 * `launch.legal` grant at today's document versions, so a version bump asks
 * players once before they play on. Anything else, or unset, changes nothing.
 * The refusal names the documents to agree to, with their versions.
 */
export async function requireCurrentTermsFor(
  memberId: string,
  command: { type?: unknown },
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<void> {
  if (env.MURPH_GAME_REQUIRE_CURRENT_TERMS !== "true" || !NEEDS_CURRENT_TERMS.has(command.type)) return;
  const status = await readHostedConsentStatus({ memberId, prisma: getPrisma() });
  const terms = status.scopes.find((scope) => scope.scope === "launch.legal");
  if (terms?.granted) return;
  throw gameHttpError("TERMS_REQUIRED", 403, "Agree to Murph's Terms to keep playing.", false, {
    documents: terms?.documents ?? [],
    scope: "launch.legal",
  });
}

export function assertGameDevRoutesAllowed(): void {
  if (!areGameDevToolsAllowed()) throw gameDisabled();
}

function gameDisabled() {
  return gameHttpError("GAME_DISABLED", 404, "Not found.");
}
