import assert from 'node:assert/strict'
import type { AssistantHostedExecutionContext } from '../../src/assistant/execution-context.js'

export const PRODUCTION_HOSTED_TOOL_NAMES = `send_progress_update automation automation_inspect device assistant_style
attach_response_media attach_response_card attach_sleep_card generate_image generate_voice_memo
assistant_configuration personalization family_plan plan_usage usage_diagnostics poll subscription
group_consult group_data group_membership group_usage group_chat group_email generate_song analyze_video
conversation_attachments create_calendar_link ask_grok submit_product_feedback send_vault_file materialize_vault_media pending_vault_files
finish_without_reply select_reply_target react_to_message create_clinical_records_connect_link get_sender_contact
create_phone_call get_phone_call_status stop_phone_call resolve_physical_note send_physical_note labs
computer_open computer_act computer_os_control computer_pause_for_user computer_finish_run
connected_apps_manage connected_apps_search connected_apps_execute`.split(/\s+/u).map((name) => `murph.${name}`)

// The capability blocks a production hosted direct onboarding turn must carry.
// Ids from src/assistant/system-prompt-blocks.ts; their wording is free.
export const PRODUCTION_HOSTED_PROMPT_BLOCK_IDS = [
  'route.native-polls', 'route.labs', 'route.vault-navigation', 'route.hosted-groups.private-consult',
  'route.automation', 'route.health-commons-tools', 'route.non-blocking-delegation',
  'route.cli-contract', 'thread.onboarding',
] as const

// Ceiling only: a smaller prompt always passes. Measured 81,637 bytes with the
// generated CLI contract; the margin absorbs machine-specific paths.
export const PRODUCTION_HOSTED_DEVELOPER_INSTRUCTIONS_CEILING_BYTES = 84_100

export function assertProductionHostedCapabilityParity(input: {
  developerInstructions?: string | null
  dynamicTools: readonly { namespace: string; name: string }[]
  /** Block ids of the planned prompt, when the caller recorded them. */
  promptBlockIds?: readonly string[]
}): void {
  assert.equal(input.dynamicTools.length, PRODUCTION_HOSTED_TOOL_NAMES.length)
  assert.deepEqual(input.dynamicTools.map((tool) => `${tool.namespace}.${tool.name}`), PRODUCTION_HOSTED_TOOL_NAMES)
  const bytes = Buffer.byteLength(input.developerInstructions ?? '')
  assert.ok(bytes > 0 && bytes <= PRODUCTION_HOSTED_DEVELOPER_INSTRUCTIONS_CEILING_BYTES, `Hosted developer instructions over the production ceiling: ${bytes} bytes`)
  const promptBlockIds = input.promptBlockIds
  if (promptBlockIds) assert.deepEqual(PRODUCTION_HOSTED_PROMPT_BLOCK_IDS.filter((id) => !promptBlockIds.includes(id)), [])
}

// Opt-in direct Linq capability envelope. Real planning and tool schemas decide
// what is advertised. External services fail closed; they never fall through to
// a developer's credentials. Journey-specific ports may override these stubs.
export function createProductionHostedCapabilities() {
  const unexpected = (): never => { throw new Error('Unexpected external service in synthetic hosted journey') }
  const hosted: AssistantHostedExecutionContext = {
    memberId: 'synthetic-production-capability-member', userEnvKeys: [],
    deviceConnectProviders: [
      { provider: 'garmin', label: 'Garmin' },
      { provider: 'oura', label: 'Oura' },
      { provider: 'whoop', label: 'WHOOP' },
    ],
    actionApprovalPort: { read: unexpected, request: unexpected },
    assistantConfigurationTool: { request: unexpected },
    connectedApps: { request: unexpected },
    clinicalRecordsConnectLinkTool: { createConnectLink: unexpected },
    deviceTool: { request: unexpected },
    familyPlanTool: { request: unexpected },
    groupTool: { request: unexpected },
    labsTool: { request: unexpected },
    personalizationTool: { request: unexpected },
    planUsageTool: { read: unexpected },
    usageDiagnostics: { read: unexpected },
    pollTool: { request: unexpected },
    subscriptionTool: { request: unexpected },
    physicalNotes: { send: unexpected, resolve: unexpected },
    phoneCalls: { start: unexpected, status: unexpected, stop: unexpected },
    privateImageUrlPublisher: { publishPrivateImageUrl: unexpected },
    productFeedbackCandidateSink: { acceptProductFeedbackCandidate: unexpected },
    imageGenerationLauncher: { launch: unexpected, readStatus: () => null },
    providerFetch: unexpected,
    publicInternetFetch: unexpected,
    progressDeliveryDependencies: { sendLinq: unexpected },
  }
  return { hosted, env: {
    XAI_API_KEY: 'synthetic-fixture-only',
    GEMINI_API_KEY: 'synthetic-fixture-only',
  } }
}
