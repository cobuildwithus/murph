/**
 * Non-model-controlled Codex policy for every unattended scheduled turn.
 *
 * Keep only authority-bearing gates that are not already fixed by the
 * launch-time model catalog or final process overrides. Dotted keys target
 * Codex's typed config; structured feature tables use `.enabled` so sibling
 * policy fields cannot be replaced by a scalar override.
 */
export const ASSISTANT_SCHEDULED_TURN_THREAD_CONFIG = {
  include_permissions_instructions: false,
  web_search: 'disabled',
  'features.current_time_reminder.enabled': false,
  'features.deferred_executor': false,
  'features.goals': false,
  'features.hooks': false,
  'features.image_generation': false,
  'features.memories': false,
  'features.skill_mcp_dependency_install': false,
  'features.token_budget.enabled': false,
  'orchestrator.skills.enabled': false,
  'skills.include_instructions': false,
  'tools.experimental_request_user_input.enabled': false,
} as const satisfies Readonly<Record<string, unknown>>
