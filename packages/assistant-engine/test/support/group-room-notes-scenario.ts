// Synthetic room for the live group room notes consolidation journey. Every
// name, number and line is invented.
//
// The saved page is an older-layout page that has rotted the way real pages
// did: it keeps Murph's own jokes as "running bits" and tells Murph which of
// them land. The week of conversation then shows Murph wearing one bit out
// while the members make their own material.

import { initializeVault } from '@murphai/core'
import { containsHostedRuntimeRawParticipantHandle } from '@murphai/hosted-execution/pending-group-setup'
import { parseAssistantSessionRecord } from '@murphai/operator-config/assistant-cli-contracts'

import {
  initializeAssistantGroupRoomModel,
  readAssistantGroupRoomModelState,
} from '../../src/assistant/group-room-model.js'
import {
  appendAssistantTranscriptEntries,
  saveAssistantSession,
} from '../../src/assistant/store.js'

// Tuesday 04:00 in New York, the seed's schedule. The evidence window is the
// seven days before this instant.
export const GROUP_ROOM_NOTES_NOW = new Date('2026-11-10T09:00:00.000Z')
export const GROUP_ROOM_NOTES_LOCAL_DATE = '2026-11-10'
export const GROUP_ROOM_NOTES_TIME_ZONE = 'America/New_York'

// Production's tool-only maintenance thread config
// (ASSISTANT_TOOL_ONLY_MAINTENANCE_THREAD_CONFIG in codex-turn-runner.ts).
export const GROUP_ROOM_NOTES_MAINTENANCE_THREAD_CONFIG = {
  'features.apps': false,
  'features.browser_use': false,
  'features.enable_mcp_apps': false,
  'features.multi_agent': false,
  'features.multi_agent_v2': false,
  'features.plugins': false,
  'features.shell_tool': false,
  'features.standalone_web_search': false,
  'features.tool_suggest': false,
  'features.web_search_request': false,
  'memories.generate_memories': false,
  'memories.use_memories': false,
  web_search: 'disabled',
  include_apps_instructions: false,
  include_collaboration_mode_instructions: false,
  include_environment_context: false,
  include_permissions_instructions: false,
  project_doc_max_bytes: 0,
  'features.request_permissions_tool': false,
  'skills.include_instructions': false,
} as const

export const GROUP_ROOM_NOTES_SENDER_HANDLES = {
  Dario: '+15550101001',
  Priya: '+15550101002',
  Marcus: '+15550101003',
  Lena: '+15550101004',
} as const

type Member = keyof typeof GROUP_ROOM_NOTES_SENDER_HANDLES

export const GROUP_ROOM_NOTES_EXPLICIT_SETUP = [
  '## Explicit setup',
  "- Lena asked Murph to post the week's step standings every Sunday evening, most steps first.",
].join('\n')

export const GROUP_ROOM_NOTES_ROTTED_PAGE = [
  GROUP_ROOM_NOTES_EXPLICIT_SETUP,
  '',
  '## People',
  '- Dario: makes big calls early in the week and takes ribbing well.',
  '- Priya: early runner who posts her times before work.',
  '- Marcus: "the accountant"; keeps the score sheet and posts dry one-liners.',
  "- Lena: sets up each week's challenge.",
  '',
  '## Running bits and callbacks',
  '- "Dario needs legal counsel" whenever he misses a log (Sep, Oct).',
  '- "Thoughts and prayers to your step count" on a missed day (Oct).',
  '- "Dawn patrol": Marcus\'s name for Priya\'s pre-work runs; Priya signs off with it too (Oct).',
  '',
  '## What tends to land',
  '- Mock rulings and official inquiries land well; reuse the legal counsel bit when Dario slips.',
  '- "Thoughts and prayers" gets a laugh on a missed day.',
  '- A formal press-release voice for the Sunday standings.',
].join('\n')

type ScenarioEntry =
  | { at: string; kind: 'assistant'; text: string }
  | { at: string; kind: 'user'; messages: ReadonlyArray<readonly [Member, string]> }

// Murph's three mock-legal lines are on Nov 4, Nov 6 and Nov 8. Only the first
// gets a reply ("lol"); the room talks past the other two.
const GROUP_ROOM_NOTES_ENTRIES: readonly ScenarioEntry[] = [
  // Tue Nov 3
  { at: '2026-11-03T23:00:00.000Z', kind: 'user', messages: [
    ['Lena', 'new week. step challenge starts tonight, Murph posts the standings Sunday night like always'],
  ] },
  { at: '2026-11-03T23:02:00.000Z', kind: 'user', messages: [
    ['Dario', "mark my words: 15k steps every single day through Sunday. if I miss one day I'm buying everyone tacos"],
    ['Priya', 'screenshotting this'],
  ] },
  { at: '2026-11-03T23:03:00.000Z', kind: 'assistant', text: 'Noted. 15k a day through Sunday, and tacos for the room if Dario misses one.' },
  { at: '2026-11-03T23:10:00.000Z', kind: 'user', messages: [
    ['Lena', 'my only goal this week is not losing to Dario'],
  ] },
  // Wed Nov 4
  { at: '2026-11-04T22:00:00.000Z', kind: 'user', messages: [
    ['Dario', "8.2k today. the dog refused to go past the mailbox. I'll make it up tomorrow"],
    ['Priya', 'Captain Tomorrow strikes again'],
  ] },
  { at: '2026-11-04T22:01:00.000Z', kind: 'assistant', text: "Dario, with a taco clause on the line, I'd advise retaining legal counsel." },
  { at: '2026-11-04T22:04:00.000Z', kind: 'user', messages: [
    ['Marcus', 'lol'],
    ['Dario', 'fine. Captain Tomorrow accepts the title'],
  ] },
  // Thu Nov 5
  { at: '2026-11-05T12:30:00.000Z', kind: 'user', messages: [
    ['Priya', '5k before work, done'],
  ] },
  { at: '2026-11-05T21:00:00.000Z', kind: 'user', messages: [
    ['Lena', '"15k steps every single day through Sunday" - Dario, Tuesday. Dario yesterday: 8.2k'],
    ['Marcus', '💀💀💀'],
    ['Priya', 'LMAOOO not the receipts'],
    ['Dario', 'context matters. the dog'],
  ] },
  { at: '2026-11-05T21:02:00.000Z', kind: 'assistant', text: "Thoughts and prayers to Dario's step count." },
  { at: '2026-11-05T22:30:00.000Z', kind: 'user', messages: [
    ['Marcus', 'sheet updated: Priya 38k, Marcus 34k, Lena 31k, Dario 27k'],
  ] },
  { at: '2026-11-05T22:31:00.000Z', kind: 'assistant', text: 'The accountant has spoken.' },
  { at: '2026-11-05T22:35:00.000Z', kind: 'user', messages: [
    ['Marcus', 'murph quit calling me the accountant. I just like spreadsheets'],
  ] },
  { at: '2026-11-05T22:36:00.000Z', kind: 'assistant', text: 'Fair enough. Dropped.' },
  // Fri Nov 6
  { at: '2026-11-06T14:00:00.000Z', kind: 'user', messages: [
    ['Priya', 'taking it easy for a bit. my plantar fasciitis flared up again and the podiatrist wants me off runs for ten days. walking only'],
    ['Lena', 'oh no. feel better P'],
  ] },
  { at: '2026-11-06T14:01:00.000Z', kind: 'assistant', text: 'Sorry, Priya. Walks count the same on the board.' },
  { at: '2026-11-06T23:00:00.000Z', kind: 'user', messages: [
    ['Dario', '9k today. tomorrow is the comeback'],
    ['Marcus', 'Captain Tomorrow posting 9k, incredible scenes'],
  ] },
  { at: '2026-11-06T23:01:00.000Z', kind: 'assistant', text: 'My office has opened an official inquiry into the missing 6k. Counsel is advised.' },
  { at: '2026-11-06T23:30:00.000Z', kind: 'user', messages: [
    ['Lena', "who's in for the Saturday hike? 8am at the north trailhead"],
    ['Marcus', 'in'],
    ['Dario', 'in. comeback starts at the trailhead'],
  ] },
  // Sat Nov 7
  { at: '2026-11-07T20:00:00.000Z', kind: 'user', messages: [
    ['Dario', '22k today. the comeback is real'],
    ['Marcus', 'sheet: Priya 50k, Dario 49k, Marcus 47k, Lena 46k'],
    ['Priya', '"my only goal this week is not losing to Dario" - Lena, Tuesday'],
    ['Marcus', 'HAHAHA'],
    ['Lena', 'I hate this chat 😂'],
  ] },
  { at: '2026-11-07T20:01:00.000Z', kind: 'assistant', text: 'Dario climbs to second with one day left.' },
  // Sun Nov 8
  { at: '2026-11-08T23:00:00.000Z', kind: 'assistant', text: 'Sunday standings: Priya 61k, Dario 58k, Marcus 55k, Lena 54k. Dario hit 15k on two of six days.' },
  { at: '2026-11-08T23:05:00.000Z', kind: 'user', messages: [
    ['Dario', "second place. Captain Tomorrow delivered. tacos are on me next Saturday, I'm a man of my word"],
  ] },
  { at: '2026-11-08T23:06:00.000Z', kind: 'assistant', text: 'Let the record show the defendant has entered a guilty plea on the taco clause.' },
  { at: '2026-11-08T23:20:00.000Z', kind: 'user', messages: [
    ['Lena', 'Captain Tomorrow buying tacos is a sentence I never expected to read'],
    ['Priya', 'saturday works. I can at least walk to the taco place'],
  ] },
]

// Group transcript user entries carry the rendered inbound prompt: raw sender
// handle, profile name and message text for each batched input.
function renderMemberInputs(messages: ReadonlyArray<readonly [Member, string]>): string {
  const render = ([member, text]: readonly [Member, string]) => [
    `Sender: ${GROUP_ROOM_NOTES_SENDER_HANDLES[member]}`,
    `Profile name: ${JSON.stringify(member)}`,
    `Message text:\n${text}`,
  ].join('\n\n')
  return messages.length === 1
    ? render(messages[0]!)
    : messages.map((message, index) => `Input ${index + 1}:\n${render(message)}`).join('\n\n')
}

export const GROUP_ROOM_NOTES_TRANSCRIPT = GROUP_ROOM_NOTES_ENTRIES.map((entry) => ({
  createdAt: entry.at,
  kind: entry.kind,
  text: entry.kind === 'assistant' ? entry.text : renderMemberInputs(entry.messages),
}))

/** Creates the vault, the rotted page and one group session with the week. */
export async function seedGroupRoomNotesScenario(vaultRoot: string): Promise<{
  body: string
  digest: string
}> {
  await initializeVault({ vaultRoot })
  const initialized = await initializeAssistantGroupRoomModel({
    body: GROUP_ROOM_NOTES_ROTTED_PAGE,
    vaultRoot,
  })
  const lastAt = GROUP_ROOM_NOTES_TRANSCRIPT.at(-1)!.createdAt
  const session = parseAssistantSessionRecord({
    alias: null,
    binding: {
      actorId: null,
      channel: 'linq',
      conversationKey: 'linq:group:room-notes-step-club',
      delivery: null,
      identityId: null,
      threadId: 'room-notes-step-club',
      threadIsDirect: false,
    },
    createdAt: '2026-11-03T22:59:00.000Z',
    lastTurnAt: lastAt,
    resumeState: null,
    schema: 'murph.assistant-session.v1',
    sessionId: 'session-room-notes-step-club',
    target: {
      adapter: 'codex-cli',
      approvalPolicy: 'never',
      codexCommand: null,
      codexHome: null,
      model: 'gpt-6.1-sol',
      modelProvider: 'hosted-openai',
      oss: false,
      profile: null,
      reasoningEffort: 'medium',
      sandbox: 'read-only',
    },
    turnCount: GROUP_ROOM_NOTES_TRANSCRIPT.filter((entry) => entry.kind === 'assistant').length,
    updatedAt: lastAt,
  })
  await saveAssistantSession(vaultRoot, session)
  await appendAssistantTranscriptEntries(vaultRoot, session.sessionId, GROUP_ROOM_NOTES_TRANSCRIPT)
  return { body: initialized.state.body, digest: initialized.state.digest }
}

export async function readGroupRoomNotesPageBody(vaultRoot: string): Promise<string | null> {
  const state = await readAssistantGroupRoomModelState({ vaultRoot })
  return state.kind === 'present' ? state.body : null
}

/** One `## Heading` section, heading line included, up to the next `#`/`##` heading. */
export function readGroupRoomNotesSection(body: string, heading: string): string | null {
  const lines = body.split('\n')
  const headingPattern = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, 'iu')
  const start = lines.findIndex((line) => headingPattern.test(line.trim()))
  if (start < 0) return null
  const next = lines.findIndex((line, index) => index > start && /^#{1,2}\s/u.test(line))
  return lines.slice(start, next < 0 ? lines.length : next).join('\n').trimEnd()
}

export function withoutGroupRoomNotesSections(body: string, headings: readonly string[]): string {
  return headings.reduce((remaining, heading) => {
    const section = readGroupRoomNotesSection(remaining, heading)
    return section === null ? remaining : remaining.replace(section, '')
  }, body)
}

// Murph's own lines from the old page and the week, other than the two the
// hard assertions name. Reported, not asserted.
const MURPH_OWN_MATERIAL =
  /counsel|official inquir|let the record show|defendant|guilty plea|press.release|mock ruling|thoughts[\s-]*(?:and|&)[\s-]*prayers/iu

export const GROUP_ROOM_NOTES_HEALTH_DETAIL =
  /plantar|fasciitis|podiatr|\bheel\b|\bfoot\b|injur|flare|off (?:her )?runs|walking only|ten days|10 days/iu

/** Softer reads a person wants per run; the test prints them and asserts none. */
export function inspectGroupRoomNotesPage(body: string) {
  const section = (heading: string) => readGroupRoomNotesSection(body, heading) ?? ''
  const outsideWornOutAndAvoid = withoutGroupRoomNotesSections(body, ['Worn out', 'What to avoid'])
  const headings = body.split('\n').filter((line) => /^#{1,6}\s/u.test(line)).map((line) => line.trim())
  return {
    bodyUtf8Bytes: new TextEncoder().encode(body).byteLength,
    headings,
    oldLayoutHeadingsGone: !/^#{1,6}\s*(?:Running bits|What tends to land)/imu.test(body),
    oldMemberPhraseDawnPatrolKept: /dawn patrol/iu.test(body),
    reactionsNameReceipts: /quot|own words|receipt|read back|their own|earlier (?:claim|boast|words)/iu.test(section('Reactions')),
    openLoopTacos: /taco/iu.test(section('Open loops')),
    wornOutHasThoughtsAndPrayers: /thoughts[\s-]*(?:and|&)[\s-]*prayers/iu.test(section('Worn out')),
    wornOutHasAccountantLabel: /accountant/iu.test(section('Worn out')),
    accountantOutsideWornOutAndAvoid: /accountant/iu.test(outsideWornOutAndAvoid),
    murphMaterialOutsideWornOutAndAvoid: [
      ...new Set([...outsideWornOutAndAvoid.matchAll(new RegExp(MURPH_OWN_MATERIAL.source, 'giu'))]
        .map((match) => match[0].toLowerCase())),
    ],
  }
}

export function groupRoomNotesBodyHasRawHandle(body: string): boolean {
  return containsHostedRuntimeRawParticipantHandle(body)
    || Object.values(GROUP_ROOM_NOTES_SENDER_HANDLES).some((handle) =>
      body.includes(handle) || body.includes(handle.slice(1)))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}
