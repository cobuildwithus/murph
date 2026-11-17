// Copied exactly from murph-ios/scripts/game-ideas/build.mjs. Keep that file and
// murph/apps/web/src/lib/game/ideas/rules.ts in sync (calibrated at STAKE_BAR 0.7).
import type { GameIdeasInput } from "./input";

// The app's limits: a prize prints on its ticket, a dare on its slip.
export const MAX_CHARS = { task: 30, prize: 34, dare: 38 };
// Never shown: alcohol, money, gambling.
export const BANNED = /\b(cocktails?|beers?|wine|booze|margaritas?|mimosas?|champagne|whiskey|vodka|tequila|bar tab|happy hour|cash|venmo|paypal|gift cards?|dollars?|casino|lottery|gambl\w*)\b|\$\d/i;
// A prize is one ticket, marked done once: a single treat, never a bundle or a
// stretch of time (weekly-game.md).
// The app's own rules (GameSentenceTests): a prize is a thing the winner gets,
// never a chore to do or "on you", and never says week or month.
export const PRIZE_CHORE = /^(Pick|Take|Clean|Carry|Cook|Plan|Next) |\bon you$|week|month| x\b/i;
// A day is shown with a photo (or rep tape, a route, a line of words), so a
// task is something you do and can show: nothing you avoid, no counts a
// photo can't see, no bedtimes or wake times, never "your" (it reads as the
// other person's).
export const TASK_UNSEEN = /^No |Lights out|steps|glasses of water|Cold shower|\byour |\b(bed by|in bed|up by|up at|wake|alarm|of sleep|sleep \d)|-free day|\bmax$/i;
export const PRIZE_STRETCH = /\b(for a (week|month|year)|all (week|month|weekend|season|winter|summer)|a (week|month|weekend|winter|year) (of|off)|for (two|three|\d+) (days|weeks|months)|every (day|morning|night|week)|each (day|week)|daily|weekly|monthly|for life|until|twice|for a day|for the day)\b/i;

export const WHO = {
  partner: 'They are a couple: romantic and at-home ideas are great.',
  friend: 'They are friends: hangouts, food, favors and friendly teasing. Nothing romantic, nothing physical like massages, nothing in bed.',
  family: 'They are family, like a parent and a grown child: meals, favors, calls and family teasing. Nothing romantic, nothing physical like massages, nothing in bed.',
  roommate: 'They are roommates: shared chores, food and favors around the place they share. Nothing romantic, nothing physical like massages, nothing in bed.',
  coworker: 'They are coworkers: things that happen at work or over lunch, workouts, and friendly embarrassment fine for an office. Nothing at home, nothing intimate like massages, and no desk busywork.',
  teammate: 'They are teammates: things around practice, games or the team. Nothing romantic, nothing physical like massages, nothing in bed.',
};
export const WHERE = {
  near: 'They live in the same city.',
  far: 'They live in different cities, so it has to work apart: delivery, mail, a call or a photo all work; anything in person, like a massage, does not.',
};
export const TOKENS = 'Low-effort tokens like a playlist, a poem, a postcard, a drawing, a plant or a note do not count, and neither do tiny gestures like saving a seat or letting the winner pick the movie.';
export const STAKE_BAR = 0.7;

export const stakeInput = (rel: GameIdeasInput["relationship"], where: "near" | "far") => `Two people made a week-long bet in a health challenge app. ${WHO[rel]} ${WHERE[where]} ${TOKENS}`;
export const stakeQuestion = (kind: "prize" | "dare", text: string) =>
  kind === 'dare'
    ? `Would "${text}" be a good thing for the loser to have to do? Good means people really do it, the loser feels it, and it fits the rules above.`
    : `Would "${text}", paid for or done by the loser, be a good prize for the winner? Good means the winner would really want it and it fits the rules above.`;
export const DARE_INPUT = 'Two people made a week-long bet in a health challenge app. The loser has to do a dare.';
export const dareQuestion = (text: string) =>
  `Is "${text}" something the loser does themselves, like a hard workout, giving something up, friendly embarrassment or doing some good, rather than a favor or service for the winner such as cooking, cleaning, buying, driving or doing chores for them?`;

export const ACTIVITY_BAR = 0.5;
export const activityQuestion = (text: string) => `Which activity is "${text}"?`;
export const ACTIVITY_CHOICES = [
  { value: 'walking', description: 'walking or hiking' },
  { value: 'running', description: 'running or jogging' },
  { value: 'cycling', description: 'cycling or a spin class' },
  { value: 'swimming', description: 'swimming, or time in a pool or water park' },
  { value: 'yoga', description: 'yoga' },
  { value: 'dance', description: 'dancing' },
  { value: 'pilates', description: 'pilates' },
  { value: 'lifting', description: 'lifting weights' },
  { value: 'stretching', description: 'stretching, mobility or foam rolling' },
  { value: 'climbing', description: 'rock climbing or bouldering' },
  { value: 'rowing', description: 'rowing' },
  { value: 'golf', description: 'golf, mini golf or disc golf' },
  { value: 'water', description: 'surfing, kayaking, paddleboarding, boating or a day at the beach' },
  { value: 'exercise', description: 'another workout or exercise, like pushups, planks, stairs, tai chi, martial arts, a class or a sport' },
  { value: 'none', description: 'not one activity: a treat, a trip, a habit, a chore or anything else' },
];
