import type { GameCommand, GameStakeKind } from "./contract";
import { reject } from "./rules";

/**
 * The one write-time check on the words players share with each other, run
 * on every command before anything is stored (`runGameCommand`), for the app
 * and Murph's chat tools alike. It is local and small, whole words only: no
 * money in a prize or dare, nothing clearly dangerous in a task, prize or
 * dare, and no slurs, explicit sexual words or telling someone to hurt
 * themselves anywhere. There is no provider and no image check; if one is
 * needed later it plugs in at `moderateGameCommand` (a photo at post time,
 * before the other player can unlock it). That choice is the owner's.
 */

export type GameTextKind = "name" | "task" | "prize" | "dare" | "words" | "excuse";

export interface GameText {
  kind: GameTextKind;
  text: string;
}

export const GAME_CONTENT_REJECTED = "This can't be posted.";

/** Rejects the command when anything it shares fails the check. */
export function moderateGameCommand(command: GameCommand): void {
  if (gameCommandTexts(command).some(({ kind, text }) => isRefused(kind, text))) reject("CONTENT_NOT_ALLOWED", GAME_CONTENT_REJECTED);
}

/** What a command shares with the other player. Private labels and report notes aren't shared. */
export function gameCommandTexts(command: GameCommand): GameText[] {
  const texts: GameText[] = [];
  const terms = (tasks?: { text: string }[], stakes?: { kind: GameStakeKind; item: string }[]) => {
    for (const task of tasks ?? []) texts.push({ kind: "task", text: task.text });
    for (const stake of stakes ?? []) texts.push({ kind: stake.kind === "dare" ? "dare" : "prize", text: stake.item });
  };
  switch (command.type) {
    case "setProfile":
      if (command.firstName !== undefined) texts.push({ kind: "name", text: command.firstName });
      break;
    case "createGame":
      terms(command.terms.tasks, command.terms.stakes);
      break;
    case "proposeChange":
    case "negotiate":
      if (command.change.kind === "edit") terms(command.change.tasks, command.change.stakes);
      break;
    case "post":
      if (command.text) texts.push({ kind: command.kind === "excuse" ? "excuse" : "words", text: command.text });
      break;
    default:
      break;
  }
  return texts;
}

// Money: a currency sign, an amount in dollars or bucks, or a payment app.
const MONEY = [
  /[$€£¥₹₩₽₺₦₱₪₫฿₴₸₿¢]/u,
  /\b\d[\d,.]*\s*k?\s*(?:dollars?|bucks|usd|quid)\b/u,
  /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|hundred|thousand) (?:dollars|bucks|quid)\b/u,
  /\b(?:venmo|paypal|zelle|cash ?app|apple cash|revolut|bitcoin|crypto)\b/u,
];

// Clearly dangerous challenges: drinking or drugs, toxic or extreme stunts, starving.
const DANGER = [
  /\b(?:chug|chugging|keg stand)\b/u,
  /\bshots? of (?:vodka|tequila|whiske?y|rum|gin|liquor|alcohol|everclear)\b/u,
  /\b(?:vodka|tequila|whiske?y|rum|liquor|everclear) shots?\b/u,
  /\b(?:get|getting) (?:drunk|wasted|blackout)\b/u,
  /\b(?:drunk driv\w*|drive drunk|without a seat ?belt|run a red light)\b/u,
  /\b(?:cocaine|heroin|meth|fentanyl|mdma|ketamine)\b/u,
  /\b(?:tide ?pods?|drink bleach|ghost pepper|carolina reaper|cinnamon challenge|choking challenge|blackout challenge|fire challenge)\b/u,
  /\bjump (?:off|from) (?:a |the )?(?:roof|bridge|building|cliff|balcony)\b/u,
  /\bset (?:yourself|your \w+|it|them) on fire\b/u,
  /\b(?:starve yourself|no food for|don'?t eat for)\b/u,
];

// Anywhere: telling someone to hurt themselves, slurs, and explicit sexual
// words. Whole words only, and none that also have an everyday meaning.
const ABUSE = [
  /\b(?:kill (?:yo)?urself|kys|go die)\b/u,
  /\b(?:niggers?|niggas?|faggots?|retards?|retarded|kikes?|trann(?:y|ys|ies)|wetbacks?|ragheads?|gooks?)\b/u,
  /\b(?:porn\w*|blowjobs?|handjobs?|dildos?|masturbat\w*|orgasms?|cumshots?|send nudes|sex tape|jerk off)\b/u,
];

function isRefused(kind: GameTextKind, text: string): boolean {
  const words = text.normalize("NFKC").toLowerCase().replace(/[’‘]/gu, "'").replace(/\s+/gu, " ");
  const matches = (patterns: readonly RegExp[]) => patterns.some((pattern) => pattern.test(words));
  if (matches(ABUSE)) return true;
  if ((kind === "prize" || kind === "dare") && matches(MONEY)) return true;
  return (kind === "task" || kind === "dare" || kind === "prize") && matches(DANGER);
}
