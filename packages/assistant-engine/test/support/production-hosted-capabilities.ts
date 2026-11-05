import assert from 'node:assert/strict'
import type { AssistantHostedExecutionContext } from '../../src/assistant/execution-context.js'

export const PRODUCTION_HOSTED_TOOL_NAMES = `send_progress_update automation device assistant_style
attach_response_media attach_response_card attach_sleep_card generate_image generate_voice_memo
assistant_configuration personalization family_plan plan_usage usage_diagnostics poll subscription
group_consult group_data group_membership group_usage group_chat group_email generate_song analyze_video
conversation_attachments create_calendar_link ask_grok submit_product_feedback send_vault_file pending_vault_files
finish_without_reply select_reply_target react_to_message create_clinical_records_connect_link get_sender_contact
create_phone_call get_phone_call_status stop_phone_call resolve_physical_note send_physical_note labs
computer_open computer_act computer_os_control computer_pause_for_user computer_finish_run
connected_apps_manage connected_apps_search connected_apps_execute`.split(/\s+/u).map((name) => `murph.${name}`)

export function assertProductionHostedCapabilityParity(input: {
  developerInstructions?: string | null
  dynamicTools: readonly { namespace: string; name: string }[]
}): void {
  assert.equal(input.dynamicTools.length, 49)
  assert.deepEqual(input.dynamicTools.map((tool) => `${tool.namespace}.${tool.name}`), PRODUCTION_HOSTED_TOOL_NAMES)
  const bytes = Buffer.byteLength(input.developerInstructions ?? '')
  assert.ok(bytes >= 87_330 * 0.97 && bytes <= 87_330 * 1.03, `Hosted developer instructions outside production envelope: ${bytes} bytes`)
  assert.ok(input.developerInstructions?.includes('Murph CLI Contract:'))
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
