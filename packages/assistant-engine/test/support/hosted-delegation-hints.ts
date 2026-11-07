import { buildHostedCodexBehaviorTomlLines } from '@murphai/hosted-execution/codex-behavior'

export async function readHostedDelegationHintOverrides(): Promise<string[]> {
  const lines = buildHostedCodexBehaviorTomlLines({ exposeSpawnAgentModelOverrides: false })
  return [
    'usage_hint_text',
    'multi_agent_mode_hint_text',
    'subagent_usage_hint_text',
    'subagent_developer_instructions',
  ].map((key) => {
    const prefix = `${key} = `
    const assignment = lines.find((line) => line.startsWith(prefix))
    if (!assignment) throw new Error(`Missing production delegation hint: ${key}`)
    return `features.multi_agent_v2.${key}=${assignment.slice(prefix.length)}`
  })
}
