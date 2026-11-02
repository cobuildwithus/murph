import { createInboxInitOps } from './init.js'
import { createInboxAppEnvironment } from './environment.js'
import { createInboxPromotionOps } from './promotions.js'
import { createInboxReadOps } from './reads.js'
import { createInboxStorageRepairOps } from './storage-repair.js'

import type {
  InboxServices,
  InboxServicesDependencies,
} from './types.js'

export function createIntegratedInboxServices(
  dependencies: InboxServicesDependencies = {},
): InboxServices {
  const env = createInboxAppEnvironment(dependencies)

  return {
    ...createInboxInitOps(env),
    ...createInboxStorageRepairOps(env),
    ...createInboxReadOps(env),
    ...createInboxPromotionOps(env),
  }
}
