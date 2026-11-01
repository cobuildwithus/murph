type GameEnv = Readonly<Record<string, string | undefined>>;

const MURPH_APP_URL_SCHEME = "ai.withmurph.app";

/**
 * The Murph app link an invite page opens. `MURPH_GAME_APP_URL_SCHEME`
 * overrides the scheme (local stacks set the Debug app's `ai.withmurph.app.dev`);
 * anything that isn't a plain URL scheme falls back to the Murph app's own.
 */
export function gameInviteAppUrl(token: string, env: GameEnv = process.env): string {
  return gameAppUrl("invite", token, env);
}

export function gameRecapAppUrl(gameId: string, env: GameEnv = process.env): string {
  return gameAppUrl("recap", gameId, env);
}

function gameAppUrl(kind: "invite" | "recap", id: string, env: GameEnv): string {
  const configured = env.MURPH_GAME_APP_URL_SCHEME?.trim() ?? "";
  const scheme = /^[a-z][a-z0-9+.-]*$/iu.test(configured) ? configured : MURPH_APP_URL_SCHEME;
  return `${scheme}://${kind}/${encodeURIComponent(id)}`;
}

