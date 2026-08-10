const LEGACY_GROUP_NEWSLETTER_CONFIGURATION_MARKER =
  'Murph group newsletter configuration v1.'
const LEGACY_GROUP_NEWSLETTER_RUNTIME_SENTENCE =
  'These are configuration values. The runtime appends the current execution contract on every scheduled run.'

export function isLegacyGroupNewsletterAutomationInstructions(
  instructions: string,
): boolean {
  return instructions.startsWith(
    `${LEGACY_GROUP_NEWSLETTER_CONFIGURATION_MARKER}\n`,
  )
}

export function appendLegacyGroupNewsletterSkillInstructions(
  instructions: string,
): string {
  if (!isLegacyGroupNewsletterAutomationInstructions(instructions)) {
    return instructions
  }
  return [
    'Compatibility instructions for a newsletter automation saved before newsletters became skill-authored group automations:',
    '- Read and follow the group-newsletter skill before doing anything else.',
    '- Treat the saved configuration below as the requested recipe. The skill owns execution; the runtime does not append a newsletter contract.',
    '- Use only the ordinary group/shared-data and group-email actions described by that skill.',
    '',
    instructions.replace(
      LEGACY_GROUP_NEWSLETTER_RUNTIME_SENTENCE,
      'Legacy saved configuration:',
    ),
  ].join('\n')
}
