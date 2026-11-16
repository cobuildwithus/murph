import { ACTIVITY_CHOICES } from "./rules";
import type { GameIdeasInput } from "./input";

// Ported from the tuned idea lab (17 batches of 20 live spins). What people
// typed and the shown ideas stay in the request data, never in these
// instructions, so typed text can't rewrite them.

const ABOUT = {
  move: { name: "Move more", gist: "cardio and steps, no strength moves like pushups or squats" },
  strength: { name: "Get stronger", gist: "strength" },
  calm: { name: "Calm down", gist: "rest, mind and sleep; no exercise beyond an easy walk or stretching" },
  home: { name: "Home life", gist: "daily life at home: food, the kitchen, mornings, bedtime, phone habits and meals together; no exercise at all" },
  other: { name: "anything healthy", gist: "a mix of movement, strength, calm and home habits" },
};

interface Ask { phrase: string; note?: string; sized?: boolean }

// Drawer directions whose wording was tuned. `phrase` heads the brief ("every
// one done outside"), `note` adds numbers. Sized ones are relative ("easier"
// means nothing for one idea alone), so they skip the fit check.
const TUNED: Record<string, Ask> = {
  easier: { phrase: "easy enough for a beginner", sized: true, note: "About half a normal day, still real effort: Walk 10 min, 5 pushups, Plank 20 sec." },
  beginner: { phrase: "easy enough for a beginner", sized: true, note: "About half a normal day, still real effort: Walk 10 min, 5 pushups, Plank 20 sec." },
  harder: { phrase: "clearly harder than a normal day", sized: true, note: "About one and a half times a normal day: Walk 45 min, Run 5k, 30 pushups, Plank 90 sec." },
  crazier: { phrase: "big enough to brag about", sized: true, note: "At least double a normal day: Walk 90 min, Run 10k, 100 pushups, Plank 3 min. Most of these get three_days." },
  "quick ones": { phrase: "done in 10 minutes or less", sized: true },
  outdoors: { phrase: "done outside" },
  "at home": { phrase: "done at home with no equipment", note: "Inside the house, like dancing, stairs, jumping jacks or a workout video; never a walk, run or ride." },
  "at the gym": { phrase: "done at a gym with weights or machines", note: "A real session or a main lift (Lift 45 min, Squat 3x10, Bench press 3x8, Row 2,000 m), never something you could just as well do at home." },
  mornings: { phrase: "done in the morning, and the task says so" },
  "before bed": { phrase: "done before bed, and the task says so" },
  "do it together": { phrase: "easy for two people to do together, in person or on a call" },
  "less phone": { phrase: "about using the phone less" },
  bigger: { phrase: "a real treat", sized: true },
  smaller: { phrase: "small and easy", sized: true },
  "go easy": { phrase: "light and over quickly", sized: true },
  cheaper: { phrase: "costing little or nothing", sized: true },
  funnier: { phrase: "funny", note: "Funny means friendly embarrassment for the loser that people really do, like wearing a rival team's jersey or singing on a call." },
  "long distance": { phrase: "possible from different cities", sized: true },
};

/** What each idea has to be: the drawer's directions, then the typed words. */
function asks(ctx: GameIdeasInput): Ask[] {
  const known = ctx.directions.flatMap(label => TUNED[label.toLowerCase()] ?? []);
  const unknown = ctx.directions.some(label => !TUNED[label.toLowerCase()]);
  return [
    ...known,
    ...(unknown ? [{ phrase: "matching the other directions in the request data" }] : []),
    { phrase: "fitting what they typed (words in the request data), the way a friend would take it", ...(ctx.step === "task" ? {} : { note: "Each one is still a normal stake." }) },
  ];
}

/** What the live check asks each idea to fit: concrete directions and the
 * typed words, quoted as data. Sized directions are relative, so they're
 * left to the writer. */
export function gameIdeasFits(ctx: GameIdeasInput): string[] {
  return [
    ...ctx.directions.flatMap(label => {
      const tuned = TUNED[label.toLowerCase()];
      if (tuned) return tuned.sized ? [] : [tuned.phrase];
      return [`matching ${JSON.stringify(label)}`];
    }),
    `fitting what they typed, ${JSON.stringify(ctx.words)}, the way a friend would take it`,
  ];
}

/** Whether they live apart, said or chosen. */
export function isGameIdeasApart(ctx: GameIdeasInput): boolean {
  return ctx.apart || ctx.directions.some(label => label.toLowerCase() === "long distance");
}

const WHO_BRIEF = {
  partner: "They are a couple: romantic and at-home ideas are great (breakfast in bed, a massage, a date night the loser plans).",
  friend: "They are friends: hangouts, food, favors and friendly teasing. Nothing romantic, nothing physical like massages, nothing in bed.",
  family: "They are family, like a parent and a grown child: meals, favors, calls and family teasing. Nothing romantic, nothing physical like massages, nothing in bed.",
  roommate: "They are roommates: shared chores, food and favors around the place they share. Nothing romantic, nothing physical like massages, nothing in bed.",
  coworker: "They are coworkers: things that happen at work or over lunch (lunch, a coffee run, donuts for the team, wearing the winner's team shirt to work). Nothing at home, physical or personal, and no desk busywork like tidying their desk or sorting mail.",
  teammate: "They are teammates: things around practice, games or the team (carry the gear, buy post-game food). Nothing romantic, nothing physical like massages, nothing in bed.",
};
const NEAR = "They live in the same city, so in-person ideas work.";
const FAR = "They live in different cities, so every idea must work apart: delivered or mailed (takeout, a care package), done on a call (a song), or done alone and shown in a photo. Nothing that needs them in the same place, like a massage, chores at the other one's home, cooking for them or rides.";
const SCHEDULE = "schedule says which days count: weekdays for real exercise; every_day only for light habits a normal person does 7 days a week (stretching, a short walk, sleep, reading, journaling, phone limits, meals); three_days for anything most people could not repeat five days in a row (long runs, hikes, 5k or more, 50 or more reps, hard workouts, games of a sport like tennis, soccer or basketball).";
const NOTHING_ASSUMED = "Nothing that assumes kids, a pet, a car, a yard or a job unless they typed so.";

export function gameIdeasBrief(ctx: GameIdeasInput): string {
  const wanted = asks(ctx);
  const every = `, every one ${wanted.map(ask => ask.phrase).join(" and ")}`;
  const notes = wanted.flatMap(ask => ask.note ? [ask.note] : []);
  if (ctx.notForMe?.length) notes.push(`Never suggest anything that is one of these activities: ${ACTIVITY_CHOICES.filter(choice => ctx.notForMe?.some(activity => activity === choice.value)).map(choice => choice.description).join("; ")}.`);
  const sized = wanted.some(ask => ask.sized);
  const skipped = ctx.skipped.length ? ["They already saw and skipped the skipped texts in the request data; write different ones."] : [];
  if (ctx.step === "task") {
    const about = ABOUT[ctx.category ?? "other"];
    return [
      "You write daily tasks for Murph, an iPhone game: two people do the same task each day for a week and post a photo as proof. More days done wins.",
      `Write 12 tasks${every}.`,
      ...notes,
      `A good task is a real thing people do for their health${sized ? "" : ", takes real effort but fits into a normal day"}, is clear about when it is done, and reads as a short chip under 28 characters.`,
      `The week was about ${about.name} (${about.gist}), but what they typed comes first.`,
      ...(isGameIdeasApart(ctx) ? ["They live in different cities, so each does it on their own: nothing they do together in person, though a call works."] : []),
      'Say it the way people say it. Counts come first ("15 pushups", "20 calf raises"). Timed things put the activity first ("Plank 30 sec", "Walk 30 min", "Jump rope 10 min"). Keep a verb only when the task needs one ("Walk 30 min", "Read 10 pages"). No "Do", no "for", no describing words like brisk, easy, light, slowly, quietly, bodyweight or cozy.',
      `Both people do the same task, so say "the dog", never "my" or "your". ${NOTHING_ASSUMED}`,
      "Never two that differ only in the number or a word or two.",
      "Leave out gimmicks, props used for their own sake, jokes, exercise names a normal person would not know, chores that are not daily by nature (trash, laundry, plants), anything you avoid rather than do, and anything trivial (stand up, drink a glass of water, take a few deep breaths, take a break, 1,000 steps).",
      SCHEDULE,
      ...skipped,
    ].join("\n");
  }
  const dare = ctx.step === "dare";
  return [
    'You write stakes for Murph, an iPhone game: two people bet on a week of a daily habit (the task in the request data, if any), and whoever does more days wins.',
    dare
      ? `Write 12 dares${every}. Each is only the words that fill the blank in "Loser has to ___", starting with a verb ("do 100 burpees", "cold plunge at dawn", "wear a rival jersey all day"). A dare is something the loser does themselves, never a favor or service for the winner: no cooking, cleaning, buying, driving or chores for them.`
      : `Write 12 prizes${every}. Each is only the words that fill the blank in "Winner earns ___": a short thing like a meal, a treat or a favor, said the way people say it ("date night", never "a date night planned"). It is one treat, cashed in once: never a bundle or a stretch of time like "for a week". A favor is the thing the winner gets ("a car wash", not "car washed"), and a prize is something they get, not an activity they do together. The loser pays for it or does it, which goes without saying, so never mention the winner, the loser, "you" or "your".`,
    ...notes,
    dare
      ? "Under 32 characters. A good one is something people really dare each other to do, and the loser should feel it: a hard workout, giving something up, friendly embarrassment, or doing some good. Never a tiny gesture or something that is really a perk for the loser."
      : "Under 32 characters. A good one is something people really treat each other to, worth winning, and the loser can actually pay it off.",
    WHO_BRIEF[ctx.relationship],
    isGameIdeasApart(ctx) ? FAR : NEAR,
    NOTHING_ASSUMED,
    dare ? 'Either person can lose, so never use a name or "your"; say "the winner".' : "Never use a name.",
    "Twelve different ideas, never two that differ by a word or two.",
    "Leave out cash, payments, gift cards, gambling, alcohol, brands, anything humiliating or unsafe, anything random or meaningless, low-effort tokens like a playlist, a poem, a postcard, a drawing or a note, and describing words like cozy, scenic, fancy or thoughtful.",
    "Use every_day for schedule.",
    ...skipped,
  ].join("\n");
}
