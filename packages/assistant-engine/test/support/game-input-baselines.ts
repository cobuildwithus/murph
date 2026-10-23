// Exact production tool descriptors for the optional composed input measurement.
// These snapshots preserve the reviewed rollout stages; current head uses real tools.

// eff32234e77173681ae5358a9dd8083d5e6dcd85
export const BASE_READ_GAME_TOOL = {
  namespace: 'murph', name: 'read_game',
  description: 'Read the games linked to this group chat, their agreed tasks, stakes, schedule, start dates and pending changes. Use before answering questions or changing a game. Each day closes at 3 AM the following local date in each player’s timeZone; dayOne is their first calendar date. Starting before 3 AM may give a short first day; explain the actual cutoff. This shared view excludes private labels, photos and check-ins.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {}, required: [] },
} as const

// eff32234e77173681ae5358a9dd8083d5e6dcd85
export const BASE_UPDATE_GAME_TOOL = {
  namespace: 'murph', name: 'update_game',
  description: 'Propose or respond to a change to a game in this group. Read_game first for current terms and pending proposal. Propose counts as the requesting player’s agreement; the other player approves or declines. Understand ordinary conversational agreement such as “yeah” in context; do not demand special words or repeat consent already given. Apply an approval when the reply agrees to the pending change. Cancel is for its proposer. Use messageRef of the current accepted message whose sender is acting; identity is resolved by the server. A proposal is not an applied change: only report it applied after the result confirms it. Edits affect future unstarted days and preserve existing results. The app sends its own proposal announcement; avoid repeating it unnecessarily.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {
    messageRef: { type: 'string', description: 'Message ref of the current accepted message from the player requesting or agreeing to this change.' },
    operation: { type: 'string', enum: ['propose', 'approve', 'decline', 'cancel'] },
    gameId: { type: 'string', minLength: 8, maxLength: 64 }, proposalId: { type: 'string', minLength: 8, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$', description: 'Exact pending proposal ID for responses; a new unique ID when proposing.' },
    expectedTermsVersion: { type: 'integer', minimum: 1, description: 'Propose only; current terms.n from read_game.' },
    change: { type: 'object', additionalProperties: false, properties: {
      kind: { type: 'string', enum: ['start_now', 'edit'] },
      lengthDays: { type: 'integer', minimum: 1, maximum: 28 }, startsOn: { type: 'string', description: 'YYYY-MM-DD' },
      schedule: { type: 'object', additionalProperties: false, properties: { days: { type: 'array', minItems: 1, maxItems: 7, items: { type: 'integer', minimum: 0, maximum: 6 }, description: 'Monday 0 through Sunday 6.' }, count: { type: 'integer', minimum: 1, maximum: 28, description: 'Any N days across the whole game.' } } },
    }, required: ['kind'] },
  }, required: ['messageRef', 'operation', 'gameId', 'proposalId'] },
} as const

// f5fc26ca21
export const TERMS_READ_GAME_TOOL = {
  namespace: 'murph', name: 'read_game',
  description: 'Read the games linked to this group chat, their agreed tasks, stakes, schedule, start dates and pending changes. Use before answering questions or changing a game. Each day closes at 3 AM the following local date in each player’s timeZone; dayOne is their first calendar date. Starting before 3 AM may give a short first day; explain the actual cutoff. This shared view excludes private labels, photos and check-ins.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {}, required: [] },
} as const

// f5fc26ca21
export const TERMS_UPDATE_GAME_TOOL = {
  namespace: 'murph', name: 'update_game',
  description: 'Propose or respond to a change to a game in this group. Read_game first for current terms and pending proposal. Propose counts as the requesting player’s agreement; the other player approves or declines. Understand ordinary conversational agreement such as “yeah” in context; do not demand special words or repeat consent already given. Apply an approval when the reply agrees to the pending change. Cancel is for its proposer. Use messageRef of the current accepted message whose sender is acting; identity is resolved by the server. A proposal is not an applied change: only report it applied after the result confirms it. Task and schedule edits affect future unstarted days and preserve existing check-ins. Tasks is a full replacement for both seats: preserve an unchanged task from read_game. Stakes is a full replacement. Changing stakes replaces the wager for the whole game, including earlier misses: make that impact clear to both players and only set stakesApplyToWholeGame after the requester agrees to that scope. The other player still approves the exact proposal. Negotiating games have no active obligations; approving their proposal starts the game. The app sends its own proposal announcement; avoid repeating it unnecessarily.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {
    messageRef: { type: 'string', description: 'Message ref of the current accepted message from the player requesting or agreeing to this change.' },
    operation: { type: 'string', enum: ['propose', 'approve', 'decline', 'cancel'] },
    gameId: { type: 'string', minLength: 8, maxLength: 64 }, proposalId: { type: 'string', minLength: 8, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$', description: 'Exact pending proposal ID for responses; a new unique ID when proposing.' },
    expectedTermsVersion: { type: 'integer', minimum: 1, description: 'Propose only; current terms.n from read_game.' },
    change: { type: 'object', additionalProperties: false, properties: {
      kind: { type: 'string', enum: ['start_now', 'edit'] },
      tasks: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'object', additionalProperties: false, properties: { seat: { type: 'integer', minimum: 0, maximum: 1 }, text: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['seat', 'text'] } },
      stakes: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', enum: ['winner_gets', 'per_miss'] }, item: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['kind', 'item'] } },
      stakesApplyToWholeGame: { type: 'boolean', enum: [true], description: 'Required for a stake change once play has begun. The requesting player agreed that it replaces the wager for the whole game, including earlier misses.' },
      lengthDays: { type: 'integer', minimum: 1, maximum: 28 }, startsOn: { type: ['string', 'null'], description: 'YYYY-MM-DD, or null to reset the default start before play begins.' },
      schedule: { type: 'object', additionalProperties: false, properties: { days: { type: 'array', minItems: 1, maxItems: 7, items: { type: 'integer', minimum: 0, maximum: 6 }, description: 'Monday 0 through Sunday 6.' }, count: { type: 'integer', minimum: 1, maximum: 28, description: 'Any N days across the whole game.' } } },
    }, required: ['kind'] },
  }, required: ['messageRef', 'operation', 'gameId', 'proposalId'] },
} as const

// 08ee3bbfc878b1f0284c8b28f5f98505b114396c
export const LIFECYCLE_READ_GAME_TOOL = {
  namespace: 'murph', name: 'read_game',
  description: 'Read the games shared by the two players in this group chat, their agreed tasks, stakes, schedule, start dates and pending changes. Use before answering questions or changing a game. Each day closes at 3 AM the following local date in each player’s timeZone; dayOne is their first calendar date. Starting before 3 AM may give a short first day; explain the actual cutoff. This shared view excludes private labels, photos and check-ins.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {}, required: [] },
} as const

// 08ee3bbfc878b1f0284c8b28f5f98505b114396c
export const LIFECYCLE_UPDATE_GAME_TOOL = {
  namespace: 'murph', name: 'update_game',
  description: 'Propose or respond to a change to a game in this group. Read_game first for current terms and pending proposal. Propose counts as the requesting player’s agreement; the other player approves or declines. Understand ordinary conversational agreement such as “yeah” in context; do not demand special words or repeat consent already given. Apply an approval when the reply agrees to the pending change. Cancel is for its proposer. Use messageRef of the current accepted message whose sender is acting; identity is resolved by the server. A proposal is not an applied change: only report it applied after the result confirms it. Task and schedule edits affect future unstarted days and preserve existing check-ins. Tasks is a full replacement for both seats: preserve an unchanged task from read_game. Stakes is a full replacement. Changing stakes replaces the wager for the whole game, including earlier misses: make that impact clear to both players and only set stakesApplyToWholeGame after the requester agrees to that scope. The other player still approves the exact proposal. Negotiating games have no active obligations; approving their proposal starts the game. When you propose from this conversation, ask the other player naturally in your reply; the backend does not send a second announcement. Reply here even if app-originated announcements use another chat. If approval starts a previously negotiating challenge, acknowledge briefly without repeating its tasks, stakes or reminder offer: the separate kickoff owns that introduction. Do not say the kickoff was sent merely because the game started.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {
    messageRef: { type: 'string', description: 'Message ref of the current accepted message from the player requesting or agreeing to this change.' },
    operation: { type: 'string', enum: ['propose', 'approve', 'decline', 'cancel'] },
    gameId: { type: 'string', minLength: 8, maxLength: 64 }, proposalId: { type: 'string', minLength: 8, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$', description: 'Exact pending proposal ID for responses; a new unique ID when proposing.' },
    expectedTermsVersion: { type: 'integer', minimum: 1, description: 'Propose only; current terms.n from read_game.' },
    change: { type: 'object', additionalProperties: false, properties: {
      kind: { type: 'string', enum: ['start_now', 'edit'] },
      tasks: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'object', additionalProperties: false, properties: { seat: { type: 'integer', minimum: 0, maximum: 1 }, text: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['seat', 'text'] } },
      stakes: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', enum: ['winner_gets', 'per_miss'] }, item: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['kind', 'item'] } },
      stakesApplyToWholeGame: { type: 'boolean', enum: [true], description: 'Required for a stake change once play has begun. The requesting player agreed that it replaces the wager for the whole game, including earlier misses.' },
      lengthDays: { type: 'integer', minimum: 1, maximum: 28 }, startsOn: { type: ['string', 'null'], description: 'YYYY-MM-DD, or null to reset the default start before play begins.' },
      schedule: { type: 'object', additionalProperties: false, properties: { days: { type: 'array', minItems: 1, maxItems: 7, items: { type: 'integer', minimum: 0, maximum: 6 }, description: 'Monday 0 through Sunday 6.' }, count: { type: 'integer', minimum: 1, maximum: 28, description: 'Any N days across the whole game.' } } },
    }, required: ['kind'] },
  }, required: ['messageRef', 'operation', 'gameId', 'proposalId'] },
} as const

// Exact production descriptors before the v1 group chat update (970bce2bca).
export const V1_BASE_READ_GAME_TOOL = {
  namespace: 'murph', name: 'read_game',
  description: 'Read the games shared by the two players in this group chat, their agreed tasks, stakes, schedule, start dates and pending changes. Use before answering questions or changing a game. Each day closes at 3 AM the following local date in each player’s timeZone; dayOne is their first calendar date. Starting before 3 AM may give a short first day; explain the actual cutoff. The shared view includes daily check-in status and frozen settled results, but excludes private labels, photos, captions and excuses. Answer from returned progress and result; a missing post today is not a miss, and any-days targets are a total rather than daily obligations. Never infer why someone did not post.',
  inputSchema: { type: 'object', additionalProperties: false, properties: { messageRef: { type: 'string', description: 'For a photo offer or save, select the current accepted message from that player so photoCheckIn reflects their introduction status.' } }, required: [] },
} as const
export const V1_BASE_UPDATE_GAME_TOOL = {
  namespace: 'murph', name: 'update_game',
  description: 'Propose or respond to a change to a game in this group. Read_game first for current terms and pending proposal. Propose counts as the requesting player’s agreement; the other player approves or declines. Understand ordinary conversational agreement such as “yeah” in context; do not demand special words or repeat consent already given. Apply an approval when the reply agrees to the pending change. Cancel is for its proposer. Use messageRef of the current accepted message whose sender is acting; identity is resolved by the server. A proposal is not an applied change: only report it applied after the result confirms it. Task and schedule edits affect future unstarted days and preserve existing check-ins. Tasks is a full replacement for both seats: preserve an unchanged task from read_game. Stakes is a full replacement. Changing stakes replaces the wager for the whole game, including earlier misses: make that impact clear to both players and only set stakesApplyToWholeGame after the requester agrees to that scope. The other player still approves the exact proposal. Negotiating games have no active obligations; approving their proposal starts the game. When you propose from this conversation, ask the other player naturally in your reply; the backend does not send a second announcement. Reply here even if app-originated announcements use another chat. If approval starts a previously negotiating challenge, acknowledge briefly without repeating its tasks, stakes or reminder offer: the separate kickoff owns that introduction. Do not say the kickoff was sent merely because the game started.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {
    messageRef: { type: 'string', description: 'Message ref of the current accepted message from the player requesting or agreeing to this change.' },
    operation: { type: 'string', enum: ['propose', 'approve', 'decline', 'cancel'] },
    gameId: { type: 'string', minLength: 8, maxLength: 64 }, proposalId: { type: 'string', minLength: 8, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$', description: 'Exact pending proposal ID for responses; a new unique ID when proposing.' },
    expectedTermsVersion: { type: 'integer', minimum: 1, description: 'Propose only; current terms.n from read_game.' },
    change: { type: 'object', additionalProperties: false, properties: {
      kind: { type: 'string', enum: ['start_now', 'edit'] },
      tasks: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'object', additionalProperties: false, properties: { seat: { type: 'integer', minimum: 0, maximum: 1 }, text: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['seat', 'text'] } },
      stakes: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', enum: ['winner_gets', 'per_miss'] }, item: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['kind', 'item'] } },
      stakesApplyToWholeGame: { type: 'boolean', enum: [true], description: 'Required for a stake change once play has begun. The requesting player agreed that it replaces the wager for the whole game, including earlier misses.' },
      lengthDays: { type: 'integer', minimum: 1, maximum: 28 }, startsOn: { type: ['string', 'null'], description: 'YYYY-MM-DD, or null to reset the default start before play begins.' },
      schedule: { type: 'object', additionalProperties: false, properties: { days: { type: 'array', minItems: 1, maxItems: 7, items: { type: 'integer', minimum: 0, maximum: 6 }, description: 'Monday 0 through Sunday 6.' }, count: { type: 'integer', minimum: 1, maximum: 28, description: 'Any N days across the whole game.' } } },
    }, required: ['kind'] },
  }, required: ['messageRef', 'operation', 'gameId', 'proposalId'] },
} as const
export const V1_BASE_PHOTO_GUIDANCE = 'In iMessage game groups, a clear current photo relevant to the sender’s own challenge can introduce saving a check-in once per person. Read_game first with that sender’s current messageRef; only when photoCheckIn.introductionAvailable and that player has no current post, call game_photo operation=offer for that exact photo. Only an offer result permits one brief question, such as “Want me to use this as your check-in photo?” A suppressed offer stays quiet. Ordinary unrelated photos and conversation clearly between people stay quiet. This is permission for this photo only, never automatic future saving. After introduction, later unsolicited photos stay quiet. An explicit save request acts without redundant consent; a contextual yes to the pending offer saves that selected photo only. A no dismisses it. Never save another person’s photo, backdate, or claim the image verifies task completion. If today already has a post, replacing consumes the one retake: ask first unless replacement was explicitly requested, then pass its exact currentEntryId. Heart-rate games still require the app graph.'
export const V1_BASE_GAME_PHOTO_TOOL = {
  namespace: 'murph', name: 'game_photo',
  description: `${V1_BASE_PHOTO_GUIDANCE} This tool supports iMessage/Linq only. Read_game before acting. messageRef identifies the current requesting sender. For a new photo, sourceMessageRef and attachmentOrdinal identify one exact accepted attachment from that sender in this room today. For yes/no to a pending offer, omit those selectors so the server uses the stored selection. Offer records an introduction attempt, not delivery or a saved photo; write the question only when photoOutcome=offer. Only photoOutcome=saved confirms a check-in. If bytes are unavailable, ask them to resend a JPEG/HEIC photo or use the app. Do not mention internal IDs, flags, transport, or stored source references.`,
  inputSchema: { type: 'object', additionalProperties: false, properties: {
    messageRef: { type: 'string' }, operation: { type: 'string', enum: ['offer', 'save', 'dismiss'] },
    gameId: { type: 'string', minLength: 8, maxLength: 64 },
    sourceMessageRef: { type: 'string' }, attachmentOrdinal: { type: 'integer', minimum: 1, maximum: 32 },
    replaceEntryId: { type: 'string', description: 'Exact currentEntryId from read_game, only after explicit replacement consent.' },
  }, required: ['messageRef', 'operation', 'gameId'] },
} as const

export const GAME_INPUT_BASELINES = { v1: [V1_BASE_READ_GAME_TOOL, V1_BASE_UPDATE_GAME_TOOL, V1_BASE_GAME_PHOTO_TOOL], base: [BASE_READ_GAME_TOOL, BASE_UPDATE_GAME_TOOL], terms: [TERMS_READ_GAME_TOOL, TERMS_UPDATE_GAME_TOOL], lifecycle: [LIFECYCLE_READ_GAME_TOOL, LIFECYCLE_UPDATE_GAME_TOOL] } as const
