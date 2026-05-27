import type { AssistantLocalService } from '../src/service.js'

export function createUnusedAssistantService(): AssistantLocalService {
  const unreachable = async (): Promise<never> => {
    throw new Error('Assistant test service should not be invoked.')
  }

  return {
    drainOutbox: unreachable,
    getCronJob: unreachable,
    getCronTarget: unreachable,
    getCronStatus: unreachable,
    getOutboxIntent: unreachable,
    getSession: unreachable,
    health: unreachable,
    getStatus: unreachable,
    listSessions: unreachable,
    listCronJobs: unreachable,
    listCronRuns: unreachable,
    listOutbox: unreachable,
    openConversation: unreachable,
    processDueCron: unreachable,
    setCronTarget: unreachable,
    runAutomationOnce: unreachable,
    sendMessage: unreachable,
    updateSessionOptions: unreachable,
    vault: '/tmp/assistantd-unused-vault',
  }
}
