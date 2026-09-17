// Instruction appended to request 1 when additional group messages join a
// turn during the held-draft window. Kept dependency-free so tests and live
// journeys can compose the exact production text without loading the service.
export const ASSISTANT_GROUP_REPLY_RECONSIDERATION_INSTRUCTION = [
  'Additional group messages joined this turn.',
  'Replace the draft with one final result under the group turn rules.',
  'The unsent draft neither answers a request nor keeps Murph\'s floor; judge the updated beat from every accepted message in this turn, not from the latest one alone.',
  'A direct Murph address or open request in an earlier accepted message stays Murph\'s to answer unless a later accepted message withdraws or replaces it; a later human-to-human aside does not cancel it.',
  'Finish without a reply only when no accepted message still merits a text reply, for example when the latest message gives another human the floor and no earlier message still asks Murph.',
  'Treat every request answered only in the unsent draft as unanswered and include every still-relevant answer in the final result. Response text is not a completed effect.',
  'Do not repeat completed effects or mention the draft or this instruction.',
].join(' ')
