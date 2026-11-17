import type { AssistantCodexAttemptPlan, AssistantCodexTurnExecutionPlan } from './codex-turn/planning.js'
import { resolveAssistantConversationScope } from './conversation-policy.js'
import { normalizeNullableString } from './shared.js'
import { HOSTED_LOCAL_TEST_CODEX_MODEL_PROVIDER_ID } from '@murphai/operator-config/assistant/target-runtime'
import { MURPH_GROUP_ROOM_MODEL_CONSOLIDATION_AUTOMATION_ID, MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID } from './managed-automations.js'
import { MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID } from './onboarding-goal-checkin-automation.js'

export function resolveCodexAttemptCapabilities(
  attemptPlan: { route: AssistantCodexAttemptPlan['route']; routePlan: Pick<AssistantCodexAttemptPlan['routePlan'], 'followUpInvocation'> },
  executionPlan: Pick<AssistantCodexTurnExecutionPlan, 'profile' | 'input' | 'sharedPlan'> & { executionContext: AssistantCodexTurnExecutionPlan['executionContext'] | null },
) {
  const outputOnlyTurn =
    executionPlan.profile.toolProfile === 'output-only-turn'
  const gameHostTurn =
    executionPlan.profile.toolProfile === 'game-host-turn'
  // Process isolation (one-shot member-read process, read-only sandbox, no
  // resume) covers both follow-up evaluations and the onboarding check-in.
  // Only follow-up evaluations also lose Murph tools; the onboarding check-in
  // keeps the planned tools and their host-side context like any private run.
  const readOnlyAutomationTurn = isReadOnlyScheduledTurn(
    executionPlan.input, attemptPlan.routePlan.followUpInvocation,
  )
  const followUpEvaluationTurn =
    attemptPlan.routePlan.followUpInvocation === true
  const onboardingGoalCheckinTurn = readOnlyAutomationTurn && !followUpEvaluationTurn
  const nativeCapabilitiesRestrictedTurn = [
    outputOnlyTurn,
    gameHostTurn,
  ].includes(true)
  const systemNotificationTurn =
    executionPlan.profile.promptProfile === 'system-notification'
  const automationId =
    executionPlan.input.scheduledInvocationAuthority?.automationId
  const groupRoomModelMaintenanceTurn =
    executionPlan.profile.toolProfile === 'maintenance-turn' &&
    executionPlan.input.maintenanceProfile === 'group-room-model' &&
    automationId === MURPH_GROUP_ROOM_MODEL_CONSOLIDATION_AUTOMATION_ID
  const memberMemoryMaintenanceTurn =
    executionPlan.profile.toolProfile === 'maintenance-turn' &&
    executionPlan.input.maintenanceProfile === 'member-memory' &&
    automationId === MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID
  const toolOnlyMaintenanceTurn =
    groupRoomModelMaintenanceTurn || memberMemoryMaintenanceTurn
  const restrictedOneShotTurn = [
    toolOnlyMaintenanceTurn,
    readOnlyAutomationTurn,
    gameHostTurn,
  ].includes(true)
  const audience = executionPlan.sharedPlan.conversationPolicy.audience
  const groupConversation =
    resolveAssistantConversationScope(audience) === 'group'
  const groupEmailTurn =
    audience.threadIsDirect === false &&
    normalizeNullableString(audience.channel)?.toLowerCase() === 'email'
  const hostedCapabilitiesRestricted =
    nativeCapabilitiesRestrictedTurn || restrictedOneShotTurn
  const hostedToolContextRestricted =
    hostedCapabilitiesRestricted && !gameHostTurn && !onboardingGoalCheckinTurn
  const toolsRestricted = outputOnlyTurn || followUpEvaluationTurn
  // The onboarding check-in keeps its tools but not open web access: its
  // policy limits it to the conversation and targeted vault reads.
  const publicInternetRestricted =
    toolsRestricted || toolOnlyMaintenanceTurn || readOnlyAutomationTurn
  const ordinaryHostedWorkspaceTurn =
    Boolean(executionPlan.executionContext?.hosted) &&
    !hostedCapabilitiesRestricted &&
    !groupEmailTurn
  const hostedLocalTestProviderTurn =
    attemptPlan.route.providerOptions.modelProvider ===
      HOSTED_LOCAL_TEST_CODEX_MODEL_PROVIDER_ID
  return {
    outputOnlyTurn,
    gameHostTurn,
    readOnlyAutomationTurn,
    nativeCapabilitiesRestrictedTurn,
    systemNotificationTurn,
    groupRoomModelMaintenanceTurn,
    memberMemoryMaintenanceTurn,
    toolOnlyMaintenanceTurn,
    restrictedOneShotTurn,
    groupConversation,
    groupEmailTurn,
    ordinaryHostedWorkspaceTurn,
    customConnectionsEligible: ordinaryHostedWorkspaceTurn && !groupConversation,
    hostedLocalTestProviderTurn,
    hostedCapabilitiesRestricted,
    hostedToolContextRestricted,
    toolsRestricted,
    publicInternetRestricted,
  }
}

export type CodexAttemptCapabilities = ReturnType<typeof resolveCodexAttemptCapabilities>


function isReadOnlyScheduledTurn(input: {
  scheduledInvocationAuthority?: { automationId: string } | null
}, followUpInvocation?: boolean): boolean {
  return followUpInvocation === true || input.scheduledInvocationAuthority?.automationId === MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID
}
