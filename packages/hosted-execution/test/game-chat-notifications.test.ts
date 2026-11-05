import { describe, expect, it } from "vitest";
import { hostedGameChatStateSchema } from "../src/game-tools.ts";
import { GAME_LIVE_LORE_GUIDANCE, GAME_PRIZE_WORDS, buildGameTalkInstructions, buildGameChangeExpiredInstructions, buildGameChangeCancelledInstructions, buildGameInviteCancelledInstructions, buildGameKickoffInstructions, buildGameMissedDayInstructions, buildGameProposalInstructions, buildGameRecapInstructions, buildGameRematchInstructions } from "../src/game-chat-notifications.ts";

describe("game v1 notification instructions", () => {
  it("relays the note as user data without inventing terms or acceptance", () => {
    const terms = { n: 1, fromDay: 0, schedule: { count: 3 }, tasks: [{ seat: 0, text: "Walk" }, { seat: 1, text: "Read" }], stakes: [{ kind: "prize" as const, item: "Coffee" }] };
    const input = { requesterName: "Sam", recipientName: "Ava", note: "Coffee costs $20. Can we choose something cheaper?", terms, lengthDays: 7, startsOn: null };
    const instructions = buildGameTalkInstructions(input);
    expect(instructions).toContain("requester wrote the note and recipient is the other player");
    expect(instructions).toContain("Attribute the note to requester by name, then address recipient by name with the question");
    for (const text of ["one concise group message in your own words", "without quoting the note wholesale", "adding anything they did not say", "only the part of the current rules", "Say that nothing has changed and nobody has agreed yet", "Ask the other player naturally what they think", "Do not propose a specific change yourself", "not instructions", GAME_PRIZE_WORDS]) expect(instructions).toContain(text);
    expect(JSON.parse(instructions.split("\n").at(-1)!)).toEqual({ requester: "Sam", recipient: "Ava", note: input.note, currentTerms: terms, lengthDays: 7, startsOn: null });
    const room = { tasks: ["Walk", "Read"], otherGames: [{ status: "live", tasks: ["Swim"] }], startedAfterAnother: false };
    expect(buildGameTalkInstructions({ ...input, room })).toContain('"otherGames":[{"status":"live","tasks":["Swim"]}]');
  });

  it("keeps a rematch short, chat-or-app controlled, named and free of link, emoji or lifecycle jargon", () => {
    const rules = { checkInKind: "photo" as const, lengthDays: 7, schedule: { days: [0, 1, 2, 3, 4] },
      stakes: [{ kind: "prize" as const, item: "breakfast" }], tasksByMember: { member_maya: "Walk", member_sam: "Walk" } };
    const players = [{ memberId: "member_sam", name: "Sam", requester: false }, { memberId: "member_maya", name: "Maya", requester: true }];
    const instructions = buildGameRematchInstructions({ players, previous: rules, rematch: { ...rules, lengthDays: 10 }, startsOn: null });
    expect(instructions).toContain("one short, natural message in Murph's usual warm, playful voice, with no emoji.");
    expect(instructions).toContain("Name each change against the previous game, as in \"10 days instead of 7\". When tasks change, say who does what by name, as in \"Sam takes the stretch and Maya takes 25 squats\", never \"whoever had\" a task.");
    expect(instructions).toContain("say yes right here or Shake on it in the Murph app, or ask for changes here or in the app");
    expect(instructions).toContain("never call it the same game.");
    expect(instructions).toContain("Do not include a link");
    expect(instructions).toContain("never use the words invite, round or token");
    const { tasksByMember: _tasks, ...terms } = rules;
    expect(JSON.parse(instructions.split("\n").at(-1)!)).toEqual({
      requester: "Maya", sameGame: false, startsOn: null, previous: terms, rematch: { ...terms, lengthDays: 10 },
      players: [{ name: "Maya", requester: true, previousTask: "Walk", rematchTask: "Walk" }, { name: "Sam", requester: false, previousTask: "Walk", rematchTask: "Walk" }],
    });
    // Names stand in for member keys, so no internal ID reaches the model.
    expect(instructions).not.toContain("member_");
  });
  it("compares asymmetric rematch tasks by person when the requester changes seats", () => {
    const shared = { checkInKind: "photo" as const, lengthDays: 7, schedule: { days: [0, 1, 2, 3, 4] }, stakes: [] };
    const players = [{ memberId: "member_sam", name: "Sam", requester: true }, { memberId: "member_alex", name: "Alex", requester: false }];
    const same = JSON.parse(buildGameRematchInstructions({ players, startsOn: null,
      previous: { ...shared, tasksByMember: { member_alex: "Run", member_sam: "Lift" } },
      rematch: { ...shared, tasksByMember: { member_sam: "Lift", member_alex: "Run" } } }).split("\n").at(-1)!);
    expect(same.sameGame).toBe(true);
    const swapped = JSON.parse(buildGameRematchInstructions({ players, startsOn: null,
      previous: { ...shared, tasksByMember: { member_alex: "Run", member_sam: "Lift" } },
      rematch: { ...shared, tasksByMember: { member_alex: "Lift", member_sam: "Run" } } }).split("\n").at(-1)!);
    expect(swapped.sameGame).toBe(false);
    expect(swapped.players).toEqual([
      { name: "Sam", requester: true, previousTask: "Lift", rematchTask: "Run" },
      { name: "Alex", requester: false, previousTask: "Run", rematchTask: "Lift" },
    ]);
  });
  it("words every notice as a game and an ask, and opens a missed day with the plain fact", () => {
    const [game] = hostedGameChatStateSchema.parse({ games: [{
      id: "game_synthetic", status: "live", startsOn: null, lengthDays: 7, pendingChange: null,
      terms: { n: 1, fromDay: 0, tasks: [{ seat: 0, text: "Steps" }, { seat: 1, text: "Plank" }], schedule: { count: 5 }, stakes: [] },
      players: [{ memberId: "member_maya", seat: 0, firstName: "Maya", dayOne: "2030-03-04", timeZone: "UTC" }, { memberId: "member_sam", seat: 1, firstName: "Sam", dayOne: "2030-03-04", timeZone: "UTC" }],
      changeControls: { canStartNow: false, canEdit: false, canEditSchedule: false, canEditStartDate: false, editableFromDay: null },
    }] }).games;
    const rules = { checkInKind: "photo" as const, lengthDays: 7, schedule: { count: 5 }, stakes: [], tasksByMember: { member_maya: "Steps", member_sam: "Plank" } };
    const proposal = buildGameProposalInstructions({ change: { kind: "edit", lengthDays: 10 }, startsOn: null }, { proposerName: "Sam", recipientName: "Maya", lengthDays: 7 });
    const missed = buildGameMissedDayInstructions({ playerName: "Maya", firstMissedDate: "2030-03-04", missedDates: ["2030-03-04"], transcript: [] });
    const notices = [proposal, missed, buildGameKickoffInstructions({ kind: "started", game: game! }), buildGameChangeCancelledInstructions(), buildGameChangeExpiredInstructions("The schedule changed first."),
      buildGameInviteCancelledInstructions(), buildGameRematchInstructions({ players: [{ memberId: "member_maya", name: "Maya", requester: true }, { memberId: "member_sam", name: "Sam", requester: false }], previous: rules, rematch: rules, startsOn: null })];
    expect(GAME_PRIZE_WORDS).toContain("a two-player game is a game, as the players and the app call it, never a challenge.");
    expect(GAME_PRIZE_WORDS).toContain("Join clauses with a comma, colon or full stop, never an em dash or a spaced hyphen.");
    // The one rule that names the word is the only place it appears.
    for (const notice of notices) expect(notice.replaceAll(GAME_PRIZE_WORDS, "")).not.toMatch(/challenge/iu);
    expect(proposal).toContain("A player asked for a change to this game from the app.");
    expect(proposal).toContain("Say the player wants or asked for the change, as in \"Sam wants to make it 10 days\", never that they proposed it or that it is a proposal.");
    expect(proposal).not.toContain("proposed a challenge change");
    expect(missed).toContain("Open by saying plainly whose post is missing and for which day, as in \"Maya, no steps post from you yesterday\"; any joke comes after that plain fact and never stands in for it, so no riddles or metaphors about the miss.");
  });
  it("explains a refused approval once without claiming the game ended", () => {
    const reason = "The proposed start date has passed. Propose a new date.";
    const instructions = buildGameChangeExpiredInstructions(reason);
    expect(instructions).toContain("one brief, plain line");
    expect(instructions).toContain("could not apply and why");
    expect(instructions).toContain("Do not say the game was cancelled or changed");
    expect(instructions).toContain("call it the requested change, never a proposal");
    expect(JSON.parse(instructions.split("\n").at(-1)!)).toEqual({reason});
  });
  it("distinguishes a cancelled request from the game and a later request", () => {
    const instructions = buildGameChangeCancelledInstructions();
    expect(instructions).toContain("one brief, natural group message");
    expect(instructions).toContain("did not alter the game");
    expect(instructions).toContain("earlier request only");
    expect(instructions).toContain("Do not describe any later request as cancelled");
    expect(instructions).not.toMatch(/is now pending|has not started|still waiting for agreement/);
    expect(instructions).not.toContain("calendar days");
  });
  it("keeps total duration clear without player-facing jargon", () => {
    const instructions = buildGameProposalInstructions({ change: { kind: "edit", lengthDays: 75 }, startsOn: null }, { proposerName: "Maya", recipientName: "Sam", lengthDays: 7 });
    expect(instructions).toContain("total days, never additional days");
    expect(instructions).not.toContain("calendar days");
  });
  it("names what the loser owes a prize in the texts that describe it, never a bet", () => {
    const proposal = buildGameProposalInstructions({ change: { kind: "edit", stakes: [{ kind: "prize", item: "breakfast in bed" }] }, startsOn: null }, { proposerName: "Maya", recipientName: "Sam", lengthDays: 7 });
    const [game] = hostedGameChatStateSchema.parse({ games: [{
      id: "game_synthetic", status: "live", startsOn: null, lengthDays: 7, pendingChange: null,
      terms: { n: 1, fromDay: 0, tasks: [{ seat: 0, text: "100 pushups" }, { seat: 1, text: "100 pushups" }], schedule: { days: [0, 1, 2, 3, 4, 5, 6] }, stakes: [{ kind: "prize", item: "breakfast in bed" }] },
      players: [{ memberId: "member_maya", seat: 0, firstName: "Maya", dayOne: "2030-03-04", timeZone: "UTC" }, { memberId: "member_sam", seat: 1, firstName: "Sam", dayOne: "2030-03-04", timeZone: "UTC" }],
      changeControls: { canStartNow: false, canEdit: false, canEditSchedule: false, canEditStartDate: false, editableFromDay: null },
    }] }).games;
    const kickoff = buildGameKickoffInstructions({ kind: "started", game: game! });
    for (const instructions of [proposal, kickoff]) expect(instructions).toContain(GAME_PRIZE_WORDS);
    expect(GAME_PRIZE_WORDS).toContain("owes you breakfast in bed.");
    for (const word of ["ticket", "bet", "wager", "stake", "winnings", "cash in"]) expect(GAME_PRIZE_WORDS).toContain(word);
  });
  it("snapshots the recap and missed-day prompt boundaries", () => {
    const recap = buildGameRecapInstructions([{ playerName: "Ava", text: "My alarm won." }]);
    expect(recap).not.toMatch(/\b(?:read_chat|read_lore|add_lore)\b/u);
    expect(recap).toContain("- 3 to 6 pages with an arc: open on the stakes in plain words (who took which task, and what they were playing for), hit the turning point (a miss, an excuse, a comeback, a running joke paying off), and end on a page that lands the week with your verdict or punchline. When both of them hit the same kind of moment (both overslept, both blamed the weather), set the two side by side; the echo is the joke.");
    expect(recap).toContain("Use a contact sheet when a pattern is the joke, and a stat only when the number itself is funny; a stat never restates the tasks, the prize, the days or the score.");
    expect(recap).toContain("- Moments come from the game itself: their posts, misses, excuses and what they said to each other about it. Changing the game (terms, prize wording, schedule, invites) is bookkeeping, never a moment; leave it out, and the same goes for anything said to you about the app itself (feature requests, bugs, feedback). Everything you say happened did: never invent a lead, a comeback or a reason the game and chat don't show.");
    expect(recap).toContain("- The app adds the score card and the result page after your pages; they show the score and who owes whom, so your pages don't need to. Call what the loser owes a prize, or a dare when it is one.");
    expect(recap).not.toContain("scoreLine");
    expect(recap).toContain("No invitation to open, watch or swipe anything");
    expect(recap).toContain("Then add one specific thing one of them did or said during the game.");
    expect(recap).not.toMatch(/Don't restate the score|then nudge them|Lead with one specific thing/u);
    const transcript = [{ playerName: "Ava", text: "My alarm won." }];
    const missed = buildGameMissedDayInstructions({ playerName: "Ava", firstMissedDate: "2030-03-04", missedDates: ["2030-03-04", "2030-03-05"], transcript });
    expect(missed).toContain('Return one notification decision JSON object and nothing else');
    expect(missed).toContain('{"kind":"skip","privateSummary":"<why no message>"}');
    expect(missed).toContain('{"kind":"send_message","text":"<the one message>","privateSummary":"<brief internal note>"}');
    expect({
      recapOpening: recap.split("\n")[0],
      recapToolOrder: recap.includes("Use murph.read_game first") && recap.includes("then use murph.write_recap"),
      recapReply: recap.includes("chatLine is your end-of-game message") && recap.includes("who won and the score, or that it was a tie and the score"),
      recapMomentsNotBookkeeping: recap.includes("Changing the game (terms, prize wording, schedule, invites) is bookkeeping, never a moment"),
      recapLore: recap.includes("murph.game_lore") && recap.includes("Chat line used:"),
      recapTranscript: recap.includes('"playerName":"Ava","text":"My alarm won."'),
      missedOpening: missed.split("\n")[0],
      missedCanSkip: missed.includes("finish without a reply"),
      missedData: JSON.parse(missed.split("\n").at(-1)!),
      liveLoreGuidance: GAME_LIVE_LORE_GUIDANCE,
    }).toMatchInlineSnapshot(`
      {
        "liveLoreGuidance": "This room has a live game. Use murph.game_lore to keep about 200 lines of brief dated game lore from current chat and game evidence: verbatim excuses, trash talk, firsts, streaks, comebacks, running and used bits; trim oldest first. In group challenges, record only room conversation and shared game state, never personal memory, private contact labels, or captions and photo details not said in the room; person notes keep memberId next to the name because suffixes change, but memberIds never appear in messages.",
        "missedCanSkip": true,
        "missedData": {
          "firstMissedDate": "2030-03-04",
          "missedDates": [
            "2030-03-04",
            "2030-03-05",
          ],
          "playerName": "Ava",
          "transcript": [
            {
              "playerName": "Ava",
              "text": "My alarm won.",
            },
          ],
        },
        "missedOpening": "A player missed one or more consecutive scheduled game days. Read the pair lore with murph.game_lore and use the bounded same-room transcript below before deciding whether to speak.",
        "recapLore": true,
        "recapMomentsNotBookkeeping": true,
        "recapOpening": "The game just ended. Write its recap: a short story of the week the two players swipe through in the app, like Instagram stories. Use murph.read_game first, read the pair lore with murph.game_lore, use the bounded current-room transcript below, then use murph.write_recap and update the pair lore with murph.game_lore.",
        "recapReply": true,
        "recapToolOrder": true,
        "recapTranscript": true,
      }
    `);
  });
  it("names the game by its tasks when other games share the room, and offers reminders once", () => {
    const room = { tasks: ["20 squats", "10 minute stretch"], otherGames: [{ status: "live", tasks: ["Read 20 pages", "No phone after 10pm"] }], startedAfterAnother: true };
    const [game] = hostedGameChatStateSchema.parse({ games: [{
      id: "game_synthetic", status: "live", startsOn: null, lengthDays: 7,
      terms: { n: 1, fromDay: 0, tasks: [{ seat: 0, text: "20 squats" }, { seat: 1, text: "10 minute stretch" }], schedule: { days: [0, 1, 2, 3, 4, 5, 6] }, stakes: [{ kind: "prize", item: "coffee run" }] },
      players: [{ memberId: "member_sam", seat: 0, firstName: "Sam", dayOne: "2030-03-04", timeZone: "UTC" }, { memberId: "member_maya", seat: 1, firstName: "Maya", dayOne: "2030-03-04", timeZone: "UTC" }],
      pendingChange: null, changeControls: { canStartNow: false, canEdit: false, canEditSchedule: false, canEditStartDate: false, editableFromDay: null },
    }] }).games;
    const proposal = { change: { kind: "edit" as const, lengthDays: 10 }, startsOn: null };
    const names = { proposerName: "Sam", recipientName: "Maya", lengthDays: 7 };
    const shared = [
      buildGameProposalInstructions(proposal, { ...names, room }),
      buildGameKickoffInstructions({ kind: "started", game: game!, room }),
      buildGameChangeCancelledInstructions(room),
      buildGameChangeExpiredInstructions("The schedule changed first.", room),
    ];
    for (const instructions of shared) {
      expect(instructions).toContain("Say which game this is by its tasks");
      // The cancellation notices otherwise forbid repeating tasks; the short game name is the one exception.
      expect(instructions).toContain("Where these instructions say not to repeat tasks, this short name is the only exception; every other rule still applies.");
      expect(JSON.parse(instructions.split("\n").at(-1)!)).toEqual({ thisGameTasks: room.tasks, otherGames: room.otherGames });
    }
    const recap = buildGameRecapInstructions([], room);
    expect(recap).toContain("the chatLine names this game by its tasks");
    expect(recap).toContain(JSON.stringify(room.tasks));
    // A second live game in the room gets its own introduction, never a second reminder offer.
    expect(shared[1]).toContain("Skip the reminder offer");
    expect(shared[1]).not.toContain("Briefly offer reminders");
    // Games that went live together, or beside an unstarted invite, each still introduce themselves with the offer.
    for (const first of [{ ...room, startedAfterAnother: false }, { ...room, otherGames: [{ status: "negotiating", tasks: ["Plank"] }], startedAfterAnother: false }]) {
      const kickoff = buildGameKickoffInstructions({ kind: "started", game: game!, room: first });
      expect(kickoff).toContain("Briefly offer reminders");
      expect(kickoff).toContain("Say which game this is by its tasks");
    }
    // A room with one game reads exactly as before.
    for (const single of [buildGameProposalInstructions(proposal, names), buildGameKickoffInstructions({ kind: "started", game: game! }), buildGameChangeCancelledInstructions(),
      buildGameChangeExpiredInstructions("The schedule changed first."), buildGameRecapInstructions([])]) {
      expect(single).not.toContain("Other games");
      expect(single).not.toContain("thisGameTasks");
    }
    expect(buildGameKickoffInstructions({ kind: "started", game: game! })).toContain("Briefly offer reminders");
  });
});


it("composes shared-evidence superlatives guidance without requiring legacy writers", () => {
  const instructions = buildGameRecapInstructions([]);
  for (const phrase of ["tool supports superlatives", "both memberIds", "exactly one {memberId, title, line} per player", "2–6 words", "no trailing period", "differs from the other title", "text both players can see", "bodies or weight"]) expect(instructions).toContain(phrase);
});


it("keeps group kickoff and recap distinct from pair consent and reminders", () => {
  const game = hostedGameChatStateSchema.parse({ games: [{ id: "game_group", maxPlayers: 10, status: "live", lengthDays: 7, startsOn: null,
    players: [0, 1].map(seat => ({ memberId: `player_${seat}`, seat, firstName: `Alex (${seat + 1})`, timeZone: "UTC", dayOne: "2030-03-06" })),
    terms: { n: 1, fromDay: 0, defaultTask: "Walk", tasks: [{ seat: 0, text: "Walk" }, { seat: 1, text: "Walk" }], schedule: { count: 5 }, stakes: [] },
    pendingChange: null, changeControls: { canStartNow: false, canEdit: false, canEditSchedule: false, canEditStartDate: false, editableFromDay: null },
  }] }).games[0];
  const kickoff = buildGameKickoffInstructions({ kind: "started", game });
  expect(kickoff).toContain("Only seated players have accepted");
  expect(kickoff).not.toContain("Both players have agreed");
  expect(kickoff).not.toContain("Briefly offer reminders");
  const recap = buildGameRecapInstructions([], undefined, true);
  expect(recap).toContain("one kind superlative");
  expect(recap).toContain("Never shame");
});

it("gives group recaps room continuity, shared voice and read-only lore with eligible-player protections", () => {
  const transcript = [{ playerName: "Alex (2)", text: "The stairs have unionized." }];
  const prompt = buildGameRecapInstructions(transcript, undefined, true);
  for (const phrase of [JSON.stringify(transcript), "murph.game_lore (read only)", "running bits and callbacks to earlier games", "eligible players by memberId", "Never reuse a bit or chat line listed as used", "dry, warm, specific, a little roasty, never mean", "pages with an arc", "headlines carry the story", "Show their posts", "3 to 7", "one kind superlative per eligible player", "Omit scoreLine", "duplicate-name suffixes", "all-way tie has no prize obligation", "Never shame", "single out a missing person", "No inference from unavailable entries", "Never feature or quote leavers or unjoined people, including inside an eligible player's words", "Quote only returned words exactly", "never app-only captions or photo details"]) expect(prompt).toContain(phrase);
  expect(prompt).not.toMatch(/older lore|update.*lore|add.*bits used|Chat line used:|anything worth remembering/u);
  const pair = buildGameRecapInstructions(transcript);
  expect(pair).toContain("update the pair lore");
  expect(pair).toContain("Chat line used:");
  for (const phrase of ["game lore", "only room conversation and shared game state", "personal memory, private contact labels", "memberId next to the name", "memberIds never appear in messages"]) expect(GAME_LIVE_LORE_GUIDANCE).toContain(phrase);
});
