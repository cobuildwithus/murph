import { createIntegratedInboxServices, type InboxServices } from '@murphai/inbox-services'

export function createDefaultInboxServices(): InboxServices {
  return createIntegratedInboxServices()
}
