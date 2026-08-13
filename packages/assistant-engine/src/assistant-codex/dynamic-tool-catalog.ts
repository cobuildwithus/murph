import * as z from '@murphai/contracts/zod-runtime'
import {
  assistantBasePersonaIdValues,
  assistantBasePersonaOptions,
  assistantPersonaIdValues,
  assistantTonePreferenceValues,
  assistantVoiceOptionIdValues,
  assistantVoiceOptions,
} from '@murphai/contracts'
import {
  HOSTED_EXECUTION_ASSISTANT_ASK_QUESTION_MAX_CODE_POINTS,
  HOSTED_EXECUTION_ASSISTANT_ASK_TARGET_LABEL_MAX_CODE_POINTS,
} from '@murphai/hosted-execution/contracts'
import {
  HOSTED_RUNTIME_PENDING_GROUP_SETUP_ROOM_CONTEXT_MAX_CODE_POINTS,
} from '@murphai/hosted-execution/pending-group-setup'
import {
  HOSTED_FAMILY_PLAN_CODES,
  HOSTED_PRODUCT_FEEDBACK_KINDS,
  HOSTED_PRODUCT_FEEDBACK_SUMMARY_MAX_LENGTH,
  HOSTED_RUNTIME_ASSISTANT_ASK_REQUEST_ID_MAX_CODE_POINTS,
  HOSTED_RUNTIME_GROUP_DISCLOSURE_PERMISSION_TEXT_MAX_CODE_POINTS,
  HOSTED_RUNTIME_GROUP_DISPLAY_NAME_MAX_LENGTH,
  HOSTED_RUNTIME_GROUP_EMAIL_HTML_MAX_LENGTH,
  HOSTED_RUNTIME_GROUP_EMAIL_SUBJECT_MAX_LENGTH,
  HOSTED_RUNTIME_GROUP_EMAIL_TEXT_MAX_LENGTH,
  HOSTED_USAGE_REFERRAL_POLICY_CODES,
} from '@murphai/hosted-execution/runtime-control'
import {
  HOSTED_ASSISTANT_PRODUCT_MODELS,
  HOSTED_ASSISTANT_PROVIDERS,
  HOSTED_ASSISTANT_REASONING_EFFORTS,
} from '@murphai/hosted-execution/assistant-model'
import { HOSTED_PLAN_USAGE_DIRECT_BILLING_PLAN_CODES } from '@murphai/hosted-execution/plan-usage'
import { ASSISTANT_AUTHORED_RESPONSE_MEDIA_MAX_ITEMS } from '../assistant/response-media.js'
import {
  HOSTED_VAULT_SHARE_ACTIVITY_DISTANCE_PROJECTION_KIND,
  HOSTED_VAULT_SHARE_ACTIVITY_DISTANCE_SELECTOR_ACTIVITY_KINDS,
  HOSTED_VAULT_SHARE_ACTIVITY_MINUTES_PROJECTION_KIND,
  HOSTED_VAULT_SHARE_ACTIVITY_MINUTES_SELECTOR_ACTIVITY_KINDS,
  HOSTED_VAULT_SHARE_ACTIVITY_SESSION_COUNT_PROJECTION_KIND,
  HOSTED_VAULT_SHARE_ACTIVITY_SESSION_COUNT_SELECTOR_ACTIVITY_KINDS,
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
} from './dynamic-tools/generate-voice-memo.js'
import {
  MURPH_CREATE_PHONE_CALL_TOOL,
} from './dynamic-tools/phone-calls.js'
import {
  MURPH_SEND_PHYSICAL_NOTE_TOOL,
} from './dynamic-tools/physical-notes.js'
import {
  MURPH_GENERATE_SONG_TOOL,
} from './dynamic-tools/generate-song.js'
import {
  MURPH_ASK_GROK_TOOL,
} from './dynamic-tools/ask-grok.js'
export { MURPH_ASSISTANT_STYLE_TOOL } from './dynamic-tools/assistant-style.js'
export type {
  AssistantStyleTurnSettingsOverlay,
} from './dynamic-tools/assistant-style.js'
export { MURPH_AUTOMATION_TOOL } from './dynamic-tools/automation.js'
export { MURPH_DEVICE_TOOL } from './dynamic-tools/device.js'
export { MURPH_LABS_TOOL } from './dynamic-tools/labs.js'
export {
  MURPH_PENDING_VAULT_FILES_TOOL,
} from './dynamic-tools/pending-vault-files.js'
export {
  MURPH_GROUP_ROOM_MODEL_TOOL,
} from './dynamic-tools/group-room-model.js'
export {
  MURPH_CREATE_CLINICAL_RECORDS_CONNECT_LINK_TOOL,
} from './dynamic-tools/clinical-records.js'
export { MURPH_SEND_PHYSICAL_NOTE_TOOL } from './dynamic-tools/physical-notes.js'
export { MURPH_ASK_GROK_TOOL } from './dynamic-tools/ask-grok.js'
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
    'Send a brief user-visible update to the current conversation before reply-critical work likely to keep the member waiting, then continue immediately. A successful call means this update was sent. This is not a final answer.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      text: {
        type: 'string',
        minLength: 1,
        description:
          'One short natural sentence orienting the member to the work and immediate next step; no final conclusions or unverified result claims.',
      },
    },
    required: ['text'],
  },
} as const

const MURPH_GROUP_SEND_PROGRESS_UPDATE_TOOL = {
  ...MURPH_SEND_PROGRESS_UPDATE_TOOL,
  description:
    'Send at most one brief user-visible progress update to the current group. Call only before a real reply-critical wait, then continue work immediately. Success means the update was sent; do not repeat or use it as a final answer.',
} as const

export const MURPH_ATTACH_RESPONSE_MEDIA_TOOL = {
  namespace: 'murph',
  name: 'attach_response_media',
  description:
    `Attach up to ${ASSISTANT_AUTHORED_RESPONSE_MEDIA_MAX_ITEMS} images to the current final assistant response. Accept intentionally public catalog image URLs or an exact vault_image descriptor returned by a trusted Murph command. Never invent or modify a private descriptor. Replaces the current response media batch for this turn only. It does not send directly.`,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      media: {
        type: 'array',
        maxItems: ASSISTANT_AUTHORED_RESPONSE_MEDIA_MAX_ITEMS,
        description:
          `The complete image batch for the final assistant reply, limited to ${ASSISTANT_AUTHORED_RESPONSE_MEDIA_MAX_ITEMS} images. Passing an empty array clears the current reply media batch.`,
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
                    'Deliberately public HTTPS image-file URL for static catalog assets only. Never use this for user-sent, vault-backed, generated, health, or otherwise private media.',
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

export const MURPH_ATTACH_RESPONSE_CARD_TOOL = {
  namespace: 'murph',
  name: 'attach_response_card',
  description:
    'The daily-nutrition safety gate includes a lifetime vault-cli event list --kind encounter --limit 200 --format json read before numeric proposals, Goal activation, or cards. Inspect every returned item; use event show for every item whose list data reports nonzero diagnosesCount, and inspect all diagnosis entries without selecting by title, visit type, snapshot visibility, or the default prefix. A safety-relevant active diagnosis with documented or suspected certainty suppresses numeric output. Inactive, resolved, history, rule_out, ruled_out, and unrelated diagnoses do not prove a current exclusion; unresolved status or certainty on a safety-relevant diagnosis fails closed. A failed, unreadable, or exactly 200-record encounter read, or a failed required detail read, fails closed with no Goal or measurement mutation and no card; scheduled occurrences ask no question. ' +
    'The daily-nutrition safety gate includes a lifetime vault-cli event list --kind procedure --limit 200 --format json read before numeric proposals, Goal activation, or cards. Inspect every returned item; use event show for an item whose procedure or status is missing or truncated. A completed gastric bypass, Roux-en-Y, sleeve gastrectomy, gastric sleeve, biliopancreatic diversion, duodenal switch, adjustable gastric band, lap band, or other explicit bariatric surgery suppresses numeric output. Planned, ordered, cancelled, ambiguous, or unrelated procedures do not prove post-bariatric context. A failed, unreadable, or exactly 200-record procedure read, or a failed required detail read, fails closed with no Goal or measurement mutation and no card; scheduled occurrences ask no question. ' +
    'The daily-nutrition safety gate includes a separate vault-cli measurement entry list --metric pregnancy-test --from <300-days-before-today> --to <today> --limit 200 --format json read before numeric proposals, Goal activation, or cards. Require exact metric pregnancy-test, unit result, value 1, and a normalized positive qualifiers.result; any such positive wins over negative evidence from either pregnancy-evidence owner in the window and suppresses numeric output without diagnosing pregnancy. Missing, negative, stale, indeterminate, malformed, or conflicting rows are unavailable evidence rather than proof of non-pregnancy. A failed, unreadable, or exactly 200-record pregnancy-test read fails closed with no Goal or measurement mutation and no card; scheduled occurrences ask no question. ' +
    'The same gate includes vault-cli event list --kind test --from <300-days-before-today> --to <today> --limit 200 --format json. A failed, unreadable, or exactly 200-record list fails closed before any numeric effect, with no test detail reads on saturation. Otherwise event show every returned test because list output compacts results and can truncate summaries; any failed or unreadable detail fails closed. Treat a pregnancy/hCG test or matching structured analyte with an explicit positive, detected, or pregnant textValue or unambiguous test-level summary as positive evidence unless resultStatus is pending. Canonical resultStatus unknown classifies the result rather than source lifecycle and may qualify only with that strict identity plus explicit text. Do not infer pregnancy from numeric hCG, reference ranges, abnormal or unknown status/flags alone, titles, notes, or ambiguous or negated text. An explicit positive wins over negative evidence from either canonical owner in the window and suppresses numeric output, Goal mutation or activation, and cards. Missing, negative, pending, numeric-only, stale, unrelated, and ambiguous test evidence is unavailable rather than a universal block. Scheduled occurrences ask no question, perform no mutation, and attach no card. ' +
    'Workout footers span native and static cards; never promise native-only taps. ' +
    'For a tracked workout, attempt the complete verified card and let input validation decide whether its actual encoded envelope fits; never refuse from an estimated exercise or set count or ask the member to simplify saved workout data. If validation rejects the complete envelope, use the full deterministic text recovery. ' +
    'Attach one private-direct response card when the current accepted member message or the saved instructions for the exact scheduled automation occurrence request a structured answer that the card alone can represent, during managed meal closeout, for the verified initial card after starting or resuming one canonical live workout, or for an unambiguous update to its established workout card. Occurrence authority alone is not card intent. The card replaces the entire final response: attach it only when the card alone completely satisfies the current request; answer compound requests with complete ordinary text and no card. Before every goal-aware daily_nutrition card, first run vault-cli goal list --status active --limit 200 --format json. If it returns 200 records, fail closed with ordinary text, no Goal or measurement mutation, and no card. Otherwise run vault-cli goal show <goal-id> --format json for every returned active Goal whose list item reports a nonzero data.metricTargetsCount; never select detail reads by title, slug, domain, context-snapshot visibility, or the default list prefix. Resolve metric identity, unit, comparator, effective date, conflicts, and the 1,200-kcal boundary only after inspecting that complete detail set. Keep this active-target authority read separate from any all-status lookup used to reuse or honor Murph\'s managed paused or abandoned proposal; neither read substitutes for the other. For daily_nutrition, immediately beforehand run vault-cli meal totals --from <date> --to <same-date> and copy its exact canonical metric { total, mealCount } values; never calculate or reuse totals. New authoring uses V2 with fiber and five required goal snapshots; nullable V2 goals and nutrition V1 remain legacy replay and rendering compatibility only. Before deriving, saving, or surfacing numeric nutrition goals, before activating a paused nutrition proposal, and before every daily_nutrition attachment, even with five active goals or on a scheduled closeout, follow nutrition-strategy/references/daily-nutrition-card-safety.md. First run vault-cli memory show --format json and inspect the complete canonical Identity, Preferences, Instructions, and Context memory document for explicit, unambiguous safety facts; the context snapshot does not inject it. A failed or unreadable memory read fails closed with ordinary non-numeric text, no Goal or measurement mutation, and no card; leave an existing paused proposal unchanged. A clearly current saved age under 18 or clearly current intuitive-eating or number-sensitive preference uses the same suppression path. Missing, stale, ambiguous, or conflicting age alone is unavailable evidence, not a universal block; scheduled occurrences never ask. Run both vault-cli condition list --status active --limit 200 --format json and vault-cli regimen list --status active --limit 200 --format json. If either read fails or returns exactly 200 records, run no condition or regimen detail reads and fail closed with ordinary non-numeric text, no Goal or measurement mutation, and no card. Otherwise run vault-cli condition show <condition-id> --format json for every returned active condition and vault-cli regimen show <regimen-id> --format json for every returned active regimen before applying the safety gate; never select by title, substance, severity, context-snapshot visibility, or the default list prefix. If any required detail read fails or is unreadable, use the same fail-closed behavior; otherwise reuse the complete current-turn reads. Then run vault-cli event list --kind procedure --limit 200 --format json and apply its complete procedure-item and conditional-detail contract before continuing; a completed bariatric procedure suppresses numeric output, and a failed, unreadable, or saturated read fails closed. As part of that same pre-numeric and pre-activation gate, also run its bounded lossless vault-cli measurement entry list read over the canonical 45-day window. A usable adult BMI below 18.5, including height and weight rows sharing one eventId, suppresses numeric proposal derivation or presentation, every Goal write or activation, and the card. A failed read, or a saturated read that cannot resolve usable BMI evidence, fails closed with ordinary non-numeric text, no Goal or measurement mutation, and no card; leave an existing paused proposal unchanged. The gate also blocks known underweight, frailty, malnutrition risk, glucose-lowering medication, safety-relevant disease or clinician-managed nutrition context, and calorie targets below 1,200 kcal/day without flooring them upward. Scheduled authority never permits questions or activation; only the first eligible managed meal closeout may create and explain one paused proposal after the complete safety gate and an all-status Goal read prove the stable managed slug has never existed. For the exact card localDate, require the containing active Goal window and each target\'s optional startAt/targetAt interval to include that date, with inclusive boundaries; use the selected capture date for a scheduled closeout, which may differ from the occurrence date for a historical catch-up, or the explicitly requested date, never wall-clock today. Ignore out-of-window targets for current authority and conflicts, and never expose, compare, copy, derive from, or mutate a Goal because of them. Require exactly one unambiguous applicable exact point target in each fixed card unit: dietary-calories in kcal, and protein-grams, carbs-grams, fat-grams, and fiber-grams in g, resolved across active canonical Goals. Each target must use selected-value comparator between with identical numeric value and highValue. A one-sided threshold, non-identical range, or other shape remains authoritative but makes the bundle comparator-incompatible: never expose, compare, copy, or derive from its bound or create, replace, or remove a managed target around it; use ordinary text with no card or managed Goal mutation, and ask no question on a scheduled closeout. A target in another unit likewise remains authoritative but makes the bundle incompatible: never compare, convert, copy, or derive from its raw value. An explicit numeric-card request or the one first eligible managed closeout authorizes only the goal-aware workflow\'s paused canonical proposal, not activation or use. When any target is missing, follow nutrition-strategy/references/daily-nutrition-card-goals.md: hold applicable, compatible exact point targets fixed, derive missing macros from residual calories, and require every AMDR plus a 50 kcal energy tolerance before any Goal write; an infeasible bundle means ordinary text and no mutation. Save one paused canonical proposal, explain its values, reasoning, and effective date in ordinary text with no card, and activate it only after member acceptance. On first creation, set Goal window.startAt explicitly: use a member-requested effective date when present, otherwise the selected card localDate for a dated card request, otherwise the engine-supplied current vault-local date; never rely on the write-day default. Preserve that window on every later edit, activation, or card request and never silently rebase it to another card date. Any derived target addition or change atomically pauses the complete managed bundle until acceptance. A scheduled closeout never asks for inputs or activates provisional targets. On the first eligible managed closeout only, if the complete all-status Goal read proves the stable managed slug has never existed and already-known inputs pass the complete safety and derivation contracts, create and explain one paused proposal in ordinary text with no card; once that Goal exists in any status, scheduled turns never create, change, or automatically repeat it. Without a complete accepted bundle or that one first-run proposal path, use ordinary closeout text and no card. When an explicit card request caused the proposal, its next unambiguous acceptance may complete that pending request only after the complete safety recheck passes, then activation and readback, and a fresh same-date totals read; corrections, declines, ambiguous replies, target-setting-only requests, and compound requests remain text-only. Explicit active targets win metric by metric; conflicts, thresholds, ranges, unsafe numbers, or missing responsible calorie inputs mean ordinary text or one consolidated question, never a goal-less card. Freeze each exact point target and Murph\'s context-aware status without a universal threshold. Use compact_table for an explicit table or structured-tracker request, a structured plan or schedule that the table alone can fully represent within its bounds, that verified initial live-workout card, or an unambiguous update to the same active workout; with multiple plausible workouts, do not infer authority and ask one narrow question. Never invent or silently truncate values. For tracked workouts, first update or resolve the canonical workout, re-read it successfully, and copy only that verified snapshot with its exact evt_<ULID> reference and canonical UTC snapshot instant. Use only when numerical output is permitted. Runtime renders durable text and fallbacks, so do not repeat card values in final send_message. This tool does not send and cannot combine with response media.',
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
  namespace: 'murph',
  name: 'attach_exercise_routine_card',
  description:
    'Attach one private-direct exercise routine card when this tool is available for a movement-instruction turn or saved instructions for the exact scheduled occurrence that ask Murph to teach the routine now. Also use it when the current message asks to repeat, resend, or improve the presentation of a movement routine already present in the committed conversation. A request for a richer or more visual layout means this card, not styled plain text. The card must completely answer the request and replaces final text. First run vault-cli exercise show for each named movement. Copy each selected image URL, alt, and step exactly. Construct its source as exercise_catalog:<returned-item-id>:<1-based-position-in-returned-images>; never invent media or reorder images before assigning the position. Keep each instruction concrete and short. Use subtitle for one short orientation sentence in the user\'s language that tells them to open each exercise for instructions and images. Use footer only when it adds information that the title, exercise details, subtitle, or safety note do not already say. Estimate each exercise, transition, and total honestly. Before attaching, compare the stated total with the routine and do not claim a longer session than the content supports. The current channel renders the card with its supported native presentation. Do not repeat values in final send_message and do not combine this card with response media.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      card: exerciseRoutineResponseCardJsonSchema,
    },
    required: ['card'],
  },
} as const

export const MURPH_GROUP_CHALLENGE_RESPONSE_CARD_TOOL = {
  namespace: 'murph',
  name: 'attach_response_card',
  description:
    'Attach one challenge_standings card for the current authenticated Linq group only when the current accepted room message or the saved instructions for this exact scheduled occurrence explicitly request a current shared-challenge snapshot. Read the existing canonical challenge page with vault-cli knowledge show and every required bounded read first. The page must already have pageType challenge and exactly one closed murph:group-challenge-definition:v1 section; never create or repair that definition during attachment. Copy the exact pageRevisionDigest from that knowledge show result, then pass it with the challenge slug and one normalized component observation for every page-owned participant whose participation state is in. The page revision digest is only a consistency precondition: the trusted host still validates the embedded definition digest; derives participant order, format, objective, teams, scorecard rules, rates, caps, units, component scopes, and rules revision from the current page; and rejects observations when any canonical page content changed after normalization. Room membership or a sharing grant never creates challenge buy-in. It requires one complete stable room-member and authorized-label roster, every page-owned participant to be present in that roster, exact observation coverage, and every definition scope to be backed by those reads. Additional current room members remain nonparticipants. It derives individual labels from the trusted read, runs the deterministic scorer, and compare-and-set persists the exact page-derived input and result on that same page before attaching. Any unavailable, empty, failed, capacity-omitted, roster-inconsistent, page-revision-mismatched, missing-or-extra-observation, unbacked-scope, generic-or-malformed-page, missing-definition, or conflicting-persistence path cannot attach and must finish with a truthful ordinary-text update. The tool owns points, target, order, coverage, counts, ranks, and ties. For individual or team snapshots, attach only when the entire canonical ranked result contains at most eight entries; never truncate the ranking or omit a waiting challenge participant. Collective cards have no row cap. Partial scores are verified lower bounds and unscored scores stay null. The card replaces the entire final response, does not send by itself, and cannot combine with response media.',
  inputSchema: groupChallengeResponseCardToolInputJsonSchema,
} as const

export const MURPH_GENERATE_IMAGE_TOOL = {
  namespace: 'murph',
  name: 'generate_image',
  description:
    `Generate one GPT Image 2 image when requested, a known preference supports visual help, or a skill/product flow explicitly marks images welcome and privacy-safe. Use ordered vault refs and explain their roles; include ${MURPH_CHARACTER_SHEET_REFERENCE_IMAGE_REF}, Murph's canonical character sheet, when Murph appears. Vault outputs persist under raw/captures/**. Hosted accepted-message turns start generation in the background and finish through trusted private media. Exact scheduled automation occurrences remain synchronous and attach private media to the same final response; that image consumes one of the same ${ASSISTANT_AUTHORED_RESPONSE_MEDIA_MAX_ITEMS} final-response media slots, so leave a slot before calling. Local runs stay synchronous with the same slot rule and save under CODEX_HOME/generated_images.`,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      prompt: {
        type: 'string',
        minLength: 1,
        maxLength: 4000,
      },
      size: {
        type: 'string',
        enum: ['1024x1024', '1024x1536', '1536x1024'],
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

export const MURPH_PRODUCT_FEEDBACK_DEFERRED_DISCOVERY_RULE =
  'Before classifying a Murph path as missing or filing missing-capability feedback, use the provided deferred-tool discovery surface; absence from eager tools is not proof.'

export const MURPH_SUBMIT_PRODUCT_FEEDBACK_TOOL = {
  namespace: 'murph',
  name: 'submit_product_feedback',
  description:
    `Submit one structured Murph product-feedback candidate for the current accepted request. Provide the feedback kind, one concise product-only summary, and optional related changelog item ids. ${MURPH_PRODUCT_FEEDBACK_DEFERRED_DISCOVERY_RULE} When feedback describes a failure or workflow issue, put the general feedback first and append a privacy-safe reproduction recipe in the same summary field. Ordinary feedback is best-effort after the reply. Explicit verified-private human support uses kind "frustration", empty changelog ids, and a concise de-identified explanation beginning exactly "Support escalation:"; that mode waits for the durable callback. The result reports accepted, already accepted, or unavailable; do not retry after any result.`,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      kind: {
        type: 'string',
        enum: [...HOSTED_PRODUCT_FEEDBACK_KINDS],
        description:
          'Use feature_request for a missing or unsupported Murph path, frustration for a negative product experience without a clear requested capability, and feature_interest for interest in an available or shipped capability. Reserved support escalation always uses frustration.',
      },
      summary: {
        type: 'string',
        minLength: 1,
        maxLength: HOSTED_PRODUCT_FEEDBACK_SUMMARY_MAX_LENGTH,
        description:
          'Concise de-identified, product-only summary of the feedback. Make it actionable without the conversation: name the generic actor, exact Murph surface or workflow, requested or attempted action, expected versus observed result, and any concrete product constraint the source established. Preserve those distinctions instead of replacing them with vague labels. If a detail is not established, omit it or mark it unclear rather than infer or invent it. For any failure, frustration, workaround, degraded or manual workflow, or assistant-observed issue, write the general product problem first, then append a section beginning exactly "Reproduction:". Make that section independently usable without the original conversation: describe the smallest established generic preconditions and synthetic data shape; list the exact Murph CLI commands or tool calls with synthetic arguments when known and applicable; and give a sanitized example request or user action that triggers the issue, plus expected versus observed behavior when not already clear. Replace private inputs with synthetic placeholders or the least-specific product concept that preserves the failure. Never copy or closely paraphrase the member\'s wording. If the evidence is insufficient for a complete reproduction, state the known generic setup and trigger and identify the non-private condition that remains unknown instead of inventing steps. Omit the Reproduction section only for pure feature interest with no failure or friction to reproduce. Abstract every private fact to the least-specific product concept that still explains the issue, such as "a health metric", "a connected source", or "a scheduled item"; do not preserve a private fact merely because it was relevant in the conversation. When a path is missing, name the desired outcome and missing Murph capability rather than summarizing the conversation. Start with "Speculative:" only for clear inferred user workflow friction, or "Murph-observed:" only for repeated assistant-observed product/tool friction. Never include names, handles, account or member identifiers, raw user wording, quoted conversation or voice-memo content, diagnoses, symptoms, medications, treatments, lab results, biometrics, exact health/fitness/nutrition values, reproductive details, locations, relationships, contact details, secrets, provider payloads, tags, or topics. For explicit verified-private human support, begin exactly "Support escalation:", then provide Murph\'s concise de-identified explanation in its own words using the same general-problem-plus-reproduction format; never copy or quote the member\'s message.',
      },
      relatedChangelogItemIds: {
        type: 'array',
        minItems: 0,
        maxItems: 7,
        default: [],
        description:
          'Optional metadata for known shipped changelog item ids. Leave empty for general product interest, feature requests, frustrations, inferred workflow friction, or assistant-observed product/tool friction.',
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
  description:
    'Read Family status, start checkout, or invite. Allow `read_status` for an explicit Family request or trusted private low-usage Family context. Checkout and invite actions require the current member\'s explicit request. Treat results as exact; never claim activation, invitation, payment, or usage completion.',
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

export const MURPH_PLAN_USAGE_TOOL = {
  namespace: 'murph',
  name: 'plan_usage',
  description:
    'Read current private hosted plan, AI-usage, recommendation, signed quote for explicit plan, usage, billing or trusted low-usage context. Omit target for recommendation. For exact user-named plan, pass target; use only matching quote. availablePlans is the current eligible plan list. Read-only; percentages and forecasts cover all available usage without credit-source splits.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      targetPlanCode: {
        type: 'string',
        enum: [...HOSTED_PLAN_USAGE_DIRECT_BILLING_PLAN_CODES],
        description:
          'Optional exact user-named plan to quote instead of the server recommendation.',
      },
    },
  },
} as const

export const MURPH_IMESSAGE_CONTACT_TOOL = {
  namespace: 'murph',
  name: 'imessage_contact',
  description:
    'Get or atomically assign the current member\'s Murph iMessage number. Call only for their explicit current request; repeated requests return the same number.',
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
    'Apply one signed private plan change explicitly confirmed by the current user in this turn. Use only action=change_plan with exact targetPlanCode and quoteId from a current matching plan_usage quote. Exact replay of the same input and action is idempotent; a different target requires new eligible user input. A scheduled result includes authoritative effectiveAt; keep current and future plans distinct. Only payment_required includes paymentUrl; other results do not prove a payment method.',
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

export const MURPH_PERSONALIZATION_TOOL = {
  namespace: 'murph',
  name: 'personalization',
  description:
    'Read the current hosted conversation runtime\'s effective Murph main personality, optional supporting personality, tone, voice, and model context, or atomically update those fields. Persona changes require current accepted user input plus both mainPersona and supportingPersona; use read first when either current value must be preserved, and pass null to remove support. Exact scheduled automation occurrences may update tone and voice but never personas. Reply casing maps to the existing tone field: capitalize, standard capitalization, or sentence case means formal; lowercase means casual. Treat a request about how Murph should keep writing or show up as an update rather than an unsupported setting; a one-reply formatting request does not persist. In a private chat this is the member\'s Murph; in a group chat this is the synthetic room Murph and never a participant\'s private settings. Use murph.assistant_configuration for model, provider, or reasoning changes only when that separate tool is available.',
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
          mainPersona: {
            type: 'string',
            enum: assistantBasePersonaIdValues,
            description: assistantBasePersonaOptions
              .map((option) => `${option.label}=${option.id}`)
              .join(', '),
          },
          supportingPersona: {
            anyOf: [
              { type: 'string', enum: assistantBasePersonaIdValues },
              { type: 'null' },
            ],
            description:
              'Supporting personality paired with mainPersona; null removes support. It must differ from mainPersona.',
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
              .join(', '),
          },
        },
        required: ['action'],
        anyOf: [
          { required: ['mainPersona', 'supportingPersona'] },
          { required: ['tone'] },
          { required: ['voice'] },
        ],
      },
    ],
  },
} as const

export const MURPH_ASSISTANT_CONFIGURATION_TOOL = {
  namespace: 'murph',
  name: 'assistant_configuration',
  description:
    'Read the current hosted turn model, provider, and reasoning effort plus the choices available for the next turn, or directly save an explicit user-requested change. OpenAI and Venice are the supported core-reply providers when listed as available; specialized tools may still use their own managed providers. Internally, Luna is the most usage-efficient model, Terra is the default, and Sol requires an active paid Edge plan. Do not assume the member knows model names or introduce them unless the member asks; otherwise describe the usage-saving option as “a less capable model that uses less AI usage.” The lowest supported reasoning effort is low; these hosted models do not support none. Use action="read" whenever configuration facts are needed. Use action="update" only when the current user-sourced turn explicitly asks for the exact change. Never switch models, providers, or reasoning automatically because usage is low. Do not claim a change is saved unless the result says updated or unchanged. A saved update does not change the running turn and takes effect on the next turn.',
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
        description: 'Optional next-turn model for action="update".',
      },
      provider: {
        type: 'string',
        enum: [...HOSTED_ASSISTANT_PROVIDERS],
        description: 'Optional next-turn core-reply provider for action="update".',
      },
      reasoningEffort: {
        type: 'string',
        enum: [...HOSTED_ASSISTANT_REASONING_EFFORTS],
        description: 'Optional next-turn reasoning effort for action="update".',
      },
    },
    required: ['action'],
  },
} as const

export const MURPH_GROUP_ASSISTANT_CONFIGURATION_TOOL = {
  namespace: 'murph',
  name: 'assistant_configuration',
  description:
    'Read the current group room model and the choices available for the next turn, or save an explicit current-room request to change it. This changes only the synthetic Murph instance for this room; it never reads or changes any participant\'s private model, provider, reasoning, account, or billing settings. Group rooms default to Sol, and Luna, Terra, or Sol may be selected for the room. Use action="read" whenever model facts are needed. Use action="update" only when the current user-sourced group turn explicitly asks for the exact model. Never switch models automatically because usage is low. Do not claim a change is saved unless the result says updated or unchanged. A saved update does not change the running turn and takes effect on the next turn.',
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
            enum: [...HOSTED_ASSISTANT_PRODUCT_MODELS],
            description: 'Required next-turn group room model.',
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

/**
 * Detached group consultation gets only the lazy shared-data read surface. It
 * intentionally reuses murph.group so the normal parser/executor stays the
 * single implementation while the model never sees mutation or routing actions.
 */
export const MURPH_GROUP_SHARED_READ_TOOL = {
  namespace: 'murph',
  name: 'group',
  description:
    'Read one to three exact consent-aware projections for the current authorized group. The trusted host binds member, group, and route; supply no identifiers. status="partial" means omittedParticipantIds are still current members with omitted rows, so the result is incomplete and cannot prove departure, score, diagnosis, or permission state.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
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

/**
 * Scheduled group turns can read shared facts and offer group access without
 * exposing the provider-specific native-message versus link decision.
 */
export const MURPH_GROUP_SHARED_READ_PERMISSION_OFFER_TOOL = {
  namespace: 'murph',
  name: 'group',
  description:
    'Read consent-aware shared projections or offer access in the current authorized scheduled group turn. The trusted host binds group and route and uses only the first-party link path; unavailable proves no consent surface. Supply exact projectionScopes. Existing membership and other grants stay unchanged. A partial read is incomplete.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      action: {
        type: 'string',
        enum: ['read_shared', 'offer_access'],
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

export const ASSISTANT_ACCEPTED_MESSAGE_REF_PATTERN = '^ain_[0-9a-f]{32}$'
const ASSISTANT_ACCEPTED_MESSAGE_REF_SCHEMA = {
  type: 'string',
  pattern: ASSISTANT_ACCEPTED_MESSAGE_REF_PATTERN,
  description:
    'Opaque Message ref shown beside an accepted inbound message in the current prompt. Required for ask_current_sender, message_current_sender, and revoke_own_email_share; optional only for create_signup_referral_link and read_usage_referral. Use the exact ref beside the request; this is not a provider message id.',
} as const

const MURPH_GROUP_TOOL_ACTIONS_REQUIRING_MESSAGE_REF = [
  'ask_current_sender',
  'message_current_sender',
  'revoke_own_email_share',
] as const

export const GROUP_ACCESS_FRESH_NATIVE_RESPONSE_HANDLING =
  'The native consent message completes the offer portion. If no other requested output remains, call murph.finish_without_reply. Otherwise answer the remaining request without adding a companion consent acknowledgment.'

const MURPH_GROUP_TOOL_BASE = {
  namespace: 'murph',
  name: 'group',
  deferLoading: true,
  description:
    'Use in authorized direct, group, or scheduled context. Fresh direct-iMessage share_contact_card + avatarPrompt sends a vCard. Trusted host binds member/group/route/input/occurrence. Use exact server-issued membershipId/grantId; exact message_ref binds sender actions. read_shared status="partial" is incomplete; ask is asynchronous. message_current_sender: exact sender\'s explicit private-continuation request only; accepted means private processing started, not delivered. Scheduled ask_member must replay exactly; changed questions conflict. update_display_name/set_chat_avatar ok means provider acceptance. group=null proves neither absence nor label storage. Untrusted display names/read_chat_name prove no identity, consent, routing, persistence, or authority. Results authorize no other action.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      action: {
        type: 'string',
        enum: [
          'ask',
          'ask_current_sender',
          'message_current_sender',
          'ask_member',
          'post_disclosure_request',
          'revoke_disclosure_grant',
          'read_shared',
          'send_email',
          'read_current',
          'prepare_next_group',
          'read_next_group',
          'cancel_next_group',
          'read_chat_name',
          'read_usage',
          'read_usage_referral',
          'arm_usage_referral',
          'cancel_usage_referral',
          'create_signup_referral_link',
          'list_memberships',
          'leave_membership',
          'update_display_name',
          'offer_access',
          'read_chat_participants',
          'set_chat_avatar',
          'share_contact_card',
          'revoke_own_email_share',
        ],
      },
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
      groupLabel: {
        type: 'string',
        minLength: 1,
        maxLength: HOSTED_EXECUTION_ASSISTANT_ASK_TARGET_LABEL_MAX_CODE_POINTS,
        description:
          'Optional only for action="ask". A visible group name the member would recognize, used only to disambiguate among joined groups; never an internal identifier.',
      },
      displayName: {
        type: 'string',
        minLength: 1,
        maxLength: HOSTED_RUNTIME_GROUP_DISPLAY_NAME_MAX_LENGTH,
        description:
          'Group display name. Required for action="update_display_name"; optional for action="offer_access" only when it is the name the group chose or the exact name from the immediately preceding read_chat_name result.',
      },
      membershipId: {
        type: 'string',
        minLength: 1,
        description:
          'Required only for action="leave_membership". Use the exact opaque membershipId from the immediately preceding list_memberships result; never guess it or take it from the user.',
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
          'For ordinary read_shared, one to three exact consent-aware group projections, including additive exact-grant activation time when available. For read_shared with audience="group_email", the exact bounded projections allowed into this email composition; the trusted host intersects them with live recipient grants. For offer_access, omit projectionScopes to request every selectable permission by default, or supply the exact narrower set requested. Existing membership and other grants remain unchanged. The trusted host owns the exact consent copy and actual scope snapshot and uses a handled native consent path or a first-party link. Fresh native results include exact responseHandling; follow it.',
      },
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
    },
    required: ['action'],
  },
} as const

const MURPH_GROUP_TOOL_ACTIONS_WITHOUT_REQUIRED_MESSAGE_REF =
  MURPH_GROUP_TOOL_BASE.inputSchema.properties.action.enum.filter((action) =>
    action !== 'ask_current_sender'
    && action !== 'message_current_sender'
    && action !== 'revoke_own_email_share')

export const MURPH_GROUP_TOOL = {
  ...MURPH_GROUP_TOOL_BASE,
  inputSchema: {
    allOf: [
      MURPH_GROUP_TOOL_BASE.inputSchema,
      {
        oneOf: [
          {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: MURPH_GROUP_TOOL_ACTIONS_REQUIRING_MESSAGE_REF,
              },
              message_ref: ASSISTANT_ACCEPTED_MESSAGE_REF_SCHEMA,
            },
            required: ['action', 'message_ref'],
          },
          {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: MURPH_GROUP_TOOL_ACTIONS_WITHOUT_REQUIRED_MESSAGE_REF,
              },
            },
            required: ['action'],
          },
        ],
      },
    ],
  },
} as const

export const MURPH_SEND_VAULT_FILE_TOOL = {
  namespace: 'murph',
  name: 'send_vault_file',
  description:
    `Securely prepare one file for the current iMessage conversation. Use a normalized vault-relative file path. Only after this turn establishes an obligation to send a newly generated file now, write its final bytes directly to ${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/<flat-filename> and use that ref. Do not stage files for possible later delivery, and never move or copy existing, user-owned, canonical, or durable files there. When a generated ZIP contains derived exports/packs/<packId> directories, pass those exact included ids in retire_export_pack_ids; never include a pack that is absent from the ZIP. The runtime retires only unchanged claimed packs after confirmed delivery. When approval is pending, explain that approval is required; the runtime adds the exact link outside model context. When approval is approved, the runtime owns delivery of the existing attachment intent; call finish_without_reply and do not attach the file or send a companion acknowledgment. Do not claim final iMessage delivery unless later delivery evidence confirms it. It does not reveal file bytes to the model and does not support arbitrary recipients.`,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ref: {
        type: 'string',
        minLength: 1,
        maxLength: 1024,
        description:
          `Normalized vault-relative path, for example documents/report.pdf. The exact flat ${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/<flat-filename> runtime ref is also accepted; all other hidden paths, traversal, absolute paths, and unsupported file types are rejected.`,
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
          'Exact derived export-pack ids included in this generated ZIP. Omit for every other file.',
      },
    },
    required: ['ref'],
  },
} as const

export const MURPH_FINISH_WITHOUT_REPLY_TOOL = {
  namespace: 'murph',
  name: 'finish_without_reply',
  description:
    'Finish the current response without adding a new text reply. This does not withdraw a reply you already completed earlier in the turn.',
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
    'Select one accepted inbound message as the native reply target for the current normal response. Use this only when anchoring the response to a specific message improves clarity; ordinary responses stay flat. This does not send text and does not finish the turn.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      message_ref: ASSISTANT_ACCEPTED_MESSAGE_REF_SCHEMA,
    },
    required: ['message_ref'],
  },
} as const

export const MURPH_REACT_TO_MESSAGE_TOOL = {
  namespace: 'murph',
  name: 'react_to_message',
  description:
    'React to one accepted inbound message identified by its Message ref when the active channel supports reactions. This does not send text and does not finish the turn.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      message_ref: ASSISTANT_ACCEPTED_MESSAGE_REF_SCHEMA,
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
    'Open/reuse authorized browser; reopen after handoff/uncertainty. Returns runId, URL, title, text; prior outcome stays unknown. Before multi-step browsing each turn, call send_progress_update if available; prior-turn progress does not count.',
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
  name: 'computer_act',
  description:
    'One bounded Playwright macro-step in current authorized run; returns state. No missing or sensitive input or final confirmation. Before browser call two this turn, call send_progress_update if available and not yet sent. Failure leaves outcome uncertain; call computer_open before retry/next action.',
  inputSchema: MURPH_COMPUTER_ACT_INPUT_SCHEMA,
} as const

export const MURPH_COMPUTER_OS_CONTROL_TOOL = {
  namespace: 'murph',
  name: 'computer_os_control',
  description:
    'Fallback: perform one bounded mouse or keyboard action in the current authorized run only when Playwright cannot operate the verified control. Never enter sensitive data. After a possible effect or failure, the outcome may be unknown; call computer_open before any retry or next action.',
  inputSchema: MURPH_COMPUTER_OS_CONTROL_INPUT_SCHEMA,
} as const

export const MURPH_COMPUTER_PAUSE_FOR_USER_TOOL = {
  namespace: 'murph',
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
  MURPH_DEVICE_TOOL,
  MURPH_ASSISTANT_STYLE_TOOL,
  MURPH_ATTACH_RESPONSE_MEDIA_TOOL,
  MURPH_ATTACH_RESPONSE_CARD_TOOL,
  MURPH_ATTACH_EXERCISE_ROUTINE_CARD_TOOL,
  MURPH_GENERATE_IMAGE_TOOL,
  MURPH_GENERATE_VOICE_MEMO_TOOL,
  MURPH_ASSISTANT_CONFIGURATION_TOOL,
  MURPH_PERSONALIZATION_TOOL,
  MURPH_FAMILY_PLAN_TOOL,
  MURPH_PLAN_USAGE_TOOL,
  MURPH_IMESSAGE_CONTACT_TOOL,
  MURPH_SUBSCRIPTION_TOOL,
  MURPH_GROUP_TOOL,
  MURPH_GROUP_ROOM_MODEL_TOOL,
  MURPH_GENERATE_SONG_TOOL,
  MURPH_ASK_GROK_TOOL,
  MURPH_SUBMIT_PRODUCT_FEEDBACK_TOOL,
  MURPH_SEND_VAULT_FILE_TOOL,
  MURPH_PENDING_VAULT_FILES_TOOL,
  MURPH_FINISH_WITHOUT_REPLY_TOOL,
  MURPH_SELECT_REPLY_TARGET_TOOL,
  MURPH_REACT_TO_MESSAGE_TOOL,
  MURPH_CREATE_CLINICAL_RECORDS_CONNECT_LINK_TOOL,
  MURPH_CREATE_PHONE_CALL_TOOL,
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
  | (typeof MURPH_DYNAMIC_TOOLS)[number]
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
  computerToolsAvailable?: boolean | null
  progressUpdatesAvailable?: boolean | null
  connectedAppsAvailable?: boolean | null
  connectedAppsManageAvailable?: boolean | null
  deviceAvailable?: boolean | null
  clinicalRecordsConnectLinkAvailable?: boolean | null
  familyPlanAvailable?: boolean | null
  labsAvailable?: boolean | null
  planUsageAvailable?: boolean | null
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
  exerciseRoutineResponseCardsAvailable?: boolean | null
  groupChallengeResponseCardsAvailable?: boolean | null
  progressUpdateMode?: 'direct' | 'group'
  physicalNotesAvailable?: boolean | null
  phoneCallsAvailable?: boolean | null
  voiceMemoGenerationAvailable?: boolean | null
  pendingVaultFilesAvailable?: boolean | null
  vaultFileSendAvailable?: boolean | null
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
    [MURPH_DEVICE_TOOL, defaultOff((a) => a.deviceAvailable)],
    [MURPH_ASSISTANT_STYLE_TOOL, defaultOff((a) => a.assistantStyleSettingsAvailable)],
    [MURPH_ATTACH_RESPONSE_CARD_TOOL, defaultOff((a) => a.responseCardsAvailable)],
    [MURPH_ATTACH_EXERCISE_ROUTINE_CARD_TOOL, defaultOff((a) =>
      a.exerciseRoutineResponseCardsAvailable)],
    [MURPH_FINISH_WITHOUT_REPLY_TOOL, defaultOn((a) => a.allowFinishWithoutReply)],
    [MURPH_SELECT_REPLY_TARGET_TOOL, defaultOff((a) => a.messageTargetingAvailable)],
    [MURPH_REACT_TO_MESSAGE_TOOL, defaultOff((a) => a.messageTargetingAvailable)],
    [MURPH_SUBMIT_PRODUCT_FEEDBACK_TOOL, defaultOff((a) => a.productFeedbackAvailable)],
    [MURPH_ASSISTANT_CONFIGURATION_TOOL, defaultOff((a) => a.assistantConfigurationAvailable)],
    [MURPH_FAMILY_PLAN_TOOL, defaultOff((a) => a.familyPlanAvailable)],
    [MURPH_LABS_TOOL, defaultOff((a) => a.labsAvailable)],
    [MURPH_PLAN_USAGE_TOOL, defaultOff((a) => a.planUsageAvailable)],
    [MURPH_IMESSAGE_CONTACT_TOOL, defaultOff((a) => a.imessageContactAvailable)],
    [MURPH_SUBSCRIPTION_TOOL, defaultOff((a) => a.subscriptionAvailable)],
    [MURPH_GROUP_TOOL, defaultOff((a) => a.groupAvailable)],
    [MURPH_GROUP_ROOM_MODEL_TOOL, defaultOff((a) => a.groupRoomModelAvailable)],
    [MURPH_PERSONALIZATION_TOOL, defaultOff((a) => a.personalizationAvailable)],
    [MURPH_GENERATE_VOICE_MEMO_TOOL, defaultOff((a) => a.voiceMemoGenerationAvailable)],
    [MURPH_GENERATE_SONG_TOOL, defaultOff((a) => a.voiceMemoGenerationAvailable)],
    [MURPH_GENERATE_IMAGE_TOOL, defaultOn((a) => a.imageGenerationAvailable)],
    [MURPH_ASK_GROK_TOOL, defaultOff((a) => a.askGrokAvailable)],
    [MURPH_SEND_VAULT_FILE_TOOL, defaultOff((a) => a.vaultFileSendAvailable)],
    [MURPH_PENDING_VAULT_FILES_TOOL, defaultOff((a) => a.pendingVaultFilesAvailable)],
    [MURPH_CREATE_PHONE_CALL_TOOL, defaultOff((a) => a.phoneCallsAvailable)],
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
  if (availability.groupChallengeResponseCardsAvailable === true) {
    const responseCardToolIndex = tools.indexOf(MURPH_ATTACH_RESPONSE_CARD_TOOL)
    if (responseCardToolIndex >= 0) {
      tools[responseCardToolIndex] = MURPH_GROUP_CHALLENGE_RESPONSE_CARD_TOOL
    } else {
      tools.push(MURPH_GROUP_CHALLENGE_RESPONSE_CARD_TOOL)
    }
  }
  if (availability.progressUpdateMode === 'group') {
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
