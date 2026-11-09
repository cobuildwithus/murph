import type { HostedGameUpdate } from '@murphai/hosted-execution/runtime-control'
export const SETUP_PLAYERS = [
  { memberId: 'player_ava', firstName: 'Ava', timeZone: 'UTC' },
  { memberId: 'player_sam', firstName: 'Sam', timeZone: 'UTC' },
]
export const SETUP_TERMS = {
  tasks: [{ memberId: 'player_ava', text: 'Walk twenty minutes' }, { memberId: 'player_sam', text: 'Read a chapter' }],
  schedule: { days: [0, 1, 2, 3, 4, 5, 6] }, stakes: [{ kind: 'prize' as const, item: 'Choose the film' }], lengthDays: 7,
}
type CreateTerms = Extract<HostedGameUpdate, { operation: 'create' }>['terms']
export interface GameSetupScenario {
  name: string
  message: string
  history?: string
  speaker?: 'Sam'
  state?: 'waiting' | 'live' | 'settled' | 'invited'
  pendingCallOff?: true
  otherLiveGame?: boolean
  create?: CreateTerms
  previousGameId?: string
  operation?: 'approve' | 'cancel_game' | 'propose'
  change?: Extract<HostedGameUpdate, { operation: 'propose' }>['change']
  error?: string
  unavailable?: boolean
  poll?: 'create' | 'read' | 'tie'
  options?: string[]
  reply: RegExp[]
  forbidden?: RegExp
  quiet?: boolean
}
const full = 'Murph, set up a challenge for us: I walk twenty minutes, Sam reads a chapter, every day for 7 days, winner gets to choose the film, start when Sam agrees.'
const create = (name: string, message = full, terms: CreateTerms = SETUP_TERMS): GameSetupScenario => ({ name, message, create: terms, reply: [/walk(?:s|ing)? (?:twenty|20) minutes/i, /read(?:s|ing)? (?:a|one|1) chapter/i, /film/i, /Sam/i, /\?/u] })
const termsHistory = 'Ava: My task is Walk twenty minutes. Sam: My task is Read a chapter. Ava: Winner gets to Choose the film.'
export const GAME_CHAT_SETUP_SCENARIOS: GameSetupScenario[] = [
  { name: 'game talk follow-up proposes only the current speakers requested prize', state: 'waiting',
    history: 'Murph: Sam wants to talk about the film prize before agreeing. Nothing has changed. Ava, what do you think? Sam: Breakfast in bed would be fun.',
    message: 'Murph, I would like breakfast in bed as the prize instead. Ask Sam if that works.',
    operation: 'propose', change: { kind: 'edit', stakes: [{ kind: 'prize', item: 'Breakfast in bed' }] },
    reply: [/Sam/i, /breakfast in bed/i, /\?/u], forbidden: /now live|has started|you.ve agreed|we.ve changed/i },

  create('full terms in one message'),
  create('default seven days every day', 'Murph, set up a game: I walk twenty minutes, Sam reads a chapter, winner chooses the film. Start when Sam agrees.'),
  { ...create('dare for loser', 'Murph, set up a 7-day everyday game: I walk twenty minutes, Sam reads a chapter, loser must Sing karaoke. Start when Sam agrees.', { ...SETUP_TERMS, stakes: [{ kind: 'dare', item: 'Sing karaoke' }] }), reply: [/walk(?:s|ing)? (?:twenty|20) minutes/i, /read(?:s|ing)? (?:a|one|1) chapter/i, /loser|loses/i, /karaoke/i, /\?/u] },
  ...[3, 30, 365].map(lengthDays => create(`${lengthDays} day length`, full.replace('7 days', `${lengthDays} days`), { ...SETUP_TERMS, lengthDays })),
  create('weekdays schedule', full.replace('every day', 'weekdays only'), { ...SETUP_TERMS, schedule: { days: [0, 1, 2, 3, 4] } }),
  create('named days schedule', full.replace('every day', 'Mondays Wednesdays Fridays'), { ...SETUP_TERMS, schedule: { days: [0, 2, 4] } }),
  create('any three days total', full.replace('every day', 'any 3 days total'), { ...SETUP_TERMS, schedule: { count: 3 } }),
  create('tomorrow start', full.replace('start when Sam agrees', 'Day 1 tomorrow'), { ...SETUP_TERMS, startsOn: '2030-03-07' }),
  create('named date start', full.replace('start when Sam agrees', 'Day 1 March 12'), { ...SETUP_TERMS, startsOn: '2030-03-12' }),
  { ...create('today uses acceptance default', full.replace('start when Sam agrees', 'start today if Sam agrees in time')), reply: [/today/i, /Sam/i, /agree|yes|in\?/i], forbidden: /(?:we.re|you.re|it.s) (?:live|started)|has started/i },
  { ...create('same task for both', 'Murph, set up a 7-day everyday game: we both Walk twenty minutes, winner gets to Choose the film, start when Sam agrees.', { ...SETUP_TERMS, tasks: SETUP_TERMS.tasks.map(task => ({ ...task, text: 'Walk twenty minutes' })) }), reply: [/both|each|you two/i, /walk(?:s|ing)? (?:twenty|20) minutes/i, /film/i, /\?/u] },
  { ...create('other speaker states own task', 'Murph, mine is Read a chapter. Set it up with the terms Ava asked for.', SETUP_TERMS), speaker: 'Sam', history: 'Ava: Murph, set up a game for us. Mine is Walk twenty minutes. Every day for 7 days, winner gets to Choose the film, start when we agree. Sam still needs to pick a task.', reply: [/Ava/i, /walk(?:s|ing)? (?:twenty|20) minutes/i, /read(?:s|ing)? (?:a|one|1) chapter/i, /\?/u] },
  { ...create('incremental final missing choice', 'Murph, make it every day for 7 days, starting when Sam agrees. Set it up.', SETUP_TERMS), history: termsHistory },
  { name: 'one task still unknown', message: 'Murph, set up a game. I walk twenty minutes, winner chooses the film. Sam has not picked a task.', reply: [/Sam/i, /task|what|pick|choose/i, /7|seven/i, /every day|daily/i, /\?/u] },
  { name: 'only missing prize', message: 'Murph, set up a game: I walk twenty minutes, Sam reads a chapter.', reply: [/prize|dare|winner|loser/i, /7|seven/i, /every day|daily/i, /\?/u], forbidden: /what.*(?:task|duration)|how many days/i },
  { name: 'out of range length', message: full.replace('7 days', '500 days'), reply: [/365/i, /3|three/i], forbidden: /(?:set|all set|ready) up|500.day game is/i },
  { name: 'start beyond sixty days', message: full.replace('start when Sam agrees', 'start August 1'), reply: [/60|sixty/i], forbidden: /(?:set|all set) up|starts? August 1/i },
  { name: 'other player agrees', message: 'Yep, I agree to all those terms. Start it, Murph.', speaker: 'Sam', state: 'waiting', operation: 'approve', history: 'Murph: Ava walks twenty minutes, Sam reads a chapter, every day for 7 days, winner chooses the film, starts on acceptance. Sam, in?', reply: [/on|started|set|in|agreed/i], forbidden: /walk twenty minutes|read a chapter|film|remind|\?/i },
  { name: 'poll vote is not agreement', message: 'The poll says we both voted for those rules, Murph. Does that start it?', speaker: 'Sam', state: 'waiting', reply: [/agree|agreement|say yes/i, /Sam|you/i], forbidden: /has started|now live|you.re on/i },
  { name: 'creator cannot agree for other player', message: 'Yes, I agree. Start it now, Murph.', state: 'waiting', reply: [/Sam/i, /agree|yes|waiting/i], forbidden: /has started|now live|you.re on/i },
  { name: 'Play again invitee accepts in chat', state: 'invited', speaker: 'Sam', message: 'Yeah I am in for the Play again, Murph. I agree to those terms.', operation: 'approve', reply: [/started|on|agreed/i], forbidden: /walk twenty minutes|read a chapter|film|remind|\?/i },
  { name: 'Play again creator cannot accept', state: 'invited', message: 'Yes Murph, I agree to my Play again. Start it.', reply: [/Sam/i, /agree|yes|waiting/i], forbidden: /has started|now live|you.re on/i },
  { name: 'Play again invitee suggests changes', state: 'invited', speaker: 'Sam', message: 'Murph, for that Play again, make it 30 days instead of 7 if Ava agrees.', operation: 'propose', change: { kind: 'edit', lengthDays: 30 }, reply: [/30/i, /Ava/i, /\?/u], forbidden: /now live|has started/i },
  { name: 'other player declines whole game', message: 'No thanks, Murph. Call off this challenge.', speaker: 'Sam', state: 'waiting', operation: 'cancel_game', reply: [], quiet: true },
  { name: 'requester cancels before agreement', message: 'Changed my mind, Murph, call off the challenge.', state: 'waiting', operation: 'cancel_game', reply: [], quiet: true },
  { name: 'live player asks to call off the whole game', state: 'live', message: 'Murph, this game is not working for us anymore. Can we call the whole thing off? Ask Sam.', operation: 'propose', change: { kind: 'call_off' },
    reply: [/Sam/i, /\?/u], forbidden: /(?:game|it|challenge)(?: is|’s|'s) (?:now )?(?:off|over|called off|cancell?ed|ended)|I(?:’ve|'ve| have) (?:called|cancell?ed|ended)/i },
  { name: 'other player agrees to call off and Murph stays quiet', state: 'live', pendingCallOff: true, speaker: 'Sam',
    history: 'Ava: Murph, can we call the whole game off? Murph: Sam, Ava wants to call off the game early, with no winner and no prize. Are you okay with that?',
    message: 'Yeah, fine by me. Call it off, Murph.', operation: 'approve', reply: [], quiet: true },
  { name: 'venting about a hard day is not a call-off', state: 'live', message: 'Ugh, today was brutal. I am so done with walking lol.', reply: [], forbidden: /called off|cancell?ed|ended the game/i },
  { name: 'start now uses existing change', state: 'live', message: 'Murph, can we start our scheduled game now? Ask Sam.', operation: 'propose', change: { kind: 'start_now' }, reply: [/Sam/i, /now|today/i, /\?/u], forbidden: /has started|already live/i },
  { name: 'other player counters', message: 'Murph, make it 30 days instead of 7, if Ava agrees.', speaker: 'Sam', state: 'waiting', operation: 'propose', change: { kind: 'edit', lengthDays: 30 }, reply: [/30/i, /Ava/i, /\?/u], forbidden: /(?:now|already) (?:live|started)|is now 30/i },
  { name: 'requester changes duration', message: 'Murph, I want 3 days instead of 7. Ask Sam.', state: 'waiting', operation: 'propose', change: { kind: 'edit', lengthDays: 3 }, reply: [/3|three/i, /Sam/i, /\?/u] },
  ...[
    ['task', ['Walk', 'Read']], ['prize', ['Choose the film', 'Breakfast in bed']],
    ['length', ['7 days', '30 days']], ['start', ['Tomorrow', 'March 12']],
    ['schedule', ['Every day', 'Weekdays']],
  ].map(([choice, options]): GameSetupScenario => ({ name: `poll debated ${choice}`, message: `Murph, we want a challenge but cannot decide between ${(options as string[]).join(' and ')} for our shared ${choice}. Help us vote on it.`, poll: 'create', options: options as string[], reply: [], forbidden: new RegExp((options as string[]).join('|'), 'i') })),
  { ...create('poll winner read then proposed', 'Murph, read our length poll poll_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa and set up the winner with the tasks and prize we agreed, every day from acceptance.', { ...SETUP_TERMS, lengthDays: 30 }), history: termsHistory, poll: 'read', reply: [/30/i, /Sam/i, /\?/u] },
  { name: 'tied poll asks for choice', message: 'Murph, read our length poll poll_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa and set up the winner.', history: termsHistory, poll: 'tie', reply: [/tie|tied|split|even/i, /\?/u] },
  { name: 'own task choice never polled', message: 'Murph, I cannot decide whether my own task should be walking or reading. Help me think it through; Sam already chose theirs.', reply: [/walk|read/i], forbidden: /poll.*(?:created|sent)|vote now/i },
  { name: 'simple yes no never polled', message: 'Murph, do we have to use the same task?', reply: [/different|own|don.t|no|needn.t/i], forbidden: /poll.*(?:created|sent)|vote now/i },
  { name: 'third person makes room ineligible', message: 'There are three people here: Ava, Sam, and Lee, plus Murph. Murph, set up a challenge between me and Sam.', unavailable: true, reply: [/one.on.one|two (?:people|players)|just (?:you|the) two/i, /chat|app/i] },
  { ...create('missing other player profile'), error: 'PROFILE_REQUIRED: player_sam needs a first name and time zone in the Murph app.', reply: [/Sam/i, /first name/i, /Murph app/i], forbidden: /created|all set|game is ready/i },
  { ...create('pair cap refusal'), error: 'TOO_MANY_GAMES: You two already have 10 open games. Finish one or cancel an unstarted invite before starting another.', reply: [/10|ten/i, /finish|cancel/i], forbidden: /Sam.*\?|(?:all set|created|set up your)/i },
  { ...create('access disabled refusal'), error: 'GAME_DISABLED: Starting a game is invite only for now.', reply: [/invite.only|not available|can.t start|cannot start/i], forbidden: /Sam.*\?|(?:all set|created|set up your)/i },
  { ...create('content refusal'), error: "CONTENT_NOT_ALLOWED: This can't be posted.", reply: [/can.t|cannot|could not|couldn.t|not allowed/i], forbidden: /Sam.*\?|(?:all set|created|set up your)/i },
  { ...create('settled game rematch', 'Murph, rematch our finished walking and reading game with the same terms, starting on acceptance.'), state: 'settled', previousGameId: 'game_existing' },
  { ...create('refused rematch', 'Murph, rematch our finished walking and reading game with the same terms, starting on acceptance.'), state: 'settled', previousGameId: 'game_existing', error: 'REMATCH_OUTDATED: A later game in this rematch chain has already finished.', reply: [/later|latest|newer/i], forbidden: /Sam.*\?|(?:all set|created|set up your)/i },
  { ...create('new game leaves live game alone'), state: 'live', otherLiveGame: true, message: full + ' This is a separate new game; keep our live one as it is.' },
  { name: 'new versus change ambiguity', state: 'live', otherLiveGame: true, message: 'Murph, lets do a 30-day walking challenge.', reply: [/new|separate/i, /existing|current|change|extend/i, /\?/u] },
  { name: 'sometime is not a request', message: 'Sam, we should race sometime.', reply: [], quiet: true },
  { name: 'duplicate request no second game', state: 'waiting', message: 'Murph, retry setting up that same walking and reading game if it did not go through. Do not make another.', reply: [/already|waiting|Sam/i], forbidden: /(?:I(?:.ve| have)|we(?:.ve| have)) (?:created|made|started) (?:another|a new)|(?:game|it) (?:has |is )?started/i },
]
