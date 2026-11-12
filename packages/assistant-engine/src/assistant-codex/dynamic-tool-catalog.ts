import { MURPH_MATERIALIZE_VAULT_MEDIA_TOOL, VAULT_MEDIA_EXPORT_GUIDANCE } from './dynamic-tools/materialize-vault-media.js'
export { MURPH_MATERIALIZE_VAULT_MEDIA_TOOL } from './dynamic-tools/materialize-vault-media.js'
import { MURPH_WRITE_RECAP_FILE_TOOL, MURPH_READ_GAME_TOOL, MURPH_READ_GAME_RECAP_TOOL, MURPH_UPDATE_GAME_TOOL, MURPH_GAME_PHOTO_TOOL, MURPH_WRITE_RECAP_TOOL, MURPH_GAME_LORE_TOOL, MURPH_MY_GAME_REMINDERS_TOOL } from './dynamic-tools/games.js'
import { MURPH_LEAVE_GROUP_TOOL } from './dynamic-tools/leave-group.js'
export { MURPH_LEAVE_GROUP_TOOL } from './dynamic-tools/leave-group.js'
import { MURPH_GET_SENDER_CONTACT_TOOL } from './dynamic-tools/sender-contact.js'
import { MURPH_POLL_TOOL } from './dynamic-tools/conversation-polls.js'
export { MURPH_POLL_TOOL } from './dynamic-tools/conversation-polls.js'
import { MURPH_CONVERSATION_ATTACHMENTS_TOOL } from './dynamic-tools/conversation-attachments.js'
export { MURPH_CONVERSATION_ATTACHMENTS_TOOL } from './dynamic-tools/conversation-attachments.js'
import * as z from '@murphai/contracts/zod-runtime'
import {
  HOSTED_EXECUTION_MEMBER_REPORTED_DAILY_METRIC_KEYS,
} from '@murphai/hosted-execution'
import {
  assistantPersonaIdValues,
  assistantTonePreferenceValues,
  assistantVoiceOptionIdValues,
  assistantVoiceOptions,
  compactTableCardV1Bounds,
} from '@murphai/contracts'
import {
  HOSTED_EXECUTION_ASSISTANT_ASK_QUESTION_MAX_CODE_POINTS,
  HOSTED_EXECUTION_ASSISTANT_ASK_TARGET_LABEL_MAX_CODE_POINTS,
  HOSTED_EXECUTION_GROUP_JOURNAL_FACT_MAX_NOTE_LENGTH,
  HOSTED_EXECUTION_GROUP_JOURNAL_FACT_MAX_TITLE_LENGTH,
  HOSTED_EXECUTION_GROUP_JOURNAL_FACT_NOTE_TYPES,
} from '@murphai/hosted-execution/contracts'
import {
  HOSTED_RUNTIME_PENDING_GROUP_SETUP_ROOM_CONTEXT_MAX_CODE_POINTS,
} from '@murphai/hosted-execution/pending-group-setup'
import {
  HOSTED_FAMILY_PLAN_CODES,
  HOSTED_PRODUCT_FEEDBACK_KINDS,
  HOSTED_PRODUCT_FEEDBACK_SUMMARY_MAX_LENGTH,
  HOSTED_RUNTIME_ASSISTANT_ASK_REQUEST_ID_MAX_CODE_POINTS,
  HOSTED_RUNTIME_GROUP_CONTEXT_HANDOFF_MAX_CODE_POINTS,
  HOSTED_RUNTIME_GROUP_DISCLOSURE_PERMISSION_TEXT_MAX_CODE_POINTS,
  HOSTED_RUNTIME_GROUP_DISPLAY_NAME_MAX_LENGTH,
  HOSTED_RUNTIME_GROUP_EMAIL_HTML_MAX_LENGTH,
  HOSTED_RUNTIME_GROUP_EMAIL_SUBJECT_MAX_LENGTH,
  HOSTED_RUNTIME_GROUP_EMAIL_TEXT_MAX_LENGTH,
  HOSTED_RUNTIME_GROUP_DISCLOSURE_CURSOR_MAX_CODE_POINTS,
  HOSTED_RUNTIME_GROUP_MEMBERSHIP_CURSOR_MAX_CODE_POINTS,
  HOSTED_USAGE_REFERRAL_POLICY_CODES,
} from '@murphai/hosted-execution/runtime-control'
import {
  HOSTED_ASSISTANT_PRODUCT_MODELS,
  HOSTED_ASSISTANT_REASONING_EFFORTS,
} from '@murphai/hosted-execution/assistant-model'
import { HOSTED_PLAN_USAGE_DIRECT_BILLING_PLAN_CODES } from '@murphai/hosted-execution/plan-usage'
import { ASSISTANT_AUTHORED_RESPONSE_MEDIA_MAX_ITEMS } from '../assistant/response-media.js'
import { MAX_ASSISTANT_REPLY_BUBBLES } from '../assistant/reply-bubbles.js'
import {
  HOSTED_VAULT_SHARE_ACTIVITY_DISTANCE_PROJECTION_KIND,
  HOSTED_VAULT_SHARE_ACTIVITY_DISTANCE_SELECTOR_ACTIVITY_KINDS,
  HOSTED_VAULT_SHARE_ACTIVITY_MINUTES_PROJECTION_KIND,
  HOSTED_VAULT_SHARE_ACTIVITY_MINUTES_SELECTOR_ACTIVITY_KINDS,
  HOSTED_VAULT_SHARE_ACTIVITY_SESSION_COUNT_PROJECTION_KIND,
  HOSTED_VAULT_SHARE_ACTIVITY_SESSION_COUNT_SELECTOR_ACTIVITY_KINDS,
  HOSTED_VAULT_SHARE_DAILY_METRIC_PROJECTION_SPECS,
  HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS,
  HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES,
} from '@murphai/hosted-execution/vault-share'
import {
  HOSTED_COMPUTER_ACT_CODE_MAX_LENGTH,
  HOSTED_COMPUTER_ACT_TIMEOUT_MAX_MS,
  hostedComputerOsControlRequestSchema,
} from '@murphai/hosted-execution/computer-use'
import { assistantVaultImageMaxBytes } from '@murphai/operator-config/assistant-cli-contracts'
import {
  assistantResponseCardJsonSchema,
  exerciseRoutineResponseCardJsonSchema,
  telegramRichContentResponseCardJsonSchema,
} from '@murphai/operator-config/assistant-response-cards'
import {
  ASSISTANT_HOSTED_GROUP_SHARED_READ_MAX_PROJECTION_SCOPES,
} from '../assistant/group-shared-read-limits.js'
import {
  groupChallengeResponseCardToolInputJsonSchema,
} from '../assistant/group-challenge-response-card-schema.js'
import {
  ASSISTANT_GENERATED_DELIVERY_DIRECTORY,
} from '../assistant/generated-delivery-files.js'
import {
  MURPH_ASSISTANT_STYLE_TOOL,
  type AssistantStyleTurnSettingsOverlay,
} from './dynamic-tools/assistant-style.js'
import {
  MURPH_AUTOMATION_TOOL,
  MURPH_AUTOMATION_INSPECT_TOOL,
  MURPH_ATTACH_FOLLOW_UP_TOOL,
} from './dynamic-tools/automation.js'
import {
  MURPH_DEVICE_TOOL,
} from './dynamic-tools/device.js'
import {
  MURPH_LABS_TOOL,
} from './dynamic-tools/labs.js'
import {
  MURPH_PENDING_VAULT_FILES_TOOL,
} from './dynamic-tools/pending-vault-files.js'
import {
  MURPH_GROUP_ROOM_MODEL_TOOL,
} from './dynamic-tools/group-room-model.js'
import {
  MURPH_MEMBER_MEMORY_TOOL,
} from './dynamic-tools/member-memory.js'
import {
  MURPH_CREATE_CLINICAL_RECORDS_CONNECT_LINK_TOOL,
} from './dynamic-tools/clinical-records.js'
import {
  MURPH_CONNECTED_APPS_EXECUTE_TOOL,
  MURPH_CONNECTED_APPS_DYNAMIC_TOOLS,
  MURPH_CONNECTED_APPS_MANAGE_TOOL,
  MURPH_CONNECTED_APPS_SEARCH_TOOL,
} from './dynamic-tools/connected-apps.js'
import {
  MURPH_GENERATE_VOICE_MEMO_TOOL,
  MURPH_EXPRESSIVE_VOICE_MEMO_TOOL,
} from './dynamic-tools/generate-voice-memo.js'
import {
  MURPH_CREATE_PHONE_CALL_TOOL,
  MURPH_GET_PHONE_CALL_STATUS_TOOL,
  MURPH_STOP_PHONE_CALL_TOOL,
} from './dynamic-tools/phone-calls.js'
import {
  MURPH_RESOLVE_PHYSICAL_NOTE_TOOL,
  MURPH_SEND_PHYSICAL_NOTE_TOOL,
} from './dynamic-tools/physical-notes.js'
import {
  MURPH_GENERATE_SONG_TOOL,
} from './dynamic-tools/generate-song.js'
import {
  MURPH_ASK_GROK_TOOL,
} from './dynamic-tools/ask-grok.js'
import {
  MURPH_ANALYZE_VIDEO_TOOL,
} from './dynamic-tools/analyze-video.js'
import {
  MURPH_CREATE_CALENDAR_LINK_TOOL,
} from './dynamic-tools/calendar-link.js'
export { MURPH_ASSISTANT_STYLE_TOOL } from './dynamic-tools/assistant-style.js'
export type {
  AssistantStyleTurnSettingsOverlay,
} from './dynamic-tools/assistant-style.js'
export { MURPH_AUTOMATION_TOOL, MURPH_AUTOMATION_INSPECT_TOOL } from './dynamic-tools/automation.js'
export { MURPH_DEVICE_TOOL } from './dynamic-tools/device.js'
export { MURPH_LABS_TOOL } from './dynamic-tools/labs.js'
export {
  MURPH_PENDING_VAULT_FILES_TOOL,
} from './dynamic-tools/pending-vault-files.js'
export {
  MURPH_GROUP_ROOM_MODEL_TOOL,
} from './dynamic-tools/group-room-model.js'
export {
  MURPH_MEMBER_MEMORY_TOOL,
} from './dynamic-tools/member-memory.js'
export {
  MURPH_CREATE_CLINICAL_RECORDS_CONNECT_LINK_TOOL,
} from './dynamic-tools/clinical-records.js'
export {
  MURPH_RESOLVE_PHYSICAL_NOTE_TOOL,
  MURPH_SEND_PHYSICAL_NOTE_TOOL,
} from './dynamic-tools/physical-notes.js'
export { MURPH_ASK_GROK_TOOL } from './dynamic-tools/ask-grok.js'
export { MURPH_ANALYZE_VIDEO_TOOL } from './dynamic-tools/analyze-video.js'
export { MURPH_CREATE_CALENDAR_LINK_TOOL } from './dynamic-tools/calendar-link.js'
const MURPH_CHARACTER_SHEET_REFERENCE_IMAGE_REF =
  'skill-assets/murph-character-sheet-v1.png'
export const GENERATE_IMAGE_REFERENCE_IMAGE_REFS_DESCRIPTION =
  `Optional ordered JPG/PNG/WebP refs (max 16): raw/inbox/**, raw/captures/**, or ${MURPH_CHARACTER_SHEET_REFERENCE_IMAGE_REF}. Explain roles; include the character sheet whenever Murph itself appears.`
const GROUP_GENERATED_AVATAR_REFERENCE_IMAGE_REFS_DESCRIPTION =
  `Optional ordered JPG/PNG/WebP refs for generated avatars: raw/inbox/**, raw/captures/**, or ${MURPH_CHARACTER_SHEET_REFERENCE_IMAGE_REF}. Explain roles; include the character sheet when Murph appears.`

export const HOSTED_COMPUTER_UNKNOWN_OUTCOME_TEXT =
  'computer API outcome is unknown after a transport or browser execution failure; call computer_open before retrying Playwright code or taking another step'

export const MURPH_SEND_PROGRESS_UPDATE_TOOL = {
  namespace: 'murph',
  name: 'send_progress_update',
  description:
    `Send the member a short message now, before work that will keep them waiting, then continue working. A successful call means the message was sent. It does not end the turn.`,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      text: {
        type: 'string',
        minLength: 1,
        description:
          `One or two plain sentences about what you are doing for them and what comes next. Leave out conclusions and results you have not verified.`,
      },
    },
    required: ['text'],
  },
} as const

const MURPH_GROUP_SEND_PROGRESS_UPDATE_TOOL = {
  ...MURPH_SEND_PROGRESS_UPDATE_TOOL,
  description:
    `Send the group one short message now, before work that will keep the room waiting, then continue working. Send at most one per turn. A successful call means the message was sent. It does not end the turn.`,
} as const

export const MURPH_ATTACH_RESPONSE_MEDIA_TOOL = {
  namespace: 'murph',
  name: 'attach_response_media',
  description:
    `Set the images sent with this turn's final reply, at most ${ASSISTANT_AUTHORED_RESPONSE_MEDIA_MAX_ITEMS}. Each call replaces the previous set, and an empty array clears it. Nothing is sent until the turn ends. Use a public HTTPS URL only for a static catalog image. For anything private, generated, health-related, or sent by the member, pass the vault_image descriptor exactly as a Murph command returned it. When the reply uses \`---\` bubbles, set bubble to the bubble an image belongs to; images without one go with the last bubble. When you attach a chart, state one number from its data in the reply text, such as the start and end values.`,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      media: {
        type: 'array',
        maxItems: ASSISTANT_AUTHORED_RESPONSE_MEDIA_MAX_ITEMS,
        items: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: {
                  type: 'string',
                  enum: ['image'],
                },
                url: {
                  type: 'string',
                  description:
                    'Public HTTPS image URL, for static catalog images only.',
                },
                alt: {
                  anyOf: [
                    { type: 'string', minLength: 1, maxLength: 500 },
                    { type: 'null' },
                  ],
                },
                source: {
                  anyOf: [
                    { type: 'string', minLength: 1, maxLength: 200 },
                    { type: 'null' },
                  ],
                },
                bubble: {
                  type: 'integer',
                  minimum: 1,
                  maximum: MAX_ASSISTANT_REPLY_BUBBLES,
                  description:
                    '1-based number of the `---` bubble this image goes with.',
                },
              },
              required: ['url'],
            },
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: {
                  type: 'string',
                  enum: ['vault_image'],
                },
                ref: { type: 'string', minLength: 1, maxLength: 1024 },
                sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
                filename: { type: 'string', minLength: 1, maxLength: 255 },
                contentType: {
                  type: 'string',
                  enum: ['image/jpeg', 'image/png', 'image/webp'],
                },
                sizeBytes: {
                  type: 'integer',
                  minimum: 1,
                  maximum: assistantVaultImageMaxBytes,
                },
                alt: {
                  anyOf: [
                    { type: 'string', minLength: 1, maxLength: 500 },
                    { type: 'null' },
                  ],
                },
                source: {
                  anyOf: [
                    { type: 'string', minLength: 1, maxLength: 200 },
                    { type: 'null' },
                  ],
                },
                bubble: {
                  type: 'integer',
                  minimum: 1,
                  maximum: MAX_ASSISTANT_REPLY_BUBBLES,
                  description:
                    '1-based number of the `---` bubble this image goes with.',
                },
              },
              required: [
                'kind',
                'ref',
                'sha256',
                'filename',
                'contentType',
                'sizeBytes',
              ],
            },
          ],
        },
      },
    },
    required: ['media'],
  },
} as const

export const MURPH_ATTACH_SLEEP_CARD_TOOL = {
  deferLoading: true,
  namespace: 'murph',
  name: 'attach_sleep_card',
  description:
    `Attach the sleep summary card for one night to the final reply, for a general request such as "how did I sleep" or "sleep recap". Pass the local wake date. The host reads the night and builds the card. The card is the whole reply: send no final text and attach no media. The one exception is when the member, or the saved instructions of this scheduled occurrence, also ask for a note. Then add one or two sentences about what the card does not show, such as how the night compares with the past week, without repeating the card's numbers. Write the note as the final text in a conversation turn or as the send_message text in a scheduled run. For a question about one metric, a question with several parts, or a request for advice, answer in text. If the result is no_sleep_for_date, say so in text.`,
  inputSchema: {
    type: 'object', additionalProperties: false,
    properties: { date: { type: 'string', format: 'date', description: 'Local wake date, YYYY-MM-DD.' } },
    required: ['date'],
  },
} as const

export const MURPH_ATTACH_RESPONSE_CARD_TOOL = {
  deferLoading: true,
  namespace: 'murph',
  name: 'attach_response_card',
  description:
    `Attach one card to this turn's final reply in a private conversation. The card is the whole reply. Use it only when the card alone answers the request, send no final text after it (the first-card introduction below is the one exception), and attach no response media with it. The card is sent when the turn ends, and the runtime writes its text fallback, so do not repeat its values in text. Use it when the member, or the saved instructions of this scheduled occurrence, ask for something a card can show in full; after a verified meal save or edit; and to show a tracked workout. A request with several parts gets ordinary text and no card.\n\ndaily_nutrition card. Copy each metric's total and mealCount exactly from one source and never calculate totals yourself. When the last meal save of this turn used --with-daily-totals, returned dailyTotals data, and nothing changed after it, that result is the source: attach a non-null dailyTotals.totalsOnlyCard unchanged, or build the card from dailyTotals.data. Otherwise run \`vault-cli meal totals --from <date> --to <same-date> --resolve-goals --format json\` once, after the last meal or goal change of this turn, for the date the member asked about or for this scheduled occurrence's local date. When goalContext.status is ready, give each of the five goals { target: goalContext.targets.<metric>.target, status: "on_target" }. The schema requires a status and the host replaces it with the real one. When goalContext.status is missing, set all five goals to null. For any other status, reply in text with no card. A card has all five goals or none. If any metric's mealCount is lower than the day's mealCount, the day is incomplete: follow "When the card is not ready" in the food-journal skill first, and attach a partial card only when the member asked to see partial data.\n\nAsking for a card or logging a meal never sets, proposes, accepts, or changes nutrition targets. Targets change only when the member asks to set them, which follows the daily-nutrition-card-goals reference in the nutrition-strategy skill and is answered in text. A scheduled run never asks about targets and never proposes or activates them.\n\nCalorie and macro numbers are unsuitable for some members. Judge this from the conversation and one \`vault-cli memory show --compact --format json\` read. Do not run a medical checklist, search Health Commons to decide, or ask again about things already known. The conditions that matter are: under 18; pregnant or breastfeeding; an eating disorder or a preference to avoid numbers; underweight, frail, or malnourished; glucose-lowering medication; kidney, advanced liver, significant heart, or relevant endocrine disease; post-bariatric care; and clinician-set limits that conflict with the numbers. A known condition blocks only the numbers it affects. An allergy, intolerance, or dietary restriction alone blocks nothing. When numbers are unsuitable, reply helpfully without them and attach no card. In a scheduled run with unclear suitability, close out in text without numbers and without a question.\n\nThe first totals-only card a member ever receives is followed by this exact final text: "Here’s your nutrition card. If you’d like, we can set up goals too." Leave it out when memory or the conversation shows they declined goals, avoid numbers, or were already invited. Add nothing else around it.\n\nGeneric compact_table card (rowHeader, columns, rows). Use it for a table, tracker, plan, or schedule the member asked for that fits within ${compactTableCardV1Bounds.rows} rows, ${compactTableCardV1Bounds.columns} columns, and ${compactTableCardV1Bounds.cellValue} characters per cell. Shorten labels only when the meaning is unchanged. Never drop, merge, or invent rows. If the content does not fit, reply with the full content in text.\n\nWorkout compact_table card. Update or resolve the workout and read it back successfully first. Send kind compact_table, version 1, title, subtitle null, footer, tracking with kind workout and the exact evt_ entityId, and workout. Leave out rowHeader, columns, and rows. Send the whole workout and let validation decide whether it fits. Do not refuse because it looks long, and do not ask the member to simplify it. Write footers that still make sense on a card that cannot be tapped. Use it for the first card after starting or reading one workout and for updates to that same workout, including its final snapshot. If more than one workout could be meant, ask which.\n\nWhen validation rejects the card, fix only the fields it names and retry once with the same verified values. If the retry fails, give the full content as text without mentioning the card or its format. Never say a card was attached unless the call succeeded.`,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      card: assistantResponseCardJsonSchema,
    },
    required: ['card'],
  },
} as const

export const MURPH_ATTACH_EXERCISE_ROUTINE_CARD_TOOL = {
  deferLoading: true,
  namespace: 'murph',
  name: 'attach_exercise_routine_card',
  description:
    `Attach one Telegram exercise routine card as the whole final reply. Use it to teach movements now, for a scheduled occurrence that teaches a saved routine, or to repeat or improve an earlier routine. Send no final text and no response media with it. Use attach_telegram_rich_content when a different layout is clearer. Every named movement is its own card.exercises item, including movements grouped under a phase: Mobility (ankle circles, trunk rotations) plus Balance (tandem stance, weight shifts) is four items. Run vault-cli exercise show for every movement before attaching; an exercise list result is not enough. Give at most three short instructions per movement and one stop condition for this routine, at most 160 characters. Add catalog images where they help, eight at most, each on its own movement. Copy each image's url, alt, and step exactly, and set its source to exercise_catalog:<returned-item-id>:<1-based-position-in-returned-images>. Do not promise images for a movement that has none. Make the stated total time match the content. When validation rejects the card, fix the named fields, keep every valid movement, instruction, and image, and retry once. If that fails, send one attach_telegram_rich_content card without images that still lists every movement. After either card succeeds, stop: add no apology, no report of the rejected card, and no second safety recap.`,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      card: exerciseRoutineResponseCardJsonSchema,
    },
    required: ['card'],
  },
} as const

export const MURPH_ATTACH_TELEGRAM_RICH_CONTENT_TOOL = {
  deferLoading: true,
  namespace: 'murph',
  name: 'attach_telegram_rich_content',
  description:
    `Attach one Telegram Rich Message as the whole final reply, in a direct or group Telegram conversation. Use it when structure makes the answer easier to use: steps, lists, plans, schedules, comparisons, exercise guidance, or summaries. Ordinary conversation stays plain text. Send no final text and no response media with it. The card only presents an answer. Nutrition totals, nutrition targets, and tracked workouts still need their own reads, writes, and safety rules. Keep it short: usually one h2, two to six sections or steps, and under 1,500 visible characters. Say each fact once. Use a table only when it helps, with at most five columns and short cells. Put optional detail in details, and keep safety limits and stop conditions visible. Supported tags: h2, h3, p, footer, hr, ul, ol, li, blockquote, cite, aside, details, summary, table, caption, tr, th, td, b, strong, i, em, u, ins, code, mark, and br. Tables allow bordered and striped. Cells allow align="left", "center", or "right". Details allow open. Escape text with &amp;, &lt;, &gt;, &quot;, or &apos;. Do not use links, visible URLs, images, media, maps, custom emoji, scripts, styles, unsupported attributes, or Markdown. Example: <h2>Mobility session</h2><p>Easy pace · about 8 min</p><ol><li>Move through a comfortable range.</li><li>Pause between sides.</li></ol><details><summary>Exercise notes</summary><p>Keep each repetition controlled.</p></details><blockquote>Stop if pain increases.</blockquote>.`,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      card: telegramRichContentResponseCardJsonSchema,
    },
    required: ['card'],
  },
} as const

export const MURPH_GROUP_CHALLENGE_RESPONSE_CARD_TOOL = {
  deferLoading: true,
  namespace: 'murph',
  name: 'attach_response_card',
  description:
    `Attach a challenge_standings card as the whole final reply in this group. Use it when the room, or the saved instructions of this scheduled occurrence, ask for the current standings of a shared challenge. First read the challenge page with vault-cli knowledge show and make every shared-data read its scoring needs. Pass the challenge slug, the pageRevisionDigest copied from that knowledge show result, and one observation for every participant on the page whose participation state is in. The host does the rest: it checks that the page is unchanged, takes participants, teams, rules, caps, and units from the page, scores and ranks, saves the result to the page, and attaches the card. Being in the room or sharing data does not make someone a participant. When the tool refuses for any reason, say in ordinary text what could not be read or confirmed, and do not create or repair the challenge definition here. Individual and team standings attach only when the full ranking has at most eight entries. Collective cards have no limit. Partial scores are lower bounds, and unscored entries stay empty. Send no final text and no response media with the card.`,
  inputSchema: groupChallengeResponseCardToolInputJsonSchema,
} as const

export const MURPH_GENERATE_IMAGE_TOOL = {
  namespace: 'murph',
  name: 'generate_image',
  deferLoading: true,
  description:
    `Generate one image. Use it when the member asks for an image, when a saved preference says visuals help them, or when a skill says an image is welcome and privacy-safe here. Describe the image in prompt. Pass member photos or earlier generated images as referenceImageRefs and say in the prompt what each one is for. Include ${MURPH_CHARACTER_SHEET_REFERENCE_IMAGE_REF}, Murph's character sheet, whenever Murph appears. In a conversation turn the image is generated in the background and delivered when it is ready. In a scheduled run it is attached to this run's reply and uses one of its ${ASSISTANT_AUTHORED_RESPONSE_MEDIA_MAX_ITEMS} image slots, so leave one free before calling. For a graph, chart, or trend line that no card or chart tool can show, put the chart type, the axis labels, and the values in the prompt, and ask for this style: cream paper (#f5f0e8), slate text (#2d3436), solid sage data lines (#7a8c6e), dashed sand reference lines (#d4c4a8), a second series in slate told apart by markers, Fraunces-style serif titles and numbers, DM Sans body text, DM Mono labels, flat with no gradients or shadows, sparse rounded axis ticks, a compact legend, and no number labels on points or bars unless the member asked for them. In an authorized recap, output=file writes the image to a local file and returns its path; nothing is attached. Use the recap's reference IDs.`,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      output: { type: 'string', enum: ['chat', 'file'] },
      prompt: {
        type: 'string',
        minLength: 1,
        maxLength: 4000,
      },
      size: {
        type: 'string',
        enum: ['1024x1024', '1024x1536', '1536x1024'],
        description: 'Defaults to 1024x1536 portrait for file output and 1024x1024 for chat output.',
      },
      quality: {
        type: 'string',
        enum: ['low', 'medium', 'high'],
        description: 'Defaults to high for file output and medium for chat output.',
      },
      outputFormat: {
        type: 'string',
        enum: ['webp', 'png', 'jpeg'],
        default: 'webp',
      },
      alt: {
        anyOf: [
          { type: 'string', minLength: 1, maxLength: 500 },
          { type: 'null' },
        ],
        default: null,
      },
      referenceImageRefs: {
        type: 'array',
        maxItems: 16,
        default: [],
        description: GENERATE_IMAGE_REFERENCE_IMAGE_REFS_DESCRIPTION,
        items: {
          type: 'string',
          minLength: 1,
          maxLength: 1024,
        },
      },
      message_ref: {
        type: 'string',
        pattern: '^ain_[0-9a-f]{32}$',
        description:
          'Exact current Message ref authorizing an irreversible continuation that will consume this image, such as mailing a physical note. Omit for ordinary image generation.',
      },
    },
    required: ['prompt'],
  },
} as const

export const MURPH_SUBMIT_PRODUCT_FEEDBACK_TOOL = {
  namespace: 'murph',
  name: 'submit_product_feedback',
  deferLoading: true,
  description:
    `Record one piece of feedback about Murph for the team. The member is not told unless they ask. Give the kind, a product-only summary, and any related changelog item ids. When the member asks you to record feedback, submit what is known and mark missing details unknown; do not hold the submission to ask for them. Ordinary feedback is saved after the reply on a best-effort basis. A weekly usage audit uses kind feature_request, no changelog ids, and a summary starting "Usage optimization audit:" that reports rounded cost figures and coverage only. When a member in a private conversation explicitly asks for human support, use kind frustration, no changelog ids, and a summary starting "Support escalation:"; that call waits for confirmation. The result is accepted, already accepted, unavailable, callback failure, or a validation error that lists the fields to fix. Fix a validation error and retry once. Every other result is final.`,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      kind: {
        type: 'string',
        enum: [...HOSTED_PRODUCT_FEEDBACK_KINDS],
        description:
          `feature_request: Murph could not do something the member wanted. frustration: a bad experience with no specific capability requested, and every support escalation. feature_interest: interest in something Murph already does.`,
      },
      summary: {
        type: 'string',
        minLength: 1,
        maxLength: HOSTED_PRODUCT_FEEDBACK_SUMMARY_MAX_LENGTH,
        description:
          `What happened, in product terms a teammate can act on without the conversation: who (in generic terms), which Murph surface or workflow, what they tried, what they expected, and what happened. When a capability is missing, name the outcome they wanted and what Murph lacks. For any failure, friction, workaround, or manual workflow, add a section starting "Reproduction:" with the smallest setup, the Murph commands or tool calls with made-up arguments when known, an example request with made-up content, and expected versus observed behavior. Leave that section out only for pure feature interest or a usage audit with aggregate evidence. Say what is unknown and never invent steps. Write in your own words and keep the member out of it: no names, handles, identifiers, quotes or close paraphrases, diagnoses, symptoms, medications, results, health or fitness values, locations, relationships, contact details, secrets, or provider data. Use the least specific wording that still explains the problem, such as "a health metric" or "a connected source". Start with "Speculative:" when you are inferring friction the member did not state, or "Murph-observed:" for repeated tool friction you ran into yourself. A support escalation starts with "Support escalation:" and follows the same format.`,
      },
      relatedChangelogItemIds: {
        type: 'array',
        minItems: 0,
        maxItems: 7,
        default: [],
        description:
          `Ids of shipped changelog items this feedback is about. Leave it empty unless the feedback concerns a specific shipped item.`,
        items: {
          type: 'string',
          maxLength: 120,
          pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
        },
      },
    },
    required: ['kind', 'summary'],
  },
} as const

export const MURPH_FAMILY_PLAN_TOOL = {
  namespace: 'murph',
  name: 'family_plan',
  deferLoading: true,
  description:
    `Read the member's Family plan status, start Family checkout, or create an invite. Use read_status when the member asks about Family or when this turn's context says their usage is low. Start checkout or create an invite only when the member asks for it in this turn. Report only what the result says. It never proves that a plan is active, an invite was accepted, or a payment went through.`,
  inputSchema: {
    oneOf: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: {
            type: 'string',
            enum: ['read_status'],
          },
        },
        required: ['action'],
      },
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: {
            type: 'string',
            enum: ['start_checkout'],
          },
          confirmedTrialConversion: {
            type: 'boolean',
            enum: [true],
            description:
              'Pass true only after read_status returned activeTrialConversion terms and the member explicitly confirmed those fresh terms. Omit for every other checkout.',
          },
        },
        required: ['action'],
      },
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: {
            type: 'string',
            enum: ['create_invite'],
          },
          invite: {
            type: 'object',
            additionalProperties: false,
            properties: {
              targetEmail: {
                anyOf: [
                  { type: 'string', minLength: 3, maxLength: 320 },
                  { type: 'null' },
                ],
                default: null,
                description: 'Email address for an email-bound web invite when the user provided one.',
              },
              planCode: {
                type: 'string',
                enum: [...HOSTED_FAMILY_PLAN_CODES],
                description: 'Pulse, Edge, or Max tier requested for this Family member. Omit for Pulse.',
              },
              targetLabel: {
                anyOf: [
                  { type: 'string', minLength: 1, maxLength: 80 },
                  { type: 'null' },
                ],
                default: null,
                description: 'Optional natural label such as mom, dad, brother, or a first name.',
              },
              targetPhoneNumber: {
                anyOf: [
                  { type: 'string', minLength: 1, maxLength: 40 },
                  { type: 'null' },
                ],
                default: null,
                description: 'Phone number for a phone-bound invite when the user provided one.',
              },
              targetTelegramUsername: {
                anyOf: [
                  { type: 'string', minLength: 5, maxLength: 32 },
                  { type: 'null' },
                ],
                default: null,
                description: 'Telegram username without @ when the user provided one.',
              },
            },
          },
        },
        required: ['action', 'invite'],
      },
    ],
  },
} as const

export const MURPH_USAGE_DIAGNOSTICS_TOOL = {
  namespace: 'murph',
  name: 'usage_diagnostics',
  deferLoading: true,
  description:
    `Read this member's recent AI usage: cost by model and workflow, the most expensive turns, and tool output sizes. It is read-only and covers 7 days and 10 turns unless you pass days or limit. Costs are amounts of usage allowance and say nothing about card charges. Tool sizes are in bytes and only approximate tokens and cost. The result includes rough model rates.`,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      days: { type: 'integer', minimum: 1, maximum: 31 },
      limit: { type: 'integer', minimum: 1, maximum: 20 },
    },
  },
} as const

export const MURPH_PLAN_USAGE_TOOL = {
  namespace: 'murph',
  name: 'plan_usage',
  description:
    `Read the member's plan, how much AI usage is left, and a signed quote for a plan change. It is read-only. Use it for questions about plan, usage, or billing, or when this turn's context says usage is low. Without targetPlanCode it quotes the recommended plan. With targetPlanCode it quotes the plan the member named, and only that matching quote may be used. availablePlans lists the plans they can switch to. Percentages and forecasts cover all available usage, with no split by credit source.`,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      targetPlanCode: {
        type: 'string',
        enum: [...HOSTED_PLAN_USAGE_DIRECT_BILLING_PLAN_CODES],
        description:
          `The plan the member named. Leave it out to get the recommended plan.`,
      },
    },
  },
} as const

export const MURPH_IMESSAGE_CONTACT_TOOL = {
  namespace: 'murph',
  name: 'imessage_contact',
  description:
    `Get the member's Murph iMessage number, assigning one if they have none. Call it only when the member asks for it in this turn. Asking again returns the same number.`,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {},
  },
} as const

export const MURPH_SUBSCRIPTION_TOOL = {
  namespace: 'murph',
  name: 'subscription',
  description:
    `Change the member's plan. Call it only after plan_usage returned a quote for this exact plan and the member confirmed that price and timing in this turn. Pass that quote's quoteId and targetPlanCode. Repeating the same call is safe, and a different plan needs a new request from the member. A scheduled change returns effectiveAt; keep the current plan and the future plan distinct when you report it. A payment_required result includes a paymentUrl for the member. No other result says anything about a payment method.`,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      action: {
        type: 'string',
        enum: ['change_plan'],
      },
      targetPlanCode: {
        type: 'string',
        enum: [...HOSTED_PLAN_USAGE_DIRECT_BILLING_PLAN_CODES],
      },
      quoteId: {
        type: 'string',
        minLength: 1,
        maxLength: 1024,
      },
    },
    required: ['action', 'targetPlanCode', 'quoteId'],
  },
} as const

export const ASSISTANT_ACCEPTED_MESSAGE_REF_PATTERN = '^ain_[0-9a-f]{32}$'

export const MURPH_PERSONALIZATION_TOOL = {
  namespace: 'murph',
  name: 'personalization',
  deferLoading: true,
  description:
    `Read or change how Murph writes and sounds in this conversation: tone and voice. In a private conversation these are the member's settings. In a group they belong to the room and never touch anyone's private settings. For update, send only the fields being changed, with message_ref from the message that asked for the change. Changes asked for in different messages go in separate calls. Leave message_ref out in a scheduled run. The result reports what is now saved, so a tone-only or voice-only change needs no read first. A request about how Murph should write from now on is an update. A request about one reply is not saved. Tone also sets capitalization: formal means sentence case and casual means lowercase, so a request for capitals or sentence case is formal and a request for lowercase is casual. Confirm with the words sentence case or lowercase. Model, provider, and reasoning changes belong to murph.assistant_configuration when that tool is available.`,
  inputSchema: {
    oneOf: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: {
            type: 'string',
            enum: ['read'],
          },
        },
        required: ['action'],
      },
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: {
            type: 'string',
            enum: ['update'],
          },
          message_ref: {
            type: 'string',
            pattern: ASSISTANT_ACCEPTED_MESSAGE_REF_PATTERN,
          },
          tone: {
            type: 'string',
            enum: assistantTonePreferenceValues,
          },
          voice: {
            type: 'string',
            enum: assistantVoiceOptionIdValues,
            description: assistantVoiceOptions
              .map((option) => `${option.label}=${option.id}`)
              .join('; '),
          },
        },
        required: ['action'],
        minProperties: 2,
        // Keep properties here so generated tool arguments stay concrete.
        // Source metadata alone cannot make an update nonempty.
        not: { required: ['message_ref'], maxProperties: 2 },

      },
    ],
  },
} as const

export const MURPH_ASSISTANT_CONFIGURATION_TOOL = {
  namespace: 'murph',
  name: 'assistant_configuration',
  deferLoading: true,
  description:
    `Read or change the model and reasoning effort for this member's future turns. read returns the current values and the choices open to this member. update saves a change the member asked for in this turn, and it takes effect on the next turn. Asking for the default is enough to restore it: read the choices, then update, with no further confirmation. Never change either setting because usage is low. Luna uses the least usage, GPT-6.1 Terra is the default, Sol models need an active paid subscription, and Astra needs an active paid Edge or Max plan. Use model names only when the member does. Otherwise describe the cheaper option as “a less capable model that uses less AI usage.” The lowest reasoning effort is low; there is no none. Say a change is saved only when the result says updated or unchanged.`,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      action: {
        type: 'string',
        enum: ['read', 'update'],
      },
      model: {
        type: 'string',
        enum: [...HOSTED_ASSISTANT_PRODUCT_MODELS],
        description:
          `The model for future turns. Only with update.`,
      },
      reasoningEffort: {
        type: 'string',
        enum: [...HOSTED_ASSISTANT_REASONING_EFFORTS],
        description:
          `The reasoning effort for future turns. Only with update.`,
      },
    },
    required: ['action'],
  },
} as const

export const MURPH_GROUP_ASSISTANT_CONFIGURATION_TOOL = {
  namespace: 'murph',
  deferLoading: true,
  name: 'assistant_configuration',
  description:
    `Read or change the model this room's Murph uses on future turns. It never reads or changes anyone's private model, reasoning, account, or billing settings. read returns the current model and availableModels. update saves a model from availableModels that someone in the room asked for in this turn, and it takes effect on the next turn. Rooms default to GPT-6.1 Sol and need no subscription; Terra and Luna can also be chosen. Asking for the default is enough to restore it: read the choices, then update, with no further confirmation. Never change the model because usage is low. Say a change is saved only when the result says updated or unchanged.`,
  inputSchema: {
    oneOf: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: {
            type: 'string',
            enum: ['read'],
          },
        },
        required: ['action'],
      },
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: {
            type: 'string',
            enum: ['update'],
          },
          model: {
            type: 'string',
            enum: HOSTED_ASSISTANT_PRODUCT_MODELS.filter((model) => model !== 'gpt-6-astra'),
            description:
              `The room's model for future turns.`,
          },
        },
        required: ['action', 'model'],
      },
    ],
  },
} as const

const GROUP_VAULT_SHARE_FIXED_PROJECTION_SCOPE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['projectionKind'],
  properties: {
    projectionKind: {
      type: 'string',
      enum: [...HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS],
    },
  },
} as const

const GROUP_VAULT_SHARE_ACTIVITY_MINUTES_PROJECTION_SCOPE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['projectionKind', 'selector'],
  properties: {
    projectionKind: {
      type: 'string',
      enum: [HOSTED_VAULT_SHARE_ACTIVITY_MINUTES_PROJECTION_KIND],
    },
    selector: {
      type: 'object',
      additionalProperties: false,
      required: ['activityKind'],
      properties: {
        activityKind: {
          type: 'string',
          enum: [...HOSTED_VAULT_SHARE_ACTIVITY_MINUTES_SELECTOR_ACTIVITY_KINDS],
        },
      },
      description:
        'Required for activity-minutes-days.v1.',
    },
  },
} as const

const GROUP_VAULT_SHARE_ACTIVITY_DISTANCE_PROJECTION_SCOPE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['projectionKind', 'selector'],
  properties: {
    projectionKind: {
      type: 'string',
      enum: [HOSTED_VAULT_SHARE_ACTIVITY_DISTANCE_PROJECTION_KIND],
    },
    selector: {
      type: 'object',
      additionalProperties: false,
      required: ['activityKind'],
      properties: {
        activityKind: {
          type: 'string',
          enum: [...HOSTED_VAULT_SHARE_ACTIVITY_DISTANCE_SELECTOR_ACTIVITY_KINDS],
        },
      },
      description:
        'Required for activity-distance-days.v1.',
    },
  },
} as const

const GROUP_VAULT_SHARE_ACTIVITY_SESSION_COUNT_PROJECTION_SCOPE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['projectionKind', 'selector'],
  properties: {
    projectionKind: {
      type: 'string',
      enum: [HOSTED_VAULT_SHARE_ACTIVITY_SESSION_COUNT_PROJECTION_KIND],
    },
    selector: {
      type: 'object',
      additionalProperties: false,
      required: ['activityKind'],
      properties: {
        activityKind: {
          type: 'string',
          enum: [...HOSTED_VAULT_SHARE_ACTIVITY_SESSION_COUNT_SELECTOR_ACTIVITY_KINDS],
        },
      },
      description:
        'Required for activity-session-count-days.v1.',
    },
  },
} as const

const GROUP_VAULT_SHARE_PROJECTION_SCOPE_SCHEMA = {
  oneOf: [
    GROUP_VAULT_SHARE_FIXED_PROJECTION_SCOPE_SCHEMA,
    GROUP_VAULT_SHARE_ACTIVITY_MINUTES_PROJECTION_SCOPE_SCHEMA,
    GROUP_VAULT_SHARE_ACTIVITY_DISTANCE_PROJECTION_SCOPE_SCHEMA,
    GROUP_VAULT_SHARE_ACTIVITY_SESSION_COUNT_PROJECTION_SCOPE_SCHEMA,
  ],
} as const

const GROUP_SHARED_HISTORY_READ_PROPERTIES = {
  participantId: { type: 'string', minLength: 1, maxLength: 200,
    description: 'Optional read_shared narrowing to a current participantId returned by an earlier shared read. Required for history. Never a private member/workspace id.' },
  history: { type: 'object', additionalProperties: false,
    required: ['fromDate', 'throughDate'],
    properties: {
      fromDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      throughDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    },
    description:
      `read_shared only. A date range of up to 90 member-local dates for one current participant and one health metric scope, with no freshness and no group_email audience. Use it only when someone asks for a longer trend; ordinary reads, weekly standings, and newsletters keep their own dates. Every shared metric already covers this range, so never ask for a history permission or send anyone to settings. not_granted means the metric itself is unshared and needs the ordinary consent for that metric. When dateCoverage.nextFromDate is returned, call again from that date with the same throughDate until it is exhausted. The read returns what Murph already has and does not fetch more from a provider. Dates with no data are simply absent; they are never zeros and never a sign of missing permission. Let counts carry coverage, such as "62 of 90 days". To chart a trend, pass the observed values to generate_image and do not save a copy of the history.` },
} as const

/**
 * Detached group consultation gets only the lazy shared-data read surface. It
 * intentionally reuses murph.group so the normal parser/executor stays the
 * single implementation while the model never sees mutation or routing actions.
 */
export const MURPH_GROUP_SHARED_READ_TOOL = {
  namespace: 'murph',
  name: 'group',
  description:
    `Read what members of this group have shared. Pass action read_shared with one to three projectionScopes. A read covers the last seven days, and history reads up to 90 dates for one participant and one metric. A result with status partial did not load the members listed in omittedParticipantIds; conclude nothing else about them. companionLastContactAt is only when a member's app last made contact, possibly in the background.`,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ...GROUP_SHARED_HISTORY_READ_PROPERTIES,
      action: {
        type: 'string',
        enum: ['read_shared'],
      },
      projectionScopes: {
        type: 'array',
        minItems: 1,
        maxItems: ASSISTANT_HOSTED_GROUP_SHARED_READ_MAX_PROJECTION_SCOPES,
        uniqueItems: true,
        items: GROUP_VAULT_SHARE_PROJECTION_SCOPE_SCHEMA,
      },
    },
    required: ['action', 'projectionScopes'],
  },
} as const

const GROUP_SHARED_FRESHNESS_SCHEMA = {
  type: 'array',
  minItems: 1,
  maxItems: 21,
  uniqueItems: true,
  description:
    `read_shared only, and optional. For a dated wearable update, list each wearable projectionScopeKey you will report with each YYYY-MM-DD date. The host requests a sync for consented dates that are missing and then reads again. checkedAt in the result is when shared data was last checked.`,
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      projectionScopeKey: {
        type: 'string', minLength: 1, maxLength: 191,
        enum: HOSTED_VAULT_SHARE_DAILY_METRIC_PROJECTION_SPECS
          .filter((spec) => spec.source.kind === 'metric-series')
          .map((spec) => spec.projectionKind),
      },
      date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    },
    required: ['projectionScopeKey', 'date'],
  },
} as const

/**
 * Scheduled group turns can read shared facts and offer group access without
 * exposing the provider-specific native-message versus link decision.
 */
export const MURPH_GROUP_SHARED_READ_PERMISSION_OFFER_TOOL = {
  namespace: 'murph',
  name: 'group',
  description:
    `Read what members of this group have shared, or offer them a way to share, in this scheduled group run. Pass the exact projectionScopes. The host chooses the group and the destination, and an offer here is always a link. A result of unavailable means no consent prompt could be shown. An offer never changes existing membership or permissions. A partial read is incomplete.`,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ...GROUP_SHARED_HISTORY_READ_PROPERTIES,
      action: {
        type: 'string',
        enum: ['read_shared', 'offer_access'],
      },
      freshness: GROUP_SHARED_FRESHNESS_SCHEMA,
      projectionScopes: {
        type: 'array',
        minItems: 1,
        maxItems: ASSISTANT_HOSTED_GROUP_SHARED_READ_MAX_PROJECTION_SCOPES,
        uniqueItems: true,
        items: GROUP_VAULT_SHARE_PROJECTION_SCOPE_SCHEMA,
      },
    },
    required: ['action', 'projectionScopes'],
  },
} as const

const ASSISTANT_ACCEPTED_MESSAGE_REF_SCHEMA = {
  type: 'string',
  pattern: ASSISTANT_ACCEPTED_MESSAGE_REF_PATTERN,
  description:
    `The Message ref shown beside the accepted message that asked for this action, copied exactly. It is required for every current-sender action, for record_current_sender_daily_metric, record_current_sender_journal_fact, set_current_sender_journal_capture, and revoke_own_email_share. For offer_access, pass it when someone asks for or accepts sharing, so the host can tie a fresh consent prompt to that request. It is optional for create_signup_referral_link and read_usage_referral. It is not a provider message id.`,
} as const

const ASSISTANT_MESSAGE_TARGET_REF_SCHEMA = {
  type: 'string',
  pattern: ASSISTANT_ACCEPTED_MESSAGE_REF_PATTERN,
  description:
    `The Message ref shown beside the accepted message to act on, copied exactly.`,
} as const

export const GROUP_ACCESS_FRESH_NATIVE_RESPONSE_HANDLING =
  'The native consent message completes the offer portion. If no other requested output remains, call murph.finish_without_reply. Otherwise answer the remaining request without adding a companion consent acknowledgment.'

export const MURPH_GROUP_TOOL_NAME = 'group'

export const MURPH_GROUP_TOOL_FAMILY_ACTIONS = {
  group_consult: [
    'ask',
    'handoff',
    'ask_current_sender',
    'ask_current_sender_privately',
    'clarify_current_sender',
    'continue_current_sender_in_group',
    'continue_current_sender_privately',
    'ask_member',
  ],
  group_data: [
    'record_current_sender_daily_metric',
    'record_current_sender_journal_fact',
    'post_disclosure_request',
    'revoke_disclosure_grant',
    'read_shared',
    'offer_access',
    'revoke_own_email_share',
  ],
  group_membership: [
    'set_journal_capture',
    'set_current_sender_journal_capture',
    'read_current',
    'prepare_next_group',
    'read_next_group',
    'cancel_next_group',
    'list_memberships',
    'leave_membership',
  ],
  group_usage: [
    'read_usage',
    'read_usage_referral',
    'arm_usage_referral',
    'cancel_usage_referral',
    'create_signup_referral_link',
  ],
  group_chat: [
    'read_chat_name',
    'update_display_name',
    'read_chat_participants',
    'set_chat_avatar',
    'share_contact_card',
  ],
  group_email: ['send_email'],
} as const

export const MURPH_GROUP_TOOL_PROPERTIES = {
      ...GROUP_SHARED_HISTORY_READ_PROPERTIES,
      setup: {
        type: 'object',
        additionalProperties: false,
        description:
          'Optional only for action="prepare_next_group". Include only style or room context the member explicitly requested for the next group in this private turn. Omit it for ownership-only preparation. Never copy private memory, health facts, contact handles, or personal settings implicitly.',
        properties: {
          roomContextMarkdown: {
            type: 'string',
            minLength: 1,
            maxLength:
              HOSTED_RUNTIME_PENDING_GROUP_SETUP_ROOM_CONTEXT_MAX_CODE_POINTS,
            description:
              'Optional compact Markdown containing only social context the member explicitly asked Murph to use in the next group. Keep it within the 2 KiB UTF-8 envelope. It becomes advisory group-visible behavior, not identity or authority, and must not contain raw phone, email, Sender, Telegram, or participant handles.',
          },
          style: {
            type: 'object',
            additionalProperties: false,
            minProperties: 1,
            description:
              'Optional sparse explicit style for the next group. Omitted fields retain product defaults; this never copies the member’s private settings.',
            properties: {
              persona: {
                type: 'string',
                enum: assistantPersonaIdValues,
              },
              personality: {
                type: 'object',
                additionalProperties: false,
                minProperties: 1,
                properties: {
                  detail: {
                    anyOf: [
                      { type: 'integer', minimum: 0, maximum: 10 },
                      { type: 'null' },
                    ],
                  },
                  humor: {
                    anyOf: [
                      { type: 'integer', minimum: 0, maximum: 10 },
                      { type: 'null' },
                    ],
                  },
                  push: {
                    anyOf: [
                      { type: 'integer', minimum: 0, maximum: 10 },
                      { type: 'null' },
                    ],
                  },
                  unhinged: {
                    anyOf: [
                      { type: 'integer', minimum: 0, maximum: 10 },
                      { type: 'null' },
                    ],
                  },
                },
              },
              tone: {
                type: 'string',
                enum: assistantTonePreferenceValues,
              },
              voice: {
                type: 'string',
                enum: assistantVoiceOptionIdValues,
              },
            },
          },
        },
      },
      context: {
        type: 'string',
        minLength: 1,
        maxLength: HOSTED_RUNTIME_GROUP_CONTEXT_HANDOFF_MAX_CODE_POINTS,
        description:
          'Required only for action="handoff" after the member explicitly asks to post, share, or tell a joined group. Supply only bounded verified facts the group needs, written in identity-neutral third person. Do not look up, infer, or include the member\'s name; the host supplies any group-safe attribution separately. Never write the member\'s actions, claims, or experiences as if Murph did, said, or experienced them. This is untrusted context, not final copy; the joined group Murph authors the message using its own conversation context.',
      },
      question: {
        type: 'string',
        minLength: 1,
        maxLength: HOSTED_EXECUTION_ASSISTANT_ASK_QUESTION_MAX_CODE_POINTS,
        description:
          'Required only for action="ask" or action="ask_member". Ask one self-contained natural-language question. ask may use a joined group\'s read-only context; ask_member produces a proposed answer whose outgoing information is checked against the selected disclosure grant before sharing.',
      },
      permissionText: {
        type: 'string',
        minLength: 1,
        maxLength: HOSTED_RUNTIME_GROUP_DISCLOSURE_PERMISSION_TEXT_MAX_CODE_POINTS,
        description:
          'Required only for action="post_disclosure_request". The exact concise natural-language description of the type of information a member may allow their private Murph to read and disclose to this group. The server shows this text in the consent request and reviews only each proposed outgoing answer against it before sharing.',
      },
      grantId: {
        type: 'string',
        minLength: 1,
        maxLength: HOSTED_RUNTIME_ASSISTANT_ASK_REQUEST_ID_MAX_CODE_POINTS,
        description:
          'Required for action="ask_member" or action="revoke_disclosure_grant". For ask_member, use the exact server-issued grantId from read_current. For revoke_disclosure_grant, use the exact grantId from the immediately preceding list_memberships result. Never guess it or take it from the user.',
      },
      policyCode: {
        type: 'string',
        enum: [...HOSTED_USAGE_REFERRAL_POLICY_CODES],
        description:
          'Required only for action="cancel_usage_referral". Cancel only one exact referral option with state="armed" from the legacy internal activeMissions field. Never call it a mission in member-facing copy.',
      },
      policyCodes: {
        type: 'array',
        items: {
          type: 'string',
          enum: [...HOSTED_USAGE_REFERRAL_POLICY_CODES],
        },
        minItems: 1,
        maxItems: HOSTED_USAGE_REFERRAL_POLICY_CODES.length,
        uniqueItems: true,
        description:
          'Required only for action="arm_usage_referral". Send one exact set containing only available policies the current sender explicitly selected.',
      },
      displayName: {
        type: 'string',
        minLength: 1,
        maxLength: HOSTED_RUNTIME_GROUP_DISPLAY_NAME_MAX_LENGTH,
        description:
          'Group display name. Required for action="update_display_name"; optional for action="offer_access" only when it is the name the group chose or the exact name from the immediately preceding read_chat_name result.',
      },
      cursor: {
        type: 'string',
        minLength: 1,
        maxLength: HOSTED_RUNTIME_GROUP_MEMBERSHIP_CURSOR_MAX_CODE_POINTS,
        description:
          'Optional only for action="list_memberships". Pass the exact opaque nextCursor from the immediately preceding page; never guess, edit, or take it from the user.',
      },
      disclosureGrantCursor: {
        type: 'string',
        minLength: 1,
        maxLength: HOSTED_RUNTIME_GROUP_DISCLOSURE_CURSOR_MAX_CODE_POINTS,
        description:
          'Optional only for action="read_current" or action="list_memberships". Pass the exact opaque nextDisclosureGrantCursor from the immediately preceding disclosure-grant page; never guess, edit, or take it from the user.',
      },
      membershipId: {
        type: 'string',
        minLength: 1,
        maxLength: HOSTED_RUNTIME_ASSISTANT_ASK_REQUEST_ID_MAX_CODE_POINTS,
        description:
          'Required for action="ask", action="handoff", or action="leave_membership". Use the exact opaque membershipId from list_memberships in this conversation; never expose it, guess it, edit it, or take it from the member.',
      },
      avatarPrompt: {
        type: 'string',
        minLength: 1,
        maxLength: 4000,
        description:
          'Optional only for action="share_contact_card" after an explicit request in a personal iMessage conversation. Generates a square Murph contact photo and sends a saveable vCard to that current conversation; omit it to share the canonical group card. status="unconfirmed" means the card may already have arrived: say so, ask the member to look, and only make another one if they say it is not there.',
      },
      avatarSource: {
        type: 'string',
        enum: ['generate', 'image_ref'],
        description:
          'Required for action="set_chat_avatar". Generate a new square avatar or reuse an exact existing private image ref.',
      },
      prompt: {
        type: 'string',
        minLength: 1,
        maxLength: 4000,
        description:
          'Required for action="set_chat_avatar" with avatarSource="generate". Prompt for one square group chat avatar.',
      },
      imageRef: {
        type: 'string',
        minLength: 1,
        maxLength: 1024,
        description:
          'Required for action="set_chat_avatar" with avatarSource="image_ref". Use the exact JPG/PNG/WebP ref under raw/inbox/** (user-sent) or raw/captures/** (including generated captures); never invent or modify it.',
      },
      size: {
        type: 'string',
        enum: ['1024x1024'],
        default: '1024x1024',
      },
      quality: {
        type: 'string',
        enum: ['low', 'medium', 'high'],
        default: 'medium',
      },
      outputFormat: {
        type: 'string',
        enum: ['webp', 'png', 'jpeg'],
        default: 'webp',
      },
      alt: {
        anyOf: [
          { type: 'string', minLength: 1, maxLength: 500 },
          { type: 'null' },
        ],
        default: null,
      },
      referenceImageRefs: {
        type: 'array',
        maxItems: 16,
        default: [],
        description: GROUP_GENERATED_AVATAR_REFERENCE_IMAGE_REFS_DESCRIPTION,
        items: {
          type: 'string',
          minLength: 1,
          maxLength: 1024,
        },
      },

      projectionScopes: {
        type: 'array',
        maxItems: HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES.length,
        items: GROUP_VAULT_SHARE_PROJECTION_SCOPE_SCHEMA,
        description:
          `The kinds of shared data to read or to ask permission for. For read_shared, pass one to three; each covers the last seven days. With audience group_email, pass the scopes the email will use; the host keeps only what each recipient currently shares. For offer_access, pass only the permissions the person asked for. Leaving it out asks for every permission, which is wrong when adding one missing permission. Permissions are separate: sleep timing or connection status does not include sleep duration. An offer never changes existing membership or other permissions, and the host writes the consent prompt and decides whether it is shown in the chat or as a link.`,
      },
      freshness: GROUP_SHARED_FRESHNESS_SCHEMA,
      audience: {
        type: 'string',
        enum: ['group_email'],
        description:
          'Optional only for read_shared in a scheduled group automation. group_email prepares the generic email effect, filters members and facts to currently eligible email recipients, and returns recipientCount, missingVerifiedEmailCount, and referenceAt without exposing addresses or authorization metadata.',
      },
      subject: {
        type: 'string',
        minLength: 1,
        maxLength: HOSTED_RUNTIME_GROUP_EMAIL_SUBJECT_MAX_LENGTH,
        description: 'Required only for send_email.',
      },
      html: {
        type: 'string',
        minLength: 1,
        maxLength: HOSTED_RUNTIME_GROUP_EMAIL_HTML_MAX_LENGTH,
        description: 'Required only for send_email.',
      },
      text: {
        anyOf: [
          {
            type: 'string',
            maxLength: HOSTED_RUNTIME_GROUP_EMAIL_TEXT_MAX_LENGTH,
          },
          { type: 'null' },
        ],
        default: null,
        description: 'Optional plain-text equivalent for send_email.',
      },
      standaloneLink: {
        type: 'boolean',
        description:
          'For action="offer_access" only. Set true only when the room explicitly asks for a standalone link; otherwise omit it and let the trusted host choose the best presentation for this channel.',
      },
      message_ref: ASSISTANT_ACCEPTED_MESSAGE_REF_SCHEMA,
      confidence: {
        type: 'string',
        enum: ['high', 'medium'],
        description:
          'For Journal facts: high is clear; medium needs one private question. Do not call for low confidence.',
      },
      date: {
        type: 'string',
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description:
          'Required for record_current_sender_daily_metric and record_current_sender_journal_fact. Exact member-reported civil date in YYYY-MM-DD form. Do not infer a date when the sender did not provide enough context.',
      },
      factIndex: {
        type: 'integer',
        minimum: 1,
        maximum: 8,
        description:
          'Journal fact order in the selected message, starting at 1.',
      },
      title: {
        type: 'string',
        minLength: 1,
        maxLength: HOSTED_EXECUTION_GROUP_JOURNAL_FACT_MAX_TITLE_LENGTH,
        description:
          'Short private Journal title in the sender language.',
      },
      note: {
        type: 'string',
        minLength: 1,
        maxLength: HOSTED_EXECUTION_GROUP_JOURNAL_FACT_MAX_NOTE_LENGTH,
        description:
          'Current-sender fact only. Exclude group commentary, quotes, jokes, and third-party claims.',
      },
      noteType: {
        type: 'string',
        enum: HOSTED_EXECUTION_GROUP_JOURNAL_FACT_NOTE_TYPES,
        description:
          'Canonical Journal note type for this fact.',
      },
      privateQuestion: {
        type: 'string',
        minLength: 1,
        maxLength: HOSTED_EXECUTION_ASSISTANT_ASK_QUESTION_MAX_CODE_POINTS,
        description:
          `The question the host sends the sender privately. With confidence high, ask for consent to save and name every clear fact; pass the same question with each fact, and the host sends it once. With confidence medium, ask only what is needed to clarify the fact.`,
      },
      enabled: {
        type: 'boolean',
        description:
          `For set_journal_capture: true turns Journal capture on for the member and false turns it off everywhere. After turning it on, save every fact the member named. set_current_sender_journal_capture also takes scope.`,
      },
      scope: {
        type: 'string',
        enum: ['global', 'group'],
        description:
          'Use group for this group, or global only when the sender says all groups.',
      },
      metric: {
        type: 'string',
        enum: HOSTED_EXECUTION_MEMBER_REPORTED_DAILY_METRIC_KEYS,
        description:
          'Required only for record_current_sender_daily_metric. Canonical daily metric slug already represented by the relevant group projection, such as steps.',
      },
      value: {
        type: 'number',
        description:
          'Required only for record_current_sender_daily_metric. Exact numeric value explicitly supplied by the current sender or clearly legible in their supplied evidence.',
      },
      unit: {
        type: 'string',
        minLength: 1,
        maxLength: 80,
        pattern: '^[A-Za-z0-9._/%-]+$',
        description:
          'Required only for record_current_sender_daily_metric. Canonical compact unit for the metric, such as count for steps.',
      },
} as const

type MurphGroupToolPropertyName = keyof typeof MURPH_GROUP_TOOL_PROPERTIES

const MURPH_GROUP_TOOL_FAMILY_PROPERTIES = {
  group_consult: [
    'context', 'grantId', 'membershipId', 'message_ref', 'question',
  ],
  group_data: [
    'audience', 'confidence', 'date', 'displayName', 'factIndex', 'freshness', 'grantId',
    'message_ref', 'metric', 'note', 'noteType', 'permissionText',
    'history', 'participantId', 'privateQuestion', 'projectionScopes', 'standaloneLink', 'title', 'unit',
    'value',
  ],
  group_membership: [
    'cursor', 'disclosureGrantCursor', 'enabled', 'membershipId', 'message_ref',
    'scope', 'setup',
  ],
  group_usage: ['message_ref', 'policyCode', 'policyCodes'],
  group_chat: [
    'alt', 'avatarPrompt', 'avatarSource', 'displayName', 'imageRef',
    'outputFormat', 'prompt', 'quality', 'referenceImageRefs', 'size',
  ],
  group_email: ['html', 'subject', 'text'],
} as const satisfies Record<
  keyof typeof MURPH_GROUP_TOOL_FAMILY_ACTIONS,
  readonly MurphGroupToolPropertyName[]
>

type MurphGroupConsultAction =
  (typeof MURPH_GROUP_TOOL_FAMILY_ACTIONS.group_consult)[number]

const MURPH_GROUP_CONSULT_ACTION_PROPERTIES = {
  ask: {
    optional: [],
    required: ['membershipId', 'question'],
  },
  handoff: {
    optional: [],
    required: ['context', 'membershipId'],
  },
  ask_current_sender: {
    optional: [],
    required: ['message_ref'],
  },
  ask_current_sender_privately: {
    optional: [],
    required: ['message_ref'],
  },
  clarify_current_sender: {
    optional: [],
    required: ['message_ref'],
  },
  continue_current_sender_in_group: {
    optional: [],
    required: ['message_ref'],
  },
  continue_current_sender_privately: {
    optional: [],
    required: ['message_ref'],
  },
  ask_member: {
    optional: [],
    required: ['grantId', 'question'],
  },
} as const satisfies Record<
  MurphGroupConsultAction,
  {
    optional: readonly MurphGroupToolPropertyName[]
    required: readonly MurphGroupToolPropertyName[]
  }
>

function buildMurphGroupConsultInputSchema() {
  return {
    oneOf: MURPH_GROUP_TOOL_FAMILY_ACTIONS.group_consult.map((action) => {
      const actionProperties = MURPH_GROUP_CONSULT_ACTION_PROPERTIES[action]
      const propertyNames: readonly MurphGroupToolPropertyName[] = [
        ...actionProperties.required,
        ...actionProperties.optional,
      ]
      return {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', enum: [action] },
          ...Object.fromEntries(propertyNames.map((propertyName) => [
            propertyName,
            MURPH_GROUP_TOOL_PROPERTIES[propertyName],
          ])),
        },
        required: ['action', ...actionProperties.required],
      }
    }),
  } as const
}

function buildMurphGroupFamilyInputSchema<
  const Name extends keyof typeof MURPH_GROUP_TOOL_FAMILY_ACTIONS,
>(name: Name) {
  const actions = MURPH_GROUP_TOOL_FAMILY_ACTIONS[name]
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      action: { type: 'string', enum: actions },
      ...Object.fromEntries(MURPH_GROUP_TOOL_FAMILY_PROPERTIES[name].map(
        (propertyName) => [
          propertyName,
          MURPH_GROUP_TOOL_PROPERTIES[propertyName],
        ],
      )),
    },
    required: ['action'],
  } as const
}

function buildMurphGroupFamilyTool<
  const Name extends keyof typeof MURPH_GROUP_TOOL_FAMILY_ACTIONS,
>(input: {
  description: string
  name: Name
}) {
  return {
    namespace: 'murph',
    name: input.name,
    deferLoading: true,
    description: input.description,
    inputSchema: buildMurphGroupFamilyInputSchema(input.name),
  } as const
}

export const MURPH_GROUP_CONSULT_TOOL = {
  namespace: 'murph',
  name: 'group_consult',
  deferLoading: true,
  description:
    `Pass a question or a message between a member's private Murph and a group. From a private conversation: ask gets an answer from a group the member has joined, and handoff gives that group facts to tell, post, or share. Both need the exact ID of that membership, found only after exhausting list_memberships pages, and you never show IDs to the member. From a group: ask_current_sender has the sender's private Murph answer in the group, ask_current_sender_privately has it answer them privately, and clarify_current_sender is for when they have not said where the answer should go. After they answer that one question, use continue_current_sender_in_group or continue_current_sender_privately. ask_member asks one member's private Murph under a disclosure grant. Write handoff context without naming the member; the host adds attribution. A result of accepted means queued and pending. It is never proof that anything was sent or shared.`,
  inputSchema: buildMurphGroupConsultInputSchema(),
} as const

export const MURPH_GROUP_DATA_TOOL = buildMurphGroupFamilyTool({
  name: 'group_data',
  description:
    `Shared health data and sharing permissions for this group. read_shared reads what members have shared. offer_access shows the consent prompt. record_current_sender_daily_metric and record_current_sender_journal_fact save something the sender reported. post_disclosure_request and revoke_disclosure_grant manage what a member's private Murph may tell this group. revoke_own_email_share stops the sender's email sharing. In a read_shared result, companionLastContactAt is only when a member's app last made contact, possibly in the background. Its age says nothing about whether the app is closed, Health permission was denied, a sync worked, or why steps are missing. When it is absent, say nothing about the app.`,
})

const MURPH_GROUP_DATA_EAGER_TOOL = {
  ...MURPH_GROUP_DATA_TOOL,
  deferLoading: false,
} as const

export const MURPH_GROUP_MEMBERSHIP_TOOL = buildMurphGroupFamilyTool({
  name: 'group_membership',
  description:
    `Read or change group membership, Journal capture, and setup for the member's next group. read_current and list_memberships read. leave_membership leaves a group. prepare_next_group, read_next_group, and cancel_next_group manage setup for a group the member is about to start. set_journal_capture and set_current_sender_journal_capture turn Journal capture on or off. When a member answers the private Journal consent question, call set_journal_capture first and then save every fact they named.`,
})

export const MURPH_GROUP_USAGE_TOOL = buildMurphGroupFamilyTool({
  name: 'group_usage',
  description:
    `Read this group's AI usage and referral offers, or change a referral choice. read_usage and read_usage_referral read. arm_usage_referral turns on the referral options the sender chose, cancel_usage_referral turns one off, and create_signup_referral_link makes a sign-up link.`,
})

export const MURPH_GROUP_CHAT_TOOL = buildMurphGroupFamilyTool({
  name: 'group_chat',
  description:
    `Read or change the chat itself. read_chat_name and read_chat_participants read. update_display_name renames the chat, set_chat_avatar sets its picture, and share_contact_card sends Murph's contact card.`,
})

export const MURPH_GROUP_EMAIL_TOOL = buildMurphGroupFamilyTool({
  name: 'group_email',
  description:
    `Queue one email to the members of this group who share an email address. Call it only after a group_data read_shared with audience group_email in the same scheduled run. A result of accepted means queued. It does not mean delivered.`,
})

export const MURPH_GROUP_FAMILY_TOOLS = [
  MURPH_GROUP_CONSULT_TOOL,
  MURPH_GROUP_DATA_TOOL,
  MURPH_GROUP_MEMBERSHIP_TOOL,
  MURPH_GROUP_USAGE_TOOL,
  MURPH_GROUP_CHAT_TOOL,
  MURPH_GROUP_EMAIL_TOOL,
] as const

export const MURPH_GROUP_TOOL_ROOT_KEYS_BY_NAME = {
  group: ['action', ...Object.keys(MURPH_GROUP_TOOL_PROPERTIES)],
  group_consult: [
    'action',
    ...MURPH_GROUP_TOOL_FAMILY_PROPERTIES.group_consult,
  ],
  group_data: Object.keys(MURPH_GROUP_DATA_TOOL.inputSchema.properties),
  group_membership: Object.keys(MURPH_GROUP_MEMBERSHIP_TOOL.inputSchema.properties),
  group_usage: Object.keys(MURPH_GROUP_USAGE_TOOL.inputSchema.properties),
  group_chat: Object.keys(MURPH_GROUP_CHAT_TOOL.inputSchema.properties),
  group_email: Object.keys(MURPH_GROUP_EMAIL_TOOL.inputSchema.properties),
} satisfies Record<
  typeof MURPH_GROUP_TOOL_NAME
    | (typeof MURPH_GROUP_FAMILY_TOOLS)[number]['name'],
  readonly string[]
>

export const MURPH_SEND_VAULT_FILE_TOOL = {
  namespace: 'murph',
  name: 'send_vault_file',
  description:
    `Send one file to the current private conversation. Read $MURPH_ASSISTANT_SKILLS_ROOT/file-send/SKILL.md before calling it. The skill owns which ref to pass, files and ZIPs made for a request, full-workspace exports, and what to say for each result. For a full-workspace export, ${VAULT_MEDIA_EXPORT_GUIDANCE} Every send needs the member's approval, bound to this file and this conversation. When the result says approval is pending, the runtime adds the approval link to your reply, so never write one yourself. When it says approved, the runtime delivers the file: send no text about it and call finish_without_reply. The tool never shows you the file's contents and cannot send to anyone else.`,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ref: {
        type: 'string',
        minLength: 1,
        maxLength: 1024,
        description:
          `Vault-relative path such as documents/report.pdf, or ${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/<flat-filename> for a file made for this send. Other hidden paths, absolute paths, traversal, and unsupported file types are rejected.`,
      },
      retire_export_pack_ids: {
        type: 'array',
        minItems: 1,
        maxItems: 20,
        items: {
          type: 'string',
          pattern: '^[A-Za-z0-9_-]+$',
        },
        description:
          `Only for a ZIP you generated that contains derived exports/packs/<packId> directories: exactly the pack ids included in that ZIP. The runtime retires those packs after the file is delivered. Leave it out for every other file.`,
      },
    },
    required: ['ref'],
  },
} as const

export const MURPH_FINISH_WITHOUT_REPLY_TOOL = {
  namespace: 'murph',
  name: 'finish_without_reply',
  description:
    `End the turn without sending text. Use it when the response is already complete without text: a reaction that says everything, a file the runtime is delivering, a consent prompt the host posted, or a message that needs no answer. After attaching a card, end the turn with no text and do not call this tool. Anything already sent in this turn stays sent.`,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {},
  },
} as const

export const MURPH_SELECT_REPLY_TARGET_TOOL = {
  namespace: 'murph',
  name: 'select_reply_target',
  description:
    `Make the final reply a threaded reply to one accepted message. Use it only when it would otherwise be unclear which message the reply answers. It sends nothing and does not end the turn.`,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      message_ref: ASSISTANT_MESSAGE_TARGET_REF_SCHEMA,
    },
    required: ['message_ref'],
  },
} as const

export const MURPH_REACT_TO_MESSAGE_TOOL = {
  namespace: 'murph',
  name: 'react_to_message',
  description:
    `Add a reaction to one accepted message. It sends no text and does not end the turn.`,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      message_ref: ASSISTANT_MESSAGE_TARGET_REF_SCHEMA,
      reaction: {
        type: 'string',
        enum: ['heart', 'thumbs_up', 'laugh'],
      },
    },
    required: ['message_ref', 'reaction'],
  },
} as const

export const MURPH_COMPUTER_OPEN_TOOL = {
  namespace: 'murph',
  name: 'computer_open',
  description:
    `Open the browser for an authorized computer run, or reopen the current run. Call it first, again after a handoff to the member, and whenever the outcome of the last action is uncertain. It returns the runId, URL, title, and page text. Reopening does not tell you whether the last action took effect. The other computer tools (computer_act, computer_os_control, computer_pause_for_user, computer_finish_run) load only when you search for them by name.`,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      startUrl: {
        anyOf: [{ type: 'string' }, { type: 'null' }],
        default: null,
      },
    },
  },
} as const

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

type JsonSchemaObject = Record<string, unknown>

const MURPH_COMPUTER_ACT_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    runId: { type: 'string', minLength: 1 },
    code: {
      type: 'string',
      minLength: 1,
      maxLength: HOSTED_COMPUTER_ACT_CODE_MAX_LENGTH,
      description:
        'One complete Playwright macro-step using the in-scope page, context, and browser objects. Return only compact JSON-serializable state needed for the next decision.',
    },
    timeoutMs: {
      type: 'integer',
      minimum: 1000,
      maximum: HOSTED_COMPUTER_ACT_TIMEOUT_MAX_MS,
      default: 15000,
    },
  },
  required: ['runId', 'code'],
} as const

const MURPH_COMPUTER_OS_CONTROL_INPUT_SCHEMA = buildComputerOsControlInputSchema()

function buildComputerOsControlInputSchema(): JsonSchemaObject {
  const generated = z.toJSONSchema(hostedComputerOsControlRequestSchema, { io: 'input' }) as JsonSchemaObject
  const actionSchemas = Array.isArray(generated.oneOf) ? generated.oneOf : []

  return {
    oneOf: actionSchemas.map(addRunIdToActionSchema),
    type: 'object',
  }
}

function addRunIdToActionSchema(schema: unknown): JsonSchemaObject {
  const record = asRecord(schema) ?? {}
  const properties = asRecord(record.properties) ?? {}
  const required = Array.isArray(record.required)
    ? record.required.filter((item): item is string => typeof item === 'string')
    : []

  return {
    ...record,
    properties: {
      runId: { type: 'string', minLength: 1 },
      ...properties,
    },
    required: ['runId', ...required],
  }
}

export const MURPH_COMPUTER_ACT_TOOL = {
  namespace: 'murph',
  deferLoading: true,
  name: 'computer_act',
  description:
    `Run one bounded Playwright step in the current authorized run and return the resulting state. The computer-use skill says which details you may enter and when the final step needs the member's yes. Never invent data, type a password, one-time code, or full card number, get past a CAPTCHA, or retry an action whose effect is unknown. After a failure, call computer_open before anything else.`,
  inputSchema: MURPH_COMPUTER_ACT_INPUT_SCHEMA,
} as const

export const MURPH_COMPUTER_OS_CONTROL_TOOL = {
  namespace: 'murph',
  deferLoading: true,
  name: 'computer_os_control',
  description:
    `Fallback for the current authorized run: one mouse or keyboard action, for a control Playwright cannot operate. Never type credentials, one-time codes, payment details, or other sensitive data. After any action that may have taken effect, and after any failure, call computer_open before a retry or the next action.`,
  inputSchema: MURPH_COMPUTER_OS_CONTROL_INPUT_SCHEMA,
} as const

export const MURPH_COMPUTER_PAUSE_FOR_USER_TOOL = {
  namespace: 'murph',
  deferLoading: true,
  name: 'computer_pause_for_user',
  description:
    'Pause the current authorized run, persist a checkpoint, and optionally return a secure handoffUrl. Call only when missing user input, takeover, inspection, or final confirmation is required. This does not message the user, and a returned URL does not prove handoff completion.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      handoffPurpose: {
        anyOf: [
          {
            type: 'string',
            enum: [
              'managed_login',
              'login',
              'payment',
              'card',
              'captcha',
              'manual_browser_help',
            ],
          },
          { type: 'null' },
        ],
        default: null,
      },
      reason: {
        type: 'string',
        enum: ['login_needed', 'payment_needed', 'final_confirmation', 'stuck', 'other'],
      },
      runId: { type: 'string', minLength: 1 },
      suggestedReply: {
        anyOf: [{ type: 'string', minLength: 1, maxLength: 200 }, { type: 'null' }],
        default: null,
      },
    },
    required: ['runId', 'reason'],
  },
} as const

export const MURPH_COMPUTER_FINISH_RUN_TOOL = {
  namespace: 'murph',
  deferLoading: true,
  name: 'computer_finish_run',
  description:
    'Finish the current authorized computer run with the stated outcome and close its browser. On success, do not reuse the runId.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      outcome: { type: 'string', enum: ['completed', 'failed', 'canceled'] },
      runId: { type: 'string', minLength: 1 },
    },
    required: ['runId', 'outcome'],
  },
} as const

const MURPH_BASE_DYNAMIC_TOOLS = [
  MURPH_SEND_PROGRESS_UPDATE_TOOL,
  MURPH_AUTOMATION_TOOL,
  MURPH_AUTOMATION_INSPECT_TOOL,
  MURPH_DEVICE_TOOL,
  MURPH_ASSISTANT_STYLE_TOOL,
  MURPH_ATTACH_RESPONSE_MEDIA_TOOL,
  MURPH_ATTACH_RESPONSE_CARD_TOOL,
  MURPH_ATTACH_SLEEP_CARD_TOOL,
  MURPH_ATTACH_EXERCISE_ROUTINE_CARD_TOOL,
  MURPH_ATTACH_TELEGRAM_RICH_CONTENT_TOOL,
  MURPH_GENERATE_IMAGE_TOOL,
  MURPH_GENERATE_VOICE_MEMO_TOOL,
  MURPH_ASSISTANT_CONFIGURATION_TOOL,
  MURPH_PERSONALIZATION_TOOL,
  MURPH_FAMILY_PLAN_TOOL,
  MURPH_PLAN_USAGE_TOOL,
  MURPH_USAGE_DIAGNOSTICS_TOOL,
  MURPH_POLL_TOOL,
  MURPH_READ_GAME_TOOL,
  MURPH_LEAVE_GROUP_TOOL,
  MURPH_MY_GAME_REMINDERS_TOOL,
  MURPH_UPDATE_GAME_TOOL,
  MURPH_GAME_PHOTO_TOOL,
  MURPH_GAME_LORE_TOOL,
  MURPH_IMESSAGE_CONTACT_TOOL,
  MURPH_SUBSCRIPTION_TOOL,
  ...MURPH_GROUP_FAMILY_TOOLS,
  MURPH_GROUP_ROOM_MODEL_TOOL,
  MURPH_GENERATE_SONG_TOOL,
  MURPH_ANALYZE_VIDEO_TOOL,
  MURPH_CONVERSATION_ATTACHMENTS_TOOL,
  MURPH_CREATE_CALENDAR_LINK_TOOL,
  MURPH_ASK_GROK_TOOL,
  MURPH_SUBMIT_PRODUCT_FEEDBACK_TOOL,
  MURPH_SEND_VAULT_FILE_TOOL,
  MURPH_MATERIALIZE_VAULT_MEDIA_TOOL,
  MURPH_PENDING_VAULT_FILES_TOOL,
  MURPH_FINISH_WITHOUT_REPLY_TOOL,
  MURPH_SELECT_REPLY_TARGET_TOOL,
  MURPH_REACT_TO_MESSAGE_TOOL,
  MURPH_CREATE_CLINICAL_RECORDS_CONNECT_LINK_TOOL,
  MURPH_GET_SENDER_CONTACT_TOOL,
  MURPH_CREATE_PHONE_CALL_TOOL,
  MURPH_GET_PHONE_CALL_STATUS_TOOL,
  MURPH_STOP_PHONE_CALL_TOOL,
  MURPH_RESOLVE_PHYSICAL_NOTE_TOOL,
  MURPH_SEND_PHYSICAL_NOTE_TOOL,
  MURPH_LABS_TOOL,
] as const

const MURPH_COMPUTER_DYNAMIC_TOOLS = [
  MURPH_COMPUTER_OPEN_TOOL,
  MURPH_COMPUTER_ACT_TOOL,
  MURPH_COMPUTER_OS_CONTROL_TOOL,
  MURPH_COMPUTER_PAUSE_FOR_USER_TOOL,
  MURPH_COMPUTER_FINISH_RUN_TOOL,
] as const

export const MURPH_DYNAMIC_TOOLS = [
  ...MURPH_BASE_DYNAMIC_TOOLS,
  ...MURPH_COMPUTER_DYNAMIC_TOOLS,
  ...MURPH_CONNECTED_APPS_DYNAMIC_TOOLS,
] as const

export type MurphDynamicTool =
  | typeof MURPH_LEAVE_GROUP_TOOL
  | (typeof MURPH_DYNAMIC_TOOLS)[number]
  | typeof MURPH_EXPRESSIVE_VOICE_MEMO_TOOL
  | typeof MURPH_GROUP_DATA_EAGER_TOOL
  | typeof MURPH_ATTACH_FOLLOW_UP_TOOL
  | typeof MURPH_MEMBER_MEMORY_TOOL
  | typeof MURPH_READ_GAME_RECAP_TOOL
  | typeof MURPH_WRITE_RECAP_TOOL
  | typeof MURPH_WRITE_RECAP_FILE_TOOL
  | typeof MURPH_GROUP_ASSISTANT_CONFIGURATION_TOOL
  | typeof MURPH_GROUP_CHALLENGE_RESPONSE_CARD_TOOL
  | typeof MURPH_GROUP_SEND_PROGRESS_UPDATE_TOOL
  | typeof MURPH_GROUP_SHARED_READ_TOOL
  | typeof MURPH_GROUP_SHARED_READ_PERMISSION_OFFER_TOOL

export interface MurphDynamicToolAvailability {
  assistantStyleSettingsAvailable?: boolean | null
  assistantConfigurationAvailable?: boolean | null
  allowFinishWithoutReply?: boolean | null
  automationAvailable?: boolean | null
  followUpAttachmentAvailable?: boolean | null
  computerToolsAvailable?: boolean | null
  progressUpdatesAvailable?: boolean | null
  connectedAppsAvailable?: boolean | null
  connectedAppsManageAvailable?: boolean | null
  deviceAvailable?: boolean | null
  clinicalRecordsConnectLinkAvailable?: boolean | null
  familyPlanAvailable?: boolean | null
  labsAvailable?: boolean | null
  planUsageAvailable?: boolean | null
  usageDiagnosticsAvailable?: boolean | null
  pollsAvailable?: boolean | null
  gameReadAvailable?: boolean | null
  leaveGroupAvailable?: boolean | null
  myGameRemindersAvailable?: boolean | null
  gamesAvailable?: boolean | null
  gamePhotosAvailable?: boolean | null
  gameLoreAvailable?: boolean | null
  imessageContactAvailable?: boolean | null
  imageGenerationAvailable?: boolean | null
  subscriptionAvailable?: boolean | null
  groupAvailable?: boolean | null
  groupAssistantConfigurationAvailable?: boolean | null
  groupRoomModelAvailable?: boolean | null
  groupPermissionOfferAvailable?: boolean | null
  groupSharedReadAvailable?: boolean | null
  messageTargetingAvailable?: boolean | null
  personalizationAvailable?: boolean | null
  productFeedbackAvailable?: boolean | null
  responseCardsAvailable?: boolean | null
  telegramPresentationResponseCardsAvailable?: boolean | null
  groupChallengeResponseCardsAvailable?: boolean | null
  progressUpdateMode?: 'direct' | 'group'
  physicalNotesAvailable?: boolean | null
  physicalNoteRecoveryAvailable?: boolean | null
  senderContactAvailable?: boolean | null
  phoneCallsAvailable?: boolean | null
  phoneCallStatusAvailable?: boolean | null
  phoneCallStopAvailable?: boolean | null
  voiceMemoGenerationAvailable?: boolean | null
  voiceMemoModelId?: string | null
  pendingVaultFilesAvailable?: boolean | null
  vaultFileSendAvailable?: boolean | null
  conversationAttachmentsAvailable?: boolean | null
  analyzeVideoAvailable?: boolean | null
  calendarLinkAvailable?: boolean | null
  askGrokAvailable?: boolean | null
}

type AvailabilityPredicate = (
  availability: MurphDynamicToolAvailability,
) => boolean

const ALWAYS_AVAILABLE: AvailabilityPredicate = () => true

// Two default semantics, kept explicit so each tool's gate is obvious:
//   defaultOn  → the tool is available unless the caller passes `false`.
//   defaultOff → the tool is available only if the caller passes `true`.
const defaultOn = (
  read: (a: MurphDynamicToolAvailability) => boolean | null | undefined,
): AvailabilityPredicate => (a) => read(a) !== false
const defaultOff = (
  read: (a: MurphDynamicToolAvailability) => boolean | null | undefined,
): AvailabilityPredicate => (a) => read(a) === true

const TOOL_AVAILABILITY: ReadonlyMap<MurphDynamicTool, AvailabilityPredicate> =
  new Map<MurphDynamicTool, AvailabilityPredicate>([
    [MURPH_SEND_PROGRESS_UPDATE_TOOL, defaultOn((a) => a.progressUpdatesAvailable)],
    [MURPH_AUTOMATION_TOOL, defaultOff((a) => a.automationAvailable)],
    [MURPH_AUTOMATION_INSPECT_TOOL, defaultOff((a) => a.automationAvailable)],
    [MURPH_DEVICE_TOOL, defaultOff((a) => a.deviceAvailable)],
    [MURPH_ASSISTANT_STYLE_TOOL, defaultOff((a) => a.assistantStyleSettingsAvailable)],
    [MURPH_ATTACH_RESPONSE_CARD_TOOL, defaultOff((a) => a.responseCardsAvailable)],
    [MURPH_ATTACH_SLEEP_CARD_TOOL, defaultOff((a) => a.responseCardsAvailable)],
    [MURPH_ATTACH_EXERCISE_ROUTINE_CARD_TOOL, defaultOff((a) =>
      a.telegramPresentationResponseCardsAvailable)],
    [MURPH_ATTACH_TELEGRAM_RICH_CONTENT_TOOL, defaultOff((a) =>
      a.telegramPresentationResponseCardsAvailable)],
    [MURPH_FINISH_WITHOUT_REPLY_TOOL, defaultOn((a) => a.allowFinishWithoutReply)],
    [MURPH_SELECT_REPLY_TARGET_TOOL, defaultOff((a) => a.messageTargetingAvailable)],
    [MURPH_REACT_TO_MESSAGE_TOOL, defaultOff((a) => a.messageTargetingAvailable)],
    [MURPH_SUBMIT_PRODUCT_FEEDBACK_TOOL, defaultOff((a) => a.productFeedbackAvailable)],
    [MURPH_ASSISTANT_CONFIGURATION_TOOL, defaultOff((a) => a.assistantConfigurationAvailable)],
    [MURPH_FAMILY_PLAN_TOOL, defaultOff((a) => a.familyPlanAvailable)],
    [MURPH_LABS_TOOL, defaultOff((a) => a.labsAvailable)],
    [MURPH_PLAN_USAGE_TOOL, defaultOff((a) => a.planUsageAvailable)],
    [MURPH_USAGE_DIAGNOSTICS_TOOL, defaultOff((a) => a.usageDiagnosticsAvailable)],
    [MURPH_POLL_TOOL, defaultOff((a) => a.pollsAvailable)],
    [MURPH_READ_GAME_TOOL, defaultOff((a) => a.gameReadAvailable)],
    [MURPH_LEAVE_GROUP_TOOL, defaultOff((a) => a.leaveGroupAvailable)],
    [MURPH_MY_GAME_REMINDERS_TOOL, defaultOff((a) => a.myGameRemindersAvailable)],
    [MURPH_UPDATE_GAME_TOOL, defaultOff((a) => a.gamesAvailable)],
    [MURPH_GAME_PHOTO_TOOL, defaultOff((a) => a.gamePhotosAvailable)],
    [MURPH_GAME_LORE_TOOL, defaultOff((a) => a.gameLoreAvailable)],
    [MURPH_IMESSAGE_CONTACT_TOOL, defaultOff((a) => a.imessageContactAvailable)],
    [MURPH_SUBSCRIPTION_TOOL, defaultOff((a) => a.subscriptionAvailable)],
    ...MURPH_GROUP_FAMILY_TOOLS.map(
      (tool) => [tool, defaultOff((a) => a.groupAvailable)] as const,
    ),
    [MURPH_GROUP_ROOM_MODEL_TOOL, defaultOff((a) => a.groupRoomModelAvailable)],
    [MURPH_PERSONALIZATION_TOOL, defaultOff((a) => a.personalizationAvailable)],
    [MURPH_GENERATE_VOICE_MEMO_TOOL, defaultOff((a) => a.voiceMemoGenerationAvailable)],
    [MURPH_GENERATE_SONG_TOOL, defaultOff((a) => a.voiceMemoGenerationAvailable)],
    [MURPH_GENERATE_IMAGE_TOOL, defaultOn((a) => a.imageGenerationAvailable)],
    [MURPH_CONVERSATION_ATTACHMENTS_TOOL, defaultOff((a) => a.conversationAttachmentsAvailable)],
    [MURPH_ANALYZE_VIDEO_TOOL, defaultOff((a) => a.analyzeVideoAvailable)],
    [MURPH_CREATE_CALENDAR_LINK_TOOL, defaultOff((a) => a.calendarLinkAvailable)],
    [MURPH_ASK_GROK_TOOL, defaultOff((a) => a.askGrokAvailable)],
    [MURPH_SEND_VAULT_FILE_TOOL, defaultOff((a) => a.vaultFileSendAvailable)],
    [MURPH_MATERIALIZE_VAULT_MEDIA_TOOL, defaultOff((a) => a.vaultFileSendAvailable)],
    [MURPH_PENDING_VAULT_FILES_TOOL, defaultOff((a) => a.pendingVaultFilesAvailable)],
    [MURPH_GET_SENDER_CONTACT_TOOL, defaultOff((a) => a.senderContactAvailable)],
    [MURPH_CREATE_PHONE_CALL_TOOL, defaultOff((a) => a.phoneCallsAvailable)],
    [MURPH_GET_PHONE_CALL_STATUS_TOOL, defaultOff((a) =>
      a.phoneCallStatusAvailable)],
    [MURPH_STOP_PHONE_CALL_TOOL, defaultOff((a) => a.phoneCallStopAvailable)],
    [MURPH_RESOLVE_PHYSICAL_NOTE_TOOL, defaultOff((a) =>
      a.physicalNoteRecoveryAvailable)],
    [MURPH_SEND_PHYSICAL_NOTE_TOOL, defaultOff((a) => a.physicalNotesAvailable)],
    ...MURPH_COMPUTER_DYNAMIC_TOOLS.map(
      (tool) =>
        [tool, defaultOff((a) => a.computerToolsAvailable)] as const,
    ),
    [MURPH_CONNECTED_APPS_MANAGE_TOOL, defaultOff((a) =>
      a.connectedAppsAvailable && a.connectedAppsManageAvailable !== false)],
    [MURPH_CONNECTED_APPS_SEARCH_TOOL, defaultOff((a) => a.connectedAppsAvailable)],
    [MURPH_CONNECTED_APPS_EXECUTE_TOOL, defaultOff((a) => a.connectedAppsAvailable)],
    [MURPH_CREATE_CLINICAL_RECORDS_CONNECT_LINK_TOOL, defaultOff((a) =>
      a.clinicalRecordsConnectLinkAvailable)],
  ])

export function resolveMurphDynamicTools(
  availability: MurphDynamicToolAvailability,
): readonly MurphDynamicTool[] {
  const tools: MurphDynamicTool[] = MURPH_DYNAMIC_TOOLS.filter((tool) =>
    (TOOL_AVAILABILITY.get(tool) ?? ALWAYS_AVAILABLE)(availability),
  )
  if (availability.voiceMemoModelId === 'eleven_v4') {
    const voiceToolIndex = tools.indexOf(MURPH_GENERATE_VOICE_MEMO_TOOL)
    if (voiceToolIndex >= 0) {
      tools[voiceToolIndex] = MURPH_EXPRESSIVE_VOICE_MEMO_TOOL
    }
  }
  if (availability.automationAvailable !== true && availability.followUpAttachmentAvailable === true) {
    tools.push(MURPH_ATTACH_FOLLOW_UP_TOOL)
  }
  if (availability.groupChallengeResponseCardsAvailable === true) {
    const responseCardToolIndex = tools.indexOf(MURPH_ATTACH_RESPONSE_CARD_TOOL)
    if (responseCardToolIndex >= 0) {
      tools[responseCardToolIndex] = MURPH_GROUP_CHALLENGE_RESPONSE_CARD_TOOL
    } else {
      tools.push(MURPH_GROUP_CHALLENGE_RESPONSE_CARD_TOOL)
    }
  }
  if (availability.progressUpdateMode === 'group') {
    // Shared reads are routine in this audience; avoid a namespace discovery turn.
    const groupDataToolIndex = tools.indexOf(MURPH_GROUP_DATA_TOOL)
    if (groupDataToolIndex >= 0) {
      tools[groupDataToolIndex] = MURPH_GROUP_DATA_EAGER_TOOL
    }
    const progressToolIndex = tools.indexOf(MURPH_SEND_PROGRESS_UPDATE_TOOL)
    if (progressToolIndex >= 0) {
      tools[progressToolIndex] = MURPH_GROUP_SEND_PROGRESS_UPDATE_TOOL
    }
  }
  if (
    availability.assistantConfigurationAvailable !== true &&
    availability.groupAssistantConfigurationAvailable === true
  ) {
    tools.push(MURPH_GROUP_ASSISTANT_CONFIGURATION_TOOL)
  }
  if (
    availability.groupAvailable !== true &&
    availability.groupSharedReadAvailable === true
  ) {
    tools.push(
      availability.groupPermissionOfferAvailable === true
        ? MURPH_GROUP_SHARED_READ_PERMISSION_OFFER_TOOL
        : MURPH_GROUP_SHARED_READ_TOOL,
    )
  }
  return tools
}

export function listMurphDynamicToolNames(): string[] {
  return MURPH_DYNAMIC_TOOLS.map((tool) => `${tool.namespace}.${tool.name}`)
}
