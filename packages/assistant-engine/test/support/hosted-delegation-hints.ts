import { readFile } from 'node:fs/promises'

export async function readHostedDelegationHintOverrides(): Promise<string[]> {
  // Read the production owner without a runtime dependency back to its caller.
  const source = await readFile(new URL('../../../assistant-runtime/src/hosted-runtime/codex-config.ts', import.meta.url), 'utf8')
  return [
    ['usage_hint_text', 'HOSTED_CODEX_MULTI_AGENT_USAGE_HINT_TEXT'],
    ['multi_agent_mode_hint_text', 'HOSTED_CODEX_MULTI_AGENT_MODE_HINT_TEXT'],
    ['subagent_usage_hint_text', 'HOSTED_CODEX_SUBAGENT_USAGE_HINT_TEXT'],
    ['subagent_developer_instructions', 'HOSTED_CODEX_SUBAGENT_DEVELOPER_INSTRUCTIONS_TEXT'],
  ].map(([key, name]) => {
    const declaration = new RegExp(`const ${name} =\\s*([\\s\\S]*?);$`, 'mu').exec(source)?.[1]?.trim()
    if (!declaration) throw new Error(`Missing production delegation hint: ${name}`)
    if (declaration.startsWith('[') && !declaration.endsWith('].join(" ")')) {
      throw new Error(`Unsupported production delegation hint: ${name}`)
    }
    const values = declaration.startsWith('[')
      ? declaration.slice(0, declaration.indexOf('].join(" ")')).match(/"(?:[^"\\]|\\.)*"/gu)
      : [declaration]
    if (!values?.length) throw new Error(`Invalid production delegation hint: ${name}`)
    const hint = values.map((value) => {
      const text: unknown = JSON.parse(value)
      if (typeof text !== 'string') throw new Error(`Invalid production delegation hint: ${name}`)
      return text
    }).join(' ')
    return `features.multi_agent_v2.${key}=${JSON.stringify(hint)}`
  })
}
