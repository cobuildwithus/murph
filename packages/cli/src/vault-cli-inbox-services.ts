import { enableAssistantAutoReplyChannelLocal } from '@murphai/assistant-engine/assistant-state'
import {
  createIntegratedInboxServices,
  type InboxServices,
} from '@murphai/inbox-services'

export function createDefaultInboxServices(): InboxServices {
  return createIntegratedInboxServices({
    enableAssistantAutoReplyChannel: async (vault, channel) =>
      enableAssistantAutoReplyChannelLocal({
        channel,
        vault,
      }),
  })
}
