import { buildAssistantSystemPrompt } from '../../src/assistant/system-prompt.js'

export function buildBluetoothHelpInstructions(conversationScope: 'direct' | 'group' = 'direct'): string {
  return buildAssistantSystemPrompt({
    assistantCliContract: null,
    assistantContextSnapshotPrompt: null,
    assistantHostedDeviceConnectAvailable: true,
    assistantHostedDeviceConnectProviders: [{ provider: 'whoop', label: 'WHOOP' }],
    assistantKnowledgeToolsAvailable: false,
    channel: 'linq',
    cliAccess: { rawCommand: 'vault-cli', setupCommand: 'murph' },
    conversationScope,
    currentLocalDate: '2026-10-23',
    currentTimeZone: 'America/New_York',
    hostedRuntime: true,
    modelBehaviorProfile: 'gpt5-agentic',
    onboardingGuidance: false,
    turnTrigger: null,
  })
}
