import { buildAssistantSystemPrompt } from '../../src/assistant/system-prompt.js'

export function buildBluetoothHelpInstructions(conversationScope: 'direct' | 'group' = 'direct'): string {
  return buildAssistantSystemPrompt({
    assistantCliContract: null,
    assistantHostedDeviceConnectProviders: [{ provider: 'whoop', label: 'WHOOP' }],
    channel: 'linq',
    cliAccess: { rawCommand: 'vault-cli' },
    conversationScope,
    currentLocalDate: '2026-10-23',
    currentTimeZone: 'America/New_York',
    hostedRuntime: true,
    onboardingGuidance: false,
    turnTrigger: null,
  })
}
