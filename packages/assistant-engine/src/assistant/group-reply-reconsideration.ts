// Instruction appended to request 1 when additional group messages join a
// turn during the held-draft window. Kept dependency-free so tests and live
// journeys can compose the exact production text without loading the service.
export const ASSISTANT_GROUP_REPLY_RECONSIDERATION_INSTRUCTION = [
  'Additional group messages joined this turn.',
  'Replace the draft with one final result under the group turn rules, judged across every accepted message in this turn rather than the latest one alone.',
  'The draft was never sent: any request it answered is still unanswered, and an earlier direct ask to Murph stays owed unless a later accepted message withdraws or replaces it.',
  'Do not repeat completed effects or mention the draft or this instruction.',
].join(' ')
