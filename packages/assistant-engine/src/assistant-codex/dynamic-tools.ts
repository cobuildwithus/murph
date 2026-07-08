import { z } from 'zod'
import { loadVault } from '@murphai/core'
import {
  HOSTED_PRODUCT_FEEDBACK_KINDS,
  HOSTED_PRODUCT_FEEDBACK_SUMMARY_MAX_LENGTH,
  HOSTED_RUNTIME_GROUP_DISPLAY_NAME_MAX_LENGTH,
  HOSTED_RUNTIME_GROUP_JOIN_OFFER_MESSAGE_TEMPLATE_MAX_LENGTH,
  HOSTED_RUNTIME_GROUP_KINDS,
  HOSTED_RUNTIME_NEWSLETTER_HTML_MAX_LENGTH,
  HOSTED_RUNTIME_NEWSLETTER_SUBJECT_MAX_LENGTH,
  HOSTED_RUNTIME_NEWSLETTER_TEXT_MAX_LENGTH,
  sanitizeHostedProductFeedbackSummary,
  type HostedRuntimeFamilyPlanToolRequest,
  type HostedRuntimeGroupToolRequest,
  type HostedRuntimeGroupToolResponse,
  type HostedRuntimeNewsletterParticipantSummary,
  type HostedRuntimeNewsletterScheduledAuthority,
  type HostedRuntimeNewsletterToolRequest,
  type HostedRuntimeNewsletterToolResponse,
  type HostedRuntimeProductFeedbackRecord,
} from '@murphai/hosted-execution/runtime-control'
import {
  HOSTED_VAULT_SHARE_ACTIVITY_DISTANCE_PROJECTION_KIND,
  HOSTED_VAULT_SHARE_ACTIVITY_DISTANCE_SELECTOR_ACTIVITY_KINDS,
  HOSTED_VAULT_SHARE_ACTIVITY_MINUTES_PROJECTION_KIND,
  HOSTED_VAULT_SHARE_ACTIVITY_MINUTES_SELECTOR_ACTIVITY_KINDS,
  HOSTED_VAULT_SHARE_ACTIVITY_SESSION_COUNT_PROJECTION_KIND,
  HOSTED_VAULT_SHARE_ACTIVITY_SESSION_COUNT_SELECTOR_ACTIVITY_KINDS,
  HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS,
  HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES,
  buildHostedVaultShareProjectionScopeKey,
  parseHostedVaultShareProjectionScope,
  type HostedVaultShareSelectableProjectionScope,
} from '@murphai/hosted-execution/vault-share'
import type { OverviewWeeklyStat } from '@murphai/query'
import {
  buildHostedComputerRunOperationPath,
  HOSTED_COMPUTER_ACT_CODE_MAX_LENGTH,
  HOSTED_COMPUTER_ACT_TIMEOUT_MAX_MS,
  HOSTED_COMPUTER_FINISH_OUTCOMES,
  HOSTED_COMPUTER_RUNS_PATH,
  hostedComputerActRequestSchema,
  hostedComputerOsControlRequestSchema,
  hostedComputerPauseForUserRequestSchema,
  type HostedComputerActRequest,
  type HostedComputerDeliveryContext,
  type HostedComputerFinishRunRequest,
  type HostedComputerOsControlRequest,
  type HostedComputerPauseForUserRequest,
} from '@murphai/hosted-execution/computer-use'
import {
  assistantMessageReactionSchema,
  type AssistantMessageReaction,
  type AssistantResponseMedia,
} from '@murphai/operator-config/assistant-cli-contracts'
import { normalizeNullableString } from '@murphai/operator-config/text/shared'

import type {
  AssistantGeneratedImageContentType,
  AssistantHostedGeneratedImageUploader,
  AssistantWorkspaceArtifactMaterializer,
} from '../assistant/execution-context.js'
import type {
  AssistantHostedToolContext,
} from '../assistant/hosted-tool-context.js'
import type {
  AssistantProviderUsageDraft,
} from '../assistant/providers/types.js'
import { normalizeAssistantResponseMediaList } from '../assistant/response-media.js'
import {
  buildSafeToolCallValidationDigest,
  type SafeToolCallValidationDigest,
} from '../assistant/tool-validation-digest.js'
import type {
  AssistantProgressDelivery,
  AssistantTurnProductFeedbackRecorder,
} from '../assistant/turn-progress.js'
import type {
  CodexRpcMessage,
} from './app-server-rpc.js'
import {
  executeGenerateImageTool,
  type GenerateImageToolArgs,
} from './generate-image-tool.js'
import {
  resolveGenerateImageReferences,
  type ResolvedGenerateImageReference,
} from './image-reference-resolver.js'
import {
  type GenerateSongToolArgs,
  type GenerateVoiceMemoToolArgs,
  type VoiceMemoToolRuntime,
} from './generate-voice-memo-tool.js'
import {
  executeConnectedAppsDynamicTool,
  MURPH_CONNECTED_APPS_DYNAMIC_TOOLS,
  readConnectedAppsDynamicToolRequest,
  type ConnectedAppsDynamicToolRequest,
} from './dynamic-tools/connected-apps.js'
import {
  executeGenerateVoiceMemoDynamicTool,
  MURPH_GENERATE_VOICE_MEMO_TOOL,
  parseGenerateVoiceMemoArguments,
} from './dynamic-tools/generate-voice-memo.js'
import {
  createPhoneCallRequestKey,
  MURPH_CREATE_PHONE_CALL_TOOL,
  readPhoneCallDynamicToolRequest,
  type PhoneCallDynamicToolRequest,
} from './dynamic-tools/phone-calls.js'
import {
  executeGenerateSongDynamicTool,
  MURPH_GENERATE_SONG_TOOL,
  parseGenerateSongArguments,
} from './dynamic-tools/generate-song.js'
import {
  buildGroupNewsletterSharedWeeklyStats,
  GroupNewsletterSharedProjectionUnavailableError,
  readGroupNewsletterSharedMemberDailyRecords,
  type GroupNewsletterSharedMemberDailyRecords,
} from './group-newsletter-shared-stats.js'

const HOSTED_COMPUTER_UNKNOWN_OUTCOME_TEXT =
  'computer API outcome is unknown after a transport or browser execution failure; call computer_open before retrying Playwright code or taking another step'

export const MURPH_SEND_PROGRESS_UPDATE_TOOL = {
  namespace: 'murph',
  name: 'send_progress_update',
  description:
    'Send a brief, natural user-visible progress update to the current conversation only when longer, tool-heavy, or substantial user-content-inspection work would otherwise leave the user waiting. Use as the first assistant action for genuinely long tasks that require multiple tool steps, involve research or long vault scans, or recover substantial data from PDFs, lab reports, images, screenshots, CSVs, large pasted text, meal/product/supplement labels, workout exports, wearable exports, or health documents. For work likely to finish in about a minute or less, send at most one progress update. If the turn becomes unusually long-running after substantial tool work, you may send up to two more brief updates so the user is not left hanging; never send a fourth. Prefer skipping progress updates on quota-sensitive messaging surfaces such as Linq/iMessage unless the update materially improves UX. Skip automatically transcribed voice memo or audio content unless manual media tools or broader long-running work are needed. Do not use for individual tool loops, searches, reads, page checks, clicks, status churn, skill-file reads alone, setup checks, routine single-command vault reads, quick single-step replies, one-shot logging/capture/memory saves that only need a straightforward write, or final conclusions.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      text: {
        type: 'string',
        minLength: 1,
        description:
          'Prefer one short conversational first-person sentence about the immediate next step; use two only when needed to keep the quick note clear. Use contractions when natural. Avoid stiff plan-recitation wording like "I\'m going to..." when a shorter "I\'ll..." or "Taking a look..." works. Write it the way a person would text: everyday words about what the user cares about, never internal mechanics or instruction vocabulary such as "preserving the source", "structured import", "parse", "canonical records", or "delegating" — "Got your labs, pulling the numbers in now" beats "starting the structured lab import". No markdown links, final answers, lab interpretations, abnormalities, diagnoses, treatment recommendations, or claims not yet verified.',
      },
    },
    required: ['text'],
  },
} as const

export const MURPH_ATTACH_RESPONSE_MEDIA_TOOL = {
  namespace: 'murph',
  name: 'attach_response_media',
  description:
    'Attach image media to the current final assistant response. Replaces the current response media batch for this turn only. It does not send directly.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      media: {
        type: 'array',
        maxItems: 40,
        description:
          'The complete image batch for the final assistant reply. Passing an empty array clears the current reply media batch.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: {
              type: 'string',
              enum: ['image'],
              description: 'Only image response media is supported.',
            },
            url: {
              type: 'string',
              description:
                'Public HTTPS image-file URL. URLs with credentials, query strings, fragments, localhost hosts, IP literals, or non-image extensions are rejected.',
            },
            alt: {
              anyOf: [
                { type: 'string', minLength: 1, maxLength: 500 },
                { type: 'null' },
              ],
              description: 'Optional alt text for the image.',
            },
            source: {
              anyOf: [
                { type: 'string', minLength: 1, maxLength: 200 },
                { type: 'null' },
              ],
              description: 'Optional catalog item id or source label.',
            },
          },
          required: ['url'],
        },
      },
    },
    required: ['media'],
  },
} as const

export const MURPH_GENERATE_IMAGE_TOOL = {
  namespace: 'murph',
  name: 'generate_image',
  description:
    'Generate one image with GPT Image 2, optionally using ordered vault image references. When referenceImageRefs is provided, describe in the prompt how image 1, image 2, etc. should be used. Hosted runs attach the generated image to the final response; local runs save it under CODEX_HOME/generated_images.',
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
        description:
          'Optional ordered vault-relative JPG, PNG, or WebP image refs to use as visual references (up to 16). Refs must be user-sent media under raw/inbox/** or captured media under raw/captures/** (other vault paths are rejected as unauthorized). Describe in the prompt how image 1, image 2, etc. should be used.',
        items: {
          type: 'string',
          minLength: 1,
          maxLength: 1024,
        },
      },
    },
    required: ['prompt'],
  },
} as const

export const MURPH_SUBMIT_PRODUCT_FEEDBACK_TOOL = {
  namespace: 'murph',
  name: 'submit_product_feedback',
  description:
    'Record structured product feedback from explicit user feedback, clear inferred workflow friction, or repeated Murph-observed product/tool friction. Prefix inferred summaries with "Speculative:" and assistant-observed summaries with "Murph-observed:". Related changelog ids are optional metadata, not required for product interest. Never include tags, topics, raw user wording, raw conversation text, health details, identifiers, contact details, secrets, or provider payloads.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      kind: {
        type: 'string',
        enum: [...HOSTED_PRODUCT_FEEDBACK_KINDS],
      },
      summary: {
        type: 'string',
        minLength: 1,
        maxLength: HOSTED_PRODUCT_FEEDBACK_SUMMARY_MAX_LENGTH,
        description:
          'Concise product-only summary. Start with "Speculative:" only for clear inferred user workflow friction, or "Murph-observed:" only for repeated assistant-observed product/tool friction. Do not include tags, topics, raw user wording, health details, identifiers, contact details, secrets, or provider payloads.',
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
    'Read or manage the current hosted user\'s Murph Family plan. Use for Murph Family plan questions, seat/status checks, starting Family checkout, and requests to invite a family member. Do not use for family medical history.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      action: {
        type: 'string',
        enum: ['read_status', 'start_checkout', 'create_invite'],
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
        description:
          'Invite target for create_invite. Optional context for start_checkout when the user mentions the person they want to invite; no invite token is created until Family billing is active.',
      },
    },
    required: ['action'],
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

export const MURPH_GROUP_TOOL = {
  namespace: 'murph',
  name: 'group',
  description:
    'Read the current hosted group and its member roster (member ids, chat handles, and each member\'s granted share kinds) with action="read_current", request an update to both the current hosted group display name and current iMessage group chat title with action="update_display_name", request an update to the current iMessage group avatar with action="set_chat_avatar", mint the shareable group join link with action="create_join_link", or post a server-owned react-to-join offer into the current group chat with action="post_join_offer". update_display_name sends a provider request for the upstream iMessage group chat title on the current route-authorized group chat and stores the same name in Murph after the provider accepts the request. set_chat_avatar sends a provider request for the upstream iMessage group icon on the current route-authorized group chat after the runtime preflights chat authority and prepares a hosted image URL. A join link grants membership and shares the joiner\'s profile display name with this group runtime; optional permissions stay individually selected on the join page. A join offer uses your short natural messageTemplate to state what reacting shares with {{share_scope}} and include the customize link with {{join_url}} so people can share more or less. Pass displayName on create_join_link or post_join_offer only when it is the name the group chose. Reactions grant membership plus only the posted permission snapshot. Do not use a fixed script. Use action="read_chat_participants" to see who is in this group chat and whether each participant already has their own Murph; use action="share_contact_card" to drop your contact card into this chat once so people who do not have you saved can tap it, save you, and text you directly. Use action="revoke_own_email_share" only when the current sender asks to stop receiving group newsletter email; the runtime identifies the current sender and revokes only that sender\'s group-email.v0 grant. This tool does not manage members, grant Family billing access, grant private chat access, grant raw vault access, or grant email sharing except through an explicit group-email.v0 join page or offer.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      action: {
        type: 'string',
        enum: [
          'read_current',
          'update_display_name',
          'create_join_link',
          'post_join_offer',
          'read_chat_participants',
          'set_chat_avatar',
          'share_contact_card',
          'revoke_own_email_share',
        ],
      },
      displayName: {
        type: 'string',
        minLength: 1,
        maxLength: HOSTED_RUNTIME_GROUP_DISPLAY_NAME_MAX_LENGTH,
        description:
          'Group display name. Required for action="update_display_name", which requests the iMessage group chat title update and stores the same hosted group label; optional for action="create_join_link" or action="post_join_offer" only when it is the name the group chose.',
      },
      avatarSource: {
        type: 'string',
        enum: ['generate', 'image_ref'],
        description:
          'Required for action="set_chat_avatar". Use "generate" to create a new square avatar from prompt, or "image_ref" to reuse one user-sent JPG, PNG, or WebP image ref.',
      },
      prompt: {
        type: 'string',
        minLength: 1,
        maxLength: 4000,
        description:
          'Required for action="set_chat_avatar" with avatarSource="generate". Prompt for one square group chat avatar image.',
      },
      imageRef: {
        type: 'string',
        minLength: 1,
        maxLength: 1024,
        description:
          'Required for action="set_chat_avatar" with avatarSource="image_ref". A user-sent JPG, PNG, or WebP ref under raw/inbox/** or raw/captures/**.',
      },
      size: {
        type: 'string',
        enum: ['1024x1024'],
        default: '1024x1024',
        description: 'For generated group avatars. Group avatars are square.',
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
        description: 'Optional alt text for the generated or reused avatar image.',
      },
      referenceImageRefs: {
        type: 'array',
        maxItems: 16,
        default: [],
        description:
          'Optional ordered JPG, PNG, or WebP image refs to use as visual references when action="set_chat_avatar" and avatarSource="generate".',
        items: {
          type: 'string',
          minLength: 1,
          maxLength: 1024,
        },
      },
      kind: {
        type: 'string',
        enum: [...HOSTED_RUNTIME_GROUP_KINDS],
        description: 'Optional group kind when creating a join link.',
      },
      requestedVaultShareProjectionScopes: {
        type: 'array',
        maxItems: HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES.length,
        items: GROUP_VAULT_SHARE_PROJECTION_SCOPE_SCHEMA,
        description:
          'Optional bounded health projection scopes the join page may offer joining members. Joining never shares them automatically; each member approves their own selection. Use activity-minutes-days.v1 with a recognized activity alias, activity-distance-days.v1 with a distance-capable movement alias for daily distance plus session count, or activity-session-count-days.v1 with a recognized activity/intervention alias.',
      },
      projectionScopes: {
        type: 'array',
        maxItems: HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES.length,
        items: GROUP_VAULT_SHARE_PROJECTION_SCOPE_SCHEMA,
        description:
          'Optional bounded health projections that reacting to the server-owned offer message will grant as a fixed snapshot. The server-filled {{share_scope}} placeholder always states that profile display name is shared too.',
      },
      messageTemplate: {
        type: 'string',
        minLength: 1,
        maxLength: HOSTED_RUNTIME_GROUP_JOIN_OFFER_MESSAGE_TEMPLATE_MAX_LENGTH,
        description:
          'Required for action="post_join_offer". Write one short natural group-chat message, not a fixed script. Lead with reacting to this message to join. Include {{share_scope}} exactly once where the server inserts the exact shared-scope phrase. Include {{join_url}} exactly once as the customize link so members can share more or less. Do not include any other URL.',
      },
    },
    required: ['action'],
  },
} as const

export const MURPH_NEWSLETTER_TOOL = {
  namespace: 'murph',
  name: 'newsletter',
  description:
    'Read or send the current hosted group health newsletter. Use action="read_stats" with a groupId to get opted-in participants only, each participant\'s member id, display name, hasEmail flag, shared weekly health rollups, group superlatives, and participants without a verified email. Use action="send" only during the scheduled newsletter run after the setup notice and opt-out window have elapsed; never send the first edition immediately after creating or editing the newsletter automation. It sends one shared email thread to participants who granted email authorization and have a verified email. This tool never returns raw email addresses and does not create or edit the cron automation.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      action: {
        type: 'string',
        enum: ['read_stats', 'send'],
      },
      groupId: {
        type: 'string',
        minLength: 1,
      },
      subject: {
        type: 'string',
        minLength: 1,
        maxLength: HOSTED_RUNTIME_NEWSLETTER_SUBJECT_MAX_LENGTH,
      },
      html: {
        type: 'string',
        minLength: 1,
        maxLength: HOSTED_RUNTIME_NEWSLETTER_HTML_MAX_LENGTH,
      },
      text: {
        anyOf: [
          {
            type: 'string',
            maxLength: HOSTED_RUNTIME_NEWSLETTER_TEXT_MAX_LENGTH,
          },
          { type: 'null' },
        ],
        default: null,
      },
    },
    required: ['action', 'groupId'],
  },
} as const

export const MURPH_SEND_VAULT_FILE_TOOL = {
  namespace: 'murph',
  name: 'send_vault_file',
  description:
    "Securely prepare one existing file from the user's vault for the current iMessage conversation. Use a normalized vault-relative file path. When approval is pending, include the returned approval link in your normal reply. When approval is approved, attach the file through your normal reply path and write a natural acknowledgment instead of reciting internal queue or delivery-status wording. Do not claim final iMessage delivery unless later delivery evidence confirms it. It does not reveal file bytes to the model and does not support arbitrary recipients.",
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ref: {
        type: 'string',
        minLength: 1,
        maxLength: 1024,
        description:
          'Normalized vault-relative path, for example documents/report.pdf. Hidden paths, traversal, absolute paths, and unsupported file types are rejected.',
      },
    },
    required: ['ref'],
  },
} as const

export const MURPH_FINISH_WITHOUT_REPLY_TOOL = {
  namespace: 'murph',
  name: 'finish_without_reply',
  description:
    'Finish the turn without sending a text reply.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {},
  },
} as const

export const MURPH_REACT_TO_MESSAGE_TOOL = {
  namespace: 'murph',
  name: 'react_to_message',
  description:
    'React to the current inbound message when the active channel supports reactions. This does not send text and does not finish the turn.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      reaction: {
        type: 'string',
        enum: ['heart', 'thumbs_up', 'laugh'],
      },
    },
    required: ['reaction'],
  },
} as const

export const MURPH_COMPUTER_OPEN_TOOL = {
  namespace: 'murph',
  name: 'computer_open',
  description:
    'Open the current Kernel-backed browser for website tasks. Creates, reuses, resumes, or reclaims the active browser run as needed, then returns the current URL, title, and visible page text. Use this before browser work and whenever browser control may have returned from a user handoff.',
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

function asRecord(value: unknown): Record<string, unknown> | null {
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
        'A complete Playwright macro-step, not one primitive interaction. The page, context, and browser objects are in scope. Combine all deterministic operations that can safely run without another model decision: navigation, locator-based queries, form fields, selection, clicking, bounded waits via locator.waitFor() / page.waitForURL() / page.waitForLoadState(), and final verification. Return only compact JSON-serializable state (URL, title, relevant text, errors) needed for the next decision.',
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
    'Execute one coherent browser macro-step against the current Kernel page using bounded Playwright TypeScript/JavaScript. Combine navigation, inspection, waits, known form entry, selection, clicking or submission, and final verification in a single call whenever the next operation does not require new model judgment. Split into a second call only at: ambiguity in user intent, missing user data, sensitive input (passwords, payment details, one-time codes), irreversible confirmation, an unknown page transition, or the per-call timeout. Prefer locator.waitFor(), page.waitForURL(), and page.waitForLoadState() over fixed sleeps. Return compact JSON-serializable state (URL, title, relevant text, errors) so the next decision does not need another computer_open call.',
  inputSchema: MURPH_COMPUTER_ACT_INPUT_SCHEMA,
} as const

export const MURPH_COMPUTER_OS_CONTROL_TOOL = {
  namespace: 'murph',
  name: 'computer_os_control',
  description:
    'Fallback only: run one bounded OS-level mouse or keyboard action against the current Kernel browser when computer_act cannot operate the page. Prefer computer_act for normal browser automation. Do not use for passwords, payment details, one-time codes, tokens, or any sensitive private input. After an OS-level action with an unknown outcome, use computer_open once to confirm the resulting page state.',
  inputSchema: MURPH_COMPUTER_OS_CONTROL_INPUT_SCHEMA,
} as const

export const MURPH_COMPUTER_PAUSE_FOR_USER_TOOL = {
  namespace: 'murph',
  name: 'computer_pause_for_user',
  description:
    'Pause a computer run for missing user input, direct user takeover, or browser inspection; store a durable checkpoint; and optionally create a secure browser handoff link. The tool does not send a user-visible message; use the normal final response to summarize the pause and include the returned handoffUrl when takeover or inspection is needed.',
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
    'Finish a computer run and close the Kernel browser, persisting profile changes when configured.',
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
  MURPH_ATTACH_RESPONSE_MEDIA_TOOL,
  MURPH_GENERATE_IMAGE_TOOL,
  MURPH_GENERATE_VOICE_MEMO_TOOL,
  MURPH_FAMILY_PLAN_TOOL,
  MURPH_GROUP_TOOL,
  MURPH_NEWSLETTER_TOOL,
  MURPH_GENERATE_SONG_TOOL,
  MURPH_SUBMIT_PRODUCT_FEEDBACK_TOOL,
  MURPH_SEND_VAULT_FILE_TOOL,
  MURPH_FINISH_WITHOUT_REPLY_TOOL,
  MURPH_REACT_TO_MESSAGE_TOOL,
  MURPH_CREATE_PHONE_CALL_TOOL,
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

export type MurphDynamicTool = (typeof MURPH_DYNAMIC_TOOLS)[number]

export interface MurphDynamicToolAvailability {
  allowFinishWithoutReply?: boolean | null
  allowMessageReactions?: boolean | null
  computerToolsAvailable?: boolean | null
  progressUpdatesAvailable?: boolean | null
  connectedAppsAvailable?: boolean | null
  familyPlanAvailable?: boolean | null
  groupAvailable?: boolean | null
  newsletterAvailable?: boolean | null
  productFeedbackAvailable?: boolean | null
  phoneCallsAvailable?: boolean | null
  voiceMemoGenerationAvailable?: boolean | null
  vaultFileSendAvailable?: boolean | null
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
    [MURPH_FINISH_WITHOUT_REPLY_TOOL, defaultOn((a) => a.allowFinishWithoutReply)],
    [MURPH_REACT_TO_MESSAGE_TOOL, defaultOff((a) => a.allowMessageReactions)],
    [MURPH_SUBMIT_PRODUCT_FEEDBACK_TOOL, defaultOff((a) => a.productFeedbackAvailable)],
    [MURPH_FAMILY_PLAN_TOOL, defaultOff((a) => a.familyPlanAvailable)],
    [MURPH_GROUP_TOOL, defaultOff((a) => a.groupAvailable)],
    [MURPH_NEWSLETTER_TOOL, defaultOff((a) => a.newsletterAvailable)],
    [MURPH_GENERATE_VOICE_MEMO_TOOL, defaultOff((a) => a.voiceMemoGenerationAvailable)],
    [MURPH_GENERATE_SONG_TOOL, defaultOff((a) => a.voiceMemoGenerationAvailable)],
    [MURPH_SEND_VAULT_FILE_TOOL, defaultOff((a) => a.vaultFileSendAvailable)],
    [MURPH_CREATE_PHONE_CALL_TOOL, defaultOff((a) => a.phoneCallsAvailable)],
    ...MURPH_COMPUTER_DYNAMIC_TOOLS.map(
      (tool) =>
        [tool, defaultOff((a) => a.computerToolsAvailable)] as const,
    ),
    ...MURPH_CONNECTED_APPS_DYNAMIC_TOOLS.map(
      (tool) =>
        [tool, defaultOff((a) => a.connectedAppsAvailable)] as const,
    ),
  ])

export function resolveMurphDynamicTools(
  availability: MurphDynamicToolAvailability,
): readonly MurphDynamicTool[] {
  return MURPH_DYNAMIC_TOOLS.filter((tool) =>
    (TOOL_AVAILABILITY.get(tool) ?? ALWAYS_AVAILABLE)(availability),
  )
}

export function listMurphDynamicToolNames(): string[] {
  return MURPH_DYNAMIC_TOOLS.map((tool) => `${tool.namespace}.${tool.name}`)
}

const CODEX_DYNAMIC_TOOL_CALL_METHOD = 'item/tool/call'

const attachResponseMediaArgumentsSchema = z
  .object({
    media: z.array(z.unknown()).max(40),
  })
  .strict()

const sendProgressUpdateArgumentsSchema = z
  .object({
    text: z.string().trim().min(1),
  })
  .strict()

const generateImageArgumentsSchema = z
  .object({
    alt: z.string().trim().min(1).max(500).nullable().default(null),
    outputFormat: z.enum(['webp', 'png', 'jpeg']).default('webp'),
    prompt: z.string().trim().min(1).max(4000),
    quality: z.enum(['low', 'medium', 'high']).default('medium'),
    referenceImageRefs: z
      .array(z.string().trim().min(1).max(1024))
      .max(16)
      .default([]),
    size: z.enum(['1024x1024', '1024x1536', '1536x1024']).default('1024x1024'),
  })
  .strict()

const GROUP_JOIN_OFFER_JOIN_URL_PLACEHOLDER = '{{join_url}}'
const GROUP_JOIN_OFFER_SHARE_SCOPE_PLACEHOLDER = '{{share_scope}}'

function hasUsableGroupJoinOfferPlaceholders(messageTemplate: string): boolean {
  return hasPlaceholderExactlyOnce(
    messageTemplate,
    GROUP_JOIN_OFFER_SHARE_SCOPE_PLACEHOLDER,
  ) && hasPlaceholderExactlyOnce(
    messageTemplate,
    GROUP_JOIN_OFFER_JOIN_URL_PLACEHOLDER,
  )
}

function hasPlaceholderExactlyOnce(messageTemplate: string, placeholder: string): boolean {
  return (
    messageTemplate.includes(placeholder)
    && messageTemplate.indexOf(placeholder) === messageTemplate.lastIndexOf(placeholder)
  )
}

const selectableVaultShareProjectionScopeByKey =
  new Map<string, HostedVaultShareSelectableProjectionScope>(
    HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES.map((scope) => [
      buildHostedVaultShareProjectionScopeKey(scope),
      scope,
    ]),
  )

const groupVaultShareProjectionScopeSchema = z.unknown().transform((value, context) => {
  let parsedScope: ReturnType<typeof parseHostedVaultShareProjectionScope>
  try {
    parsedScope = parseHostedVaultShareProjectionScope(
      value,
      'murph.group vault share projection scope',
    )
  } catch (error) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: error instanceof Error
        ? error.message
        : 'Vault share projection scope is not supported.',
    })
    return z.NEVER
  }
  const scope = selectableVaultShareProjectionScopeByKey.get(
    buildHostedVaultShareProjectionScopeKey(parsedScope),
  )
  if (!scope) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Vault share projection scope is not selectable.',
    })
    return z.NEVER
  }
  return scope
})

const groupArgumentsSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('read_current'),
    })
    .strict(),
  z
    .object({
      action: z.literal('update_display_name'),
      displayName: z
        .string()
        .trim()
        .min(1)
        .max(HOSTED_RUNTIME_GROUP_DISPLAY_NAME_MAX_LENGTH),
    })
    .strict(),
  z
    .object({
      action: z.literal('set_chat_avatar'),
      alt: z.string().trim().min(1).max(500).nullable().default(null),
      avatarSource: z.enum(['generate', 'image_ref']),
      imageRef: z.string().trim().min(1).max(1024).optional(),
      outputFormat: z.enum(['webp', 'png', 'jpeg']).default('webp'),
      prompt: z.string().trim().min(1).max(4000).optional(),
      quality: z.enum(['low', 'medium', 'high']).default('medium'),
      referenceImageRefs: z
        .array(z.string().trim().min(1).max(1024))
        .max(16)
        .default([]),
      size: z.literal('1024x1024').default('1024x1024'),
    })
    .strict(),
  z
    .object({
      action: z.literal('read_chat_participants'),
    })
    .strict(),
  z
    .object({
      action: z.literal('share_contact_card'),
    })
    .strict(),
  z
    .object({
      action: z.literal('post_join_offer'),
      displayName: z
        .string()
        .trim()
        .min(1)
        .max(HOSTED_RUNTIME_GROUP_DISPLAY_NAME_MAX_LENGTH)
        .optional(),
      messageTemplate: z
        .string()
        .trim()
        .min(1)
        .max(HOSTED_RUNTIME_GROUP_JOIN_OFFER_MESSAGE_TEMPLATE_MAX_LENGTH)
        .refine(hasUsableGroupJoinOfferPlaceholders, {
          message:
            'post_join_offer messageTemplate must contain {{share_scope}} exactly once and {{join_url}} exactly once',
        }),
      projectionScopes: z
        .array(groupVaultShareProjectionScopeSchema)
        .max(HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES.length)
        .optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('revoke_own_email_share'),
    })
    .strict(),
  z
    .object({
      action: z.literal('create_join_link'),
      displayName: z
        .string()
        .trim()
        .min(1)
        .max(HOSTED_RUNTIME_GROUP_DISPLAY_NAME_MAX_LENGTH)
        .optional(),
      kind: z.enum(HOSTED_RUNTIME_GROUP_KINDS).optional(),
      requestedVaultShareProjectionScopes: z
        .array(groupVaultShareProjectionScopeSchema)
        .max(HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES.length)
        .optional(),
    })
    .strict(),
])

const newsletterArgumentsSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('read_stats'),
      groupId: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal('send'),
      groupId: z.string().trim().min(1),
      html: z.string().trim().min(1).max(HOSTED_RUNTIME_NEWSLETTER_HTML_MAX_LENGTH),
      subject: z.string().trim().min(1).max(HOSTED_RUNTIME_NEWSLETTER_SUBJECT_MAX_LENGTH),
      text: z
        .string()
        .trim()
        .max(HOSTED_RUNTIME_NEWSLETTER_TEXT_MAX_LENGTH)
        .nullable()
        .optional(),
    })
    .strict(),
])

const sendVaultFileArgumentsSchema = z
  .object({
    ref: z.string().trim().min(1).max(1024),
  })
  .strict()

const finishWithoutReplyArgumentsSchema = z.object({}).strict()

const submitProductFeedbackArgumentsSchema = z
  .object({
    kind: z.enum(HOSTED_PRODUCT_FEEDBACK_KINDS),
    summary: z
      .string()
      .trim()
      .min(1)
      .transform(sanitizeHostedProductFeedbackSummary)
      .pipe(z.string().min(1).max(HOSTED_PRODUCT_FEEDBACK_SUMMARY_MAX_LENGTH)),
    relatedChangelogItemIds: z
      .array(z.string().trim().max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u))
      .max(7)
      .default([]),
  })
  .strict()

const familyPlanArgumentsSchema = z
  .discriminatedUnion('action', [
    z.object({
      action: z.literal('read_status'),
    }).strict(),
    z.object({
      action: z.literal('start_checkout'),
      invite: z.object({
        targetEmail: z.string().trim().email().max(320).nullable().default(null),
        targetLabel: z.string().trim().min(1).max(80).nullable().default(null),
        targetPhoneNumber: z.string().trim().min(1).max(40).nullable().default(null),
        targetTelegramUsername: z.string().trim().min(5).max(32).nullable().default(null),
      }).strict().nullable().default(null),
    }).strict(),
    z.object({
      action: z.literal('create_invite'),
      invite: z.object({
        targetEmail: z.string().trim().email().max(320).nullable().default(null),
        targetLabel: z.string().trim().min(1).max(80).nullable().default(null),
        targetPhoneNumber: z.string().trim().min(1).max(40).nullable().default(null),
        targetTelegramUsername: z.string().trim().min(5).max(32).nullable().default(null),
      }).strict(),
    }).strict(),
  ])
  .superRefine((value, context) => {
    const invite = value.action === 'create_invite'
      ? value.invite
      : value.action === 'start_checkout'
        ? value.invite
        : null
    if (invite && !invite.targetPhoneNumber && !invite.targetTelegramUsername && !invite.targetEmail) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Family invite requires a phone number, Telegram username, or email.',
        path: ['invite'],
      })
    }
  })

const computerRunIdSchema = z.string().trim().min(1)

const COMPUTER_OPEN_ARGUMENT_ROOT_KEYS = [
  'startUrl',
] as const

const computerNavigationUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(4_000)

const computerOpenArgumentsSchema = z
  .object({
    startUrl: computerNavigationUrlSchema.nullable().default(null),
  })
  .strict()

const computerActArgumentsSchema = z.unknown().transform((value, ctx) => {
  const withRunId = z
    .object({
      runId: computerRunIdSchema,
    })
    .passthrough()
    .safeParse(value)
  if (!withRunId.success) {
    for (const issue of withRunId.error.issues) {
      ctx.addIssue({
        code: 'custom',
        message: issue.message,
        path: issue.path,
      })
    }
    return z.NEVER
  }

  const { runId, ...body } = withRunId.data
  const parsedBody = hostedComputerActRequestSchema.safeParse(body)
  if (!parsedBody.success) {
    for (const issue of parsedBody.error.issues) {
      ctx.addIssue({
        code: 'custom',
        message: issue.message,
        path: issue.path,
      })
    }
    return z.NEVER
  }

  return {
    ...parsedBody.data,
    runId,
  }
})

const computerOsControlArgumentsSchema = z.unknown().transform((value, ctx) => {
  const withRunId = z
    .object({
      runId: computerRunIdSchema,
    })
    .passthrough()
    .safeParse(value)
  if (!withRunId.success) {
    for (const issue of withRunId.error.issues) {
      ctx.addIssue({
        code: 'custom',
        message: issue.message,
        path: issue.path,
      })
    }
    return z.NEVER
  }

  const { runId, ...body } = withRunId.data
  const parsedBody = hostedComputerOsControlRequestSchema.safeParse(body)
  if (!parsedBody.success) {
    for (const issue of parsedBody.error.issues) {
      ctx.addIssue({
        code: 'custom',
        message: issue.message,
        path: issue.path,
      })
    }
    return z.NEVER
  }

  return {
    ...parsedBody.data,
    runId,
  }
})

const computerPauseForUserArgumentsSchema = z.unknown().transform((value, ctx) => {
  const withRunId = z
    .object({
      runId: computerRunIdSchema,
    })
    .passthrough()
    .safeParse(value)
  if (!withRunId.success) {
    for (const issue of withRunId.error.issues) {
      ctx.addIssue({
        code: 'custom',
        message: issue.message,
        path: issue.path,
      })
    }
    return z.NEVER
  }

  const { runId, ...body } = withRunId.data
  const parsedBody = hostedComputerPauseForUserRequestSchema.safeParse(body)
  if (!parsedBody.success) {
    for (const issue of parsedBody.error.issues) {
      ctx.addIssue({
        code: 'custom',
        message: issue.message,
        path: issue.path,
      })
    }
    return z.NEVER
  }

  return {
    ...parsedBody.data,
    runId,
  }
})

const computerFinishRunArgumentsSchema = z
  .object({
    outcome: z.enum(HOSTED_COMPUTER_FINISH_OUTCOMES),
    runId: computerRunIdSchema,
  })
  .strict()

const reactToMessageArgumentsSchema = z
  .object({
    reaction: assistantMessageReactionSchema,
  })
  .strict()

export type MurphDynamicToolResponseMediaPatch = {
  media: AssistantResponseMedia[]
  op: 'append' | 'replace'
}

export type MurphDynamicToolFinalActionPatch = {
  kind: 'none'
}

export type MurphDynamicToolReactionPatch = {
  reaction: AssistantMessageReaction
}

type MurphDynamicToolRpcResult = {
  success: boolean
  contentItems: Array<{
    type: 'inputText'
    text: string
  }>
}

type ComputerOpenToolArgs = z.infer<typeof computerOpenArgumentsSchema>

type HostedComputerToolPayloadSanitizer =
  | 'act'
  | 'finish'
  | 'os-control'
  | 'open'

export interface MurphDynamicToolExecutionResult {
  computerRunPausedForUser?: boolean
  finalActionPatch?: MurphDynamicToolFinalActionPatch
  reactionPatch?: MurphDynamicToolReactionPatch
  responseMediaPatch?: MurphDynamicToolResponseMediaPatch
  rpcResult: MurphDynamicToolRpcResult
  usageDraft?: AssistantProviderUsageDraft | null
}

interface ParsedDynamicToolCallRequest {
  arguments: unknown
  namespace: string | null
  tool: string | null
}

type MurphGroupToolRequest =
  | HostedRuntimeGroupToolRequest
  | {
      action: 'set_chat_avatar'
      avatar:
        | {
            source: 'generate'
            args: GenerateImageToolArgs
          }
        | {
            source: 'image_ref'
            alt: string | null
            imageRef: string
          }
    }

export type MurphDynamicToolRequest =
  | ConnectedAppsDynamicToolRequest
  | {
      kind: 'attach-response-media'
      media: AssistantResponseMedia[]
    }
  | {
      kind: 'generate-image'
      args: GenerateImageToolArgs
    }
  | {
      kind: 'generate-voice-memo'
      args: GenerateVoiceMemoToolArgs
    }
  | {
      kind: 'generate-song'
      args: GenerateSongToolArgs
    }
  | {
      kind: 'computer-open'
      args: ComputerOpenToolArgs
    }
  | {
      kind: 'computer-act'
      args: HostedComputerActRequest & { runId: string }
    }
  | {
      kind: 'computer-os-control'
      args: HostedComputerOsControlRequest & { runId: string }
    }
  | {
      kind: 'computer-pause-for-user'
      args: HostedComputerPauseForUserRequest & { runId: string }
    }
  | {
      kind: 'computer-finish-run'
      args: HostedComputerFinishRunRequest & { runId: string }
    }
  | PhoneCallDynamicToolRequest
  | {
      kind: 'send-vault-file'
      ref: string
    }
  | {
      kind: 'invalid-send-vault-file-arguments'
      validationDigest: SafeToolCallValidationDigest
    }
  | {
      kind: 'invalid-computer-arguments'
      validationDigest: SafeToolCallValidationDigest
    }
  | {
      kind: 'invalid-generate-image-arguments'
      validationDigest: SafeToolCallValidationDigest
    }
  | {
      kind: 'invalid-generate-voice-memo-arguments'
      validationDigest: SafeToolCallValidationDigest
    }
  | {
      kind: 'invalid-generate-song-arguments'
      validationDigest: SafeToolCallValidationDigest
    }
  | {
      kind: 'invalid-finish-without-reply-arguments'
      validationDigest: SafeToolCallValidationDigest
    }
  | {
      kind: 'invalid-response-media-arguments'
      validationDigest: SafeToolCallValidationDigest
    }
  | {
      kind: 'invalid-progress-arguments'
      validationDigest: SafeToolCallValidationDigest
    }
  | {
      kind: 'invalid-reaction-arguments'
      validationDigest: SafeToolCallValidationDigest
    }
  | {
      kind: 'invalid-product-feedback-arguments'
      validationDigest: SafeToolCallValidationDigest
    }
  | {
      kind: 'invalid-family-plan-arguments'
      validationDigest: SafeToolCallValidationDigest
    }
  | {
      kind: 'invalid-group-arguments'
      validationDigest: SafeToolCallValidationDigest
    }
  | {
      kind: 'invalid-newsletter-arguments'
      validationDigest: SafeToolCallValidationDigest
    }
  | {
      kind: 'family-plan'
      request: HostedRuntimeFamilyPlanToolRequest
    }
  | {
      kind: 'group'
      request: MurphGroupToolRequest
    }
  | {
      kind: 'newsletter'
      request: HostedRuntimeNewsletterToolRequest
    }
  | {
      kind: 'submit-product-feedback'
      feedback: Omit<HostedRuntimeProductFeedbackRecord, 'idempotencyKey'>
    }
  | {
      kind: 'send-progress-update'
      text: string
    }
  | {
      kind: 'react-to-message'
      reaction: AssistantMessageReaction
    }
  | {
      kind: 'finish-without-reply'
    }
  | {
      kind: 'unsupported-dynamic-tool'
      namespace: string | null
      tool: string | null
    }

function isMurphDynamicToolNamespace(namespace: string | null): boolean {
  return namespace === MURPH_SEND_PROGRESS_UPDATE_TOOL.namespace
}

export function readMurphDynamicToolRequest(
  message: CodexRpcMessage,
): MurphDynamicToolRequest | null {
  const request = parseDynamicToolCallRequest(message)
  if (!request) {
    return null
  }

  if (!isMurphDynamicToolNamespace(request.namespace)) {
    return {
      kind: 'unsupported-dynamic-tool',
      namespace: request.namespace,
      tool: request.tool,
    }
  }

  const connectedAppsRequest = readConnectedAppsDynamicToolRequest({
    arguments: request.arguments,
    tool: request.tool,
  })
  if (connectedAppsRequest) {
    return connectedAppsRequest
  }

  const phoneCallRequest = readPhoneCallDynamicToolRequest({
    arguments: request.arguments,
    tool: request.tool,
  })
  if (phoneCallRequest) {
    return phoneCallRequest
  }

  switch (request.tool) {
    case MURPH_SEND_PROGRESS_UPDATE_TOOL.name: {
      const parsed = parseSendProgressUpdateArguments(request.arguments)
      if (!parsed.ok) {
        return {
          kind: 'invalid-progress-arguments',
          validationDigest: parsed.validationDigest,
        }
      }

      return {
        kind: 'send-progress-update',
        text: parsed.text,
      }
    }
    case MURPH_ATTACH_RESPONSE_MEDIA_TOOL.name: {
      const parsed = parseAttachResponseMediaArguments(request.arguments)
      if (!parsed.ok) {
        return {
          kind: 'invalid-response-media-arguments',
          validationDigest: parsed.validationDigest,
        }
      }

      return {
        kind: 'attach-response-media',
        media: parsed.media,
      }
    }
    case MURPH_GENERATE_IMAGE_TOOL.name: {
      const parsed = parseGenerateImageArguments(request.arguments)
      if (!parsed.ok) {
        return {
          kind: 'invalid-generate-image-arguments',
          validationDigest: parsed.validationDigest,
        }
      }

      return {
        kind: 'generate-image',
        args: parsed.args,
      }
    }
    case MURPH_GENERATE_VOICE_MEMO_TOOL.name: {
      const parsed = parseGenerateVoiceMemoArguments(request.arguments)
      if (!parsed.ok) {
        return {
          kind: 'invalid-generate-voice-memo-arguments',
          validationDigest: parsed.validationDigest,
        }
      }

      return {
        kind: 'generate-voice-memo',
        args: parsed.args,
      }
    }
    case MURPH_GENERATE_SONG_TOOL.name: {
      const parsed = parseGenerateSongArguments(request.arguments)
      if (!parsed.ok) {
        return {
          kind: 'invalid-generate-song-arguments',
          validationDigest: parsed.validationDigest,
        }
      }

      return {
        kind: 'generate-song',
        args: parsed.args,
      }
    }
    case MURPH_SEND_VAULT_FILE_TOOL.name: {
      const parsed = parseSendVaultFileArguments(request.arguments)
      if (!parsed.ok) {
        return {
          kind: 'invalid-send-vault-file-arguments',
          validationDigest: parsed.validationDigest,
        }
      }
      return {
        kind: 'send-vault-file',
        ref: parsed.ref,
      }
    }
    case MURPH_SUBMIT_PRODUCT_FEEDBACK_TOOL.name: {
      const parsed = parseSubmitProductFeedbackArguments(request.arguments)
      if (!parsed.ok) {
        return {
          kind: 'invalid-product-feedback-arguments',
          validationDigest: parsed.validationDigest,
        }
      }
      return {
        kind: 'submit-product-feedback',
        feedback: parsed.feedback,
      }
    }
    case MURPH_FAMILY_PLAN_TOOL.name: {
      const parsed = parseFamilyPlanArguments(request.arguments)
      if (!parsed.ok) {
        return {
          kind: 'invalid-family-plan-arguments',
          validationDigest: parsed.validationDigest,
        }
      }
      return {
        kind: 'family-plan',
        request: parsed.request,
      }
    }
    case MURPH_GROUP_TOOL.name: {
      const parsed = parseGroupArguments(request.arguments)
      if (!parsed.ok) {
        return {
          kind: 'invalid-group-arguments',
          validationDigest: parsed.validationDigest,
        }
      }
      return {
        kind: 'group',
        request: parsed.request,
      }
    }
    case MURPH_NEWSLETTER_TOOL.name: {
      const parsed = parseNewsletterArguments(request.arguments)
      if (!parsed.ok) {
        return {
          kind: 'invalid-newsletter-arguments',
          validationDigest: parsed.validationDigest,
        }
      }
      return {
        kind: 'newsletter',
        request: parsed.request,
      }
    }
    case MURPH_FINISH_WITHOUT_REPLY_TOOL.name: {
      const parsed = parseFinishWithoutReplyArguments(request.arguments)
      if (!parsed.ok) {
        return {
          kind: 'invalid-finish-without-reply-arguments',
          validationDigest: parsed.validationDigest,
        }
      }

      return {
        kind: 'finish-without-reply',
      }
    }
    case MURPH_REACT_TO_MESSAGE_TOOL.name: {
      const parsed = parseReactToMessageArguments(request.arguments)
      if (!parsed.ok) {
        return {
          kind: 'invalid-reaction-arguments',
          validationDigest: parsed.validationDigest,
        }
      }

      return {
        kind: 'react-to-message',
        reaction: parsed.reaction,
      }
    }
    case MURPH_COMPUTER_OPEN_TOOL.name: {
      const parsed = parseComputerArguments({
        argumentsValue: request.arguments,
        schema: computerOpenArgumentsSchema,
        schemaName: 'murph.computer_open.input',
        schemaRootKeys: COMPUTER_OPEN_ARGUMENT_ROOT_KEYS,
        toolName: 'murph.computer_open',
      })
      return parsed.ok
        ? { kind: 'computer-open', args: parsed.args }
        : { kind: 'invalid-computer-arguments', validationDigest: parsed.validationDigest }
    }
    case MURPH_COMPUTER_ACT_TOOL.name: {
      const parsed = parseComputerArguments({
        argumentsValue: request.arguments,
        schema: computerActArgumentsSchema,
        schemaName: 'murph.computer_act.input',
        schemaRootKeys: ['runId', 'code', 'timeoutMs'],
        toolName: 'murph.computer_act',
      })
      return parsed.ok
        ? { kind: 'computer-act', args: parsed.args }
        : { kind: 'invalid-computer-arguments', validationDigest: parsed.validationDigest }
    }
    case MURPH_COMPUTER_OS_CONTROL_TOOL.name: {
      const parsed = parseComputerArguments({
        argumentsValue: request.arguments,
        schema: computerOsControlArgumentsSchema,
        schemaName: 'murph.computer_os_control.input',
        toolName: 'murph.computer_os_control',
      })
      return parsed.ok
        ? { kind: 'computer-os-control', args: parsed.args }
        : { kind: 'invalid-computer-arguments', validationDigest: parsed.validationDigest }
    }
    case MURPH_COMPUTER_PAUSE_FOR_USER_TOOL.name: {
      const parsed = parseComputerArguments({
        argumentsValue: request.arguments,
        schema: computerPauseForUserArgumentsSchema,
        schemaName: 'murph.computer_pause_for_user.input',
        toolName: 'murph.computer_pause_for_user',
      })
      return parsed.ok
        ? { kind: 'computer-pause-for-user', args: parsed.args }
        : { kind: 'invalid-computer-arguments', validationDigest: parsed.validationDigest }
    }
    case MURPH_COMPUTER_FINISH_RUN_TOOL.name: {
      const parsed = parseComputerArguments({
        argumentsValue: request.arguments,
        schema: computerFinishRunArgumentsSchema,
        schemaName: 'murph.computer_finish_run.input',
        toolName: 'murph.computer_finish_run',
      })
      return parsed.ok
        ? { kind: 'computer-finish-run', args: parsed.args }
        : { kind: 'invalid-computer-arguments', validationDigest: parsed.validationDigest }
    }
  }

  return {
    kind: 'unsupported-dynamic-tool',
    namespace: request.namespace,
    tool: request.tool,
  }
}

export function isComputerDynamicToolRequest(
  request: MurphDynamicToolRequest,
): boolean {
  switch (request.kind) {
    case 'computer-open':
    case 'computer-act':
    case 'computer-os-control':
    case 'computer-pause-for-user':
    case 'computer-finish-run':
    case 'invalid-computer-arguments':
      return true
    default:
      return false
  }
}

function isExecutableComputerDynamicToolRequest(
  request: MurphDynamicToolRequest,
): boolean {
  switch (request.kind) {
    case 'computer-open':
    case 'computer-act':
    case 'computer-os-control':
    case 'computer-pause-for-user':
    case 'computer-finish-run':
      return true
    default:
      return false
  }
}

function canExecuteComputerDynamicTools(
  hostedToolContext: AssistantHostedToolContext | null,
): boolean {
  return hostedToolContext?.computerToolsAvailable === true
}

function currentHostedDeliveryContext(
  hostedToolContext: AssistantHostedToolContext | null,
): HostedComputerDeliveryContext | null {
  return hostedToolContext?.currentHostedDeliveryContext() ?? null
}

function currentHostedMailboxItemId(
  hostedToolContext: AssistantHostedToolContext | null,
): string | null {
  const itemIds = hostedToolContext?.currentHostedMailboxItemIds() ?? []
  for (let index = itemIds.length - 1; index >= 0; index -= 1) {
    const itemId = normalizeNullableString(itemIds[index])
    if (itemId) {
      return itemId
    }
  }
  return null
}

export async function executeMurphDynamicToolRequest(input: {
  abortSignal?: AbortSignal | null
  codexHome?: string | null
  currentResponseMedia?: readonly AssistantResponseMedia[] | null
  env: NodeJS.ProcessEnv
  fetchImpl: typeof fetch
  hostedToolContext?: AssistantHostedToolContext | null
  hostedGeneratedImageUploader?: AssistantHostedGeneratedImageUploader | null
  materializeWorkspaceArtifacts?: AssistantWorkspaceArtifactMaterializer | null
  nextUsageOrdinal: () => number
  productFeedbackRecorder?: AssistantTurnProductFeedbackRecorder | null
  progressDelivery: AssistantProgressDelivery | null
  publicFetchImpl?: typeof fetch | null
  request: MurphDynamicToolRequest
  requireHostedGeneratedImageUploader?: boolean | null
  vaultRoot?: string | null
  voiceMemoRuntime?: VoiceMemoToolRuntime | null
}): Promise<MurphDynamicToolExecutionResult> {
  if (
    isExecutableComputerDynamicToolRequest(input.request) &&
    !canExecuteComputerDynamicTools(input.hostedToolContext ?? null)
  ) {
    return toolTextResult(
      false,
      'computer tools are unavailable without hosted computer-use transport',
    )
  }

  switch (input.request.kind) {
    case 'invalid-connected-apps-arguments':
      return toolTextResult(false, 'invalid connected-app arguments')
    case 'invalid-generate-image-arguments':
      return toolTextResult(false, 'invalid image generation arguments')
    case 'invalid-computer-arguments':
      return toolTextResult(false, 'invalid computer tool arguments')
    case 'invalid-generate-voice-memo-arguments':
      return toolTextResult(false, 'invalid voice memo generation arguments')
    case 'invalid-generate-song-arguments':
      return toolTextResult(false, 'invalid song generation arguments')
    case 'invalid-progress-arguments':
      return toolTextResult(false, 'invalid progress update arguments')
    case 'invalid-reaction-arguments':
      return toolTextResult(false, 'invalid reaction arguments')
    case 'invalid-product-feedback-arguments':
      return toolTextResult(false, 'invalid product feedback arguments')
    case 'invalid-family-plan-arguments':
      return toolTextResult(false, 'invalid family plan arguments')
    case 'invalid-group-arguments':
      return toolTextResult(false, 'invalid group arguments')
    case 'invalid-newsletter-arguments':
      return toolTextResult(false, 'invalid newsletter arguments')
    case 'invalid-finish-without-reply-arguments':
      return toolTextResult(false, 'invalid no-reply arguments')
    case 'invalid-response-media-arguments':
      return toolTextResult(false, 'invalid response media arguments')
    case 'invalid-send-vault-file-arguments':
      return toolTextResult(false, 'invalid vault file arguments')
    case 'invalid-phone-call-arguments':
      return toolTextResult(false, 'invalid phone-call arguments')
    case 'unsupported-dynamic-tool':
      return toolTextResult(false, 'unsupported dynamic tool')
    case 'attach-response-media': {
      if (hasVaultFileResponseMedia(input.currentResponseMedia ?? [])) {
        return toolTextResult(
          false,
          'response media cannot be changed after an approved vault file is attached',
        )
      }
      return {
        ...toolTextResult(
          true,
          input.request.media.length === 0
            ? 'response media cleared'
            : `${input.request.media.length} response image${input.request.media.length === 1 ? '' : 's'} attached`,
        ),
        responseMediaPatch: {
          media: input.request.media,
          op: 'replace',
        },
      }
    }
    case 'send-progress-update':
      return await executeProgressUpdateTool({
        progressDelivery: input.progressDelivery,
        text: input.request.text,
      })
    case 'send-vault-file': {
      const hostedToolContext = input.hostedToolContext ?? null
      const sendVaultFile = hostedToolContext?.sendVaultFile
      if (
        !hostedToolContext?.vaultFileSendAvailable
        || typeof sendVaultFile !== 'function'
      ) {
        return toolTextResult(
          false,
          'secure vault-file approval is unavailable for this conversation',
        )
      }
      if ((input.currentResponseMedia ?? []).length > 0) {
        return toolTextResult(
          false,
          'vault-file sending cannot be combined with other response media',
        )
      }
      try {
        const result = await sendVaultFile(input.request.ref)
        switch (result.status) {
          case 'pending':
            return {
              ...toolTextResult(
                true,
                JSON.stringify({
                  approvalUrl: result.approvalUrl,
                  filename: result.filename,
                  status: result.status,
                }),
              ),
            }
          case 'approved':
            return {
              ...toolTextResult(
                true,
                JSON.stringify({
                  deliveryStatus: 'queued_with_reply',
                  filename: result.filename,
                  note:
                    'Approval succeeded. Attach this file through your normal reply path. Do not quote this note or claim final iMessage delivery unless later delivery evidence confirms it.',
                  status: result.status,
                }),
              ),
              responseMediaPatch: {
                media: [result.file],
                op: 'append' as const,
              },
            }
          case 'denied':
            return toolTextResult(false, 'vault-file delivery was denied')
          case 'expired':
            return toolTextResult(false, 'vault-file delivery approval expired')
        }
      } catch {
        return toolTextResult(false, 'secure vault-file approval could not be prepared')
      }
    }
    case 'create-phone-call': {
      const hostedToolContext = input.hostedToolContext ?? null
      const phoneCalls = hostedToolContext?.phoneCalls ?? null
      if (!hostedToolContext || !phoneCalls) {
        return toolTextResult(
          false,
          'phone calling is unavailable without hosted phone-call transport',
        )
      }

      const requestKeyScope =
        hostedToolContext.currentPhoneCallToolRequestKeyScope?.() ?? null
      if (!requestKeyScope) {
        return toolTextResult(
          false,
          'phone calling requires user-sourced input for this turn',
        )
      }

      try {
        const result = await phoneCalls.start({
          brief: input.request.brief,
          requestKey: createPhoneCallRequestKey({
            brief: input.request.brief,
            scope: requestKeyScope,
          }),
        }, {
          signal: input.abortSignal ?? null,
        })
        return toolTextResult(true, `phone call ${result.status}: ${result.phoneCallId}`)
      } catch {
        return toolTextResult(false, 'phone call could not be started')
      }
    }
    case 'submit-product-feedback':
      return await executeSubmitProductFeedbackTool({
        feedback: input.request.feedback,
        productFeedbackRecorder: input.productFeedbackRecorder ?? null,
      })
    case 'family-plan':
      return await executeFamilyPlanTool({
        hostedToolContext: input.hostedToolContext ?? null,
        request: input.request.request,
      })
    case 'group':
      return await executeGroupTool({
        abortSignal: input.abortSignal ?? null,
        env: input.env,
        fetchImpl: input.fetchImpl,
        hostedToolContext: input.hostedToolContext ?? null,
        hostedGeneratedImageUploader: input.hostedGeneratedImageUploader ?? null,
        materializeWorkspaceArtifacts: input.materializeWorkspaceArtifacts ?? null,
        nextUsageOrdinal: input.nextUsageOrdinal,
        request: input.request.request,
        vaultRoot: input.vaultRoot ?? null,
      })
    case 'newsletter':
      return await executeNewsletterTool({
        hostedToolContext: input.hostedToolContext ?? null,
        request: input.request.request,
        vaultRoot: input.vaultRoot ?? null,
      })
    case 'finish-without-reply':
      return {
        ...toolTextResult(true, 'finished without reply'),
        finalActionPatch: {
          kind: 'none',
        },
      }
    case 'react-to-message':
      return {
        ...toolTextResult(true, 'reaction queued'),
        reactionPatch: {
          reaction: input.request.reaction,
        },
      }
    case 'generate-image': {
      if (hasVaultFileResponseMedia(input.currentResponseMedia ?? [])) {
        return toolTextResult(
          false,
          'image generation cannot be combined with an approved vault file',
        )
      }
      if (hasVoiceMemoResponseMedia(input.currentResponseMedia ?? [])) {
        return toolTextResult(false, 'image generation cannot be combined with a voice memo')
      }

      const result = await executeGenerateImageTool({
        abortSignal: input.abortSignal ?? null,
        args: input.request.args,
        codexHome: input.codexHome ?? null,
        env: input.env,
        fetchImpl: input.fetchImpl,
        hostedGeneratedImageUploader: input.hostedGeneratedImageUploader ?? null,
        materializeWorkspaceArtifacts: input.materializeWorkspaceArtifacts ?? null,
        providerRequestOrdinal: input.nextUsageOrdinal(),
        requireHostedGeneratedImageUploader:
          input.requireHostedGeneratedImageUploader ?? false,
        vaultRoot: input.vaultRoot ?? null,
      })
      return {
        ...(result.responseMedia && result.responseMedia.length > 0
          ? {
              responseMediaPatch: {
                media: result.responseMedia,
                op: 'append' as const,
              },
            }
          : {}),
        rpcResult: {
          success: result.rpcSuccess,
          contentItems: [
            {
              type: 'inputText',
              text: result.rpcText,
            },
          ],
        },
        usageDraft: result.usageDraft ?? null,
      }
    }
    case 'generate-voice-memo': {
      return await executeGenerateVoiceMemoDynamicTool({
        abortSignal: input.abortSignal ?? null,
        args: input.request.args,
        currentResponseMedia: input.currentResponseMedia ?? [],
        voiceMemoRuntime: input.voiceMemoRuntime ?? null,
      })
    }
    case 'generate-song': {
      return await executeGenerateSongDynamicTool({
        abortSignal: input.abortSignal ?? null,
        args: input.request.args,
        currentResponseMedia: input.currentResponseMedia ?? [],
        voiceMemoRuntime: input.voiceMemoRuntime ?? null,
      })
    }
    case 'connected-apps-manage':
    case 'connected-apps-search':
    case 'connected-apps-execute': {
      const connectedApps = input.hostedToolContext?.connectedApps ?? null
      if (!connectedApps) {
        return toolTextResult(
          false,
          'connected apps are unavailable without hosted connected-app transport',
        )
      }
      return await executeConnectedAppsDynamicTool({
        abortSignal: input.abortSignal ?? null,
        connectedApps,
        request: input.request,
      })
    }
    case 'computer-open': {
      return await executeHostedComputerOpenTool({
        abortSignal: input.abortSignal ?? null,
        args: input.request.args,
        fetchImpl: input.fetchImpl,
        hostedToolContext: input.hostedToolContext ?? null,
      })
    }
    case 'computer-act': {
      const { runId, ...body } = input.request.args
      return await executeHostedComputerApiTool({
        abortSignal: input.abortSignal ?? null,
        body,
        fetchImpl: input.fetchImpl,
        path: buildHostedComputerRunOperationPath({
          operation: 'act',
          runId,
        }),
        sanitizer: 'act',
        unknownOutcomeOnTransportError: true,
      })
    }
    case 'computer-os-control': {
      const { runId, ...body } = input.request.args
      return await executeHostedComputerApiTool({
        abortSignal: input.abortSignal ?? null,
        body,
        fetchImpl: input.fetchImpl,
        path: buildHostedComputerRunOperationPath({
          operation: 'os-control',
          runId,
        }),
        sanitizer: 'os-control',
        unknownOutcomeOnTransportError: true,
      })
    }
    case 'computer-pause-for-user': {
      const { runId, ...body } = input.request.args
      return await executeHostedComputerPauseForUserTool({
        abortSignal: input.abortSignal ?? null,
        body: {
          ...body,
          pauseDeliveryContext: currentHostedDeliveryContext(
            input.hostedToolContext ?? null,
          ),
        } satisfies HostedComputerPauseForUserRequest,
        fetchImpl: input.fetchImpl,
        finishPath: buildHostedComputerRunOperationPath({
          operation: 'finish',
          runId,
        }),
        path: buildHostedComputerRunOperationPath({
          operation: 'pause-for-user',
          runId,
        }),
      })
    }
    case 'computer-finish-run': {
      const { runId, ...body } = input.request.args
      return await executeHostedComputerApiTool({
        abortSignal: input.abortSignal ?? null,
        body: {
          ...body,
          summary: null,
        },
        fetchImpl: input.fetchImpl,
        path: buildHostedComputerRunOperationPath({
          operation: 'finish',
          runId,
        }),
        sanitizer: 'finish',
        unknownOutcomeOnTransportError: true,
      })
    }
  }
}

function hasVoiceMemoResponseMedia(
  media: readonly AssistantResponseMedia[],
): boolean {
  return media.some((item) => item.kind === 'voice_memo')
}

function hasVaultFileResponseMedia(
  media: readonly AssistantResponseMedia[],
): boolean {
  return media.some((item) => item.kind === 'vault_file')
}

async function executeSubmitProductFeedbackTool(input: {
  feedback: Omit<HostedRuntimeProductFeedbackRecord, 'idempotencyKey'>
  productFeedbackRecorder: AssistantTurnProductFeedbackRecorder | null
}): Promise<MurphDynamicToolExecutionResult> {
  if (!input.productFeedbackRecorder?.recordProductFeedback) {
    return toolTextResult(false, 'product feedback recording is not available for this turn')
  }
  try {
    const result = await input.productFeedbackRecorder.recordProductFeedback(input.feedback)
    return toolTextResult(
      true,
      result.recorded ? 'product feedback recorded' : 'product feedback already recorded',
    )
  } catch {
    return toolTextResult(false, 'product feedback recording failed')
  }
}

async function executeFamilyPlanTool(input: {
  hostedToolContext: AssistantHostedToolContext | null
  request: HostedRuntimeFamilyPlanToolRequest
}): Promise<MurphDynamicToolExecutionResult> {
  const familyPlanTool = input.hostedToolContext?.familyPlanTool ?? null
  if (!familyPlanTool) {
    return toolTextResult(false, 'family plan tools are unavailable for this turn')
  }

  try {
    const result = await familyPlanTool.request(input.request)
    return toolTextResult(true, safeToolPayloadText(result))
  } catch {
    return toolTextResult(false, 'family plan tool request failed')
  }
}

function groupAvatarUnavailableToolResult(
  unavailableReason: string,
): MurphDynamicToolExecutionResult {
  return toolTextResult(true, safeToolPayloadText({
    action: 'set_chat_avatar',
    result: {
      status: 'unavailable',
      unavailableReason,
    },
  }))
}

async function executeGroupTool(input: {
  abortSignal: AbortSignal | null
  env: NodeJS.ProcessEnv
  fetchImpl: typeof fetch
  hostedToolContext: AssistantHostedToolContext | null
  hostedGeneratedImageUploader: AssistantHostedGeneratedImageUploader | null
  materializeWorkspaceArtifacts: AssistantWorkspaceArtifactMaterializer | null
  nextUsageOrdinal: () => number
  request: MurphGroupToolRequest
  vaultRoot: string | null
}): Promise<MurphDynamicToolExecutionResult> {
  const groupTool = input.hostedToolContext?.groupTool ?? null
  if (!groupTool) {
    return toolTextResult(false, 'group tools are unavailable for this turn')
  }

  let request: HostedRuntimeGroupToolRequest
  let usageDraft: AssistantProviderUsageDraft | null = null
  if (isPreparedGroupAvatarRequest(input.request)) {
    let preflight: Extract<HostedRuntimeGroupToolResponse, { action: 'preflight_set_chat_avatar' }>
    try {
      const preflightResult = await groupTool.request({ action: 'preflight_set_chat_avatar' })
      if (preflightResult.action !== 'preflight_set_chat_avatar') {
        return groupAvatarUnavailableToolResult('group_avatar_preflight_unavailable')
      }
      preflight = preflightResult
    } catch {
      return groupAvatarUnavailableToolResult('group_avatar_preflight_unavailable')
    }
    if (preflight.result.status !== 'ok') {
      return toolTextResult(true, safeToolPayloadText({
        action: 'set_chat_avatar',
        result: preflight.result,
      }))
    }

    const prepared = await prepareGroupAvatarRuntimeRequest({
      abortSignal: input.abortSignal,
      env: input.env,
      fetchImpl: input.fetchImpl,
      hostedGeneratedImageUploader: input.hostedGeneratedImageUploader,
      materializeWorkspaceArtifacts: input.materializeWorkspaceArtifacts,
      nextUsageOrdinal: input.nextUsageOrdinal,
      request: input.request,
      vaultRoot: input.vaultRoot,
    })
    if (!prepared.rpcSuccess) {
      return {
        rpcResult: {
          success: false,
          contentItems: [{ type: 'inputText', text: prepared.rpcText }],
        },
        usageDraft: prepared.usageDraft ?? null,
      }
    }
    request = prepared.request
    usageDraft = prepared.usageDraft ?? null
  } else {
    request = input.request
  }

  try {
    const result = await groupTool.request(request)
    return {
      ...toolTextResult(true, safeToolPayloadText(result)),
      ...(usageDraft ? { usageDraft } : {}),
    }
  } catch {
    return {
      ...toolTextResult(false, 'group tool request failed'),
      ...(usageDraft ? { usageDraft } : {}),
    }
  }
}

function isPreparedGroupAvatarRequest(
  request: MurphGroupToolRequest,
): request is Extract<MurphGroupToolRequest, { action: 'set_chat_avatar'; avatar: unknown }> {
  return request.action === 'set_chat_avatar' && 'avatar' in request
}

async function prepareGroupAvatarRuntimeRequest(input: {
  abortSignal: AbortSignal | null
  env: NodeJS.ProcessEnv
  fetchImpl: typeof fetch
  hostedGeneratedImageUploader: AssistantHostedGeneratedImageUploader | null
  materializeWorkspaceArtifacts: AssistantWorkspaceArtifactMaterializer | null
  nextUsageOrdinal: () => number
  request: Extract<MurphGroupToolRequest, { action: 'set_chat_avatar'; avatar: unknown }>
  vaultRoot: string | null
}): Promise<
  | {
      request: Extract<HostedRuntimeGroupToolRequest, { action: 'set_chat_avatar' }>
      rpcSuccess: true
      usageDraft?: AssistantProviderUsageDraft | null
    }
  | {
      rpcSuccess: false
      rpcText: string
      usageDraft?: AssistantProviderUsageDraft | null
    }
> {
  const avatar = input.request.avatar
  if (avatar.source === 'generate') {
    const generated = await executeGenerateImageTool({
      abortSignal: input.abortSignal,
      args: avatar.args,
      env: input.env,
      fetchImpl: input.fetchImpl,
      hostedGeneratedImageUploader: input.hostedGeneratedImageUploader,
      materializeWorkspaceArtifacts: input.materializeWorkspaceArtifacts,
      providerRequestOrdinal: input.nextUsageOrdinal(),
      requireHostedGeneratedImageUploader: true,
      vaultRoot: input.vaultRoot,
    })
    if (!generated.rpcSuccess) {
      return {
        rpcSuccess: false,
        rpcText: generated.rpcText,
        usageDraft: generated.usageDraft ?? null,
      }
    }
    const media = generated.responseMedia?.[0] ?? null
    if (media?.kind !== 'image') {
      return {
        rpcSuccess: false,
        rpcText: 'generated group avatar did not produce a hosted image URL',
        usageDraft: generated.usageDraft ?? null,
      }
    }
    return {
      request: { action: 'set_chat_avatar', groupChatIconUrl: media.url },
      rpcSuccess: true,
      usageDraft: generated.usageDraft ?? null,
    }
  }

  const uploaded = await uploadGroupAvatarImageReference({
    alt: avatar.alt,
    hostedGeneratedImageUploader: input.hostedGeneratedImageUploader,
    imageRef: avatar.imageRef,
    materializeWorkspaceArtifacts: input.materializeWorkspaceArtifacts,
    vaultRoot: input.vaultRoot,
  })
  if (!uploaded.rpcSuccess) {
    return uploaded
  }
  return {
    request: { action: 'set_chat_avatar', groupChatIconUrl: uploaded.url },
    rpcSuccess: true,
  }
}

async function uploadGroupAvatarImageReference(input: {
  alt: string | null
  hostedGeneratedImageUploader: AssistantHostedGeneratedImageUploader | null
  imageRef: string
  materializeWorkspaceArtifacts: AssistantWorkspaceArtifactMaterializer | null
  vaultRoot: string | null
}): Promise<
  | { rpcSuccess: true; url: string }
  | { rpcSuccess: false; rpcText: string }
> {
  if (!input.hostedGeneratedImageUploader) {
    return {
      rpcSuccess: false,
      rpcText: 'hosted image upload is not available for this turn',
    }
  }
  if (!normalizeNullableString(input.vaultRoot)) {
    return {
      rpcSuccess: false,
      rpcText: 'image references are unavailable for this turn',
    }
  }

  let references: ResolvedGenerateImageReference[]
  try {
    references = await resolveGenerateImageReferences({
      materializeWorkspaceArtifacts: input.materializeWorkspaceArtifacts,
      refs: [input.imageRef],
      vaultRoot: input.vaultRoot ?? '',
    })
  } catch (error) {
    if (isAbortError(error)) {
      throw error
    }
    return {
      rpcSuccess: false,
      rpcText: 'group avatar image reference could not be loaded',
    }
  }

  const reference = references[0] ?? null
  if (!reference) {
    return {
      rpcSuccess: false,
      rpcText: 'group avatar image reference could not be loaded',
    }
  }

  try {
    const media = await input.hostedGeneratedImageUploader.uploadGeneratedImage({
      alt: input.alt ?? 'Group chat avatar',
      bytes: reference.bytes,
      contentType: groupAvatarReferenceContentType(reference.mediaType),
      filename: groupAvatarReferenceFilename(reference.mediaType),
      metadata: {
        imageSha256: reference.sha256,
        schema: 'murph.group-avatar.v1',
        sourceRefSha256: reference.sourceRefSha256,
      },
      source: 'murph.group-avatar',
    })
    if (media.kind !== 'image') {
      return {
        rpcSuccess: false,
        rpcText: 'group avatar upload did not produce a hosted image URL',
      }
    }
    return { rpcSuccess: true, url: media.url }
  } catch {
    return {
      rpcSuccess: false,
      rpcText: 'group avatar image upload failed',
    }
  }
}

function groupAvatarReferenceContentType(
  mediaType: ResolvedGenerateImageReference['mediaType'],
): AssistantGeneratedImageContentType {
  return mediaType
}

function groupAvatarReferenceFilename(
  mediaType: ResolvedGenerateImageReference['mediaType'],
): string {
  switch (mediaType) {
    case 'image/jpeg':
      return 'group-avatar.jpg'
    case 'image/png':
      return 'group-avatar.png'
    case 'image/webp':
      return 'group-avatar.webp'
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

interface GroupNewsletterParticipantStats {
  displayName: string | null
  hasEmail: boolean
  memberId: string
  weeklyStats: OverviewWeeklyStat[]
}

interface GroupNewsletterSuperlative {
  displayName: string | null
  kind: 'top_current_week'
  memberId: string
  stream: string
  unit: string | null
  value: number
}

async function executeNewsletterTool(input: {
  hostedToolContext: AssistantHostedToolContext | null
  request: HostedRuntimeNewsletterToolRequest
  vaultRoot: string | null
}): Promise<MurphDynamicToolExecutionResult> {
  const newsletterTool = input.hostedToolContext?.newsletterTool ?? null
  if (!newsletterTool) {
    return toolTextResult(false, 'newsletter tools are unavailable for this turn')
  }
  try {
    if (input.request.action === 'send') {
      await ensureGroupNewsletterSharedProjectionAvailable(input.vaultRoot)
    }

    const scheduledAutomationAuthority =
      input.hostedToolContext?.currentScheduledAutomationAuthority?.() ??
      null
    const request: HostedRuntimeNewsletterToolRequest =
      input.request.action === 'send'
        ? {
            ...input.request,
            scheduledAutomationAuthority,
          }
        : input.request
    const result = await newsletterTool.request(request)
    if (result.action === 'send') {
      input.hostedToolContext?.recordNewsletterSendResult?.(result)
    }
    const toolSucceeded = !isNewsletterAllRecipientSendFailure(result)
    if (
      input.request.action !== 'read_stats'
      || result.action !== 'read_stats'
      || result.result.status !== 'ok'
    ) {
      return toolTextResult(toolSucceeded, safeToolPayloadText(result))
    }

    const statsContext = await resolveGroupNewsletterStatsContext({
      scheduledAutomationAuthority,
      vaultRoot: input.vaultRoot,
    })
    const participants = await readGroupNewsletterParticipantStats({
      participants: result.result.participants,
      referenceDate: statsContext.referenceDate,
      timeZone: statsContext.timeZone,
      vaultRoot: input.vaultRoot,
    })
    return toolTextResult(true, safeToolPayloadText({
      action: 'read_stats',
      result: {
        groupId: result.result.groupId,
        missingEmailParticipants: participants.filter((participant) => !participant.hasEmail),
        participants,
        status: 'ok',
        superlatives: buildGroupNewsletterSuperlatives(participants),
      },
    }))
  } catch (error) {
    if (error instanceof GroupNewsletterSharedProjectionUnavailableError) {
      return groupNewsletterSharedProjectionUnavailableResult(input.request.action)
    }
    return toolTextResult(false, 'newsletter tool request failed')
  }
}

function isNewsletterAllRecipientSendFailure(
  result: HostedRuntimeNewsletterToolResponse,
): boolean {
  return (
    result.action === 'send' &&
    result.result.status === 'unavailable' &&
    result.result.unavailableReason === 'send_failed'
  )
}

async function ensureGroupNewsletterSharedProjectionAvailable(
  vaultRoot: string | null,
): Promise<void> {
  if (!vaultRoot) {
    return
  }
  await readGroupNewsletterSharedMemberDailyRecords({ vaultRoot })
}

function groupNewsletterSharedProjectionUnavailableResult(
  action: HostedRuntimeNewsletterToolRequest['action'],
): MurphDynamicToolExecutionResult {
  return toolTextResult(true, safeToolPayloadText({
    action,
    result: {
      status: 'unavailable',
      unavailableReason: 'shared_projection_unavailable',
    },
  }))
}

async function readGroupNewsletterParticipantStats(input: {
  participants: readonly HostedRuntimeNewsletterParticipantSummary[]
  referenceDate?: string
  timeZone?: string | null
  vaultRoot: string | null
}): Promise<GroupNewsletterParticipantStats[]> {
  const sharedByGrantor = new Map<string, GroupNewsletterSharedMemberDailyRecords>()
  if (input.vaultRoot) {
    for (const entry of await readGroupNewsletterSharedMemberDailyRecords({
      vaultRoot: input.vaultRoot,
    })) {
      sharedByGrantor.set(entry.memberId, entry)
    }
  }

  return input.participants.map((participant) => {
    const shared = sharedByGrantor.get(participant.memberId) ?? null
    return {
      displayName: shared?.displayName ?? participant.displayName,
      hasEmail: participant.hasEmail,
      memberId: participant.memberId,
      weeklyStats: buildGroupNewsletterSharedWeeklyStats({
        dailySampleSummaries: shared?.dailySampleSummaries ?? [],
        referenceDate: input.referenceDate,
        timeZone: input.timeZone,
      }),
    }
  })
}

async function resolveGroupNewsletterStatsContext(input: {
  scheduledAutomationAuthority: HostedRuntimeNewsletterScheduledAuthority | null
  vaultRoot: string | null
}): Promise<{
  referenceDate?: string
  timeZone: string | null
}> {
  let timeZone: string | null = null
  if (input.vaultRoot) {
    try {
      const vault = await loadVault({ vaultRoot: input.vaultRoot })
      timeZone = vault.metadata.timezone
    } catch {
      timeZone = null
    }
  }

  return {
    referenceDate: input.scheduledAutomationAuthority?.occurrenceAt,
    timeZone,
  }
}

function buildGroupNewsletterSuperlatives(
  participants: readonly GroupNewsletterParticipantStats[],
): GroupNewsletterSuperlative[] {
  const topByMetric = new Map<string, GroupNewsletterSuperlative>()
  for (const participant of participants) {
    for (const stat of participant.weeklyStats) {
      if (stat.currentWeekAvg === null) {
        continue
      }
      const candidate = {
        displayName: participant.displayName,
        kind: 'top_current_week',
        memberId: participant.memberId,
        stream: stat.stream,
        unit: stat.unit,
        value: stat.currentWeekAvg,
      } satisfies GroupNewsletterSuperlative
      const key = `${candidate.stream}:${candidate.unit ?? ''}`
      const existing = topByMetric.get(key)
      if (!existing || candidate.value > existing.value) {
        topByMetric.set(key, candidate)
      }
    }
  }

  return [...topByMetric.values()]
    .sort((left, right) =>
      left.stream === right.stream
        ? left.memberId.localeCompare(right.memberId)
        : left.stream.localeCompare(right.stream),
    )
    .slice(0, 3)
}

async function executeProgressUpdateTool(input: {
  progressDelivery: AssistantProgressDelivery | null
  text: string
}): Promise<MurphDynamicToolExecutionResult> {
  if (!input.progressDelivery) {
    return toolTextResult(false, 'progress updates are not available for this turn')
  }
  try {
    const result = await input.progressDelivery.send(input.text, { source: 'model' })
    if (result.kind === 'sent') {
      return toolTextResult(true, 'progress update sent')
    }
    if (result.kind === 'failed') {
      return toolTextResult(false, 'progress update failed during best-effort delivery')
    }
    if (result.reason === 'limit') {
      return toolTextResult(false, 'progress update skipped: progress update limit reached')
    }
    if (result.reason === 'duplicate') {
      return toolTextResult(false, 'progress update skipped: duplicate progress update')
    }
    if (result.reason === 'unavailable') {
      return toolTextResult(false, 'progress update skipped: progress updates are not available for this turn')
    }
    return toolTextResult(false, 'progress update skipped: empty progress update')
  } catch {
    return toolTextResult(false, 'progress update failed during best-effort delivery')
  }
}

async function executeHostedComputerPauseForUserTool(input: {
  abortSignal: AbortSignal | null
  body: HostedComputerPauseForUserRequest
  fetchImpl: typeof fetch
  finishPath: string
  path: string
}): Promise<MurphDynamicToolExecutionResult> {
  const apiResult = await callHostedComputerApi({
    ...input,
    unknownOutcomeOnTransportError: true,
  })
  if (!apiResult.ok) {
    if (apiResult.unknownOutcome) {
      return toolTextResult(false, apiResult.errorText, {
        computerRunPausedForUser: true,
      })
    }
    return toolTextResult(false, apiResult.errorText)
  }

  return toolTextResult(
    true,
    safeToolPayloadText(readSanitizedComputerPausePayload(apiResult.payload)),
    { computerRunPausedForUser: true },
  )
}

async function executeHostedComputerOpenTool(input: {
  abortSignal: AbortSignal | null
  args: ComputerOpenToolArgs
  fetchImpl: typeof fetch
  hostedToolContext: AssistantHostedToolContext | null
}): Promise<MurphDynamicToolExecutionResult> {
  return await executeHostedComputerApiTool({
    abortSignal: input.abortSignal,
    body: buildHostedComputerOpenBody({
      args: input.args,
      hostedToolContext: input.hostedToolContext,
    }),
    fetchImpl: input.fetchImpl,
    path: HOSTED_COMPUTER_RUNS_PATH,
    sanitizer: 'open',
    unknownOutcomeOnTransportError: true,
  })
}

function buildHostedComputerOpenBody(input: {
  args: ComputerOpenToolArgs
  hostedToolContext: AssistantHostedToolContext | null
}): Record<string, unknown> {
  const { startUrl } = input.args
  const resumeAfterMailboxItemId = currentHostedMailboxItemId(input.hostedToolContext)
  return {
    goal: 'Hosted computer task.',
    resumeAfterMailboxItemId,
    resumeDeliveryContext: resumeAfterMailboxItemId
      ? currentHostedDeliveryContext(input.hostedToolContext)
      : null,
    startUrl,
  }
}

async function executeHostedComputerApiTool(input: {
  abortSignal: AbortSignal | null
  body: unknown
  fetchImpl: typeof fetch
  path: string
  sanitizer: HostedComputerToolPayloadSanitizer
  unknownOutcomeOnTransportError: boolean
}): Promise<MurphDynamicToolExecutionResult> {
  const apiResult = await callHostedComputerApi(input)
  return apiResult.ok
    ? toolTextResult(true, safeToolPayloadText(sanitizeHostedComputerPayload(
        input.sanitizer,
        apiResult.payload,
      )))
    : toolTextResult(false, apiResult.errorText)
}

async function callHostedComputerApi(input: {
  abortSignal: AbortSignal | null
  body: unknown
  fetchImpl: typeof fetch
  path: string
  unknownOutcomeOnTransportError?: boolean
}): Promise<
  | { ok: true; payload: unknown }
  | { ok: false; errorText: string; unknownOutcome: boolean }
> {
  const payload = JSON.stringify(input.body ?? {})

  try {
    const response = await input.fetchImpl(
      new URL(input.path, 'http://web-control.worker').toString(),
      {
        body: payload,
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
        signal: input.abortSignal ?? undefined,
      },
    )

    if (!response.ok) {
      const error = await readHostedComputerApiError({
        response,
        unknownOutcomeOnFailure: input.unknownOutcomeOnTransportError ?? false,
      })
      return {
        errorText: error.text,
        ok: false,
        unknownOutcome: error.unknownOutcome,
      }
    }

    return {
      ok: true,
      payload: await response.json(),
    }
  } catch {
    return {
      errorText: input.unknownOutcomeOnTransportError
        ? HOSTED_COMPUTER_UNKNOWN_OUTCOME_TEXT
        : 'computer API is unavailable',
      ok: false,
      unknownOutcome: input.unknownOutcomeOnTransportError === true,
    }
  }
}

async function readHostedComputerApiError(input: {
  response: Response
  unknownOutcomeOnFailure: boolean
}): Promise<{ text: string; unknownOutcome: boolean }> {
  const { response } = input
  const fallback = `computer API failed with status ${response.status}`
  try {
    const payload = await response.json()
    const record = asRecord(payload)
    const error = asRecord(record?.error)
    const code = typeof error?.code === 'string' ? error.code : null
    const message = typeof error?.message === 'string' ? error.message : null
    const details = readHostedComputerApiErrorDetails(error?.details)
    if (isUnknownComputerOutcomeError({
      code,
      status: response.status,
      unknownOutcomeOnFailure: input.unknownOutcomeOnFailure,
    })) {
      return {
        text: appendHostedComputerApiErrorDetail(
          HOSTED_COMPUTER_UNKNOWN_OUTCOME_TEXT,
          { code, details, message },
        ),
        unknownOutcome: true,
      }
    }
    if (code && message) {
      return {
        text: appendHostedComputerApiErrorDetail(
          `${fallback}: ${code}: ${message}`,
          { code: null, details, message: null },
        ),
        unknownOutcome: false,
      }
    }
    if (code) {
      return {
        text: appendHostedComputerApiErrorDetail(
          `${fallback}: ${code}`,
          { code: null, details, message: null },
        ),
        unknownOutcome: false,
      }
    }
  } catch {
    // Ignore non-JSON error bodies; hosted web route helpers keep safe details in JSON.
  }

  if (isUnknownComputerOutcomeError({
    code: null,
    status: response.status,
    unknownOutcomeOnFailure: input.unknownOutcomeOnFailure,
  })) {
    return { text: HOSTED_COMPUTER_UNKNOWN_OUTCOME_TEXT, unknownOutcome: true }
  }

  return { text: fallback, unknownOutcome: false }
}

function appendHostedComputerApiErrorDetail(
  text: string,
  detail: {
    code: string | null
    details?: string | null
    message: string | null
  },
): string {
  const details = detail.details ? `\nbackend details:\n${detail.details}` : ''
  if (detail.code && detail.message) {
    return `${text}; backend error: ${detail.code}: ${detail.message}${details}`
  }
  if (detail.code) {
    return `${text}; backend error: ${detail.code}${details}`
  }
  if (detail.message) {
    return `${text}; backend error: ${detail.message}${details}`
  }
  return `${text}${details}`
}

function readHostedComputerApiErrorDetails(value: unknown): string | null {
  const record = asRecord(value)
  if (!record) {
    return null
  }

  const lines = [
    readHostedComputerApiErrorDetailLine('codeHash', record.codeHash),
    readHostedComputerApiErrorDetailLine('computerOsControl', record.computerOsControl),
    readHostedComputerApiErrorDetailLine('timeoutMs', record.timeoutMs),
    readHostedComputerApiErrorDiagnosticBlock('playwrightError', record.kernelError),
    readHostedComputerApiErrorDiagnosticBlock('playwrightStderr', record.kernelStderr),
    readHostedComputerApiErrorDetailLine('kernelErrorPresent', record.kernelErrorPresent),
    readHostedComputerApiErrorDetailLine('kernelStderrPresent', record.kernelStderrPresent),
    readHostedComputerApiErrorDetailLine('kernelStdoutPresent', record.kernelStdoutPresent),
  ].filter((line): line is string => line !== null)

  return lines.length > 0 ? lines.join('\n') : null
}

function readHostedComputerApiErrorDiagnosticBlock(
  label: string,
  value: unknown,
): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const text = value.trim()
  if (!text) {
    return null
  }

  return text.includes('\n')
    ? `${label}:\n${text}`
    : `${label}: ${text}`
}

function readHostedComputerApiErrorDetailLine(
  label: string,
  value: unknown,
): string | null {
  if (typeof value === 'string') {
    const text = value.trim()
    return text ? `${label}: ${text}` : null
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return `${label}: ${value}`
  }

  if (typeof value === 'boolean') {
    return `${label}: ${value}`
  }

  return null
}

function isUnknownComputerOutcomeError(input: {
  code: string | null
  status: number
  unknownOutcomeOnFailure: boolean
}): boolean {
  if (!input.unknownOutcomeOnFailure) {
    return false
  }

  if (!input.code) {
    return input.status >= 500
  }

  return input.code === 'HOSTED_COMPUTER_EVAL_FAILED'
    || input.code === 'HOSTED_COMPUTER_ACTION_STATE_INVALID'
    || input.code === 'HOSTED_COMPUTER_OS_CONTROL_FAILED'
}

function readSanitizedComputerPausePayload(payload: unknown): Record<string, unknown> {
  const record = asRecord(payload)
  if (!record) {
    return {}
  }

  const runId = typeof record.runId === 'string' ? record.runId : null
  const status = typeof record.status === 'string' ? record.status : null
  const awaitingReason = typeof record.awaitingReason === 'string'
    ? record.awaitingReason
    : null
  const handoffUrl = typeof record.handoffUrl === 'string' && record.handoffUrl.length > 0
    ? record.handoffUrl
    : null
  const suggestedReply = typeof record.suggestedReply === 'string' && record.suggestedReply.length > 0
    ? record.suggestedReply
    : null

  return {
    ...(awaitingReason ? { awaitingReason } : {}),
    handoffCreated: Boolean(handoffUrl),
    ...(handoffUrl ? { handoffUrl } : {}),
    ...(runId ? { runId } : {}),
    ...(status ? { status } : {}),
    ...(suggestedReply ? { suggestedReply } : {}),
  }
}

function sanitizeHostedComputerPayload(
  sanitizer: HostedComputerToolPayloadSanitizer,
  payload: unknown,
): Record<string, unknown> {
  const record = asRecord(payload)
  if (!record) {
    return {}
  }

  switch (sanitizer) {
    case 'open':
      return {
        ...readStringField(record, 'expiresAt'),
        ...readBooleanField(record, 'reused'),
        ...readStringField(record, 'runId'),
        ...readStringField(record, 'status'),
        ...readStringField(record, 'title'),
        ...readSanitizedComputerUrlField(record, 'url'),
        visibleText: typeof record.visibleText === 'string' ? record.visibleText : '',
      }
    case 'act':
      return {
        result: record.result ?? null,
        ...readStringField(record, 'title'),
        ...readSanitizedComputerUrlField(record, 'url'),
      }
    case 'os-control':
      return {
        ...readStringField(record, 'action'),
        ...readBooleanField(record, 'ok'),
        ...readStringField(record, 'runId'),
        ...readStringField(record, 'status'),
      }
    case 'finish':
      return {
        ...readBooleanField(record, 'ok'),
        ...readStringField(record, 'runId'),
        ...readStringField(record, 'status'),
      }
  }
}

function readStringField(
  record: Record<string, unknown>,
  field: string,
): Record<string, string> {
  const value = record[field]
  return typeof value === 'string' ? { [field]: value } : {}
}

function readStringOrNullField(
  record: Record<string, unknown>,
  field: string,
): Record<string, string | null> {
  const value = record[field]
  if (value === null) {
    return { [field]: null }
  }
  return typeof value === 'string' ? { [field]: value } : {}
}

function readSanitizedComputerUrlField(
  record: Record<string, unknown>,
  field: string,
): Record<string, string | null> {
  const value = record[field]
  if (value === null) {
    return { [field]: null }
  }
  if (typeof value !== 'string') {
    return {}
  }
  return { [field]: sanitizeComputerDisplayUrl(value) }
}

function sanitizeComputerDisplayUrl(value: string): string | null {
  if (!value.trim()) {
    return null
  }
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

function readBooleanField(
  record: Record<string, unknown>,
  field: string,
): Record<string, boolean> {
  const value = record[field]
  return typeof value === 'boolean' ? { [field]: value } : {}
}

function safeToolPayloadText(payload: unknown): string {
  const text = JSON.stringify(payload) ?? 'null'
  if (text.length <= 60_000) {
    return text
  }
  return `${text.slice(0, 60_000)}...`
}

function toolTextResult(
  success: boolean,
  text: string,
  extra?: Pick<MurphDynamicToolExecutionResult, 'computerRunPausedForUser'>,
): MurphDynamicToolExecutionResult {
  return {
    ...extra,
    rpcResult: {
      success,
      contentItems: [{ type: 'inputText', text }],
    },
  }
}

function parseDynamicToolCallRequest(
  message: CodexRpcMessage,
): ParsedDynamicToolCallRequest | null {
  if (message.method !== CODEX_DYNAMIC_TOOL_CALL_METHOD) {
    return null
  }

  const params = asRecord(message.params)
  if (!params) {
    return {
      arguments: null,
      namespace: null,
      tool: null,
    }
  }

  return {
    arguments: params.arguments,
    namespace: normalizeNullableStringValue(params.namespace),
    tool: normalizeNullableStringValue(params.tool),
  }
}

function parseSendVaultFileArguments(
  value: unknown,
):
  | { ok: true; ref: string }
  | { ok: false; validationDigest: SafeToolCallValidationDigest } {
  const parsed = sendVaultFileArgumentsSchema.safeParse(value)
  if (!parsed.success) {
    return {
      ok: false,
      validationDigest: buildSafeToolCallValidationDigest({
        error: parsed.error,
        rawInput: value,
        schemaName: 'murph.send_vault_file.input',
        schemaRootKeys: ['ref'],
        toolName: 'murph.send_vault_file',
      }),
    }
  }
  return {
    ok: true,
    ref: parsed.data.ref,
  }
}

function parseSendProgressUpdateArguments(
  value: unknown,
):
  | { ok: true; text: string }
  | { ok: false; validationDigest: SafeToolCallValidationDigest } {
  const parsed = sendProgressUpdateArgumentsSchema.safeParse(value)
  if (!parsed.success) {
    return {
      ok: false,
      validationDigest: buildDynamicToolValidationDigest({
        error: parsed.error,
        rawInput: value,
        schemaName: 'murph.send_progress_update.input',
        schemaRootKeys: readZodObjectRootKeys(sendProgressUpdateArgumentsSchema),
        toolName: 'murph.send_progress_update',
      }),
    }
  }

  return {
    ok: true,
    text: parsed.data.text,
  }
}

function parseGenerateImageArguments(
  value: unknown,
):
  | { ok: true; args: GenerateImageToolArgs }
  | { ok: false; validationDigest: SafeToolCallValidationDigest } {
  const parsed = generateImageArgumentsSchema.safeParse(value)
  if (!parsed.success) {
    return {
      ok: false,
      validationDigest: buildDynamicToolValidationDigest({
        error: parsed.error,
        rawInput: value,
        schemaName: 'murph.generate_image.input',
        schemaRootKeys: readZodObjectRootKeys(generateImageArgumentsSchema),
        toolName: 'murph.generate_image',
      }),
    }
  }
  return {
    args: parsed.data,
    ok: true,
  }
}

function parseSubmitProductFeedbackArguments(
  value: unknown,
):
  | {
      feedback: Omit<HostedRuntimeProductFeedbackRecord, 'idempotencyKey'>
      ok: true
    }
  | { ok: false; validationDigest: SafeToolCallValidationDigest } {
  const parsed = submitProductFeedbackArgumentsSchema.safeParse(value)
  if (!parsed.success) {
    return {
      ok: false,
      validationDigest: buildDynamicToolValidationDigest({
        error: parsed.error,
        rawInput: value,
        schemaName: 'murph.submit_product_feedback.input',
        schemaRootKeys: readZodObjectRootKeys(submitProductFeedbackArgumentsSchema),
        toolName: 'murph.submit_product_feedback',
      }),
    }
  }
  return {
    feedback: parsed.data,
    ok: true,
  }
}

function parseFamilyPlanArguments(
  value: unknown,
):
  | {
      request: HostedRuntimeFamilyPlanToolRequest
      ok: true
    }
  | { ok: false; validationDigest: SafeToolCallValidationDigest } {
  const parsed = familyPlanArgumentsSchema.safeParse(value)
  if (!parsed.success) {
    return {
      ok: false,
      validationDigest: buildDynamicToolValidationDigest({
        error: parsed.error,
        rawInput: value,
        schemaName: 'murph.family_plan.input',
        schemaRootKeys: ['action', 'invite'],
        toolName: 'murph.family_plan',
      }),
    }
  }

  if (parsed.data.action === 'read_status') {
    return {
      ok: true,
      request: {
        action: 'read_status',
      },
    }
  }
  if (parsed.data.action === 'start_checkout') {
    return {
      ok: true,
      request: parsed.data.invite
        ? {
            action: 'start_checkout',
            invite: {
              ...(parsed.data.invite.targetEmail
                ? { targetEmail: parsed.data.invite.targetEmail }
                : {}),
              targetLabel: parsed.data.invite.targetLabel,
              targetPhoneNumber: parsed.data.invite.targetPhoneNumber,
              targetTelegramUsername: parsed.data.invite.targetTelegramUsername,
            },
          }
        : {
            action: 'start_checkout',
          },
    }
  }

  return {
    ok: true,
    request: {
      action: 'create_invite',
      invite: {
        ...(parsed.data.invite.targetEmail
          ? { targetEmail: parsed.data.invite.targetEmail }
          : {}),
        targetLabel: parsed.data.invite.targetLabel,
        targetPhoneNumber: parsed.data.invite.targetPhoneNumber,
        targetTelegramUsername: parsed.data.invite.targetTelegramUsername,
      },
    },
  }
}

function parseGroupArguments(
  value: unknown,
):
  | {
      request: MurphGroupToolRequest
      ok: true
    }
  | { ok: false; validationDigest: SafeToolCallValidationDigest } {
  const parsed = groupArgumentsSchema.safeParse(value)
  if (!parsed.success) {
    return {
      ok: false,
      validationDigest: buildDynamicToolValidationDigest({
        error: parsed.error,
        rawInput: value,
        schemaName: 'murph.group.input',
        schemaRootKeys: ['action'],
        toolName: 'murph.group',
      }),
    }
  }
  if (parsed.data.action === 'create_join_link') {
    const joinLink = {
      ...(parsed.data.displayName !== undefined
        ? { displayName: parsed.data.displayName }
        : {}),
      ...(parsed.data.kind !== undefined ? { kind: parsed.data.kind } : {}),
      ...(parsed.data.requestedVaultShareProjectionScopes !== undefined
        ? {
            requestedVaultShareProjectionScopes:
              parsed.data.requestedVaultShareProjectionScopes,
          }
        : {}),
    }
    return {
      ok: true,
      request:
        Object.keys(joinLink).length > 0
          ? { action: 'create_join_link', joinLink }
          : { action: 'create_join_link' },
    }
  }
  if (parsed.data.action === 'update_display_name') {
    return {
      ok: true,
      request: {
        action: 'update_display_name',
        updateDisplayName: {
          displayName: parsed.data.displayName,
        },
      },
    }
  }
  if (parsed.data.action === 'set_chat_avatar') {
    if (parsed.data.avatarSource === 'generate') {
      if (!parsed.data.prompt) {
        return {
          ok: false,
          validationDigest: buildDynamicToolValidationDigest({
            error: new z.ZodError([
              {
                code: z.ZodIssueCode.custom,
                message: 'set_chat_avatar with avatarSource="generate" requires prompt',
                path: ['prompt'],
              },
            ]),
            rawInput: value,
            schemaName: 'murph.group.input',
            schemaRootKeys: ['action'],
            toolName: 'murph.group',
          }),
        }
      }
      return {
        ok: true,
        request: {
          action: 'set_chat_avatar',
          avatar: {
            source: 'generate',
            args: {
              alt: parsed.data.alt,
              outputFormat: parsed.data.outputFormat,
              prompt: parsed.data.prompt,
              quality: parsed.data.quality,
              referenceImageRefs: parsed.data.referenceImageRefs,
              size: parsed.data.size,
            },
          },
        },
      }
    }
    if (!parsed.data.imageRef) {
      return {
        ok: false,
        validationDigest: buildDynamicToolValidationDigest({
          error: new z.ZodError([
            {
              code: z.ZodIssueCode.custom,
              message: 'set_chat_avatar with avatarSource="image_ref" requires imageRef',
              path: ['imageRef'],
            },
          ]),
          rawInput: value,
          schemaName: 'murph.group.input',
          schemaRootKeys: ['action'],
          toolName: 'murph.group',
        }),
      }
    }
    return {
      ok: true,
      request: {
        action: 'set_chat_avatar',
        avatar: {
          alt: parsed.data.alt,
          imageRef: parsed.data.imageRef,
          source: 'image_ref',
        },
      },
    }
  }
  if (parsed.data.action === 'post_join_offer') {
    const joinOffer = {
      ...(parsed.data.displayName !== undefined
        ? { displayName: parsed.data.displayName }
        : {}),
      messageTemplate: parsed.data.messageTemplate,
      ...(parsed.data.projectionScopes !== undefined
        ? { projectionScopes: parsed.data.projectionScopes }
        : {}),
    }
    return {
      ok: true,
      request: { action: 'post_join_offer', joinOffer },
    }
  }
  if (
    parsed.data.action === 'read_chat_participants'
    || parsed.data.action === 'share_contact_card'
    || parsed.data.action === 'revoke_own_email_share'
  ) {
    return { ok: true, request: { action: parsed.data.action } }
  }
  return { ok: true, request: { action: 'read_current' } }
}

function parseNewsletterArguments(
  value: unknown,
):
  | {
      request: HostedRuntimeNewsletterToolRequest
      ok: true
    }
  | { ok: false; validationDigest: SafeToolCallValidationDigest } {
  const parsed = newsletterArgumentsSchema.safeParse(value)
  if (!parsed.success) {
    return {
      ok: false,
      validationDigest: buildDynamicToolValidationDigest({
        error: parsed.error,
        rawInput: value,
        schemaName: 'murph.newsletter.input',
        schemaRootKeys: ['action', 'groupId'],
        toolName: 'murph.newsletter',
      }),
    }
  }
  if (parsed.data.action === 'read_stats') {
    return {
      ok: true,
      request: {
        action: 'read_stats',
        groupId: parsed.data.groupId,
      },
    }
  }

  return {
    ok: true,
    request: {
      action: 'send',
      groupId: parsed.data.groupId,
      html: parsed.data.html,
      subject: parsed.data.subject,
      ...(parsed.data.text === undefined ? {} : { text: parsed.data.text }),
    },
  }
}

function parseFinishWithoutReplyArguments(
  value: unknown,
):
  | { ok: true }
  | { ok: false; validationDigest: SafeToolCallValidationDigest } {
  const parsed = finishWithoutReplyArgumentsSchema.safeParse(value)
  if (!parsed.success) {
    return {
      ok: false,
      validationDigest: buildDynamicToolValidationDigest({
        error: parsed.error,
        rawInput: value,
        schemaName: 'murph.finish_without_reply.input',
        schemaRootKeys: readZodObjectRootKeys(finishWithoutReplyArgumentsSchema),
        toolName: 'murph.finish_without_reply',
      }),
    }
  }

  return { ok: true }
}

function parseReactToMessageArguments(
  value: unknown,
):
  | { ok: true; reaction: AssistantMessageReaction }
  | { ok: false; validationDigest: SafeToolCallValidationDigest } {
  const parsed = reactToMessageArgumentsSchema.safeParse(value)
  if (!parsed.success) {
    return {
      ok: false,
      validationDigest: buildDynamicToolValidationDigest({
        error: parsed.error,
        rawInput: value,
        schemaName: 'murph.react_to_message.input',
        schemaRootKeys: readZodObjectRootKeys(reactToMessageArgumentsSchema),
        toolName: 'murph.react_to_message',
      }),
    }
  }

  return {
    ok: true,
    reaction: parsed.data.reaction,
  }
}

function parseComputerArguments<TArgs>(input: {
  argumentsValue: unknown
  schema: z.ZodType<TArgs> & { shape?: Record<string, unknown> }
  schemaName: string
  schemaRootKeys?: readonly string[]
  toolName: string
}):
  | { ok: true; args: TArgs }
  | { ok: false; validationDigest: SafeToolCallValidationDigest } {
  const parsed = input.schema.safeParse(input.argumentsValue)
  if (!parsed.success) {
    return {
      ok: false,
      validationDigest: buildDynamicToolValidationDigest({
        error: parsed.error,
        rawInput: input.argumentsValue,
        schemaName: input.schemaName,
        schemaRootKeys: input.schemaRootKeys ?? readZodObjectRootKeys(input.schema),
        toolName: input.toolName,
      }),
    }
  }

  return {
    args: parsed.data,
    ok: true,
  }
}

function parseAttachResponseMediaArguments(
  value: unknown,
):
  | { ok: true; media: AssistantResponseMedia[] }
  | { ok: false; validationDigest: SafeToolCallValidationDigest } {
  const schemaName = 'murph.attach_response_media.input'
  const toolName = 'murph.attach_response_media'
  try {
    const parsed = attachResponseMediaArgumentsSchema.safeParse(value)
    if (!parsed.success) {
      return {
        ok: false,
        validationDigest: buildDynamicToolValidationDigest({
          error: parsed.error,
          rawInput: value,
          schemaName,
          schemaRootKeys: readZodObjectRootKeys(attachResponseMediaArgumentsSchema),
          toolName,
        }),
      }
    }

    const media = normalizeAssistantResponseMediaList(parsed.data.media)
    const unsupportedMedia = media.find((item) => item.kind !== 'image')
    if (unsupportedMedia) {
      throw new Error(
        `murph.attach_response_media only supports image media, received ${unsupportedMedia.kind}.`,
      )
    }

    return {
      ok: true,
      media,
    }
  } catch (error) {
    return {
      ok: false,
      validationDigest: buildDynamicToolValidationDigest({
        error,
        rawInput: value,
        schemaName,
        schemaRootKeys: readZodObjectRootKeys(attachResponseMediaArgumentsSchema),
        toolName,
      }),
    }
  }
}

function buildDynamicToolValidationDigest(input: {
  error: unknown
  rawInput: unknown
  schemaName: string
  schemaRootKeys: readonly string[]
  toolName: string
}): SafeToolCallValidationDigest {
  return buildSafeToolCallValidationDigest({
    error: input.error,
    rawInput: input.rawInput,
    requestedToolName: input.toolName,
    schemaName: input.schemaName,
    schemaRootKeys: input.schemaRootKeys,
    toolName: input.toolName,
  })
}

function readZodObjectRootKeys(schema: { shape?: Record<string, unknown> }): string[] {
  return Object.keys(schema.shape ?? {})
}

function normalizeNullableStringValue(value: unknown): string | null {
  return typeof value === 'string' ? normalizeNullableString(value) : null
}
