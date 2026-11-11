import * as z from '@murphai/contracts/zod-runtime'
import { GAME_PRIZE_WORDS, hostedGameUpdateSchema, hostedGamePhotoSchema, hostedGameRecapSchema, type HostedGameUpdate, type HostedGamePhoto, type HostedGameRecap } from '@murphai/hosted-execution/runtime-control'
import type { AssistantHostedToolContext } from '../../assistant/hosted-tool-context.js'
import { parseDynamicToolArguments } from './dynamic-tool-wrapper.js'
import { toolTextResult } from '../tool-failure-diagnostics.js'

// The tool descriptions below are sent on every group turn, so each one says only what its call is for.
// The rules for running a game are appended to the read_game result (see gameReadGuidance), where they
// are read on the turns that are about a game. Each rule is stated once.
export const MURPH_READ_GAME_TOOL = {
  namespace: 'murph', name: 'read_game',
  description: 'Read the app games shared by the 2 to 10 players in this group chat: players, tasks, prize or dare, schedule, start, check-in status by day, any change waiting for a yes, and the settled result. Call it first, with the messageRef of the person who spoke, whenever someone asks about a game, asks to start one (people may call it a challenge), answers a game ask, or pastes a game invite link. The result ends with the rules for the games in this chat; follow them. It never includes private labels, photos, captions or excuses.',
  inputSchema: { type: 'object', additionalProperties: false, properties: { messageRef: { type: 'string', description: 'The current message of the player you are answering; it decides isSender and photoCheckIn. Leave it out in a scheduled turn.' } }, required: [] },
} as const
export const MURPH_MY_GAME_REMINDERS_TOOL = {
  deferLoading: true,
  namespace: 'murph', name: 'my_game_reminders',
  description: "Read or set this person's own game reminders, only in their direct chat with Murph. operation=read returns their reminder time, how reminders reach them, and their live games; read before you coach them about a reminder or suggest a task. operation=set changes their local time, whether reminders arrive by text or push, and for one gameId whether reminders are on and whether they come every evening. Every evening covers only the open game days they have not posted on. Confirm delivery only from reaches in the result; when it is none, ask them to turn on notifications in the Murph app. If they want help sticking to it, use the behavior-followthrough skill: one question at a time, a real time of day, a small first step and a plan for a bad day. Never state or guess another player's status or private words.",
  inputSchema: { type: 'object', additionalProperties: false, required: ['operation'], properties: {
    operation: { type: 'string', enum: ['read', 'set'] }, messageRef: { type: 'string' },
    minutes: { type: 'integer', minimum: 0, maximum: 1439 }, gameId: { type: 'string' },
    on: { type: 'boolean' }, everyDay: { type: 'boolean' }, text: { type: 'boolean' }, push: { type: 'boolean' },
  } },
} as const
export const GAME_PRIVATE_REMINDER_DIRECT_GUIDANCE = 'For game reminders, use murph.my_game_reminders.'
export const MURPH_READ_GAME_RECAP_TOOL = {
  namespace: 'murph', name: 'read_game',
  description: 'Read the finished game bound to this recap turn. Returns its players, terms, result, and each day’s posts or misses with entry IDs and post details; call it first.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {}, required: [] },
} as const
export const MURPH_WRITE_RECAP_TOOL = {
  namespace: 'murph', name: 'write_recap',
  description: 'Save the recap for this finished game. Include superlatives only when read_game supplies eligible player memberIds, and then give exactly one {memberId, title, line} for each. A title completes the heading "Most likely to" without repeating those words: 2 to 6 words, at most 80 characters, no full stop at the end, and different for each player. A line is one short, warm, teasing sentence of at most 160 characters. Base each one only on this game’s entries and on text every player can see: posts, words, timing, streaks, shared excuses and tasks. Never invent details, use private information, be mean, or joke about bodies or weight. In a group game, give every eligible person one kind superlative and do not shame anyone for missed days. Returns ok, or a list of problems to fix (unknown entries, a quote that is not verbatim, text over its limit, banned words). Fix every problem and call it again; the last accepted call is what the players see.',
  inputSchema: { type: 'object', additionalProperties: false, required: ['pages', 'chatLine'], properties: {
    pages: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['background', 'blocks'], properties: {
      background: { type: 'string', enum: ['night', 'paper', 'sage', 'sienna', 'slate'] },
      blocks: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['kind'], properties: {
        kind: { type: 'string', enum: ['contactSheet', 'headline', 'kicker', 'photo', 'photoPair', 'quote', 'stat'] },
        entryIds: { type: 'array', items: { type: 'string' } }, style: { type: 'string', enum: ['print', 'fullBleed'] },
        text: { type: 'string' }, statValue: { type: 'string' },
        quote: { type: 'object', additionalProperties: false, required: ['who', 'text'], properties: { who: { type: 'string' }, text: { type: 'string' }, date: { type: 'string' } } },
      } } },
    } } }, superlatives: { type: 'array', minItems: 2, maxItems: 10, items: { type: 'object', additionalProperties: false, required: ['memberId', 'title', 'line'], properties: {
      memberId: { type: 'string' }, title: { type: 'string', maxLength: 80 }, line: { type: 'string', maxLength: 160 },
    } } }, scoreLine: { type: 'string' }, chatLine: { type: 'string' },
  } },
} as const
export const MURPH_GAME_LORE_TOOL = {
  namespace: 'murph', name: 'game_lore',
  description: 'Read or replace game lore when instructed. Returns current lore or save confirmation.',
  inputSchema: { type: 'object', additionalProperties: false, required: ['operation'], properties: {
    operation: { enum: ['read', 'replace'] }, content: { type: 'string' },
  } },
} as const

/** How to read the returned state. Every successful read carries it, including a scheduled one. */
export const GAME_READ_FACTS_GUIDANCE = `Reading this result: a game day ends at 3 AM the next morning in each player's own timeZone, and dayOne is that player's first day. An open day with no post yet is not a miss: the player has until 3 AM. With an any-N-days schedule the target is a total for the whole game, so no single day is owed. Answer questions about progress from progress and result as returned, and do not guess why someone did not post. ${GAME_PRIZE_WORDS}`
/** How to act on a player's message and how to start a game. Every read for a player carries it. */
export const GAME_SHARED_SETUP_GUIDANCE = [
  "Every game turn: act only for the player whose message you are answering, and pass that message's messageRef. Use the memberIds and names returned here. A yes counts only from that player's own message: a poll vote, or being in the chat, is never a yes. Say that a game was created, changed, counted or ended only when a tool result shows it; a successful call does not prove that a message was delivered. Each update_game and game_photo result ends with what to say next. When a call is refused, explain the rule and the next step once, and do not retry or read again. Call a requested change an ask. Keep internal IDs, private contact labels, captions, photos and the tasks of people who have not joined out of the chat. Do not ask one player to push another, shame a missing post, or joke about bodies or weight.",
  'Starting a game: start one only when someone asks for it now; talk of maybe playing sometime is not a request. In a chat of two players it is a pair game, played for one prize for the winner or one dare for the loser. In a larger chat it is a group game, with one task for each person you address and one prize for the winner. A game needs those tasks and that prize or dare, and nothing else has to be asked. Unless they say otherwise it runs 7 days, every day, with any kind of check-in, and starts when the others agree. If a task or the prize or dare is missing, ask for just that, and say it will otherwise run 7 days, every day. A length outside 3 to 365 days, or a picked start that is not between tomorrow and 60 days out, cannot be saved: say the limit and ask again without calling update_game. If a game already exists here and the request could be either a new game or a change to that one, ask which, once. If the same game is already waiting for a yes, say so and do not create it again. Otherwise call update_game create once with the complete terms; creating is the creator\'s yes and nobody else\'s. Write each task as a short command without the player\'s name, starting with the plain verb: "Jo runs a mile" becomes "Run a mile". Write the prize or dare the same way, without names or the words winner and loser: "winner picks dinner" becomes the prize "Pick dinner", and "loser buys the coffee" becomes the dare "Buy the coffee".',
].join('\n')
/** Carried unless every open game is already live. */
export const GAME_SHARED_CHOICE_POLL_GUIDANCE = "Polls: when the players ask for a vote, or are split between concrete options for something they share (a shared task, the prize or dare, the length, the start or the schedule), create one murph.poll with 2 to 4 options, keeping their labels word for word, and do not repeat the options in your reply. Later, read the poll's results before you propose terms from the winner; if it is tied, say so and ask them to choose. Run one poll at a time. Do not poll one person's own task or a yes-or-no question."
/** What a read for a player carries when the room has no game. */
export const GAME_SETUP_CHAT_GUIDANCE = [GAME_READ_FACTS_GUIDANCE, GAME_SHARED_SETUP_GUIDANCE, GAME_SHARED_CHOICE_POLL_GUIDANCE].join('\n')
/** Added when the room has a finished game. */
export const GAME_PLAY_AGAIN_GUIDANCE = "Playing again: pass the finished game's id as previousGameId. For a pair game, pass the terms they want. For a group game the create copies the last game's final rules and ignores any other terms you pass, so if the starter wants changes, create once and then call edit_terms while nobody else has joined."
/** Added while a pair game is waiting for its first yes. */
export const GAME_PAIR_AGREE_GUIDANCE = "Agreeing to a pair game: seat 0 created the game and seat 1 is the other player; match the speaker's memberId to a seat. Only seat 1 can agree, and any plain yes counts: call update_game approve with expectedTermsVersion set to terms.n and no proposalId. Never approve for the creator. If the terms changed after the offer they answered, say what changed and ask again first. If seat 1 says no, or the creator changes their mind, call cancel_game. A game with status invited is a Play again request addressed to the other player: only that player can approve it, or ask for a change with propose, which takes their seat without accepting. Until they have done one of those they cannot decline or cancel it; the creator can cancel it but cannot approve it. An invitation sent as a link to nobody in particular can only be accepted in the Murph app. Until a game is live, nobody owes a post."
/** Added while a pair game is waiting or live. */
export const GAME_PAIR_CHAT_GUIDANCE = [
  "Changing a pair game (a game without maxPlayers): the player who asks calls update_game propose with only what they want changed now, and that call is their yes. The other player answers with approve or decline, using pendingChange.id as proposalId, and the asker can withdraw the ask with cancel. One ask waits at a time, and only the returned pendingChange is open. For a counter-offer, first decline the waiting ask (or cancel it when it is the speaker's own), then propose only the new request and say it replaces the earlier one. If a player comes round to an ask they just declined, propose that same change for them.",
  'What can change: tasks lock when either player reaches Day 1, and a task change sends both seats, keeping the unchanged words. The prize or dare can change until the game ends and covers the whole game. Length and schedule changes affect only days that have not started, and posts are kept. If someone asks to change a locked task, say no once and offer what can still change: the prize or dare, the length or schedule of the days ahead, their own unfinished days, or the tasks of the next game. Offer an early start only when changeControls.canStartNow is true, with propose and kind start_now.',
  "Ending early: a live game ends early only when a player clearly asks to stop the whole game. A joke, a missed day or venting is not that request. Call propose with kind call_off: the other player's yes ends it with no winner and nothing owed, and their no keeps it going.",
].join('\n')
/** Added while a group game still has people who can join. */
export const GAME_GROUP_JOIN_GUIDANCE = 'Joining a group game: the starter is seated when the game is created, and game.players lists who has joined. pendingInviteeCount is only a number, so never name or guess who has not joined. Each invited person joins for themselves: any plain yes counts, and you call update_game approve with expectedTermsVersion set to terms.n and no proposalId. If the terms changed after the offer they answered, say what changed and ask again first; when the change is to a task you cannot show, say only that the terms changed and that their invitation in the Murph app shows their own task. The second person to join starts the game, and people who join later play on the same calendar. A note someone sent before joining (Talk it over) can be attributed to its author, but it is not a yes and changes nothing. An invitation sent as a link to nobody in particular can only be accepted in the Murph app.'
/** Added while a group game is waiting or live. */
export const GAME_GROUP_MODE_GUIDANCE = [
  "Changing a group game (maxPlayers is 10, even with only two players): any seated player asks with update_game edit_terms. Pass the full terms with defaultTask, one task for each seated memberId, expectedTermsVersion and a new proposalId. Send tasks only for seated players; the server keeps the private tasks of people who have not joined. While only the starter has joined, the starter's edit applies at once. After that an edit applies when more than half of the remaining players agree, and the asker counts as a yes. The others answer for themselves with approve or decline and that proposalId. A yes or no is final for that ask, only the asker can cancel it, and one ask waits at a time. pendingChange.yesNeeded is already the number of further yeses needed, so say that number as it is. Use votes to say who has answered, and never say that everyone agreed or that someone who has not joined did. If someone joined between a Play again create and the starter's edit, read the game again, because the edit is now an ask that needs a majority; never create a second game to fix it. When a refusal needs a legal or profile step, give the one next step in the Murph app.",
  'What can change: tasks lock at Day 1, the start date locks at the first post, the prize can change until the end, length and weekday changes affect only days that have not started, and an any-N-days target locks at the start. When changeControls.canStartNow is true, a remaining player can ask for an earlier start with propose and kind start_now. That is their yes only, so the others still vote.',
  'Ending early: only the starter can call cancel_game, and only before any check-in and before a post is due, even if the game is already live. Otherwise a live game ends early only when a player clearly asks to stop the whole game; a joke, a missed day or venting is not that request. A remaining player calls propose with kind call_off, every remaining player must say yes (yesNeeded counts everyone left), and one no closes the ask.',
  'Prove it: only the challenged player can concede their own day. Do not judge the evidence or ask the group for a verdict.',
].join('\n')
/** Added while a game is live: how a player corrects one of their own days. */
export const GAME_DAY_CORRECTION_GUIDANCE = "Correcting a day: when a player says they did not finish a day, call update_game mark_incomplete with that date. When a player says they did a day, or asks you to count it, call mark_complete with that date. Take their word: do not ask for proof, do not put it to the other players, and do not offer this unasked. If their message already says what they did, pass those words as text; otherwise leave text out. Both calls act only on the speaker's own days in a live game in this chat, and need gameId and date but no proposalId and nobody's approval. Work out the date from the message's Occurred at time, converted to the speaker's timeZone: before 3 AM, today is the previous calendar date and yesterday is the day before that; from 3 AM on, today is that calendar date. Do not use progress.checkedAt or the current time. If there is no timestamp, or the message covers a range of times, ask once which day. A refusal names its rule: an open day is still theirs to post, and a day off, or a game that requires a photo or heart rate, cannot be counted this way."
/** Added while a game is waiting or live. */
export const GAME_REMINDER_GUIDANCE = "Reminders: when a player asks for a reminder for their own game, call update_game set_reminder with minutes after midnight in their local time. It is never a new room automation, and an older scheduled room reminder is left to finish on its own. Leave on out for a change of time; pass on together with gameId only when they ask to switch one game's reminders on or off. Ask which task only when several games could fit. A reminder belongs to the player who asked: never set another player's reminder from someone else's words or a group vote."
/** What a read carries when the room's only games are group games that people are still joining. */
export const GAME_GROUP_CHAT_GUIDANCE = [GAME_SETUP_CHAT_GUIDANCE, GAME_GROUP_JOIN_GUIDANCE, GAME_GROUP_MODE_GUIDANCE, GAME_REMINDER_GUIDANCE].join('\n')
/** With several games in one room, a move acts on the one game it can mean, or asks once. */
export const GAME_SELECTION_GUIDANCE = "\nSeveral games are open in this chat, and each update_game or game_photo call acts on exactly one gameId. First work out which games the message can apply to. For marking a day not done: games where the speaker has a post on that date. For counting a day as done: games where that date does not show as posted (a missed day and a day marked not done both show as unposted). For a change: games it would actually change. For a yes or no: the asks waiting on the speaker. For a photo nobody asked you to save: the speaker's games whose task it shows. For a photo they ask you to save: the game they name, or the photo offer waiting on them. Then choose among those only from the speaker's own words: task words in this message or the one they just sent, or their answer to your question. Do not choose by which game came up last, a recent notice, another player's messages, or the newest or first game. If exactly one game fits, act on it. If several fit, make no update_game or game_photo call and ask one short question that names only those games by their tasks, such as \"Which game, steps or plank?\", then act on the answer. The photo rules still decide whether a photo gets any reply or save. Talk about progress one named task at a time. Lore is shared by everyone who plays in this chat."
/** What to say after a successful update_game, appended to the result of the call it describes. */
export const GAME_UPDATE_RESULT_GUIDANCE = {
  created: "The game is created and waiting. Reply with one short invitation that names each task, the prize or dare, the schedule (say \"every day\" when it is every day), the length and the start, and asks each other player to agree for themselves. With no picked date, the yes that starts the game sets the start: that same day when it arrives from 3 AM up to 3 PM, otherwise the next game day. So do not promise a start today. If another player's own message in this turn already says yes to these same terms, call update_game approve now with that message's messageRef and expectedTermsVersion set to terms.n, and do not ask them again.",
  joined: 'Their yes is saved. Confirm it in a few words, without repeating the terms, offering reminders or asking a question. When this yes starts the game, a separate kickoff message introduces it.',
  ended: 'The game has ended. Send no message, because the app posts the one announcement.',
  waiting: 'The ask is waiting. Say who asked and what would change compared with the current terms, and ask the other players to answer for themselves. This reply is the only notice they get.',
  applied: 'No ask is waiting now, so the change applied. Confirm it in a few words.',
  counted: 'Their yes is counted and the ask is still waiting. Say how many more yeses pendingChange.yesNeeded shows.',
  declined: 'The ask is declined and the terms stay as they were. Say so in a few words.',
} as const
const GAME_DAY_REPLY_GUIDANCE = ' Reply in one plain line that names the date or weekday, with no day number, score change or remark about another player.'
/** What a counted or uncounted day came back as. */
export const GAME_DAY_OUTCOME_GUIDANCE = {
  marked_incomplete: 'The day is now marked not done.' + GAME_DAY_REPLY_GUIDANCE,
  already_incomplete: 'The day was already marked not done.' + GAME_DAY_REPLY_GUIDANCE,
  restored: 'Their post counts again.' + GAME_DAY_REPLY_GUIDANCE,
  words_needed: "Nothing changed yet. Ask once what they want that day's post to say, then call mark_complete for the same date with text set to their answer.",
  credited: 'The missed day now counts, posted in their own words.' + GAME_DAY_REPLY_GUIDANCE,
  no_artifact: 'That date has no post, so nothing changed. Say so in one plain line.',
  already_complete: 'The day already counted. Say so in one plain line.',
} as const
/** How a saved reminder arrives. */
export const GAME_REMINDER_OUTCOME_GUIDANCE = {
  push: 'The reminder is saved and reaches them. Confirm in a few words, such as "Done, Leo. 6pm your time, just to you, on days you haven\'t posted." Say "your time" and do not name a city or a time zone.',
  text: 'The reminder is saved and reaches them. Confirm in a few words, such as "Done, Leo. 6pm your time, just to you, on days you haven\'t posted." Say "your time" and do not name a city or a time zone.',
  none: 'The reminder is saved but cannot reach them yet. Say so, and ask them to turn on notifications in the Murph app.',
} as const
/** What a photo call came back as. */
export const GAME_PHOTO_OUTCOME_GUIDANCE = {
  offer: 'The offer is recorded and nothing is saved yet. Ask one brief question, such as "Want me to use this as your check-in photo?"',
  suppressed: 'Send no reply about this photo.',
  saved: 'The check-in is saved. Confirm it in a few words.',
  dismissed: 'Nothing was saved, and this photo will not be offered again.',
} as const
/** What a refusal code means, appended to the refusal that carries it. */
export const GAME_REFUSAL_GUIDANCE = {
  PROFILE_REQUIRED: 'A player has no first name or time zone yet. Name that person by first name, leave the ID out, and ask them to add it in the Murph app.',
  CONTENT_NOT_ALLOWED: 'Those words cannot be used in a game. Ask for different words.',
  DAY_CLOSED: 'If this refusal is for a day off, credit the effort in one brief, kind reply and name the day off and the next game day from the refusal, or say that no game days remain. Do not retry, suggest a way around it in the app, or say the post counted or was saved.',
} as const
export const MURPH_UPDATE_GAME_TOOL = {
  namespace: 'murph', name: 'update_game',
  description: "Create or change an app game for the player who spoke. Call murph.read_game first in the same turn and follow the rules in its result; they cover starting, agreeing, changing, correcting a day, ending early and reminders. Pass the messageRef of the player whose own words you are acting on, and never act for another player. An ordinary yes or no in conversation counts, so do not ask for special words. Operations: create starts a game. approve and decline are the speaker's answer to an invitation or to a waiting ask. propose asks for a change in a pair game, and for start_now or call_off in any game. edit_terms asks for a change in a group game. cancel withdraws the speaker's own waiting ask. cancel_game calls off a game. mark_incomplete and mark_complete uncount or count one of the speaker's own days. set_reminder sets the speaker's own reminder.",
  inputSchema: { type: 'object', additionalProperties: false, properties: {
    messageRef: { type: 'string', description: 'Message ref of the current message from the player asking for or agreeing to this change.' },
    operation: { type: 'string', enum: ['create', 'propose', 'approve', 'decline', 'cancel', 'mark_incomplete', 'mark_complete', 'cancel_game', 'edit_terms', 'set_reminder'] },
    minutes: { type: 'integer', minimum: 0, maximum: 1439, description: "set_reminder only: the speaker's local minutes after midnight." },
    on: { type: 'boolean', description: 'set_reminder only: pass with gameId only when the speaker asks to switch that game on or off. Leave out for a change of time.' },
    date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: "mark_incomplete and mark_complete only: the day as YYYY-MM-DD in the speaker's game time." },
    text: { type: 'string', minLength: 1, maxLength: 140, description: "mark_complete only: the speaker's own words about that day, copied exactly, on one line. Never write or edit them yourself; leave this out when they gave none." },
    gameId: { type: 'string', minLength: 8, maxLength: 64, description: 'For create: game_ plus at least 20 random lowercase letters and digits, with no names, dates or terms; reuse one only to retry the same create.' }, proposalId: { type: 'string', minLength: 8, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$', description: 'The waiting pendingChange.id when answering or cancelling an ask; a new unique ID for propose or a group edit_terms ask.' },
    expectedTermsVersion: { type: 'integer', minimum: 1, description: 'Current terms.n. Required for propose and edit_terms, and for approve without proposalId.' },
    groupWord: { type: 'string', maxLength: 40, description: 'Group create only: their shared group word; defaults to group.' },
    previousGameId: { type: 'string' },
    terms: { type: 'object', additionalProperties: false, properties: {
      defaultTask: { type: 'string', minLength: 1, maxLength: 200, description: 'Group only; required for edit_terms. Keep the returned default task unless asked to change it.' },
      tasks: { type: 'array', minItems: 1, maxItems: 10, description: 'create needs 2 to 10 addressed people; edit_terms needs one task for each returned seated player.', items: { type: 'object', additionalProperties: false, properties: { memberId: { type: 'string' }, text: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['memberId', 'text'] } },
      stakes: { type: 'array', minItems: 1, maxItems: 1, items: { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', enum: ['prize', 'dare'] }, item: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['kind', 'item'] } },
      lengthDays: { type: 'integer', minimum: 3, maximum: 365, description: 'Leave out for 7.' }, startsOn: { type: 'string', description: 'YYYY-MM-DD. Leave out to start when the others agree.' },
      schedule: { type: 'object', additionalProperties: false, description: 'Either days or count.', properties: { days: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 6 }, description: 'Monday 0 through Sunday 6; every day is 0 through 6.' }, count: { type: 'integer', minimum: 1, maximum: 365, description: 'Any N days across the whole game.' } } },
    }, required: ['tasks', 'stakes', 'schedule'] },
    change: { type: 'object', additionalProperties: false, description: 'Only the fields the acting message asks to change now; omit every other field, including requests from earlier messages.', properties: {
      kind: { type: 'string', enum: ['start_now', 'edit', 'call_off'], description: 'call_off asks to end a live game early with no winner.' },
      tasks: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'object', additionalProperties: false, properties: { seat: { type: 'integer', minimum: 0, maximum: 1 }, text: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['seat', 'text'] } },
      stakes: { type: 'array', minItems: 1, maxItems: 1, items: { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', enum: ['prize', 'dare'] }, item: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['kind', 'item'] } },
      lengthDays: { type: 'integer', minimum: 3, maximum: 365 }, startsOn: { type: ['string', 'null'], description: 'YYYY-MM-DD, or null to reset the default start before play begins.' },
      schedule: { type: 'object', additionalProperties: false, properties: { days: { type: 'array', minItems: 1, maxItems: 7, items: { type: 'integer', minimum: 0, maximum: 6 }, description: 'Monday 0 through Sunday 6.' }, count: { type: 'integer', minimum: 1, maximum: 365, description: 'Any N days across the whole game.' } } },
    }, required: ['kind'] },
  }, required: ['messageRef', 'operation'] },
} as const
/** The one resident line for iMessage game chats. The procedure lives once, in the game_photo description. */
// Resident pointer for a group chat that has the game tools. The rules themselves
// arrive with each read_game result, so this only says where to start.
export const GAME_RESIDENT_GROUP_POINTER = "Challenges and games: when someone wants to start, change, check or settle a challenge or game, call `murph.read_game` first and follow the rules its result ends with. A new challenge is always an app game. Read group-challenge only when the idea is still loose or the room has an older challenge scored from shared data."
export const GAME_PHOTO_CHAT_GUIDANCE = "In this iMessage game chat, a player's photo of their own game task can become their check-in: follow murph.game_photo. Any other photo gets no game reply."
export const MURPH_GAME_PHOTO_TOOL = {
  namespace: 'murph', name: 'game_photo',
  description: [
    "Save a player's photo as their game check-in. iMessage only. Call murph.read_game first with the sender's messageRef, and pass that messageRef here.",
    "A photo nobody asked you to save: call operation=offer only when it is a clear, current photo of the sender's own task, read_game shows photoCheckIn.introductionAvailable, and that player has no post today. Each player gets this introduction once; after it, their later unasked photos get no game reply. Unrelated photos, and conversation that is clearly between other people, get no game reply either.",
    'A request to save a photo: call operation=save without asking again. A yes to the waiting offer: call save and leave out sourceMessageRef and attachmentOrdinal, so the server uses the offered photo and nothing else. A no: call dismiss. An offer covers that one photo and never means later photos are saved automatically.',
    "For a new photo, sourceMessageRef and attachmentOrdinal pick one attachment that sender sent in this chat today. Never save another person's photo, save for an earlier day, or say the photo proves the task was done. If the player already posted today, saving replaces that post and uses their one retake: ask first unless they asked for the replacement, then pass that post's currentEntryId as replaceEntryId. A game whose check-in kind is any accepts photos; if an older game requires another kind, explain that the game does not take photos. If the photo cannot be fetched, ask them to resend it as a JPEG or HEIC photo or to post from the app. The result ends with what to say. Never mention internal IDs, flags or where the photo is stored.",
  ].join('\n'),
  inputSchema: { type: 'object', additionalProperties: false, properties: {
    messageRef: { type: 'string' }, operation: { type: 'string', enum: ['offer', 'save', 'dismiss'] },
    gameId: { type: 'string', minLength: 8, maxLength: 64 },
    sourceMessageRef: { type: 'string' }, attachmentOrdinal: { type: 'integer', minimum: 1, maximum: 32 },
    replaceEntryId: { type: 'string', description: 'Exact currentEntryId from read_game, only after explicit replacement consent.' },
  }, required: ['messageRef', 'operation', 'gameId'] },
} as const
const rawPhotoArguments = hostedGamePhotoSchema.extend({ messageRef: z.string().min(1).max(128) }).strict()
// Validate the action and message selector separately so strict action parsing
// cannot accidentally accept identity or destination selectors.
const rawUpdateArguments = z.object({ messageRef: z.string().min(1).max(128), operation: z.unknown(), gameId: z.unknown().optional(), minutes: z.unknown().optional(), on: z.unknown().optional(), terms: z.unknown().optional(), groupWord: z.unknown().optional(), previousGameId: z.unknown().optional(), proposalId: z.unknown().optional(), date: z.unknown().optional(), text: z.unknown().optional(), expectedTermsVersion: z.unknown().optional(), change: z.unknown().optional() }).strict().transform((value, ctx) => {
  const { messageRef, ...update } = value
  const parsed = hostedGameUpdateSchema.safeParse(update)
  if (!parsed.success) {
    // Name the fields to fix (never their values), so a missing expectedTermsVersion is not mistaken for a bad gameId.
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.length ? issue.path.join('.') : issue.message))].slice(0, 4).join('; ')
    ctx.addIssue({ code: 'custom', message: `Name the gameId from read_game and supply the fields for this operation (check: ${fields}). If the game is unclear, ask which task.` }); return z.NEVER
  }
  return { messageRef, update: parsed.data }
})
export type GameDynamicRequest = { action: 'my_game_reminders'; operation: 'read' | 'set'; messageRef?: string; minutes?: number; gameId?: string; on?: boolean; everyDay?: boolean; text?: boolean; push?: boolean } | { action: 'read_game'; messageRef?: string } | { action: 'update_game'; messageRef: string; update: HostedGameUpdate } | { action: 'game_photo'; messageRef: string; photo: HostedGamePhoto } | { action: 'write_recap'; recap: HostedGameRecap } | { action: 'game_lore'; operation: 'read' | 'replace'; content?: string }
export function readGameDynamicToolRequest(input: { arguments: unknown; tool: string | null }) {
  if (input.tool === 'my_game_reminders') {
    const schema = z.object({ operation: z.enum(['read', 'set']), messageRef: z.string().min(1).max(128).optional(),
      minutes: z.number().int().min(0).max(1439).optional(), gameId: z.string().min(8).max(64).optional(),
      on: z.boolean().optional(), everyDay: z.boolean().optional(), text: z.boolean().optional(), push: z.boolean().optional() }).strict()
    const parsed = parseDynamicToolArguments({ schema, value: input.arguments, schemaRootKeys: ['operation', 'messageRef', 'minutes', 'gameId', 'on', 'everyDay', 'text', 'push'], toolName: 'murph.my_game_reminders' })
    return parsed.ok ? { kind: 'game' as const, request: { action: 'my_game_reminders' as const, ...parsed.args } } : { kind: 'invalid-game-arguments' as const, validationDigest: parsed.validationDigest }
  }
  if (input.tool === 'game_lore') {
    const schema = z.discriminatedUnion('operation', [
      z.object({ operation: z.literal('read') }).strict(),
      z.object({ operation: z.literal('replace'), content: z.string().max(40000) }).strict(),
    ])
    const parsed = parseDynamicToolArguments({ schema, value: input.arguments, schemaRootKeys: ['operation', 'content'], toolName: 'murph.game_lore' })
    return parsed.ok ? { kind: 'game' as const, request: { action: 'game_lore' as const, ...parsed.args } } : { kind: 'invalid-game-arguments' as const, validationDigest: parsed.validationDigest }
  }
  if (input.tool === 'write_recap') {
    const parsed = parseDynamicToolArguments({ schema: hostedGameRecapSchema, value: input.arguments, schemaRootKeys: ['pages', 'scoreLine', 'chatLine', 'superlatives'], toolName: 'murph.write_recap' })
    return parsed.ok ? { kind: 'game' as const, request: { action: 'write_recap' as const, recap: parsed.args } } : { kind: 'invalid-game-arguments' as const, validationDigest: parsed.validationDigest }
  }
  if (input.tool === 'read_game') {
    const parsed = parseDynamicToolArguments({ schema: z.object({ messageRef: z.string().min(1).max(128).optional() }).strict(), value: input.arguments, schemaRootKeys: ['messageRef'], toolName: 'murph.read_game' })
    return parsed.ok ? { kind: 'game' as const, request: { action: 'read_game' as const, ...parsed.args } } : { kind: 'invalid-game-arguments' as const, validationDigest: parsed.validationDigest }
  }
  if (input.tool === 'game_photo') {
    const parsed = parseDynamicToolArguments({ schema: rawPhotoArguments, value: input.arguments, schemaRootKeys: ['messageRef', 'operation', 'gameId', 'sourceMessageRef', 'attachmentOrdinal', 'replaceEntryId'], toolName: 'murph.game_photo' })
    if (!parsed.ok) return { kind: 'invalid-game-arguments' as const, validationDigest: parsed.validationDigest }
    const { messageRef, ...photo } = parsed.args
    return { kind: 'game' as const, request: { action: 'game_photo' as const, messageRef, photo } }
  }
  if (input.tool !== 'update_game') return null
  const parsed = parseDynamicToolArguments({ schema: rawUpdateArguments, value: input.arguments, schemaRootKeys: ['messageRef', 'operation', 'gameId', 'minutes', 'on', 'proposalId', 'expectedTermsVersion', 'change', 'date', 'text', 'terms', 'previousGameId'], toolName: 'murph.update_game' })
  return parsed.ok ? { kind: 'game' as const, request: { action: 'update_game' as const, ...parsed.args } } : { kind: 'invalid-game-arguments' as const, validationDigest: parsed.validationDigest }
}

async function executeTrustedGameRecapTool(input: { request: GameDynamicRequest; context: AssistantHostedToolContext | null }): Promise<ReturnType<typeof toolTextResult> | null> {
  if (input.request.action !== 'read_game' && input.request.action !== 'write_recap') return null
  const tool = input.context?.groupTool
  const recapScope = input.context?.currentGameRecapScope?.()
  if (!tool || !recapScope) return unavailableGameRecapToolResult(input.request.action)
  const origin = { kind: 'game_recap' as const, gameId: recapScope.gameId, eventId: recapScope.eventId }
  try {
    return input.request.action === 'read_game'
      ? await executeTrustedGameRecapRead({ origin, tool })
      : await executeTrustedGameRecapWrite({ context: input.context, origin, recap: input.request.recap, tool })
  } catch (error) {
    return toolTextResult(false, 'The recap action could not be confirmed. Read the game and fix every reported problem before trying again.', 'handler_exception', error)
  }
}

function unavailableGameRecapToolResult(action: 'read_game' | 'write_recap'): ReturnType<typeof toolTextResult> | null {
  return action === 'write_recap'
    ? toolTextResult(false, 'write_recap is available only in the bound game recap turn.', 'authority_rejected')
    : null
}

async function executeTrustedGameRecapRead(input: {
  origin: { kind: 'game_recap'; gameId: string; eventId: string }
  tool: NonNullable<AssistantHostedToolContext['groupTool']>
}): Promise<ReturnType<typeof toolTextResult>> {
  const result = await input.tool.request({ action: 'read_game', origin: input.origin })
  return toolTextResult(true, JSON.stringify('recapGame' in result.result ? result.result.recapGame : result))
}

async function executeTrustedGameRecapWrite(input: {
  context: AssistantHostedToolContext | null
  origin: { kind: 'game_recap'; gameId: string; eventId: string }
  recap: HostedGameRecap
  tool: NonNullable<AssistantHostedToolContext['groupTool']>
}): Promise<ReturnType<typeof toolTextResult>> {
  const priorChatLines = (await input.context?.readGameLore?.() ?? '')
    .split(/\r?\n/u)
    .flatMap((line) => {
      const marker = line.indexOf('Chat line used:')
      if (marker < 0) return []
      const chatLine = line.slice(marker + 'Chat line used:'.length).trim()
      return chatLine && chatLine.length <= 160 ? [chatLine] : []
    })
    .slice(-100)
  const result = await input.tool.request({ action: 'write_recap', origin: input.origin, recap: input.recap, priorChatLines })
  const payload = result.result
  if (payload.status === 'ok' && input.context?.currentGameRecapScope?.()?.loreAccess === 'read'
    && 'recap' in payload && payload.recap) {
    await input.context.appendGameRecapChatLine?.(payload.recap.chatLine)
  }
  if (payload.status === 'ok' && 'chatLine' in payload && typeof payload.chatLine === 'string') {
    input.context?.recordSavedGameRecapChatLine?.(payload.chatLine)
  }
  const output = 'recapOutcome' in payload && typeof payload.recapOutcome === 'string'
    ? payload.recapOutcome
    : JSON.stringify(result)
  return toolTextResult(true, output)
}

async function executeGameLoreTool(input: {
  request: Extract<GameDynamicRequest, { action: 'game_lore' }>
  context: AssistantHostedToolContext | null
}) {
  if (!input.context?.readGameLore || !input.context?.replaceGameLore) return toolTextResult(false, 'Game lore is unavailable for this turn.', 'authority_rejected')
  if (input.request.operation === 'replace' && input.context.currentGameRecapScope?.()?.loreAccess === 'read') {
    return toolTextResult(false, 'Game lore is read-only for this recap.', 'authority_rejected')
  }
  try {
    if (input.request.operation === 'read') return toolTextResult(true, await input.context.readGameLore())
    await input.context.replaceGameLore(input.request.content ?? '')
    return toolTextResult(true, 'ok: game lore replaced')
  } catch (error) {
    return toolTextResult(false, 'Game lore could not be accessed.', 'handler_exception', error)
  }
}

async function executeOrdinaryGameTool(input: {
  request: Extract<GameDynamicRequest, { action: 'read_game' | 'update_game' | 'game_photo' }>
  context: AssistantHostedToolContext | null
}) {
  const tool = input.context?.groupTool
  const scope = input.context?.currentUserActionScope?.()
  if (!tool || scope?.conversationScope !== 'group' || !scope.acceptedInputIds.length) return toolTextResult(false, 'Game tools require current player input in the game group chat.', 'authority_rejected')
  const assistantInputId = input.request.messageRef ?? scope.acceptedInputIds[scope.acceptedInputIds.length - 1]!
  if (!scope.acceptedInputIds.includes(assistantInputId)) return toolTextResult(false, 'Use a Message ref from this group turn.', 'authority_rejected')
  const origin = { kind: 'accepted_input' as const, assistantInputId }
  try {
    const result = await tool.request(input.request.action === 'read_game' ? { action: 'read_game', origin, includePlayers: true } : input.request.action === 'game_photo' ? { action: 'game_photo', origin, photo: input.request.photo } : { action: 'update_game', origin, update: input.request.update })
    return toolTextResult(true, JSON.stringify(result) + gameResultGuidance(result.result, input.request))
  } catch (error) {
    return toolTextResult(false, 'The game action could not be confirmed. Read the game to check its current state before claiming a change applied.', 'handler_exception', error)
  }
}

type GameToolResult = Awaited<ReturnType<NonNullable<AssistantHostedToolContext["groupTool"]>["request"]>>["result"]
type OrdinaryGameRequest = Extract<GameDynamicRequest, { action: 'read_game' | 'update_game' | 'game_photo' }>

/**
 * The rules a result carries. A read carries the rules for what the room holds right now, so a room
 * with no game carries only how to start one. A write carries what to say about what it returned.
 */
function gameResultGuidance(payload: GameToolResult, request: OrdinaryGameRequest): string {
  const games = ('state' in payload ? payload.state?.games : undefined) ?? []
  const open = games.filter(game => ['live', 'negotiating', 'invited'].includes(game.status))
  const selection = open.length > 1 ? GAME_SELECTION_GUIDANCE : ''
  if (request.action !== 'read_game') {
    const said = payload.status !== 'ok' ? gameRefusalGuidance(payload, request.action)
      : request.action === 'game_photo' ? ('photoOutcome' in payload && payload.photoOutcome ? GAME_PHOTO_OUTCOME_GUIDANCE[payload.photoOutcome] : '')
      : gameUpdateGuidance(payload, request.update, games)
    return selection + (said ? '\n' + said : '')
  }
  if (payload.status !== 'ok') return selection
  const pair = open.filter(game => game.maxPlayers !== 10)
  const group = open.filter(game => game.maxPlayers === 10)
  const live = open.some(game => game.status === 'live')
  return selection + '\n' + [GAME_READ_FACTS_GUIDANCE, GAME_SHARED_SETUP_GUIDANCE,
    ...(!open.length || open.some(game => game.status !== 'live') ? [GAME_SHARED_CHOICE_POLL_GUIDANCE] : []),
    ...(games.some(game => game.status === 'settled' || game.status === 'void') ? [GAME_PLAY_AGAIN_GUIDANCE] : []),
    ...(pair.some(game => game.status !== 'live') ? [GAME_PAIR_AGREE_GUIDANCE] : []),
    ...(pair.length ? [GAME_PAIR_CHAT_GUIDANCE] : []),
    ...(group.some(game => game.status === 'invited' || (game.pendingInviteeCount ?? 0) > 0) ? [GAME_GROUP_JOIN_GUIDANCE] : []),
    ...(group.length ? [GAME_GROUP_MODE_GUIDANCE] : []),
    ...(live ? [GAME_DAY_CORRECTION_GUIDANCE] : []),
    ...(open.length ? [GAME_REMINDER_GUIDANCE] : [])].join('\n')
}

/** What to say after a successful update, worked out from the operation and the state it returned. */
function gameUpdateGuidance(payload: GameToolResult, update: HostedGameUpdate, games: readonly { id: string; status: string; pendingChange?: unknown }[]): string {
  if ('dayOutcome' in payload && payload.dayOutcome) return GAME_DAY_OUTCOME_GUIDANCE[payload.dayOutcome.status]
  if (update.operation === 'set_reminder') return 'reaches' in payload && payload.reaches ? GAME_REMINDER_OUTCOME_GUIDANCE[payload.reaches] : ''
  if (update.operation === 'create') return GAME_UPDATE_RESULT_GUIDANCE.created
  if (update.operation === 'cancel_game') return GAME_UPDATE_RESULT_GUIDANCE.ended
  // A yes with no proposalId accepts an invitation.
  if (update.operation === 'approve' && !update.proposalId) return GAME_UPDATE_RESULT_GUIDANCE.joined
  if (!('state' in payload) || !payload.state) return ''
  const game = games.find(candidate => candidate.id === update.gameId)
  const waiting = game?.pendingChange != null
  switch (update.operation) {
    case 'approve':
      // A yes to an ask either applies it, still needs more yeses, or was the last yes of a
      // call-off, which ends the game.
      if (!game || !['live', 'negotiating', 'invited'].includes(game.status)) return GAME_UPDATE_RESULT_GUIDANCE.ended
      return waiting ? GAME_UPDATE_RESULT_GUIDANCE.counted : GAME_UPDATE_RESULT_GUIDANCE.applied
    case 'decline': return update.proposalId && !waiting ? GAME_UPDATE_RESULT_GUIDANCE.declined : ''
    case 'propose': case 'edit_terms': return !game ? '' : waiting ? GAME_UPDATE_RESULT_GUIDANCE.waiting : GAME_UPDATE_RESULT_GUIDANCE.applied
    default: return ''
  }
}

function gameRefusalGuidance(payload: GameToolResult, action: 'update_game' | 'game_photo'): string {
  const code = 'error' in payload && typeof payload.error === 'string' ? payload.error.split(':', 1)[0] : ''
  if (code === 'DAY_CLOSED') return action === 'game_photo' ? GAME_REFUSAL_GUIDANCE.DAY_CLOSED : ''
  return code === 'PROFILE_REQUIRED' || code === 'CONTENT_NOT_ALLOWED' ? GAME_REFUSAL_GUIDANCE[code] : ''
}

export async function executeGameTool(input: { request: GameDynamicRequest; context: AssistantHostedToolContext | null }) {
  if (input.request.action === 'my_game_reminders') {
    const scope = input.context?.currentUserActionScope?.()
    const tool = input.context?.myGameRemindersTool
    if (!tool || scope?.conversationScope !== 'direct' || !scope.acceptedInputIds.length) return toolTextResult(false, 'Private game reminders require your current direct message.', 'authority_rejected')
    const assistantInputId = input.request.messageRef ?? scope.acceptedInputIds[scope.acceptedInputIds.length - 1]!
    if (!scope.acceptedInputIds.includes(assistantInputId)) return toolTextResult(false, 'Use this direct message to change reminders.', 'authority_rejected')
    try {
      const { messageRef: _messageRef, ...request } = input.request
      return toolTextResult(true, JSON.stringify(await tool.request({ ...request, origin: { kind: 'accepted_input', assistantInputId } })))
    } catch (error) { return toolTextResult(false, 'Game reminders could not be confirmed.', 'handler_exception', error) }
  }
  if (input.request.action === 'game_lore') return executeGameLoreTool({ ...input, request: input.request })
  const recapResult = await executeTrustedGameRecapTool(input)
  if (recapResult) return recapResult
  if (input.request.action === 'write_recap') return toolTextResult(false, 'write_recap is available only in the bound game recap turn.', 'authority_rejected')
  if (input.request.action === 'read_game') {
    const scheduledRead = await executeScheduledGameRead(input.context)
    if (scheduledRead) return scheduledRead
  }
  return executeOrdinaryGameTool({ ...input, request: input.request })
}

/** A verified scheduled occurrence reads the bound room's shared game state; it never acts for a player. */
async function executeScheduledGameRead(context: AssistantHostedToolContext | null) {
  const tool = context?.groupTool
  if (!tool || context?.currentUserActionScope?.()?.acceptedInputIds.length) return null
  const invocation = context?.currentInvocationScope?.()
  if (invocation?.origin.kind !== 'automation_occurrence' || invocation.conversationScope !== 'group') return null
  const { automationId, occurrenceAt } = invocation.origin
  try {
    const result = await tool.request({ action: 'read_game', origin: { kind: 'automation_occurrence', automationId, occurrenceAt }, includePlayers: true })
    return toolTextResult(true, JSON.stringify(result) + (result.result.status === 'ok' ? '\n' + GAME_READ_FACTS_GUIDANCE : ''))
  } catch (error) {
    return toolTextResult(false, 'The game state could not be read.', 'handler_exception', error)
  }
}
